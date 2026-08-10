const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export const COMMUNITY_IMAGE_ACCEPT = [...ALLOWED_IMAGE_TYPES].join(',');
export const COMMUNITY_IMAGE_MAX_BYTES = 6 * 1024 * 1024;
const MAX_PARALLEL_IMAGE_UPLOADS = 2;
const IMAGE_UPLOAD_BASE_TIMEOUT_MS = 90_000;
const IMAGE_UPLOAD_TIMEOUT_PER_MIB_MS = 12_000;
const IMAGE_UPLOAD_MAX_TIMEOUT_MS = 180_000;
let activeImageUploads = 0;
const pendingImageUploads = [];

export function validateCommunityImage(file) {
  if (!(file instanceof File)) throw new Error('请选择图片文件。');
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) throw new Error('仅支持 PNG、JPG、WebP 或 GIF 图片。');
  if (!file.size) throw new Error('图片文件为空。');
  if (file.size > COMMUNITY_IMAGE_MAX_BYTES) throw new Error('单张图片不能超过 6MB。');
  return file;
}

function runImageUpload({ url, method = 'POST', file, headers = {}, onProgress }) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(method, url);
    const sizeMiB = Math.max(0, Number(file?.size) || 0) / (1024 * 1024);
    request.timeout = Math.min(IMAGE_UPLOAD_MAX_TIMEOUT_MS, Math.round(IMAGE_UPLOAD_BASE_TIMEOUT_MS + sizeMiB * IMAGE_UPLOAD_TIMEOUT_PER_MIB_MS));
    request.withCredentials = true;
    Object.entries(headers).forEach(([name, value]) => request.setRequestHeader(name, value));
    request.upload.addEventListener('progress', (event) => {
      const total = event.lengthComputable ? event.total : file.size;
      const percent = total ? Math.min(100, Math.round((event.loaded / total) * 100)) : 0;
      onProgress?.({ loaded: event.loaded, total, percent });
    });
    request.addEventListener('load', () => {
      let payload = {};
      try { payload = JSON.parse(request.responseText || '{}'); } catch { payload = {}; }
      if (request.status >= 200 && request.status < 300) {
        onProgress?.({ loaded: file.size, total: file.size, percent: 100 });
        resolve(payload);
        return;
      }
      const error = new Error(payload.error || `request_${request.status}`);
      error.status = request.status;
      error.payload = payload;
      reject(error);
    });
    request.addEventListener('error', () => reject(new Error('network_error')));
    request.addEventListener('timeout', () => reject(new Error('upload_timeout')));
    request.addEventListener('abort', () => reject(new Error('upload_aborted')));
    request.send(file);
  });
}

function drainImageUploadQueue() {
  while (activeImageUploads < MAX_PARALLEL_IMAGE_UPLOADS && pendingImageUploads.length) {
    const task = pendingImageUploads.shift();
    activeImageUploads += 1;
    runImageUpload(task.options)
      .then(task.resolve, task.reject)
      .finally(() => {
        activeImageUploads -= 1;
        drainImageUploadQueue();
      });
  }
}

export function uploadImageRequest(options) {
  return new Promise((resolve, reject) => {
    pendingImageUploads.push({ options, resolve, reject });
    drainImageUploadQueue();
  });
}

export function createUploadProgress() {
  const root = document.createElement('div');
  root.className = 'image-upload-progress';
  root.hidden = true;
  const copy = document.createElement('div');
  copy.className = 'image-upload-progress-copy';
  const label = document.createElement('span');
  const value = document.createElement('span');
  value.className = 'image-upload-progress-value';
  const track = document.createElement('progress');
  track.max = 100;
  track.value = 0;
  track.setAttribute('aria-label', '图片上传进度');
  copy.append(label, value);
  root.append(copy, track);
  const set = ({ text = '', percent = 0, state = 'uploading' }) => {
    root.hidden = false;
    root.dataset.state = state;
    label.textContent = text;
    const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
    track.value = safePercent;
    value.textContent = `${Math.round(safePercent)}%`;
  };
  return {
    el: root,
    start: (fileName) => set({ text: `正在上传 ${fileName}`, percent: 0 }),
    update: ({ percent }) => set({ text: label.textContent, percent }),
    success: (text = '上传完成') => set({ text, percent: 100, state: 'success' }),
    error: (text) => set({ text, percent: Number(track.value) || 0, state: 'error' }),
    reset: () => { root.hidden = true; root.dataset.state = ''; track.value = 0; label.textContent = ''; value.textContent = ''; },
  };
}

export async function uploadCommunityImage(file, { onProgress } = {}) {
  validateCommunityImage(file);
  try {
    const payload = await uploadImageRequest({
      url: '/api/community/images', method: 'POST', file, onProgress,
      headers: {
        'Content-Type': file.type,
        'X-File-Name': encodeURIComponent(file.name),
      },
    });
    return payload.image;
  } catch (error) {
    const messages = {
      body_too_large: '单张图片不能超过 6MB。',
      unsupported_image_type: '仅支持 PNG、JPG、WebP 或 GIF 图片。',
      invalid_image_content: '图片内容与文件格式不一致，请重新导出后上传。',
      image_upload_rate_limited: '上传过于频繁，请稍后再试。',
      network_error: '网络中断，图片未上传完成。',
      upload_timeout: '图片上传超时，请检查网络后重试；较大的图片建议先压缩。',
      upload_aborted: '图片上传已取消，请重新选择后再试。',
      image_upload_busy: '当前上传人数较多，请稍后重试。',
    };
    throw new Error(messages[error.payload?.error || error.message] || '图片上传失败，请稍后重试。');
  }
}

export function bindImageDropZone({ zone, input, onFiles }) {
  const choose = (event) => {
    if (event?.target === input) return;
    if (!input.disabled) input.click();
  };
  const openFromKeyboard = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    choose();
  };
  const showDragState = (event) => {
    event.preventDefault();
    if (!input.disabled) zone.classList.add('is-dragover');
  };
  const clearDragState = (event) => {
    if (!event.relatedTarget || !zone.contains(event.relatedTarget)) zone.classList.remove('is-dragover');
  };
  const receiveDrop = (event) => {
    event.preventDefault();
    zone.classList.remove('is-dragover');
    if (!input.disabled && event.dataTransfer?.files?.length) void onFiles(event.dataTransfer.files);
  };
  const receiveSelection = () => {
    if (input.files?.length) void onFiles(input.files);
    input.value = '';
  };
  zone.addEventListener('click', choose);
  zone.addEventListener('keydown', openFromKeyboard);
  zone.addEventListener('dragenter', showDragState);
  zone.addEventListener('dragover', showDragState);
  zone.addEventListener('dragleave', clearDragState);
  zone.addEventListener('drop', receiveDrop);
  input.addEventListener('change', receiveSelection);
  return () => {
    zone.removeEventListener('click', choose);
    zone.removeEventListener('keydown', openFromKeyboard);
    zone.removeEventListener('dragenter', showDragState);
    zone.removeEventListener('dragover', showDragState);
    zone.removeEventListener('dragleave', clearDragState);
    zone.removeEventListener('drop', receiveDrop);
    input.removeEventListener('change', receiveSelection);
  };
}
