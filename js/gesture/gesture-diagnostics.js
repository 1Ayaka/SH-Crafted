const STORAGE_KEY = 'sh-crafted.gesture-diagnostics.v1';

function safeValue(value, depth = 0) {
  if (depth > 3 || value == null) return value == null ? null : undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toFixed(4)) : null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, 160);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeValue(item, depth + 1));
  if (typeof value !== 'object') return undefined;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    // Never retain camera frames, landmarks or binary payloads. The diagnostic
    // file contains only derived numeric measurements and state transitions.
    if (/^(?:landmarks|bitmap|frame|image|blob|buffer|pixels|video|camera_frame)$/i.test(key)) continue;
    const clean = safeValue(item, depth + 1);
    if (clean !== undefined) result[key] = clean;
  }
  return result;
}

function loadStored() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function createGestureDiagnostics({ limit = 1600 } = {}) {
  let entries = loadStored().slice(-limit);
  let pendingPersist = 0;
  const sampleTimes = new Map();
  const startedAt = Date.now();

  function persist(force = false) {
    pendingPersist += 1;
    if (!force && pendingPersist < 8) return;
    pendingPersist = 0;
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* 可用内存日志继续工作 */ }
  }

  function record(category, data = {}) {
    entries.push({
      at: new Date().toISOString(),
      elapsed_ms: Date.now() - startedAt,
      category: String(category || 'event').slice(0, 48),
      ...safeValue(data),
    });
    if (entries.length > limit) entries.splice(0, entries.length - limit);
    persist();
  }

  function sample(category, data = {}, intervalMs = 200) {
    const now = Date.now();
    const previous = sampleTimes.get(category) || 0;
    if (now - previous < Math.max(50, Number(intervalMs) || 200)) return;
    sampleTimes.set(category, now);
    record(category, data);
  }

  function snapshot() {
    persist(true);
    return {
      schema: 'sh-crafted-gesture-diagnostics/v1',
      exported_at: new Date().toISOString(),
      privacy: 'No camera image, audio, or raw hand landmarks are retained.',
      page: typeof location === 'undefined' ? '' : `${location.pathname}${location.hash}`,
      user_agent: typeof navigator === 'undefined' ? '' : String(navigator.userAgent || '').slice(0, 240),
      entry_count: entries.length,
      entries: entries.map((entry) => ({ ...entry })),
    };
  }

  function exportText() {
    return JSON.stringify(snapshot(), null, 2);
  }

  function download() {
    if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') return false;
    const blob = new Blob([exportText()], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gesture-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  }

  function clear() {
    entries = [];
    sampleTimes.clear();
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* 忽略 */ }
    record('diagnostics-cleared');
    persist(true);
  }

  record('diagnostics-started', { limit });
  return { record, sample, snapshot, exportText, download, clear };
}
