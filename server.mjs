// SH-Crafted v1：依赖为零的静态文件服务器（node:http）+ DeepSeek 代理（/api/agent）
// 用法: npm run dev -- --port 7100 --host 127.0.0.1
// 也支持环境变量 PORT / HOST，默认端口 7100
// 安全规则：
// - 拒绝伺服任何点文件（.env 等）——路径任一段以 . 开头即 403
// - DeepSeek 密钥只存在于服务器进程内（启动时从 .env 或 DEEPSEEK_API_KEY 读取），
//   绝不发送给浏览器、绝不打印日志
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.split('=')[1] : undefined;
}

const PORT = Number(arg('port') || process.env.PORT || 7100);
const HOST = arg('host') || process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.fbx': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
};

// ---------- DeepSeek 密钥（仅服务器进程内） ----------
// 优先级：环境变量 DEEPSEEK_API_KEY > 项目根 .env。
// .env 推荐格式：DEEPSEEK_API_KEY=sk-...；同时兼容旧格式 api key:sk-...。
async function loadApiKey() {
  if (process.env.DEEPSEEK_API_KEY?.trim()) return process.env.DEEPSEEK_API_KEY.trim();
  try {
    const raw = await readFile(join(ROOT, '.env'), 'utf-8');
    const line = raw.split(/\r?\n/).find((l) => l.trim() && !l.trim().startsWith('#'));
    if (!line) return null;
    const match = line.match(/^\s*DEEPSEEK_API_KEY\s*=\s*(.+?)\s*$/i)
      || line.match(/^\s*api\s*key\s*:\s*(.+?)\s*$/i);
    const val = (match?.[1] || line).trim().replace(/^['"]|['"]$/g, '');
    return val || null;
  } catch {
    return null;
  }
}
const DEEPSEEK_KEY = await loadApiKey();
console.log(`DeepSeek 代理：${DEEPSEEK_KEY ? '已配置密钥（/api/agent 可用）' : '未配置密钥（/api/agent 将返回 503，前端自动降级）'}`);

// 由前端上下文组装系统提示：小蕉人设 + 资料约束 + 证据引用规则
function buildSystemPrompt(ctx = {}) {
  const craft = ctx.craft || {};
  const lines = [
    '你是「小蕉」，一只正在收集上海非物质文化遗产资料的小猫助手，说话带一点猫的气质但克制。',
    '规则：',
    '1. 证据优先：只依据下面提供的本项目资料（纪录片转写与知识草稿）回答；资料未提及的内容，回答「现有资料无法确认」，绝不编造。',
    '2. 引用证据时附上时间码，格式【mm:ss–mm:ss】。',
    '3. 所有资料均为 AI 自动抽取的草稿（待人工审核），涉及事实表述时自然地带出「待审核」意识。',
    '4. 你不是传承人，不冒充传承人，不提供真实工艺教学级指导。',
    '5. 回答简洁（一般不超过 150 字），可用短句分点。',
    '',
    `当前项目：${craft.title || '未知'}（${craft.id || ''}）`,
  ];
  if (ctx.current_step) lines.push(`用户当前工序：${ctx.current_step}`);
  if (ctx.inventory) lines.push(`用户材料状态：${ctx.inventory}`);
  if (ctx.failure_count) lines.push(`用户已连续失败 ${ctx.failure_count} 次，可适当鼓励但不代做。`);
  if (craft.steps?.length) {
    lines.push('', '候选工序（待审核）：');
    craft.steps.forEach((s, i) => lines.push(`${i + 1}. ${s.name}——${s.action}`));
  }
  if (craft.claims?.length) {
    lines.push('', '知识草稿（自动抽取，待审核）：');
    craft.claims.forEach((c) => lines.push(`- ${c}`));
  }
  if (craft.evidence?.length) {
    lines.push('', '相关纪录片证据（可引用时间码）：');
    craft.evidence.forEach((e) => lines.push(`- 【${e.timecode}】${e.text}`));
  }
  return lines.join('\n');
}

async function handleAgentApi(req, res) {
  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  if (req.method !== 'POST') { json(405, { error: 'method_not_allowed' }); return; }
  if (!DEEPSEEK_KEY) { json(503, { error: 'no_api_key' }); return; }
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 64 * 1024) req.destroy(); // 限制 64KB
  });
  req.on('end', async () => {
    try {
      const payload = JSON.parse(body || '{}');
      const userMsg = String(payload.messages?.at(-1)?.content || '').slice(0, 2000);
      if (!userMsg) { json(400, { error: 'empty_message' }); return; }
      const system = buildSystemPrompt(payload.context);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      const upstream = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DEEPSEEK_KEY}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userMsg },
          ],
          temperature: 0.3,
          max_tokens: 600,
          stream: false,
        }),
      });
      clearTimeout(timer);
      if (!upstream.ok) { json(502, { error: `upstream_${upstream.status}` }); return; }
      const data = await upstream.json();
      const content = data?.choices?.[0]?.message?.content || '';
      if (!content) { json(502, { error: 'empty_upstream' }); return; }
      json(200, { content });
    } catch (err) {
      json(err?.name === 'AbortError' ? 504 : 502, { error: err?.name === 'AbortError' ? 'timeout' : 'proxy_error' });
    }
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (urlPath === '/api/agent') { await handleAgentApi(req, res); return; }
    // 硬阻断：任何点文件（.env、.git 等）不伺服
    if (urlPath.split('/').some((seg) => seg.startsWith('.'))) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('403 Forbidden');
      return;
    }
    let filePath = urlPath;
    if (filePath.endsWith('/')) filePath += 'index.html';
    const resolved = normalize(join(ROOT, filePath));
    if (!resolved.startsWith(normalize(ROOT))) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const st = await stat(resolved).catch(() => null);
    const target = st && st.isDirectory() ? join(resolved, 'index.html') : resolved;
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`SH-Crafted v1 已启动: http://localhost:${PORT}/`);
});
