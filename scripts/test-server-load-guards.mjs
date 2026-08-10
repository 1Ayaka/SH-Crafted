import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const tempRoot = await mkdtemp(join(tmpdir(), 'sh-crafted-load-'));
const port = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const selected = probe.address().port;
    probe.close(() => resolve(selected));
  });
});
const base = `http://127.0.0.1:${port}`;
const communityPath = join(tempRoot, 'community.json');
const childEnv = {
  ...process.env,
  PORT: String(port),
  HOST: '127.0.0.1',
  CONTENT_STORE_PATH: join(tempRoot, 'content.json'),
  COMMUNITY_STORE_PATH: communityPath,
  CONTENT_DB_PATH: join(tempRoot, 'content.db'),
  CONTENT_UPLOAD_DIR: join(tempRoot, 'uploads'),
  IMAGE_UPLOAD_MAX_CONCURRENCY: '3',
};

const percentile = (values, fraction) => values.slice().sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))] || 0;

let child;
async function startServer() {
  child = spawn(process.execPath, ['server.mjs'], { cwd: process.cwd(), env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`server_exited_${child.exitCode}`);
    try { if ((await fetch(`${base}/api/content`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error('server_start_timeout');
}

async function stopServer() {
  if (!child || child.exitCode != null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}

function slowImageRequest(index) {
  let request;
  const response = new Promise((resolve, reject) => {
    request = http.request({
      hostname: '127.0.0.1', port, method: 'POST', path: '/api/community/images',
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(1024 * 1024),
        'X-File-Name': encodeURIComponent(`slow-${index}.png`),
      },
    }, (incoming) => {
      const chunks = [];
      incoming.on('data', (chunk) => chunks.push(chunk));
      incoming.on('end', () => resolve({
        status: incoming.statusCode,
        retryAfter: incoming.headers['retry-after'],
        body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'),
      }));
    });
    request.on('error', reject);
    request.write(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });
  return { request, response };
}

try {
  await writeFile(communityPath, JSON.stringify({
    version: 1, engagement: {},
    submissions: Array.from({ length: 2_000 }, (_, index) => ({ id: `LOAD_${index}`, status: 'approved', title: `压力记录 ${index}` })),
  }));
  await startServer();
  const slow = Array.from({ length: 12 }, (_, index) => slowImageRequest(index));
  const settledEarly = [];
  slow.forEach(({ response }, index) => response.then((value) => settledEarly.push({ index, value })));
  const deadline = Date.now() + 3000;
  while (settledEarly.length < 9 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(settledEarly.length, 9, '并发上限为3时，12个慢请求应有9个在读取完整正文前被拒绝');
  assert.ok(settledEarly.every(({ value }) => value.status === 503 && value.retryAfter === '3' && value.body.error === 'image_upload_busy'));

  const padding = Buffer.alloc(1024 * 1024 - 8);
  slow.forEach(({ request }) => { if (!request.writableEnded) request.end(padding); });
  const uploadResults = await Promise.all(slow.map(({ response }) => response));
  assert.equal(uploadResults.filter(({ status }) => status === 201).length, 3, '活动上传数不得超过配置上限');
  assert.equal(uploadResults.filter(({ status }) => status === 503).length, 9);

  const views = await Promise.all(Array.from({ length: 50 }, async () => {
    const started = performance.now();
    const value = await fetch(`${base}/api/community/crafts/SHIH_0001/view`, { method: 'POST' }).then((response) => response.json());
    return { value, elapsed: performance.now() - started };
  }));
  assert.equal(Math.max(...views.map(({ value }) => value.view_count)), 50, '50个并发浏览计数不得丢失');
  const viewP95 = percentile(views.map(({ elapsed }) => elapsed), 0.95);
  assert.ok(viewP95 < 800, `2000条投稿下浏览计数p95过高：${viewP95.toFixed(1)}ms`);
  const inherits = await Promise.all(Array.from({ length: 50 }, async (_, index) => {
    const started = performance.now();
    const value = await fetch(`${base}/api/community/crafts/SHIH_0001/inherit`, {
      method: 'POST', headers: { Cookie: `sh_visitor=visitor_token_${String(index).padStart(3, '0')}_abcdefghijk` },
    }).then((response) => response.json());
    return { value, elapsed: performance.now() - started };
  }));
  assert.equal(new Set(inherits.map(({ value }) => value.visitor_ordinal)).size, 50, '50个并发传承人序号不得重复或丢失');
  const inheritP95 = percentile(inherits.map(({ elapsed }) => elapsed), 0.95);
  assert.ok(inheritP95 < 800, `2000条投稿下传承计数p95过高：${inheritP95.toFixed(1)}ms`);

  await stopServer();
  await startServer();
  const persisted = await fetch(`${base}/api/community/stats`, { headers: { Cookie: 'sh_visitor=visitor_token_000_abcdefghijk' } }).then((response) => response.json());
  assert.equal(persisted.crafts.SHIH_0001.view_count, 50, '浏览计数必须持久化');
  assert.equal(persisted.crafts.SHIH_0001.inheritor_count, 50, '传承人计数必须持久化');

  console.log(JSON.stringify({ upload_concurrency_limit: 3, accepted_uploads: 3, busy_responses: 9, seeded_submissions: 2_000, concurrent_views: 50, view_p95_ms: Number(viewP95.toFixed(1)), concurrent_inheritors: 50, inherit_p95_ms: Number(inheritP95.toFixed(1)) }, null, 2));
} finally {
  await stopServer();
  await rm(tempRoot, { recursive: true, force: true });
}
