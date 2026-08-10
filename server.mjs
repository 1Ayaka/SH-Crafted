// 探物志：依赖为零的静态文件服务器（node:http）+ DeepSeek 代理（/api/agent）
// 用法: npm run dev -- --port 7100 --host 127.0.0.1
// 也支持环境变量 PORT / HOST，默认端口 7100
// 安全规则：
// - 拒绝伺服任何点文件（.env 等）——路径任一段以 . 开头即 403
// - DeepSeek 密钥只存在于服务器进程内（启动时从 .env 或 DEEPSEEK_API_KEY 读取），
//   绝不发送给浏览器、绝不打印日志
import http from 'node:http';
import net from 'node:net';
import { createVoiceGateway } from './server/voice/voice-gateway.mjs';
import { createVoiceSessionManager } from './server/voice/voice-session-manager.mjs';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { dirname, extname, isAbsolute, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContentSeed } from './scripts/content-seed.mjs';
import { createUnifiedContentStore } from './server/unified-content-store.mjs';

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

const VOICE_STT_PROVIDER = env('VOICE_STT_PROVIDER', 'funasr-local').trim().toLowerCase();
const VOICE_FUNASR_WS_URL = env('VOICE_FUNASR_WS_URL', 'ws://127.0.0.1:10095');
const VOICE_ALLOWED_ORIGIN = env('VOICE_ALLOWED_ORIGIN', '').trim();
const voiceSessions = createVoiceSessionManager({
  ttlMs: Math.min(15 * 60 * 1000, Math.max(60 * 1000, Number(env('VOICE_SESSION_TTL_SECONDS', '300')) * 1000)),
  maxPerIp: Math.min(5, Math.max(1, Number(env('VOICE_MAX_SESSIONS_PER_IP', '2')))),
  bindIp: env('VOICE_BIND_SESSION_IP', 'false').toLowerCase() === 'true',
});

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
const configuredContentDbPath = env('CONTENT_DB_PATH').trim();
const CONTENT_DB_PATH = normalize(configuredContentDbPath || join(dirname(CONTENT_STORE_PATH), 'content.db'));
const configuredContentUploadDir = env('CONTENT_UPLOAD_DIR').trim();
const CONTENT_UPLOAD_DIR = normalize(configuredContentUploadDir || join(dirname(CONTENT_DB_PATH), 'uploads'));
const BRAND_LOGO_PATH = join(CONTENT_UPLOAD_DIR, 'brand', 'logo.png');
const DEFAULT_BRAND_LOGO_PATH = join(ROOT, 'assets', 'brand', 'tanwuzhi-logo.png');
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

let editableKnowledgeCacheRevision = '';
let editableKnowledgeCache = [];
let editableKnowledgeByCraft = new Map();

function editableKnowledgeChunks(craftId = null) {
  const revision = editableContent?.revision || 'seed';
  if (editableKnowledgeCacheRevision === revision) {
    return craftId ? (editableKnowledgeByCraft.get(craftId) || []) : editableKnowledgeCache;
  }
  const crafts = editableContent?.crafts || [];
  const steps = editableContent?.craft_steps || [];
  const stepsByCraft = new Map();
  for (const step of steps) {
    if (!stepsByCraft.has(step.craft_id)) stepsByCraft.set(step.craft_id, []);
    stepsByCraft.get(step.craft_id).push(step);
  }
  const chunks = [];
  const byCraft = new Map();
  for (const craft of crafts) {
    const craftChunks = [];
    const graph = craft.graph_data || {};
    const relations = Array.isArray(graph.relations)
      ? graph.relations.map((item) => `${item.title || item}${item.summary ? `：${item.summary}` : ''}`).join('；')
      : '';
    const details = craft.community_details || {};
    const text = [
      craft.summary,
      craft.history || details.history,
      craft.features || details.features,
      graph.summary,
      relations,
    ].filter(Boolean).join('\n');
    if (text) craftChunks.push({
      chunk_id: `content_${craft.id}_overview`, kind: 'published_content', title: craft.title, text,
      craft_ids: [craft.id], evidence_ids: [], source_ids: [], authority_tier: null, review_status: 'edited_by_admin',
    });
    for (const [index, step] of (stepsByCraft.get(craft.id) || []).entries()) {
      const stepText = [step.name, step.action, step.guide_text, step.result,
        ...(Array.isArray(step.materials) ? step.materials : []), ...(Array.isArray(step.tools) ? step.tools : [])]
        .filter(Boolean).join('；');
      if (!stepText) continue;
      craftChunks.push({
        chunk_id: `content_${craft.id}_step_${step.id || index + 1}`, kind: 'published_process_step',
        title: `${craft.title}：${step.name || `工序 ${index + 1}`}`, text: stepText,
        craft_ids: [craft.id], evidence_ids: step.evidence_ids || [], source_ids: [], authority_tier: null,
        review_status: step.review_status || 'edited_by_admin',
      });
    }
    byCraft.set(craft.id, craftChunks);
    chunks.push(...craftChunks);
  }
  editableKnowledgeCacheRevision = revision;
  editableKnowledgeCache = chunks;
  editableKnowledgeByCraft = byCraft;
  return craftId ? (byCraft.get(craftId) || []) : chunks;
}

function searchKnowledge(query, craftId = null, limit = 8) {
  const q = searchUnits(query);
  if (!q.clean) return [];
  const kindBoost = { external_fact: 6, video_summary: 4, video_claim: 3, video_evidence: 2, process_step: 2, source_profile: 1, entity: 0 };
  const authorityBoost = { A: 4, B: 3, C: 1 };
  return [...KNOWLEDGE_BASE.chunks, ...editableKnowledgeChunks(craftId)]
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

// ---------- 图谱兼容 API ----------
// 第一阶段只暴露已有内容中可核验的 heritage 与 region 节点；传统/材料关系
// 没有正式 nodes/edges 数据时返回空结果，不根据类别或文本臆造关系。
const graphId = (type, rawId) => `${type}:${String(rawId || '').replace(/[^A-Za-z0-9_-]/g, '')}`;
let serverGraphCacheRevision = '';
let serverGraphNodes = [];
let serverGraphNodeById = new Map();
const graphNodes = () => {
  const revision = editableContent?.revision || 'seed';
  if (serverGraphCacheRevision === revision) return serverGraphNodes;
  const galleryByCraft = new Map();
  for (const item of editableContent?.craft_gallery || []) {
    if (!galleryByCraft.has(item.craft_id)) galleryByCraft.set(item.craft_id, item.image_url || '');
  }
  serverGraphNodes = [
  ...(editableContent?.crafts || CONTENT_SEED.crafts).map((craft) => ({
    id: graphId('heritage', craft.id), raw_id: craft.id, type: 'heritage', title: craft.title,
    aliases: [craft.title], summary: String(craft.summary || '').slice(0, 180),
    district_id: craft.district_id || null,
    overview_image: galleryByCraft.get(craft.id) || craft.cover_path || '',
    public: true,
  })),
  ...(editableContent?.districts || CONTENT_SEED.districts).map((district) => ({
    id: graphId('region', district.id), raw_id: district.id, type: 'region', title: district.name,
    aliases: [district.name, String(district.name || '').replace(/区$/, '')],
    summary: String(district.heritage_overview || '').slice(0, 180), public: true,
  })),
  ];
  serverGraphNodeById = new Map(serverGraphNodes.map((node) => [node.id, node]));
  serverGraphCacheRevision = revision;
  return serverGraphNodes;
};
function getGraphNodeServer(id) { graphNodes(); return serverGraphNodeById.get(id) || null; }
function searchGraphServer(query, types = ['heritage', 'region'], limit = 8) {
  const clean = String(query || '').trim().toLowerCase();
  if (!clean) return [];
  const allowed = new Set(Array.isArray(types) ? types : []);
  return graphNodes().filter((node) => allowed.has(node.type)).map((node) => {
    const names = [node.title, ...(node.aliases || [])].join(' ').toLowerCase();
    const haystack = `${names} ${node.summary}`.toLowerCase();
    let score = names.includes(clean) ? 2 : haystack.includes(clean) ? 0.35 : 0;
    for (const term of clean.split(/\s+/).filter(Boolean)) if (names.includes(term)) score += term.length > 1 ? 0.25 : 0.04;
    else if (haystack.includes(term)) score += term.length > 1 ? 0.06 : 0.01;
    if (node.title.toLowerCase() === clean) score += 2;
    return { node, score };
  }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || a.node.title.localeCompare(b.node.title, 'zh-CN'))
    .slice(0, Math.min(Math.max(Number(limit) || 8, 1), 12)).map(({ node, score }) => ({ ...node, score: Number(score.toFixed(3)) }));
}
function graphBranchesServer(id) {
  const node = getGraphNodeServer(id);
  if (!node || node.type !== 'heritage') return { branches: [] };
  return {
    branches: node.district_id ? [{ relation: 'LOCATED_IN', nodes: [getGraphNodeServer(graphId('region', node.district_id))].filter(Boolean), count: 1 }] : [],
    empty_relations: ['BELONGS_TO_TRADITION', 'USES_MATERIAL'],
  };
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
const AGENT_LOCAL_ONLY = env('AGENT_LOCAL_ONLY', 'false').toLowerCase() === 'true';
let agentUpstreamDisabledReason = '';
console.log(`智能体应答：${AGENT_LOCAL_ONLY ? '本地检索模式' : DEEPSEEK_KEY ? 'DeepSeek 优先、本地检索兜底' : '本地检索模式（未配置 DeepSeek 密钥）'}`);

function compactKnowledgeText(value, max = 210) {
  const clean = String(value || '').replace(/\s+/g, ' ').replace(/\[(?:ext_|content_)[^\]]+\]/gi, '').trim();
  if (clean.length <= max) return clean;
  const sentence = clean.slice(0, max).replace(/[，、；：]?[^，。！？；]*$/, '');
  return `${sentence || clean.slice(0, max)}……`;
}

function buildLocalAgentReply(userMsg, context = {}, knowledge = []) {
  const craft = context.craft || {};
  const reviewed = Boolean(context.content_reviewed || context.ui_context?.content_reviewed);
  const useful = knowledge.filter((item) => item?.text).slice(0, 2);
  const subject = craft.title || useful[0]?.title || '这个问题';
  const parts = [];
  if (useful.length) {
    parts.push(`关于**${subject}**，现有资料可以先从这一点理解：${compactKnowledgeText(useful[0].text)}`);
    if (useful[1]) parts.push(`另一条相关记录补充道：${compactKnowledgeText(useful[1].text, 150)}`);
    const sourceNames = [...new Set(useful.flatMap((item) => (item.sources || []).map((source) => source.publisher || source.title)).filter(Boolean))].slice(0, 2);
    if (sourceNames.length) parts.push(`这些信息可在${sourceNames.join('、')}的资料中继续核对。`);
    if (!reviewed && useful.some((item) => item.review_status !== 'verified_external')) parts.push('其中项目整理内容仍待人工复核，适合先作为理解线索。');
  } else {
    const contextual = [craft.summary, ...(craft.claims || [])].filter(Boolean).slice(0, 2).map((item) => compactKnowledgeText(item, 170));
    if (contextual.length) parts.push(`关于**${subject}**，当前项目资料记录了：${contextual.join('；')}`);
    else parts.push(`我暂时没有在项目知识库中找到能直接回答“${compactKnowledgeText(userMsg, 52)}”的可靠条目。为了不把猜测说成事实，我先不补造细节。`);
  }
  const wantsExploration = /(想看|打开|还有哪些|带我探索|接下来|继续看|推荐|了解什么|去哪看)/.test(userMsg);
  if (wantsExploration) {
    const candidates = (context.exploration_candidates || context.ui_context?.visible_nodes || [])
      .filter((item) => item?.title && item.title !== subject).slice(0, 2).map((item) => item.title);
    if (candidates.length) parts.push(`如果想继续探索，可以从**${candidates.join('**或**')}**展开，看看它与地区、材料或传统之间的关系。`);
    else parts.push('如果想继续探索，可以进入知识星图，从当前节点的地区、材料或传统关系逐层展开。');
  }
  return parts.join('\n\n');
}

// 由前端上下文组装系统提示：小蕉人设 + 资料约束 + 证据引用规则
function buildSystemPrompt(ctx = {}) {
  const craft = ctx.craft || {};
  const contentReviewed = Boolean(ctx.content_reviewed || ctx.ui_context?.content_reviewed);
  const lines = [
    '你是「小蕉」，一只正在收集上海非物质文化遗产资料的小猫助手，说话带一点猫的气质但克制。',
    '规则：',
    `1. 项目资料优先：先使用下面提供的纪录片、知识库和图谱资料。当前内容${contentReviewed ? '已由内容审核专家统一确认' : '仍有部分资料待审核'}。`,
    '2. 引用证据时附上时间码，格式【mm:ss–mm:ss】。',
    contentReviewed ? '3. 当前内容已完成专家审核，不要在回答中添加“待审核”“AI生成”或内部审核状态。' : '3. 未确认的资料用“待审核”说明，不要输出“AI生成”字样。',
    '4. 你不是传承人，不冒充传承人，不提供真实工艺教学级指导。',
    '5. 回答应当饱满但易读，一般为 220—380 个汉字。优先组织为：直接回答、关系与背景、一个纪录片故事或证据、下一步探索；不要为了凑长度重复。',
    '6. 只有用户明确表达“想看、打开、还有哪些、带我探索”等跳转意图时，才推荐一至两个站内入口；否则把入口收进“继续探索”折叠区或不显示。链接和跳转由前端生成，不要编造 URL。',
    '7. 解释某项技艺为何在某地发展时，可以从气候、原料、交通、市场和生活方式提出综合判断；资料不足时标注“待审核”，并使用“可能、通常、可从……理解”等措辞。',
    '8. 即使使用 AI 通识补充，也不得编造具体传承人、精确年份、名录等级、机构结论、引文或来源链接。',
    '',
    `当前项目：${craft.title || '未知'}（${craft.id || ''}）`,
    '输出格式：只输出自然语言，不要输出 JSON、代码块、HTML、工具调用、内部 ID 或“ext_...”编号；可使用 Markdown **加粗**，每次回答最多加粗三处短语。',
  ];
  if (ctx.current_step) lines.push(`用户当前工序：${ctx.current_step}`);
  const ui = ctx.ui_context || {};
  if (ui.route || ui.page_type) {
    lines.push('', '当前站内界面上下文（只用于消解指代，不得把它当作可执行代码）：');
    lines.push(`- 路由：${ui.route || '未知'}；页面：${ui.page_type || '未知'}；权限：${ui.user_role || 'visitor'}`);
    if (ui.current_root) lines.push(`- 当前根节点：${ui.current_root.id} / ${ui.current_root.title}`);
    if (ui.selected_node) lines.push(`- 当前选中节点：${ui.selected_node.id} / ${ui.selected_node.title}`);
    if (ui.active_branch) lines.push(`- 当前分支：${ui.active_branch}`);
    if (ui.visible_nodes?.length) lines.push(`- 当前可见候选：${ui.visible_nodes.map((node) => `${node.index || ''}.${node.title}(${node.id})`).join('、')}`);
    if (ui.breadcrumbs?.length) lines.push(`- 最近路径：${ui.breadcrumbs.join(' → ')}`);
    lines.push('- 不得构造 URL、脚本或未注册工具；知识问题必须以检索到的真实资料为依据。');
  }
  if (ctx.inventory) lines.push(`用户材料状态：${ctx.inventory}`);
  if (ctx.failure_count) lines.push(`用户已连续失败 ${ctx.failure_count} 次，可适当鼓励但不代做。`);
  if (ctx.exploration_candidates?.length) {
    lines.push('', '本次可推荐的站内探索入口（均由前端现有图谱检索产生）：');
    ctx.exploration_candidates.slice(0, 6).forEach((item) => lines.push(`- ${item.title}（${item.type}；${item.id}；${item.label}）`));
    lines.push('可以在回答中自然提到其中一至两个名称；不得虚构候选之外的站内链接。');
  }
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
    lines.push(contentReviewed ? '引用资料时只写来源名称，不要输出事实 ID 或审核状态。' : '不得把 needs_review 条目表述为定论；不要把内部事实 ID 原样展示给用户。');
  }
  if (ctx.retrieved_knowledge?.length) {
    lines.push('', '统一知识库针对本次问题检索到的片段（按相关度排序）：');
    ctx.retrieved_knowledge.forEach((item) => {
      const refs = (item.sources || []).map((source) => `${source.publisher}〔${source.authority_tier}〕 ${source.url}`).join('；');
      lines.push(`- [${item.chunk_id}] ${item.title || item.kind}：${item.text}${refs ? `（来源：${refs}）` : ''}（状态：${item.review_status || '未知'}）`);
    });
    lines.push(contentReviewed ? '优先使用高相关且有 A/B 级来源的片段，并自然提及来源名称。' : '优先使用高相关且有 A/B 级来源的片段；未确认内容统一标注待审核。');
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

function readBufferBody(req, maxBytes = 6 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
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

function cleanImageSource(value) {
  const source = cleanText(value, 8_000_000);
  if (!source) return '';
  if (/^\/content-uploads\/steps\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(?:png|jpe?g|webp)$/i.test(source)) return source;
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(source)) return source;
  return cleanPublicUrl(source);
}

function normalizeGraphImages(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((item, index) => ({
    title: cleanText(item?.title, 160) || `节点图片 ${index + 1}`,
    image_url: cleanImageSource(item?.image_url || item?.url),
    description: cleanText(item?.description, 1000),
    source_url: cleanPublicUrl(item?.source_url || item?.source || ''),
  })).filter((item) => item.image_url);
}

const GRAPH_NODE_TYPES = new Set(['heritage', 'region', 'tradition', 'material']);
const GRAPH_RELATIONS = new Set(['LOCATED_IN', 'BELONGS_TO_TRADITION', 'USES_MATERIAL']);
const PRIMARY_HERITAGE_IDS = new Set(Array.from({ length: 8 }, (_, index) => `SHIH_${String(index + 1).padStart(4, '0')}`));

function stableGraphRelationNodeId(type, title) {
  const normalizedType = GRAPH_NODE_TYPES.has(type) && type !== 'heritage' ? type : 'tradition';
  const normalizedTitle = cleanText(title, 160).normalize('NFKC').trim().toLowerCase();
  const digest = createHash('sha256').update(`${normalizedType}:${normalizedTitle}`).digest('hex').slice(0, 16);
  return `${normalizedType}:shared_${digest}`;
}

function graphEdgeId(from, relation, to) {
  return createHash('sha256').update(`${from}|${relation}|${to}`).digest('hex').slice(0, 24);
}

function graphRelationType(type) {
  return type === 'material' ? 'USES_MATERIAL' : type === 'region' ? 'LOCATED_IN' : 'BELONGS_TO_TRADITION';
}

function syncGraphFromContent(content, { includeSeed = false } = {}) {
  content.graph_nodes = Array.isArray(content.graph_nodes) ? content.graph_nodes : [];
  content.graph_edges = Array.isArray(content.graph_edges) ? content.graph_edges : [];
  const nodes = new Map(content.graph_nodes.filter((node) => node?.id).map((node) => [node.id, node]));
  const edges = new Map(content.graph_edges.filter((edge) => edge?.from && edge?.to && edge?.relation).map((edge) => [edge.id || graphEdgeId(edge.from, edge.relation, edge.to), edge]));
  let changed = false;

  const mergeMissingNode = (incoming) => {
    const current = nodes.get(incoming.id);
    if (!current) { nodes.set(incoming.id, incoming); changed = true; return; }
    for (const [key, value] of Object.entries(incoming)) {
      if ((current[key] == null || current[key] === '') && value != null && value !== '') { current[key] = value; changed = true; }
    }
  };
  const upsertGeneratedEdge = (incoming) => {
    const id = incoming.id || graphEdgeId(incoming.from, incoming.relation, incoming.to);
    const current = edges.get(id);
    if (!current) { edges.set(id, { ...incoming, id }); changed = true; return; }
    for (const [key, value] of Object.entries(incoming)) {
      if ((current[key] == null || current[key] === '') && value != null && value !== '') { current[key] = value; changed = true; }
    }
  };

  if (includeSeed) {
    for (const node of CONTENT_SEED.graph_nodes || []) mergeMissingNode(structuredClone(node));
    for (const edge of CONTENT_SEED.graph_edges || []) upsertGeneratedEdge(structuredClone(edge));
  }
  for (const district of content.districts || []) {
    mergeMissingNode({
      id: `region:${district.id}`, raw_id: district.id, type: 'region', title: district.name,
      aliases: [district.name, String(district.name || '').replace(/区$/, '')].filter(Boolean),
      summary: district.heritage_overview || '', source_title: district.source_label || '', source_url: district.source_url || '',
      published: true, review_status: district.source_url ? 'published' : 'needs_review',
    });
  }
  for (const craft of content.crafts || []) {
    const isPrimary = PRIMARY_HERITAGE_IDS.has(craft.id);
    const heritageId = `heritage:${craft.id}`;
    const current = nodes.get(heritageId);
    const generated = {
      id: heritageId, raw_id: craft.id, type: 'heritage', title: craft.title, aliases: [craft.title].filter(Boolean),
      summary: craft.graph_data?.summary || craft.summary || '', district_id: craft.district_id || '',
      overview_image: craft.graph_data?.images?.[0]?.image_url || craft.graph_data?.overview_images?.[0]?.image_url || craft.cover_path || '',
      images: normalizeGraphImages(craft.graph_data?.images || craft.graph_data?.overview_images),
      heritage_level: isPrimary ? 'primary' : 'secondary', protected: isPrimary,
      published: true, review_status: craft.source === 'community' ? 'approved_community' : 'edited_by_admin',
    };
    if (!current) { nodes.set(heritageId, generated); changed = true; }
    else {
      mergeMissingNode(generated);
      if (current.heritage_level !== generated.heritage_level) { current.heritage_level = generated.heritage_level; changed = true; }
      if (Boolean(current.protected) !== isPrimary) { current.protected = isPrimary; changed = true; }
    }
    if (craft.district_id) upsertGeneratedEdge({
      id: graphEdgeId(heritageId, 'LOCATED_IN', `region:${craft.district_id}`), from: heritageId,
      relation: 'LOCATED_IN', to: `region:${craft.district_id}`, origin: 'craft_district', published: true,
      relationship_summary: `${craft.title}的传承与展示资料归属于${nodes.get(`region:${craft.district_id}`)?.title || craft.district_id}。`,
    });
    for (const relation of craft.graph_data?.relations || []) {
      const type = ['tradition', 'material', 'region'].includes(relation?.type) ? relation.type : 'tradition';
      const targetId = type === 'region' && relation.id ? `region:${relation.id}` : stableGraphRelationNodeId(type, relation.title);
      mergeMissingNode({
        id: targetId, type, title: cleanText(relation.title, 160), aliases: [cleanText(relation.title, 160)].filter(Boolean),
        summary: cleanText(relation.summary, 2000), images: normalizeGraphImages(relation.images), published: true,
        review_status: relation.source_url ? 'published' : 'needs_review', source_url: cleanPublicUrl(relation.source_url || ''),
      });
      const relationType = graphRelationType(type);
      upsertGeneratedEdge({
        id: graphEdgeId(heritageId, relationType, targetId), from: heritageId, relation: relationType, to: targetId,
        origin: 'craft_relation', published: true, review_status: relation.source_url ? 'published' : 'needs_review',
        relationship_summary: cleanText(relation.summary, 2000) || `${craft.title}与${relation.title}存在${relationType === 'USES_MATERIAL' ? '材料使用' : relationType === 'LOCATED_IN' ? '地域' : '传统脉络'}联系，具体依据待审核。`,
      });
    }
  }
  content.graph_nodes = [...nodes.values()];
  content.graph_edges = [...edges.values()];
  return changed;
}

function normalizeGraphPatch(body) {
  if (body?.schema !== 'tanwuzhi.graph-patch/v1') throw new Error('invalid_graph_patch_schema');
  const nodes = (Array.isArray(body.nodes) ? body.nodes : []).slice(0, 5000).map((node) => {
    const type = cleanText(node?.type, 30);
    const id = cleanText(node?.id, 180);
    const title = cleanText(node?.title, 160);
    if (!GRAPH_NODE_TYPES.has(type) || !id.startsWith(`${type}:`) || !title) throw new Error('invalid_graph_node');
    return {
      ...node, id, type, title, summary: cleanText(node.summary, 5000), aliases: cleanList(node.aliases, 30),
      images: normalizeGraphImages(node.images), source_title: cleanText(node.source_title, 300), source_url: cleanPublicUrl(node.source_url || ''),
      review_status: node.source_url ? (cleanText(node.review_status, 40) || 'published') : 'needs_review', published: node.published !== false,
    };
  });
  const edges = (Array.isArray(body.edges) ? body.edges : []).slice(0, 10000).map((edge) => {
    const from = cleanText(edge?.from, 180); const to = cleanText(edge?.to, 180); const relation = cleanText(edge?.relation, 50);
    if (!from || !to || !GRAPH_RELATIONS.has(relation)) throw new Error('invalid_graph_edge');
    return {
      ...edge, id: cleanText(edge.id, 180) || graphEdgeId(from, relation, to), from, to, relation,
      relationship_summary: cleanText(edge.relationship_summary, 3000), comparison_summary: cleanText(edge.comparison_summary, 3000),
      source_title: cleanText(edge.source_title, 300), source_url: cleanPublicUrl(edge.source_url || ''),
      review_status: edge.source_url ? (cleanText(edge.review_status, 40) || 'published') : 'needs_review', published: edge.published !== false,
    };
  });
  return { schema: body.schema, base_revision: cleanText(body.base_revision, 100), nodes, edges };
}

function graphPatchPreview(patch) {
  const nodeMap = new Map((editableContent.graph_nodes || []).map((node) => [node.id, node]));
  const edgeMap = new Map((editableContent.graph_edges || []).map((edge) => [edge.id || graphEdgeId(edge.from, edge.relation, edge.to), edge]));
  const conflicts = [];
  for (const node of patch.nodes) {
    const current = nodeMap.get(node.id);
    if (current?.protected) {
      const protectedKeys = ['title', 'summary', 'aliases', 'images', 'overview_image', 'district_id', 'source_title', 'source_url', 'review_status', 'published'];
      const changed = protectedKeys.some((key) => key in node && JSON.stringify(node[key]) !== JSON.stringify(current[key]));
      if (changed || node.heritage_level && node.heritage_level !== 'primary' || node.protected === false) conflicts.push({ kind: 'protected_node', id: node.id });
    }
  }
  for (const edge of patch.edges) if (!nodeMap.has(edge.from) && !patch.nodes.some((node) => node.id === edge.from) || !nodeMap.has(edge.to) && !patch.nodes.some((node) => node.id === edge.to)) conflicts.push({ kind: 'missing_endpoint', id: edge.id });
  return {
    base_revision: patch.base_revision, current_revision: editableContent.revision,
    revision_conflict: Boolean(patch.base_revision && patch.base_revision !== editableContent.revision), conflicts,
    counts: { nodes_create: patch.nodes.filter((node) => !nodeMap.has(node.id)).length, nodes_update: patch.nodes.filter((node) => nodeMap.has(node.id)).length, edges_create: patch.edges.filter((edge) => !edgeMap.has(edge.id)).length, edges_update: patch.edges.filter((edge) => edgeMap.has(edge.id)).length },
  };
}

function normalizeDocumentaryClips(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 6).map((clip, index) => ({
    title: cleanText(clip?.title, 160) || `纪录片片段 ${index + 1}`,
    video_url: cleanMediaSource(clip?.video_url || clip?.url || ''),
    image_url: cleanImageSource(clip?.image_url || clip?.image || ''),
    evidence_id: cleanText(clip?.evidence_id, 160),
    start_seconds: Math.max(0, Number(clip?.start_seconds ?? clip?.start ?? 0) || 0),
    end_seconds: Math.max(0, Number(clip?.end_seconds ?? clip?.end ?? 0) || 0),
    description: cleanText(clip?.description, 1000),
    source_url: cleanPublicUrl(clip?.source_url || clip?.source || ''),
  })).filter((item) => item.video_url || item.image_url);
}

function normalizeStepImage(value) {
  if (!value || typeof value !== 'object') return null;
  const imageUrl = cleanImageSource(value.image_url || value.url || '');
  if (!imageUrl) return null;
  return {
    image_url: imageUrl,
    alt: cleanText(value.alt, 240),
    original_name: cleanText(value.original_name, 240),
    mime_type: ['image/png', 'image/jpeg', 'image/webp'].includes(value.mime_type) ? value.mime_type : '',
    size: Math.max(0, Math.min(6 * 1024 * 1024, Math.trunc(Number(value.size) || 0))),
  };
}

function cleanMediaSource(value) {
  const source = cleanText(value, 8000);
  if (!source) return '';
  if (/^data:video\/(mp4|webm|ogg);base64,[A-Za-z0-9+/=]+$/i.test(source)) return source;
  if (/^(https?:\/\/|\/|assets\/|data\/)[^\s]+$/i.test(source)) return source;
  return cleanPublicUrl(source);
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
      documentary_clips: normalizeDocumentaryClips(step?.documentary_clips),
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
  const overviewImages = (Array.isArray(body?.overview_images) ? body.overview_images : [])
    .slice(0, 8).map((item, index) => ({
      title: cleanText(item?.title, 160) || `概览图 ${index + 1}`,
      description: cleanText(item?.description, 1000),
      image_url: cleanImageSource(item?.image_url || item?.url),
    })).filter((item) => item.image_url && item.description);
  if (!overviewImages.length) throw new Error('overview_image_required');
  return {
    kind,
    district_id: districtId,
    title,
    category: cleanText(body?.category, 100) || '类别待审核',
    summary,
    history: cleanText(body?.history, 5000),
    features: cleanText(body?.features, 5000),
    source_url: cleanPublicUrl(body?.source_url),
    cover_url: cleanImageSource(body?.cover_url),
    gallery_urls: [...new Set((Array.isArray(body?.gallery_urls) ? body.gallery_urls : [])
      .slice(0, 8).map((item) => cleanImageSource(item)).filter(Boolean))],
    overview_images: overviewImages,
    star_data: {
      summary: cleanText(body?.star_data?.summary, 2000),
      relations: cleanList(body?.star_data?.relations, 20),
      keywords: cleanList(body?.star_data?.keywords, 20),
      images: normalizeGraphImages(body?.star_data?.images),
    },
    include_steps: includeSteps,
    steps,
    contributor_name: cleanText(body?.contributor_name, 100),
    contributor_contact: cleanText(body?.contributor_contact, 200),
  };
}

const GRAPH_CONTRIBUTION_TYPES = new Set(['supplement', 'correction', 'relation', 'image']);
function normalizeGraphSubmission(body) {
  const targetNodeId = cleanText(body?.target_node_id, 180);
  const target = (editableContent.graph_nodes || []).find((node) => node.id === targetNodeId) || getGraphNodeServer(targetNodeId);
  if (!target || !GRAPH_NODE_TYPES.has(target.type)) throw new Error('graph_target_not_found');
  const contributionType = cleanText(body?.contribution_type, 30);
  if (!GRAPH_CONTRIBUTION_TYPES.has(contributionType)) throw new Error('invalid_contribution_type');
  const statement = cleanText(body?.statement, 6000);
  if (statement.length < 20) throw new Error('statement_too_short');
  const sourceTitle = cleanText(body?.source_title, 300);
  const sourceUrl = cleanPublicUrl(body?.source_url);
  if (!sourceTitle || !sourceUrl) throw new Error('source_required');
  const images = normalizeGraphImages(body?.images);
  if (contributionType === 'image' && !images.length) throw new Error('image_required');
  const relatedType = cleanText(body?.related_node_type, 30);
  const relatedTitle = cleanText(body?.related_node_title, 160);
  const relation = cleanText(body?.relation, 50);
  if (contributionType === 'relation') {
    if (!['region', 'tradition', 'material'].includes(relatedType) || !relatedTitle || !GRAPH_RELATIONS.has(relation)) throw new Error('invalid_graph_relation');
    if (graphRelationType(relatedType) !== relation) throw new Error('relation_type_mismatch');
  }
  return {
    kind: 'graph', title: `补充：${target.title}`, category: '知识星图', summary: statement,
    target_node_id: targetNodeId, target_node_title: target.title, target_node_type: target.type,
    contribution_type: contributionType, statement, source_title: sourceTitle, source_url: sourceUrl, images,
    relation: contributionType === 'relation' ? { relation, related_node_type: relatedType, related_node_title: relatedTitle, explanation: cleanText(body?.relation_explanation, 3000) || statement } : null,
    contributor_name: cleanText(body?.contributor_name, 100), contributor_contact: cleanText(body?.contributor_contact, 200),
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

function mergeMissingSiteTextSeed(stored) {
  if (!Array.isArray(stored.site_texts)) stored.site_texts = [];
  const existingKeys = new Set(stored.site_texts.map((item) => cleanText(item?.key, 100)).filter(Boolean));
  let changed = false;
  for (const seed of CONTENT_SEED.site_texts || []) {
    if (existingKeys.has(seed.key)) continue;
    stored.site_texts.push(structuredClone(seed));
    existingKeys.add(seed.key);
    changed = true;
  }
  return changed;
}

async function loadContentStore() {
  try {
    const stored = JSON.parse(await readFile(CONTENT_STORE_PATH, 'utf8'));
    if (!Array.isArray(stored.crafts) || !Array.isArray(stored.craft_steps)) throw new Error('invalid_content_store');
    stored.craft_gallery = Array.isArray(stored.craft_gallery) ? stored.craft_gallery : [];
    stored.site_texts = Array.isArray(stored.site_texts) ? stored.site_texts : [];
    const graphChanged = syncGraphFromContent(stored, { includeSeed: true });
    stored.revision ||= makeRevision();
    const districtChanged = mergeMissingDistrictSeed(stored);
    const siteTextChanged = mergeMissingSiteTextSeed(stored);
    if (districtChanged || siteTextChanged || graphChanged) {
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
  return unifiedStore.write('content', content);
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
    syncGraphFromContent(next);
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
  return unifiedStore.write('community', content);
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
  return { ...editableContent, content_reviewed: Boolean(editableContent.content_reviewed), source: 'site-admin' };
}

let publicContentJsonRevision = '';
let publicContentJsonCache = '';
function serializedPublicContent() {
  const revision = editableContent?.revision || 'seed';
  if (publicContentJsonRevision !== revision) {
    publicContentJsonCache = JSON.stringify(publicContent());
    publicContentJsonRevision = revision;
  }
  return { revision, body: publicContentJsonCache };
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

const RESOURCE_SHAPE_IDS = new Set(['sphere', 'cube', 'slab', 'rod', 'cylinder', 'cone', 'disk', 'ring', 'bowl', 'bundle']);

function normalizeGuideBoldRanges(value, text) {
  const length = text.length;
  const ranges = [];
  for (const item of (Array.isArray(value) ? value : []).slice(0, 40)) {
    const start = Math.max(0, Math.min(length, Math.trunc(Number(item?.start)) || 0));
    const end = Math.max(start, Math.min(length, Math.trunc(Number(item?.end)) || 0));
    if (end > start) ranges.push({ start, end });
  }
  return ranges.sort((a, b) => a.start - b.start || a.end - b.end);
}

function normalizeResourceVisuals(value) {
  const result = [];
  for (const item of (Array.isArray(value) ? value : []).slice(0, 80)) {
    const name = cleanText(item?.name, 100);
    if (!name || result.some((entry) => entry.name === name)) continue;
    const shape = RESOURCE_SHAPE_IDS.has(item?.shape) ? item.shape : '';
    const requestedScale = Number(item?.scale);
    const scale = Number.isFinite(requestedScale) ? Math.max(0.6, Math.min(1.6, requestedScale)) : 1;
    result.push({ name, shape, scale: Math.round(scale * 100) / 100 });
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
    const guideText = String(hasOwn(value, 'guide_text') ? value.guide_text : (old.guide_text || ''))
      .replace(/\r\n/g, '\n')
      .slice(0, 5000);
    return {
      id,
      sort: index + 1,
      craft_id: craftId,
      source_step_id: old.source_step_id || id,
      name: cleanText(value?.name, 200),
      action: cleanText(value?.action, 5000),
      guide_text: guideText,
      guide_bold_ranges: normalizeGuideBoldRanges(
        hasOwn(value, 'guide_bold_ranges') ? value.guide_bold_ranges : old.guide_bold_ranges,
        guideText,
      ),
      result: cleanText(value?.result, 1000),
      materials,
      material_transforms: normalizeMaterialTransforms(value?.material_transforms, materials),
      tools,
      resource_visuals: normalizeResourceVisuals(
        hasOwn(value, 'resource_visuals') ? value.resource_visuals : old.resource_visuals,
      ),
      resource_groups: resourceGroups,
      actions,
      correct_action_id: correct,
      quick_fill: normalizeQuickFill(quickFillInput, resourceGroups.flatMap((group) => group.options), actions, correct),
      evidence_ids: cleanList(old.evidence_ids || value?.evidence_ids, 30),
      documentary_clips: normalizeDocumentaryClips(hasOwn(value, 'documentary_clips') ? value.documentary_clips : old.documentary_clips),
      step_image: normalizeStepImage(hasOwn(value, 'step_image') ? value.step_image : old.step_image),
      review_status: old.review_status || 'edited_by_admin',
    };
  });
}

function legacyGeneratedImportIsUntouched(craft, steps, incomingTitle) {
  const keywords = Array.isArray(craft?.graph_data?.keywords) ? craft.graph_data.keywords : [];
  return craft?.source === 'admin-import'
    && String(craft.id || '').startsWith('LOCAL_')
    && craft.title === incomingTitle
    && craft.category === '传统技艺（候选）'
    && /非遗资源补充候选。现有公开资料提示/.test(craft.summary || '')
    && keywords.includes('待核验')
    && steps.length === 0
    && /wikimedia\.org\//i.test(craft.cover_path || '');
}

const unifiedStore = await createUnifiedContentStore({
  dbPath: CONTENT_DB_PATH,
  legacyContentPath: CONTENT_STORE_PATH,
  legacyCommunityPath: COMMUNITY_STORE_PATH,
  seedContent: CONTENT_SEED,
  seedCommunity: {
    version: 1,
    revision: makeRevision(),
    updated_at: new Date().toISOString(),
    engagement: {},
    submissions: [],
  },
});
editableContent = unifiedStore.content;
communityState = unifiedStore.community;
if (syncGraphFromContent(editableContent, { includeSeed: true })) {
  editableContent.updated_at = new Date().toISOString();
  editableContent.revision = makeRevision();
  editableContent = await writeContentStore(editableContent);
}

async function handleContentApi(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }
  const payload = serializedPublicContent();
  const etag = `"${payload.revision}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' }).end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
    ETag: etag,
    'Content-Length': Buffer.byteLength(payload.body),
  });
  res.end(payload.body);
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
      const body = await readJsonBody(req, 8 * 1024 * 1024);
      if (cleanText(body.website, 200)) { jsonResponse(res, 400, { error: 'invalid_submission' }, responseHeaders); return; }
      const normalized = body?.kind === 'graph' ? normalizeGraphSubmission(body) : normalizeSubmission(body);
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
          published_graph_node_id: null,
          published_graph_edge_id: null,
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
      graph_data: {
        summary: submission.star_data?.summary || '',
        relations: (submission.star_data?.relations || []).map((title) => ({ type: 'tradition', title, summary: '' })),
        keywords: submission.star_data?.keywords || [],
        images: submission.star_data?.images || [],
        overview_images: submission.overview_images || [],
      },
      community_details: {
        history: submission.history || '',
        features: submission.features || '',
        source_url: submission.source_url || '',
        contributor_name: submission.contributor_name || '',
        star_data: submission.star_data || {},
        overview_images: submission.overview_images || [],
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
    const overviewImages = submission.overview_images?.length ? submission.overview_images : submission.gallery_urls.map((url, index) => ({ title: `概览图 ${index + 1}`, description: '社区投稿概览图片', image_url: url }));
    overviewImages.forEach((image, index) => {
      next.craft_gallery.push({
        id: `${craftId}_work_${String(index + 1).padStart(2, '0')}`,
        sort: index + 1,
        craft_id: craftId,
        title: image.title || `${submission.title}社区资料图 ${index + 1}`,
        description: image.description || '',
        image_url: image.image_url,
        source_path: '',
        evidence_id: '',
      });
    });
  });
  return craftId;
}

async function publishGraphSubmission(submission) {
  let publishedNodeId = submission.target_node_id;
  let publishedEdgeId = null;
  await saveContent('', (next) => {
    syncGraphFromContent(next);
    const target = next.graph_nodes.find((node) => node.id === submission.target_node_id);
    if (!target) throw new Error('graph_target_not_found');
    target.community_knowledge = Array.isArray(target.community_knowledge) ? target.community_knowledge : [];
    if (target.community_knowledge.some((item) => item.submission_id === submission.id)) return;
    const approvedAt = new Date().toISOString();
    target.community_knowledge.push({
      submission_id: submission.id, contribution_type: submission.contribution_type,
      statement: submission.statement, source_title: submission.source_title, source_url: submission.source_url,
      approved_at: approvedAt,
    });
    if (submission.contribution_type === 'correction') {
      target.revision_history = Array.isArray(target.revision_history) ? target.revision_history : [];
      if (target.summary) target.revision_history.push({ summary: target.summary, replaced_at: approvedAt, submission_id: submission.id });
      target.summary = submission.statement;
    } else if (!target.summary && submission.contribution_type === 'supplement') target.summary = submission.statement;
    if (submission.contribution_type === 'image') {
      target.images = [...(Array.isArray(target.images) ? target.images : []), ...(submission.images || [])]
        .filter((item, index, all) => all.findIndex((other) => other.image_url === item.image_url) === index).slice(0, 12);
      if (!target.overview_image && target.images[0]) target.overview_image = target.images[0].image_url;
    }
    if (submission.contribution_type === 'relation' && submission.relation) {
      const related = submission.relation;
      const existingRelated = next.graph_nodes.find((node) => node.type === related.related_node_type
        && cleanText(node.title, 160).normalize('NFKC') === related.related_node_title.normalize('NFKC'));
      const relatedNodeId = existingRelated?.id || stableGraphRelationNodeId(related.related_node_type, related.related_node_title);
      publishedNodeId = target.id;
      if (!next.graph_nodes.some((node) => node.id === relatedNodeId)) next.graph_nodes.push({
        id: relatedNodeId, type: related.related_node_type, title: related.related_node_title,
        aliases: [related.related_node_title], summary: related.explanation, source_title: submission.source_title,
        source_url: submission.source_url, review_status: 'approved_community', published: true,
        community_knowledge: [{ submission_id: submission.id, contribution_type: 'relation', statement: related.explanation, source_title: submission.source_title, source_url: submission.source_url, approved_at: approvedAt }],
      });
      publishedEdgeId = graphEdgeId(target.id, related.relation, relatedNodeId);
      if (!next.graph_edges.some((edge) => edge.id === publishedEdgeId)) next.graph_edges.push({
        id: publishedEdgeId, from: target.id, relation: related.relation, to: relatedNodeId,
        relationship_summary: related.explanation, source_title: submission.source_title, source_url: submission.source_url,
        origin: 'community_review', review_status: 'approved_community', published: true, submission_id: submission.id,
      });
    }
  });
  return { nodeId: publishedNodeId, edgeId: publishedEdgeId };
}

const STEP_IMAGE_TYPES = Object.freeze({
  'image/png': { extension: '.png', matches: (buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { extension: '.jpg', matches: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  'image/webp': { extension: '.webp', matches: (buffer) => buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP' },
});

async function handleStepImageUpload(req, res, craftId, stepId) {
  try {
    const craftExists = editableContent.crafts.some((craft) => craft.id === craftId);
    if (!craftExists) { jsonResponse(res, 404, { error: 'craft_not_found' }); return; }
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(stepId)) { jsonResponse(res, 400, { error: 'invalid_step_id' }); return; }
    const mimeType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const imageType = STEP_IMAGE_TYPES[mimeType];
    if (!imageType) { jsonResponse(res, 415, { error: 'unsupported_image_type' }); return; }
    const buffer = await readBufferBody(req);
    if (!buffer.length) { jsonResponse(res, 400, { error: 'empty_image' }); return; }
    if (!imageType.matches(buffer)) { jsonResponse(res, 400, { error: 'invalid_image_content' }); return; }
    const craftDirectory = join(CONTENT_UPLOAD_DIR, 'steps', craftId);
    await mkdir(craftDirectory, { recursive: true });
    const fileName = `${stepId}-${Date.now().toString(36)}-${randomBytes(8).toString('hex')}${imageType.extension}`;
    await writeFile(join(craftDirectory, fileName), buffer, { flag: 'wx' });
    let originalName = '';
    try { originalName = decodeURIComponent(String(req.headers['x-file-name'] || '')); } catch { originalName = ''; }
    jsonResponse(res, 201, {
      ok: true,
      image: {
        image_url: `/content-uploads/steps/${craftId}/${fileName}`,
        alt: '',
        original_name: cleanText(originalName, 240),
        mime_type: mimeType,
        size: buffer.length,
      },
    });
  } catch (error) {
    jsonResponse(res, error?.message === 'body_too_large' ? 413 : 400, { error: error?.message || 'image_upload_failed' });
  }
}

function pngDimensions(buffer) {
  if (!STEP_IMAGE_TYPES['image/png'].matches(buffer) || buffer.length < 24 || buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function brandLogoState() {
  const uploaded = await stat(BRAND_LOGO_PATH).catch(() => null);
  const fallback = uploaded?.isFile() ? null : await stat(DEFAULT_BRAND_LOGO_PATH).catch(() => null);
  const current = uploaded?.isFile() ? uploaded : fallback;
  return {
    uploaded: Boolean(uploaded?.isFile()),
    version: current ? `${Math.trunc(current.mtimeMs).toString(36)}-${current.size.toString(36)}` : 'missing',
    size: current?.size || 0,
    logo_url: '/brand/logo.png',
  };
}

async function handleBrandLogoUpload(req, res) {
  try {
    const mimeType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (mimeType !== 'image/png') { jsonResponse(res, 415, { error: 'brand_logo_png_required' }); return; }
    const buffer = await readBufferBody(req, 2 * 1024 * 1024);
    const dimensions = pngDimensions(buffer);
    if (!dimensions) { jsonResponse(res, 400, { error: 'invalid_brand_logo' }); return; }
    if (dimensions.width < 64 || dimensions.height < 64 || dimensions.width > 2048 || dimensions.height > 2048) {
      jsonResponse(res, 400, { error: 'brand_logo_dimensions' }); return;
    }
    await mkdir(dirname(BRAND_LOGO_PATH), { recursive: true });
    await writeFile(BRAND_LOGO_PATH, buffer, { mode: 0o644 });
    const state = await brandLogoState();
    jsonResponse(res, 200, { ok: true, ...state, width: dimensions.width, height: dimensions.height });
  } catch (error) {
    jsonResponse(res, error?.message === 'body_too_large' ? 413 : 400, { error: error?.message || 'brand_logo_upload_failed' });
  }
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
      jsonResponse(res, 200, { authenticated: true, username: ADMIN_USERNAME, revision: editableContent.revision, content_reviewed: Boolean(editableContent.content_reviewed) }, { 'Set-Cookie': sessionCookie(req, token) });
    } catch (error) {
      jsonResponse(res, error?.message === 'body_too_large' ? 413 : 400, { error: error?.message || 'bad_request' });
    }
    return;
  }

  const session = currentSession(req);
  if (urlPath === '/api/admin/session' && req.method === 'GET') {
    jsonResponse(res, 200, { authenticated: Boolean(session), username: session?.username || null, revision: editableContent.revision, content_reviewed: Boolean(editableContent.content_reviewed) });
    return;
  }
  if (!session) { jsonResponse(res, 401, { error: 'authentication_required' }); return; }
  if (urlPath === '/api/admin/logout' && req.method === 'POST') {
    sessions.delete(session.token);
    jsonResponse(res, 200, { authenticated: false }, { 'Set-Cookie': sessionCookie(req, '', 0) });
    return;
  }

  if (urlPath === '/api/admin/brand/logo' && req.method === 'GET') {
    jsonResponse(res, 200, await brandLogoState());
    return;
  }
  if (urlPath === '/api/admin/brand/logo' && req.method === 'PUT') {
    await handleBrandLogoUpload(req, res);
    return;
  }

  const stepImageUploadMatch = urlPath.match(/^\/api\/admin\/crafts\/([A-Za-z0-9_-]+)\/steps\/([A-Za-z0-9_-]+)\/image$/);
  if (stepImageUploadMatch && req.method === 'POST') {
    await handleStepImageUpload(req, res, stepImageUploadMatch[1], stepImageUploadMatch[2]);
    return;
  }

  if (urlPath === '/api/admin/content-review' && req.method === 'PUT') {
    try {
      const body = await readJsonBody(req, 16 * 1024);
      const expected = cleanText(body.revision, 100);
      const reviewed = Boolean(body.reviewed);
      const updated = await saveContent(expected, (next) => {
        next.content_reviewed = reviewed;
        next.content_reviewed_at = reviewed ? new Date().toISOString() : null;
        next.content_reviewed_by = reviewed ? session.username : null;
      });
      jsonResponse(res, 200, { ok: true, revision: updated.revision, content_reviewed: Boolean(updated.content_reviewed) });
    } catch (error) {
      jsonResponse(res, error?.code === 'content_conflict' ? 409 : 400, { error: error?.code || error?.message || 'review_update_failed', revision: editableContent.revision });
    }
    return;
  }

  if (urlPath === '/api/admin/graph/export' && req.method === 'GET') {
    jsonResponse(res, 200, {
      schema: 'tanwuzhi.graph-patch/v1', base_revision: editableContent.revision,
      exported_at: new Date().toISOString(), nodes: editableContent.graph_nodes || [], edges: editableContent.graph_edges || [],
    });
    return;
  }

  if ((urlPath === '/api/admin/graph/patch/preview' || urlPath === '/api/admin/graph/patch/apply') && req.method === 'POST') {
    try {
      const patch = normalizeGraphPatch(await readJsonBody(req, 12 * 1024 * 1024));
      const preview = graphPatchPreview(patch);
      if (urlPath.endsWith('/preview')) { jsonResponse(res, 200, { ok: true, ...preview }); return; }
      if (preview.revision_conflict) { jsonResponse(res, 409, { error: 'graph_revision_conflict', ...preview }); return; }
      if (preview.conflicts.length) { jsonResponse(res, 409, { error: 'graph_patch_conflict', ...preview }); return; }
      const updated = await saveContent('', (next) => {
        const nodeMap = new Map((next.graph_nodes || []).map((node) => [node.id, node]));
        const edgeMap = new Map((next.graph_edges || []).map((edge) => [edge.id || graphEdgeId(edge.from, edge.relation, edge.to), edge]));
        for (const node of patch.nodes) {
          const current = nodeMap.get(node.id);
          if (current?.protected) {
            node.heritage_level = 'primary'; node.protected = true;
          }
          nodeMap.set(node.id, { ...current, ...node });
        }
        for (const edge of patch.edges) edgeMap.set(edge.id, { ...edgeMap.get(edge.id), ...edge });
        next.graph_nodes = [...nodeMap.values()]; next.graph_edges = [...edgeMap.values()];
      });
      jsonResponse(res, 200, { ok: true, applied: true, revision: updated.revision, counts: preview.counts });
    } catch (error) {
      const code = error?.code === 'content_conflict' ? 409 : error?.message === 'body_too_large' ? 413 : 400;
      jsonResponse(res, code, { error: error?.message || 'graph_patch_failed', revision: editableContent.revision });
    }
    return;
  }

  if (urlPath === '/api/admin/crafts/bulk-delete' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req, 64 * 1024);
      const requestedIds = [...new Set((Array.isArray(body.ids) ? body.ids : [])
        .slice(0, 200)
        .map((id) => cleanText(id, 80))
        .filter((id) => /^[A-Za-z0-9_-]+$/.test(id)))];
      if (!requestedIds.length) throw new Error('craft_ids_required');
      const requested = new Set(requestedIds);
      const existingCrafts = editableContent.crafts.filter((craft) => requested.has(craft.id));
      const missingIds = requestedIds.filter((id) => !existingCrafts.some((craft) => craft.id === id));
      if (missingIds.length) {
        const error = new Error('craft_not_found');
        error.missingIds = missingIds;
        throw error;
      }
      const protectedIds = existingCrafts
        .filter((craft) => PRIMARY_HERITAGE_IDS.has(craft.id) || craft.protected === true)
        .map((craft) => craft.id);
      if (protectedIds.length) {
        const error = new Error('protected_craft_delete');
        error.protectedIds = protectedIds;
        throw error;
      }
      const deletedSubmissionIds = existingCrafts.map((craft) => craft.submission_id).filter(Boolean);
      const graphIds = new Set(requestedIds.flatMap((id) => [id, `heritage:${id}`]));
      const updated = await saveContent(cleanText(body.revision, 100), (next) => {
        next.crafts = next.crafts.filter((craft) => !requested.has(craft.id));
        next.craft_steps = next.craft_steps.filter((step) => !requested.has(step.craft_id));
        next.craft_gallery = next.craft_gallery.filter((item) => !requested.has(item.craft_id));
        next.graph_nodes = (next.graph_nodes || []).filter((node) => !graphIds.has(node.id) && !requested.has(node.raw_id));
        next.graph_edges = (next.graph_edges || []).filter((edge) => !graphIds.has(edge.from) && !graphIds.has(edge.to));
      });
      let communityCleanup = true;
      try {
        await saveCommunity('', (next) => {
          for (const id of requestedIds) delete next.engagement?.[id];
          for (const submission of next.submissions || []) {
            if (!deletedSubmissionIds.includes(submission.id) && !requested.has(submission.published_craft_id)) continue;
            submission.publication_removed_at = new Date().toISOString();
            submission.publication_removed_by = session.username;
          }
        });
      } catch (cleanupError) {
        communityCleanup = false;
        console.warn(`批量删除后的社区审计清理未完成：${cleanupError?.message || 'unknown error'}`);
      }
      jsonResponse(res, 200, {
        ok: true,
        deleted_count: requestedIds.length,
        deleted_ids: requestedIds,
        community_cleanup: communityCleanup,
        revision: updated.revision,
      });
    } catch (error) {
      const isConflict = error?.code === 'content_conflict';
      const isProtected = error?.message === 'protected_craft_delete';
      const isMissing = error?.message === 'craft_not_found';
      const code = isConflict || isProtected ? 409 : isMissing ? 404 : error?.message === 'body_too_large' ? 413 : 400;
      jsonResponse(res, code, {
        error: error?.code || error?.message || 'bulk_delete_failed',
        revision: editableContent.revision,
        ...(error?.protectedIds ? { protected_ids: error.protectedIds } : {}),
        ...(error?.missingIds ? { missing_ids: error.missingIds } : {}),
      });
    }
    return;
  }

  if (urlPath === '/api/admin/crafts/import' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req, 8 * 1024 * 1024);
      const title = cleanText(body.title || body.name, 200);
      const summary = cleanText(body.summary || body.description, 10000);
      if (title.length < 2) throw new Error('title_required');
      if (summary.length < 10) throw new Error('summary_required');
      const requestedId = cleanText(body.id, 80).replace(/[^A-Za-z0-9_-]/g, '_');
      const existing = requestedId ? editableContent.crafts.find((craft) => craft.id === requestedId) : null;
      const wantsUpdate = body.update_existing === true;
      if (existing && !wantsUpdate) throw new Error('duplicate_craft_id');
      if (existing && (PRIMARY_HERITAGE_IDS.has(existing.id) || existing.protected || existing.source !== 'admin-import')) throw new Error('protected_existing_craft');
      const existingSteps = existing ? editableContent.craft_steps.filter((step) => step.craft_id === existing.id) : [];
      const canReplaceExisting = existing && !existing.editor_touched && (
        existing.import_managed === true || legacyGeneratedImportIsUntouched(existing, existingSteps, title)
      );
      if (existing && !canReplaceExisting) throw new Error('existing_content_modified');
      const craftId = existing?.id || requestedId || `ADMIN_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
      const graph = body.graph_data || body.star_data || {};
      const overviewImages = (Array.isArray(body.overview_images) ? body.overview_images : []).slice(0, 8).map((item, index) => ({
        title: cleanText(item?.title, 160) || `概览图 ${index + 1}`,
        description: cleanText(item?.description, 1000),
        image_url: cleanImageSource(item?.image_url || item?.url),
        source_url: cleanPublicUrl(item?.source_url || item?.source || ''),
        image_status: cleanText(item?.image_status, 80),
      })).filter((item) => item.image_url && item.description);
      if (!overviewImages.length) throw new Error('overview_image_required');
      const importedSteps = Array.isArray(body.steps) ? body.steps.slice(0, 24).map((step, index) => ({
        id: `${craftId}_step_${String(index + 1).padStart(2, '0')}`,
        source_step_id: `${craftId}_step_${String(index + 1).padStart(2, '0')}`,
        name: cleanText(step?.name, 200), action: cleanText(step?.description || step?.action, 5000),
        result: cleanText(step?.result, 1000), materials: cleanList(step?.materials, 30), tools: cleanList(step?.tools, 20),
        actions: cleanList(step?.actions, 15).map((label, actionIndex) => ({ id: `${craftId}_step_${String(index + 1).padStart(2, '0')}_action_${actionIndex + 1}`, label })),
        documentary_clips: normalizeDocumentaryClips(step?.documentary_clips),
        step_image: normalizeStepImage(step?.step_image),
      })) : [];
      const imported = await saveContent(cleanText(body.revision, 100), (next) => {
        const current = next.crafts.find((craft) => craft.id === craftId);
        const sort = current?.sort || Math.max(0, ...next.crafts.map((craft) => Number(craft.sort) || 0)) + 1;
        const importedCraft = {
          ...current, id: craftId, sort, title, district_id: cleanText(body.district_id, 80),
          category: cleanText(body.category, 100) || '类别待审核', summary,
          cover_path: cleanImageSource(body.cover_url || body.cover_path),
          model_path: cleanText(body.model_path || body.model_url, 1200) || current?.model_path || '',
          source_directory: '', source: 'admin-import',
          editor_touched: false, import_managed: true, imported_at: new Date().toISOString(),
          community_details: {
            ...(current?.community_details || {}),
            history: cleanText(body.history, 5000), features: cleanText(body.features, 5000),
            source_url: cleanPublicUrl(body.source_url), overview_images: overviewImages,
          },
          graph_data: {
            summary: cleanText(graph.summary, 2000),
            relations: Array.isArray(graph.relations) ? graph.relations.slice(0, 24).map((relation) => ({ type: ['tradition', 'material', 'region'].includes(relation?.type) ? relation.type : 'tradition', title: cleanText(relation?.title || relation, 160), summary: cleanText(relation?.summary, 1000), images: normalizeGraphImages(relation?.images) })).filter((relation) => relation.title) : [],
            keywords: cleanList(graph.keywords, 30), overview_images: overviewImages, images: normalizeGraphImages(graph.images),
          },
        };
        if (current) Object.assign(current, importedCraft);
        else next.crafts.push(importedCraft);
        next.craft_steps = next.craft_steps.filter((step) => step.craft_id !== craftId);
        if (importedSteps.length) next.craft_steps.push(...normalizeSteps(craftId, importedSteps, existingSteps));
        next.craft_gallery = next.craft_gallery.filter((item) => item.craft_id !== craftId);
        overviewImages.forEach((image, index) => next.craft_gallery.push({
          id: `${craftId}_work_${String(index + 1).padStart(2, '0')}`, sort: index + 1, craft_id: craftId,
          title: image.title, description: image.description, image_url: image.image_url,
          source_url: image.source_url, image_status: image.image_status, source_path: '', evidence_id: '',
        }));
      });
      jsonResponse(res, existing ? 200 : 201, { ok: true, craft_id: craftId, updated: Boolean(existing), revision: imported.revision });
    } catch (error) {
      const conflictErrors = new Set(['duplicate_craft_id', 'protected_existing_craft', 'existing_content_modified']);
      const code = error?.code === 'content_conflict' || conflictErrors.has(error?.message) ? 409 : error?.message === 'body_too_large' ? 413 : 400;
      jsonResponse(res, code, { error: error?.message || 'import_failed', revision: editableContent.revision });
    }
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
      const graphPublication = action === 'approved' && submission.kind === 'graph' ? await publishGraphSubmission(submission) : null;
      const publishedCraftId = action === 'approved' && submission.kind !== 'graph' ? await publishSubmission(submission) : null;
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
        target.published_graph_node_id = graphPublication?.nodeId || null;
        target.published_graph_edge_id = graphPublication?.edgeId || null;
      });
      jsonResponse(res, 200, {
        ok: true,
        status: action,
        published_craft_id: publishedCraftId,
        published_graph_node_id: graphPublication?.nodeId || null,
        published_graph_edge_id: graphPublication?.edgeId || null,
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
        const allowed = new Set((CONTENT_SEED.site_texts || []).map((item) => item.key));
        for (const key of updates.keys()) if (!allowed.has(key)) throw new Error('invalid_site_text_key');
        mergeMissingSiteTextSeed(next);
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
          const craft = next.crafts.find((entry) => entry.id === stepsMatch[1]);
          if (craft?.source === 'admin-import') craft.editor_touched = true;
        });
      } else if (craftMatch) {
        updated = await saveContent(expected, (next) => {
          const item = next.crafts.find((entry) => entry.id === craftMatch[1]);
          if (!item) throw new Error('not_found');
          if ('title' in body) item.title = cleanText(body.title, 200);
          if ('category' in body) item.category = cleanText(body.category, 100);
          if ('summary' in body) item.summary = cleanText(body.summary, 10000);
          if ('graph_data' in body) {
            const graph = body.graph_data && typeof body.graph_data === 'object' ? body.graph_data : {};
            item.graph_data = {
              summary: cleanText(graph.summary, 2000),
              relations: Array.isArray(graph.relations) ? graph.relations.slice(0, 24).map((relation) => ({
                id: cleanText(relation?.id, 100),
                type: ['tradition', 'material', 'region'].includes(relation?.type) ? relation.type : 'tradition',
                title: cleanText(relation?.title, 160),
                summary: cleanText(relation?.summary, 1000), images: normalizeGraphImages(relation?.images),
              })).filter((relation) => relation.title) : [],
              keywords: cleanList(graph.keywords, 30),
              overview_images: Array.isArray(graph.overview_images) ? graph.overview_images.slice(0, 8) : [],
              images: normalizeGraphImages(graph.images),
            };
          }
          if (item.source === 'admin-import') item.editor_touched = true;
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
    json(200, { query, craft_id: craftId, count: results.length, total_chunks: KNOWLEDGE_BASE.chunks.length + editableKnowledgeChunks(craftId).length, results });
  } catch (err) {
    json(err?.message === 'body_too_large' ? 413 : 400, { error: err?.message || 'bad_request' });
  }
}

async function handleGraphApi(req, res, urlPath) {
  const json = (code, payload) => jsonResponse(res, code, payload);
  if (urlPath === '/api/graph/search' && req.method === 'GET') {
    const parsed = new URL(req.url, 'http://localhost');
    const query = String(parsed.searchParams.get('q') || parsed.searchParams.get('query') || '').slice(0, 120);
    const types = parsed.searchParams.getAll('type');
    json(200, { query, count: searchGraphServer(query, types.length ? types : ['heritage', 'region'], parsed.searchParams.get('limit')).length, results: searchGraphServer(query, types.length ? types : ['heritage', 'region'], parsed.searchParams.get('limit')) });
    return;
  }
  const nodeMatch = urlPath.match(/^\/api\/graph\/node\/((?:heritage|region|tradition|material):[A-Za-z0-9_-]+)$/);
  if (nodeMatch && req.method === 'GET') {
    const node = getGraphNodeServer(nodeMatch[1]);
    if (!node) { json(404, { error: 'node_not_found' }); return; }
    json(200, { node }); return;
  }
  const branchMatch = urlPath.match(/^\/api\/graph\/node\/((?:heritage|region|tradition|material):[A-Za-z0-9_-]+)\/branches$/);
  if (branchMatch && req.method === 'GET') {
    const node = getGraphNodeServer(branchMatch[1]);
    if (!node) { json(404, { error: 'node_not_found' }); return; }
    json(200, { node_id: branchMatch[1], ...graphBranchesServer(branchMatch[1]) }); return;
  }
  json(404, { error: 'not_found' });
}

async function handleAgentSessionApi(req, res) {
  if (req.method !== 'POST') { jsonResponse(res, 405, { error: 'method_not_allowed' }); return; }
  const sessionId = randomBytes(18).toString('base64url');
  jsonResponse(res, 200, {
    session_id: sessionId,
    expires_in: 1800,
    user_role: currentSession(req) ? 'admin' : 'visitor',
    available_tools: ['get_current_context', 'search_graph', 'open_node', 'expand_branch', 'set_root_node', 'open_heritage_detail', 'open_region', 'go_back', 'return_to_root', 'focus_model', 'read_summary', 'stop_speaking', 'set_voice_preferences', 'show_help'],
  });
}

async function handleAgentContextApi(req, res) {
  if (req.method !== 'GET') { jsonResponse(res, 405, { error: 'method_not_allowed' }); return; }
  jsonResponse(res, 200, { user_role: currentSession(req) ? 'admin' : 'visitor', content_revision: editableContent.revision, graph_revision: 'compat-local' });
}

function requestIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

async function handleVoiceSessionApi(req, res) {
  if (req.method !== 'POST') { jsonResponse(res, 405, { error: 'method_not_allowed' }); return; }
  try {
    const payload = await readJsonBody(req).catch(() => ({}));
    const session = voiceSessions.create({ ip: requestIp(req), contextRevision: payload.context_revision || 'unknown' });
    jsonResponse(res, 200, {
      ...session,
      transport: 'websocket', websocket_url: '/api/voice/stream', provider: VOICE_STT_PROVIDER,
      mode: '2pass', sample_rate: 16000, channels: 1, format: 'pcm_s16le',
      max_duration_seconds: Math.min(60, Math.max(5, Number(env('VOICE_MAX_DURATION_SECONDS', '30')))),
      supports_partial: VOICE_STT_PROVIDER === 'funasr-local', supports_hotwords: VOICE_STT_PROVIDER === 'funasr-local',
      raw_audio_retention: 'none',
    });
  } catch (error) {
    jsonResponse(res, error?.message === 'VOICE_RATE_LIMITED' ? 429 : 503, { error: error?.message || 'voice_session_unavailable' });
  }
}

async function handleVoiceHealthApi(req, res) {
  if (req.method !== 'GET') { jsonResponse(res, 405, { error: 'method_not_allowed' }); return; }
  if (VOICE_STT_PROVIDER !== 'funasr-local') { jsonResponse(res, 200, { status: 'disabled', provider: VOICE_STT_PROVIDER, streaming: false }); return; }
  let status = 'down';
  try {
    const target = new URL(VOICE_FUNASR_WS_URL);
    await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: target.hostname, port: Number(target.port || 80) });
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('timeout')); }, 1200);
      socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(); });
      socket.once('error', (error) => { clearTimeout(timer); reject(error); });
    });
    status = 'reachable';
  } catch {}
  jsonResponse(res, status === 'reachable' ? 200 : 503, { status, provider: 'funasr-local', streaming: true });
}

async function handleVoiceConfigApi(req, res) {
  if (req.method !== 'GET') { jsonResponse(res, 405, { error: 'method_not_allowed' }); return; }
  jsonResponse(res, 200, {
    wake_words: String(env('VOICE_WAKE_WORDS', '小蕉小蕉')).split(',').map((item) => item.trim()).filter(Boolean).slice(0, 4),
    provider: VOICE_STT_PROVIDER,
    local_wake_word: false,
    wake_word_mode: VOICE_STT_PROVIDER === 'funasr-local' ? 'server_phrase_gate_single_turn' : 'browser_phrase_gate_single_turn',
    wake_word_status: VOICE_STT_PROVIDER === 'funasr-local' ? 'available_with_opt_in' : 'fallback_only',
    wake_single_turn: true,
    browser_speech_fallback: true,
    tts: 'browser',
    streaming: VOICE_STT_PROVIDER === 'funasr-local',
    sample_rate: 16000,
    audio_format: 'pcm_s16le',
    max_duration_seconds: Math.min(60, Math.max(5, Number(env('VOICE_MAX_DURATION_SECONDS', '30')))),
    raw_audio_retention: 'none',
  });
}

async function handleVoiceSessionTokenApi(req, res) {
  await handleVoiceSessionApi(req, res);
}

async function handleAgentApi(req, res, { protocol = false } = {}) {
  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  if (req.method !== 'POST') { json(405, { error: 'method_not_allowed' }); return; }
  let parsedPayload = null;
  let parsedUserMsg = '';
  let parsedKnowledge = [];
  try {
      const payload = await readJsonBody(req);
      parsedPayload = payload;
      const userMsg = String(payload.messages?.at(-1)?.content || '').slice(0, 2000);
      parsedUserMsg = userMsg;
      if (!userMsg) { json(400, { error: 'empty_message' }); return; }
      const craftId = /^SHIH_\d{4}$/.test(String(payload.context?.craft?.id || '')) ? payload.context.craft.id : null;
      const retrievedKnowledge = searchKnowledge(userMsg, craftId, 8);
      parsedKnowledge = retrievedKnowledge;
      const localResponse = (reason) => {
        const content = buildLocalAgentReply(userMsg, payload.context || {}, retrievedKnowledge);
        const shared = { knowledge: retrievedKnowledge, mode: 'local-retrieval', degraded_reason: reason || null };
        if (protocol) json(200, { type: 'assistant_message', assistant_message: content, ...shared, session_state: { context_revision: payload.context?.context_revision || 'unknown' } });
        else json(200, { content, ...shared });
      };
      if (AGENT_LOCAL_ONLY || !DEEPSEEK_KEY || agentUpstreamDisabledReason) {
        localResponse(AGENT_LOCAL_ONLY ? 'local_only' : agentUpstreamDisabledReason || 'no_api_key');
        return;
      }
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
      if (!upstream.ok) {
        if ([401, 403].includes(upstream.status)) agentUpstreamDisabledReason = `upstream_${upstream.status}`;
        localResponse(`upstream_${upstream.status}`);
        return;
      }
      const data = await upstream.json();
      const content = data?.choices?.[0]?.message?.content || '';
      if (!content) { localResponse('empty_upstream'); return; }
      if (protocol) {
        json(200, { type: 'assistant_message', assistant_message: content, knowledge: retrievedKnowledge, session_state: { context_revision: payload.context?.context_revision || 'unknown' } });
      } else {
        json(200, { content, knowledge: retrievedKnowledge, mode: 'model' });
      }
    } catch (err) {
      if (['invalid_json', 'body_too_large'].includes(err?.message)) {
        json(err.message === 'body_too_large' ? 413 : 400, { error: err.message });
        return;
      }
      if (parsedPayload && parsedUserMsg) {
        const reason = err?.name === 'AbortError' ? 'timeout' : 'proxy_error';
        const content = buildLocalAgentReply(parsedUserMsg, parsedPayload.context || {}, parsedKnowledge);
        const shared = { knowledge: parsedKnowledge, mode: 'local-retrieval', degraded_reason: reason };
        if (protocol) json(200, { type: 'assistant_message', assistant_message: content, ...shared, session_state: { context_revision: parsedPayload.context?.context_revision || 'unknown' } });
        else json(200, { content, ...shared });
        return;
      }
      json(502, { error: 'proxy_error' });
    }
}

async function serveContentUpload(req, res, urlPath) {
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' }).end('Method Not Allowed');
    return;
  }
  const uploadPath = urlPath.slice('/content-uploads/'.length);
  if (!/^steps\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(?:png|jpe?g|webp)$/i.test(uploadPath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
    return;
  }
  const target = normalize(join(CONTENT_UPLOAD_DIR, uploadPath));
  const targetRelative = relative(CONTENT_UPLOAD_DIR, target);
  if (!targetRelative || targetRelative.startsWith('..') || isAbsolute(targetRelative)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Forbidden');
    return;
  }
  const targetStat = await stat(target).catch(() => null);
  if (!targetStat?.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
    return;
  }
  const extension = extname(target).toLowerCase();
  const headers = {
    'Content-Type': MIME[extension] || 'application/octet-stream',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Length': targetStat.size,
    'X-Content-Type-Options': 'nosniff',
  };
  if (req.method === 'HEAD') { res.writeHead(200, headers).end(); return; }
  res.writeHead(200, headers);
  createReadStream(target).on('error', () => res.destroy()).pipe(res);
}

async function serveBrandLogo(req, res) {
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' }).end('Method Not Allowed');
    return;
  }
  const uploaded = await stat(BRAND_LOGO_PATH).catch(() => null);
  const target = uploaded?.isFile() ? BRAND_LOGO_PATH : DEFAULT_BRAND_LOGO_PATH;
  const targetStat = uploaded?.isFile() ? uploaded : await stat(target).catch(() => null);
  if (!targetStat?.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
    return;
  }
  const headers = {
    'Content-Type': 'image/png',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Content-Length': targetStat.size,
    'X-Content-Type-Options': 'nosniff',
  };
  if (req.method === 'HEAD') { res.writeHead(200, headers).end(); return; }
  res.writeHead(200, headers);
  createReadStream(target).on('error', () => res.destroy()).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (urlPath === '/api/content') { await handleContentApi(req, res); return; }
    if (urlPath === '/api/graph/search' || urlPath.startsWith('/api/graph/node/')) { await handleGraphApi(req, res, urlPath); return; }
    if (urlPath === '/api/agent/session') { await handleAgentSessionApi(req, res); return; }
    if (urlPath === '/api/agent/context') { await handleAgentContextApi(req, res); return; }
    if (urlPath === '/api/agent/message') { await handleAgentApi(req, res, { protocol: true }); return; }
    if (urlPath === '/api/agent/tool-result') { jsonResponse(res, 501, { error: 'client_tool_execution', message: '站内工具由前端 Tool Registry 执行，服务端不接受任意工具结果。' }); return; }
    if (urlPath === '/api/voice/session') { await handleVoiceSessionApi(req, res); return; }
    if (urlPath === '/api/voice/health') { await handleVoiceHealthApi(req, res); return; }
    if (urlPath === '/api/voice/config') { await handleVoiceConfigApi(req, res); return; }
    if (urlPath === '/api/voice/session-token') { await handleVoiceSessionTokenApi(req, res); return; }
    if (urlPath.startsWith('/api/community/')) { await handleCommunityApi(req, res, urlPath); return; }
    if (urlPath.startsWith('/api/admin/')) { await handleAdminApi(req, res, urlPath); return; }
    if (urlPath === '/api/kb/search') { await handleKnowledgeSearchApi(req, res); return; }
    if (urlPath === '/api/agent') { await handleAgentApi(req, res); return; }
    if (urlPath === '/brand/logo.png') { await serveBrandLogo(req, res); return; }
    if (urlPath.startsWith('/content-uploads/')) { await serveContentUpload(req, res, urlPath); return; }
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
    const cacheControl = ['.glb', '.gltf'].includes(extension)
      ? 'public, max-age=2592000, stale-while-revalidate=5184000'
      : ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.woff', '.woff2'].includes(extension)
        ? 'public, max-age=604800, stale-while-revalidate=2592000'
        : 'public, max-age=0, must-revalidate';
    const headers = {
      'Content-Type': MIME[extension] || 'application/octet-stream',
      'Cache-Control': cacheControl,
      ETag: etag,
      'Last-Modified': targetStat.mtime.toUTCString(),
      'Accept-Ranges': 'bytes',
    };
    if (notModified) {
      res.writeHead(304, headers).end();
      return;
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, { ...headers, 'Content-Length': targetStat.size }).end();
      return;
    }
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        res.writeHead(416, { ...headers, 'Content-Range': `bytes */${targetStat.size}` }).end();
        return;
      }
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : targetStat.size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= targetStat.size) {
        res.writeHead(416, { ...headers, 'Content-Range': `bytes */${targetStat.size}` }).end();
        return;
      }
      res.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${targetStat.size}`,
        'Content-Length': end - start + 1,
      });
      createReadStream(target, { start, end }).on('error', () => res.destroy()).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': targetStat.size });
    createReadStream(target).on('error', () => res.destroy()).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
  }
});

const voiceGateway = createVoiceGateway({
  server,
  sessions: voiceSessions,
  upstreamUrl: VOICE_FUNASR_WS_URL,
  allowedOrigin: VOICE_ALLOWED_ORIGIN,
  maxDurationMs: Math.min(60, Math.max(5, Number(env('VOICE_MAX_DURATION_SECONDS', '30')))) * 1000,
  maxBytes: Math.min(8_000_000, Math.max(256_000, Number(env('VOICE_MAX_AUDIO_BYTES', '4000000')))),
  maxConnectionsPerIp: Math.min(3, Math.max(1, Number(env('VOICE_MAX_CONNECTIONS_PER_IP', '1')))),
  funasr: {
    connectTimeoutMs: Math.min(10000, Math.max(500, Number(env('VOICE_FUNASR_CONNECT_TIMEOUT_MS', '3000')))),
    finalTimeoutMs: Math.min(10000, Math.max(1000, Number(env('VOICE_FUNASR_FINAL_TIMEOUT_MS', '5000')))),
    chunkSize: String(env('VOICE_FUNASR_CHUNK_SIZE', '5,10,5')).split(',').map(Number).filter(Number.isFinite).slice(0, 3),
    chunkInterval: Math.min(30, Math.max(1, Number(env('VOICE_FUNASR_CHUNK_INTERVAL', '10')))),
  },
});

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
server.on('close', () => {
  voiceGateway.close();
  unifiedStore.close();
});
server.listen(PORT, HOST, () => {
  console.log(`探物志已启动: http://localhost:${PORT}/`);
});
