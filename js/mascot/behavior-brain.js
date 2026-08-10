const randomBetween = (random, min, max) => min + random() * (max - min);

const BEHAVIORS = Object.freeze([
  { id: 'look_around', minLevel: 1, weight: () => 15, duration: [900, 1500], transient: true },
  { id: 'walk', minLevel: 1, weight: () => 42, duration: [4800, 8200] },
  { id: 'nap', minLevel: 1, weight: () => 10, duration: [5000, 9000] },
  { id: 'stretch', minLevel: 1, weight: () => 10, duration: [1500, 2300] },
  { id: 'deep_sleep', minLevel: 1, weight: () => 1.8, untilWake: true },
  { id: 'tail_happy', minLevel: 1, weight: () => 8, duration: [1200, 2100], transient: true },
  { id: 'zoomies', minLevel: 1, weight: () => 4, duration: [2600, 4300] },
  { id: 'platform_jump', minLevel: 1, weight: () => 5, duration: [720, 980], needsPlatform: true },
  { id: 'joy_jump', minLevel: 5, weight: () => 7, duration: [620, 820] },
]);

export function availableCompanionBehaviors({ level = 1, surfaces = [], currentSurfaceId = '', currentTop = Infinity, reducedMotion = false } = {}) {
  const upperPlatforms = surfaces
    .filter((surface) => surface?.id !== currentSurfaceId)
    .filter((surface) => Number.isFinite(surface?.top) && surface.top < currentTop - 64)
    .sort((a, b) => b.top - a.top);
  return BEHAVIORS
    .filter((behavior) => level >= behavior.minLevel)
    .filter((behavior) => !reducedMotion || !['zoomies', 'platform_jump', 'joy_jump'].includes(behavior.id))
    .filter((behavior) => !behavior.needsPlatform || upperPlatforms.length)
    .map((behavior) => ({ ...behavior, targetSurface: behavior.needsPlatform ? upperPlatforms[0] : null }));
}

export function chooseCompanionBehavior(context = {}, random = Math.random) {
  const level = Math.max(1, Math.min(5, Number(context.level) || 1));
  const candidates = availableCompanionBehaviors({ ...context, level });
  const total = candidates.reduce((sum, behavior) => sum + behavior.weight(level), 0);
  let cursor = random() * total;
  const selected = candidates.find((behavior) => {
    cursor -= behavior.weight(level);
    return cursor <= 0;
  }) || candidates.at(-1);
  if (!selected) return { id: 'look_around', duration: 1000, transient: true };
  return {
    id: selected.id,
    duration: selected.untilWake ? Infinity : Math.round(randomBetween(random, ...selected.duration)),
    untilWake: Boolean(selected.untilWake),
    transient: Boolean(selected.transient),
    targetSurface: selected.targetSurface || null,
  };
}

export function nextCompanionBehaviorDelay(level = 1, random = Math.random) {
  void level;
  return Math.round(randomBetween(random, 3600, 7200));
}
