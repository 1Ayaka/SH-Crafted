// 语音供应商适配层。业务层只依赖这些最小接口，后续可替换为 WASM 唤醒词、
// 服务端 STT、Realtime WebRTC 或项目方批准的 TTS 服务。
export class BrowserSpeechToTextAdapter {
  constructor({ language = 'zh-CN' } = {}) { this.language = language; this.recognition = null; }
  supported() { return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition); }
  async listen({ onStart, onEnd, onText, onError, continuous = false, resolveOnResult = true } = {}) {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) throw new Error('speech_recognition_unavailable');
    return new Promise((resolve, reject) => {
      const recognition = new Recognition(); this.recognition = recognition;
      let settled = false;
      recognition.lang = this.language; recognition.interimResults = false; recognition.continuous = continuous; recognition.maxAlternatives = 1;
      recognition.onstart = () => onStart?.();
      recognition.onresult = (event) => { const text = event.results?.[0]?.[0]?.transcript?.trim() || ''; onText?.(text); if (resolveOnResult && !settled) { settled = true; resolve(text); } };
      recognition.onerror = (event) => { onError?.(event.error); if (!settled) { settled = true; reject(new Error(`speech_${event.error || 'error'}`)); } };
      recognition.onend = () => { this.recognition = null; onEnd?.(); if (resolveOnResult && !settled) { settled = true; resolve(''); } };
      recognition.start();
    });
  }
  stop() { try { this.recognition?.stop(); } catch {} this.recognition = null; }
}

export class BrowserWakeWordAdapter extends BrowserSpeechToTextAdapter {
  constructor({ wakeWords = ['小蕉小蕉'], ...options } = {}) { super(options); this.wakeWords = wakeWords; }
  async listen({ onWake, onError } = {}) {
    return super.listen({
      continuous: true, resolveOnResult: false,
      onText: (text) => { if (this.wakeWords.some((word) => text.includes(word))) { this.stop(); onWake?.(text); } },
      onError,
    });
  }
}

export class BrowserTextToSpeechAdapter {
  constructor() { this.current = null; }
  supported() { return 'speechSynthesis' in window; }
  speak(text, { rate = 1, onEnd, onError } = {}) {
    this.stop(); if (!this.supported()) return false;
    const utterance = new SpeechSynthesisUtterance(String(text || '')); utterance.lang = 'zh-CN'; utterance.rate = rate; this.current = utterance;
    utterance.onend = () => { if (this.current === utterance) this.current = null; onEnd?.(); };
    utterance.onerror = () => { if (this.current === utterance) this.current = null; onError?.(); };
    window.speechSynthesis.speak(utterance); return true;
  }
  stop() { try { window.speechSynthesis?.cancel(); } catch {} this.current = null; }
}

export class NoopLocalWakeWordAdapter {
  constructor({ wakeWords = ['小蕉小蕉'] } = {}) { this.wakeWords = wakeWords; }
  supported() { return false; }
  async listen() { throw new Error('local_wake_word_model_not_configured'); }
  stop() {}
}
