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
  mobile: path.join(os.tmpdir(), 'sh-crafted-admin-mobile.png'),
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
  '--headless=new', '--disable-gpu', '--no-sandbox', '--window-size=1440,1000',
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
    loggedIn: document.documentElement.classList.contains('admin-authenticated'),
    bulkToolbar: Boolean(document.querySelector('.admin-bulk-toolbar')),
    protectedChecks: document.querySelectorAll('.admin-craft-select input:disabled').length,
    deletableChecks: document.querySelectorAll('.admin-craft-select input:not(:disabled)').length,
    deleteDisabled: Boolean(document.querySelector('.admin-danger-button')?.disabled),
    brandPanel: Boolean(document.querySelector('.admin-brand-panel')),
    brandInput: document.querySelector('.admin-brand-file-input')?.getAttribute('accept') || '',
    brandCurrentLoaded: (document.querySelector('.admin-brand-preview img[data-brand-logo]')?.naturalWidth || 0) > 0,
    brandSaveDisabled: Boolean(document.querySelector('.admin-brand-panel .btn-primary')?.disabled),
    brandPreviewCount: document.querySelectorAll('.admin-brand-preview').length,
    brandDrop: Boolean(document.querySelector('.admin-brand-panel .admin-image-drop[role="button"]')),
    brandProgress: Boolean(document.querySelector('.admin-brand-panel .image-upload-progress progress')),
    projectSearch: Boolean(document.querySelector('.admin-project-search input[type="search"]')),
    maintenanceTools: Boolean(document.querySelector('.admin-maintenance-tools')),
    reviewChecked: Boolean(document.querySelector('.admin-review-toggle input')?.checked)
  })`);
  await screenshot(screenshots.dashboard);

  await navigate(`${base}/#/admin/craft/SHIH_0001`, `Boolean(document.querySelector('.admin-step-editor'))`);
  const process = await evaluate(`({
    contentEditor: Boolean(document.querySelector('.admin-content-editor')),
    contentFields: document.querySelectorAll('.admin-content-editor input, .admin-content-editor textarea').length,
    claimRows: document.querySelectorAll('.admin-claim-row').length,
    claimDeleteButtons: document.querySelectorAll('.admin-claim-row .admin-icon-button').length,
    contentSaveButton: Boolean([...document.querySelectorAll('.admin-content-editor button')].find((button) => button.textContent.includes('保存正文'))),
    tabs: document.querySelectorAll('.admin-step-tab').length,
    addStep: Boolean(document.querySelector('.admin-step-add')),
    materialInputs: document.querySelectorAll('.admin-resource-columns input').length,
    materialOutputInputs: document.querySelectorAll('input[aria-label$="完成后变为"]').length,
    operationInputs: document.querySelectorAll('.admin-operation-row > input').length,
    guideEditor: Boolean(document.querySelector('.admin-guide-editor[contenteditable="true"]')),
    stepImageInput: Boolean(document.querySelector('.admin-step-image-input[accept*="image/png"]')),
    stepImageEmpty: Boolean(document.querySelector('.admin-step-image-empty')),
    maintenanceLayout: Boolean(document.querySelector('.admin-maintenance-layout .admin-maintenance-nav')),
    coverUpload: Boolean(document.querySelector('.admin-cover-editor input[type="file"]') && document.querySelector('.admin-cover-editor .image-upload-progress progress')),
    graphImageUploads: document.querySelectorAll('.admin-graph-editor .admin-image-drop input[type="file"]').length,
    stepImageProgress: Boolean(document.querySelector('.admin-step-image-editor .image-upload-progress progress')),
    documentaryUpload: Boolean(document.querySelector('.admin-documentary-editor .admin-image-drop input[type="file"]')),
    visualRows: document.querySelectorAll('.admin-visual-row').length,
    shapeOptions: document.querySelector('.admin-visual-row select')?.options.length || 0,
    saveButton: Boolean([...document.querySelectorAll('button')].find((button) => button.textContent.includes('保存全部工序')))
  })`);
  await evaluate(`document.querySelectorAll('.admin-step-tab')[1]?.click()`);
  await wait(120);
  const materialFlow = await evaluate(`({
    inheritedRows: document.querySelectorAll('.admin-material-transform-row.is-inherited').length,
    flowHelp: document.querySelector('.admin-material-flow-help')?.textContent || '',
    removeButton: [...document.querySelectorAll('.admin-material-toggle')].some((button) => button.textContent.includes('移出本步')),
    heldOrUsable: [...document.querySelectorAll('.admin-material-toggle')].some((button) => button.textContent.includes('本步使用'))
      || document.querySelectorAll('.admin-material-transform-row.is-inherited').length > 0
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

  await navigate(`${base}/#/craft/SHIH_0001`, `Boolean(document.querySelector('.craft-page'))`);
  const reviewedPage = await evaluate(`({
    draftDisclaimer: document.body.textContent.includes('summary_candidate') || document.body.textContent.includes('人工审核尚未完成'),
    pendingTags: [...document.querySelectorAll('.tag-pending')].filter((node) => /类别待核对|地区待核对/.test(node.textContent)).length,
    autoExtractHeading: [...document.querySelectorAll('.craft-page h5')].some((node) => node.textContent.includes('自动抽取'))
  })`);

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

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await navigate(`${base}/#/admin/craft/SHIH_0001`, `Boolean(document.querySelector('.admin-maintenance-layout'))`);
  const mobile = await evaluate(`(() => {
    const drops = [...document.querySelectorAll('.admin-image-drop')];
    const layout = document.querySelector('.admin-maintenance-layout');
    const nav = document.querySelector('.admin-maintenance-nav');
    return {
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      layoutColumns: layout ? getComputedStyle(layout).gridTemplateColumns : '',
      navPosition: nav ? getComputedStyle(nav).position : '',
      minDropHeight: drops.length ? Math.min(...drops.map((node) => node.getBoundingClientRect().height)) : 0,
      dropCount: drops.length,
      visitorOverlaysHidden: ['.agent-fab', '.agent-panel', '.mascot-bubble', '.gesture-toggle'].every((selector) => {
        const node = document.querySelector(selector); return !node || getComputedStyle(node).display === 'none';
      }),
    };
  })()`);
  await screenshot(screenshots.mobile);

  const errors = [];
  if (!dashboard.loggedIn || dashboard.cards !== 8) errors.push('管理员首页未显示 8 个项目');
  if (!dashboard.bulkToolbar || dashboard.protectedChecks < 8 || !dashboard.deleteDisabled) errors.push('批量删除工具条或原始 8 项删除保护未显示');
  if (!dashboard.brandPanel || dashboard.brandInput !== 'image/png' || !dashboard.brandCurrentLoaded || !dashboard.brandSaveDisabled || dashboard.brandPreviewCount !== 2 || !dashboard.brandDrop || !dashboard.brandProgress) errors.push('管理员 Logo 拖放、上传进度、保存或双预览模块不完整');
  if (!dashboard.projectSearch || !dashboard.maintenanceTools) errors.push('管理员项目搜索或低频维护工具分组缺失');
  if (!process.tabs || !process.addStep || !process.materialInputs || !process.materialOutputInputs || !process.operationInputs || !process.saveButton) errors.push('工序编辑器控件不完整或缺少逐材料升级映射');
  if (!process.contentEditor || process.contentFields < 3 || !process.claimRows || process.claimDeleteButtons !== process.claimRows || !process.contentSaveButton) errors.push('项目正文或事实陈述的编辑、删除、保存链路不完整');
  if (dashboard.reviewChecked && (reviewedPage.draftDisclaimer || reviewedPage.pendingTags || reviewedPage.autoExtractHeading)) errors.push('全库审核后项目页仍显示 AI 草稿、自动抽取或待核对标记');
  if (!process.maintenanceLayout || !process.coverUpload || !process.graphImageUploads || !process.stepImageInput || !process.stepImageProgress || !process.stepImageEmpty || !process.documentaryUpload) errors.push('项目维护导航、封面、星图、关键帧或步骤图片上传进度链路不完整');
  if (!materialFlow.inheritedRows || !materialFlow.flowHelp || !materialFlow.removeButton || !materialFlow.heldOrUsable) errors.push('继承材料缺少本步使用/移出暂存控制');
  if (verifyWrite && !savePersisted) errors.push('逐材料升级映射点击保存后没有从服务器持久化读回');
  if (verifyWrite && !autoSavePersisted) errors.push('逐材料升级映射停止输入后没有自动保存并重新显示');
  if (verifyWrite && !returnSavePersisted) errors.push('点击返回项目列表时没有先保存逐材料升级映射');
  if (inline.editButtons < 2 || inline.managementLink || !inline.editActivated) errors.push('主界面管理入口隐藏或管理员原位编辑状态不符合要求');
  if (mobile.horizontalOverflow > 2 || mobile.layoutColumns.split(' ').length > 1 || mobile.navPosition === 'sticky' || !mobile.dropCount || mobile.minDropHeight < 44 || !mobile.visitorOverlaysHidden) errors.push('管理员维护页窄屏布局、导航、访客悬浮层或图片上传触控区域不合格');
  console.log(JSON.stringify({ dashboard, process, materialFlow, reviewedPage, savePersisted, autoSavePersisted, returnSavePersisted, inline, mobile, screenshots, errors }, null, 2));
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
