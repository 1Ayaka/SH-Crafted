import assert from 'node:assert/strict';

const requests = [];
class TimeoutRequest {
  constructor() {
    this.upload = { addEventListener: () => {} };
    this.handlers = new Map();
    requests.push(this);
  }
  open() {}
  setRequestHeader() {}
  addEventListener(type, handler) { this.handlers.set(type, handler); }
  send() { this.sent = true; }
  timeoutNow() { this.handlers.get('timeout')?.(); }
}

globalThis.XMLHttpRequest = TimeoutRequest;
const { uploadImageRequest } = await import('../js/image-upload.js');
const outcomes = Array.from({ length: 3 }, (_, index) => uploadImageRequest({
  url: `/api/upload/${index}`,
  file: { size: (index + 1) * 1024 * 1024 },
}).catch((error) => error.message));

assert.equal(requests.length, 2, '前两条请求应占满上传槽');
assert.ok(requests.every((request) => request.timeout >= 90_000 && request.timeout <= 180_000), 'XHR 必须设置合理超时');
requests[0].timeoutNow();
requests[1].timeoutNow();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(requests.length, 3, '前两条超时后第三条必须获得上传槽');
requests[2].timeoutNow();
assert.deepEqual(await Promise.all(outcomes), ['upload_timeout', 'upload_timeout', 'upload_timeout']);
console.log('图片上传超时释放队列测试：通过');
