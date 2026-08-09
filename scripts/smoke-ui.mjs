import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const base = process.argv.find((arg) => arg.startsWith('--base='))?.slice(7) || 'http://127.0.0.1:7100';
const edge = process.env['PROGRAMFILES(X86)']
  ? path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-crafted-ui-'));
const screenshots = {
  agent: path.join(os.tmpdir(), 'sh-crafted-agent-final.png'),
  complete: path.join(os.tmpdir(), 'sh-crafted-complete-final.png'),
  graph: path.join(os.tmpdir(), 'sh-crafted-heritage-graph.png'),
  workbench: path.join(os.tmpdir(), 'sh-crafted-workbench-physics.png'),
  mapOverview: path.join(os.tmpdir(), 'sh-crafted-map-waterfall.png'),
  mapFocus: path.join(os.tmpdir(), 'sh-crafted-map-focus.png'),
  home: path.join(os.tmpdir(), 'sh-crafted-home-particles.png'),
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
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore', windowsHide: true });

let ws;
try {
  let target;
  for (let attempt = 0; attempt < 40; attempt++) {
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
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let seq = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id || !pending.has(message.id)) return;
    const promise = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(promise.timer);
    if (message.error) promise.reject(new Error(message.error.message));
    else promise.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`浏览器指令超时：${method}`));
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    try {
      const result = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      return result.result.value;
    } catch (error) {
      throw new Error(`${error.message}；表达式：${String(expression).replace(/\s+/g, ' ').slice(0, 120)}`);
    }
  };
  const screenshot = async (file) => {
    const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1600,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.navigate', { url: `${base}/#/craft/SHIH_0001` });
  await wait(5000);

  await evaluate("document.querySelector('.agent-fab')?.click()");
  await wait(120);
  await evaluate("document.querySelector('.mascot-bubble button')?.click()");
  await wait(500);
  await evaluate(`(() => {
    const input = document.querySelector('.ap-input-row input');
    if (!input) return false;
    input.value = '竹子';
    document.querySelector('.ap-input-row .btn')?.click();
    return true;
  })()`);
  for (let attempt = 0; attempt < 30; attempt++) {
    const answered = await evaluate(`(() => (
      !document.querySelector('.ap-thinking')
      && Boolean(document.querySelector('.ap-kb-details, .ap-explore-link, .ap-followup'))
    ))()`);
    if (answered) break;
    await wait(1000);
  }
  const chat = await evaluate(`(() => ({
    panelOpen: document.querySelector('.agent-panel')?.classList.contains('open') || false,
    openLatencyMs: Number(document.querySelector('.agent-panel')?.dataset.openLatencyMs || 0),
    appPaddingRight: getComputedStyle(document.querySelector('#app')).paddingRight,
    avatars: document.querySelectorAll('.ap-msg.agent .ap-avatar').length,
    agentMessages: document.querySelectorAll('.ap-msg.agent').length,
    knowledgeDrawers: document.querySelectorAll('.ap-kb-details').length,
    knowledgeCollapsed: [...document.querySelectorAll('.ap-kb-details')].every((item) => !item.open),
    explorationLinks: document.querySelectorAll('.ap-explore-link').length,
    followups: document.querySelectorAll('.ap-followup').length,
    bambooGraphLink: [...document.querySelectorAll('.ap-explore-link')].some((node) => node.textContent.includes('竹材') && node.textContent.includes('打开关系星图')),
    oppositeSides: (() => {
      const agent = [...document.querySelectorAll('.ap-msg.agent .bubble')].at(-1)?.getBoundingClientRect();
      const user = [...document.querySelectorAll('.ap-msg.user .bubble')].at(-1)?.getBoundingClientRect();
      return Boolean(agent && user && user.left > agent.left + 40);
    })(),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }))()`);
  await screenshot(screenshots.agent);

  const idlePreview = await evaluate(`(() => {
    const canvas = document.querySelector('.wb-idle .pm-canvas');
    return {
      canvas: Boolean(canvas),
      deferredButton: Boolean(document.querySelector('.wb-idle .pm-load-button')),
      modelMode: canvas?.dataset.modelMode || '',
      looseAmount: Number(canvas?.dataset.looseAmount || 0),
      finishedAssetLoaded: performance.getEntriesByType('resource').some((entry) => (
        entry.name.includes('bamboo-finished')
      )),
    };
  })()`);

  await evaluate(`(() => {
    const link = [...document.querySelectorAll('.ap-explore-link')].find((node) => node.textContent.includes('竹材'));
    link?.click();
  })()`);
  await wait(900);
  chat.bambooGraphOpened = await evaluate("decodeURIComponent(location.hash).includes('/graph/material:bamboo')");
  await evaluate("location.hash = '#/craft/SHIH_0001'");
  await wait(2800);

  await evaluate("document.querySelector('.ap-close')?.click(); document.querySelector('.workbench-col .btn-primary')?.click()");
  await wait(900);
  const workbench = await evaluate(`(() => {
    const item = document.querySelector('.bp-item:not(:disabled)');
    item?.click();
    const surface = document.querySelector('.wb-table-surface');
    const detailBackground = document.querySelector('.craft-page > .bg-stack:not(.wb-bg)');
    const tableImage = surface ? getComputedStyle(surface).backgroundImage : '';
    return {
      actionCards: document.querySelectorAll('.action-card').length,
      stepCount: document.querySelectorAll('.wb-progress .pg').length,
      outputSpectrumRemoved: !document.querySelector('.wb-output-list'),
      selectedBoxRemoved: !document.querySelector('.resource-slot'),
      tableTextureConfigured: tableImage.includes('t%E5%B7%A5%E4%BD%9C%E5%8F%B0.png') || tableImage.includes('t工作台.png'),
      detailBackgroundRetained: (
        !document.querySelector('.wb-bg.show')
        && !detailBackground?.classList.contains('dimmed')
      ),
    };
  })()`);
  await wait(850);
  Object.assign(workbench, await evaluate(`(() => ({
    previewCanvas: Boolean(document.querySelector('.wb-table-canvas')),
    gravity: document.querySelector('.wb-table-surface')?.dataset.physics === 'gravity',
    objectCount: Number(document.querySelector('.wb-table-surface')?.dataset.objectCount || 0),
    objectLabelCount: Number(document.querySelector('.wb-table-surface')?.dataset.objectLabelCount || 0),
    visibleObjectLabels: [...document.querySelectorAll('.wb-object-label')].filter((node) => !node.hidden && node.textContent.trim()).length,
    objectLabelOnTable: (() => {
      const table = document.querySelector('.wb-table-surface')?.getBoundingClientRect();
      const label = document.querySelector('.wb-object-label')?.getBoundingClientRect();
      const style = document.querySelector('.wb-object-label') ? getComputedStyle(document.querySelector('.wb-object-label')) : null;
      return Boolean(table && label && label.width > 24 && label.height > 16
        && label.left >= table.left && label.right <= table.right
        && label.top >= table.top && label.bottom <= table.bottom
        && Number(style?.opacity || 0) > 0.8 && style?.visibility !== 'hidden');
    })(),
    stepGuide: Boolean(document.querySelector('.wb-step-float')),
    stepGuideStrongCount: document.querySelectorAll('.wb-step-float strong').length,
    restoreHandleRemoved: !document.querySelector('.restore-handle') && !document.body.textContent.includes('展开资料'),
    pointerActionDrag: [...document.querySelectorAll('.action-card')].every((node) => node.dataset.dragMode === 'pointer'),
    verticalActions: getComputedStyle(document.querySelector('.action-palette')).flexDirection === 'column',
    materialPointerDrag: [...document.querySelectorAll('.bp-item:not(:disabled)')].every((node) => node.dataset.dragMode === 'pointer'),
    actionArrowInsideCard: (() => {
      const card = document.querySelector('.action-card');
      if (!card) return false;
      card.classList.add('selected');
      const left = Number.parseFloat(getComputedStyle(card, '::before').left);
      card.classList.remove('selected');
      return Number.isFinite(left) && left >= 0 && left < card.clientWidth;
    })(),
  }))()`));
  const backpackScrollBefore = await evaluate(`(() => {
    const style = document.createElement('style');
    style.id = 'workbench-scroll-regression-style';
    style.textContent = '.wb-play-physics .backpack{height:64px!important;max-height:64px!important;overflow-y:auto!important}';
    document.head.appendChild(style);
    const backpack = document.querySelector('.backpack');
    const item = [...document.querySelectorAll('.bp-item:not(:disabled)')].at(-1);
    if (!backpack || !item) { style.remove(); return 0; }
    backpack.scrollTop = backpack.scrollHeight;
    const before = backpack.scrollTop;
    item.click();
    return before;
  })()`);
  await wait(80);
  const backpackScrollAfter = await evaluate(`(() => {
    const after = document.querySelector('.backpack')?.scrollTop || 0;
    document.querySelector('#workbench-scroll-regression-style')?.remove();
    return after;
  })()`);
  workbench.backpackScrollStable = backpackScrollBefore > 0 && Math.abs(backpackScrollAfter - backpackScrollBefore) <= 2;
  const draggedResource = await evaluate(`(() => {
    let card = [...document.querySelectorAll('.bp-item:not(:disabled)')].find((node) => !node.classList.contains('selected'));
    if (!card) {
      card = document.querySelector('.bp-item:not(:disabled)');
      const name = card?.dataset.resource;
      card?.click();
      card = [...document.querySelectorAll('.bp-item:not(:disabled)')].find((node) => node.dataset.resource === name);
    }
    const table = document.querySelector('.wb-table-surface');
    if (!card || !table) return '';
    const name = card.dataset.resource;
    const a = card.getBoundingClientRect();
    const b = table.getBoundingClientRect();
    const pointerId = 18;
    const startX = a.left + a.width / 2;
    const startY = a.top + a.height / 2;
    const endX = b.left + b.width * .42;
    const endY = b.top + b.height * .68;
    card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', button: 0, buttons: 1, clientX: startX, clientY: startY }));
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', button: 0, buttons: 1, clientX: (startX + endX) / 2, clientY: (startY + endY) / 2 }));
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', button: 0, buttons: 1, clientX: endX, clientY: endY }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', button: 0, buttons: 0, clientX: endX, clientY: endY }));
    return name;
  })()`);
  await wait(160);
  const draggedResourceLiteral = JSON.stringify(draggedResource);
  workbench.materialDragAdded = draggedResource ? await evaluate(`(() => {
    const name = ${draggedResourceLiteral};
    return [...document.querySelectorAll('.bp-item')].some((node) => node.dataset.resource === name && node.classList.contains('selected'));
  })()`) : false;
  await screenshot(screenshots.workbench);
  await evaluate("document.querySelector('.bp-item.selected')?.click()");
  let firstMaterialUpgradeDetected = false;
  let firstRippleDetected = false;
  for (let index = 0; index < 12; index++) {
    const finished = await evaluate(`(() => {
      const finish = document.querySelector('.btn-finish');
      if (finish) {
        finish.click();
        return true;
      }
      return false;
    })()`);
    if (finished) break;
    const filled = await evaluate(`(() => {
      const button = document.querySelector('.btn-quick-fill');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!filled) throw new Error('未找到一键填入按钮');
    await wait(80);
    if (index === 0) {
      workbench.restoredCount = await evaluate("Number(document.querySelector('.wb-table-surface')?.dataset.restoredCount || 0)");
    }
    await evaluate(`(() => {
      const action = document.querySelector('.action-card.selected') || document.querySelector('.action-card');
      const table = document.querySelector('.wb-table-surface');
      if (!action || !table) return false;
      const actionRect = action.getBoundingClientRect();
      const tableRect = table.getBoundingClientRect();
      const pointerId = ${20 + index};
      const startX = actionRect.left + actionRect.width / 2;
      const startY = actionRect.top + actionRect.height / 2;
      const endX = tableRect.left + tableRect.width * 0.68;
      const endY = tableRect.top + tableRect.height * 0.62;
      action.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', button: 0, buttons: 1, clientX: startX, clientY: startY,
      }));
      window.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', button: 0, buttons: 1,
        clientX: (startX + endX) / 2, clientY: (startY + endY) / 2,
      }));
      window.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', button: 0, buttons: 1, clientX: endX, clientY: endY,
      }));
      window.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, cancelable: true, pointerId, pointerType: 'mouse', button: 0, buttons: 0, clientX: endX, clientY: endY,
      }));
      return true;
    })()`);
    if (index === 0) {
      await wait(90);
      firstRippleDetected = await evaluate("document.querySelector('.wb-table-surface')?.dataset.ripple === 'active'");
      await wait(560);
    } else {
      await wait(650);
    }
    if (index === 0) {
      firstMaterialUpgradeDetected = await evaluate(`(() => {
        const surface = document.querySelector('.wb-table-surface');
        const carried = document.querySelector('.bp-item.is-carried:disabled');
        const swatchColor = carried ? getComputedStyle(carried.querySelector('.resource-swatch')).backgroundColor : '';
        return Boolean(document.querySelector('.bp-item.is-carried:disabled'))
          && Number(surface?.dataset.objectCount || 0) >= 1
          && Number(surface?.dataset.restoredCount || 0) >= 1
          && swatchColor !== 'rgb(139, 157, 131)'
          && [...document.querySelectorAll('.bp-state')].some((node) => node.textContent.includes('级 · 已在桌面'));
      })()`);
      console.log(JSON.stringify({ workbenchCheckpoint: { firstMaterialUpgradeDetected } }));
    }
  }
  await wait(4500);
  const complete = await evaluate(`(() => ({
    visible: Boolean(document.querySelector('.wb-complete')),
    headings: [...document.querySelectorAll('.complete-side h4')].map((item) => item.textContent.trim()),
    externalCards: document.querySelectorAll('.heritage-note').length,
    operationReplayVisible: document.body.textContent.includes('操作回看'),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }))()`);
  await screenshot(screenshots.complete);

  await evaluate("document.querySelector('.heritage-graph-entry')?.click()");
  await wait(1800);
  const graph = await evaluate(`(() => {
    const canvas = document.querySelector('.heritage-graph-canvas');
    const overlay = document.querySelector('.heritage-graph-overlay');
    return {
      open: Boolean(overlay && canvas),
      ringCount: Number(canvas?.dataset.ringCount || 0),
      nodeCount: Number(canvas?.dataset.nodeCount || 0),
      nodeMaterial: canvas?.dataset.nodeMaterial || '',
      lineLengthMode: canvas?.dataset.lineLengthMode || '',
      hoverTransition: canvas?.dataset.hoverTransition || '',
      heading: document.querySelector('#heritage-graph-heading')?.textContent.trim() || '',
    };
  })()`);
  await screenshot(screenshots.graph);
  await evaluate("document.querySelector('.heritage-graph-close')?.click()");
  await wait(450);
  Object.assign(graph, await evaluate(`(() => ({
    closed: !document.querySelector('.heritage-graph-overlay'),
    bodyUnlocked: !document.body.classList.contains('heritage-graph-open'),
    completionRetained: Boolean(document.querySelector('.wb-complete')),
  }))()`));

  const modelCoverage = {};
  for (const craftId of ['SHIH_0007', 'SHIH_0008']) {
    await send('Page.navigate', { url: `${base}/#/craft/${craftId}` });
    await wait(1200);
    await evaluate("document.querySelector('.wb-idle .pm-load-button')?.click()");
    await wait(5200);
    modelCoverage[craftId] = await evaluate(`(() => {
      const active = document.querySelector('#app > .route-mount');
      return ({
      canvas: Boolean(active?.querySelector('.wb-idle .pm-canvas')),
      loading: Boolean(active?.querySelector('.wb-idle .pm-loading')),
      assetLoaded: performance.getEntriesByType('resource').some((entry) => entry.name.includes('${craftId === 'SHIH_0007' ? 'shadow-finished.web.glb' : 'kite-finished.web.glb'}')),
    }); })()`);
  }

  await send('Page.navigate', { url: `${base}/#/explore` });
  await wait(8500);
  const mapOverview = await evaluate(`(() => {
    const canvas = document.querySelector('.map3d-canvas');
    const rect = canvas?.getBoundingClientRect();
    return {
      canvasVisible: Boolean(canvas && rect.width > 0 && rect.height > 0),
      loadingVisible: Boolean(document.querySelector('.map3d-loading')),
      jadeSourceLoaded: performance.getEntriesByType('resource')
        .some((entry) => decodeURIComponent(entry.name).includes('map-texture-768.jpg')),
      mapV2Loaded: performance.getEntriesByType('resource')
        .some((entry) => decodeURIComponent(entry.name).includes('上海map_v2.glb')),
      jadeTextureLoaded: canvas?.dataset.jadeTextureLoaded === 'true',
      mapMaterial: canvas?.dataset.mapMaterial || '',
      particleMotion: canvas?.dataset.particleMotion || '',
      particleStyle: canvas?.dataset.particleStyle || '',
      edgeStyle: canvas?.dataset.edgeStyle || '',
      particleCount: Number(canvas?.dataset.particleCount || 0),
      bottomTriangleCount: Number(canvas?.dataset.bottomTriangleCount || 0),
      edgeSampleCount: Number(canvas?.dataset.edgeSampleCount || 0),
      waterLayer: canvas?.dataset.waterLayer || '',
      jadeTextureSource: canvas?.dataset.jadeTextureSource || '',
      districtCount: Number(canvas?.dataset.districtCount || 0),
      clickableDistrictCount: Number(canvas?.dataset.clickableDistrictCount || 0),
      rect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
    };
  })()`);
  await screenshot(screenshots.mapOverview);

  // Resolve the real WebGL targets synchronously through the same gesture
  // raycaster used in production. Waiting for a render frame at every grid
  // point made this check exceed CDP timeouts on CPU-only servers.
  const noProjectHit = await evaluate(`(async () => {
    const canvas = document.querySelector('.map3d-canvas');
    const system = window.__gestureSystem;
    if (!canvas || !system?.threeAdapter) return null;
    const rect = canvas.getBoundingClientRect();
    const { allCrafts } = await import('/js/data.js');
    const nodeToDistrict = {
      '上海市核心区': 'jingan', '南汇区': 'nanhui', '嘉定区': 'jiading',
      '奉贤区': 'fengxian', '宝山区': 'baoshan', '崇明县': 'chongming',
      '松江区': 'songjiang', '浦东新区': 'pudong', '金山区': 'jinshan',
      '闵行区': 'minhang', '青浦区': 'qingpu',
    };
    const occupied = new Set(allCrafts().map((craft) => craft.config.districtId));
    for (let row = 0; row < 11; row += 1) {
      for (let col = 0; col < 17; col += 1) {
        const x = rect.left + rect.width * (0.2 + col / 16 * 0.64);
        const y = rect.top + rect.height * (0.22 + row / 10 * 0.66);
        const ndcX = ((x - rect.left) / rect.width) * 2 - 1;
        const ndcY = -((y - rect.top) / rect.height) * 2 + 1;
        const target = system.threeAdapter.raycast('map3d', ndcX, ndcY);
        const title = target?.mesh?.userData?.district?.name || '';
        const districtId = nodeToDistrict[title];
        if (target && districtId && !occupied.has(districtId)) {
          system.threeAdapter.hover('map3d', target.group, target.mesh);
          await new Promise((resolve) => setTimeout(resolve, 80));
          return { x, y, title };
        }
      }
    }
    return null;
  })()`);
  if (noProjectHit) {
    await evaluate(`(() => {
      const canvas = document.querySelector('.map3d-canvas');
      canvas?.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        clientX: ${noProjectHit.x},
        clientY: ${noProjectHit.y},
      }));
    })()`);
    await wait(1800);
  }
  const actualFocus = await evaluate(`(() => ({
    panelVisible: Boolean(document.querySelector('.district-story')),
    zeroProjectPanel: document.querySelector('.district-story-count')?.textContent.includes('0 项') || false,
    focusClass: document.querySelector('.map-view')?.classList.contains('is-district-focus') || false,
    districtPanelAnimation: document.querySelector('.district-story')
      ? getComputedStyle(document.querySelector('.district-story')).animationName
      : '',
  }))()`);
  await screenshot(screenshots.mapFocus);
  const blankClickSent = await evaluate(`(() => {
    const overlay = document.querySelector('.map3d-focus-overlay');
    if (!overlay) return false;
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`);
  await wait(650);
  const blankReturned = await evaluate(`(() => (
    !document.querySelector('.district-story')
    && !document.querySelector('.map-view')?.classList.contains('is-district-focus')
  ))()`);

  const mapFocusStyle = await evaluate(`(() => {
    const mapView = document.querySelector('.map-view');
    const wrap = document.querySelector('.map3d-wrap');
    if (wrap) wrap.style.transition = 'none';
    mapView?.classList.add('is-district-focus');
    const focusTransform = wrap ? getComputedStyle(wrap).transform : 'none';
    mapView?.classList.remove('is-district-focus');
    if (wrap) wrap.style.transition = '';

    const action = document.createElement('div');
    action.className = 'project-story-action';
    action.style.cssText = 'position:fixed;left:-1000px;top:0;width:390px';
    const button = document.createElement('button');
    button.className = 'btn btn-primary';
    button.textContent = '成为传承人';
    action.appendChild(button);
    document.body.appendChild(action);
    const actionRect = action.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const actionCenter = actionRect ? actionRect.left + actionRect.width / 2 : 0;
    const buttonCenter = buttonRect ? buttonRect.left + buttonRect.width / 2 : 0;
    action.remove();
    return {
      focusTransform,
      focusScaleApplied: focusTransform !== 'none',
      inheritButtonCentered: Math.abs(actionCenter - buttonCenter) < 2,
    };
  })()`);
  const mapFocus = { ...mapFocusStyle, ...actualFocus, noProjectHit, blankClickSent, blankReturned };

  await send('Page.navigate', { url: `${base}/#/` });
  await wait(2600);
  const homeParticles = await evaluate(`(() => {
    const canvas = document.querySelector('.home-ripple-particles');
    const rect = canvas?.getBoundingClientRect();
    document.querySelector('.home')?.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      clientX: rect ? rect.left + rect.width * 0.68 : 900,
      clientY: rect ? rect.top + rect.height * 0.7 : 650,
    }));
    return {
      ready: canvas?.dataset.ready === 'true',
      particleCount: Number(canvas?.dataset.particleCount || 0),
      spriteCount: Number(canvas?.dataset.spriteCount || 0),
      flowerCount: Number(canvas?.dataset.flowerCount || 0),
      bottomLeftFlowerCount: Number(canvas?.dataset.bottomLeftFlowerCount || 0),
      leafCount: Number(canvas?.dataset.leafCount || 0),
      fieldType: canvas?.dataset.fieldType || '',
      assetKinds: canvas?.dataset.assetKinds || '',
      layout: canvas?.dataset.layout || '',
      sourceLayer: canvas?.dataset.sourceLayer || '',
      interaction: canvas?.dataset.interaction || '',
      visible: Boolean(rect && rect.width > 0 && rect.height > 0),
    };
  })()`);
  await wait(180);
  await screenshot(screenshots.home);
  await evaluate(`(() => {
    const home = document.querySelector('.home');
    const rect = home?.getBoundingClientRect();
    home?.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      clientX: rect ? rect.left + rect.width * 0.7 : 980,
      clientY: rect ? rect.top + rect.height * 0.72 : 700,
    }));
  })()`);
  await wait(120);
  homeParticles.burstDeferred = await evaluate("location.hash === '#/'");
  await wait(1800);
  homeParticles.transitionedToMap = await evaluate("location.hash === '#/explore'");

  const errors = [];
  if (!chat.panelOpen) errors.push('小蕉面板未打开');
  if (!chat.openLatencyMs || chat.openLatencyMs > 120) errors.push(`小蕉面板唤起耗时异常：${chat.openLatencyMs}ms`);
  if (parseFloat(chat.appPaddingRight) > 0) errors.push('小蕉面板唤起仍触发主应用重排');
  if (!chat.agentMessages || chat.avatars !== chat.agentMessages) errors.push('小蕉消息头像数量不一致');
  if (!chat.knowledgeDrawers || !chat.knowledgeCollapsed) errors.push('知识库折叠状态异常');
  if (!chat.explorationLinks) errors.push('智能体未生成可点击的图谱探索入口');
  if (chat.followups < 2) errors.push('智能体未生成两个延伸问题');
  if (!chat.bambooGraphLink) errors.push('“竹子”未生成竹材关系星图入口');
  if (!chat.bambooGraphOpened) errors.push('竹材关系星图入口无法完成站内跳转');
  if (!chat.oppositeSides) errors.push('用户与小蕉消息未形成左右布局');
  if (chat.horizontalOverflow) errors.push('小蕉面板产生横向溢出');
  if (!complete.visible) errors.push('未进入完成态');
  if (!complete.headings.includes('代表影像作品') || !complete.headings.includes('延伸资料')) errors.push('成果侧栏标题缺失');
  if (complete.externalCards !== 3) errors.push('延伸资料卡数量不是 3');
  if (complete.operationReplayVisible) errors.push('仍显示操作回看');
  if (complete.horizontalOverflow) errors.push('完成态产生横向溢出');
  if (!graph.open || graph.ringCount < 6 || graph.nodeCount < 4) errors.push('知识星图未打开、天环不足或根节点不完整');
  if (graph.nodeMaterial !== 'white-translucent') errors.push('知识星图节点未使用纯白半透明材质');
  if (graph.lineLengthMode !== 'stable-id-random') errors.push('知识星图连线未使用稳定随机长度布局');
  if (graph.hoverTransition !== 'damped-opacity-scale') errors.push('知识星图未启用阻尼悬停过渡');
  if (!graph.closed || !graph.bodyUnlocked || !graph.completionRetained) errors.push('退出知识星图后页面未正确恢复');
  for (const craftId of ['SHIH_0007', 'SHIH_0008']) {
    if (!modelCoverage[craftId]?.canvas || modelCoverage[craftId]?.loading) {
      errors.push(`${craftId} 完成品模型未成功加载`);
    }
  }
  if (!mapOverview.canvasVisible || mapOverview.loadingVisible) errors.push('三维地图未完成加载');
  if (!mapOverview.mapV2Loaded) errors.push('新版上海 GLB 地图未加载');
  if (!mapOverview.jadeSourceLoaded || !mapOverview.jadeTextureLoaded || mapOverview.jadeTextureSource !== 'map-texture-768.jpg' || mapOverview.mapMaterial !== 'translucent-jade') errors.push('新版玉石材质或纹理未生效');
  if (mapOverview.particleMotion !== 'removed' || mapOverview.particleCount !== 0 || mapOverview.edgeSampleCount !== 0) {
    errors.push('地图页仍在渲染边缘粒子');
  }
  if (mapOverview.particleStyle !== 'removed') errors.push('地图页粒子未移除');
  if (mapOverview.edgeStyle !== 'subtle-jade-mineral') errors.push('行政区边缘线未切换为淡玉色样式');
  if (mapOverview.waterLayer !== 'removed') errors.push('地图水面仍未移除');
  if (!mapOverview.districtCount || mapOverview.clickableDistrictCount !== mapOverview.districtCount) errors.push('仍有行政区无法点击');
  if (!mapFocus.noProjectHit || !mapFocus.panelVisible || !mapFocus.zeroProjectPanel || !mapFocus.focusClass) errors.push('无项目行政区无法通过真实地图交互进入');
  if (mapFocus.districtPanelAnimation !== 'districtStoryIn') errors.push('地区介绍面板未使用滑入动画');
  if (!mapFocus.blankClickSent || !mapFocus.blankReturned) errors.push('地区聚焦后点击空白未返回全景');
  if (!mapFocus.focusScaleApplied) errors.push('行政区聚焦缩放样式未生效');
  if (!mapFocus.inheritButtonCentered) errors.push('成为传承人按钮未居中');
  if (!homeParticles.visible || !homeParticles.ready || homeParticles.spriteCount < 12 || homeParticles.fieldType !== 'lotus-sprites' || !homeParticles.assetKinds.includes('leaf') || !homeParticles.assetKinds.includes('flower')) errors.push('首页荷花荷叶精灵未完成构建');
  if (homeParticles.flowerCount < 2 || homeParticles.flowerCount > 3 || homeParticles.flowerCount + homeParticles.leafCount !== homeParticles.spriteCount) errors.push('首页荷花数量未限制为 2—3 朵，或其余精灵未全部使用荷叶');
  if (homeParticles.bottomLeftFlowerCount < 1) errors.push('首页左下角没有稳定生成可见荷花');
  if (homeParticles.layout !== 'corner-clusters') errors.push('首页荷花荷叶未限制在左下与右上角落构图');
  if (homeParticles.sourceLayer !== 'wash' || homeParticles.interaction !== 'ripple-return-burst') errors.push('首页粒子采样层或交互模式不正确');
  if (!homeParticles.burstDeferred || !homeParticles.transitionedToMap) errors.push('首页点击爆发与地图转场衔接异常');

  if (!workbench.actionCards || workbench.actionCards < workbench.stepCount || !workbench.previewCanvas || !workbench.gravity || workbench.objectCount < 1) errors.push('工作台完整动作列表、共享粒子桌面或重力物体未挂载');
  if (!workbench.outputSpectrumRemoved || !workbench.selectedBoxRemoved) errors.push('工作台仍显示工序产出色谱或已选材料框');
  if (!workbench.verticalActions || !workbench.tableTextureConfigured || !workbench.detailBackgroundRetained) errors.push('工作台动作未纵向排列、中央桌面图未生效或外层详情背景被替换');
  if (workbench.restoredCount < 1) errors.push('重新选择左侧物品后，已有物体的物理位置没有恢复');
  if (workbench.objectLabelCount !== workbench.objectCount || workbench.visibleObjectLabels < 1 || !workbench.objectLabelOnTable) errors.push('桌面三维物体没有在工作区可视范围内显示随动名称标注');
  if (!workbench.stepGuide || workbench.stepGuideStrongCount < 2) errors.push('桌面上方没有显示带重点加粗的当前工序说明');
  if (!workbench.restoreHandleRemoved) errors.push('工作台左侧仍显示“展开资料”按钮');
  if (!workbench.pointerActionDrag) errors.push('工作台动作未启用可靠的指针拖拽模式');
  if (!workbench.backpackScrollStable) errors.push('点击左侧靠下材料后，背包滚动位置发生跳动');
  if (!workbench.materialPointerDrag || !workbench.materialDragAdded) errors.push('左侧材料无法通过指针拖入桌面工作区');
  if (!workbench.actionArrowInsideCard) errors.push('右侧动作箭头仍可能被工作区或滚动容器遮挡');
  if (!firstMaterialUpgradeDetected) errors.push('完成工序后，材料没有原位升级并作为继承材料自动带入下一步');
  if (!firstRippleDetected) errors.push('正确动作落到工作台后没有触发粒子水波扩散');
  if (idlePreview.deferredButton || !idlePreview.canvas || !idlePreview.finishedAssetLoaded) errors.push('三维预览没有在进入工艺页后自动加载');

  console.log(JSON.stringify({ chat, idlePreview, complete, graph, workbench, firstRippleDetected, modelCoverage, mapOverview, mapFocus, homeParticles, screenshots, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  try {
    ws?.close();
  } catch {
    // Ignore close errors.
  }
  if (browser.exitCode === null) {
    browser.kill();
    await Promise.race([
      new Promise((resolve) => browser.once('exit', resolve)),
      wait(3000),
    ]);
  }
  const resolvedProfile = path.resolve(profile);
  const resolvedTemp = path.resolve(os.tmpdir()) + path.sep;
  if (resolvedProfile.startsWith(resolvedTemp)) {
    try {
      fs.rmSync(resolvedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (error) {
      console.warn(`临时浏览器目录稍后由系统清理：${error.code || error.message}`);
    }
  }
}
