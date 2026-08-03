import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1))), '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'sh-crafted-community-'));
const contentStore = path.join(temporary, 'content.json');
const communityStore = path.join(temporary, 'community.json');
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
let server;

function startServer() {
  return spawn(process.execPath, ['server.mjs', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: root,
    env: { ...process.env, CONTENT_STORE_PATH: contentStore, COMMUNITY_STORE_PATH: communityStore },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${base}/`);
      if (response.ok) return;
    } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('community smoke server did not start');
}

function cookieFrom(response, name) {
  const raw = response.headers.get('set-cookie') || '';
  return raw.split(';')[0].startsWith(`${name}=`) ? raw.split(';')[0] : '';
}

async function json(pathname, { method = 'GET', body, cookie = '' } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      Origin: base,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${pathname}: ${response.status} ${payload.error || ''}`);
  return { response, payload };
}

try {
  server = startServer();
  await waitForServer();

  const stats = await json('/api/community/stats');
  const visitorA = cookieFrom(stats.response, 'sh_visitor');
  if (!visitorA) throw new Error('visitor cookie was not issued');
  const view1 = await json('/api/community/crafts/SHIH_0001/view', { method: 'POST', cookie: visitorA });
  const view2 = await json('/api/community/crafts/SHIH_0001/view', { method: 'POST', cookie: visitorA });
  if (view1.payload.view_count !== 1 || view2.payload.view_count !== 2) throw new Error('view counter is not monotonic');
  const inherit1 = await json('/api/community/crafts/SHIH_0001/inherit', { method: 'POST', cookie: visitorA });
  const inheritAgain = await json('/api/community/crafts/SHIH_0001/inherit', { method: 'POST', cookie: visitorA });
  if (inherit1.payload.visitor_ordinal !== 1 || inheritAgain.payload.inheritor_count !== 1) throw new Error('same visitor was counted twice');

  const visitorBStats = await json('/api/community/stats');
  const visitorB = cookieFrom(visitorBStats.response, 'sh_visitor');
  const inherit2 = await json('/api/community/crafts/SHIH_0001/inherit', { method: 'POST', cookie: visitorB });
  if (inherit2.payload.visitor_ordinal !== 2 || inherit2.payload.inheritor_count !== 2) throw new Error('second visitor ordinal is incorrect');

  const submission = await json('/api/community/submissions', {
    method: 'POST',
    cookie: visitorA,
    body: {
      kind: 'full', district_id: 'jiading', title: '社区测试条目', category: '传统技艺',
      summary: '这是一条用于验证社区投稿审核与正式发布链路的测试内容。',
      history: '测试历史说明。', features: '测试特色说明。', include_steps: true,
      steps: [{ name: '准备材料', description: '整理并检查材料。', result: '得到已整理材料', materials: ['材料甲'], tools: ['工具甲'], actions: ['整理'] }],
      gallery_urls: [], contributor_name: '测试投稿人', contributor_contact: 'test@example.invalid', website: '',
    },
  });
  const submissionId = submission.payload.submission_id;
  if (!submissionId) throw new Error('submission id missing');

  for (let attempt = 1; attempt <= 50; attempt++) {
    const response = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: {
        Origin: base,
        'X-Forwarded-For': '198.51.100.50',
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ username: 'djt', password: 'wrong-password' }),
    });
    const payload = await response.json();
    if (attempt < 50 && (response.status !== 401 || payload.attempts_remaining !== 50 - attempt)) {
      throw new Error(`login attempt ${attempt} did not report the expected remaining count`);
    }
    if (attempt === 50 && (response.status !== 429 || payload.error !== 'too_many_attempts')) {
      throw new Error('the 50th failed login did not trigger rate limiting');
    }
  }

  const login = await json('/api/admin/login', { method: 'POST', body: { username: 'djt', password: '12345689' } });
  const adminCookie = cookieFrom(login.response, 'sh_admin');
  if (!adminCookie || /;\s*Secure/i.test(login.response.headers.get('set-cookie') || '')) throw new Error('HTTP admin cookie flags are incorrect');
  const authenticatedSession = await json('/api/admin/session', { cookie: adminCookie });
  if (!authenticatedSession.payload.authenticated) throw new Error('admin session cookie did not survive the login round trip');
  const pending = await json('/api/admin/submissions?status=pending', { cookie: adminCookie });
  if (!pending.payload.submissions.some((item) => item.id === submissionId)) throw new Error('pending submission is absent');
  const approved = await json(`/api/admin/submissions/${submissionId}/review`, {
    method: 'PUT', cookie: adminCookie,
    body: { action: 'approve', reviewer_note: '自动化测试通过', revision: pending.payload.revision },
  });
  const craftId = approved.payload.published_craft_id;
  const content = await json('/api/content');
  if (!content.payload.crafts.some((craft) => craft.id === craftId)) throw new Error('approved craft was not published');
  if (!content.payload.craft_steps.some((step) => step.craft_id === craftId)) throw new Error('approved steps were not published');
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, options) => nativeFetch(
    typeof input === 'string' && !/^[a-z]+:/i.test(input) ? new URL(input, `${base}/`).href : input,
    options,
  );
  try {
    const dataModule = await import(`../js/data.js?community-smoke=${Date.now()}`);
    await dataModule.loadAll();
    const loadedCraft = dataModule.getCraft(craftId);
    if (!loadedCraft?.config.community || loadedCraft.steps.length !== 1) throw new Error('frontend data adapter did not load approved craft');
  } finally {
    globalThis.fetch = nativeFetch;
  }

  const rejectedSubmission = await json('/api/community/submissions', {
    method: 'POST',
    cookie: visitorA,
    body: {
      kind: 'note', district_id: 'pudong', title: '待驳回测试条目',
      summary: '这是一条用来验证驳回后不会进入正式内容库的自动化测试内容。',
      include_steps: false, gallery_urls: [], website: '',
    },
  });
  const pendingForRejection = await json('/api/admin/submissions?status=pending', { cookie: adminCookie });
  await json(`/api/admin/submissions/${rejectedSubmission.payload.submission_id}/review`, {
    method: 'PUT', cookie: adminCookie,
    body: { action: 'reject', reviewer_note: '自动化测试驳回', revision: pendingForRejection.payload.revision },
  });
  const afterRejection = await json('/api/content');
  const rejectedCraftId = `COMM_${rejectedSubmission.payload.submission_id.replace(/^SUB_/, '')}`;
  if (afterRejection.payload.crafts.some((craft) => craft.id === rejectedCraftId)) throw new Error('rejected submission was published');

  server.kill();
  await new Promise((resolve) => server.once('exit', resolve));
  server = startServer();
  await waitForServer();
  const persisted = await json('/api/community/stats', { cookie: visitorA });
  const finalStats = persisted.payload.crafts['SHIH_0001'];
  if (!finalStats || finalStats.inheritor_count !== 2 || finalStats.visitor_ordinal !== 1) throw new Error('engagement did not persist after restart');
  const persistedContent = await json('/api/content');
  if (!persistedContent.payload.crafts.some((craft) => craft.id === craftId)) throw new Error('published content did not persist after restart');
  console.log(`社区 API 冒烟测试通过：${craftId}`);
} finally {
  if (server && !server.killed) server.kill();
  await rm(temporary, { recursive: true, force: true });
}
