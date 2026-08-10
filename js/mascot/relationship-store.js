const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STORAGE_KEY = 'sh-crafted:mascot-relationship:v1';
const INITIAL_SCORE = 8;
const DECAY_PER_DAY = 4;

const EVENT_RULES = Object.freeze({
  panel_open: { points: 0.7, cooldown: 30 * 60 * 1000 },
  tap: { points: 1.5, cooldown: 12 * 1000 },
  grab: { points: 0.8, cooldown: 30 * 1000 },
  wake: { points: 1, cooldown: 60 * 1000 },
  question: { points: 3.5, cooldown: 20 * 1000 },
  voice_question: { points: 4, cooldown: 20 * 1000 },
  explore: { points: 0.5, cooldown: 3 * 60 * 1000 },
});

export const RELATIONSHIP_STAGES = Object.freeze([
  { level: 1, threshold: 0, label: '你和小蕉刚熟悉' },
  { level: 2, threshold: 14, label: '小蕉开始记住你了' },
  { level: 3, threshold: 34, label: '小蕉愿意陪你多待一会儿' },
  { level: 4, threshold: 58, label: '小蕉见到你会很开心' },
  { level: 5, threshold: 82, label: '小蕉很喜欢跟你玩' },
]);

const clampScore = (value) => Math.max(0, Math.min(100, Number(value) || 0));

function stageFor(score) {
  return [...RELATIONSHIP_STAGES].reverse().find((stage) => score >= stage.threshold) || RELATIONSHIP_STAGES[0];
}

function safeState(raw, now) {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid_relationship_state');
    return {
      score: clampScore(parsed.score),
      updatedAt: Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : now,
      events: parsed.events && typeof parsed.events === 'object' ? parsed.events : {},
    };
  } catch {
    return { score: INITIAL_SCORE, updatedAt: now, events: {} };
  }
}

export function createRelationshipStore({ storage = globalThis.localStorage, now = () => Date.now(), key = DEFAULT_STORAGE_KEY } = {}) {
  const listeners = new Set();
  const readRaw = () => {
    try { return storage?.getItem?.(key) || ''; } catch { return ''; }
  };
  let state = safeState(readRaw(), now());

  const persist = () => {
    try { storage?.setItem?.(key, JSON.stringify(state)); } catch { /* Privacy mode and full storage must not break the mascot. */ }
  };
  const applyDecay = (at = now()) => {
    const elapsed = Math.max(0, at - state.updatedAt);
    if (!elapsed) return;
    state.score = clampScore(state.score - (elapsed / DAY_MS) * DECAY_PER_DAY);
    state.updatedAt = at;
  };
  const snapshot = () => {
    applyDecay();
    const stage = stageFor(state.score);
    return Object.freeze({
      score: Number(state.score.toFixed(2)),
      level: stage.level,
      points: stage.level,
      label: stage.label,
      maxPoints: RELATIONSHIP_STAGES.length,
    });
  };
  const emit = () => {
    const value = snapshot();
    listeners.forEach((listener) => listener(value));
    return value;
  };

  return {
    snapshot,
    record(type, { multiplier = 1 } = {}) {
      const rule = EVENT_RULES[type];
      if (!rule) return { changed: false, value: snapshot() };
      const at = now();
      applyDecay(at);
      const previousAt = Number(state.events[type] || 0);
      if (at - previousAt < rule.cooldown) return { changed: false, value: snapshot() };
      state.events[type] = at;
      state.score = clampScore(state.score + rule.points * Math.max(0, Number(multiplier) || 0));
      state.updatedAt = at;
      persist();
      return { changed: true, value: emit() };
    },
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    reset() {
      state = { score: INITIAL_SCORE, updatedAt: now(), events: {} };
      persist();
      return emit();
    },
  };
}

