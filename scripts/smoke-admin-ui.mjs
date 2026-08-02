import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const base = process.argv.find((arg) => arg.startsWith('--base='))?.slice(7) || 'http://127.0.0.1:7100';
const username = process.env.ADMIN_SMOKE_USERNAME || 'djt';
const password = process.env.ADMIN_SMOKE_PASSWORD || '12345689';
const verifyWrite = process.env.ADMIN_SMOKE_WRITE_TEST === 'true';
const edge = path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-crafted-admin-ui-'));
const screenshots = {
  dashboard: path.join(os.tmpdir(), 'sh-crafted-admin-dashboard.png'),
  process: path.join(os.tmpdir(), 'sh-crafted-admin-process.png'),
  inline: path.join(os.tmpdir(), 'sh-crafted-admin-inline.png'),
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
  '--headless', '--disable-gpu', '--window-size=1440,1000',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true });
let socket;
let sequence = 0;
const pending = new Map();

try {
  let target;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      target = (await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json())).find((item) => item.type === 'page');
      if (target) break;
    } catch (_) { /* browser is starting */ }
    await wait(200);
  }
  if (!target) throw new Error('无法连接无头浏览器。');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id || !pending.has(message.id)) return;
    const callback = pending.get(message.id);
    pending.delete(message.id);
    message.error ? callback.reject(new Error(message.error.message)) : callback.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || '页面执行失败');
    return result.result.value;
  };
  const navigate = async (url, readyExpression) => {
    await send('Page.navigate', { url });
    for (let attempt = 0; attempt < 80; attempt++) {
      await wait(250);
      if (await evaluate(readyExpression)) return;
    }
    throw new Error(`页面加载超时：${url}`);
  };
  const screenshot = async (file) => {
    const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await navigate(`${base}/#/admin/login`, `Boolean(document.querySelector('.admin-login-card input[type="password"]'))`);
  const submitted = await evaluate(`(() => {
    const user = document.querySelector('input[name="username"]');
    const pass = document.querySelector('input[name="password"]');
    const set = (input, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(user, ${JSON.stringify(username)}); set(pass, ${JSON.stringify(password)});
    document.querySelector('.admin-login-card').requestSubmit();
    return true;
  })()`);
  if (!submitted) throw new Error('登录表单提交失败。');
  for (let attempt = 0; attempt < 80; attempt++) {
    await wait(250);
    if (await evaluate(`location.hash === '#/admin' && Boolean(document.querySelector('.admin-dashboard'))`)) break;
  }
  const dashboard = await evaluate(`({
    cards: document.querySelectorAll('.admin-craft-card').length,
    title: document.querySelector('.admin-dashboard h1')?.textContent,
    loggedIn: document.documentElement.classList.contains('admin-authenticated')
  })`);
  await screenshot(screenshots.dashboard);

  await navigate(`${base}/#/admin/craft/SHIH_0001`, `Boolean(document.querySelector('.admin-step-editor'))`);
  const process = await evaluate(`({
    tabs: document.querySelectorAll('.admin-step-tab').length,
    addStep: Boolean(document.querySelector('.admin-step-add')),
    materialInputs: document.querySelectorAll('.admin-resource-columns input').length,
    materialOutputInputs: document.querySelectorAll('input[aria-label$="完成后变为"]').length,
    operationInputs: document.querySelectorAll('.admin-operation-row > input').length,
    saveButton: Boolean([...document.querySelectorAll('button')].find((button) => button.textContent.includes('保存全部工序')))
  })`);
  await screenshot(screenshots.process);
  let savePersisted = null;
  let autoSavePersisted = null;
  let returnSavePersisted = null;
  if (verifyWrite) {
    const marker = `保存测试-${Date.now()}`;
    await evaluate(`(() => {
      const input = document.querySelector('input[aria-label$="完成后变为"]');
      if (!input) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(marker)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      [...document.querySelectorAll('button')].find((button) => button.textContent.includes('保存全部工序'))?.click();
      return true;
    })()`);
    for (let attempt = 0; attempt < 60; attempt++) {
      await wait(250);
      savePersisted = await evaluate(`document.querySelector('input[aria-label$="完成后变为"]')?.value === ${JSON.stringify(marker)}`);
      if (savePersisted) break;
    }
    if (savePersisted) await wait(900);

    const autoMarker = `自动保存-${Date.now()}`;
    await evaluate(`(() => {
      const input = document.querySelector('input[aria-label$="完成后变为"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(autoMarker)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    for (let attempt = 0; attempt < 40; attempt++) {
      await wait(250);
      if (await evaluate(`document.querySelector('.admin-save-status')?.textContent.includes('已保存到服务器')`)) break;
    }
    await navigate(`${base}/#/admin/craft/SHIH_0001`, `Boolean(document.querySelector('.admin-step-editor'))`);
    autoSavePersisted = await evaluate(`document.querySelector('input[aria-label$="完成后变为"]')?.value === ${JSON.stringify(autoMarker)}`);

    const returnMarker = `返回保存-${Date.now()}`;
    await evaluate(`(() => {
      const input = document.querySelector('input[aria-label$="完成后变为"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(returnMarker)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.admin-return-link')?.click();
    })()`);
    for (let attempt = 0; attempt < 60; attempt++) {
      await wait(250);
      if (await evaluate(`location.hash === '#/admin' && Boolean(document.querySelector('.admin-dashboard'))`)) break;
    }
    await navigate(`${base}/#/admin/craft/SHIH_0001`, `Boolean(document.querySelector('.admin-step-editor'))`);
    returnSavePersisted = await evaluate(`document.querySelector('input[aria-label$="完成后变为"]')?.value === ${JSON.stringify(returnMarker)}`);
  }

  await navigate(`${base}/#/`, `Boolean(document.querySelector('.home .hero-copy'))`);
  const inline = await evaluate(`({
    editButtons: document.querySelectorAll('.admin-module-edit').length,
    managementLink: [...document.querySelectorAll('.topnav a')].some((link) => link.textContent.includes('工序管理')),
    editActivated: (() => {
      const module = document.querySelector('.hero-copy.admin-editable-module');
      module?.querySelector('.admin-module-edit')?.click();
      const active = module?.classList.contains('is-admin-editing')
        && module.querySelector('[contenteditable="true"]')
        && !module.querySelector('.admin-module-save').hidden;
      module?.querySelector('.admin-module-cancel')?.click();
      return Boolean(active);
    })()
  })`);
  await screenshot(screenshots.inline);

  const errors = [];
  if (!dashboard.loggedIn || dashboard.cards !== 8) errors.push('管理员首页未显示 8 个项目');
  if (!process.tabs || !process.addStep || !process.materialInputs || !process.materialOutputInputs || !process.operationInputs || !process.saveButton) errors.push('工序编辑器控件不完整或缺少逐材料升级映射');
  if (verifyWrite && !savePersisted) errors.push('逐材料升级映射点击保存后没有从服务器持久化读回');
  if (verifyWrite && !autoSavePersisted) errors.push('逐材料升级映射停止输入后没有自动保存并重新显示');
  if (verifyWrite && !returnSavePersisted) errors.push('点击返回项目列表时没有先保存逐材料升级映射');
  if (inline.editButtons < 2 || !inline.managementLink || !inline.editActivated) errors.push('用户页面未进入原位编辑模式');
  console.log(JSON.stringify({ dashboard, process, savePersisted, autoSavePersisted, returnSavePersisted, inline, screenshots, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  try { socket?.close(); } catch (_) { /* ignore */ }
  if (browser.exitCode === null) browser.kill();
  await wait(300);
  const resolved = path.resolve(profile);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
    try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) { /* temporary */ }
  }
}
