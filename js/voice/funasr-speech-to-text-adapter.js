import { PcmAudioCapture } from './pcm-audio-capture.js';

function wsUrl(path) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}${path}`;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; });
  return { promise, resolve, reject };
}

export class FunASRSpeechToTextAdapter {
  constructor({
    language = 'zh-CN',
    sessionFetcher = (...args) => fetch(...args),
    socketFactory = (url) => new WebSocket(url),
    captureFactory = () => new PcmAudioCapture({ sampleRate: 16000 }),
    finalResponseTimeoutMs = 22000,
  } = {}) {
    this.language = language;
    this.sessionFetcher = sessionFetcher;
    this.socketFactory = socketFactory;
    this.captureFactory = captureFactory;
    this.finalResponseTimeoutMs = Math.max(1000, Number(finalResponseTimeoutMs) || 22000);
    this.activeSession = null;
    this.sessionSequence = 0;
  }

  supported() { return Boolean(window.WebSocket && window.AudioContext && window.AudioWorkletNode); }

  async listen({ onStart, onEnd, onText, onPartial, onLevel, onError, context = {}, hotwords = [] } = {}) {
    if (!this.supported()) throw new Error('VOICE_AUDIO_CONTEXT_FAILED');
    // Every recognition owns its socket, capture and promise. A delayed close from an
    // earlier socket must never be able to stop the next microphone session.
    this.cancel('VOICE_SESSION_REPLACED');
    const id = ++this.sessionSequence;
    const completion = deferred();
    const session = {
      id, socket: null, capture: null, completion, settled: false, stopping: false, finalTimer: 0,
      cancelled: false, onEnd, onError,
    };
    this.activeSession = session;

    const settle = (kind, value) => {
      if (session.settled) return;
      session.settled = true;
      clearTimeout(session.finalTimer);
      session.finalTimer = 0;
      kind === 'resolve' ? completion.resolve(value) : completion.reject(value);
    };
    const stopCapture = async () => {
      const capture = session.capture;
      session.capture = null;
      await capture?.stop();
    };
    const sessionResponse = await this.sessionFetcher('/api/voice/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context_revision: context.context_revision || 'unknown' }),
    });
    if (!sessionResponse.ok) {
      if (this.activeSession === session) this.activeSession = null;
      throw new Error((await sessionResponse.json().catch(() => ({}))).error || 'VOICE_SESSION_INVALID');
    }
    if (session.cancelled || this.activeSession !== session) throw new Error('VOICE_SESSION_REPLACED');
    const serverSession = await sessionResponse.json();
    const socket = this.socketFactory(wsUrl(serverSession.websocket_url || '/api/voice/stream'));
    session.socket = socket;
    socket.binaryType = 'arraybuffer';
    socket.onopen = async () => {
      if (session.cancelled || this.activeSession !== session) { socket.close(); return; }
      try {
        socket.send(JSON.stringify({
          type: 'start', request_id: crypto.randomUUID?.() || `${Date.now()}`,
          session_id: serverSession.session_id, context_revision: context.context_revision || 'unknown',
          hotwords: hotwords.slice(0, 24).join(' '),
        }));
        const capture = this.captureFactory();
        session.capture = capture;
        await capture.start({
          onChunk: (chunk) => {
            if (!session.stopping && socket.readyState === WebSocket.OPEN) socket.send(chunk);
          },
          onLevel,
        });
        if (session.cancelled || this.activeSession !== session) { await stopCapture(); return; }
        onStart?.();
      } catch (error) {
        onError?.(error.message);
        await stopCapture();
        settle('reject', error);
        try { socket.close(); } catch {}
      }
    };
    socket.onmessage = (event) => {
      let message; try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'partial_transcript') { onPartial?.(message.text || ''); return; }
      if (message.type === 'error') {
        const error = new Error(message.code || 'VOICE_CONNECTION_FAILED');
        onError?.(error.message);
        settle('reject', error);
        return;
      }
      if (message.type === 'final_transcript') {
        onText?.(message.text || '');
        settle('resolve', message.text || '');
        void stopCapture();
        window.setTimeout(() => { try { socket.close(1000, 'final_received'); } catch {} }, 0);
      }
    };
    socket.onerror = () => {
      const error = new Error('VOICE_CONNECTION_FAILED');
      onError?.(error.message);
      settle('reject', error);
    };
    socket.onclose = () => {
      void stopCapture();
      onEnd?.();
      if (!session.cancelled && !session.settled) settle('reject', new Error('VOICE_CONNECTION_CLOSED'));
      if (this.activeSession === session) this.activeSession = null;
    };
    return completion.promise.finally(() => {
      if (this.activeSession === session && session.settled) this.activeSession = null;
    });
  }

  async stop() {
    const session = this.activeSession;
    if (!session || session.stopping) return;
    session.stopping = true;
    const capture = session.capture;
    session.capture = null;
    await capture?.stop();
    if (session.socket?.readyState === WebSocket.OPEN) {
      session.socket.send(JSON.stringify({ type: 'stop', request_id: `${Date.now()}` }));
      session.finalTimer = window.setTimeout(() => {
        if (session.settled) return;
        session.settled = true;
        session.completion.reject(new Error('VOICE_FINAL_TIMEOUT'));
        try { session.socket?.close(); } catch {}
        if (this.activeSession === session) this.activeSession = null;
      }, this.finalResponseTimeoutMs);
    }
  }

  cancel(reason = 'VOICE_CANCELLED') {
    const session = this.activeSession;
    if (!session) return;
    this.activeSession = null;
    session.cancelled = true;
    clearTimeout(session.finalTimer);
    try { if (session.socket?.readyState === WebSocket.OPEN) session.socket.send(JSON.stringify({ type: 'cancel', reason })); } catch {}
    try { session.socket?.close(); } catch {}
    const capture = session.capture;
    session.capture = null;
    void capture?.stop();
    if (!session.settled) {
      session.settled = true;
      session.completion.reject(new Error(reason));
    }
  }

  destroy() { this.cancel('VOICE_CANCELLED'); }
}
