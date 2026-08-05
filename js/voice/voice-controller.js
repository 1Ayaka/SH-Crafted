import { createVoiceStateMachine, VOICE_STATES } from './voice-state-machine.js';
import { BrowserSpeechToTextAdapter, BrowserTextToSpeechAdapter, BrowserWakeWordAdapter, NoopLocalWakeWordAdapter } from './adapters.js';

const DEFAULTS = { wakeWords: ['海派小匠'], wakeEnabled: false, speechRate: 1, promptSound: true, continuousSeconds: 20, ttsEnabled: true };
const PREF_KEY = 'sh-crafted.voice-preferences';

function loadPreferences() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; } catch { return { ...DEFAULTS }; } }

export function createVoiceController({ onTranscript, onStateChange, onNotice } = {}) {
  const preferences = loadPreferences();
  const machine = createVoiceStateMachine({ onChange: (next, previous, meta) => { onStateChange?.(next, previous, meta); } });
  const stt = new BrowserSpeechToTextAdapter();
  const tts = new BrowserTextToSpeechAdapter();
  const localWake = new NoopLocalWakeWordAdapter(preferences);
  const browserWake = new BrowserWakeWordAdapter(preferences);
  let wakeListening = false; let sessionTimer = 0; let continuousTimer = 0;

  const persist = () => localStorage.setItem(PREF_KEY, JSON.stringify(preferences));
  const clearTimer = () => { clearTimeout(sessionTimer); sessionTimer = 0; };
  const clearContinuousTimer = () => { clearTimeout(continuousTimer); continuousTimer = 0; };
  const beginContinuousSession = () => {
    clearContinuousTimer();
    continuousTimer = setTimeout(() => {
      stt.stop(); clearTimer();
      if (machine.state() === VOICE_STATES.LISTENING && machine.can(VOICE_STATES.WAKE_LISTENING)) machine.transition(VOICE_STATES.WAKE_LISTENING, { reason: 'continuous_session_expired' });
      if (preferences.wakeEnabled) void armWake();
    }, preferences.continuousSeconds * 1000);
    void listen({ continuousSession: true });
  };
  const suspend = (reason) => { if (machine.state() !== VOICE_STATES.DISABLED) { stt.stop(); browserWake.stop(); localWake.stop(); clearTimer(); clearContinuousTimer(); if (machine.can(VOICE_STATES.SUSPENDED)) machine.transition(VOICE_STATES.SUSPENDED, { reason }); } };
  const armWake = async () => {
    if (!preferences.wakeEnabled) return;
    clearContinuousTimer(); wakeListening = true; if (machine.state() !== VOICE_STATES.WAKE_LISTENING) machine.transition(VOICE_STATES.WAKE_LISTENING);
    onNotice?.(localWake.supported() ? '已在本机等待唤醒词。' : '已开启唤醒模式；当前浏览器使用语音兼容适配，正式上线可替换为本地模型。');
    try { await browserWake.listen({ onWake: () => { if (!wakeListening) return; wakeListening = false; machine.transition(VOICE_STATES.AWAKENED); onNotice?.('已唤醒，请说出你的操作。'); void listen(); } }); } catch (error) { if (wakeListening) machine.transition(VOICE_STATES.ERROR, { error: error.message }); }
  };
  const listen = async ({ continuousSession = false } = {}) => {
    clearTimer(); if (machine.state() === VOICE_STATES.SPEAKING) tts.stop();
    if (![VOICE_STATES.AWAKENED, VOICE_STATES.WAKE_LISTENING, VOICE_STATES.SPEAKING, VOICE_STATES.SUSPENDED].includes(machine.state())) return;
    if (machine.state() !== VOICE_STATES.LISTENING) machine.transition(VOICE_STATES.LISTENING);
    let timedOut = false;
    sessionTimer = setTimeout(() => {
      timedOut = true; stt.stop();
      if (machine.state() === VOICE_STATES.LISTENING && machine.can(VOICE_STATES.WAKE_LISTENING)) machine.transition(VOICE_STATES.WAKE_LISTENING, { reason: 'speech_timeout' });
      if (preferences.wakeEnabled) void armWake();
    }, 7000);
    try {
      const text = await stt.listen({ onError: (error) => onNotice?.(`语音识别失败：${error || '浏览器未返回原因'}，可以改用文字输入。`) });
      if (timedOut) return;
      clearTimer();
      if (text) {
        machine.transition(VOICE_STATES.TRANSCRIBING); onTranscript?.(text);
        if (preferences.wakeEnabled) { machine.transition(VOICE_STATES.LISTENING); beginContinuousSession(); }
        else machine.transition(VOICE_STATES.LISTENING);
      } else if (preferences.wakeEnabled && !continuousSession) armWake();
    } catch { if (machine.state() !== VOICE_STATES.ERROR) machine.transition(VOICE_STATES.ERROR); }
  };
  const start = async ({ wake = true } = {}) => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('microphone_api_unavailable');
    if (machine.state() !== VOICE_STATES.DISABLED && machine.state() !== VOICE_STATES.SUSPENDED) stop();
    if (machine.state() !== VOICE_STATES.SUSPENDED) machine.transition(VOICE_STATES.REQUESTING_PERMISSION);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach((track) => track.stop());
    preferences.wakeEnabled = wake; persist();
    if (wake) await armWake(); else { machine.transition(VOICE_STATES.AWAKENED); await listen(); }
  };
  const stop = () => { wakeListening = false; stt.stop(); browserWake.stop(); localWake.stop(); tts.stop(); clearTimer(); clearContinuousTimer(); machine.reset({ reason: 'user_stop' }); };
  const speak = (text) => {
    if (!preferences.ttsEnabled || !text) return false;
    // TTS 不要求打开麦克风：文字用户也应能使用“读给我听”。
    if (machine.state() === VOICE_STATES.DISABLED) return tts.speak(text, { rate: preferences.speechRate });
    machine.transition(VOICE_STATES.SPEAKING); return tts.speak(text, { rate: preferences.speechRate });
  };
  const setPreferences = (next) => {
    const normalized = { ...next };
    if ('wake_enabled' in normalized) { normalized.wakeEnabled = Boolean(normalized.wake_enabled); delete normalized.wake_enabled; }
    if ('tts_enabled' in normalized) { normalized.ttsEnabled = Boolean(normalized.tts_enabled); delete normalized.tts_enabled; }
    if ('speech_rate' in normalized) { normalized.speechRate = Number(normalized.speech_rate); delete normalized.speech_rate; }
    if ('prompt_sound' in normalized) { normalized.promptSound = Boolean(normalized.prompt_sound); delete normalized.prompt_sound; }
    if ('continuous_seconds' in normalized) { normalized.continuousSeconds = Number(normalized.continuous_seconds); delete normalized.continuous_seconds; }
    Object.assign(preferences, normalized); persist();
    if (next.ttsEnabled === false || next.tts_enabled === false) tts.stop();
    if (preferences.wakeEnabled === false && machine.state() !== VOICE_STATES.DISABLED) stop();
    return { ok: true, preferences: { ...preferences } };
  };
  const onVisibility = () => { if (document.hidden) suspend('page_hidden'); };
  const onPageHide = () => suspend('page_unload');
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  const destroy = () => { stop(); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('pagehide', onPageHide); };
  return { state: machine.state, preferences: () => ({ ...preferences }), start, stop, listen, speak, stopSpeaking: () => { tts.stop(); if (machine.state() === VOICE_STATES.SPEAKING) machine.transition(preferences.wakeEnabled ? VOICE_STATES.WAKE_LISTENING : VOICE_STATES.LISTENING); }, setPreferences, destroy, supported: () => ({ stt: stt.supported(), tts: tts.supported(), localWake: localWake.supported() }) };
}
