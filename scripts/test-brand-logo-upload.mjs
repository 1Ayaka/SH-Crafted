import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const workspace = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, '$1'));
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-crafted-brand-logo-'));
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
  PORT: String(port), HOST: '127.0.0.1',
  ADMIN_USERNAME: 'brand-admin', ADMIN_PASSWORD: 'brand-password',
  CONTENT_DB_PATH: path.join(temporaryRoot, 'content.db'),
  CONTENT_STORE_PATH: path.join(temporaryRoot, 'legacy-content.json'),
  COMMUNITY_STORE_PATH: path.join(temporaryRoot, 'legacy-community.json'),
  CONTENT_UPLOAD_DIR: uploadDirectory,
};

async function startServer() {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: workspace, env: environment, stdio: 'ignore', windowsHide: true });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`测试服务器提前退出：${child.exitCode}`);
    try { if ((await fetch(`${base}/brand/logo.png`)).ok) return child; } catch { /* starting */ }
    await wait(100);
  }
  child.kill();
  throw new Error('测试服务器启动超时');
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), wait(3000)]);
}

let server;
try {
  const defaultLogo = fs.readFileSync(path.join(workspace, 'assets', 'brand', 'tanwuzhi-logo.png'));
  const replacementLogo = fs.readFileSync(path.join(workspace, 'assets', '地图,图钉,标记,标点.png'));
  server = await startServer();
  const fallback = await fetch(`${base}/brand/logo.png`);
  assert.equal(fallback.status, 200);
  assert.deepEqual(Buffer.from(await fallback.arrayBuffer()), defaultLogo);

  const unauthenticated = await fetch(`${base}/api/admin/brand/logo`, {
    method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: replacementLogo,
  });
  assert.equal(unauthenticated.status, 401);

  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'brand-admin', password: 'brand-password' }),
  });
  assert.equal(login.status, 200);
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0];
  const initialState = await fetch(`${base}/api/admin/brand/logo`, { headers: { Cookie: cookie } }).then((response) => response.json());
  assert.equal(initialState.uploaded, false);

  const unsupported = await fetch(`${base}/api/admin/brand/logo`, {
    method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'image/jpeg' }, body: replacementLogo,
  });
  assert.equal(unsupported.status, 415);

  const upload = await fetch(`${base}/api/admin/brand/logo`, {
    method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'image/png' }, body: replacementLogo,
  });
  assert.equal(upload.status, 200);
  const uploaded = await upload.json();
  assert.equal(uploaded.uploaded, true);
  assert.equal(uploaded.logo_url, '/brand/logo.png');
  assert.ok(uploaded.version);
  const served = await fetch(`${base}/brand/logo.png?v=${encodeURIComponent(uploaded.version)}`);
  assert.equal(served.headers.get('content-type'), 'image/png');
  assert.match(served.headers.get('cache-control') || '', /no-store/);
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), replacementLogo);

  await stopServer(server);
  server = await startServer();
  assert.deepEqual(Buffer.from(await (await fetch(`${base}/brand/logo.png`)).arrayBuffer()), replacementLogo);
  console.log('全站 Logo：默认回退、管理员鉴权上传、公开读取与重启持久化测试通过');
} finally {
  await stopServer(server);
  const resolved = path.resolve(temporaryRoot);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
