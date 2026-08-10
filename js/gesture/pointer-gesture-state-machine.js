export const POINTER_GESTURE_STATES = Object.freeze({
  IDLE: 'IDLE',
  PRESSED: 'PRESSED',
  LONG_PRESS: 'LONG_PRESS',
  DRAGGING: 'DRAGGING',
});

// Air interaction is deliberately different from a physical pointer. A few
// camera pixels become tens of CSS pixels, so ordinary hand tremor must not
// turn a tap into a drag. A press therefore has exactly two outcomes:
//   - release before the hold threshold -> click the target locked on press;
//   - hold, then move -> drag the locked scene.
// DOM controls still receive the raw virtual pointer stream, so direct objects
// such as the mascot remain draggable without acquiring the scene behind them.
export function createPointerGestureStateMachine({
  clickSlopPx = 34,
  holdSlopPx = 42,
  longPressMs = 520,
  postHoldDragThresholdPx = 6,
  smoothing = 0.38,
} = {}) {
  let state = POINTER_GESTURE_STATES.IDLE;
  let startedAt = 0;
  let startPoint = null;
  let smoothedPoint = null;
  let previousPoint = null;
  let clickEligible = false;
  let holdEligible = false;

  const alpha = Math.max(0.05, Math.min(1, Number(smoothing) || 0.38));
  const clickSlop = Math.max(8, Number(clickSlopPx) || 34);
  const holdSlop = Math.max(clickSlop, Number(holdSlopPx) || 42);
  const holdDuration = Math.max(200, Number(longPressMs) || 520);
  const postHoldDragThreshold = Math.max(2, Number(postHoldDragThresholdPx) || 6);

  const pointOf = (point) => ({ x: Number(point?.x || 0), y: Number(point?.y || 0) });
  const distanceFrom = (point, origin) => Math.hypot(point.x - origin.x, point.y - origin.y);

  function reset() {
    state = POINTER_GESTURE_STATES.IDLE;
    startedAt = 0;
    startPoint = null;
    smoothedPoint = null;
    previousPoint = null;
    clickEligible = false;
    holdEligible = false;
  }

  function start(point, timestamp) {
    const next = pointOf(point);
    state = POINTER_GESTURE_STATES.PRESSED;
    startedAt = Number(timestamp) || 0;
    startPoint = next;
    smoothedPoint = { ...next };
    previousPoint = { ...next };
    clickEligible = true;
    holdEligible = true;
    return { state, point: next };
  }

  function smooth(point) {
    const raw = pointOf(point);
    smoothedPoint = {
      x: smoothedPoint.x + (raw.x - smoothedPoint.x) * alpha,
      y: smoothedPoint.y + (raw.y - smoothedPoint.y) * alpha,
    };
    return smoothedPoint;
  }

  function move(point, timestamp) {
    if (state === POINTER_GESTURE_STATES.IDLE) return [];
    const current = smooth(point);
    const elapsed = Math.max(0, (Number(timestamp) || 0) - startedAt);
    const displacement = distanceFrom(current, startPoint);
    const events = [];

    if (state === POINTER_GESTURE_STATES.PRESSED) {
      if (displacement > clickSlop) clickEligible = false;
      if (displacement > holdSlop) holdEligible = false;

      // Movement before the hold threshold never manipulates a Three scene.
      // This is the key ownership boundary between a click and map rotation.
      if (elapsed >= holdDuration && holdEligible) {
        state = POINTER_GESTURE_STATES.LONG_PRESS;
        clickEligible = false;
        startPoint = { ...current };
        previousPoint = { ...current };
        events.push({ type: 'long-press-start', point: { ...current }, distance: displacement, elapsed });
      }
    } else if (state === POINTER_GESTURE_STATES.LONG_PRESS) {
      const dragDistance = distanceFrom(current, startPoint);
      if (dragDistance >= postHoldDragThreshold) {
        state = POINTER_GESTURE_STATES.DRAGGING;
        previousPoint = { ...startPoint };
        events.push({ type: 'drag-start', point: { ...current }, distance: dragDistance, elapsed });
      }
    }

    if (state === POINTER_GESTURE_STATES.DRAGGING) {
      const dx = current.x - previousPoint.x;
      const dy = current.y - previousPoint.y;
      if (Math.abs(dx) + Math.abs(dy) >= 0.08) {
        events.push({ type: 'drag-move', point: { ...current }, dx, dy, elapsed });
      }
    }

    previousPoint = { ...current };
    return events;
  }

  function end(point, timestamp) {
    if (state === POINTER_GESTURE_STATES.IDLE) {
      return { type: 'cancel', wasClick: false, state, events: [] };
    }

    const events = move(point || smoothedPoint, timestamp);
    const endingState = state;
    const finalPoint = { ...(smoothedPoint || point || { x: 0, y: 0 }) };
    const elapsed = Math.max(0, (Number(timestamp) || 0) - startedAt);
    const wasClick = endingState === POINTER_GESTURE_STATES.PRESSED && clickEligible;

    if (endingState === POINTER_GESTURE_STATES.DRAGGING) {
      events.push({ type: 'drag-end', point: finalPoint, elapsed });
      events.push({ type: 'long-press-end', point: finalPoint, elapsed, reason: 'release' });
    } else if (endingState === POINTER_GESTURE_STATES.LONG_PRESS) {
      events.push({ type: 'long-press-end', point: finalPoint, elapsed, reason: 'release' });
    }

    const result = {
      type: wasClick ? 'click'
        : endingState === POINTER_GESTURE_STATES.DRAGGING ? 'drag-end'
          : endingState === POINTER_GESTURE_STATES.LONG_PRESS ? 'long-press-end' : 'cancel',
      wasClick,
      state: endingState,
      point: finalPoint,
      elapsed,
      events,
    };
    reset();
    return result;
  }

  return { start, move, end, reset, state: () => state };
}
