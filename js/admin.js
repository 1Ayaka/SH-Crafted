import { uploadImageRequest } from './image-upload.js';

const state = {
  ready: false,
  authenticated: false,
  username: null,
  revision: '',
  communityRevision: '',
  contentReviewed: false,
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
    state.contentReviewed = Boolean(session.content_reviewed);
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
  state.revision = result.revision || state.revision;
  state.contentReviewed = Boolean(result.content_reviewed);
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

function uploadFailureMessage(error, fallback) {
  if (error?.message === 'upload_timeout') return '图片上传超时，请检查网络后重试；较大的图片建议先压缩。';
  if (error?.message === 'upload_aborted') return '图片上传已取消，请重新选择后再试。';
  if (error?.status === 503 || error?.payload?.error === 'image_upload_busy') return '当前上传人数较多，请稍后重试。';
  if (error?.message === 'network_error') return '网络中断，图片未上传完成。';
  return fallback;
}

export const saveSiteTexts = (updates) => save('/api/admin/site-texts', { updates });
export const loadBrandLogo = () => api('/api/admin/brand/logo');
export async function uploadBrandLogo(file, { onProgress } = {}) {
  if (!(file instanceof File)) throw new Error('请选择 PNG 图片。');
  if (file.type !== 'image/png') throw new Error('Logo 仅支持 PNG 格式，以保留透明背景。');
  if (file.size > 2 * 1024 * 1024) throw new Error('Logo 图片不能超过 2MB。');
  try {
    return await uploadImageRequest({
      url: '/api/admin/brand/logo', method: 'PUT', file, onProgress,
      headers: { 'Content-Type': 'image/png', 'X-File-Name': encodeURIComponent(file.name) },
    });
  } catch (error) {
    if (error.status === 401) throw new Error('登录已过期，请重新登录。');
    if (error.status === 413) throw new Error('Logo 图片不能超过 2MB。');
    if (error.status === 415) throw new Error('Logo 仅支持 PNG 格式，以保留透明背景。');
    if (error.payload?.error === 'brand_logo_dimensions') throw new Error('Logo 尺寸需在 64×64 至 2048×2048 像素之间。');
    throw new Error(uploadFailureMessage(error, 'Logo 保存失败，请稍后重试。'));
  }
}
export const saveDistrict = (id, fields) => save(`/api/admin/districts/${encodeURIComponent(id)}`, fields);
export const saveCraft = (id, fields) => save(`/api/admin/crafts/${encodeURIComponent(id)}`, fields);
export async function setContentReviewed(reviewed) {
  try {
    const payload = await api('/api/admin/content-review', { method: 'PUT', body: JSON.stringify({ reviewed: Boolean(reviewed), revision: state.revision }) });
    state.revision = payload.revision || state.revision;
    state.contentReviewed = Boolean(payload.content_reviewed);
    return payload;
  } catch (error) {
    if (error.status === 409) throw new Error('内容版本已变化，请刷新页面后再确认审核状态。');
    throw new Error('审核状态保存失败，请稍后重试。');
  }
}
export async function importCraft(payload) {
  try {
    return await api('/api/admin/crafts/import', { method: 'POST', body: JSON.stringify({ ...payload, revision: state.revision }) });
  } catch (error) {
    if (error.status === 409) {
      state.revision = error.payload?.revision || state.revision;
      const messages = {
        duplicate_craft_id: '该 ID 已存在。若要修复旧管理员导入项目，请使用带 update_existing: true 的新版 JSON。',
        duplicate_craft_title: '同一地区已有同名项目。若要覆盖该条目，请设置 update_existing: true。',
        protected_existing_craft: '该项目属于原始主非遗或其他来源，管理员 JSON 不允许覆盖。',
        existing_content_modified: '该项目已经被管理员维护过，为保护现有修改，JSON 更新已拒绝。请在编辑页手动合并。',
        content_conflict: '内容版本已变化，请刷新管理员页面后重新导入。',
      };
      throw new Error(messages[error.payload?.error] || '导入目标与现有内容冲突，请刷新后检查。');
    }
    throw error;
  }
}
export async function deleteCrafts(ids) {
  try {
    return await api('/api/admin/crafts/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ ids, revision: state.revision }),
    });
  } catch (error) {
    if (error.status === 409) {
      state.revision = error.payload?.revision || state.revision;
      if (error.payload?.error === 'protected_craft_delete') throw new Error('选择中包含原始 8 项或其他受保护项目，整批删除已取消。');
      if (error.payload?.error === 'content_conflict') throw new Error('内容版本已变化，请刷新页面后重新选择。');
    }
    if (error.status === 404) throw new Error('部分项目已不存在，请刷新页面后重新选择。');
    throw new Error(error.message || '批量删除失败。');
  }
}
export const exportGraph = () => api('/api/admin/graph/export');
export const previewGraphPatch = (payload) => api('/api/admin/graph/patch/preview', { method: 'POST', body: JSON.stringify(payload) });
export const applyGraphPatch = (payload) => api('/api/admin/graph/patch/apply', { method: 'POST', body: JSON.stringify(payload) });
export const saveCraftSteps = (id, steps) => save(`/api/admin/crafts/${encodeURIComponent(id)}/steps`, { steps });
export async function uploadCraftImage(craftId, file, { onProgress } = {}) {
  if (!(file instanceof File)) throw new Error('请选择图片文件。');
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('仅支持 PNG、JPG、WebP 或 GIF 图片。');
  if (file.size > 6 * 1024 * 1024) throw new Error('图片不能超过 6MB。');
  try {
    const payload = await uploadImageRequest({
      url: `/api/admin/crafts/${encodeURIComponent(craftId)}/images`, method: 'POST', file, onProgress,
      headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) },
    });
    return payload.image;
  } catch (error) {
    if (error.status === 401) throw new Error('登录已过期，请重新登录。');
    if (error.status === 413) throw new Error('图片不能超过 6MB。');
    if (error.status === 415) throw new Error('仅支持 PNG、JPG、WebP 或 GIF 图片。');
    throw new Error(uploadFailureMessage(error, '图片上传失败，请稍后重试。'));
  }
}

export async function uploadCraftStepImage(craftId, stepId, file, { onProgress } = {}) {
  if (!(file instanceof File)) throw new Error('请选择图片文件。');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('仅支持 PNG、JPG 或 WebP 图片。');
  if (file.size > 6 * 1024 * 1024) throw new Error('图片不能超过 6MB。');
  try {
    const payload = await uploadImageRequest({
      url: `/api/admin/crafts/${encodeURIComponent(craftId)}/steps/${encodeURIComponent(stepId)}/image`, method: 'POST', file, onProgress,
      headers: {
        'Content-Type': file.type,
        'X-File-Name': encodeURIComponent(file.name),
      },
    });
    return payload.image;
  } catch (error) {
    if (error.status === 401) throw new Error('登录已过期，请重新登录。');
    if (error.status === 413) throw new Error('图片不能超过 6MB。');
    if (error.status === 415) throw new Error('仅支持 PNG、JPG 或 WebP 图片。');
    throw new Error(uploadFailureMessage(error, '图片上传失败，请稍后重试。'));
  }
}

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
