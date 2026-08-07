import assert from 'node:assert/strict';
import { createVoiceStateMachine, VOICE_STATES } from '../js/voice/voice-state-machine.js';

const machine = createVoiceStateMachine();
assert.equal(machine.state(), VOICE_STATES.DISABLED);
machine.transition(VOICE_STATES.REQUESTING_PERMISSION);
machine.transition(VOICE_STATES.AWAKENED);
machine.transition(VOICE_STATES.LISTENING);
machine.transition(VOICE_STATES.TRANSCRIBING);
machine.transition(VOICE_STATES.THINKING);
machine.transition(VOICE_STATES.EXECUTING);
machine.transition(VOICE_STATES.SPEAKING);
machine.reset();
assert.equal(machine.state(), VOICE_STATES.DISABLED);
assert.throws(() => machine.transition(VOICE_STATES.EXECUTING), /invalid_voice_transition/);
console.log('voice state machine tests passed');
