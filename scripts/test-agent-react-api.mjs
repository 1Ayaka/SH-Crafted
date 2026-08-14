import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
});
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1))), '..');
const [modelPort, appPort] = await Promise.all([freePort(), freePort()]);
let upstreamCalls = 0;
const upstream = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    upstreamCalls += 1;
    assert.ok(payload.tools.some((tool) => tool.function.name === 'search_graph'));
    const toolMessages = payload.messages.filter((message) => message.role === 'tool');
    const message = toolMessages.length
      ? { role: 'assistant', content: '已经根据站内执行结果为你打开嘉定竹刻。' }
      : { role: 'assistant', content: '', tool_calls: [{ id: 'call_search', type: 'function', function: { name: 'search_graph', arguments: '{"query":"嘉定竹刻","types":["heritage"]}' } }] };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message }] }));
  });
});
await new Promise((resolve) => upstream.listen(modelPort, '127.0.0.1', resolve));

const app = spawn(process.execPath, ['server.mjs', '--host', '127.0.0.1', '--port', String(appPort)], {
  cwd: root,
  env: { ...process.env, DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_API_BASE: `http://127.0.0.1:${modelPort}`, DEEPSEEK_MODEL: 'test-model', AGENT_LOCAL_ONLY: 'false' },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
const base = `http://127.0.0.1:${appPort}`;
try {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`${base}/`)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (attempt === 59) throw new Error('agent react API server did not start');
  }
  const context = {
    ui_context: { route: '/explore', page_type: 'explore', available_actions: ['search_graph', 'open_heritage_detail'] },
    tool_manifest: [{ name: 'search_graph' }, { name: 'open_heritage_detail' }],
  };
  const first = await fetch(`${base}/api/agent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: '帮我打开嘉定竹刻' }], context }) }).then((response) => response.json());
  assert.equal(first.type, 'tool_calls');
  assert.equal(first.tool_calls[0].name, 'search_graph');
  const react = { iteration: 1, steps: [{ iteration: 1, assistant_content: '', assistant_tool_calls: first.tool_calls, tool_results: [{ ok: true, results: [{ id: 'heritage:SHIH_0001', title: '嘉定竹刻' }] }] }] };
  const second = await fetch(`${base}/api/agent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: '帮我打开嘉定竹刻' }], context, react }) }).then((response) => response.json());
  assert.equal(second.mode, 'model-react');
  assert.match(second.content, /嘉定竹刻/);
  assert.equal(upstreamCalls, 2);
  console.log('agent ReAct API integration tests passed');
} finally {
  const exited = new Promise((resolve) => app.once('exit', resolve));
  app.kill();
  await exited;
  await new Promise((resolve) => upstream.close(resolve));
}
