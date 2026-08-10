import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1))), '..');
const port = await new Promise((resolve, reject) => {
  const listener = net.createServer();
  listener.on('error', reject);
  listener.listen(0, '127.0.0.1', () => { const { port: free } = listener.address(); listener.close(() => resolve(free)); });
});
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server.mjs', '--host', '127.0.0.1', '--port', String(port)], {
  cwd: root, env: { ...process.env, AGENT_LOCAL_ONLY: 'true' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});

try {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`${base}/`)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (attempt === 59) throw new Error('agent local smoke server did not start');
  }
  const cases = [
    {
      query: '嘉定竹刻为什么值得了解？我接下来可以看什么？',
      context: { craft: { id: 'SHIH_0001', title: '嘉定竹刻', claims: [] }, exploration_candidates: [{ id: 'region:jiading', title: '嘉定区', type: 'region', label: '打开关系星图' }] },
      expected: ['嘉定竹刻', '继续探索'],
    },
    {
      query: '这项工艺的材料和制作过程有什么特点？',
      context: { craft: { id: 'SHIH_0001', title: '嘉定竹刻', claims: [] } },
      expected: ['嘉定竹刻'],
    },
  ];
  for (const sample of cases) {
    const response = await fetch(`${base}/api/agent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: sample.query }], context: sample.context }),
    });
    const payload = await response.json();
    if (!response.ok || payload.mode !== 'local-retrieval' || String(payload.content).length < 45) throw new Error(`local agent response invalid: ${response.status} ${JSON.stringify(payload)}`);
    if (sample.expected.some((term) => !payload.content.includes(term))) throw new Error(`local agent missed expected guidance: ${payload.content}`);
    if (/(?:ext_|content_)\w+|https?:\/\//.test(payload.content)) throw new Error(`local agent leaked internal ID or URL: ${payload.content}`);
  }
  console.log('本地智能体 API 冒烟测试通过：知识库应答、探索引导与无密钥链路均可用');
} finally {
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill();
  await exited;
}
