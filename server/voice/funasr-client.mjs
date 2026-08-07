import WebSocket from 'ws';
import { funasrStartPayload, normalizeFunASRMessage } from './voice-protocol.mjs';

export function createFunASRClient({
  url = 'ws://127.0.0.1:10095',
  connectTimeoutMs = 3000,
  finalTimeoutMs = 5000,
  chunkSize = [5, 10, 5],
  chunkInterval = 10,
  sampleRate = 16000,
  hotwords = '',
} = {}) {
  let socket = null;
  let finalTimer = 0;
  let opened = false;
  let stopped = false;
  let queued = [];
  let resolveFinal;
  let rejectFinal;
  let onResult;

  const cleanupTimer = () => { clearTimeout(finalTimer); finalTimer = 0; };
  const fail = (error) => {
    cleanupTimer();
    const next = error instanceof Error ? error : new Error(String(error || 'FUNASR_UNAVAILABLE'));
    rejectFinal?.(next); rejectFinal = null; resolveFinal = null;
  };
  const connect = () => new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => { if (!settled) { settled = true; try { socket?.close(); } catch {} reject(new Error('FUNASR_UNAVAILABLE')); } }, connectTimeoutMs);
    socket = new WebSocket(url, { handshakeTimeout: connectTimeoutMs });
    socket.on('open', () => {
      if (settled) return;
      settled = true; clearTimeout(timeout); opened = true;
      socket.send(JSON.stringify(funasrStartPayload({ chunkSize, chunkInterval, sampleRate, hotwords })));
      for (const frame of queued) socket.send(frame);
      queued = [];
      resolve();
    });
    socket.on('message', (data) => {
      const message = normalizeFunASRMessage(data);
      if (!message) return;
      onResult?.(message);
      if (message.final) {
        cleanupTimer();
        resolveFinal?.(message.text);
        resolveFinal = null; rejectFinal = null;
      }
    });
    socket.on('error', (error) => { if (!settled) { settled = true; clearTimeout(timeout); reject(new Error('FUNASR_UNAVAILABLE')); } else fail(error); });
    socket.on('close', () => { if (!stopped && !resolveFinal) return; if (!stopped) fail(new Error('FUNASR_UNAVAILABLE')); });
  });
  const sendAudio = (frame) => {
    if (stopped || !frame?.byteLength) return;
    if (opened && socket?.readyState === WebSocket.OPEN) socket.send(frame);
    else if (queued.length < 32) queued.push(frame);
    else fail(new Error('VOICE_AUDIO_TOO_LARGE'));
  };
  const stop = async () => {
    if (stopped) return '';
    stopped = true;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ is_speaking: false }));
      const result = await new Promise((resolve, reject) => { resolveFinal = resolve; rejectFinal = reject; finalTimer = setTimeout(() => reject(new Error('VOICE_UPSTREAM_TIMEOUT')), finalTimeoutMs); });
      try { socket.close(); } catch {}
      return result;
    }
    return '';
  };
  const cancel = () => { stopped = true; cleanupTimer(); queued = []; try { socket?.close(); } catch {} resolveFinal = null; rejectFinal = null; };
  return { connect, sendAudio, stop, cancel, setResultHandler(handler) { onResult = handler; } };
}
