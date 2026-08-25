import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const base = process.argv.find((arg) => arg.startsWith('--base='))?.slice(7) || 'http://127.0.0.1:7100';
const edge = process.env['PROGRAMFILES(X86)']
  ? path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-crafted-agent-workbench-'));
const outputDir = path.resolve('test-results');
const auditFile = path.join(outputDir, 'workbench-agent-audit.json');
const screenshotFile = path.join(outputDir, 'workbench-agent-final.png');
const mobileScreenshotFile = path.join(outputDir, 'workbench-agent-mobile.png');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

fs.mkdirSync(outputDir, { recursive: true });
const port = await freePort();
const browser = spawn(edge, [
  '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true });

let ws;
try {
  let target;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
      target = targets.find((item) => item.type === 'page');
      if (target) break;
    } catch { /* browser is starting */ }
    await wait(200);
  }
  if (!target) throw new Error('无法连接测试浏览器');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0;
  const pending = new Map();
  const browserErrors = [];
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id) {
      if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params?.exceptionDetails?.text || 'Runtime exception');
      if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') browserErrors.push(message.params.entry.text);
      return;
    }
    const promise = pending.get(message.id);
    if (!promise) return;
    pending.delete(message.id);
    clearTimeout(promise.timer);
    if (message.error) promise.reject(new Error(message.error.message));
    else promise.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`浏览器指令超时：${method}`)); }, 30000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || '页面脚本执行失败');
    return result.result.value;
  };
  const waitForRun = async (previousRunId = '') => {
    for (let attempt = 0; attempt < 160; attempt++) {
      const run = await evaluate(`(() => {
        const run = window.__workbenchAgentLastRun;
        return run?.finished_at && run.run_id !== ${JSON.stringify(previousRunId)} ? run : null;
      })()`);
      if (run) return run;
      await wait(100);
    }
    throw new Error('智能体工作台执行超过 16 秒仍未结束');
  };
  const ask = async (query) => {
    await evaluate(`(() => {
      const input = document.querySelector('.ap-input-row input');
      if (!input) return false;
      input.value = ${JSON.stringify(query)};
      document.querySelector('.ap-input-row .btn')?.click();
      return true;
    })()`);
  };
  const clickQuickFill = async () => evaluate(`(() => {
    const button = document.querySelector('.btn-quick-fill');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${base}/#/craft/SHIH_0001` });
  await wait(4200);
  await evaluate("document.querySelector('[data-agent-target=\"workbench-enter\"]')?.click()");
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await evaluate("Boolean(document.querySelector('.btn-quick-fill'))")) break;
    await wait(100);
  }
  assert.equal(await evaluate("document.querySelector('.agent-panel')?.classList.contains('open') || false"), false, '点击一键填入前智能体面板不应强制打开');
  await evaluate(`(() => {
    window.__agentFlightObserved = 0;
    window.__agentFlightObserver = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node.nodeType === 1 && (node.matches?.('.agent-action-flight') || node.querySelector?.('.agent-action-flight'))) window.__agentFlightObserved += 1;
      }
    });
    window.__agentFlightObserver.observe(document.body, { childList: true, subtree: true });
    window.__agentRippleObserved = 0;
    window.__agentRippleObserver = new MutationObserver((records) => {
      for (const record of records) {
        if (record.target?.dataset?.ripple === 'active') window.__agentRippleObserved += 1;
      }
    });
    window.__agentRippleObserver.observe(document.querySelector('.workbench-col'), {
      attributes: true,
      subtree: true,
      attributeFilter: ['data-ripple'],
    });
  })()`);

  const startedAt = Date.now();
  const stepTotal = await evaluate(`Number(document.querySelector('.wb-step-bar .cur')?.textContent.match(/\\/(\\d+)/)?.[1] || 0)`);
  assert.ok(stepTotal > 0, '未能读取当前项目的工序总数');
  const runs = [];
  let previousRunId = '';
  for (let index = 0; index < stepTotal; index++) {
    assert.equal(await clickQuickFill(), true, `第 ${index + 1} 道工序的一键填入按钮不可用`);
    if (index === 0) {
      await wait(120);
      await ask('小蕉，帮我重复完成当前工序');
    }
    const run = await waitForRun(previousRunId);
    runs.push(run);
    previousRunId = run.run_id;
  }
  const first = runs[0];
  const last = runs.at(-1);
  await ask('小蕉，再完成当前工序');
  await wait(260);
  const elapsedMs = Date.now() - startedAt;

  const ui = await evaluate(`(() => ({
    panel_open: document.querySelector('.agent-panel')?.classList.contains('open') || false,
    trace_count: document.querySelectorAll('.ap-execution-trace').length,
    failed_trace_steps: document.querySelectorAll('.ap-execution-steps li[data-state="error"]').length,
    pending_trace_steps: document.querySelectorAll('.ap-execution-steps li[data-state="pending"], .ap-execution-steps li[data-state="running"]').length,
    flight_residue: document.querySelectorAll('.agent-action-flight').length,
    target_residue: document.querySelectorAll('.agent-action-target').length,
    body_locked: document.querySelector('.craft-body')?.classList.contains('agent-operating') || false,
    workbench_busy: document.querySelector('.workbench-col')?.dataset.agentBusy || '',
    current_step: document.querySelector('.wb-step-bar .cur')?.textContent || '',
    context_text: document.querySelector('.ap-context')?.textContent || '',
    horizontal_overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    flight_observed: Number(window.__agentFlightObserved || 0),
    ripple_observed: Number(window.__agentRippleObserved || 0),
    audit: window.__workbenchAgentAudit || [],
    concurrency_notice: [...document.querySelectorAll('.ap-msg.agent .bubble')].some((node) => node.textContent.includes('避免两套操作互相覆盖')),
  }))()`);

  assert.equal(first.ok, true, '第一轮模拟用户任务未通过验证');
  assert.equal(runs.every((run) => run.ok), true, '至少一轮连续任务未通过验证');
  for (let index = 1; index < runs.length; index++) {
    assert.equal(runs[index].before.step_index, runs[index - 1].after.step_index, `第 ${index + 1} 轮没有从上一轮结果继续`);
  }
  assert.equal(runs.every((run) => run.after.busy === false), true, '至少一轮最终审计快照仍处于忙碌状态');
  assert.equal(last.after.phase, 'finishing', '全部工序后没有进入作品收尾态');
  assert.equal(last.after.step_index, last.after.step_total, '全部工序后步骤计数不一致');
  assert.equal(await evaluate(`window.__workbenchAgentLastRun?.run_id`), last.run_id, '终止态重复命令仍启动了新的执行计划');
  assert.equal(await evaluate(`[...document.querySelectorAll('.ap-msg.agent .bubble')].some((node) => node.textContent.includes('已经全部完成'))`), true, '终止态重复命令没有给出完成说明');
  assert.equal(ui.panel_open, true, '智能体完成操作后意外收起面板');
  assert.match(ui.context_text, /步骤：全部工序已完成/, '收尾态智能体上下文仍显示未开始');
  assert.equal(ui.trace_count, stepTotal, '对话中的可审查轨迹数量与工序数不一致');
  assert.equal(ui.failed_trace_steps, 0, '执行轨迹中出现失败步骤');
  assert.equal(ui.pending_trace_steps, 0, '执行结束后仍有悬挂步骤');
  assert.equal(ui.flight_residue, 0, '飞行动画节点未清理');
  assert.equal(ui.target_residue, 0, '目标高亮状态未清理');
  assert.equal(ui.body_locked, false, '工作台执行锁未释放');
  assert.equal(ui.workbench_busy, 'false', '工作台 aria-busy 状态未恢复');
  assert.equal(ui.horizontal_overflow, false, '新增执行界面造成水平溢出');
  assert.ok(ui.flight_observed >= runs.reduce((sum, run) => sum + run.events.length, 0) - 1, '真实工具调用没有触发足够的飞行动画');
  assert.ok(ui.ripple_observed >= stepTotal, '智能体执行工序时没有触发足够的工作台反馈动画');
  assert.equal(ui.concurrency_notice, true, '并发重复提交没有给出安全提示');
  assert.equal(ui.audit.filter((entry) => entry.type === 'concurrent_request_rejected').length, 1, '并发请求没有被精确拒绝一次');
  assert.deepEqual(browserErrors, [], `浏览器运行错误：${browserErrors.join('；')}`);
  assert.ok(elapsedMs < stepTotal * 5000, `完整工序执行耗时过长：${elapsedMs}ms`);

  const desktopScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(screenshotFile, Buffer.from(desktopScreenshot.data, 'base64'));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await wait(450);
  const mobile = await evaluate(`(() => {
    const panel = document.querySelector('.agent-panel')?.getBoundingClientRect();
    const traces = [...document.querySelectorAll('.ap-execution-trace')].map((node) => node.getBoundingClientRect());
    return {
      horizontal_overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      panel_inside_viewport: Boolean(panel && panel.left >= -1 && panel.right <= innerWidth + 1),
      traces_inside_panel: Boolean(panel && traces.every((rect) => rect.left >= panel.left - 1 && rect.right <= panel.right + 1)),
      pending_trace_steps: document.querySelectorAll('.ap-execution-steps li[data-state="pending"], .ap-execution-steps li[data-state="running"]').length,
    };
  })()`);
  assert.equal(mobile.horizontal_overflow, false, '移动端智能体面板造成水平溢出');
  assert.equal(mobile.panel_inside_viewport, true, '移动端智能体面板超出视口');
  assert.equal(mobile.traces_inside_panel, true, '移动端执行轨迹超出智能体面板');
  assert.equal(mobile.pending_trace_steps, 0, '移动端仍显示悬挂执行步骤');
  const mobileScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(mobileScreenshotFile, Buffer.from(mobileScreenshot.data, 'base64'));

  const report = {
    generated_at: new Date().toISOString(),
    scenario: `用户连续点击“一键填入”让小蕉完成 ${stepTotal} 道工作台工序，并在收尾态测试重复命令`,
    elapsed_ms: elapsedMs,
    runs,
    ui,
    mobile,
    browser_errors: browserErrors,
  };
  fs.writeFileSync(auditFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, elapsed_ms: elapsedMs, steps: runs.map((run) => run.before.current_step.name), final_phase: last.after.phase, audit_file: auditFile, screenshot_file: screenshotFile, mobile_screenshot_file: mobileScreenshotFile }, null, 2));
} finally {
  ws?.close();
  if (!browser.killed) browser.kill();
  await Promise.race([new Promise((resolve) => browser.once('exit', resolve)), wait(2000)]);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 }); } catch { /* browser profile releases asynchronously */ }
}
