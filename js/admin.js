const state = {
  ready: false,
  authenticated: false,
  username: null,
  revision: '',
  communityRevision: '',
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `request_${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  if (payload.revision && !path.startsWith('/api/admin/submissions')) state.revision = payload.revision;
  return payload;
}

export async function initializeAdmin() {
  try {
    const session = await api('/api/admin/session');
    state.authenticated = session.authenticated;
    state.username = session.username;
    state.revision = session.revision || '';
  } catch {
    state.authenticated = false;
  }
  state.ready = true;
  document.documentElement.classList.toggle('admin-authenticated', state.authenticated);
  return state;
}

export function isAdmin() {
  return state.authenticated;
}

export function adminState() {
  return { ...state };
}

export async function login(username, password) {
  const result = await api('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  state.authenticated = true;
  state.username = result.username;
  document.documentElement.classList.add('admin-authenticated');
  return result;
}

export async function logout() {
  await api('/api/admin/logout', { method: 'POST' });
  state.authenticated = false;
  state.username = null;
  document.documentElement.classList.remove('admin-authenticated');
  location.hash = '#/';
  location.reload();
}

async function save(path, body) {
  try {
    return await api(path, {
      method: 'PUT',
      body: JSON.stringify({ ...body, revision: state.revision }),
    });
  } catch (error) {
    if (error.status === 409) {
      state.revision = error.payload?.revision || state.revision;
      throw new Error('内容已被其他页面或操作更新。请刷新页面查看最新版后再编辑。');
    }
    if (error.status === 401) throw new Error('登录已过期，请重新登录。');
    throw new Error('保存失败，请稍后重试。');
  }
}

export const saveSiteTexts = (updates) => save('/api/admin/site-texts', { updates });
export const saveDistrict = (id, fields) => save(`/api/admin/districts/${encodeURIComponent(id)}`, fields);
export const saveCraft = (id, fields) => save(`/api/admin/crafts/${encodeURIComponent(id)}`, fields);
export async function importCraft(payload) {
  return api('/api/admin/crafts/import', { method: 'POST', body: JSON.stringify({ ...payload, revision: state.revision }) });
}
export const saveCraftSteps = (id, steps) => save(`/api/admin/crafts/${encodeURIComponent(id)}/steps`, { steps });

export async function loadSubmissions(status = 'all') {
  const payload = await api(`/api/admin/submissions?status=${encodeURIComponent(status)}`);
  state.communityRevision = payload.revision || state.communityRevision;
  return payload;
}

export async function reviewSubmission(id, action, reviewerNote = '') {
  try {
    const payload = await api(`/api/admin/submissions/${encodeURIComponent(id)}/review`, {
      method: 'PUT',
      body: JSON.stringify({
        action,
        reviewer_note: reviewerNote,
        revision: state.communityRevision,
      }),
    });
    state.communityRevision = payload.revision || state.communityRevision;
    if (payload.content_revision) state.revision = payload.content_revision;
    return payload;
  } catch (error) {
    if (error.status === 409) {
      state.communityRevision = error.payload?.revision || state.communityRevision;
      throw new Error('投稿已经被审核，或审核列表已由另一位管理员更新。请刷新后重试。');
    }
    if (error.status === 401) throw new Error('登录已过期，请重新登录。');
    throw new Error('审核操作失败，请稍后重试。');
  }
}
