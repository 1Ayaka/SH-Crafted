import assert from 'node:assert/strict';

const requests = [];
class ControlledRequest {
  constructor() {
    this.upload = { addEventListener: () => {} };
    this.handlers = new Map();
    requests.push(this);
  }
  open() {}
  setRequestHeader() {}
  addEventListener(type, handler) { this.handlers.set(type, handler); }
  send() { this.sent = true; }
  finish() {
    this.status = 201;
    this.responseText = '{"ok":true}';
    this.handlers.get('load')?.();
  }
}

globalThis.XMLHttpRequest = ControlledRequest;
const { uploadImageRequest } = await import('../js/image-upload.js');
const uploads = Array.from({ length: 6 }, (_, index) => uploadImageRequest({
  url: `/api/upload/${index}`,
  file: { size: 100 },
}));

assert.equal(requests.length, 2, '同一页面最多只能同时发起两个图片上传');
for (let completed = 0; completed < 6; completed += 1) {
  requests[completed].finish();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(requests.length <= Math.min(6, completed + 3), '上传队列应逐项释放，不得瞬时创建全部请求');
}
await Promise.all(uploads);
assert.equal(requests.length, 6);
console.log('图片上传并发背压测试：通过（并发上限 2）');
