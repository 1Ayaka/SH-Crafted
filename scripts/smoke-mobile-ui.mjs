import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const base = process.argv.find((arg) => arg.startsWith('--base='))?.slice(7) || 'http://127.0.0.1:7100';
const adminUsername = process.env.ADMIN_SMOKE_USERNAME || 'djt';
const adminPassword = process.env.ADMIN_SMOKE_PASSWORD || '12345689';
const edge = process.env['PROGRAMFILES(X86)']
  ? path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tanwuzhi-mobile-ui-'));
const artifactDir = path.resolve('test-artifacts/mobile');
fs.mkdirSync(artifactDir, { recursive: true });

const devices = [
  { name: 'compact', width: 360, height: 800, scale: 1 },
  { name: 'standard', width: 390, height: 844, scale: 1 },
  { name: 'large', width: 430, height: 932, scale: 1 },
];
const pages = [
  { name: 'home', route: '#/', ready: '.home' },
  { name: 'map', route: '#/explore', ready: '.map-view' },
  { name: 'craft', route: '#/craft/SHIH_0001', ready: '.craft-page' },
  { name: 'graph', route: '#/graph', ready: '.heritage-graph-overlay' },
  { name: 'passport', route: '#/passport', ready: '.passport tbody tr' },
  { name: 'community', route: '#/contribute/jiading', ready: '.community-form' },
  { name: 'admin-login', route: '#/admin/login', ready: '.admin-login-card' },
];
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
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true });

let ws;
try {
  let target;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
      target = targets.find((item) => item.type === 'page');
      if (target) break;
    } catch { /* Browser is starting. */ }
    await wait(200);
  }
  if (!target) throw new Error('Unable to connect to headless Edge');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let sequence = 0;
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
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 45000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || 'Page evaluation failed');
    return response.result.value;
  };
  const until = async (expression, timeout = 45000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await evaluate(expression)) return;
      await wait(200);
    }
    throw new Error(`Timed out waiting for ${expression}`);
  };

  await send('Page.enable');
  await send('Runtime.enable');
  const results = [];
  for (const device of devices) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: device.width, height: device.height, deviceScaleFactor: device.scale,
      mobile: true, screenWidth: device.width, screenHeight: device.height,
    });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Page.navigate', { url: `${base}/?mobile-audit=${device.name}#/` });
    await until("Boolean(document.querySelector('.home'))");
    await evaluate("fetch('/api/admin/logout', { method: 'POST' }).then(() => true)");
    for (const page of pages) {
      await send('Page.navigate', { url: `${base}/${page.route}` });
      await until(`Boolean(document.querySelector(${JSON.stringify(page.ready)}))`);
      await wait(page.name === 'map' || page.name === 'graph' ? 1800 : 700);

      const audit = await evaluate(`(() => {
        const width = document.documentElement.clientWidth;
        const insideScroller = (node) => {
          let parent = node.parentElement;
          while (parent && parent !== document.body) {
            const overflow = getComputedStyle(parent).overflowX;
            if ((overflow === 'auto' || overflow === 'scroll') && parent.scrollWidth > parent.clientWidth) return true;
            parent = parent.parentElement;
          }
          return false;
        };
        const ignored = (node) => node.matches('canvas, .bg-stack, .bg-layer, .gesture-hand-canvas, .air-cursor, .heritage-graph-wash, .community-honeypot, .community-honeypot *') ||
          node.closest('[hidden], .bg-stack, .heritage-graph-stage, .map-heritage-marker-layer, .agent-fab') || insideScroller(node) || getComputedStyle(node).display === 'none' ||
          getComputedStyle(node).visibility === 'hidden';
        const offenders = [...document.body.querySelectorAll('*')].filter((node) => {
          if (ignored(node)) return false;
          const rect = node.getBoundingClientRect();
          return rect.width > 1 && (rect.left < -2 || rect.right > width + 2);
        }).slice(0, 8).map((node) => ({
          tag: node.tagName.toLowerCase(), className: String(node.className).slice(0, 90),
          left: Math.round(node.getBoundingClientRect().left), right: Math.round(node.getBoundingClientRect().right),
        }));
        const navToggle = document.querySelector('.topnav-toggle');
        const inputs = [...document.querySelectorAll('input:not([type="hidden"]), textarea, select')].filter((node) => {
          const style = getComputedStyle(node); return style.display !== 'none' && style.visibility !== 'hidden';
        });
        const marker = document.querySelector('.map-heritage-marker');
        return {
          viewport: { width, height: window.innerHeight },
          horizontalOverflow: document.documentElement.scrollWidth - width,
          offenders,
          navToggle: navToggle ? { width: navToggle.getBoundingClientRect().width, height: navToggle.getBoundingClientRect().height } : null,
          minInputFont: inputs.length ? Math.min(...inputs.map((node) => parseFloat(getComputedStyle(node).fontSize))) : null,
          markerTarget: marker ? { width: marker.getBoundingClientRect().width, height: marker.getBoundingClientRect().height } : null,
        };
      })()`);

      if (audit.horizontalOverflow > 2) throw new Error(`${device.name}/${page.name}: page overflows by ${audit.horizontalOverflow}px`);
      if (audit.offenders.length) throw new Error(`${device.name}/${page.name}: offscreen elements ${JSON.stringify(audit.offenders)}`);
      if (audit.navToggle && (audit.navToggle.width < 44 || audit.navToggle.height < 44)) throw new Error(`${device.name}/${page.name}: navigation target is too small`);
      if (audit.minInputFont != null && audit.minInputFont < 16) throw new Error(`${device.name}/${page.name}: input font would trigger browser zoom`);
      if (audit.markerTarget && (audit.markerTarget.width < 44 || audit.markerTarget.height < 44)) throw new Error(`${device.name}/${page.name}: map marker target is too small`);

      if (page.name === 'home') {
        const menu = await evaluate(`(async () => {
          const button = document.querySelector('.topnav-toggle'); button.click();
          await new Promise((resolve) => setTimeout(resolve, 600));
          const nav = document.querySelector('.topnav nav');
          const style = getComputedStyle(nav); const rect = nav.getBoundingClientRect();
          return { expanded: button.getAttribute('aria-expanded'), visible: style.visibility, opacity: style.opacity, display: style.display, transform: style.transform, rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, headerClass: button.closest('.topnav')?.className, route: location.hash, media: matchMedia('(max-width: 680px)').matches };
        })()`);
        if (menu.expanded !== 'true' || menu.visible !== 'visible') throw new Error(`${device.name}/home: mobile navigation does not open ${JSON.stringify(menu)}`);
        await evaluate("document.querySelector('.topnav-toggle').click()");
        await wait(250);
      }

      if (device.name === 'standard') {
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        fs.writeFileSync(path.join(artifactDir, `${page.name}-${device.width}x${device.height}.png`), Buffer.from(shot.data, 'base64'));
      }
      results.push({ device: device.name, page: page.name, ...audit });

      if (device.name === 'standard' && page.name === 'home') {
        await evaluate("import('/js/agent.js').then(({ agent }) => agent.open())");
        await until("document.querySelector('.agent-panel')?.classList.contains('open')");
        await wait(650);
        const agentAudit = await evaluate(`(() => {
          const panel = document.querySelector('.agent-panel').getBoundingClientRect();
          const input = document.querySelector('.ap-input-row input').getBoundingClientRect();
          return { viewportHeight: window.innerHeight, panel: { left: panel.left, right: panel.right, top: panel.top, bottom: panel.bottom }, inputBottom: input.bottom };
        })()`);
        if (agentAudit.panel.left < -1 || agentAudit.panel.right > device.width + 1 || agentAudit.panel.bottom > agentAudit.viewportHeight + 1 || agentAudit.inputBottom > agentAudit.viewportHeight + 1) {
          throw new Error(`standard/agent-panel failed ${JSON.stringify(agentAudit)}`);
        }
        const agentShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        fs.writeFileSync(path.join(artifactDir, `agent-panel-${device.width}x${device.height}.png`), Buffer.from(agentShot.data, 'base64'));
        await evaluate("import('/js/agent.js').then(({ agent }) => agent.close())");
        results.push({ device: device.name, page: 'agent-panel', ...agentAudit });
      }

      if (device.name === 'standard' && page.name === 'map') {
        await until("Boolean(document.querySelector('.map-heritage-marker'))");
        await evaluate("document.querySelector('.map-heritage-marker').click()");
        await until("Boolean(document.querySelector('.map-heritage-preview'))");
        await wait(250);
        const previewAudit = await evaluate(`(() => {
          const rect = document.querySelector('.map-heritage-preview').getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, cards: document.querySelectorAll('.map-heritage-preview-list article').length };
        })()`);
        if (previewAudit.left < -1 || previewAudit.right > device.width + 1 || previewAudit.bottom > device.height + 1 || previewAudit.cards < 1) {
          throw new Error(`standard/map-preview failed ${JSON.stringify(previewAudit)}`);
        }
        const previewShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        fs.writeFileSync(path.join(artifactDir, `map-preview-${device.width}x${device.height}.png`), Buffer.from(previewShot.data, 'base64'));
        await evaluate("document.querySelector('.map-heritage-preview-close').click()");
        results.push({ device: device.name, page: 'map-preview', ...previewAudit });

        await evaluate(`(() => {
          const input = document.querySelector('.toolbar input[type="search"]');
          input.value = '嘉定区'; input.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
        await until("[...document.querySelectorAll('.map-search-result')].some((node) => node.textContent.includes('嘉定区'))");
        await evaluate("[...document.querySelectorAll('.map-search-result')].find((node) => node.textContent.includes('嘉定区')).click()");
        await until("Boolean(document.querySelector('.district-story'))");
        await wait(350);
        const districtAudit = await evaluate(`(() => {
          const panel = document.querySelector('.district-story'); const rect = panel.getBoundingClientRect();
          const toggle = panel.querySelector('.district-story-mobile-toggle');
          const toggleRect = toggle.getBoundingClientRect(); const hit = document.elementFromPoint(toggleRect.left + toggleRect.width / 2, toggleRect.top + toggleRect.height / 2);
          const back = panel.querySelector('.district-story-back'); const backRect = back.getBoundingClientRect(); const backHit = document.elementFromPoint(backRect.left + backRect.width / 2, backRect.top + backRect.height / 2);
          return { top: rect.top, bottom: rect.bottom, height: rect.height, toggleVisible: getComputedStyle(toggle).display !== 'none', toggleReachable: hit === toggle || toggle.contains(hit), backReachable: backHit === back || back.contains(backHit), expanded: toggle.getAttribute('aria-expanded') };
        })()`);
        if (districtAudit.height > 170 || !districtAudit.toggleVisible || !districtAudit.toggleReachable || !districtAudit.backReachable || districtAudit.expanded !== 'false' || districtAudit.top < device.height * .68) {
          throw new Error(`standard/map-district-compact failed ${JSON.stringify(districtAudit)}`);
        }
        const districtShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        fs.writeFileSync(path.join(artifactDir, `map-district-${device.width}x${device.height}.png`), Buffer.from(districtShot.data, 'base64'));
        await evaluate("document.querySelector('.district-story-mobile-toggle').click()");
        await wait(280);
        const expandedDistrict = await evaluate(`(() => {
          const panel = document.querySelector('.district-story'); const rect = panel.getBoundingClientRect();
          return { height: rect.height, expanded: panel.classList.contains('is-mobile-expanded'), ariaExpanded: panel.querySelector('.district-story-mobile-toggle').getAttribute('aria-expanded') };
        })()`);
        if (!expandedDistrict.expanded || expandedDistrict.ariaExpanded !== 'true' || expandedDistrict.height <= districtAudit.height || expandedDistrict.height > device.height * .54) {
          throw new Error(`standard/map-district-expanded failed ${JSON.stringify(expandedDistrict)}`);
        }
        results.push({ device: device.name, page: 'map-district', ...districtAudit });
      }

      if (device.name === 'standard' && page.name === 'craft') {
        await until("Boolean(document.querySelector('.wb-idle .btn-primary'))");
        await evaluate("document.querySelector('.wb-idle .btn-primary').click()");
        await until("Boolean(document.querySelector('.wb-play'))");
        await wait(350);
        const workbenchAudit = await evaluate(`(() => {
          const rect = document.querySelector('.workbench-col').getBoundingClientRect();
          const backpack = document.querySelector('.wb-play-physics .backpack').getBoundingClientRect();
          const main = document.querySelector('.wb-play-physics .wb-main').getBoundingClientRect();
          const execute = document.querySelector('.wb-mobile-execute');
          return {
            left: rect.left, right: rect.right, width: rect.width,
            actionTargets: [...document.querySelectorAll('.wb-play button')].filter((node) => node.getBoundingClientRect().height >= 40).length,
            interactionMode: document.querySelector('.wb-table-surface')?.dataset.interactionMode,
            executeVisible: execute && getComputedStyle(execute).display !== 'none' && execute.getBoundingClientRect().height >= 44,
            verticalFlow: main.top >= backpack.bottom - 1,
          };
        })()`);
        if (workbenchAudit.left < -1 || workbenchAudit.right > device.width + 1 || workbenchAudit.actionTargets < 1 || workbenchAudit.interactionMode !== 'scroll-safe' || !workbenchAudit.executeVisible || !workbenchAudit.verticalFlow) {
          throw new Error(`standard/craft-workbench failed ${JSON.stringify(workbenchAudit)}`);
        }
        const workbenchShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        fs.writeFileSync(path.join(artifactDir, `craft-workbench-${device.width}x${device.height}.png`), Buffer.from(workbenchShot.data, 'base64'));
        await evaluate("document.querySelector('.wb-mobile-execute').scrollIntoView({ block: 'center' })");
        await wait(250);
        const executeReachable = await evaluate(`(() => {
          const button = document.querySelector('.wb-mobile-execute'); const rect = button.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return hit === button || button.contains(hit);
        })()`);
        if (!executeReachable) throw new Error('standard/craft-workbench: mobile execute action is covered');
        const actionShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        fs.writeFileSync(path.join(artifactDir, `craft-actions-${device.width}x${device.height}.png`), Buffer.from(actionShot.data, 'base64'));
        results.push({ device: device.name, page: 'craft-workbench', ...workbenchAudit });
      }

      if (device.name === 'standard' && page.name === 'admin-login') {
        await evaluate(`(() => {
          const setValue = (input, value) => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
          };
          setValue(document.querySelector('input[name="username"]'), ${JSON.stringify(adminUsername)});
          setValue(document.querySelector('input[name="password"]'), ${JSON.stringify(adminPassword)});
          document.querySelector('.admin-login-card').requestSubmit();
        })()`);
        await until("location.hash === '#/admin' && Boolean(document.querySelector('.admin-dashboard'))");
        await wait(700);
        const dashboardAudit = await evaluate(`({
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          cards: document.querySelectorAll('.admin-craft-card').length,
          brandPanel: Boolean(document.querySelector('.admin-brand-panel')),
          minInputFont: Math.min(...[...document.querySelectorAll('input, textarea, select')].map((node) => parseFloat(getComputedStyle(node).fontSize)))
        })`);
        if (dashboardAudit.overflow > 2 || dashboardAudit.cards < 1 || !dashboardAudit.brandPanel || dashboardAudit.minInputFont < 16) {
          throw new Error(`standard/admin-dashboard failed ${JSON.stringify(dashboardAudit)}`);
        }
        const dashboardShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        fs.writeFileSync(path.join(artifactDir, `admin-dashboard-${device.width}x${device.height}.png`), Buffer.from(dashboardShot.data, 'base64'));

        await send('Page.navigate', { url: `${base}/#/admin/craft/SHIH_0001` });
        await until("Boolean(document.querySelector('.admin-step-editor'))");
        await wait(700);
        const editorAudit = await evaluate(`({
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          tabs: document.querySelectorAll('.admin-step-tab').length,
          contentEditor: Boolean(document.querySelector('.admin-content-editor')),
          graphEditor: Boolean(document.querySelector('.admin-graph-editor')),
          minInputFont: Math.min(...[...document.querySelectorAll('input, textarea, select')].map((node) => parseFloat(getComputedStyle(node).fontSize)))
        })`);
        if (editorAudit.overflow > 2 || editorAudit.tabs < 1 || !editorAudit.contentEditor || !editorAudit.graphEditor || editorAudit.minInputFont < 16) {
          throw new Error(`standard/admin-editor failed ${JSON.stringify(editorAudit)}`);
        }
        const editorShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        fs.writeFileSync(path.join(artifactDir, `admin-editor-${device.width}x${device.height}.png`), Buffer.from(editorShot.data, 'base64'));
        results.push({ device: device.name, page: 'admin-dashboard', ...dashboardAudit });
        results.push({ device: device.name, page: 'admin-editor', ...editorAudit });
      }
    }
  }
  fs.writeFileSync(path.join(artifactDir, 'report.json'), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`Mobile UI passed: ${results.length} viewport/page combinations.`);
  console.log(`Artifacts: ${artifactDir}`);
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  browser.kill();
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 }); } catch { /* Edge may still be releasing its profile on Windows. */ }
}
