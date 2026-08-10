import assert from 'node:assert/strict';
import { uploadImageRequest } from '../js/image-upload.js';

class FakeRequest {
  constructor() {
    this.uploadHandlers = new Map();
    this.handlers = new Map();
    this.headers = {};
    this.upload = { addEventListener: (type, handler) => this.uploadHandlers.set(type, handler) };
  }

  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader(name, value) { this.headers[name] = value; }
  addEventListener(type, handler) { this.handlers.set(type, handler); }
  send(file) {
    this.uploadHandlers.get('progress')?.({ lengthComputable: true, loaded: file.size / 2, total: file.size });
    this.status = 201;
    this.responseText = JSON.stringify({ ok: true, image: { image_url: '/content-uploads/test.png' } });
    this.handlers.get('load')?.();
  }
}

globalThis.XMLHttpRequest = FakeRequest;
const samples = [];
const payload = await uploadImageRequest({
  url: '/api/test-image', method: 'POST', file: { size: 200 },
  headers: { 'Content-Type': 'image/png' }, onProgress: ({ percent }) => samples.push(percent),
});

assert.equal(payload.image.image_url, '/content-uploads/test.png');
assert.deepEqual(samples, [50, 100]);
console.log('图片上传字节进度回调测试：通过');
