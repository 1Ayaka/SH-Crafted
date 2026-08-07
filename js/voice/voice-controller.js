import { createVoiceStateMachine, VOICE_STATES } from './voice-state-machine.js';
import { BrowserSpeechToTextAdapter, BrowserTextToSpeechAdapter } from './adapters.js';
import { FunASRSpeechToTextAdapter } from './funasr-speech-to-text-adapter.js';

const DEFAULTS = Object.freeze({
  wakeWords: ['小蕉小蕉'], wakeEnabled: false, speechRate: 1, promptSound: true,
  continuousSeconds: 20, ttsEnabled: true, sttProvider: 'funasr-local', singleTurnWake: true,
});
const PREF_KEY = 'sh-crafted.voice-preferences';
const WAKE_VARIANT_RE = /小[蕉焦交娇]小[蕉焦交娇]/;

function loadPreferences() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}

function errorMessage(error) {
  const code = String(error?.name || error?.message || error || 'VOICE_CAPTURE_FAILED');
  const messages = {
    NotAllowedError: '麦克风权限已被拒绝，请在浏览器网站设置中重新允许。',
    VOICE_SESSION_INVALID: '语音会话已失效，请重新点击麦克风。',
    VOICE_CONNECTION_FAILED: '服务器本地语音识别连接失败，请检查 FunASR 服务。',
    VOICE_CONNECTION_CLOSED: '语音连接已中断，可以重试或改用文字输入。',
    FUNASR_UNAVAILABLE: '服务器本地语音识别暂时不可用，可以改用文字输入。',
    VOICE_AUDIO_CONTEXT_FAILED: '当前浏览器不支持所需的音频采集能力，请使用新版 Chrome、Edge 或 Safari。',
    VOICE_CAPTURE_FAILED: '麦克风暂时不可用，请检查设备连接或改用文字输入。',
  };
  return messages[code] || `语音识别暂时不可用（${code}），可以改用文字输入。`;
}

function wakeMatch(text, wakeWords) {
  const source = String(text || '').trim();
  for (const word of wakeWords) {
    const index = source.indexOf(word);
    if (index >= 0) return { matched: true, command: source.slice(index + word.length).replace(/^[，。！？、：,.!?\s]+/, '') };
  }
  const variant = source.match(WAKE_VARIANT_RE);
  return variant ? { matched: true, command: source.slice((variant.index || 0) + variant[0].length).replace(/^[，。！？、：,.!?\s]+/, '') } : { matched: false, command: '' };
}

export function createVoiceController({ onTranscript, onPartialTranscript, onStateChange, onNotice, onWake, getContext, getHotwords } = {}) {
  const preferences = loadPreferences();
  const machine = createVoiceStateMachine({ onChange: (next, previous, meta) => {
    window.__gestureSystem?.setVoiceState?.(next);
    onStateChange?.(next, previous, meta);
  } });
  const funasr = new FunASRSpeechToTextAdapter();
  const browser = new BrowserSpeechToTextAdapter();
  const tts = new BrowserTextToSpeechAdapter();
  let provider = preferences.sttProvider;
  let active = null;
  let destroyed = false;
  let loopGeneration = 0;

  const persist = () => localStorage.setItem(PREF_KEY, JSON.stringify(preferences));
  const transition = (next, meta) => { if (machine.state() !== next && machine.can(next)) machine.transition(next, meta); };
  const loadConfig = async () => {
    try {
      const response = await fetch('/api/voice/config', { cache: 'no-store' });
      if (response.ok) {
        const config = await response.json();
        provider = String(config.provider || provider).toLowerCase();
        if (Array.isArray(config.wake_words) && config.wake_words.length) preferences.wakeWords = config.wake_words.slice(0, 4);
      }
    } catch { /* 保留本地配置并允许文字模式 */ }
    return provider;
  };

  function promptTone() {
    if (!preferences.promptSound || !window.AudioContext) return;
    try {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 620;
      gain.gain.setValueAtTime(0.018, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.11);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(); oscillator.stop(context.currentTime + 0.11);
      oscillator.onended = () => context.close().catch(() => {});
    } catch { /* 提示音是可选增强 */ }
  }

  function cancelRecognition(reason = 'VOICE_CANCELLED') {
    if (active) active.cancelled = true;
    funasr.cancel(reason);
    browser.stop();
    active = null;
  }

  async function recognizeOnce({ wakeScan = false } = {}) {
    if (destroyed) return '';
    const adapter = provider === 'browser' ? browser : funasr;
    active = { cancelled: false, stopping: false, startedAt: Date.now(), hasSpeech: false, lastVoiceAt: Date.now() };
    const session = active;
    let timer = 0;
    try {
      const promise = adapter.listen({
        context: getContext?.() || {},
        hotwords: [...preferences.wakeWords, ...(getHotwords?.() || [])].filter(Boolean).slice(0, 24),
        onStart: () => {
          transition(wakeScan ? VOICE_STATES.WAKE_LISTENING : VOICE_STATES.LISTENING);
          onNotice?.(wakeScan ? '正在等待“小蕉小蕉”' : '正在聆听');
        },
        onPartial: (text) => { if (!wakeScan) onPartialTranscript?.(text); },
        onLevel: (level) => { if (level > 0.018) { session.hasSpeech = true; session.lastVoiceAt = Date.now(); } },
        onError: (code) => { if (!session.cancelled) onNotice?.(errorMessage({ message: code })); },
      });
      timer = window.setInterval(() => {
        if (session.cancelled || session.stopping) return;
        const silentFor = Date.now() - session.lastVoiceAt;
        if ((session.hasSpeech && silentFor > 1050) || (!session.hasSpeech && Date.now() - session.startedAt > 6500)) {
          session.stopping = true;
          void funasr.stop().catch(() => {});
          browser.stop();
        }
      }, 200);
      const text = String(await promise || '').trim();
      return session.cancelled ? '' : text;
    } finally {
      clearInterval(timer);
      if (active === session) active = null;
    }
  }

  async function processSingleCommand(text) {
    const command = String(text || '').trim();
    if (!command) { onNotice?.('没有听到清晰指令，已继续等待“小蕉小蕉”。'); return; }
    transition(VOICE_STATES.LISTENING);
    transition(VOICE_STATES.TRANSCRIBING);
    onPartialTranscript?.(command);
    transition(VOICE_STATES.THINKING);
    await onTranscript?.(command);
    onPartialTranscript?.('');
    const speechDeadline = Date.now() + 36_000;
    while (!destroyed && machine.state() === VOICE_STATES.SPEAKING && Date.now() < speechDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }

  async function runWakeLoop(generation) {
    while (!destroyed && preferences.wakeEnabled && generation === loopGeneration && !document.hidden) {
      try {
        const heard = await recognizeOnce({ wakeScan: true });
        if (generation !== loopGeneration || !preferences.wakeEnabled || destroyed) return;
        const wake = wakeMatch(heard, preferences.wakeWords);
        if (!wake.matched) continue;
        transition(VOICE_STATES.AWAKENED);
        promptTone();
        onWake?.();
        onNotice?.('已唤醒，请说一个问题');
        const command = wake.command || await recognizeOnce({ wakeScan: false });
        if (generation !== loopGeneration || !preferences.wakeEnabled || destroyed) return;
        await processSingleCommand(command);
        // 每次唤醒只处理这一条；不开放免唤醒追问窗口。
        transition(VOICE_STATES.WAKE_LISTENING, { reason: 'single_turn_complete' });
      } catch (error) {
        if (generation !== loopGeneration || destroyed || !preferences.wakeEnabled || String(error?.message).includes('CANCELLED')) return;
        onNotice?.(errorMessage(error));
        transition(VOICE_STATES.ERROR, { error: error?.message });
        await new Promise((resolve) => setTimeout(resolve, 700));
        transition(VOICE_STATES.WAKE_LISTENING, { reason: 'retry' });
      }
    }
  }

  const start = async ({ wake = false } = {}) => {
    if (destroyed) return;
    await loadConfig();
    if (provider === 'disabled') throw new Error('FUNASR_UNAVAILABLE');
    if (machine.state() === VOICE_STATES.SUSPENDED) machine.reset({ reason: 'user_resume' });
    else if (machine.state() !== VOICE_STATES.DISABLED) cancelRecognition();
    loopGeneration += 1;
    transition(VOICE_STATES.REQUESTING_PERMISSION);
    if (wake) {
      preferences.wakeEnabled = true;
      persist();
      const generation = loopGeneration;
      void runWakeLoop(generation);
      return;
    }
    const resumeWake = preferences.wakeEnabled;
    const text = await recognizeOnce({ wakeScan: false });
    await processSingleCommand(text);
    if (resumeWake && !destroyed) {
      const generation = ++loopGeneration;
      void runWakeLoop(generation);
    } else machine.reset({ reason: 'single_command_complete' });
  };

  const stop = () => {
    loopGeneration += 1;
    cancelRecognition();
    tts.stop();
    machine.reset({ reason: 'user_stop' });
  };
  const stopListening = async () => {
    if (!active || active.stopping) return;
    active.stopping = true;
    await funasr.stop().catch(() => {});
    browser.stop();
  };
  const listen = async () => start({ wake: false });
  const speak = (text) => {
    if (!preferences.ttsEnabled || !text) return false;
    if (machine.state() !== VOICE_STATES.DISABLED) transition(VOICE_STATES.SPEAKING);
    return tts.speak(text, {
      rate: preferences.speechRate,
      onEnd: () => {
        if (machine.state() !== VOICE_STATES.SPEAKING) return;
        if (preferences.wakeEnabled) transition(VOICE_STATES.WAKE_LISTENING, { reason: 'speech_complete' });
        else machine.reset({ reason: 'speech_complete' });
      },
      onError: () => {
        if (machine.state() === VOICE_STATES.SPEAKING) {
          if (preferences.wakeEnabled) transition(VOICE_STATES.WAKE_LISTENING, { reason: 'speech_error' });
          else machine.reset({ reason: 'speech_error' });
        }
      },
    });
  };
  const stopSpeaking = () => {
    tts.stop();
    if (machine.state() === VOICE_STATES.SPEAKING) {
      if (preferences.wakeEnabled) { const generation = ++loopGeneration; transition(VOICE_STATES.WAKE_LISTENING); void runWakeLoop(generation); }
      else machine.reset({ reason: 'stop_speaking' });
    }
  };
  const setPreferences = (next = {}) => {
    if ('wake_enabled' in next) preferences.wakeEnabled = Boolean(next.wake_enabled);
    if ('tts_enabled' in next) preferences.ttsEnabled = Boolean(next.tts_enabled);
    if ('speech_rate' in next) preferences.speechRate = Math.min(1.4, Math.max(0.6, Number(next.speech_rate)));
    if ('prompt_sound' in next) preferences.promptSound = Boolean(next.prompt_sound);
    if ('continuous_seconds' in next) preferences.continuousSeconds = Math.min(30, Math.max(15, Number(next.continuous_seconds)));
    persist();
    if (!preferences.wakeEnabled) stop();
    if (!preferences.ttsEnabled) tts.stop();
    return { ok: true, preferences: { ...preferences } };
  };
  const suspend = (reason) => {
    if (machine.state() === VOICE_STATES.DISABLED) return;
    loopGeneration += 1;
    cancelRecognition();
    transition(VOICE_STATES.SUSPENDED, { reason });
  };
  const onVisibility = () => { if (document.hidden) suspend('page_hidden'); };
  const onPageHide = () => suspend('page_unload');
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  const destroy = () => {
    destroyed = true;
    preferences.wakeEnabled = false;
    stop();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    funasr.destroy();
  };
  return {
    state: machine.state, preferences: () => ({ ...preferences }), start, stop, stopListening, listen, speak, stopSpeaking, setPreferences, destroy,
    supported: () => ({ stt: funasr.supported() || browser.supported(), funasr: funasr.supported(), browser: browser.supported(), tts: tts.supported(), localWake: false, serverWake: funasr.supported() }),
  };
}
