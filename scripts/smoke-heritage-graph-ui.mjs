import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const base = process.argv.find((arg) => arg.startsWith('--base='))?.slice(7) || 'http://127.0.0.1:7100';
const edge = process.env['PROGRAMFILES(X86)']
  ? path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-crafted-graph-ui-'));
const screenshotPath = path.join(os.tmpdir(), 'sh-crafted-heritage-graph-smoke.png');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close(() => resolve(address.port));
  });
});

const browser = spawn(edge, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true });

let ws;
try {
  let target;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
      target = targets.find((item) => item.type === 'page');
      if (target) break;
    } catch {
      // Edge is still starting.
    }
    await wait(250);
  }
  if (!target) throw new Error('无法连接无头浏览器');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0;
  const pending = new Map();
  const browserErrors = [];
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || 'runtime exception');
    if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') browserErrors.push(message.params.entry.text);
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`浏览器指令超时：${method}`)); }, 45000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || '页面脚本执行失败');
    return result.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/#/` });
  await wait(1800);
  const gestureWorker = await evaluate(`(async () => {
    const notices = [];
    const errors = [];
    let resolveInference;
    const inferenceDone = new Promise((resolve) => { resolveInference = resolve; });
    const { createWorkerClient } = await import('/js/gesture/mediapipe-worker-client.js');
    const client = createWorkerClient({
      onNotice: (message) => notices.push(message),
      onError: (message) => errors.push(message),
      onLandmarks: () => resolveInference(true),
    });
    try {
      await client.init();
      const canvas = new OffscreenCanvas(320, 240);
      const context = canvas.getContext('2d');
      context.fillStyle = '#6f806a';
      context.fillRect(0, 0, canvas.width, canvas.height);
      client.sendFrame(canvas.transferToImageBitmap(), performance.now());
      const inferred = await Promise.race([
        inferenceDone,
        new Promise((resolve) => setTimeout(() => resolve(false), 10000)),
      ]);
      return { ready: client.isReady(), inferred, notices, errors };
    } catch (error) {
      return { ready: false, inferred: false, notices, errors: [...errors, error.message] };
    } finally {
      client.destroy();
    }
  })()`);
  const mapGesture = await evaluate(`(async () => {
    const host = document.createElement('div');
    Object.assign(host.style, { position: 'fixed', left: '0', top: '0', width: '960px', height: '640px', zIndex: '99998' });
    document.body.appendChild(host);
    let hovered = null;
    let selected = null;
    const [{ createMap3D }, { createDirectDragSession }] = await Promise.all([
      import('/js/map3d.js'),
      import('/js/gesture/direct-drag-session.js'),
    ]);
    const map = await createMap3D(host, {
      onHover: (name) => { hovered = name; },
      onSelect: (name) => { selected = name; },
      onBlank: () => {},
      isLive: () => true,
      craftCount: () => 1,
      onFrame: () => {},
    });
    const adapter = map.gestureAdapter();
    await new Promise((resolve) => setTimeout(resolve, 500));
    let hit = null;
    for (let yi = -8; yi <= 8 && !hit; yi += 1) {
      for (let xi = -9; xi <= 9 && !hit; xi += 1) {
        adapter.raycaster.setFromCamera({ x: xi / 10, y: yi / 10 }, adapter.camera);
        hit = adapter.raycaster.intersectObjects(adapter.getRaycastTargets(), false)[0] || null;
      }
    }
    if (hit) {
      adapter.onHover(hit.object);
      adapter.onClick(hit.object);
    }
    const expected = hit?.object?.userData?.district?.name || null;
    const cameraBeforeDrag = adapter.camera.position.clone();
    const dragSession = createDirectDragSession({ smoothing: 1, gain: 1 });
    dragSession.start({ x: 180, y: 220 });
    const dragMove = dragSession.move({ x: 240, y: 238 });
    adapter.onDragMove(dragMove.dx, dragMove.dy);
    dragSession.end({ x: 240, y: 238 });
    const dragDistance = cameraBeforeDrag.distanceTo(adapter.camera.position);
    map.dispose();
    host.remove();
    return { expected, hovered, selected, dragDistance, directDrag: Boolean(dragMove) };
  })()`);
  const modelGesture = await evaluate(`(async () => {
    const host = document.createElement('div');
    Object.assign(host.style, { position: 'fixed', left: '0', top: '0', width: '520px', height: '420px', zIndex: '99998' });
    document.body.appendChild(host);
    const [{ createParticleModel }, { CRAFT_MODEL_PATHS }, { createDirectDragSession }] = await Promise.all([
      import('/js/particlemodel.js'),
      import('/js/config.js'),
      import('/js/gesture/direct-drag-session.js'),
    ]);
    const model = await createParticleModel(host, CRAFT_MODEL_PATHS.SHIH_0001.finished, {
      detailMode: false,
      solidMode: true,
      particleFraction: 0.08,
    });
    const adapter = model.gestureAdapter();
    const before = adapter.getRotation();
    const drag = createDirectDragSession({ smoothing: 1, gain: 1 });
    adapter.startDrag();
    drag.start({ x: 180, y: 180 });
    const movement = drag.move({ x: 228, y: 198 });
    adapter.applyDrag(movement.dx, movement.dy);
    drag.end();
    adapter.endDrag();
    const after = adapter.getRotation();
    model.dispose();
    host.remove();
    return {
      changed: Math.abs(after.x - before.x) > 0.01 || Math.abs(after.y - before.y) > 0.01,
      released: after.dragging === false,
    };
  })()`);
  await evaluate(`(async () => {
    const host = document.createElement('div');
    host.id = 'graph-smoke-host';
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '99999', background: '#5d705f' });
    document.body.appendChild(host);
    const [{ createHeritageGraphState }, { mountHeritageGraph }] = await Promise.all([
      import('/js/heritage-graph.js'), import('/js/heritage-graph-3d.js'),
    ]);
    const state = createHeritageGraphState('heritage:SHIH_0007');
    window.__graphSmokeHandle = mountHeritageGraph(host, state);
    return Boolean(window.__graphSmokeHandle);
  })()`);
  await wait(2200);
  const root = await evaluate(`(() => {
    const canvas = document.querySelector('#graph-smoke-host .heritage-graph-canvas');
    return {
      canvas: Boolean(canvas), ringCount: Number(canvas?.dataset.ringCount || 0),
      nodeCount: Number(canvas?.dataset.nodeCount || 0),
      nodeMaterial: canvas?.dataset.nodeMaterial || '', lineLengthMode: canvas?.dataset.lineLengthMode || '', hoverTransition: canvas?.dataset.hoverTransition || '',
    };
  })()`);
  const hoveredNode = await evaluate(`(async () => {
    const canvas = document.querySelector('#graph-smoke-host .heritage-graph-canvas');
    const rect = canvas?.getBoundingClientRect();
    if (!canvas || !rect) return '';
    for (let row = 2; row <= 8; row += 1) {
      for (let col = 2; col <= 12; col += 1) {
        canvas.dispatchEvent(new PointerEvent('pointermove', {
          bubbles: true, clientX: rect.left + rect.width * col / 14, clientY: rect.top + rect.height * row / 10,
        }));
        await new Promise((resolve) => setTimeout(resolve, 35));
        if (canvas.dataset.hoveredNode) return canvas.dataset.hoveredNode;
      }
    }
    return '';
  })()`);
  const graphDragDistance = await evaluate(`(async () => {
    const { createDirectDragSession } = await import('/js/gesture/direct-drag-session.js');
    const adapter = window.__graphSmokeHandle?.gestureAdapter?.();
    if (!adapter?.camera || !adapter?.onDragMove) return 0;
    const before = adapter.camera.position.clone();
    const drag = createDirectDragSession({ smoothing: 1, gain: 1 });
    drag.start({ x: 260, y: 240 });
    const movement = drag.move({ x: 312, y: 226 });
    adapter.onDragMove(movement.dx, movement.dy);
    drag.end({ x: 312, y: 226 });
    return before.distanceTo(adapter.camera.position);
  })()`);
  await evaluate("window.__graphSmokeHandle.branch('LOCATED_IN')");
  await wait(900);
  const branchNodeCount = await evaluate("Number(document.querySelector('#graph-smoke-host .heritage-graph-canvas')?.dataset.nodeCount || 0)");
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'));
  await evaluate(`(() => {
    window.__graphSmokeHandle.dispose();
    window.__graphSmokeHandle = null;
    document.querySelector('#graph-smoke-host')?.remove();
  })()`);
  await wait(300);
  const disposed = await evaluate("!document.querySelector('#graph-smoke-host') && !document.querySelector('.heritage-graph-canvas')");
  await evaluate(`(() => {
    window.__graphRouteErrors = [];
    window.addEventListener('error', (event) => window.__graphRouteErrors.push(event.error?.stack || event.message));
    window.addEventListener('unhandledrejection', (event) => window.__graphRouteErrors.push(event.reason?.stack || String(event.reason)));
  })()`);
  await evaluate(`location.hash = '#/graph/${encodeURIComponent('tradition:ivory_carving')}'`);
  await wait(12000);
  const standalone = await evaluate(`(() => ({
    hash: location.hash,
    route: document.querySelector('.route-mount')?.dataset.route || '',
    bodyText: document.body.innerText.slice(0, 180),
    errors: window.__graphRouteErrors || [],
    page: Boolean(document.querySelector('.graph-page')),
    canvas: Boolean(document.querySelector('.graph-page .heritage-graph-canvas')),
    selectedTitle: document.querySelector('.graph-page .heritage-graph-info h3')?.textContent || '',
    logoHref: document.querySelector('.graph-page .topnav .brand')?.getAttribute('href') || '',
    graphNav: Boolean(document.querySelector('.graph-page .graph-nav-link.active')),
    keyboardNodes: document.querySelectorAll('.graph-page .heritage-graph-keyboard-list button').length,
  }))()`);
  const gestureOverlay = await evaluate(`(async () => {
    const { createGestureHandOverlay } = await import('/js/gesture/gesture-hand-overlay.js');
    const overlay = createGestureHandOverlay();
    const hand = Array.from({ length: 21 }, (_, index) => ({ x: .35 + (index % 4) * .05, y: .3 + Math.floor(index / 4) * .055, z: 0 }));
    overlay.update(hand);
    overlay.setAction('longpress');
    const result = {
      canvasVisible: document.querySelector('.gesture-hand-canvas')?.classList.contains('is-visible') || false,
      pointState: document.querySelector('.gesture-hand-action')?.textContent || '',
      guideExists: Boolean(document.querySelector('.gesture-live-guide')),
    };
    overlay.destroy();
    return result;
  })()`);
  const virtualPointer = await evaluate(`(async () => {
    const { createVirtualPointer } = await import('/js/gesture/virtual-pointer.js');
    const events = [];
    const button = document.createElement('button');
    button.textContent = '手势事件测试';
    Object.assign(button.style, { position: 'fixed', left: '24px', top: '180px', width: '140px', height: '48px', zIndex: '100000' });
    document.body.appendChild(button);
    ['pointerenter', 'pointermove', 'pointerdown', 'pointerup', 'mouseenter', 'mousemove', 'mousedown', 'mouseup']
      .forEach((type) => button.addEventListener(type, () => events.push(type)));
    const pointer = createVirtualPointer();
    pointer.move({ element: button }, 60, 200);
    pointer.down({ element: button }, 60, 200);
    pointer.up({ element: button }, 60, 200);
    const canvas = document.querySelector('.graph-page .heritage-graph-canvas');
    const rect = canvas?.getBoundingClientRect();
    const nav = document.querySelector('.graph-page .heritage-graph-close');
    const navRect = nav?.getBoundingClientRect();
    const { createTargetResolver } = await import('/js/interaction/target-resolver.js');
    const resolver = createTargetResolver({ hitSlopPx: 28 });
    const expandedTarget = nav && navRect
      ? resolver.resolve(navRect.left - 8, navRect.top + navRect.height / 2)
      : null;
    if (canvas && rect) {
      const threeTarget = { element: canvas, layer: 'three_scene' };
      pointer.move(threeTarget, rect.left + rect.width / 2, rect.top + rect.height / 2);
      pointer.down(threeTarget, rect.left + rect.width / 2, rect.top + rect.height / 2);
      pointer.up(threeTarget, rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
    pointer.cancel();
    button.remove();
    return {
      events,
      canvasTested: Boolean(canvas),
      expandedButtonHit: expandedTarget?.element === nav && expandedTarget?.gestureExpanded === true,
      expandedTargetTag: expandedTarget?.element?.className || '',
      expandedTargetExpanded: Boolean(expandedTarget?.gestureExpanded),
      expandedProbe: nav && navRect ? { left: navRect.left, top: navRect.top, width: navRect.width, height: navRect.height } : null,
    };
  })()`);
  standalone.browserErrors = browserErrors;
  const errors = [];
  if (!root.canvas || root.ringCount < 6 || root.nodeCount < 4) errors.push('根星图、六层天环或三门户未完成渲染');
  if (root.nodeMaterial !== 'white-translucent') errors.push('星图节点未使用纯白半透明材质');
  if (root.lineLengthMode !== 'stable-id-random') errors.push('星图连线未使用稳定随机长度布局');
  if (root.hoverTransition !== 'damped-opacity-scale' || !hoveredNode) errors.push('节点悬停阻尼交互未生效');
  if (!(graphDragDistance > 0.01)) errors.push('张掌直接拖拽没有改变星图相机位置');
  if (branchNodeCount < 3) errors.push('地区分支没有可浏览节点');
  if (!disposed) errors.push('图谱销毁后仍残留画布或宿主节点');
  if (!standalone.page || !standalone.canvas || standalone.selectedTitle !== '牙雕与篾丝编织传统') errors.push('独立星图路由未定位到指定稳定节点');
  if (standalone.logoHref !== '#/' || !standalone.graphNav) errors.push('Logo 初始页路由或知识星图导航入口不正确');
  if (standalone.keyboardNodes < 1) errors.push('独立星图没有提供键盘等价节点入口');
  if (!gestureOverlay.canvasVisible || gestureOverlay.pointState !== '持续按住 · 长按' || !gestureOverlay.guideExists) errors.push('虚拟手骨架或动作引导未正确挂载');
  if (!virtualPointer.canvasTested || !['pointermove', 'pointerdown', 'pointerup', 'mousemove', 'mousedown', 'mouseup'].every((type) => virtualPointer.events.includes(type))) errors.push('虚拟鼠标没有派发完整事件链');
  if (!virtualPointer.expandedButtonHit) errors.push('按钮手势扩展命中区未生效');
  if (browserErrors.length) errors.push('页面存在未处理的浏览器脚本异常');
  if (!gestureWorker.ready || !gestureWorker.inferred) errors.push(`MediaPipe Worker 未完成推理：${gestureWorker.errors.join(', ')}`);
  if (!mapGesture.expected || mapGesture.hovered !== mapGesture.expected || mapGesture.selected !== mapGesture.expected) errors.push('地图手势没有命中、悬停或选择同一地区');
  if (!mapGesture.directDrag || !(mapGesture.dragDistance > 0.01)) errors.push('张掌直接拖拽没有改变地图相机位置');
  if (!modelGesture.changed || !modelGesture.released) errors.push('张掌直接拖拽没有旋转或释放完成品模型');
  console.log(JSON.stringify({ root, hoveredNode, graphDragDistance, branchNodeCount, disposed, standalone, gestureWorker, mapGesture, modelGesture, gestureOverlay, virtualPointer, screenshotPath, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* Ignore close errors. */ }
  if (browser.exitCode === null) browser.kill();
}
