// SH-Crafted v1：依赖为零的静态文件服务器（node:http）+ DeepSeek 代理（/api/agent）
// 用法: npm run dev -- --port 7100 --host 127.0.0.1
// 也支持环境变量 PORT / HOST，默认端口 7100
// 安全规则：
// - 拒绝伺服任何点文件（.env 等）——路径任一段以 . 开头即 403
// - DeepSeek 密钥只存在于服务器进程内（启动时从 .env 或 DEEPSEEK_API_KEY 读取），
//   绝不发送给浏览器、绝不打印日志
import http from 'node:http';
import { chmod, copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContentSeed } from './scripts/content-seed.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

async function loadLocalEnv() {
  try {
    const raw = await readFile(join(ROOT, '.env'), 'utf8');
    const values = {};
    for (const sourceLine of raw.split(/\r?\n/)) {
      const line = sourceLine.trim();
      if (!line || line.startsWith('#')) continue;
      const match = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/i);
      if (!match) continue;
      values[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
    return values;
  } catch {
    return {};
  }
}

const LOCAL_ENV = await loadLocalEnv();
const env = (name, fallback = '') => process.env[name] ?? LOCAL_ENV[name] ?? fallback;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.split('=')[1] : undefined;
}

const PORT = Number(arg('port') || env('PORT', '7100'));
const HOST = arg('host') || env('HOST', '0.0.0.0');
const ADMIN_USERNAME = env('ADMIN_USERNAME', 'djt');
const ADMIN_PASSWORD = env('ADMIN_PASSWORD', '12345689');
const ADMIN_COOKIE_SECURE = env('ADMIN_COOKIE_SECURE', 'false').toLowerCase() === 'true';
const configuredLoginMaxAttempts = Number(env('ADMIN_LOGIN_MAX_ATTEMPTS', '50'));
const ADMIN_LOGIN_MAX_ATTEMPTS = Number.isFinite(configuredLoginMaxAttempts)
  ? Math.min(200, Math.max(10, Math.trunc(configuredLoginMaxAttempts)))
  : 50;
const ADMIN_LOGIN_WINDOW_MS = 10 * 60 * 1000;
const configuredContentStorePath = env('CONTENT_STORE_PATH').trim();
const CONTENT_STORE_PATH = normalize(configuredContentStorePath || join(ROOT, '.content', 'content.json'));
const configuredCommunityStorePath = env('COMMUNITY_STORE_PATH').trim();
const COMMUNITY_STORE_PATH = normalize(configuredCommunityStorePath || join(ROOT, '.content', 'community.json'));
const CONTENT_SEED = await buildContentSeed();
const sessions = new Map();
const loginAttempts = new Map();
const submissionAttempts = new Map();
let editableContent;
let contentWriteQueue = Promise.resolve();
let communityState;
let communityWriteQueue = Promise.resolve();

// ---------- 统一知识库索引 ----------
// 启动时一次性装入内存。网页问答与 /api/kb/search 共用同一检索函数，
// 避免 799+ 条索引只存在于磁盘却没有进入实际回答链路。
async function loadKnowledgeBase() {
  try {
    const [indexRaw, sourceRaw] = await Promise.all([
      readFile(join(ROOT, 'data', 'knowledge-base', 'index.jsonl'), 'utf-8'),
      readFile(join(ROOT, 'data', 'knowledge-base', 'sources.json'), 'utf-8'),
    ]);
    const chunks = indexRaw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(JSON.parse);
    const sourceDoc = JSON.parse(sourceRaw);
    const sources = new Map((sourceDoc.sources || []).map((source) => [source.source_id, source]));
    return { chunks, sources };
  } catch (err) {
    console.warn(`知识库载入失败：${err?.message || 'unknown error'}`);
    return { chunks: [], sources: new Map() };
  }
}

const KNOWLEDGE_BASE = await loadKnowledgeBase();
console.log(`知识库检索：已载入 ${KNOWLEDGE_BASE.chunks.length} 条索引片段、${KNOWLEDGE_BASE.sources.size} 个来源`);

function searchUnits(value) {
  const clean = String(value || '').toLowerCase().replace(/[\s，。！？、；：“”‘’（）《》·…—,.!?;:()"']/g, '');
  const units = new Set();
  for (const part of String(value || '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (part.length >= 2) units.add(part);
  }
  for (let i = 0; i < clean.length - 1; i++) units.add(clean.slice(i, i + 2));
  for (const char of clean) units.add(char);
  return { clean, units };
}

function publicSource(source) {
  if (!source) return null;
  return {
    source_id: source.source_id,
    title: source.title,
    publisher: source.publisher,
    url: source.url,
    authority_tier: source.authority_tier,
    source_type: source.source_type,
  };
}

function searchKnowledge(query, craftId = null, limit = 8) {
  const q = searchUnits(query);
  if (!q.clean || !KNOWLEDGE_BASE.chunks.length) return [];
  const kindBoost = { external_fact: 6, video_summary: 4, video_claim: 3, video_evidence: 2, process_step: 2, source_profile: 1, entity: 0 };
  const authorityBoost = { A: 4, B: 3, C: 1 };
  return KNOWLEDGE_BASE.chunks
    .filter((chunk) => !craftId || !chunk.craft_ids?.length || chunk.craft_ids.includes(craftId))
    .map((chunk) => {
      const haystack = `${chunk.title || ''}${chunk.text || ''}`;
      const h = searchUnits(haystack);
      let score = q.clean.length >= 2 && h.clean.includes(q.clean) ? 18 : 0;
      for (const unit of q.units) {
        if (!h.units.has(unit)) continue;
        score += unit.length >= 2 ? 3 : 0.22;
      }
      if (craftId && chunk.craft_ids?.includes(craftId)) score += 2;
      if (score > 0) score += kindBoost[chunk.kind] || 0;
      if (score > 0) score += authorityBoost[chunk.authority_tier] || 0;
      if (score > 0 && chunk.review_status === 'verified_external') score += 3;
      return { chunk, score };
    })
    .filter(({ score }) => score >= 3)
    .sort((a, b) => b.score - a.score || a.chunk.chunk_id.localeCompare(b.chunk.chunk_id))
    .slice(0, Math.min(Math.max(Number(limit) || 8, 1), 12))
    .map(({ chunk, score }) => ({
      chunk_id: chunk.chunk_id,
      kind: chunk.kind,
      title: chunk.title,
      text: String(chunk.text || '').slice(0, 700),
      craft_ids: chunk.craft_ids || [],
      evidence_ids: chunk.evidence_ids || [],
      authority_tier: chunk.authority_tier || null,
      review_status: chunk.review_status,
      score: Number(score.toFixed(2)),
      sources: (chunk.source_ids || []).map((id) => publicSource(KNOWLEDGE_BASE.sources.get(id))).filter(Boolean),
    }));
}

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
  return env('DEEPSEEK_API_KEY').trim() || null;
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
  if (craft.external_facts?.length) {
    lines.push('', '外部权威资料（摘要条目；A为国家/市级权威来源，B为市/区政府与文化主管部门，C为官方文旅平台）：');
    craft.external_facts.forEach((fact) => {
      const refs = (fact.sources || []).map((source) => `${source.publisher}〔${source.authority_tier}〕 ${source.url}`).join('；');
      lines.push(`- [${fact.fact_id}] ${fact.statement}（状态：${fact.review_status}；来源：${refs}）`);
    });
    lines.push('回答使用外部资料时，应在相关句末标注事实编号，如[ext_SHIH_0001_001]；不得把needs_review条目表述为定论。');
  }
  if (ctx.retrieved_knowledge?.length) {
    lines.push('', '统一知识库针对本次问题检索到的片段（按相关度排序）：');
    ctx.retrieved_knowledge.forEach((item) => {
      const refs = (item.sources || []).map((source) => `${source.publisher}〔${source.authority_tier}〕 ${source.url}`).join('；');
      lines.push(`- [${item.chunk_id}] ${item.title || item.kind}：${item.text}${refs ? `（来源：${refs}）` : ''}（状态：${item.review_status || '未知'}）`);
    });
    lines.push('优先使用高相关且有 A/B 级来源的片段。使用外部来源时标注片段编号；needs_review 与自动抽取内容必须明确为待审核。');
  }
  return lines.join('\n');
}

function readJsonBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error('body_too_large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

const makeRevision = () => `${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`;
const cleanText = (value, max = 5000) => String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
const cleanList = (value, maxItems = 40) => [...new Set((Array.isArray(value) ? value : [])
  .map((item) => cleanText(item, 100)).filter(Boolean))].slice(0, maxItems);
const COMMUNITY_DISTRICTS = new Set(CONTENT_SEED.districts.map((district) => district.id));

function cleanPublicUrl(value) {
  const source = cleanText(value, 1200);
  if (!source) return '';
  try {
    const parsed = new URL(source);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

function normalizeSubmissionSteps(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((step, index) => {
    const name = cleanText(step?.name, 160) || `工序 ${index + 1}`;
    const materials = cleanList(step?.materials, 30);
    const tools = cleanList(step?.tools, 20);
    const actionLabels = cleanList(step?.actions, 15);
    const actions = (actionLabels.length ? actionLabels : [name]).map((label, actionIndex) => ({
      id: `action_${index + 1}_${actionIndex + 1}`,
      label,
    }));
    return {
      name,
      action: cleanText(step?.description, 3000),
      result: cleanText(step?.result, 1000),
      materials,
      tools,
      actions,
      correct_action_id: actions[0].id,
    };
  });
}

function normalizeSubmission(body) {
  const districtId = cleanText(body?.district_id, 80);
  if (!COMMUNITY_DISTRICTS.has(districtId)) throw new Error('invalid_district');
  const title = cleanText(body?.title, 160);
  const summary = cleanText(body?.summary, 6000);
  if (title.length < 2) throw new Error('title_required');
  if (summary.length < 10) throw new Error('summary_required');
  const kind = body?.kind === 'full' ? 'full' : 'note';
  const includeSteps = Boolean(body?.include_steps) && kind === 'full';
  const steps = includeSteps ? normalizeSubmissionSteps(body?.steps) : [];
  if (includeSteps && !steps.length) throw new Error('steps_required');
  return {
    kind,
    district_id: districtId,
    title,
    category: cleanText(body?.category, 100) || '类别待审核',
    summary,
    history: cleanText(body?.history, 5000),
    features: cleanText(body?.features, 5000),
    source_url: cleanPublicUrl(body?.source_url),
    cover_url: cleanPublicUrl(body?.cover_url),
    gallery_urls: [...new Set((Array.isArray(body?.gallery_urls) ? body.gallery_urls : [])
      .slice(0, 8).map((item) => cleanPublicUrl(item)).filter(Boolean))],
    include_steps: includeSteps,
    steps,
    contributor_name: cleanText(body?.contributor_name, 100),
    contributor_contact: cleanText(body?.contributor_contact, 200),
  };
}

function mergeMissingDistrictSeed(stored) {
  if (!Array.isArray(stored.districts)) stored.districts = [];
  const byId = new Map(stored.districts.map((district) => [district.id, district]));
  const fillableFields = [
    'name', 'origin', 'features', 'heritage_overview', 'source_label', 'source_url',
  ];
  let changed = false;
  for (const seed of CONTENT_SEED.districts) {
    const current = byId.get(seed.id);
    if (!current) {
      stored.districts.push(structuredClone(seed));
      byId.set(seed.id, stored.districts.at(-1));
      changed = true;
      continue;
    }
    for (const field of fillableFields) {
      if (!cleanText(current[field]) && cleanText(seed[field])) {
        current[field] = seed[field];
        changed = true;
      }
    }
  }
  return changed;
}

async function loadContentStore() {
  try {
    const stored = JSON.parse(await readFile(CONTENT_STORE_PATH, 'utf8'));
    if (!Array.isArray(stored.crafts) || !Array.isArray(stored.craft_steps)) throw new Error('invalid_content_store');
    stored.craft_gallery = Array.isArray(stored.craft_gallery) ? stored.craft_gallery : [];
    stored.site_texts = Array.isArray(stored.site_texts) ? stored.site_texts : [];
    stored.revision ||= makeRevision();
    if (mergeMissingDistrictSeed(stored)) {
      stored.updated_at = new Date().toISOString();
      stored.revision = makeRevision();
      await writeContentStore(stored);
    }
    return stored;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      const initial = { ...CONTENT_SEED, revision: makeRevision(), updated_at: new Date().toISOString() };
      await writeContentStore(initial);
      return initial;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${CONTENT_STORE_PATH}.invalid-${stamp}.bak`;
    let backupNote = '';
    try {
      await copyFile(CONTENT_STORE_PATH, backupPath);
      await chmod(backupPath, 0o600);
      backupNote = `；原文件副本已保留为 ${backupPath}`;
    } catch (backupError) {
      backupNote = `；原文件副本保留失败：${backupError.message}`;
    }
    throw new Error(`内容存储无效，为避免覆盖线上编辑已拒绝启动${backupNote}；原因：${error.message}`);
  }
}

async function writeContentStore(content) {
  await mkdir(dirname(CONTENT_STORE_PATH), { recursive: true });
  const temporary = `${CONTENT_STORE_PATH}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(content, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, CONTENT_STORE_PATH);
}

function saveContent(expectedRevision, mutate) {
  const operation = contentWriteQueue.then(async () => {
    if (expectedRevision && expectedRevision !== editableContent.revision) {
      const error = new Error('content_conflict');
      error.code = 'content_conflict';
      throw error;
    }
    const next = structuredClone(editableContent);
    mutate(next);
    next.updated_at = new Date().toISOString();
    next.revision = makeRevision();
    await writeContentStore(next);
    editableContent = next;
    return next;
  });
  contentWriteQueue = operation.catch(() => {});
  return operation;
}

async function writeCommunityStore(content) {
  await mkdir(dirname(COMMUNITY_STORE_PATH), { recursive: true });
  const temporary = `${COMMUNITY_STORE_PATH}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(content, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, COMMUNITY_STORE_PATH);
}

async function loadCommunityStore() {
  try {
    const stored = JSON.parse(await readFile(COMMUNITY_STORE_PATH, 'utf8'));
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new Error('invalid_community_store');
    stored.version ||= 1;
    stored.revision ||= makeRevision();
    stored.updated_at ||= new Date().toISOString();
    stored.engagement ||= {};
    stored.submissions = Array.isArray(stored.submissions) ? stored.submissions : [];
    return stored;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${COMMUNITY_STORE_PATH}.invalid-${stamp}.bak`;
      await copyFile(COMMUNITY_STORE_PATH, backupPath).catch(() => {});
      await chmod(backupPath, 0o600).catch(() => {});
      throw new Error(`社区数据存储无效，已拒绝覆盖：${error.message}`);
    }
    const initial = {
      version: 1,
      revision: makeRevision(),
      updated_at: new Date().toISOString(),
      engagement: {},
      submissions: [],
    };
    await writeCommunityStore(initial);
    return initial;
  }
}

function saveCommunity(expectedRevision, mutate) {
  const operation = communityWriteQueue.then(async () => {
    if (expectedRevision && expectedRevision !== communityState.revision) {
      const error = new Error('community_conflict');
      error.code = 'community_conflict';
      throw error;
    }
    const next = structuredClone(communityState);
    mutate(next);
    next.updated_at = new Date().toISOString();
    next.revision = makeRevision();
    await writeCommunityStore(next);
    communityState = next;
    return next;
  });
  communityWriteQueue = operation.catch(() => {});
  return operation;
}

function publicContent() {
  return { ...editableContent, source: 'site-admin' };
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

function currentSession(req) {
  const token = cookies(req).sh_admin;
  const session = token && sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + 12 * 60 * 60 * 1000;
  return { token, ...session };
}

function jsonResponse(res, code, payload, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(payload));
}

function sessionCookie(req, token, maxAge = 12 * 60 * 60) {
  const forwardedHttps = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  const secure = ADMIN_COOKIE_SECURE || forwardedHttps;
  return `sh_admin=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function validWriteOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

function clientAddress(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

function visitorIdentity(req) {
  const existing = cookies(req).sh_visitor;
  const token = /^[A-Za-z0-9_-]{24,120}$/.test(existing || '') ? existing : randomBytes(24).toString('base64url');
  return {
    token,
    hash: createHash('sha256').update(token).digest('hex'),
    isNew: token !== existing,
  };
}

function visitorCookie(req, token) {
  const forwardedHttps = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  const secure = ADMIN_COOKIE_SECURE || forwardedHttps;
  return `sh_visitor=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${365 * 24 * 60 * 60}${secure ? '; Secure' : ''}`;
}

function ensureEngagement(state, craftId) {
  state.engagement[craftId] ||= { view_count: 0, inheritor_count: 0, inheritors: {} };
  const entry = state.engagement[craftId];
  entry.view_count = Math.max(0, Number(entry.view_count) || 0);
  entry.inheritor_count = Math.max(0, Number(entry.inheritor_count) || 0);
  entry.inheritors ||= {};
  return entry;
}

function normalizeActions(actions, stepId) {
  const result = [];
  for (const [index, value] of (Array.isArray(actions) ? actions : []).slice(0, 20).entries()) {
    const label = cleanText(value?.label, 100);
    if (!label) continue;
    const requested = cleanText(value?.id, 100);
    const id = /^[A-Za-z0-9_-]+$/.test(requested) ? requested : `${stepId}_action_${index + 1}`;
    if (!result.some((item) => item.id === id)) result.push({ id, label });
  }
  if (!result.length) result.push({ id: `${stepId}_action`, label: '执行当前工序' });
  return result;
}

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

function normalizeResourceGroups(groups, stepId, materials, tools) {
  const allowed = new Set([...materials, ...tools]);
  const result = [];
  const uniqueGroupId = (candidate) => {
    let id = candidate;
    let suffix = 2;
    while (result.some((group) => group.id === id)) id = `${candidate}_${suffix++}`;
    return id;
  };
  for (const [index, value] of (Array.isArray(groups) ? groups : []).slice(0, 20).entries()) {
    const options = cleanList(value?.options).filter((name) => allowed.has(name));
    if (!options.length) continue;
    const requested = cleanText(value?.id, 100);
    const baseId = /^[A-Za-z0-9_-]+$/.test(requested) ? requested : `${stepId}_group_${index + 1}`;
    const id = uniqueGroupId(baseId);
    const mode = value?.mode === 'all' ? 'all' : 'any';
    const requestedMin = Number(value?.min);
    const min = mode === 'all'
      ? options.length
      : Math.min(options.length, Math.max(0, Number.isFinite(requestedMin) ? Math.trunc(requestedMin) : 1));
    const requestedMax = value?.max == null ? null : Number(value.max);
    const max = requestedMax == null || !Number.isFinite(requestedMax)
      ? null
      : Math.min(options.length, Math.max(min, Math.trunc(requestedMax)));
    result.push({
      id,
      label: cleanText(value?.label, 100) || `资源组 ${index + 1}`,
      mode,
      min,
      max,
      options,
    });
  }

  const represented = new Set(result.flatMap((group) => group.options));
  const appendRequired = (items, suffix, label) => {
    const options = items.filter((name) => !represented.has(name));
    if (!options.length) return;
    result.push({
      id: uniqueGroupId(`${stepId}_${suffix}`),
      label,
      mode: 'all',
      min: options.length,
      max: null,
      options,
    });
    options.forEach((name) => represented.add(name));
  };
  appendRequired(materials, 'materials', '所需材料');
  appendRequired(tools, 'tools', '所需工具');
  return result;
}

function normalizeQuickFill(value, allowedResources, actions, correctActionId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const allowed = new Set(allowedResources);
  const resources = cleanList(value.resources).filter((name) => allowed.has(name));
  const requestedAction = cleanText(value.action_id, 100);
  const actionId = actions.some((action) => action.id === requestedAction) ? requestedAction : correctActionId;
  return { resources, action_id: actionId };
}

function normalizeMaterialTransforms(value, materials) {
  const incoming = Array.isArray(value) ? value : [];
  const result = [];
  for (const item of incoming.slice(0, 80)) {
    const inputName = cleanText(item?.input_name, 100);
    if (!inputName || result.some((entry) => entry.input_name === inputName)) continue;
    result.push({ input_name: inputName, output_name: cleanText(item?.output_name, 200) });
  }
  // 兼容升级前的数据：尚未配置映射的本步材料先按同名产物延续；
  // 管理员明确把“完成后变为”留空并保存后，则表示该材料在本步被消耗。
  for (const inputName of materials) {
    if (!result.some((entry) => entry.input_name === inputName)) {
      result.push({ input_name: inputName, output_name: inputName });
    }
  }
  return result;
}

function normalizeSteps(craftId, incoming, previous) {
  if (!Array.isArray(incoming) || incoming.length > 30) throw new Error('invalid_steps');
  const previousById = new Map(previous.map((step) => [step.id, step]));
  return incoming.map((value, index) => {
    const requestedId = cleanText(value?.id, 120);
    const id = /^[A-Za-z0-9_-]+$/.test(requestedId) ? requestedId : `step_${craftId}_${Date.now()}_${index + 1}`;
    const old = previousById.get(id) || {};
    const actions = normalizeActions(value?.actions, id);
    const correct = actions.some((item) => item.id === value?.correct_action_id) ? value.correct_action_id : actions[0].id;
    const materials = cleanList(value?.materials);
    const tools = cleanList(value?.tools);
    const groupInput = hasOwn(value, 'resource_groups') ? value.resource_groups : old.resource_groups;
    const resourceGroups = normalizeResourceGroups(groupInput, id, materials, tools);
    const quickFillInput = hasOwn(value, 'quick_fill') ? value.quick_fill : old.quick_fill;
    return {
      id,
      sort: index + 1,
      craft_id: craftId,
      source_step_id: old.source_step_id || id,
      name: cleanText(value?.name, 200),
      action: cleanText(value?.action, 5000),
      result: cleanText(value?.result, 1000),
      materials,
      material_transforms: normalizeMaterialTransforms(value?.material_transforms, materials),
      tools,
      resource_groups: resourceGroups,
      actions,
      correct_action_id: correct,
      quick_fill: normalizeQuickFill(quickFillInput, resourceGroups.flatMap((group) => group.options), actions, correct),
      evidence_ids: cleanList(old.evidence_ids || value?.evidence_ids, 30),
      review_status: old.review_status || 'edited_by_admin',
    };
  });
}

editableContent = await loadContentStore();
communityState = await loadCommunityStore();

async function handleContentApi(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
  });
  res.end(JSON.stringify(publicContent()));
}

async function handleCommunityApi(req, res, urlPath) {
  const visitor = visitorIdentity(req);
  const responseHeaders = visitor.isNew ? { 'Set-Cookie': visitorCookie(req, visitor.token) } : {};

  if (urlPath === '/api/community/stats' && req.method === 'GET') {
    const crafts = {};
    for (const [craftId, value] of Object.entries(communityState.engagement || {})) {
      crafts[craftId] = {
        view_count: Math.max(0, Number(value?.view_count) || 0),
        inheritor_count: Math.max(0, Number(value?.inheritor_count) || 0),
        visitor_ordinal: Math.max(0, Number(value?.inheritors?.[visitor.hash]) || 0),
      };
    }
    jsonResponse(res, 200, { crafts, updated_at: communityState.updated_at }, responseHeaders);
    return;
  }

  if (!validWriteOrigin(req)) { jsonResponse(res, 403, { error: 'invalid_origin' }, responseHeaders); return; }

  const engagementMatch = urlPath.match(/^\/api\/community\/crafts\/([A-Za-z0-9_-]+)\/(view|inherit)$/);
  if (engagementMatch && req.method === 'POST') {
    const [, craftId, action] = engagementMatch;
    if (!editableContent.crafts.some((craft) => craft.id === craftId)) {
      jsonResponse(res, 404, { error: 'craft_not_found' }, responseHeaders);
      return;
    }
    try {
      let result;
      const updated = await saveCommunity('', (next) => {
        const entry = ensureEngagement(next, craftId);
        if (action === 'view') entry.view_count += 1;
        if (action === 'inherit') {
          const existing = Number(entry.inheritors[visitor.hash]) || 0;
          if (!existing) {
            entry.inheritor_count += 1;
            entry.inheritors[visitor.hash] = entry.inheritor_count;
          }
        }
        result = {
          view_count: entry.view_count,
          inheritor_count: entry.inheritor_count,
          visitor_ordinal: Number(entry.inheritors[visitor.hash]) || 0,
        };
      });
      jsonResponse(res, 200, { ok: true, craft_id: craftId, ...result, updated_at: updated.updated_at }, responseHeaders);
    } catch {
      jsonResponse(res, 500, { error: 'community_store_unavailable' }, responseHeaders);
    }
    return;
  }

  if (urlPath === '/api/community/submissions' && req.method === 'POST') {
    const ip = clientAddress(req);
    const now = Date.now();
    const attempt = submissionAttempts.get(ip) || { count: 0, resetAt: now + 60 * 60 * 1000 };
    if (attempt.resetAt <= now) { attempt.count = 0; attempt.resetAt = now + 60 * 60 * 1000; }
    if (attempt.count >= 5) { jsonResponse(res, 429, { error: 'submission_rate_limited' }, responseHeaders); return; }
    try {
      const body = await readJsonBody(req, 160 * 1024);
      if (cleanText(body.website, 200)) { jsonResponse(res, 400, { error: 'invalid_submission' }, responseHeaders); return; }
      const normalized = normalizeSubmission(body);
      attempt.count += 1;
      submissionAttempts.set(ip, attempt);
      const id = `SUB_${Date.now().toString(36)}_${randomBytes(5).toString('hex')}`;
      await saveCommunity('', (next) => {
        next.submissions.push({
          id,
          status: 'pending',
          submitted_at: new Date().toISOString(),
          reviewed_at: null,
          reviewer_note: '',
          published_craft_id: null,
          ...normalized,
        });
      });
      jsonResponse(res, 201, { ok: true, submission_id: id, status: 'pending' }, responseHeaders);
    } catch (error) {
      const code = error?.message === 'body_too_large' ? 413 : 400;
      jsonResponse(res, code, { error: error?.message || 'invalid_submission' }, responseHeaders);
    }
    return;
  }

  jsonResponse(res, 404, { error: 'not_found' }, responseHeaders);
}

function craftIdForSubmission(submission) {
  return `COMM_${submission.id.replace(/^SUB_/, '')}`;
}

async function publishSubmission(submission) {
  const craftId = craftIdForSubmission(submission);
  await saveContent('', (next) => {
    if (next.crafts.some((craft) => craft.id === craftId || craft.submission_id === submission.id)) return;
    const sort = Math.max(0, ...next.crafts.map((craft) => Number(craft.sort) || 0)) + 1;
    next.crafts.push({
      id: craftId,
      sort,
      title: submission.title,
      district_id: submission.district_id,
      category: submission.category,
      summary: submission.summary,
      cover_path: submission.cover_url || '',
      source_directory: '',
      source: 'community',
      submission_id: submission.id,
      community_details: {
        history: submission.history || '',
        features: submission.features || '',
        source_url: submission.source_url || '',
        contributor_name: submission.contributor_name || '',
      },
    });

    const incomingSteps = submission.steps.map((step, index) => {
      const stepId = `${craftId}_step_${String(index + 1).padStart(2, '0')}`;
      const actions = step.actions.map((action, actionIndex) => ({
        id: `${stepId}_action_${actionIndex + 1}`,
        label: action.label,
      }));
      return {
        ...step,
        id: stepId,
        source_step_id: stepId,
        actions,
        correct_action_id: actions[0]?.id || '',
      };
    });
    next.craft_steps.push(...normalizeSteps(craftId, incomingSteps, []));
    submission.gallery_urls.forEach((url, index) => {
      next.craft_gallery.push({
        id: `${craftId}_work_${String(index + 1).padStart(2, '0')}`,
        sort: index + 1,
        craft_id: craftId,
        title: `${submission.title}社区资料图 ${index + 1}`,
        image_url: url,
        source_path: '',
        evidence_id: '',
      });
    });
  });
  return craftId;
}

async function handleAdminApi(req, res, urlPath) {
  if (!validWriteOrigin(req)) { jsonResponse(res, 403, { error: 'invalid_origin' }); return; }
  if (urlPath === '/api/admin/login' && req.method === 'POST') {
    const ip = clientAddress(req);
    const now = Date.now();
    const previous = loginAttempts.get(ip);
    const attempt = previous?.resetAt > now
      ? previous
      : { count: 0, resetAt: now + ADMIN_LOGIN_WINDOW_MS };
    if (attempt.count >= ADMIN_LOGIN_MAX_ATTEMPTS) {
      const retryAfter = Math.max(1, Math.ceil((attempt.resetAt - now) / 1000));
      jsonResponse(res, 429, {
        error: 'too_many_attempts',
        retry_after_seconds: retryAfter,
      }, { 'Retry-After': String(retryAfter) });
      return;
    }
    try {
      const body = await readJsonBody(req, 4096);
      if (!safeEqual(body.username, ADMIN_USERNAME) || !safeEqual(body.password, ADMIN_PASSWORD)) {
        const count = attempt.count + 1;
        loginAttempts.set(ip, { count, resetAt: attempt.resetAt });
        const remaining = Math.max(0, ADMIN_LOGIN_MAX_ATTEMPTS - count);
        if (!remaining) {
          const retryAfter = Math.max(1, Math.ceil((attempt.resetAt - now) / 1000));
          jsonResponse(res, 429, {
            error: 'too_many_attempts',
            retry_after_seconds: retryAfter,
          }, { 'Retry-After': String(retryAfter) });
        } else {
          jsonResponse(res, 401, { error: 'invalid_credentials', attempts_remaining: remaining });
        }
        return;
      }
      loginAttempts.delete(ip);
      const token = randomBytes(32).toString('base64url');
      sessions.set(token, { username: ADMIN_USERNAME, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
      jsonResponse(res, 200, { authenticated: true, username: ADMIN_USERNAME, revision: editableContent.revision }, { 'Set-Cookie': sessionCookie(req, token) });
    } catch (error) {
      jsonResponse(res, error?.message === 'body_too_large' ? 413 : 400, { error: error?.message || 'bad_request' });
    }
    return;
  }

  const session = currentSession(req);
  if (urlPath === '/api/admin/session' && req.method === 'GET') {
    jsonResponse(res, 200, { authenticated: Boolean(session), username: session?.username || null, revision: editableContent.revision });
    return;
  }
  if (!session) { jsonResponse(res, 401, { error: 'authentication_required' }); return; }
  if (urlPath === '/api/admin/logout' && req.method === 'POST') {
    sessions.delete(session.token);
    jsonResponse(res, 200, { authenticated: false }, { 'Set-Cookie': sessionCookie(req, '', 0) });
    return;
  }

  if (urlPath === '/api/admin/submissions' && req.method === 'GET') {
    const requestedStatus = cleanText(new URL(req.url, 'http://x').searchParams.get('status'), 30);
    const submissions = communityState.submissions
      .filter((submission) => !requestedStatus || requestedStatus === 'all' || submission.status === requestedStatus)
      .slice()
      .sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)));
    jsonResponse(res, 200, { revision: communityState.revision, submissions });
    return;
  }

  const submissionReviewMatch = urlPath.match(/^\/api\/admin\/submissions\/(SUB_[A-Za-z0-9_]+)\/review$/);
  if (submissionReviewMatch && req.method === 'PUT') {
    try {
      const body = await readJsonBody(req, 32 * 1024);
      const action = body.action === 'approve' ? 'approved' : body.action === 'reject' ? 'rejected' : '';
      if (!action) { jsonResponse(res, 400, { error: 'invalid_review_action' }); return; }
      const submission = communityState.submissions.find((item) => item.id === submissionReviewMatch[1]);
      if (!submission) { jsonResponse(res, 404, { error: 'submission_not_found' }); return; }
      if (submission.status !== 'pending') { jsonResponse(res, 409, { error: 'submission_already_reviewed', revision: communityState.revision }); return; }
      const publishedCraftId = action === 'approved' ? await publishSubmission(submission) : null;
      // 点击量会持续推进社区数据的全局 revision；审核只锁定这一条投稿的
      // pending 状态，避免访客恰好点击项目时让管理员的审核表单无故冲突。
      const updated = await saveCommunity('', (next) => {
        const target = next.submissions.find((item) => item.id === submission.id);
        if (!target || target.status !== 'pending') {
          const error = new Error('submission_already_reviewed');
          error.code = 'submission_already_reviewed';
          throw error;
        }
        target.status = action;
        target.reviewed_at = new Date().toISOString();
        target.reviewer_note = cleanText(body.reviewer_note, 2000);
        target.published_craft_id = publishedCraftId;
      });
      jsonResponse(res, 200, {
        ok: true,
        status: action,
        published_craft_id: publishedCraftId,
        revision: updated.revision,
        content_revision: editableContent.revision,
      });
    } catch (error) {
      const code = ['community_conflict', 'submission_already_reviewed'].includes(error?.code) ? 409 : 400;
      jsonResponse(res, code, { error: error?.code || error?.message || 'review_failed', revision: communityState.revision });
    }
    return;
  }
  if (req.method !== 'PUT') { jsonResponse(res, 405, { error: 'method_not_allowed' }); return; }

  try {
    const body = await readJsonBody(req, 256 * 1024);
    const expected = cleanText(body.revision, 100);
    let updated;
    if (urlPath === '/api/admin/site-texts') {
      const updates = new Map((Array.isArray(body.updates) ? body.updates : []).map((item) => [cleanText(item.key, 100), cleanText(item.content, 5000)]));
      updated = await saveContent(expected, (next) => {
        next.site_texts = next.site_texts.map((item) => updates.has(item.key) ? { ...item, content: updates.get(item.key) } : item);
      });
    } else {
      const districtMatch = urlPath.match(/^\/api\/admin\/districts\/([a-z0-9_-]+)$/i);
      const craftMatch = urlPath.match(/^\/api\/admin\/crafts\/([A-Za-z0-9_-]+)$/);
      const stepsMatch = urlPath.match(/^\/api\/admin\/crafts\/([A-Za-z0-9_-]+)\/steps$/);
      if (districtMatch) {
        updated = await saveContent(expected, (next) => {
          const item = next.districts.find((entry) => entry.id === districtMatch[1]);
          if (!item) throw new Error('not_found');
          for (const key of ['name', 'origin', 'features', 'heritage_overview']) if (key in body) item[key] = cleanText(body[key], 5000);
        });
      } else if (stepsMatch) {
        updated = await saveContent(expected, (next) => {
          const old = next.craft_steps.filter((step) => step.craft_id === stepsMatch[1]);
          const replacement = normalizeSteps(stepsMatch[1], body.steps, old);
          next.craft_steps = next.craft_steps.filter((step) => step.craft_id !== stepsMatch[1]).concat(replacement);
        });
      } else if (craftMatch) {
        updated = await saveContent(expected, (next) => {
          const item = next.crafts.find((entry) => entry.id === craftMatch[1]);
          if (!item) throw new Error('not_found');
          if ('title' in body) item.title = cleanText(body.title, 200);
          if ('category' in body) item.category = cleanText(body.category, 100);
          if ('summary' in body) item.summary = cleanText(body.summary, 10000);
        });
      } else {
        jsonResponse(res, 404, { error: 'not_found' });
        return;
      }
    }
    jsonResponse(res, 200, { ok: true, revision: updated.revision, updated_at: updated.updated_at });
  } catch (error) {
    const code = error?.code === 'content_conflict' ? 409 : error?.message === 'not_found' ? 404 : 400;
    jsonResponse(res, code, { error: error?.code || error?.message || 'bad_request', revision: editableContent.revision });
  }
}

async function handleKnowledgeSearchApi(req, res) {
  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  if (req.method !== 'POST') { json(405, { error: 'method_not_allowed' }); return; }
  try {
    const payload = await readJsonBody(req, 16 * 1024);
    const query = String(payload.query || '').trim().slice(0, 500);
    const craftId = /^SHIH_\d{4}$/.test(String(payload.craft_id || '')) ? String(payload.craft_id) : null;
    if (!query) { json(400, { error: 'empty_query' }); return; }
    const results = searchKnowledge(query, craftId, payload.limit);
    json(200, { query, craft_id: craftId, count: results.length, total_chunks: KNOWLEDGE_BASE.chunks.length, results });
  } catch (err) {
    json(err?.message === 'body_too_large' ? 413 : 400, { error: err?.message || 'bad_request' });
  }
}

async function handleAgentApi(req, res) {
  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  if (req.method !== 'POST') { json(405, { error: 'method_not_allowed' }); return; }
  if (!DEEPSEEK_KEY) { json(503, { error: 'no_api_key' }); return; }
  try {
      const payload = await readJsonBody(req);
      const userMsg = String(payload.messages?.at(-1)?.content || '').slice(0, 2000);
      if (!userMsg) { json(400, { error: 'empty_message' }); return; }
      const craftId = /^SHIH_\d{4}$/.test(String(payload.context?.craft?.id || '')) ? payload.context.craft.id : null;
      const retrievedKnowledge = searchKnowledge(userMsg, craftId, 8);
      const system = buildSystemPrompt({ ...(payload.context || {}), retrieved_knowledge: retrievedKnowledge });
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
      json(200, { content, knowledge: retrievedKnowledge });
    } catch (err) {
      json(err?.name === 'AbortError' ? 504 : 502, { error: err?.name === 'AbortError' ? 'timeout' : 'proxy_error' });
    }
}

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (urlPath === '/api/content') { await handleContentApi(req, res); return; }
    if (urlPath.startsWith('/api/community/')) { await handleCommunityApi(req, res, urlPath); return; }
    if (urlPath.startsWith('/api/admin/')) { await handleAdminApi(req, res, urlPath); return; }
    if (urlPath === '/api/kb/search') { await handleKnowledgeSearchApi(req, res); return; }
    if (urlPath === '/api/agent') { await handleAgentApi(req, res); return; }
    if (['scripts', 'deploy', 'docs', 'node_modules'].includes(urlPath.split('/').filter(Boolean)[0])) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
      return;
    }
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
    const targetStat = await stat(target).catch(() => null);
    if (!targetStat?.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
      return;
    }
    const extension = extname(target).toLowerCase();
    const etag = `W/\"${targetStat.size.toString(16)}-${Math.trunc(targetStat.mtimeMs).toString(16)}\"`;
    const modifiedSince = req.headers['if-modified-since'];
    const notModified = req.headers['if-none-match'] === etag
      || (modifiedSince && Math.trunc(new Date(modifiedSince).getTime() / 1000) >= Math.trunc(targetStat.mtimeMs / 1000));
    const cacheControl = ['.glb', '.gltf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.woff', '.woff2']
      .includes(extension)
      ? 'public, max-age=86400, stale-while-revalidate=604800'
      : 'public, max-age=0, must-revalidate';
    const headers = {
      'Content-Type': MIME[extension] || 'application/octet-stream',
      'Cache-Control': cacheControl,
      ETag: etag,
      'Last-Modified': targetStat.mtime.toUTCString(),
    };
    if (notModified) {
      res.writeHead(304, headers).end();
      return;
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, { ...headers, 'Content-Length': targetStat.size }).end();
      return;
    }
    const body = await readFile(target);
    res.writeHead(200, {
      ...headers,
      'Content-Length': body.length,
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`SH-Crafted v1 已启动: http://localhost:${PORT}/`);
});
