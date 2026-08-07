import assert from 'node:assert/strict';
import { createVoiceSessionManager } from '../server/voice/voice-session-manager.mjs';
import { funasrStartPayload, normalizeFunASRMessage, parseClientMessage, safeOrigin } from '../server/voice/voice-protocol.mjs';
import { floatToPcm16 } from '../js/voice/pcm-audio-capture.js';

const start = funasrStartPayload({ hotwords: '七宝皮影 篾丝' });
assert.equal(start.mode, '2pass');
assert.equal(start.audio_fs, 16000);
assert.equal(start.is_speaking, true);
assert.equal(normalizeFunASRMessage(JSON.stringify({ mode: '2pass-online', text: '打开七宝皮影' })).final, false);
assert.equal(normalizeFunASRMessage(JSON.stringify({ mode: '2pass-offline', text: '打开七宝皮影' })).final, true);
assert.equal(parseClientMessage(JSON.stringify({ type: 'start', session_id: 'x' })).type, 'start');
assert.throws(() => parseClientMessage(JSON.stringify({ type: 'script' })), /VOICE_INVALID_MESSAGE/);
assert.equal(safeOrigin('http://localhost:7100', 'localhost:7100'), true);
assert.equal(safeOrigin('http://evil.test', 'localhost:7100'), false);
assert.deepEqual([...floatToPcm16(new Float32Array([-1, -0.5, 0, 0.5, 1]))], [-32768, -16384, 0, 16384, 32767]);
const sessions = createVoiceSessionManager({ maxPerIp: 2 });
const first = sessions.create({ ip: '127.0.0.1' });
sessions.consume(first.session_id, '127.0.0.1');
for (let index = 0; index < 5; index += 1) {
  const next = sessions.create({ ip: '127.0.0.1' });
  sessions.consume(next.session_id, '127.0.0.1');
}
sessions.create({ ip: '127.0.0.2' });
sessions.create({ ip: '127.0.0.2' });
assert.throws(() => sessions.create({ ip: '127.0.0.2' }), /VOICE_RATE_LIMITED/, '未消费的会话仍需限流');
console.log('FunASR protocol tests passed');
