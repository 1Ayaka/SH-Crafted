const CONTROL_TYPES = new Set(['start', 'stop', 'cancel']);

export const VOICE_ERRORS = Object.freeze({
  INVALID_MESSAGE: 'VOICE_INVALID_MESSAGE',
  SESSION_INVALID: 'VOICE_SESSION_INVALID',
  SESSION_EXPIRED: 'VOICE_SESSION_EXPIRED',
  RATE_LIMITED: 'VOICE_RATE_LIMITED',
  AUDIO_TOO_LARGE: 'VOICE_AUDIO_TOO_LARGE',
  FUNASR_UNAVAILABLE: 'FUNASR_UNAVAILABLE',
  FUNASR_PROTOCOL_ERROR: 'FUNASR_PROTOCOL_ERROR',
  UPSTREAM_TIMEOUT: 'VOICE_UPSTREAM_TIMEOUT',
});

export function cleanText(value, maxLength = 2000) {
  return String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, maxLength);
}

export function parseClientMessage(raw) {
  if (typeof raw !== 'string' && !Buffer.isBuffer(raw)) throw new Error(VOICE_ERRORS.INVALID_MESSAGE);
  let message;
  try { message = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : raw); } catch { throw new Error(VOICE_ERRORS.INVALID_MESSAGE); }
  if (!message || !CONTROL_TYPES.has(message.type)) throw new Error(VOICE_ERRORS.INVALID_MESSAGE);
  return message;
}

export function normalizeFunASRMessage(raw) {
  let message;
  try { message = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)); } catch { return null; }
  const text = cleanText(message.text ?? message.result ?? message.msg ?? '', 2000);
  const mode = String(message.mode || message.type || '').toLowerCase();
  const final = Boolean(message.is_final || mode.includes('offline') || mode.includes('final'));
  if (!text && !final) return null;
  return { text, final, mode, raw: message };
}

export function funasrStartPayload({ chunkSize = [5, 10, 5], chunkInterval = 10, sampleRate = 16000, hotwords = '' } = {}) {
  return {
    mode: '2pass',
    chunk_size: chunkSize,
    chunk_interval: chunkInterval,
    audio_fs: sampleRate,
    wav_name: `sh-crafted-${Date.now()}`,
    wav_format: 'pcm',
    is_speaking: true,
    itn: true,
    hotwords: cleanText(hotwords, 2000),
  };
}

export function safeOrigin(origin, host) {
  if (!origin) return true;
  try { return new URL(origin).host === String(host || '').replace(/^https?:\/\//, ''); } catch { return false; }
}
