// 小蕉智能体侧栏 —— DeepSeek 模型应答 + 检索式降级
// 慢路径（非材料/动作/工序直读）优先走 server.mjs 的 /api/agent 代理（密钥只在服务器侧）；
// 代理不可用（无密钥/超时/5xx）时静默降级为基于资料库的检索式占位应答，并提示降级状态
import { el, catSVG, openEvidenceModal } from './ui.js';
import { evidenceTimecode } from './data.js';
import { buildAgentContext as buildUIAgentContext } from './agent/context-builder.js';
import { createToolRegistry } from './agent/tool-registry.js';
import { resolveIntent } from './agent/intent-resolver.js';
import { createVoiceController } from './voice/voice-controller.js';
import { VOICE_STATES } from './voice/voice-state-machine.js';

// 用户提供小蕉头像后，只需把这里改成站内图片路径；空值时保留微信式头像位且不显示破图。
const JIAO_AVATAR_URL = '';

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
};

function ensureVoice() {
  if (panel.voice) return panel.voice;
  panel.voice = createVoiceController({
    onTranscript(text) { answer(text); },
    onNotice(text) { if (panel.open) addMsg('agent', [el('p', { text })], '小蕉'); },
    onStateChange(next) {
      panel.voiceStatus = next;
      panel.nodes.voiceStatus && updateVoiceStatus();
    },
  });
  return panel.voice;
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
  if (panel.nodes.wakeButton && panel.voice) panel.nodes.wakeButton.textContent = panel.voice.preferences().wakeEnabled ? '关闭语音唤醒' : '开启语音唤醒';
}

async function runToolCommand(query) {
  const intent = resolveIntent(query, currentAgentContext());
  if (!intent) return false;
  if (intent.clarification) {
    addMsg('agent', [el('p', { text: intent.clarification })], '小蕉');
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
  const evidence = craft.evidence
    .map((e) => ({ e, s: score((e.transcript_raw || '') + (e.visual_description_raw || '')) }))
    .filter((x) => x.s >= 3)
    .sort((a, b) => b.s - a.s)
    .slice(0, 2)
    .map((x) => x.e);
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
    ? el('div', {
      class: `ap-avatar ap-avatar-jiao${JIAO_AVATAR_URL ? ' has-image' : ''}`,
      'aria-label': '小蕉头像（图片待补充）',
      title: '小蕉头像待补充',
    }, JIAO_AVATAR_URL ? [el('img', { src: JIAO_AVATAR_URL, alt: '' })] : [])
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
    const res = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: query }],
        context: { ...buildAgentContext(retrieved), ui_context: currentAgentContext() },
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

function appendKnowledgeHits(nodes, craft, hits, title = '统一知识库命中：') {
  if (!hits?.length) return;
  const hitNodes = [];
  for (const hit of hits.slice(0, 3)) {
    hitNodes.push(el('p', {}, [
      el('span', { text: `${String(hit.text || '').slice(0, 240)}${String(hit.text || '').length > 240 ? '…' : ''} ` }),
      hit.authority_tier
        ? el('span', { class: hit.review_status === 'verified_external' ? 'tag tag-verified' : 'tag tag-review', text: `${hit.authority_tier}级·${hit.review_status === 'verified_external' ? '已核验' : '待审核'}` })
        : el('span', { class: 'tag tag-review', text: '待审核' }),
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

function refreshNotice() {
  const n = panel.nodes.notice;
  if (!n) return;
  n.textContent = panel.modelStatus === 'ok'
    ? '已接入模型应答：回答受本项目纪录片转写与知识草稿约束（均为 AI 自动抽取草稿，待审核），引用证据附时间码。'
    : panel.modelStatus === 'down'
      ? '模型不可用，已切换检索式应答：回答仅来自本项目的纪录片转写与知识草稿（AI 自动抽取，待审核）。'
      : '优先模型应答，不可用时自动降级为检索式应答；内容来自本项目纪录片转写与知识草稿（AI 自动抽取，待审核）。';
}

// 检索式占位应答（降级路径）
function retrievalAnswer(craft, claims, evidence, externalFacts, knowledgeHits = []) {
  if (!claims.length && !evidence.length && !externalFacts.length && !knowledgeHits.length) {
    addMsg('agent', [
      el('p', { text: '现有资料无法确认。我只能检索本项目的纪录片转写与自动抽取的知识草稿；你可以换个问法，或到“工序与材料”面板查看结构化步骤。' }),
    ], '小蕉');
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
      el('span', { class: 'tag tag-review', text: '待审核' }),
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
  nodes.push(el('p', { class: 'small muted', text: '以上为检索式占位应答，内容来自未经人工审核的草稿，请以正式审核结果为准。' }));
  addMsg('agent', nodes, '小蕉');
}

async function answer(query) {
  const craft = panel.craft;
  addMsg('user', [el('span', { text: query })], '我');

  // 导航与语音控制优先通过白名单工具执行；无法识别为站内操作时，
  // 才继续使用原有知识检索/模型问答链路。
  if (await runToolCommand(query)) return;

  // 快路径：资源 / 动作 / 工序等直接读取结构化数据
  if (craft) {
    if (/材料|原料|物件/.test(query)) {
      addMsg('agent', [
        el('p', {}, [
          el('span', { text: `「${craft.title}」当前记录的材料与物件有：${craft.allResources.join('、') || '（资料待补充）'}。 ` }),
          el('span', { class: 'tag tag-review', text: '待审核' }),
        ]),
        el('p', { class: 'small muted', text: '工具已作为可复用物件并入资源集合；每一步的组合规则仍需人工审核。' }),
      ], '小蕉');
      return;
    }
    if (/工具/.test(query)) {
      addMsg('agent', [
        el('p', {}, [
          el('span', { text: craft.allTools.length ? `记录的工具类物件有：${craft.allTools.join('、')}。它们与材料在同一列表中选择。 ` : '现有步骤资料中没有记录工具类物件。' }),
          craft.allTools.length ? el('span', { class: 'tag tag-review', text: '待审核' }) : null,
        ]),
        el('p', { class: 'small muted', text: '“材料/工具”分类只用于说明来源，工作台统一按资源处理。' }),
      ], '小蕉');
      return;
    }
    if (/动作|怎么做|操作/.test(query)) {
      addMsg('agent', [
        el('p', {}, [
          el('span', { text: `当前可选动作包括：${craft.actions.map((action) => action.label).join('、')}。 ` }),
          el('span', { class: 'tag tag-review', text: '待审核' }),
        ]),
        el('p', { class: 'small muted', text: '动作来自人工覆盖规则或旧工序名称的兼容映射。' }),
      ], '小蕉');
      return;
    }
    if (/工序|步骤|流程|几道|顺序/.test(query)) {
      addMsg('agent', [
        el('p', {}, [
          el('span', { text: `纪录片资料整理的候选工序共 ${craft.steps.length} 道：${craft.steps.map((s, i) => `${i + 1}. ${s.displayName}`).join(' → ')}。 ` }),
          el('span', { class: 'tag tag-review', text: '待审核' }),
        ]),
        el('p', { class: 'small muted', text: '顺序为 order_candidate 候选顺序，未经人工核定。' }),
      ], '小蕉');
      return;
    }
  }

  // 慢路径：优先 DeepSeek 代理（/api/agent）；不可用则静默降级为检索式占位应答
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
        const nodes = modelResult.content.split(/\n+/).filter((line) => line.trim()).map((line) => el('p', { text: line }));
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
        nodes.push(el('p', { class: 'small muted', text: '以上由模型依据待审核资料草稿生成，请以正式审核结果为准。' }));
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
    retrievalAnswer(craft, claims, evidence, externalFacts, knowledgeHits);
  } finally {
    panel.requests.delete(controller);
  }
}

function contextBanner() {
  const c = panel.context;
  const step = c.current_step_id
    ? (panel.craft?.steps.find((s) => s.step_id === c.current_step_id)?.displayName || c.current_step_id)
    : '未开始';
  const inv = c.inventory_states.length
    ? c.inventory_states.map((i) => `${i.name}(${i.state})`).join('、')
    : '空';
  return `当前：${panel.craft ? panel.craft.title : '非工艺页'} · 步骤：${step} · 背包：${inv} · 连续失败：${c.failure_count} 次`;
}

function render() {
  invalidateRequests();
  ensureVoice();
  ensureRegistry();
  const root = document.createElement('div');
  root.innerHTML = '';
  document.querySelector('.agent-fab')?.remove();
  document.querySelector('.agent-panel')?.remove();

  const fab = el('button', {
    class: 'agent-fab', 'aria-label': '唤出小蕉智能讲解', title: '小蕉 · 智能讲解',
    onclick: () => api.toggle(),
  }, [catSVG(), el('span', { class: 'fab-label', text: '小蕉 · 智能讲解' })]);

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
  const noticeEl = el('div', { class: 'ap-notice' });
  const voiceNote = el('p', { class: 'ap-voice-note', text: '开启后，本页面会使用麦克风等待唤醒词；检测到唤醒词后才进入指令识别，你可以随时关闭。当前浏览器兼容路径可能使用浏览器语音服务，正式上线前可替换为本地模型。' });
  const voiceStatus = el('div', { class: 'ap-voice-status', role: 'status', 'aria-live': 'polite' });
  const wakeButton = el('button', {
    class: 'ap-voice-button', type: 'button', text: '开启语音唤醒',
    onclick: async () => {
      const voice = ensureVoice();
      try {
        if (voice.preferences().wakeEnabled) {
          voice.setPreferences({ wake_enabled: false });
        } else {
          await voice.start({ wake: true });
        }
      } catch (error) {
        addMsg('agent', [el('p', { text: error.name === 'NotAllowedError' || error.message === 'NotAllowedError' ? '麦克风权限被拒绝。请在浏览器地址栏的权限设置中允许麦克风，再点击恢复；语音未开启期间仍可使用文字输入。' : '麦克风暂时不可用。请检查设备、浏览器权限或改用文字输入。' })], '小蕉');
      }
      updateVoiceStatus();
    },
  });
  const micButton = el('button', {
    class: 'ap-voice-button ap-mic-button', type: 'button', text: '点击说话',
    onclick: async () => {
      try { await ensureVoice().start({ wake: false }); } catch { addMsg('agent', [el('p', { text: '麦克风不可用。请检查浏览器权限，或直接使用文字输入。' })], '小蕉'); }
    },
  });
  const stopButton = el('button', { class: 'ap-voice-button ap-stop-button', type: 'button', text: '停止朗读', onclick: () => ensureVoice().stopSpeaking() });
  const panelEl = el('aside', { class: 'agent-panel', role: 'dialog', 'aria-modal': 'false', 'aria-label': '小蕉智能体面板' }, [
    el('div', { class: 'ap-head' }, [
      catSVG(),
      el('h3', { text: '小蕉' }),
      el('button', { class: 'ap-close', text: '×', 'aria-label': '收起小蕉', onclick: () => api.close() }),
    ]),
    noticeEl,
    el('div', { class: 'ap-voice-controls' }, [voiceNote, voiceStatus, wakeButton, micButton, stopButton]),
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
  panel.nodes = { fab, panel: panelEl, log, ctxLine, notice: noticeEl, voiceStatus, wakeButton };
  refreshNotice();
  updateVoiceStatus();
}

const api = {
  mount() {
    if (!panel.nodes.fab) render();
    panel.nodes.fab.style.display = '';
  },
  unmount() {
    invalidateRequests();
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
    document.body.classList.remove('agent-open');
  },
  open() {
    if (!panel.nodes.panel) render();
    panel.open = true;
    panel.nodes.panel.classList.add('open');
    document.body.classList.add('agent-open');   // 停靠布局：内容区整体左挤
    panel.nodes.ctxLine.innerHTML = '';
    panel.nodes.ctxLine.appendChild(el('b', { text: '会话上下文 ' }));
    panel.nodes.ctxLine.append(contextBanner());
    if (!panel.nodes.log.children.length) {
      addMsg('agent', [
        el('p', { text: `你好，我是小蕉，一只正在收集上海非遗资料的小猫。${panel.craft ? `关于「${panel.craft.title}」，我找到了纪录片转写和知识草稿，可以帮你检索。` : '进入具体工艺页后，我可以检索该项目的资料。'}我不会替你完成操作，但可以在你卡住时提供线索。` }),
      ], '小蕉');
    }
    panel.onToggle?.(true);
  },
  close() {
    panel.open = false;
    panel.nodes.panel?.classList.remove('open');
    document.body.classList.remove('agent-open');
    panel.onToggle?.(false);
  },
  toggle() { (panel.open ? api.close : api.open)(); },
  isOpen: () => panel.open,
  setCraft(craft) {
    if (panel.craft !== craft) invalidateRequests();
    panel.craft = craft;
  },
  setContext(ctx) {
    Object.assign(panel.context, ctx);
    if (panel.open) {
      panel.nodes.ctxLine.innerHTML = '';
      panel.nodes.ctxLine.appendChild(el('b', { text: '会话上下文 ' }));
      panel.nodes.ctxLine.append(contextBanner());
    }
  },
  setHost(host = {}) {
    panel.host = host;
    panel.registry = null;
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
  say(text) { if (panel.open) addMsg('agent', [el('p', { text })], '小蕉'); },
  onToggle(fn) { panel.onToggle = fn; },
};

export const agent = api;
