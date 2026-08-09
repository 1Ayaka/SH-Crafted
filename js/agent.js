// 小蕉智能体侧栏 —— DeepSeek 模型应答 + 检索式降级
// 慢路径（非材料/动作/工序直读）优先走 server.mjs 的 /api/agent 代理（密钥只在服务器侧）；
// 代理不可用（无密钥/超时/5xx）时静默降级为基于资料库的检索式占位应答，并提示降级状态
import { el, openEvidenceModal } from './ui.js';
import { evidenceTimecode, isContentReviewed } from './data.js';
import { buildAgentContext as buildUIAgentContext } from './agent/context-builder.js';
import { createToolRegistry } from './agent/tool-registry.js';
import { resolveIntent } from './agent/intent-resolver.js';
import { getGraphNode, heritageForGraphTarget, relationsForNode, searchGraph } from './agent/graph-adapter.js';
import { createVoiceController } from './voice/voice-controller.js';
import { VOICE_STATES } from './voice/voice-state-machine.js';
import { createCatMascot } from './mascot/cat-mascot.js';
import { createCompanionDialogue } from './mascot/companion-dialogue.js';

// 用户提供小蕉头像后，只需把这里改成站内图片路径；空值时保留微信式头像位且不显示破图。
const JIAO_AVATAR_URL = '';
const reviewVisible = () => !isContentReviewed();

const CAT_DIALOG_SURFACE_SELECTORS = [
  '.modal-mask .modal',
  '.gesture-permission-overlay.is-visible .gesture-permission-card',
  '.gesture-calibration-overlay.is-visible .gesture-calibration-card',
  '.gesture-settings-overlay.is-visible .gesture-settings-card',
  '.gesture-help-overlay.is-visible .gesture-help-card',
  '.heritage-graph-overlay[role="dialog"] .heritage-graph-info',
];
const CAT_PAGE_SURFACE_SELECTORS = [
  '.craft-page .workbench-col',
  '.craft-page .panel.open',
  '.community-page .community-intro-card',
  '.community-page .community-process-module.is-enabled',
  '.passport .kb-overview',
  '.graph-page .heritage-graph-info',
  '.admin-login-card',
  '.admin-dashboard .admin-bulk-toolbar',
  '.admin-dashboard .admin-craft-card:first-child',
  '.admin-submission-card:first-child',
  '.admin-process-page .admin-step-editor',
  '[data-cat-walk-surface]',
];

function catWalkSurfaces() {
  const seen = new Set();
  const collect = (selectors) => selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
  const stackingZIndex = (node) => {
    let zIndex = 500;
    for (let current = node; current && current !== document.documentElement; current = current.parentElement) {
      const value = Number.parseInt(getComputedStyle(current).zIndex, 10);
      if (Number.isFinite(value)) zIndex = Math.max(zIndex, value + 10);
    }
    return zIndex;
  };
  const visibleSurface = (node) => {
    if (seen.has(node) || !node.isConnected) return false;
    seen.add(node);
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || node.hidden) return false;
    const rect = node.getBoundingClientRect();
    return rect.width >= 220 && rect.height >= 70 && rect.top < innerHeight - 28 && rect.bottom > 48 && rect.right > rect.left;
  };
  const dialogs = collect(CAT_DIALOG_SURFACE_SELECTORS).filter(visibleSurface).slice(0, 1);
  const pageSurfaces = collect(CAT_PAGE_SURFACE_SELECTORS).filter(visibleSurface);
  return [...dialogs, ...pageSurfaces].slice(0, 2)
    .filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width >= 220 && rect.height >= 70;
    })
    .map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        id: node.dataset.catWalkSurface || node.id || String(node.className || 'surface'),
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        zIndex: stackingZIndex(node),
      };
    });
}

const panel = {
  open: false,
  craft: null,
  context: { page: 'home', current_step_id: null, inventory_states: [], recent_actions: [], failure_count: 0 },
  onToggle: null,
  nodes: {},
  modelStatus: 'unknown',   // unknown | ok | down
  degradedNoted: false,     // 降级提示只显示一次
  generation: 0,
  requests: new Set(),
  host: {},
  registry: null,
  voice: null,
  voiceStatus: 'DISABLED',
  global: false,
  defaultHost: {},
  contextSignature: '',
  mascots: [],
  activeMascots: [],
  companion: null,
  lastCompanionStep: '',
  lastCompanionAction: '',
};

function mascotStateForVoice(voiceState = panel.voiceStatus) {
  if (['REQUESTING_PERMISSION', 'WAKE_LISTENING', 'AWAKENED', 'LISTENING', 'TRANSCRIBING'].includes(voiceState)) return 'listening';
  if (['THINKING', 'CONFIRMING', 'EXECUTING'].includes(voiceState)) return 'thinking';
  if (voiceState === 'SPEAKING') return 'speaking';
  if (voiceState === 'ERROR') return 'error';
  return panel.open ? 'awake' : 'idle';
}

function setMascotState(state) {
  panel.activeMascots.forEach((mascot) => mascot.setState(state));
}

function companionRespond(type, payload = {}, options = {}) {
  if (!panel.open) panel.companion?.respond(type, payload, options);
}

function destroyMascots() {
  panel.mascots.forEach((mascot) => mascot.destroy());
  panel.mascots = [];
  panel.activeMascots = [];
  panel.companion?.destroy();
  panel.companion = null;
}

function contextSignature(value = {}) {
  const compactList = (items, limit) => (Array.isArray(items) ? items.slice(-limit) : [])
    .map((item) => typeof item === 'string' ? item : `${item?.id || item?.name || ''}:${item?.state || item?.status || ''}`)
    .join('|');
  return [
    value.route, value.page, value.page_type, value.current_step_id, value.failure_count,
    value.context_revision, value.revision, value.current_root?.id, value.selected_node?.id,
    value.active_branch?.relation || value.active_branch,
    compactList(value.inventory_states, 12), compactList(value.visible_nodes, 12),
    compactList(value.breadcrumbs, 8), compactList(value.recent_actions, 8),
  ].join('~');
}

function ensureVoice() {
  if (panel.voice) return panel.voice;
  panel.voice = createVoiceController({
    async onTranscript(text) {
      await answer(text);
      if (panel.voice?.state?.() === VOICE_STATES.SPEAKING || /^(停|别说了|停止朗读|取消)$/.test(String(text).trim())) return;
      const response = [...(panel.nodes.log?.querySelectorAll('.ap-msg.agent .bubble') || [])].at(-1)?.innerText?.trim();
      if (response) panel.voice?.speak?.(response.slice(0, 220));
    },
    onWake() { api.open(); },
    getContext: () => currentAgentContext(),
    getHotwords: () => [panel.craft?.title, ...(panel.craft?.aliases || [])].filter(Boolean),
    onPartialTranscript(text) {
      if (panel.nodes.voiceTranscript) panel.nodes.voiceTranscript.textContent = text ? `正在识别：${text}` : '';
    },
    onNotice(text) {
      const tone = /不可用|失败|拒绝|中断|错误|没有听到/.test(String(text || '')) ? 'error' : 'info';
      showVoiceFeedback(text, tone);
    },
    onStateChange(next) {
      panel.voiceStatus = next;
      setMascotState(mascotStateForVoice(next));
      panel.nodes.voiceStatus && updateVoiceStatus();
    },
  });
  return panel.voice;
}

function showVoiceFeedback(text, tone = 'info') {
  const node = panel.nodes.voiceFeedback;
  if (!node) return;
  const normalized = String(text || '').trim();
  if (node.textContent === normalized && node.dataset.tone === tone) return;
  node.textContent = normalized;
  node.dataset.tone = tone;
  node.hidden = !normalized;
}

function voiceFailureText(error) {
  if (error?.name === 'NotAllowedError' || error?.message === 'NotAllowedError') {
    return '麦克风权限被拒绝。请在浏览器地址栏的权限设置中允许麦克风，再点击恢复。';
  }
  const messages = {
    FUNASR_UNAVAILABLE: '服务器语音识别暂时不可用，请检查 FunASR 服务或 SSH 隧道。',
    VOICE_CONNECTION_FAILED: '无法连接语音识别服务，请检查 SSH 隧道是否仍在运行。',
    VOICE_CONNECTION_CLOSED: '语音识别连接已中断，请检查 SSH 隧道后重试。',
    VOICE_UPSTREAM_TIMEOUT: '语音识别响应超时，请稍后重试。',
  };
  return messages[String(error?.message || '')] || '麦克风暂时不可用。请检查设备、浏览器权限或语音服务。';
}

function ensureRegistry() {
  if (panel.registry) return panel.registry;
  const voice = ensureVoice();
  panel.registry = createToolRegistry({
    getContext: () => panel.host.context?.() || panel.context,
    host: panel.host,
    voice: { state: () => voice.state() },
  });
  return panel.registry;
}

function currentAgentContext() {
  return buildUIAgentContext(panel.host.context?.() || panel.context, panel.voice?.state?.() || VOICE_STATES.DISABLED);
}

function updateVoiceStatus() {
  const node = panel.nodes.voiceStatus;
  if (!node) return;
  const labels = {
    DISABLED: '语音未开启', REQUESTING_PERMISSION: '正在申请麦克风权限', WAKE_LISTENING: '等待唤醒词',
    AWAKENED: '已唤醒，请说话', LISTENING: '正在聆听', TRANSCRIBING: '正在识别', THINKING: '正在思考',
    CONFIRMING: '等待确认', EXECUTING: '正在执行', SPEAKING: '正在朗读', SUSPENDED: '已暂停，请点击恢复', ERROR: '语音暂不可用',
  };
  node.textContent = labels[panel.voiceStatus] || panel.voiceStatus;
  node.dataset.voiceState = panel.voiceStatus;
  if (panel.nodes.wakeButton && panel.voice) panel.nodes.wakeButton.textContent = panel.voice.supported().serverWake
    ? (panel.voice.state() === VOICE_STATES.SUSPENDED ? '恢复“小蕉小蕉”唤醒' : (panel.voice.preferences().wakeEnabled && panel.voice.state() !== VOICE_STATES.DISABLED ? '关闭“小蕉小蕉”唤醒' : '开启“小蕉小蕉”唤醒'))
    : '语音唤醒（服务未就绪）';
}

async function runToolCommand(query) {
  const intent = resolveIntent(query, currentAgentContext());
  if (!intent) return false;
  if (intent.clarification) {
    addGuidedAnswer([el('p', { text: intent.clarification })], query, panel.craft);
    return true;
  }
  const registry = ensureRegistry();
  if (intent.name !== 'stop_speaking') addMsg('agent', [el('p', { class: 'ap-tool-progress', text: '正在处理这一步…' })], '小蕉');
  const result = await registry.execute(intent.name, intent.args || {});
  updateVoiceStatus();
  if (!result.ok) {
    addMsg('agent', [el('p', { text: result.error?.message || '这一步暂时无法完成。' })], '小蕉');
    return true;
  }
  if (intent.name === 'stop_speaking') return true;
  const message = result.message || ({
    open_node: '已为你打开这个节点。', open_heritage_detail: '已打开非遗项目详情。', open_region: '已打开地区探索。',
    expand_branch: result.count ? `已展开${result.relation_label}，找到 ${result.count} 个节点。` : `当前资料中没有找到${result.relation_label || '这条'}关系。`,
    set_root_node: '已切换探索根节点。', go_back: '已回到上一步。', return_to_root: '已回到本次探索的根节点。',
    focus_model: '镜头已回到完成品。', set_voice_preferences: result.preferences?.wakeEnabled === false ? '已关闭语音唤醒。' : '语音设置已更新。',
    show_help: '我已经把当前页面可执行的操作列出来了。',
  }[intent.name] || '已完成。');
  if (intent.name === 'search_graph') return true;
  addMsg('agent', [el('p', { text: message })], '小蕉');
  return true;
}

function invalidateRequests() {
  panel.generation++;
  for (const controller of panel.requests) controller.abort();
  panel.requests.clear();
}

function requestIsCurrent(generation, controller) {
  return generation === panel.generation
    && !controller.signal.aborted
    && Boolean(panel.nodes.log?.isConnected);
}

function ngrams(text, n = 2) {
  const clean = (text || '').replace(/[\s，。！？、；：""''（）《》·…—,.!?;:()"']/g, '');
  const set = new Set();
  for (let i = 0; i <= clean.length - n; i++) set.add(clean.slice(i, i + n));
  // 单字也保留（工艺名词很短时有用）
  for (const ch of clean) set.add(ch);
  return set;
}

function retrieve(query, craft) {
  if (!craft) return { claims: [], evidence: [], externalFacts: [] };
  const q = ngrams(query);
  const score = (text) => {
    const t = ngrams(text);
    let hit = 0;
    for (const g of q) if (t.has(g)) hit += g.length; // 长命中权重更高
    return hit;
  };
  const claims = craft.claims
    .map((c) => ({ c, s: score(c.statement) }))
    .filter((x) => x.s >= 2)
    .sort((a, b) => b.s - a.s)
    .slice(0, 2)
    .map((x) => x.c);
  let evidence = craft.evidence
    .map((e) => ({ e, s: score((e.transcript_raw || '') + (e.visual_description_raw || '')) }))
    .filter((x) => x.s >= 3)
    .sort((a, b) => b.s - a.s)
    .slice(0, 2)
    .map((x) => x.e);
  if (craft.evidence?.length && evidence.length < 2 && /纪录片|片段|故事|背景|历史|起源|为什么|怎么形成/.test(String(query || ''))) {
    const seen = new Set(evidence.map((item) => item.evidence_id));
    evidence = [...evidence, ...craft.evidence.filter((item) => !seen.has(item.evidence_id)).slice(0, 2 - evidence.length)];
  }
  const externalFacts = (craft.externalFacts || [])
    .map((f) => ({ f, s: score(`${f.topic || ''}${f.statement || ''}${(f.sources || []).map((source) => source.title).join('')}`) }))
    .filter((x) => x.s >= 2)
    .sort((a, b) => b.s - a.s || (a.f.authority_tier || 'Z').localeCompare(b.f.authority_tier || 'Z'))
    .slice(0, 4)
    .map((x) => x.f);
  return { claims, evidence, externalFacts };
}

function addMsg(kind, contentNodes, who) {
  const log = panel.nodes.log;
  if (!log?.isConnected) return null;
  const messageBody = el('div', { class: 'ap-msg-body' }, [
    el('div', { class: 'who', text: who }),
    el('div', { class: 'bubble' }, contentNodes),
  ]);
  const avatar = kind === 'agent'
    ? (() => {
      if (JIAO_AVATAR_URL) return el('div', { class: 'ap-avatar ap-avatar-jiao has-image' }, [el('img', { src: JIAO_AVATAR_URL, alt: '' })]);
      const mascot = createCatMascot({ className: 'ap-avatar ap-avatar-jiao', animate: false });
      panel.mascots.push(mascot);
      return mascot.element;
    })()
    : null;
  const msg = el('div', { class: `ap-msg ${kind}` }, [
    avatar,
    messageBody,
  ]);
  log.appendChild(msg);
  log.scrollTop = log.scrollHeight;
  return msg;
}

// 组装发给 /api/agent 的上下文：当前状态 + 本工艺结构化知识（服务端再包系统提示）
function buildAgentContext(retrieved) {
  const craft = panel.craft;
  const step = panel.context.current_step_id
    ? (craft?.steps.find((s) => s.step_id === panel.context.current_step_id)?.displayName || null)
    : null;
  return {
    craft: craft ? {
      id: craft.craftId,
      title: craft.title,
      steps: craft.steps.map((s) => ({ name: s.displayName, action: s.action })),
      claims: craft.claims.slice(0, 12).map((c) => c.statement),
      evidence: retrieved.evidence.slice(0, 4).map((e) => ({
        timecode: evidenceTimecode(e),
        text: (e.transcript_raw || e.visual_description_raw || '').slice(0, 160),
      })),
      external_facts: retrieved.externalFacts.slice(0, 4).map((fact) => ({
        fact_id: fact.fact_id,
        statement: fact.statement,
        review_status: fact.review_status,
        sources: (fact.sources || []).map((source) => ({
          source_id: source.source_id,
          title: source.title,
          publisher: source.publisher,
          url: source.url,
          authority_tier: source.authority_tier,
        })),
      })),
    } : null,
    current_step: step,
    inventory: panel.context.inventory_states.map((i) => `${i.name}(${i.state})`).join('、'),
    failure_count: panel.context.failure_count || 0,
  };
}

async function askModel(query, retrieved, parentSignal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  const relayAbort = () => ctrl.abort();
  if (parentSignal?.aborted) relayAbort();
  else parentSignal?.addEventListener('abort', relayAbort, { once: true });
  try {
    const exploration = explorationPlan(query, panel.craft);
    const res = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: query }],
        context: {
          ...buildAgentContext(retrieved),
          ui_context: currentAgentContext(),
          exploration_candidates: exploration.links.map(({ id, title, type, label }) => ({ id, title, type, label })),
        },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const data = await res.json();
    if (!data?.content) throw new Error('empty');
    return data;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', relayAbort);
  }
}

async function searchKnowledgeBase(query, craftId, signal) {
  try {
    const res = await fetch('/api/kb/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, craft_id: craftId || null, limit: 8 }),
      signal,
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.results) ? data.results : [];
  } catch {
    return [];
  }
}

function explorationPlan(query, craft = null) {
  let results = searchGraph(query, { limit: 8 });
  if (!results.length && craft?.title) results = searchGraph(craft.title, { limit: 5 });
  const links = [];
  const seen = new Set();
  const add = (node, action = 'open_node') => {
    if (!node?.id || seen.has(node.id)) return;
    seen.add(node.id);
    links.push({
      id: node.id,
      title: node.title,
      type: node.type,
      action,
      label: node.type === 'heritage' ? '探索非遗项目' : '打开关系星图',
    });
  };
  for (const [index, result] of results.entries()) {
    if (result.type === 'heritage') {
      add(result, 'open_heritage_detail');
      if (index === 0) {
        relationsForNode(result.id).slice(0, 4).forEach((edge) => add(getGraphNode(edge.target_id), 'open_node'));
      }
    }
    else {
      add(result, 'open_node');
      if (index === 0) {
        const related = heritageForGraphTarget(result.id, { excludeId: result.id }).nodes || [];
        related.slice(0, 4).forEach((node) => add(node, 'open_heritage_detail'));
      }
    }
  }
  return { results, links: links.slice(0, 6) };
}

function followupQuestions(query, craft, plan) {
  const primary = plan?.results?.[0];
  if (primary?.type === 'material') {
    return [
      `为什么${primary.title}会在这些地区形成不同技艺？`,
      `还有哪些上海非遗也使用${primary.title}？`,
    ];
  }
  if (primary?.type === 'region') {
    return [`${primary.title}的环境如何影响当地技艺？`, `沿着${primary.title}，还能探索哪些相关非遗？`];
  }
  if (primary?.type === 'tradition') {
    return [`${primary.title}为什么会形成不同地方分支？`, `哪些材料和工序连接了这些项目？`];
  }
  if (primary?.type === 'heritage') {
    return [`${primary.title}为什么会在当地发展起来？`, `有哪些材料或技艺与${primary.title}相关？`];
  }
  if (craft) return [`「${craft.title}」与哪些材料或工艺相近？`, `从这项技艺的哪一道工序开始探索？`];
  const topic = String(query || '').replace(/[？?。！!，,]/g, '').replace(/^(请|介绍|讲讲|我想知道)/, '').trim().slice(0, 18);
  return topic
    ? [`“${topic}”与上海非遗有哪些联系？`, `可以从哪些材料、地区或工艺继续探索？`]
    : ['从材料关系看，哪些非遗可以一起探索？', '上海不同地区的非遗有什么联系？'];
}

function appendExplorationGuidance(nodes, query, craft) {
  const plan = explorationPlan(query, craft);
  if (plan.links.length) {
    const explicit = /打开|进入|跳转|带我|探索|还有哪些|相关非遗|链接|看看/.test(String(query || ''));
    const visibleLinks = plan.links.slice(0, explicit ? 2 : 2);
    const linkNodes = visibleLinks.map((link) => el('button', {
      class: 'ap-explore-link', type: 'button',
      onclick: async () => {
        const args = link.action === 'open_heritage_detail' ? { heritage_id: link.id } : { node_id: link.id };
        const result = await ensureRegistry().execute(link.action, args);
        if (!result.ok) addMsg('agent', [el('p', { text: result.error?.message || '暂时无法打开这个探索入口。' })], '小蕉');
      },
    }, [el('strong', { text: link.title }), el('span', { text: link.label })]));
    const body = [el('p', { class: 'small muted', text: '这些入口来自当前站内图谱中已有的关系。' }), el('div', { class: 'ap-explore-links' }, linkNodes)];
    nodes.push(explicit
      ? el('section', { class: 'ap-exploration' }, [el('strong', { class: 'ap-exploration-title', text: '沿着这个话题继续探索' }), ...body])
      : el('details', { class: 'ap-exploration ap-exploration-collapsed' }, [el('summary', { text: '继续探索相关内容' }), ...body]));
  }
  const prompts = followupQuestions(query, craft, plan);
  nodes.push(el('div', { class: 'ap-followups' }, [
    el('span', { class: 'small muted', text: '你还可以问：' }),
    ...prompts.slice(0, 2).map((prompt) => el('button', {
      class: 'ap-followup', type: 'button', text: prompt,
      onclick: () => { if (panel.nodes.input) panel.nodes.input.value = ''; answer(prompt); },
    })),
  ]));
  return plan;
}

function addGuidedAnswer(nodes, query, craft) {
  appendExplorationGuidance(nodes, query, craft);
  addMsg('agent', nodes, '小蕉');
}

function appendKnowledgeHits(nodes, craft, hits, title = '统一知识库命中：') {
  if (!hits?.length) return;
  const hitNodes = [];
  for (const hit of hits.slice(0, 3)) {
    hitNodes.push(el('p', {}, [
      el('span', { text: `${String(hit.text || '').slice(0, 240)}${String(hit.text || '').length > 240 ? '…' : ''} ` }),
      reviewVisible() ? (hit.authority_tier
        ? el('span', { class: hit.review_status === 'verified_external' ? 'tag tag-verified' : 'tag tag-review', text: `${hit.authority_tier}级·${hit.review_status === 'verified_external' ? '已核验' : '待审核'}` })
        : el('span', { class: 'tag tag-review', text: '待审核' })) : null,
    ]));
    for (const source of (hit.sources || []).slice(0, 2)) {
      hitNodes.push(el('div', { class: 'refs' }, [el('a', {
        class: 'ev-link', href: source.url, target: '_blank', rel: 'noopener noreferrer',
        text: `${source.publisher} · ${source.title}`,
      })]));
    }
    if (craft && hit.evidence_ids?.length) {
      hitNodes.push(el('div', { class: 'refs' }, [el('button', {
        class: 'ev-link', text: '查看纪录片证据',
        onclick: () => openEvidenceModal(craft, hit.evidence_ids.slice(0, 2), { title: '证据 · 统一知识库检索' }),
      })]));
    }
  }
  nodes.push(el('details', { class: 'ap-kb-details' }, [
    el('summary', { text: `${title.replace(/[：:]$/, '')}（${Math.min(hits.length, 3)} 条）` }),
    el('div', { class: 'ap-kb-content' }, hitNodes),
  ]));
}

function modelAnswerNode(line) {
  let text = String(line || '').trim()
    .replace(/^```(?:markdown|md|text)?\s*/i, '')
    .replace(/```$/g, '')
    .replace(/【(?:ext|fact|chunk)_[^】]+】/gi, '（资料）')
    .replace(/\[(?:ext|fact|chunk)_[^\]]+\]/gi, '（资料）')
    .replace(/^【AI生成】\s*/i, '');
  if (isContentReviewed()) text = text.replace(/【?待审核】?/g, '').replace(/AI生成/g, '').replace(/\s{2,}/g, ' ').trim();
  if (!text) return null;
  const parts = [];
  let cursor = 0;
  const bold = /\*\*([^*\n]{1,40})\*\*/g;
  let match;
  while ((match = bold.exec(text))) {
    if (match.index > cursor) parts.push(document.createTextNode(text.slice(cursor, match.index)));
    parts.push(el('strong', { class: 'ap-answer-emphasis', text: match[1].trim() }));
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push(document.createTextNode(text.slice(cursor)));
  return el('p', { class: 'ap-answer-line' }, parts.length ? parts : [document.createTextNode(text)]);
}

function cleanModelContent(value) {
  let text = String(value || '').replace(/```(?:json|markdown|md|text)?/gi, '').replace(/```/g, '').trim();
  if (/^\s*[{"[]/.test(text)) {
    try {
      const parsed = JSON.parse(text);
      text = typeof parsed === 'string' ? parsed : (parsed.answer || parsed.content || parsed.message || '');
    } catch { /* 模型偶尔只返回半截 JSON，按普通文本继续清洗 */ }
  }
  return text;
}

function refreshNotice() {
  const n = panel.nodes.notice;
  if (!n) return;
  n.textContent = panel.modelStatus === 'ok'
    ? `已接入模型应答：优先使用项目资料${reviewVisible() ? '，未确认内容标注待审核' : ''}；相关纪录片片段会在合适时出现。`
    : panel.modelStatus === 'down'
      ? `模型不可用，已切换检索式应答${reviewVisible() ? '，未确认内容标注待审核' : ''}。`
      : `优先模型应答，不可用时自动降级为检索式应答${reviewVisible() ? '，未确认内容标注待审核' : ''}。`;
}

// 检索式占位应答（降级路径）
function retrievalAnswer(query, craft, claims, evidence, externalFacts, knowledgeHits = []) {
  if (!claims.length && !evidence.length && !externalFacts.length && !knowledgeHits.length) {
    addGuidedAnswer([
      el('p', { text: '现有资料无法确认。我只能检索本项目的纪录片转写与自动抽取的知识草稿；你可以换个问法，或到“工序与材料”面板查看结构化步骤。' }),
    ], query, craft);
    return;
  }
  const nodes = [];
  for (const fact of externalFacts) {
    nodes.push(el('p', {}, [
      el('span', { text: fact.statement + ' ' }),
      el('span', { class: fact.review_status === 'verified_external' ? 'tag tag-verified' : 'tag tag-review', text: fact.review_status === 'verified_external' ? '外部核验' : '待复核' }),
    ]));
    if (fact.sources?.length) {
      nodes.push(el('div', { class: 'refs' }, fact.sources.slice(0, 2).map((source) => el('a', {
        class: 'ev-link', href: source.url, target: '_blank', rel: 'noopener noreferrer',
        text: `${source.publisher} · 查看来源`,
      }))));
    }
  }
  for (const c of claims) {
    nodes.push(el('p', {}, [
      el('span', { text: c.statement + ' ' }),
      reviewVisible() ? el('span', { class: 'tag tag-review', text: '待审核' }) : null,
    ]));
    if (c.evidence_ids?.length) {
      nodes.push(el('div', { class: 'refs' }, [
        el('button', {
          class: 'ev-link', text: '查看相关证据',
          onclick: () => openEvidenceModal(craft, c.evidence_ids.slice(0, 2), { title: '证据 · 来自问答检索' }),
        }),
      ]));
    }
  }
  if (evidence.length) {
    nodes.push(el('p', { class: 'small muted', text: '相关纪录片片段（关键帧）：' }));
    for (const ev of evidence) {
      nodes.push(el('div', { class: 'refs' }, [
        el('button', {
          class: 'ev-link',
          text: `时间码 ${evidenceTimecode(ev)} · ${(ev.transcript_raw || '').slice(0, 18)}…`,
          onclick: () => openEvidenceModal(craft, [ev.evidence_id], { title: '证据 · 来自问答检索' }),
        }),
      ]));
    }
  }
  appendKnowledgeHits(nodes, craft, knowledgeHits);
  appendExplorationGuidance(nodes, query, craft);
  if (reviewVisible()) nodes.push(el('p', { class: 'small muted', text: '部分内容仍待审核，请结合来源判断。' }));
  addMsg('agent', nodes, '小蕉');
}

async function answer(query, { showUser = true, allowTools = true } = {}) {
  const craft = panel.craft;
  if (showUser) addMsg('user', [el('span', { text: query })], '我');

  // 导航与语音控制优先通过白名单工具执行；无法识别为站内操作时，
  // 才继续使用原有知识检索/模型问答链路。
  if (allowTools && await runToolCommand(query)) return;

  // 快路径：资源 / 动作 / 工序等直接读取结构化数据
  if (craft) {
    if (/材料|原料|物件/.test(query)) {
      addGuidedAnswer([
        el('p', {}, [
          el('span', { text: `「${craft.title}」当前记录的材料与物件有：${craft.allResources.join('、') || '（资料待补充）'}。 ` }),
          reviewVisible() ? el('span', { class: 'tag tag-review', text: '待审核' }) : null,
        ]),
        el('p', { class: 'small muted', text: '工具已作为可复用物件并入资源集合；每一步的组合规则仍需人工审核。' }),
      ], query, craft);
      return;
    }
    if (/工具/.test(query)) {
      addGuidedAnswer([
        el('p', {}, [
          el('span', { text: craft.allTools.length ? `记录的工具类物件有：${craft.allTools.join('、')}。它们与材料在同一列表中选择。 ` : '现有步骤资料中没有记录工具类物件。' }),
          craft.allTools.length && reviewVisible() ? el('span', { class: 'tag tag-review', text: '待审核' }) : null,
        ]),
        el('p', { class: 'small muted', text: '“材料/工具”分类只用于说明来源，工作台统一按资源处理。' }),
      ], query, craft);
      return;
    }
    if (/动作|怎么做|操作/.test(query)) {
      addGuidedAnswer([
        el('p', {}, [
          el('span', { text: `当前可选动作包括：${craft.actions.map((action) => action.label).join('、')}。 ` }),
          reviewVisible() ? el('span', { class: 'tag tag-review', text: '待审核' }) : null,
        ]),
        el('p', { class: 'small muted', text: '动作来自人工覆盖规则或旧工序名称的兼容映射。' }),
      ], query, craft);
      return;
    }
    if (/工序|步骤|流程|几道|顺序/.test(query)) {
      addGuidedAnswer([
        el('p', {}, [
          el('span', { text: `纪录片资料整理的候选工序共 ${craft.steps.length} 道：${craft.steps.map((s, i) => `${i + 1}. ${s.displayName}`).join(' → ')}。 ` }),
          reviewVisible() ? el('span', { class: 'tag tag-review', text: '待审核' }) : null,
        ]),
        el('p', { class: 'small muted', text: '顺序为 order_candidate 候选顺序，未经人工核定。' }),
      ], query, craft);
      return;
    }
  }

  // 慢路径：优先 DeepSeek 代理（/api/agent）；不可用则静默降级为检索式占位应答
  setMascotState('thinking');
  const { claims, evidence, externalFacts } = retrieve(query, craft);
  const generation = panel.generation;
  const controller = new AbortController();
  panel.requests.add(controller);
  try {
    const knowledgeHits = await searchKnowledgeBase(query, craft?.craftId, controller.signal);
    if (!requestIsCurrent(generation, controller)) return;
    if (panel.modelStatus !== 'down') {
      const thinking = addMsg('agent', [el('p', { class: 'ap-thinking', text: '小蕉正在翻资料…' })], '小蕉');
      try {
        const modelResult = await askModel(query, { evidence, externalFacts }, controller.signal);
        if (!requestIsCurrent(generation, controller)) return;
        thinking?.remove();
        panel.modelStatus = 'ok';
        refreshNotice();
        const nodes = cleanModelContent(modelResult.content).split(/\n+/).filter((line) => line.trim()).map(modelAnswerNode).filter(Boolean);
        if (evidence.length) {
          nodes.push(el('p', { class: 'small muted', text: '本回答参考的纪录片片段：' }));
          for (const ev of evidence.slice(0, 2)) {
            nodes.push(el('div', { class: 'refs' }, [
              el('button', {
                class: 'ev-link',
                text: `时间码 ${evidenceTimecode(ev)} · 查看片段`,
                onclick: () => openEvidenceModal(craft, [ev.evidence_id], { title: '证据 · 模型回答引用' }),
              }),
            ]));
          }
        }
        if (externalFacts.length) {
          nodes.push(el('p', { class: 'small muted', text: '外部权威资料：' }));
          for (const fact of externalFacts.slice(0, 2)) {
            for (const source of (fact.sources || []).slice(0, 1)) {
              nodes.push(el('div', { class: 'refs' }, [el('a', {
                class: 'ev-link', href: source.url, target: '_blank', rel: 'noopener noreferrer',
                text: `${source.publisher} · ${source.title}`,
              })]));
            }
          }
        }
        appendKnowledgeHits(nodes, craft, modelResult.knowledge || knowledgeHits, '本次回答的统一知识库依据：');
        appendExplorationGuidance(nodes, query, craft);
        if (reviewVisible()) nodes.push(el('p', { class: 'small muted', text: '部分内容仍待审核，请结合来源判断。' }));
        addMsg('agent', nodes, '小蕉');
        return;
      } catch {
        thinking?.remove();
        if (!requestIsCurrent(generation, controller)) return;
        panel.modelStatus = 'down';
        refreshNotice();
        if (!panel.degradedNoted) {
          panel.degradedNoted = true;
          addMsg('agent', [el('p', { class: 'small muted', text: '模型不可用，已切换检索式应答。' })], '小蕉');
        }
      }
    }
    if (!requestIsCurrent(generation, controller)) return;
    retrievalAnswer(query, craft, claims, evidence, externalFacts, knowledgeHits);
  } finally {
    panel.requests.delete(controller);
    setMascotState(mascotStateForVoice());
  }
}

function continuationQuery(continuation = {}) {
  const payload = continuation.payload || {};
  const topic = payload.name || payload.title || payload.text || panel.craft?.title || '当前页面';
  const prompts = {
    district: `接着介绍${topic}：结合当前页面，讲一个地域文化或非遗小知识，并推荐不超过两个相关非遗探索入口。`,
    craft: `接着介绍${topic}：讲一个材料、工序或纪录片里的有趣细节，并给出不超过两个相关探索入口。`,
    step: `接着讲解工序“${topic}”：说明它改变了什么，并补充一个相关工艺小知识。`,
    action: `接着解释刚才的操作“${topic}”：说明它在工艺中的作用，并补充一个相关小知识。`,
    graph: `接着介绍节点“${topic}”：说明它与上一个节点的联系和区别，并给出不超过两个相关探索入口。`,
    tap: `结合我当前正在看的页面，自然地补充一个上海非遗小知识；只有确实相关时才给探索入口。`,
  };
  return prompts[continuation.type] || `结合当前页面继续讲解“${topic}”，补充一个有趣的小知识。`;
}

function continueFromCompanion(continuation) {
  if (!continuation) { api.open(); return; }
  api.open({ skipGreeting: true });
  addMsg('agent', [
    el('p', { class: 'ap-companion-bridge', text: continuation.text || '我把刚才的线索带进来了，我们从这里接着聊。' }),
    el('p', { class: 'small muted', text: '我正在结合你此刻看到的页面继续查找。' }),
  ], '小蕉');
  answer(continuationQuery(continuation), { showUser: false, allowTools: false });
}

function contextBanner() {
  const c = panel.context;
  const step = c.current_step_id
    ? (panel.craft?.steps.find((s) => s.step_id === c.current_step_id)?.displayName || c.current_step_id)
    : '未开始';
  const inventory = Array.isArray(c.inventory_states) ? c.inventory_states : [];
  const inv = inventory.length
    ? `${inventory.slice(-6).map((i) => `${i.name}(${i.state})`).join('、')}${inventory.length > 6 ? `等 ${inventory.length} 项` : ''}`
    : '空';
  return `当前：${panel.craft ? panel.craft.title : '非工艺页'} · 步骤：${step} · 背包：${inv} · 连续失败：${c.failure_count} 次`;
}

function render() {
  invalidateRequests();
  destroyMascots();
  const root = document.createElement('div');
  root.innerHTML = '';
  document.querySelector('.agent-fab')?.remove();
  document.querySelector('.agent-panel')?.remove();

  let companion = null;
  const fabMascot = createCatMascot({
    className: 'cat-mascot-fab',
    interactive: true,
    autonomous: true,
    surfaceProvider: catWalkSurfaces,
    onBehavior: (type, detail) => { if (!panel.open) companion?.respond(type, detail); },
  });
  const fab = el('button', {
    class: 'agent-fab', 'aria-label': '唤出小蕉智能讲解', title: '小蕉 · 智能讲解',
    onclick: () => { if (!fabMascot.consumeClickSuppression()) fabMascot.react('tap'); },
  }, [fabMascot.element, el('span', { class: 'fab-label', text: '小蕉 · 智能讲解' })]);
  companion = createCompanionDialogue({ anchor: fabMascot.element, onOpenAgent: (continuation) => api.continueFromCompanion(continuation) });

  const log = el('div', { class: 'ap-log' });
  const ctxLine = el('div', { class: 'ap-context' });
  const input = el('input', {
    type: 'text', placeholder: '问小蕉：关于这门工艺的问题…',
    'aria-label': '向小蕉提问',
    onkeydown: (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        const q = input.value.trim();
        input.value = '';
        answer(q);
      }
    },
  });
  const voiceStatus = el('div', { class: 'ap-voice-status', role: 'status', 'aria-live': 'polite' });
  const voiceFeedback = el('div', { class: 'ap-voice-feedback', role: 'status', 'aria-live': 'polite', hidden: true });
  const voiceTranscript = el('div', { class: 'ap-voice-transcript', role: 'status', 'aria-live': 'polite' });
  const wakeButton = el('button', {
    class: 'ap-voice-button', type: 'button', text: '开启语音唤醒',
    onclick: async () => {
      const voice = ensureVoice();
      try {
        if (voice.preferences().wakeEnabled && voice.state() !== VOICE_STATES.DISABLED && voice.state() !== VOICE_STATES.SUSPENDED) {
          voice.setPreferences({ wake_enabled: false });
        } else {
          await voice.start({ wake: true });
        }
      } catch (error) {
        showVoiceFeedback(voiceFailureText(error), 'error');
      }
      updateVoiceStatus();
    },
  });
  const micButton = el('button', {
    class: 'ap-voice-button ap-mic-button', type: 'button', text: '点击说话',
    onclick: async () => {
      const voice = ensureVoice();
      if ([VOICE_STATES.LISTENING, VOICE_STATES.TRANSCRIBING].includes(voice.state())) { await voice.stopListening(); return; }
      try { await voice.start({ wake: false }); } catch (error) { showVoiceFeedback(voiceFailureText(error), 'error'); }
    },
  });
  const headMascot = createCatMascot({ className: 'cat-mascot-head' });
  const panelEl = el('aside', { class: 'agent-panel', role: 'dialog', 'aria-modal': 'false', 'aria-label': '小蕉智能体面板' }, [
    el('div', { class: 'ap-head' }, [
      headMascot.element,
      el('h3', { text: '小蕉' }),
      el('button', { class: 'ap-close', text: '×', 'aria-label': '收起小蕉', onclick: () => api.close() }),
    ]),
    el('div', { class: 'ap-voice-controls' }, [voiceStatus, voiceFeedback, voiceTranscript, wakeButton, micButton]),
    ctxLine,
    el('div', { class: 'ap-quick' }, ['它用什么材料？', '有哪些动作？', '有哪几道工序？'].map((q) =>
      el('button', { text: q, onclick: () => answer(q) }))),
    log,
    el('div', { class: 'ap-input-row' }, [
      input,
      el('button', {
        class: 'btn btn-moss', text: '提问',
        onclick: () => { if (input.value.trim()) { const q = input.value.trim(); input.value = ''; answer(q); } },
      }),
    ]),
  ]);
  document.body.append(fab, panelEl);
  panel.mascots.push(fabMascot, headMascot);
  panel.activeMascots = [fabMascot, headMascot];
  panel.companion = companion;
  panel.nodes = { fab, panel: panelEl, log, ctxLine, input, voiceStatus, voiceFeedback, voiceTranscript, wakeButton, micButton };
  refreshNotice();
  updateVoiceStatus();
  setMascotState(mascotStateForVoice());
}

const api = {
  mount() {
    if (!panel.nodes.fab) render();
    panel.nodes.fab.style.display = '';
  },
  unmount() {
    invalidateRequests();
    if (panel.global) {
      panel.craft = null;
      panel.onToggle = null;
      panel.host = panel.defaultHost;
      panel.registry = null;
      api.close();
      return;
    }
    panel.voice?.destroy?.();
    panel.voice = null;
    panel.nodes.fab?.remove();
    panel.nodes.panel?.remove();
    panel.nodes = {};
    panel.open = false;
    panel.craft = null;
    panel.onToggle = null;
    panel.host = {};
    panel.registry = null;
    destroyMascots();
    document.body.classList.remove('agent-open');
  },
  enableGlobal(host = {}) {
    panel.global = true;
    panel.defaultHost = host;
    panel.host = host;
    panel.registry = null;
    api.mount();
  },
  open({ skipGreeting = false } = {}) {
    if (!panel.nodes.panel) render();
    const openedAt = performance.now();
    panel.open = true;
    panel.companion?.hide();
    setMascotState('awake');
    setTimeout(() => { if (panel.open && mascotStateForVoice() === 'idle') setMascotState('idle'); }, 650);
    panel.nodes.panel.classList.add('open');
    document.body.classList.add('agent-open');   // 停靠布局：内容区整体左挤
    panel.nodes.ctxLine.innerHTML = '';
    panel.nodes.ctxLine.appendChild(el('b', { text: '会话上下文 ' }));
    panel.nodes.ctxLine.append(contextBanner());
    if (!skipGreeting && !panel.nodes.log.children.length) {
      addMsg('agent', [
        el('p', { text: `你好，我是小蕉，一只从皮影和剪纸中诞生、正在收集上海非遗资料的小猫。${panel.craft ? `关于「${panel.craft.title}」，我找到了纪录片转写和知识草稿，可以帮你检索。` : '我会结合你当前看到的地区、节点或工艺内容寻找线索。'}我不会替你完成操作，但可以在你卡住时提供线索。` }),
      ], '小蕉');
    }
    panel.onToggle?.(true);
    requestAnimationFrame(() => {
      const latency = performance.now() - openedAt;
      panel.nodes.panel.dataset.openLatencyMs = latency.toFixed(1);
      window.__agentPerformance = { open_latency_ms: latency, measured_at: Date.now() };
    });
  },
  continueFromCompanion,
  close() {
    panel.open = false;
    setMascotState('idle');
    panel.nodes.panel?.classList.remove('open');
    document.body.classList.remove('agent-open');
    panel.onToggle?.(false);
  },
  toggle() { (panel.open ? api.close : api.open)(); },
  isOpen: () => panel.open,
  setCraft(craft) {
    const changed = panel.craft?.craftId !== craft?.craftId;
    if (panel.craft !== craft) invalidateRequests();
    panel.craft = craft;
    if (changed && craft) companionRespond('craft', { id: craft.craftId, title: craft.title, summary: craft.summary });
  },
  setContext(ctx) {
    const previous = panel.contextSignature || contextSignature(panel.context);
    Object.assign(panel.context, ctx);
    if (ctx.current_step_id && ctx.current_step_id !== panel.lastCompanionStep) {
      panel.lastCompanionStep = ctx.current_step_id;
      companionRespond('step', { id: ctx.current_step_id, name: ctx.current_step_name || ctx.current_step_id });
    }
    const latestAction = Array.isArray(ctx.recent_actions) ? ctx.recent_actions.at(-1) : '';
    if (latestAction && latestAction !== panel.lastCompanionAction) {
      panel.lastCompanionAction = latestAction;
      companionRespond('action', { text: latestAction });
    }
    panel.contextSignature = contextSignature(panel.context);
    if (previous !== panel.contextSignature) invalidateRequests();
    if (panel.open) {
      panel.nodes.ctxLine.innerHTML = '';
      panel.nodes.ctxLine.appendChild(el('b', { text: '会话上下文 ' }));
      panel.nodes.ctxLine.append(contextBanner());
    }
  },
  setHost(host = {}) {
    const previous = panel.host;
    panel.host = host;
    panel.registry = null;
    if (previous !== host) invalidateRequests();
    if (panel.open) {
      panel.nodes.ctxLine.innerHTML = '';
      panel.nodes.ctxLine.appendChild(el('b', { text: '会话上下文 ' }));
      panel.nodes.ctxLine.append(currentAgentContext().current_root?.title || '当前页面');
    }
  },
  getContext() { return currentAgentContext(); },
  speak(text) { ensureVoice(); return panel.voice.speak(text); },
  stopSpeaking() { ensureVoice().stopSpeaking(); },
  setVoicePreferences(next) { return ensureVoice().setPreferences(next); },
  voiceState() { return panel.voice?.state?.() || VOICE_STATES.DISABLED; },
  react(type, payload = {}, options = {}) { companionRespond(type, payload, options); },
  say(text) { if (panel.open) addMsg('agent', [el('p', { text })], '小蕉'); },
  onToggle(fn) { panel.onToggle = fn; },
};

export const agent = api;
