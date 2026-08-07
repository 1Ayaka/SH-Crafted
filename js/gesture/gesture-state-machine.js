// 手势状态机 —— 显式状态 + 迁移白名单 + can/transition/reset
// 参考 voice/voice-state-machine.js 的模式，保持一致的 API 形态
export const GESTURE_STATES = Object.freeze({
  DISABLED: 'DISABLED',
  REQUESTING_PERMISSION: 'REQUESTING_PERMISSION',
  CAMERA_STARTING: 'CAMERA_STARTING',
  LOADING_MODEL: 'LOADING_MODEL',
  CALIBRATING: 'CALIBRATING',
  SEARCHING_HAND: 'SEARCHING_HAND',
  READY: 'READY',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  ERROR: 'ERROR',
});

const ALLOWED = Object.freeze({
  DISABLED: [GESTURE_STATES.REQUESTING_PERMISSION],
  REQUESTING_PERMISSION: [GESTURE_STATES.CAMERA_STARTING, GESTURE_STATES.DISABLED, GESTURE_STATES.ERROR],
  CAMERA_STARTING: [GESTURE_STATES.LOADING_MODEL, GESTURE_STATES.CALIBRATING, GESTURE_STATES.DISABLED, GESTURE_STATES.ERROR],
  LOADING_MODEL: [GESTURE_STATES.CALIBRATING, GESTURE_STATES.SEARCHING_HAND, GESTURE_STATES.DISABLED, GESTURE_STATES.ERROR],
  CALIBRATING: [GESTURE_STATES.SEARCHING_HAND, GESTURE_STATES.READY, GESTURE_STATES.DISABLED, GESTURE_STATES.ERROR],
  SEARCHING_HAND: [GESTURE_STATES.READY, GESTURE_STATES.DISABLED, GESTURE_STATES.SUSPENDED, GESTURE_STATES.ERROR],
  READY: [GESTURE_STATES.ACTIVE, GESTURE_STATES.SEARCHING_HAND, GESTURE_STATES.DISABLED, GESTURE_STATES.SUSPENDED, GESTURE_STATES.ERROR],
  ACTIVE: [GESTURE_STATES.READY, GESTURE_STATES.SEARCHING_HAND, GESTURE_STATES.DISABLED, GESTURE_STATES.SUSPENDED, GESTURE_STATES.ERROR],
  SUSPENDED: [GESTURE_STATES.SEARCHING_HAND, GESTURE_STATES.READY, GESTURE_STATES.DISABLED, GESTURE_STATES.ERROR],
  ERROR: [GESTURE_STATES.DISABLED],
});

export function createGestureStateMachine({ onChange } = {}) {
  let current = GESTURE_STATES.DISABLED;
  let previous = null;
  let meta = null;

  const can = (next) => Boolean(ALLOWED[current]?.includes(next));

  const transition = (next, transitionMeta) => {
    if (!can(next)) {
      throw new Error(`invalid_gesture_transition:${current}->${next}`);
    }
    previous = current;
    current = next;
    meta = transitionMeta || null;
    onChange?.(next, previous, meta);
    return next;
  };

  const reset = (reason) => {
    if (current === GESTURE_STATES.DISABLED) return GESTURE_STATES.DISABLED;
    return transition(GESTURE_STATES.DISABLED, { reason: reason || 'reset' });
  };

  return {
    state: () => current,
    previous: () => previous,
    meta: () => meta,
    can,
    transition,
    reset,
  };
}
