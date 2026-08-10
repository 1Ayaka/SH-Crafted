const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export const COMMUNITY_IMAGE_ACCEPT = [...ALLOWED_IMAGE_TYPES].join(',');
export const COMMUNITY_IMAGE_MAX_BYTES = 6 * 1024 * 1024;

export function validateCommunityImage(file) {
  if (!(file instanceof File)) throw new Error('请选择图片文件。');
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) throw new Error('仅支持 PNG、JPG、WebP 或 GIF 图片。');
  if (!file.size) throw new Error('图片文件为空。');
  if (file.size > COMMUNITY_IMAGE_MAX_BYTES) throw new Error('单张图片不能超过 6MB。');
  return file;
}

export async function uploadCommunityImage(file) {
  validateCommunityImage(file);
  const response = await fetch('/api/community/images', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': file.type,
      'X-File-Name': encodeURIComponent(file.name),
    },
    body: file,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const messages = {
      body_too_large: '单张图片不能超过 6MB。',
      unsupported_image_type: '仅支持 PNG、JPG、WebP 或 GIF 图片。',
      invalid_image_content: '图片内容与文件格式不一致，请重新导出后上传。',
      image_upload_rate_limited: '上传过于频繁，请稍后再试。',
    };
    throw new Error(messages[payload.error] || '图片上传失败，请稍后重试。');
  }
  return payload.image;
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
