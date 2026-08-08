import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'tanwuzhi-center-edit-'));
const contentStore = path.join(tempDir, 'content.json');
const communityStore = path.join(tempDir, 'community.json');
const dbPath = path.join(tempDir, 'content.db');

const freePort = () => new Promise((resolve, reject) => {
  const socket = net.createServer();
  socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => {
    const { port } = socket.address();
    socket.close(() => resolve(port));
  });
});

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server.mjs', '--host', '127.0.0.1', '--port', String(port)], {
  cwd: path.resolve(import.meta.dirname, '..'),
  env: {
    ...process.env,
    CONTENT_STORE_PATH: contentStore,
    COMMUNITY_STORE_PATH: communityStore,
    CONTENT_DB_PATH: dbPath,
    ADMIN_USERNAME: 'center-test',
    ADMIN_PASSWORD: 'center-test-password',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const waitForServer = async () => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/content`);
      if (response.ok) return;
    } catch { /* Server is starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('测试服务器启动超时');
};

try {
  await waitForServer();
  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'center-test', password: 'center-test-password' }),
  });
  if (!login.ok) throw new Error(`管理员登录失败：${login.status}`);
  const cookie = login.headers.get('set-cookie')?.split(';')[0] || '';
  const session = await login.json();
  const customName = '上海五区文化中心';
  const saved = await fetch(`${base}/api/admin/site-texts`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      revision: session.revision,
      updates: [{ key: 'map.center.name', content: customName }],
    }),
  });
  if (!saved.ok) throw new Error(`中心城区名称保存失败：${saved.status} ${await saved.text()}`);

  const publicContent = await fetch(`${base}/api/content`).then((response) => response.json());
  const persistedName = publicContent.site_texts.find((item) => item.key === 'map.center.name')?.content;
  if (persistedName !== customName) throw new Error(`公开内容未读取保存值：${persistedName || '<empty>'}`);

  for (const key of ['map.center.origin', 'map.center.features', 'map.center.heritage_overview']) {
    if (!publicContent.site_texts.some((item) => item.key === key && item.content)) {
      throw new Error(`旧内容库补全字段失败：${key}`);
    }
  }

  console.log(JSON.stringify({ centerNamePersisted: true, missingFieldsBackfilled: true }, null, 2));
} finally {
  server.kill('SIGTERM');
  await new Promise((resolve) => server.once('exit', resolve));
  await rm(tempDir, { recursive: true, force: true });
}
