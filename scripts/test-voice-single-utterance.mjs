import assert from 'node:assert/strict';
import { createSingleUtteranceDetector } from '../js/voice/voice-controller.js';

const detector = createSingleUtteranceDetector({ endSilenceMs: 900, noSpeechTimeoutMs: 7000, minimumSpeechMs: 260 });
detector.start(0);
assert.equal(detector.sample(0.002, 500), 'listening');
assert.equal(detector.sample(0.03, 800), 'listening');
assert.equal(detector.sample(0.025, 1200), 'listening');
assert.equal(detector.sample(0.003, 1900), 'listening');
assert.equal(detector.tick(2101), 'complete');

const silent = createSingleUtteranceDetector({ noSpeechTimeoutMs: 7000 });
silent.start(100);
assert.equal(silent.tick(7099), 'listening');
assert.equal(silent.tick(7100), 'no-speech');

const noisy = createSingleUtteranceDetector({ endSilenceMs: 900 });
noisy.start(0);
assert.equal(noisy.sample(0.02, 200), 'listening');
assert.equal(noisy.sample(0.009, 800), 'listening');
assert.equal(noisy.sample(0.003, 1701), 'complete');
console.log('single utterance detector tests passed');
