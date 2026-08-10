export const MAP_LOAD_POLICY = Object.freeze({
  overviewMarkerLimit: 12,
  overviewMarkerBudget: 48,
  focusAnchorLimit: 36,
  focusAnchorBatch: 8,
  flatParticleLimit: 96,
});

export function compactMarkerCount(total, limit = MAP_LOAD_POLICY.overviewMarkerLimit) {
  return Math.min(Math.max(0, total), limit);
}

export function markerWeight(total, index, visibleCount) {
  if (total <= visibleCount) return 1;
  const start = Math.floor((index * total) / visibleCount);
  const end = Math.floor(((index + 1) * total) / visibleCount);
  return Math.max(1, end - start);
}

export function flatParticleCount(total) {
  if (total <= 0) return 0;
  return Math.min(MAP_LOAD_POLICY.flatParticleLimit, Math.round(7 + Math.sqrt(total) * 18));
}

export function progressiveAnchorSlots(total, firstBatch = MAP_LOAD_POLICY.focusAnchorBatch) {
  if (total <= 0) return [];
  const initialCount = Math.min(total, firstBatch);
  const initial = new Set(Array.from({ length: initialCount }, (_, index) => (
    initialCount === 1 ? 0 : Math.round((index * (total - 1)) / (initialCount - 1))
  )));
  return [...initial, ...Array.from({ length: total }, (_, index) => index).filter((index) => !initial.has(index))];
}

export function allocateOverviewMarkerBudget(entries, {
  budget = MAP_LOAD_POLICY.overviewMarkerBudget,
  localLimit = MAP_LOAD_POLICY.overviewMarkerLimit,
} = {}) {
  const active = entries
    .map(({ id, count }) => ({ id, count: Math.max(0, Number(count) || 0), allocated: 0 }))
    .filter((entry) => entry.count > 0)
    .sort((left, right) => right.count - left.count || String(left.id).localeCompare(String(right.id)));
  const eligible = active.slice(0, Math.max(0, budget));
  eligible.forEach((entry) => { entry.allocated = 1; });
  let remaining = Math.max(0, Math.min(budget, eligible.reduce((sum, entry) => sum + Math.min(localLimit, entry.count), 0)) - eligible.length);
  while (remaining > 0) {
    const candidate = eligible
      .filter((entry) => entry.allocated < Math.min(localLimit, entry.count))
      .sort((left, right) => (right.count / (right.allocated + 1)) - (left.count / (left.allocated + 1)) || String(left.id).localeCompare(String(right.id)))[0];
    if (!candidate) break;
    candidate.allocated += 1;
    remaining -= 1;
  }
  return new Map(entries.map(({ id }) => [id, eligible.find((entry) => entry.id === id)?.allocated || 0]));
}
