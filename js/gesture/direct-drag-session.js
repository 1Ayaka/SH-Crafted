// A direct press/drag/release session for open-palm interaction.
// It intentionally has no click or long-press threshold: an open palm already
// means "mouse button held", so every stable movement must reach the active
// scene immediately.
export function createDirectDragSession({
  smoothing = 0.58,
  gain = 1.15,
  minDeltaPx = 0.12,
  maxDeltaPx = 64,
} = {}) {
  const alpha = Math.max(0.15, Math.min(1, Number(smoothing) || 0.58));
  const movementGain = Math.max(0.5, Math.min(2.5, Number(gain) || 1.15));
  const minimum = Math.max(0, Number(minDeltaPx) || 0);
  const maximum = Math.max(8, Number(maxDeltaPx) || 64);
  let active = false;
  let point = null;
  let totalDistance = 0;

  const pointOf = (value) => ({
    x: Number(value?.x || 0),
    y: Number(value?.y || 0),
  });

  function start(value) {
    point = pointOf(value);
    active = true;
    totalDistance = 0;
    return { type: 'drag-start', point: { ...point }, totalDistance };
  }

  function move(value) {
    if (!active || !point) return null;
    const raw = pointOf(value);
    const previous = { ...point };
    const next = {
      x: point.x + (raw.x - point.x) * alpha,
      y: point.y + (raw.y - point.y) * alpha,
    };
    let dx = (next.x - point.x) * movementGain;
    let dy = (next.y - point.y) * movementGain;

    const length = Math.hypot(dx, dy);
    if (length > maximum) {
      const scale = maximum / length;
      dx *= scale;
      dy *= scale;
    }
    // Advance by the movement actually delivered to the scene. If a single
    // camera frame jumps, the remainder is caught up smoothly on later frames
    // instead of being discarded.
    point = {
      x: previous.x + dx / movementGain,
      y: previous.y + dy / movementGain,
    };
    if (Math.abs(dx) + Math.abs(dy) < minimum) return null;
    totalDistance += Math.hypot(dx, dy);
    return { type: 'drag-move', point: { ...point }, dx, dy, totalDistance };
  }

  function end(value) {
    const finalMove = value ? move(value) : null;
    const result = {
      type: 'drag-end',
      point: { ...(point || pointOf(value)) },
      totalDistance,
      finalMove,
    };
    active = false;
    point = null;
    totalDistance = 0;
    return result;
  }

  function reset() {
    active = false;
    point = null;
    totalDistance = 0;
  }

  return { start, move, end, reset, active: () => active };
}
