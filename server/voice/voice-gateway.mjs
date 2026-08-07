import { WebSocketServer } from 'ws';
import { createFunASRClient } from './funasr-client.mjs';
import { parseClientMessage, safeOrigin, VOICE_ERRORS } from './voice-protocol.mjs';

function ipOf(request) { return String(request.headers['x-forwarded-for'] || request.socket.remoteAddress || 'unknown').split(',')[0].trim(); }

export function createVoiceGateway({ server, sessions, upstreamUrl, allowedOrigin = '', maxDurationMs = 30000, maxBytes = 4_000_000, maxConnectionsPerIp = 1, funasr = {} } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });
  const activeByIp = new Map();
  const failClient = (socket, code, message = code) => { if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'error', code, recoverable: true, message })); try { socket.close(1008, code); } catch {} };
  const onConnection = (client, request) => {
    const ip = ipOf(request);
    const active = activeByIp.get(ip) || 0;
    if (active >= maxConnectionsPerIp) { failClient(client, VOICE_ERRORS.RATE_LIMITED); return; }
    activeByIp.set(ip, active + 1);
    let upstream = null;
    let started = false;
    let sentFinal = false;
    let totalBytes = 0;
    let timer = setTimeout(() => failClient(client, 'VOICE_TOO_LONG'), maxDurationMs);
    const release = () => { clearTimeout(timer); timer = 0; activeByIp.set(ip, Math.max(0, (activeByIp.get(ip) || 1) - 1)); if (!activeByIp.get(ip)) activeByIp.delete(ip); upstream?.cancel(); };
    client.on('close', release);
    client.on('error', release);
    client.on('message', async (data, isBinary) => {
      try {
        if (isBinary) {
          if (!started || !upstream) throw new Error(VOICE_ERRORS.INVALID_MESSAGE);
          totalBytes += data.byteLength;
          if (totalBytes > maxBytes) throw new Error(VOICE_ERRORS.AUDIO_TOO_LARGE);
          upstream.sendAudio(data);
          return;
        }
        const message = parseClientMessage(data);
        if (message.type === 'start') {
          if (started) throw new Error(VOICE_ERRORS.INVALID_MESSAGE);
          const session = sessions.consume(message.session_id, ip);
          started = true;
          upstream = createFunASRClient({ url: upstreamUrl, ...funasr, hotwords: message.hotwords || '' });
          upstream.setResultHandler((result) => {
            if (client.readyState !== 1) return;
            if (result.final) sentFinal = true;
            client.send(JSON.stringify({ type: result.final ? 'final_transcript' : 'partial_transcript', request_id: message.request_id || '', text: result.text, is_final: result.final, mode: result.mode }));
          });
          await upstream.connect();
          if (client.readyState === 1) client.send(JSON.stringify({ type: 'ready', request_id: message.request_id || '', session_id: session.id }));
          return;
        }
        if (!started || !upstream) throw new Error(VOICE_ERRORS.INVALID_MESSAGE);
        if (message.type === 'cancel') { upstream.cancel(); client.close(1000, 'cancelled'); return; }
        if (message.type === 'stop') {
          const text = await upstream.stop();
          if (text && !sentFinal && client.readyState === 1) client.send(JSON.stringify({ type: 'final_transcript', request_id: message.request_id || '', text, is_final: true }));
          if (client.readyState === 1) client.close(1000, 'complete');
        }
      } catch (error) {
        const code = String(error?.message || VOICE_ERRORS.FUNASR_PROTOCOL_ERROR);
        failClient(client, code, code === VOICE_ERRORS.FUNASR_UNAVAILABLE ? '本地语音识别服务暂时不可用' : code);
        release();
      }
    });
  };
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (pathname !== '/api/voice/stream') return;
    const origin = request.headers.origin || '';
    const expected = allowedOrigin || request.headers.host || '';
    if (!safeOrigin(origin, expected)) { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, (client) => wss.emit('connection', client, request));
  });
  wss.on('connection', onConnection);
  return { close() { wss.close(); } };
}
