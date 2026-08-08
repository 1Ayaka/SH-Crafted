import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const base = process.argv.find((arg) => arg.startsWith('--base='))?.slice(7) || 'http://127.0.0.1:7100';
const edge = process.env['PROGRAMFILES(X86)']
  ? path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tanwuzhi-map-ui-'));
const screenshots = {
  center: path.join(os.tmpdir(), 'tanwuzhi-map-center.png'),
  passport: path.join(os.tmpdir(), 'tanwuzhi-passport.png'),
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

const port = await freePort();
const browser = spawn(edge, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore', windowsHide: true });

let ws;
try {
  let target;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
      target = targets.find((item) => item.type === 'page');
      if (target) break;
    } catch { /* Edge is starting. */ }
    await wait(250);
  }
  if (!target) throw new Error('无法连接无头浏览器');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id || !pending.has(message.id)) return;
    const task = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(task.timer);
    if (message.error) task.reject(new Error(message.error.message));
    else task.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 超时`)); }, 30000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || '页面脚本执行失败');
    return result.result.value;
  };
  const until = async (expression, timeout = 30000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await evaluate(expression)) return;
      await wait(200);
    }
    throw new Error(`等待页面状态超时：${expression}`);
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/#/explore` });
  await until("document.querySelector('.map3d-canvas') && !document.querySelector('.map3d-loading')", 45000);

  const nav = await evaluate(`(() => ({
    labels: [...document.querySelectorAll('.topnav nav a')].map((node) => node.textContent.trim()),
    adminVisible: Boolean(document.querySelector('.admin-entry-link, .admin-mode-link')),
  }))()`);
  const mapToolbarTop = await evaluate("document.querySelector('.toolbar').getBoundingClientRect().top");

  await evaluate(`(() => {
    const input = document.querySelector('.toolbar input[type="search"]');
    input.value = '嘉定竹刻'; input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await until("!document.querySelector('.map-search-results').hidden");
  const search = await evaluate(`(() => ({
    text: document.querySelector('.map-search-results').textContent,
    visible: !document.querySelector('.map-search-results').hidden,
  }))()`);

  await evaluate("[...document.querySelectorAll('.seg button')].find((node) => node.textContent.includes('列表')).click()");
  await until("document.querySelector('.craft-list') && getComputedStyle(document.querySelector('.craft-list')).display !== 'none'");
  const listToolbarTop = await evaluate("document.querySelector('.toolbar').getBoundingClientRect().top");
  const listHasMatch = await evaluate("document.querySelector('.craft-list').textContent.includes('嘉定竹刻')");

  await evaluate("[...document.querySelectorAll('.seg button')].find((node) => node.textContent.includes('地图')).click()");
  await evaluate(`(() => {
    const input = document.querySelector('.toolbar input[type="search"]');
    input.value = '黄浦区'; input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await until("[...document.querySelectorAll('.map-search-result')].some((node) => node.textContent.includes('上海中心城区'))");
  await evaluate("[...document.querySelectorAll('.map-search-result')].find((node) => node.textContent.includes('上海中心城区')).click()");
  await until("document.querySelector('.district-story h2')?.textContent.includes('上海中心城区')");
  const center = await evaluate(`(() => ({
    heading: document.querySelector('.district-story h2')?.textContent,
    text: document.querySelector('.district-story')?.textContent,
    collapsedSections: [...document.querySelectorAll('.district-story details')].every((node) => !node.open),
    backBelowHeading: Boolean(document.querySelector('.district-story-heading + .district-story-back')),
  }))()`);
  const centerShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(screenshots.center, Buffer.from(centerShot.data, 'base64'));
  await evaluate("[...document.querySelectorAll('.map-zoom-controls button')].find((node) => node.textContent.includes('还原')).click()");
  await until("!document.querySelector('.district-story') && !document.querySelector('.map-view.is-district-focus')");
  const reset = await evaluate("!document.querySelector('.district-story') && !document.querySelector('.map-view.is-district-focus')");

  await send('Page.navigate', { url: `${base}/#/passport` });
  await until("document.querySelector('.passport tbody')", 45000);
  const passport = await evaluate(`(() => ({
    heading: document.querySelector('.passport h2')?.textContent,
    rows: document.querySelectorAll('.passport tbody tr').length,
    bodyText: document.querySelector('.passport').textContent,
  }))()`);
  const passportShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(screenshots.passport, Buffer.from(passportShot.data, 'base64'));
  await send('Page.navigate', { url: `${base}/#/` });
  await until("document.querySelector('.home .topnav')");
  const homeNav = await evaluate("[...document.querySelectorAll('.topnav nav a')].map((node) => node.textContent.trim())");

  const result = {
    nav,
    homeNav,
    search: { visible: search.visible, hasCraft: search.text.includes('嘉定竹刻') },
    toolbarTop: { map: mapToolbarTop, list: listToolbarTop },
    toolbarShift: Math.abs(listToolbarTop - mapToolbarTop),
    listHasMatch,
    center: {
      heading: center.heading,
      listsFiveDistricts: ['黄浦', '徐汇', '长宁', '静安', '普陀'].every((name) => center.text.includes(name)),
      collapsedSections: center.collapsedSections,
      backBelowHeading: center.backBelowHeading,
    },
    reset,
    passport: { heading: passport.heading, rows: passport.rows },
    screenshots,
  };
  const errors = [];
  if (nav.labels.join('|') !== '地图探索|知识星图|数据护照') errors.push('地图页公开导航顺序不正确');
  if (homeNav.join('|') !== '地图探索|工艺互动|知识星图|数据护照') errors.push('首页公开导航顺序不正确');
  if (nav.adminVisible) errors.push('公开导航仍显示管理入口');
  if (!result.search.visible || !result.search.hasCraft || !listHasMatch) errors.push('地图或列表搜索不可用');
  if (result.toolbarShift > 3) errors.push(`地图/列表切换时工具条位移 ${result.toolbarShift}px`);
  if (center.heading !== '上海中心城区' || !result.center.listsFiveDistricts) errors.push('中心城区五区聚合不完整');
  if (!center.collapsedSections || !center.backBelowHeading) errors.push('地区面板折叠或返回按钮布局不正确');
  if (!reset) errors.push('地图还原未退出地区聚焦');
  if (passport.heading !== '数据护照' || passport.rows < 1) errors.push('数据护照未正常打开');
  console.log(JSON.stringify({ ...result, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* noop */ }
  browser.kill();
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }); } catch { /* Edge may still own its profile briefly. */ }
}
