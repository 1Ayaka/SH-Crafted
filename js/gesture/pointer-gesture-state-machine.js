export const POINTER_GESTURE_STATES = Object.freeze({
  IDLE: 'IDLE',
  PRESSED: 'PRESSED',
  LONG_PRESS: 'LONG_PRESS',
  DRAGGING: 'DRAGGING',
});

// 将“按下、静止长按、移动拖拽、释放”拆成独立状态。
// startPoint 在进入长按时会重锁，避免旧的按下位置造成第二段拖拽延迟。
export function createPointerGestureStateMachine({
  dragThresholdPx = 10,
  stationarySlopPx = 8,
  longPressMs = 560,
  smoothing = 0.30,
} = {}) {
  let state = POINTER_GESTURE_STATES.IDLE;
  let startedAt = 0;
  let startPoint = null;
  let smoothedPoint = null;
  let previousPoint = null;
  let maxStationaryDisplacement = 0;

  const clampSmoothing = Math.max(0.05, Math.min(1, Number(smoothing) || 0.30));
  const dragThreshold = Math.max(2, Number(dragThresholdPx) || 10);
  const stationarySlop = Math.max(1, Number(stationarySlopPx) || 8);
  const holdDuration = Math.max(100, Number(longPressMs) || 560);

  function pointOf(point) {
    return { x: Number(point?.x || 0), y: Number(point?.y || 0) };
  }

  function distanceFrom(point, origin) {
    return Math.hypot(point.x - origin.x, point.y - origin.y);
  }

  function reset() {
    state = POINTER_GESTURE_STATES.IDLE;
    startedAt = 0;
    startPoint = null;
    smoothedPoint = null;
    previousPoint = null;
    maxStationaryDisplacement = 0;
  }

  function start(point, timestamp) {
    const next = pointOf(point);
    state = POINTER_GESTURE_STATES.PRESSED;
    startedAt = Number(timestamp) || 0;
    startPoint = next;
    smoothedPoint = { ...next };
    previousPoint = { ...next };
    maxStationaryDisplacement = 0;
    return { state, point: next };
  }

  function smooth(point) {
    const raw = pointOf(point);
    smoothedPoint = {
      x: smoothedPoint.x + (raw.x - smoothedPoint.x) * clampSmoothing,
      y: smoothedPoint.y + (raw.y - smoothedPoint.y) * clampSmoothing,
    };
    return smoothedPoint;
  }

  function move(point, timestamp) {
    if (state === POINTER_GESTURE_STATES.IDLE) return [];
    const current = smooth(point);
    const elapsed = Math.max(0, (Number(timestamp) || 0) - startedAt);
    const distance = distanceFrom(current, startPoint);
    maxStationaryDisplacement = Math.max(maxStationaryDisplacement, distance);
    const events = [];

    if (state === POINTER_GESTURE_STATES.PRESSED) {
      // 先判拖拽，避免用户已经移动后仍被误报成长按。
      if (distance >= dragThreshold) {
        state = POINTER_GESTURE_STATES.DRAGGING;
        startPoint = { ...current };
        previousPoint = { ...current };
        events.push({ type: 'drag-start', point: { ...current }, distance, elapsed });
      } else if (elapsed >= holdDuration && maxStationaryDisplacement <= stationarySlop) {
        // 静止窗口判长按：560ms 内平滑位移必须仍在 8px 内。
        state = POINTER_GESTURE_STATES.LONG_PRESS;
        // 长按触发时锁住当前点，后续只需移动约 10px 即进入拖拽。
        startPoint = { ...current };
        previousPoint = { ...current };
        maxStationaryDisplacement = 0;
        events.push({ type: 'long-press-start', point: { ...current }, distance, elapsed });
      }
    } else if (state === POINTER_GESTURE_STATES.LONG_PRESS) {
      const dragDistance = distanceFrom(current, startPoint);
      if (dragDistance >= dragThreshold) {
        // 再次重锁基准，清除从长按确认到第一次移动之间的累计偏差。
        state = POINTER_GESTURE_STATES.DRAGGING;
        startPoint = { ...current };
        previousPoint = { ...current };
        events.push({ type: 'long-press-end', point: { ...current }, distance: dragDistance, elapsed, reason: 'drag-start' });
        events.push({ type: 'drag-start', point: { ...current }, distance: dragDistance, elapsed });
      }
    }

    if (state === POINTER_GESTURE_STATES.DRAGGING) {
      const dx = current.x - previousPoint.x;
      const dy = current.y - previousPoint.y;
      if (Math.abs(dx) + Math.abs(dy) >= 0.08) {
        events.push({ type: 'drag-move', point: { ...current }, dx, dy, distance: distanceFrom(current, startPoint), elapsed });
      }
    }

    previousPoint = { ...current };
    return events;
  }

  function end(point, timestamp) {
    if (state === POINTER_GESTURE_STATES.IDLE) {
      return { type: 'cancel', wasClick: false, state, events: [] };
    }

    // 释放前消费最后一个样本，避免最后一帧移动被吞掉。
    const events = move(point || smoothedPoint, timestamp);
    const endingState = state;
    const result = {
      type: endingState === POINTER_GESTURE_STATES.PRESSED ? 'click'
        : endingState === POINTER_GESTURE_STATES.LONG_PRESS ? 'long-press-end'
          : endingState === POINTER_GESTURE_STATES.DRAGGING ? 'drag-end' : 'cancel',
      wasClick: endingState === POINTER_GESTURE_STATES.PRESSED,
      state: endingState,
      point: { ...(smoothedPoint || point || { x: 0, y: 0 }) },
      elapsed: Math.max(0, (Number(timestamp) || 0) - startedAt),
      events,
    };
    if (endingState === POINTER_GESTURE_STATES.DRAGGING) {
      result.events.push({ type: 'drag-end', point: { ...result.point }, elapsed: result.elapsed });
    } else if (endingState === POINTER_GESTURE_STATES.LONG_PRESS) {
      result.events.push({ type: 'long-press-end', point: { ...result.point }, elapsed: result.elapsed, reason: 'release' });
    }
    reset();
    return result;
  }

  return { start, move, end, reset, state: () => state };
}
