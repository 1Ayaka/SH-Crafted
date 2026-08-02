// 小蕉智能体侧栏 —— DeepSeek 模型应答 + 检索式降级
// 慢路径（非材料/动作/工序直读）优先走 server.mjs 的 /api/agent 代理（密钥只在服务器侧）；
// 代理不可用（无密钥/超时/5xx）时静默降级为基于资料库的检索式占位应答，并提示降级状态
import { el, catSVG, openEvidenceModal } from './ui.js';
import { evidenceTimecode } from './data.js';

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
};

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
        context: buildAgentContext(retrieved),
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
  const panelEl = el('aside', { class: 'agent-panel', 'aria-label': '小蕉智能体面板' }, [
    el('div', { class: 'ap-head' }, [
      catSVG(),
      el('h3', { text: '小蕉' }),
      el('button', { class: 'ap-close', text: '×', 'aria-label': '收起小蕉', onclick: () => api.close() }),
    ]),
    noticeEl,
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
  panel.nodes = { fab, panel: panelEl, log, ctxLine, notice: noticeEl };
  refreshNotice();
}

const api = {
  mount() {
    if (!panel.nodes.fab) render();
    panel.nodes.fab.style.display = '';
  },
  unmount() {
    invalidateRequests();
    panel.nodes.fab?.remove();
    panel.nodes.panel?.remove();
    panel.nodes = {};
    panel.open = false;
    panel.craft = null;
    panel.onToggle = null;
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
  say(text) { if (panel.open) addMsg('agent', [el('p', { text })], '小蕉'); },
  onToggle(fn) { panel.onToggle = fn; },
};

export const agent = api;
