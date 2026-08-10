import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const workspace = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, '$1'));
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-crafted-step-image-'));
const databasePath = path.join(temporaryRoot, 'content.db');
const uploadDirectory = path.join(temporaryRoot, 'uploads');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.on('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const environment = {
  ...process.env,
  PORT: String(port),
  HOST: '127.0.0.1',
  ADMIN_USERNAME: 'step-image-admin',
  ADMIN_PASSWORD: 'step-image-password',
  CONTENT_DB_PATH: databasePath,
  CONTENT_STORE_PATH: path.join(temporaryRoot, 'legacy-content.json'),
  COMMUNITY_STORE_PATH: path.join(temporaryRoot, 'legacy-community.json'),
  CONTENT_UPLOAD_DIR: uploadDirectory,
};

async function startServer() {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: workspace, env: environment, stdio: 'ignore', windowsHide: true });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`测试服务器提前退出：${child.exitCode}`);
    try {
      const response = await fetch(`${base}/api/content`);
      if (response.ok) return child;
    } catch { /* server is starting */ }
    await wait(100);
  }
  child.kill();
  throw new Error('测试服务器启动超时');
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    wait(3000),
  ]);
}

let server;
try {
  server = await startServer();
  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'step-image-admin', password: 'step-image-password' }),
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie.startsWith('sh_admin='));

  const content = await fetch(`${base}/api/content`).then((response) => response.json());
  const craftId = 'SHIH_0001';
  const steps = content.craft_steps.filter((step) => step.craft_id === craftId).sort((a, b) => a.sort - b.sort);
  assert.ok(steps.length > 0, '测试项目没有工序');
  const stepId = steps[0].id;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const unauthenticatedCraftImage = await fetch(`${base}/api/admin/crafts/${craftId}/images`, {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png,
  });
  assert.equal(unauthenticatedCraftImage.status, 401);
  const craftImageUpload = await fetch(`${base}/api/admin/crafts/${craftId}/images`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'image/png', 'X-File-Name': encodeURIComponent('项目封面.png') },
    body: png,
  });
  assert.equal(craftImageUpload.status, 201);
  const craftImage = await craftImageUpload.json();
  assert.match(craftImage.image.image_url, /^\/content-uploads\/crafts\/SHIH_0001\//);
  assert.equal((await fetch(`${base}${craftImage.image.image_url}`)).status, 200);
  const coverSave = await fetch(`${base}/api/admin/crafts/${craftId}`, {
    method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision: session.revision, cover_path: craftImage.image.image_url }),
  });
  assert.equal(coverSave.status, 200);
  const coverRevision = (await coverSave.json()).revision;
  const unauthenticated = await fetch(`${base}/api/admin/crafts/${craftId}/steps/${stepId}/image`, {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png,
  });
  assert.equal(unauthenticated.status, 401);
  const unsupported = await fetch(`${base}/api/admin/crafts/${craftId}/steps/${stepId}/image`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'image/gif' }, body: png,
  });
  assert.equal(unsupported.status, 415);
  const upload = await fetch(`${base}/api/admin/crafts/${craftId}/steps/${stepId}/image`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'image/png', 'X-File-Name': encodeURIComponent('步骤截图.png') },
    body: png,
  });
  assert.equal(upload.status, 201);
  const uploaded = await upload.json();
  assert.match(uploaded.image.image_url, /^\/content-uploads\/steps\/SHIH_0001\//);
  assert.equal(uploaded.image.original_name, '步骤截图.png');

  const served = await fetch(`${base}${uploaded.image.image_url}`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), png);

  steps[0] = { ...steps[0], step_image: { ...uploaded.image, alt: '工序参考图' } };
  const saved = await fetch(`${base}/api/admin/crafts/${craftId}/steps`, {
    method: 'PUT',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision: coverRevision, steps }),
  });
  assert.equal(saved.status, 200);
  const savedPayload = await saved.json();
  assert.ok(savedPayload.revision);
  const persisted = await fetch(`${base}/api/content`).then((response) => response.json());
  const persistedStep = persisted.craft_steps.find((step) => step.craft_id === craftId && step.id === stepId);
  assert.equal(persistedStep.step_image.image_url, uploaded.image.image_url);
  assert.equal(persistedStep.step_image.alt, '工序参考图');
  assert.equal(persisted.crafts.find((craft) => craft.id === craftId)?.cover_path, craftImage.image.image_url);

  await stopServer(server);
  server = await startServer();
  const afterRestart = await fetch(`${base}/api/content`).then((response) => response.json());
  assert.equal(afterRestart.craft_steps.find((step) => step.craft_id === craftId && step.id === stepId)?.step_image?.image_url, uploaded.image.image_url);
  assert.equal((await fetch(`${base}${uploaded.image.image_url}`)).status, 200);
  assert.equal(afterRestart.crafts.find((craft) => craft.id === craftId)?.cover_path, craftImage.image.image_url);
  assert.equal((await fetch(`${base}${craftImage.image.image_url}`)).status, 200);
  console.log('项目图片与步骤图片上传、保存、公开读取及重启持久化测试：通过');
} finally {
  await stopServer(server);
  const resolved = path.resolve(temporaryRoot);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
