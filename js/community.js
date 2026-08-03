// Community-facing API helpers. The visitor identity is held by an HttpOnly
// cookie; frontend code only receives aggregate counts and its own ordinal.
let statsCache = null;
let statsPromise = null;

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export async function loadCommunityStats({ refresh = false } = {}) {
  if (statsCache && !refresh) return statsCache;
  if (!statsPromise || refresh) {
    statsPromise = request('/api/community/stats').then((payload) => {
      statsCache = payload.crafts || {};
      return statsCache;
    }).finally(() => { statsPromise = null; });
  }
  return statsPromise;
}

export async function engagementFor(craftId) {
  const stats = await loadCommunityStats();
  return stats[craftId] || { view_count: 0, inheritor_count: 0, visitor_ordinal: 0 };
}

function remember(craftId, value) {
  statsCache ||= {};
  statsCache[craftId] = {
    view_count: Number(value.view_count) || 0,
    inheritor_count: Number(value.inheritor_count) || 0,
    visitor_ordinal: Number(value.visitor_ordinal) || 0,
  };
  return statsCache[craftId];
}

export async function recordCraftView(craftId) {
  return remember(craftId, await request(`/api/community/crafts/${encodeURIComponent(craftId)}/view`, {
    method: 'POST',
  }));
}

export async function claimInheritor(craftId) {
  return remember(craftId, await request(`/api/community/crafts/${encodeURIComponent(craftId)}/inherit`, {
    method: 'POST',
  }));
}

export function inheritorButtonText(engagement) {
  const own = Number(engagement?.visitor_ordinal) || 0;
  if (own) return `您是第 ${own} 位传承人`;
  return `成为第 ${(Number(engagement?.inheritor_count) || 0) + 1} 位传承人`;
}

export async function submitHeritage(payload) {
  return request('/api/community/submissions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
