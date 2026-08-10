import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1))), '..');
const freePort = () => new Promise((resolve, reject) => {
  const listener = net.createServer();
  listener.on('error', reject);
  listener.listen(0, '127.0.0.1', () => { const { port } = listener.address(); listener.close(() => resolve(port)); });
});
const appPort = await freePort();
const debugPort = await freePort();
const base = `http://127.0.0.1:${appPort}`;
const app = spawn(process.execPath, ['server.mjs', '--host', '127.0.0.1', '--port', String(appPort)], { cwd: root, stdio: 'ignore', windowsHide: true });
const edge = process.env['PROGRAMFILES(X86)']
  ? path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-crafted-new-models-'));
const browser = spawn(edge, ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let ws;

try {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`${base}/`)).ok) break; } catch {}
    await wait(120);
    if (attempt === 59) throw new Error('local server did not start');
  }
  let target;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { target = (await fetch(`http://127.0.0.1:${debugPort}/json`).then((response) => response.json())).find((item) => item.type === 'page'); } catch {}
    if (target) break;
    await wait(120);
  }
  if (!target) throw new Error('headless browser did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    clearTimeout(task.timer);
    if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timeout`)); }, 30000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'page evaluation failed');
    return result.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const models = {
    SHIH_0002: 'nanqiao-torn-paper-finished.web.glb',
    SHIH_0005: 'chongming-handwoven-cloth-finished.web.glb',
    SHIH_0006: 'shanghai-calendar-poster-finished.web.glb',
  };
  const results = {};
  for (const [craftId, assetName] of Object.entries(models)) {
    const response = await fetch(`${base}/assets/models/crafts/${assetName}`);
    const served = { status: response.status, bytes: Number(response.headers.get('content-length') || 0), type: response.headers.get('content-type') || '' };
    await response.body?.cancel();
    await send('Page.navigate', { url: `${base}/?model-test=${craftId}#/craft/${craftId}` });
    let state = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      state = await evaluate(`(() => {
        const canvas = document.querySelector('.wb-idle .pm-canvas');
        const bounds = canvas?.getBoundingClientRect();
        return {
          title: document.querySelector('.craft-head h2')?.textContent || '',
          canvas: Boolean(canvas && bounds.width > 0 && bounds.height > 0),
          mode: canvas?.dataset.modelMode || '',
          loading: Boolean(document.querySelector('.wb-idle .pm-loading')),
          retry: Boolean(document.querySelector('.wb-idle .pm-load-button')),
          assetLoaded: performance.getEntriesByType('resource').some((entry) => entry.name.includes('${assetName}')),
        };
      })()`);
      if (state.canvas && state.assetLoaded && !state.loading || state.retry) break;
      await wait(180);
    }
    const screenshot = path.join(os.tmpdir(), `sh-crafted-${craftId.toLowerCase()}-new-model.png`);
    const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(screenshot, Buffer.from(image.data, 'base64'));
    results[craftId] = { assetName, served, screenshot, ...state };
  }
  const errors = Object.entries(results).filter(([, item]) => item.served.status !== 200 || item.served.bytes < 1000 || !item.served.type.includes('model/gltf-binary') || !item.canvas || !item.assetLoaded || item.loading || item.retry);
  console.log(JSON.stringify({ results, errors: errors.map(([id]) => `${id} model failed`) }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  browser.kill();
  app.kill();
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 }); } catch {}
}
