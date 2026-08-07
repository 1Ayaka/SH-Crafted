import { PcmAudioCapture } from './pcm-audio-capture.js';

function wsUrl(path) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}${path}`;
}

export class FunASRSpeechToTextAdapter {
  constructor({ language = 'zh-CN' } = {}) {
    this.language = language;
    this.socket = null;
    this.capture = null;
    this.request = null;
    this.cancelled = false;
  }

  supported() { return Boolean(window.WebSocket && window.AudioContext && window.AudioWorkletNode); }

  async listen({ onStart, onEnd, onText, onPartial, onLevel, onError, context = {}, hotwords = [] } = {}) {
    if (!this.supported()) throw new Error('VOICE_AUDIO_CONTEXT_FAILED');
    this.cancelled = false;
    const sessionResponse = await fetch('/api/voice/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context_revision: context.context_revision || 'unknown' }),
    });
    if (!sessionResponse.ok) throw new Error((await sessionResponse.json().catch(() => ({}))).error || 'VOICE_SESSION_INVALID');
    const session = await sessionResponse.json();
    const result = new Promise((resolve, reject) => {
      this.request = { resolve, reject, onText, onPartial, onEnd, onError };
    });
    const socket = new WebSocket(wsUrl(session.websocket_url || '/api/voice/stream'));
    this.socket = socket;
    socket.binaryType = 'arraybuffer';
    socket.onopen = async () => {
      try {
        socket.send(JSON.stringify({
          type: 'start', request_id: crypto.randomUUID?.() || `${Date.now()}`,
          session_id: session.session_id, context_revision: context.context_revision || 'unknown',
          hotwords: hotwords.slice(0, 24).join(' '),
        }));
        this.capture = new PcmAudioCapture({ sampleRate: 16000 });
        await this.capture.start({ onChunk: (chunk) => { if (socket.readyState === WebSocket.OPEN) socket.send(chunk); }, onLevel });
        onStart?.();
      } catch (error) { onError?.(error.message); this.cancel(error.message); reject(error); }
    };
    socket.onmessage = (event) => {
      let message; try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'partial_transcript') { onPartial?.(message.text || ''); return; }
      if (message.type === 'error') { const error = new Error(message.code || 'VOICE_CONNECTION_FAILED'); onError?.(error.message); this.request?.reject(error); return; }
      if (message.type === 'final_transcript') {
        onText?.(message.text || '');
        this.request?.resolve(message.text || '');
        this.request = null;
        void this.capture?.stop(); this.capture = null;
        window.setTimeout(() => { try { socket.close(1000, 'final_received'); } catch {} }, 0);
      }
    };
    socket.onerror = () => { const error = new Error('VOICE_CONNECTION_FAILED'); onError?.(error.message); this.request?.reject(error); };
    socket.onclose = () => { void this.capture?.stop(); this.capture = null; onEnd?.(); if (!this.cancelled && this.request) this.request.reject(new Error('VOICE_CONNECTION_CLOSED')); this.request = null; };
    return result;
  }

  async stop() {
    await this.capture?.stop(); this.capture = null;
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'stop', request_id: `${Date.now()}` }));
  }

  cancel(reason = 'VOICE_CANCELLED') {
    this.cancelled = true;
    try { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'cancel', reason })); } catch {}
    try { this.socket?.close(); } catch {}
    void this.capture?.stop(); this.capture = null; this.request?.reject(new Error(reason)); this.request = null;
  }

  destroy() { this.cancel('VOICE_CANCELLED'); }
}
