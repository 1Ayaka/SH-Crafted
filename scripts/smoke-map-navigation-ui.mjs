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
  overview: path.join(os.tmpdir(), 'tanwuzhi-map-markers.png'),
  center: path.join(os.tmpdir(), 'tanwuzhi-map-center.png'),
  passport: path.join(os.tmpdir(), 'tanwuzhi-passport.png'),
  home: path.join(os.tmpdir(), 'tanwuzhi-home-brand.png'),
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
    title: document.title,
    brandName: document.querySelector('.topnav .brand .name')?.textContent.trim() || '',
    brandLogo: document.querySelector('.topnav .brand-logo')?.getAttribute('src') || '',
    brandLogoLoaded: (document.querySelector('.topnav .brand-logo')?.naturalWidth || 0) > 0,
    legacySealVisible: Boolean(document.querySelector('.topnav .seal')),
    favicon: document.querySelector('link[rel="icon"]')?.getAttribute('href') || '',
  }))()`);
  const mapToolbarTop = await evaluate("document.querySelector('.toolbar').getBoundingClientRect().top");
  await until("document.querySelectorAll('.map-heritage-marker').length > 0");
  const overviewMarkers = await evaluate(`(() => ({
    count: document.querySelectorAll('.map-heritage-marker').length,
    hiddenFromA11y: document.querySelector('.map-heritage-marker-layer')?.getAttribute('aria-hidden') === 'true',
    nonInteractive: [...document.querySelectorAll('.map-heritage-marker')].every((node) => node.tagName !== 'BUTTON' && getComputedStyle(node).pointerEvents === 'none' && node.tabIndex < 0),
    visibleNumbers: [...document.querySelectorAll('.map-heritage-marker')].some((node) => /\d/.test(node.textContent)),
    width: document.querySelector('.map-heritage-marker')?.getBoundingClientRect().width || 0,
    iconMask: getComputedStyle(document.querySelector('.map-heritage-marker-icon')).webkitMaskImage,
  }))()`);
  const markerFollowing = await evaluate(`(async () => {
    const system = window.__gestureSystem;
    const context = system?.threeAdapter?.getActiveContext?.();
    const markers = [...document.querySelectorAll('.map-heritage-marker')];
    if (!context || !markers.length) return { available: false };
    const centers = () => markers.map((node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    const beforeDrag = centers();
    system.threeAdapter.dragStart(context);
    system.threeAdapter.dragMove(context, 72, 14);
    system.threeAdapter.dragEnd(context);
    await new Promise((resolve) => setTimeout(resolve, 180));
    const afterDrag = centers();
    const dragDistances = afterDrag.map((point, index) => Math.hypot(
      point.x - beforeDrag[index].x,
      point.y - beforeDrag[index].y,
    ));

    const districtName = markers[0].dataset.district;
    const beforeRise = centers()[0];
    system.threeAdapter.hover(context, districtName);
    await new Promise((resolve) => setTimeout(resolve, 420));
    const afterRise = centers()[0];
    system.threeAdapter.hoverClear(context);
    return {
      available: true,
      movedCount: dragDistances.filter((distance) => distance > 3).length,
      maxDragDistance: Math.max(...dragDistances),
      riseDistance: Math.hypot(afterRise.x - beforeRise.x, afterRise.y - beforeRise.y),
    };
  })()`);
  await evaluate("[...document.querySelectorAll('.map-zoom-controls button')].find((node) => node.textContent.includes('还原')).click()");
  await wait(900);
  await evaluate("document.querySelector('.map-heritage-marker').click()");
  const markerPreview = await evaluate(`({ visible: Boolean(document.querySelector('.map-heritage-preview')) })`);
  const overviewShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(screenshots.overview, Buffer.from(overviewShot.data, 'base64'));

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
  await until("document.querySelector('.map3d-focus-overlay .craft-anchor-hit')");
  const gestureBootstrap = await evaluate(`(async () => {
    if (window.__gestureSystem) return { ready: true, source: 'app' };
    try {
      const { initGesture } = await import('/js/gesture/gesture-init.js');
      initGesture();
      return { ready: Boolean(window.__gestureSystem), source: 'test-bootstrap' };
    } catch (error) {
      return { ready: false, error: error?.stack || String(error) };
    }
  })()`);
  const gestureCraftHit = await evaluate(`(() => {
    const resolver = window.__gestureSystem?.targetResolver;
    const buttons = [...document.querySelectorAll('.map3d-focus-overlay .craft-anchor-hit')];
    const button = buttons.find((candidate) => {
      const bounds = candidate.getBoundingClientRect();
      const visible = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      return visible === candidate || candidate.contains(visible);
    });
    const rect = button?.getBoundingClientRect();
    if (!button || !resolver || !rect) return {
      available: false,
      buttonCount: buttons.length,
      visibleButton: Boolean(button),
      resolverReady: Boolean(resolver),
    };
    const exact = resolver.resolve(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const probes = [
      [rect.left - 12, rect.top + rect.height / 2],
      [rect.right + 12, rect.top + rect.height / 2],
      [rect.left + rect.width / 2, rect.top - 12],
      [rect.left + rect.width / 2, rect.bottom + 12],
    ];
    const expanded = probes
      .map(([x, y]) => resolver.resolve(x, y))
      .find((target) => target?.gestureExpanded && target?.element?.closest?.('.craft-anchor-hit') === button) || null;
    const exactButton = exact?.element?.closest?.('.craft-anchor-hit');
    if (exactButton === button) exactButton.click();
    return {
      available: true,
      exact: exactButton === button,
      expanded: expanded?.element?.closest?.('.craft-anchor-hit') === button,
      exactLayer: exact?.layer || '',
      expandedLayer: expanded?.layer || '',
      clicked: exactButton === button,
    };
  })()`);
  if (gestureCraftHit.clicked) await until("document.querySelector('.project-story')");
  const gestureCraftOpened = gestureCraftHit.clicked
    ? await evaluate("Boolean(document.querySelector('.project-story'))")
    : false;
  if (gestureCraftOpened) {
    await evaluate("document.querySelector('.project-story-close')?.click()");
    await until("!document.querySelector('.project-story')");
  }
  const gestureLongPressRotation = await evaluate(`(async () => {
    const { createPointerGestureStateMachine } = await import('/js/gesture/pointer-gesture-state-machine.js');
    const system = window.__gestureSystem;
    const canvas = document.querySelector('.map3d-canvas');
    const context = system?.threeAdapter?.getActiveContext?.();
    if (!system || !canvas || !context) return { available: false };
    const machine = createPointerGestureStateMachine({
      clickSlopPx: 34, holdSlopPx: 42, longPressMs: 520,
      postHoldDragThresholdPx: 6, smoothing: 1,
    });
    machine.start({ x: 100, y: 100 }, 0);
    const premature = machine.move({ x: 120, y: 100 }, 200);
    const hold = machine.move({ x: 120, y: 100 }, 540);
    if (hold.some((event) => event.type === 'long-press-start')) system.threeAdapter.dragStart(context);
    const drag = machine.move({ x: 130, y: 100 }, 580);
    drag.filter((event) => event.type === 'drag-move')
      .forEach((event) => system.threeAdapter.dragMove(context, event.dx, event.dy));
    const end = machine.end({ x: 132, y: 100 }, 620);
    if (end.events.some((event) => event.type === 'drag-end')) system.threeAdapter.dragEnd(context);
    return {
      available: true,
      prematureSafe: !premature.some((event) => event.type === 'drag-start'),
      held: hold.some((event) => event.type === 'long-press-start'),
      dragged: drag.some((event) => event.type === 'drag-move'),
      rotation: canvas.dataset.mapRotation || '',
    };
  })()`);
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
  const homeBrand = await evaluate(`(() => ({
    logoLoaded: (document.querySelector('.home .cat-hint-logo')?.naturalWidth || 0) > 0,
    logoSource: document.querySelector('.home .cat-hint-logo')?.getAttribute('src') || '',
  }))()`);
  const homeShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(screenshots.home, Buffer.from(homeShot.data, 'base64'));

  const result = {
    nav,
    homeNav,
    homeBrand,
    overviewMarkers,
    markerFollowing,
    markerPreview,
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
    gestureBootstrap,
    gestureCraftHit: { ...gestureCraftHit, opened: gestureCraftOpened },
    gestureLongPressRotation,
    passport: { heading: passport.heading, rows: passport.rows },
    screenshots,
  };
  const errors = [];
  if (nav.labels.join('|') !== '地图探索|知识星图|数据护照') errors.push('地图页公开导航顺序不正确');
  const isBrandLogo = (source = '') => source.includes('/brand/logo.png') || source.includes('/assets/brand/tanwuzhi-logo.png');
  if (nav.title !== '探物志-上海非遗交互数字平台' || nav.brandName !== '探物志-上海非遗交互数字平台' || !nav.brandLogoLoaded || nav.legacySealVisible || !isBrandLogo(nav.brandLogo) || !isBrandLogo(nav.favicon)) errors.push('全站标题、导航 Logo 或浏览器图标未统一使用探物志品牌');
  if (homeNav.join('|') !== '地图探索|知识星图|数据护照') errors.push('首页公开导航顺序不正确或仍有冗余入口');
  if (!homeBrand.logoLoaded || !isBrandLogo(homeBrand.logoSource)) errors.push('首页左下角未使用探物志 Logo');
  if (nav.adminVisible) errors.push('公开导航仍显示管理入口');
  if (overviewMarkers.count !== 8 || overviewMarkers.visibleNumbers || overviewMarkers.width > 34 || !decodeURIComponent(overviewMarkers.iconMask).includes('地图,图钉,标记,标点.png')) errors.push('地图未按“一项非遗一个小标记”规则或指定图案渲染');
  if (!markerFollowing.available || markerFollowing.movedCount < 6 || markerFollowing.maxDragDistance < 8 || markerFollowing.riseDistance < 1) errors.push('非遗标记未持续跟随地图旋转或区块抬升');
  if (!overviewMarkers.nonInteractive || !overviewMarkers.hiddenFromA11y || markerPreview.visible) errors.push('地图数量标记仍可交互或进入辅助技术焦点');
  if (!result.search.visible || !result.search.hasCraft || !listHasMatch) errors.push('地图或列表搜索不可用');
  if (result.toolbarShift > 3) errors.push(`地图/列表切换时工具条位移 ${result.toolbarShift}px`);
  if (center.heading !== '上海中心城区' || !result.center.listsFiveDistricts) errors.push('中心城区五区聚合不完整');
  if (!center.collapsedSections || !center.backBelowHeading) errors.push('地区面板折叠或返回按钮布局不正确');
  if (!gestureBootstrap.ready || gestureBootstrap.source !== 'app') errors.push(`页面手势系统未正常初始化：${gestureBootstrap.error || gestureBootstrap.source || 'unknown'}`);
  if (!gestureCraftHit.available || !gestureCraftHit.exact || !gestureCraftOpened) errors.push('手势无法稳定命中并打开地图上的非遗图片');
  if (!gestureLongPressRotation.available || !gestureLongPressRotation.prematureSafe || !gestureLongPressRotation.held || !gestureLongPressRotation.dragged || !gestureLongPressRotation.rotation) errors.push('地图长按所有权或旋转链路未生效');
  if (!reset) errors.push('地图还原未退出地区聚焦');
  if (passport.heading !== '数据护照' || passport.rows < 1) errors.push('数据护照未正常打开');
  console.log(JSON.stringify({ ...result, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* noop */ }
  browser.kill();
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }); } catch { /* Edge may still own its profile briefly. */ }
}
