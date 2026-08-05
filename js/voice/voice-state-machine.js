export const VOICE_STATES = Object.freeze({
  DISABLED: 'DISABLED', REQUESTING_PERMISSION: 'REQUESTING_PERMISSION', WAKE_LISTENING: 'WAKE_LISTENING',
  AWAKENED: 'AWAKENED', LISTENING: 'LISTENING', TRANSCRIBING: 'TRANSCRIBING', THINKING: 'THINKING',
  CONFIRMING: 'CONFIRMING', EXECUTING: 'EXECUTING', SPEAKING: 'SPEAKING', SUSPENDED: 'SUSPENDED', ERROR: 'ERROR',
});

const ALLOWED = {
  DISABLED: ['REQUESTING_PERMISSION'], REQUESTING_PERMISSION: ['WAKE_LISTENING', 'ERROR', 'DISABLED'],
  WAKE_LISTENING: ['AWAKENED', 'LISTENING', 'SUSPENDED', 'DISABLED', 'ERROR'],
  AWAKENED: ['LISTENING', 'WAKE_LISTENING', 'SUSPENDED', 'ERROR'],
  LISTENING: ['TRANSCRIBING', 'WAKE_LISTENING', 'SUSPENDED', 'ERROR'],
  TRANSCRIBING: ['THINKING', 'LISTENING', 'WAKE_LISTENING', 'ERROR'],
  THINKING: ['CONFIRMING', 'EXECUTING', 'SPEAKING', 'LISTENING', 'WAKE_LISTENING', 'ERROR'],
  CONFIRMING: ['EXECUTING', 'LISTENING', 'WAKE_LISTENING', 'DISABLED', 'ERROR'],
  EXECUTING: ['SPEAKING', 'LISTENING', 'WAKE_LISTENING', 'ERROR'],
  SPEAKING: ['LISTENING', 'WAKE_LISTENING', 'SUSPENDED', 'ERROR'],
  SUSPENDED: ['WAKE_LISTENING', 'LISTENING', 'DISABLED', 'ERROR'], ERROR: ['WAKE_LISTENING', 'LISTENING', 'DISABLED'],
};

export function createVoiceStateMachine({ initial = VOICE_STATES.DISABLED, onChange } = {}) {
  let current = initial;
  return {
    state: () => current,
    can(next) { return current === next || (ALLOWED[current] || []).includes(next); },
    transition(next, meta = {}) {
      if (!this.can(next)) throw new Error(`invalid_voice_transition:${current}->${next}`);
      const previous = current; current = next; onChange?.(current, previous, meta); return current;
    },
    reset(meta = {}) { const previous = current; current = VOICE_STATES.DISABLED; onChange?.(current, previous, meta); },
    allowed: ALLOWED,
  };
}
