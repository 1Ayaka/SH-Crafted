// 非遗详情 + 粒子工作台（核心页）
// 状态机：CRAFT_READING → CRAFT_PLAYING → finishing（一键完成作品）→ CRAFT_COMPLETED
// 规则判定全部来自 process_steps.jsonl（真实数据），失败分级提示，绝不自动完成
// 本页已接入跨页系统：assets/bg-crafts/<id>/ 分层背景 + 底层环境墨晕 + transitions 转场登记
// 工作区桌面：assets/t工作台.png；页面大背景始终沿用当前非遗详情页背景。
// 模型（config.CRAFT_MODEL_PATHS）：未开始态显示松散细碎的成品预览；完成态用高精度成品揭晓。
import { el, reviewTag, openEvidenceModal, jiaoToast } from '../ui.js';
import { InkField, blotTargets, imageTargets, loadImage } from '../particles.js';
import { craftAssetUrl, ensureCraftLoaded, evidenceTimecode, isContentReviewed } from '../data.js';
import { MATERIAL_STATES, CRAFT_MODEL_PATHS } from '../config.js';
import { topNav } from './home.js';
import { agent } from '../agent.js';
import { createLayerBG } from '../layerbg.js';
import { createInkBloom } from '../inkbloom.js';
import { registerPage, unregisterPage, transitionTo, consumeEnter } from '../transitions.js';
import { isAdmin, saveCraft } from '../admin.js';
import { mountEditableModule } from '../editable.js';
import { createWorkbenchSurface } from '../workbench-preview.js';
import { graphId, parseGraphId } from '../agent/graph-adapter.js';
import { materialTransformMap } from '../material-flow.js';
import { createHeritageGraphState } from '../heritage-graph.js';
import { mountHeritageGraph } from '../heritage-graph-3d.js';

const OUTPUT_PALETTE = [
  '#6F8C73', '#A56A4E', '#B48A42', '#5D7F84', '#9C6B76',
  '#7B8061', '#C47B55', '#6E7890', '#A3815E', '#557866',
  '#B46C59', '#8B7A9E', '#6B8C9B', '#A27C55', '#7D8D62',
  '#B77A6A', '#6D8275', '#9A734B', '#657D93', '#9A8662',
];
const RAW_RESOURCE_COLOR = '#8B9D83';
const TOOL_RESOURCE_COLOR = '#747D71';

function materialLevelColor(identity, level) {
  let hash = 0;
  for (const char of String(identity)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return OUTPUT_PALETTE[(hash + Math.max(1, level) * 5) % OUTPUT_PALETTE.length];
}

const STEP_FOCUS_TERMS = [
  '挑选', '处理', '晾晒', '风干', '阴干', '制皮', '过稿', '绘刻', '着色', '固色', '组装',
  '开刃', '勾勒', '粗雕', '精刻', '修光', '编织', '裁剪', '打磨', '上色', '定型', '装裱',
];

function conciseStepText(step) {
  const source = String(step.action || step.description || '').replace(/\s+/g, ' ').trim();
  if (!source) return `完成“${step.displayName}”所需的材料准备与操作。`;
  if (source.length <= 112) return source;
  const clipped = source.slice(0, 112);
  const stop = Math.max(clipped.lastIndexOf('；'), clipped.lastIndexOf('。'), clipped.lastIndexOf('，'));
  return `${clipped.slice(0, stop > 62 ? stop : 108)}……`;
}

function highlightedStepText(step) {
  if (step.guide_text) {
    const text = String(step.guide_text);
    const ranges = (Array.isArray(step.guide_bold_ranges) ? step.guide_bold_ranges : [])
      .map((range) => ({ start: Math.max(0, Number(range.start) || 0), end: Math.min(text.length, Number(range.end) || 0) }))
      .filter((range) => range.end > range.start)
      .sort((a, b) => a.start - b.start);
    if (!ranges.length) return [document.createTextNode(text)];
    const nodes = [];
    let cursor = 0;
    for (const range of ranges) {
      if (range.start > cursor) nodes.push(document.createTextNode(text.slice(cursor, range.start)));
      const start = Math.max(cursor, range.start);
      if (range.end > start) nodes.push(el('strong', { text: text.slice(start, range.end) }));
      cursor = Math.max(cursor, range.end);
    }
    if (cursor < text.length) nodes.push(document.createTextNode(text.slice(cursor)));
    return nodes;
  }
  const text = conciseStepText(step);
  const rule = step.interactionRule;
  const terms = [
    step.displayName,
    rule?.action?.label,
    ...(rule?.allowed_resources || []),
    ...STEP_FOCUS_TERMS.filter((term) => text.includes(term)),
    ...(text.match(/\d+(?:\s*[-—至]\s*\d+)?(?:\.\d+)?\s*(?:年|月|天|日|毫米|厘米|米|度|类|道|次|层)?/g) || []),
  ]
    .filter((term) => term && String(term).length > 1 && text.includes(term))
    .map(String)
    .sort((a, b) => b.length - a.length);
  const uniqueTerms = [...new Set(terms)].slice(0, 8);
  if (!uniqueTerms.length) return [document.createTextNode(text)];
  const matcher = new RegExp(`(${uniqueTerms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  return text.split(matcher).filter(Boolean).map((part) => (
    uniqueTerms.includes(part) ? el('strong', { text: part }) : document.createTextNode(part)
  ));
}

function stepFloatingGuide(step, index, total) {
  const resources = step.interactionRule?.allowed_resources || [];
  return el('section', { class: 'wb-step-float', 'aria-label': `当前工序说明：${step.displayName}` }, [
    el('p', { class: 'wb-step-float-index', text: `工序 ${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}` }),
    el('h3', {}, [el('strong', { text: step.displayName })]),
    el('p', { class: 'wb-step-float-copy' }, highlightedStepText(step)),
    resources.length ? el('p', { class: 'wb-step-float-resources' }, [
      document.createTextNode('本步使用：'),
      el('strong', { text: resources.slice(0, 5).join('、') }),
      resources.length > 5 ? document.createTextNode(` 等 ${resources.length} 项`) : null,
    ]) : el('p', { class: 'wb-step-float-resources', text: '本步无需额外材料或工具' }),
  ]);
}

function resourceColor(name) {
  let hash = 0;
  for (const char of String(name)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return OUTPUT_PALETTE[hash % OUTPUT_PALETTE.length];
}

export async function craftView(root, { id }) {
  const loadingShell = el('section', { class: 'view craft-loading-shell' }, [
    topNav('craft'),
    el('div', { class: 'craft-loading-card', role: 'status' }, [
      el('i', { class: 'craft-loading-mark', 'aria-hidden': 'true' }),
      el('strong', { text: '正在展开非遗资料' }),
      el('span', { text: '页面结构已就绪，当前只读取这一项的工序与证据。' }),
    ]),
  ]);
  root.appendChild(loadingShell);
  const craft = await ensureCraftLoaded(id);
  loadingShell.remove();
  if (!craft) {
    root.appendChild(el('section', { class: 'view passport' }, [
      topNav(''),
      el('p', { class: 'empty-state', text: '未找到该项目，资料待接入。' }),
      el('p', { style: { textAlign: 'center' } }, [
        el('a', { href: '#/explore', text: '← 返回地图探索' }),
      ]),
    ]));
    return { cleanup() {} };
  }

  // ---------- 会话状态 ----------
  const S = {
    phase: 'reading',            // reading | playing | finishing | completed
    openPanel: 0,
    stepIndex: 0,                // 当前待完成步骤
    resourceStates: new Map(craft.allResources.map((name) => [name, 'raw'])),
    selectedResources: new Set(),
    materialItems: new Map(),
    workbenchPhysics: new Map(),
    backpackScrollByStep: new Map(),
    actionSlot: null,
    failures: 0,                 // 连续失败
    helpRefusedStep: null,
    log: [],                     // 操作回放
  };
  const fields = [];
  const cleanups = [];
  const pmHandles = [];          // 粒子模型句柄（clearWorkbench/cleanup 时 dispose）
  const wbPreviewHandles = [];
  let graphExplorer = null;
  let graphOverlay = null;
  let graphReturnFocus = null;
  let finishedModelHandle = null;

  // ---------- 工艺专属分层背景 + 底层环境墨晕（与首页同一管线）----------
  const entering = consumeEnter();
  const bgManifest = craft.config.backgroundManifest || `assets/bg-crafts/${id}/manifest.json`;
  const bg = await createLayerBG(bgManifest, {
    scrim: 'left', enter: entering, parallax: true, fixed: true,
  });
  const ambientCanvas = el('canvas', { class: 'bg-bloom', 'aria-hidden': 'true', style: { zIndex: '1' } });
  bg.el.insertBefore(ambientCanvas, bg.layerEls[1] || null);
  bg.fadeEls.push(ambientCanvas);

  // ---------- 页面骨架 ----------
  const craftTitle = el('h2', { text: craft.title });
  const craftCategory = el('span', { text: craft.config.category || '类别待核对' });
  const head = el('div', { class: 'craft-head' }, [
    el('button', { class: 'back-btn', onclick: () => transitionTo('#/explore') }, ['← 返回地图']),
    craftTitle,
    el('span', { class: 'meta' }, [
      el('span', { text: `${craft.config.districtLabel || '地区待核对'} · ` }),
      craftCategory,
      craft.config.community
        ? el('span', { class: 'tag tag-community', text: '社区投稿 · 已审核' })
        : el('span', { class: 'tag tag-pending', text: '类别待核对' }),
      craft.config.districtVerified ? null : el('span', { class: 'tag tag-pending', text: ' 地区待核对' }),
    ]),
    el('span', { class: 'spacer' }),
    isAdmin() ? el('a', { href: `#/admin/craft/${craft.craftId}`, class: 'small admin-process-link', text: '编辑工序' }) : null,
    el('a', { href: '#/passport', class: 'small', text: '数据护照 →' }),
  ]);
  mountEditableModule(head, [
    { key: 'title', element: craftTitle },
    { key: 'category', element: craftCategory },
  ], (values) => saveCraft(craft.craftId, values));

  const body = el('div', { class: 'craft-body' });
  const readingCol = el('div', { class: 'reading-col' });
  const workbench = el('div', { class: 'workbench-col' });
  body.append(readingCol, workbench);
  const page = el('section', { class: 'view craft-page' }, [bg.el, topNav('craft'), head, body]);
  root.appendChild(page);

  // 大背景始终沿用当前非遗详情页；桌面图片只由中央工作区按需使用。
  // 旧实现会在详情页打开时额外下载一整套从未显示的工作台背景（约 4MB）。
  function setWorkbenchBg(on) {
    bg.el.classList.toggle('dimmed', on);
    bg.setActive(!on);
  }

  // 底层环境墨晕（克制，与首页同参数族；面板区域不透明无需避让）
  const ambientBloom = createInkBloom(ambientCanvas, bg.manifest, bg.bgDir, {
    mode: 'ambient', sampleMid: true,
    ambient: {
      maxAlive: 4, interval: [4, 8], maxR: [30, 90],
      alpha: [0.04, 0.09], grow: [3.5, 6.5], hold: [2, 5], fade: [7, 13],
    },
  });
  registerPage('craft', {
    root: page,
    bg,
    fadeUI() {
      page.querySelectorAll('.topnav, .craft-head, .craft-body').forEach((n) => n.classList.add('ui-fade'));
    },
  });

  // 粒子模型挂载（懒加载 three/GLTFLoader；失败回退平面关键帧）。返回 handle 或 null。
  async function mountParticleModel(stage, url, onFail, pmOpts = {}) {
    try {
      const { createParticleModel } = await import('../particlemodel.js');
      if (!stage.isConnected) return null;
      const h = await createParticleModel(stage, url, pmOpts);
      if (!stage.isConnected) { h.dispose(); return null; }
      pmHandles.push(h);
      return h;
    } catch (err) {
      console.warn('粒子模型加载失败：', err);
      onFail?.();
      return null;
    }
  }

  // 成品模型与纹样提前预载（进入工作台即开始），完成作品时揭晓瞬时
  function preloadFinished() {
    const modelSet = CRAFT_MODEL_PATHS[id] || (craft.config?.modelPath ? { finished: craft.config.modelPath } : null);
    if (!modelSet) return;
    import('../particlemodel.js').then((m) => {
      if (modelSet.finished) m.preloadModel(modelSet.finished);
      if (modelSet.pattern) m.preloadPattern(modelSet.pattern);
    }).catch(() => {});
  }

  // ---------- 左：叠山三面板 ----------
  const panelDefs = [
    { title: '工艺概览', build: buildIntro },
    { title: '工序与材料', build: buildProcess },
    { title: '人与作品', build: buildLegacy },
  ];

  function buildIntro() {
    const frag = el('div', {});
    const summary = el('span', { text: craft.summary });
    const summaryBlock = el('div', { class: 'craft-summary-editable' }, [
      el('p', {}, [summary, document.createTextNode(' '), craft.config.community ? el('span', { class: 'tag tag-community', text: '社区审核通过' }) : reviewTag()]),
    ]);
    mountEditableModule(summaryBlock, [{ key: 'summary', element: summary }], (values) => saveCraft(craft.craftId, values));
    frag.appendChild(summaryBlock);
    frag.appendChild(el('p', { class: 'small muted', text: craft.config.community
      ? '该条目由社区用户提交，并经管理员审核后公开。'
      : '以上简介为 AI 从纪录片自动生成的草稿（summary_candidate），人工审核尚未完成。' }));
    frag.appendChild(el('h5', { text: '资料中的事实陈述（自动抽取）' }));
    if (!craft.claims.length) frag.appendChild(el('p', { class: 'empty-state', text: '资料待补充' }));
    for (const c of craft.claims) {
      frag.appendChild(el('div', { class: 'claim-item' }, [
        el('span', { text: c.statement + ' ' }),
        craft.config.community ? el('span', { class: 'tag tag-community', text: '社区审核通过' }) : reviewTag(),
        c.evidence_ids?.length
          ? el('button', {
              class: 'ev-link', text: '查看证据',
              onclick: () => openEvidenceModal(craft, c.evidence_ids.slice(0, 2), { title: '证据 · 工艺概览' }),
            })
          : null,
      ]));
    }
    return frag;
  }

  function buildProcess() {
    const frag = el('div', {});
    frag.appendChild(el('h5', { text: '材料与物件（来自工艺步骤数据）' }));
    frag.appendChild(el('div', { class: 'chip-row' }, craft.allResources.map((name) => el('span', {
      class: 'chip', text: `${name}${craft.resourceKinds.get(name) === 'implement' ? ' · 物件' : ''}`,
    }))));
    frag.appendChild(el('h5', { text: '动作' }));
    frag.appendChild(el('div', { class: 'chip-row' }, craft.actions.map((action) => el('span', { class: 'chip', text: action.label }))));
    frag.appendChild(el('h5', { text: isContentReviewed() ? '工序' : '工序（顺序为候选顺序，待审核）' }));
    craft.steps.forEach((s, i) => {
      frag.appendChild(el('div', { class: 'step-item' }, [
        el('p', { class: 'st-title' }, [
          el('span', { class: 'order', text: `${i + 1}` }),
          el('span', { text: s.displayName + ' ' }),
          reviewTag(),
        ]),
        el('p', { class: 'st-action', text: `为什么这样做：${s.action}` }),
        el('p', { class: 'st-meta', text: `资源：${s.interactionRule.allowed_resources.join('、') || '—'} · 动作：${s.interactionRule.action.label}` }),
        s.interactionRule.source === 'legacy_candidate'
          ? (isContentReviewed() ? null : el('p', { class: 'st-meta', text: '交互规则由旧数据兼容生成，资源组合方式待人工审核。' }))
          : null,
        el('button', {
          class: 'ev-link', text: '查看纪录片片段',
          onclick: () => openEvidenceModal(craft, s.evidence_ids, { title: `证据 · ${s.displayName}` }),
        }),
      ]));
    });
    return frag;
  }

  function buildLegacy() {
    const frag = el('div', {});
    if (craft.config.community) {
      frag.appendChild(el('h5', { text: '社区资料说明' }));
      frag.appendChild(el('p', { text: craft.communityDetails?.features || '投稿人未补充更多特色说明。' }));
      if (craft.communityDetails?.source_url) frag.appendChild(el('a', {
        class: 'ev-link', href: craft.communityDetails.source_url, target: '_blank', rel: 'noopener noreferrer', text: '查看投稿资料来源',
      }));
      frag.appendChild(el('p', { class: 'small muted', text: '本条目已经通过站内管理员审核；如需进一步事实核验，可在后台继续补充资料。' }));
      return frag;
    }
    frag.appendChild(el('h5', { text: '资料中出现的人物' }));
    frag.appendChild(craft.people.length
      ? el('div', { class: 'chip-row' }, craft.people.map((p) => el('span', { class: 'chip', text: p })))
      : el('p', { class: 'empty-state', text: '资料待补充' }));
    if (!isContentReviewed()) frag.appendChild(el('p', { class: 'small muted', text: '人名来自转写实体识别，存在同音误识别风险，待审核。' }));
    frag.appendChild(el('h5', { text: '代表作品与器物' }));
    frag.appendChild(craft.artifacts.length
      ? el('div', { class: 'chip-row' }, craft.artifacts.map((a) => el('span', { class: 'chip', text: a })))
      : el('p', { class: 'empty-state', text: '资料待补充' }));
    frag.appendChild(el('h5', { text: '资料来源' }));
    frag.appendChild(el('p', { class: 'small', text: `纪录片《${craft.title}》（${craft.manifest.video.source_filename}）· 证据 ${craft.evidence.length} 段 · 全部由火山引擎视频理解自动抽取` }));
    if (!isContentReviewed()) frag.appendChild(el('p', {}, [reviewTag('全部内容待人工审核')]));
    return frag;
  }

  function renderPanels() {
    readingCol.innerHTML = '';
    panelDefs.forEach((def, i) => {
      const open = i === S.openPanel;
      const panel = el('div', { class: `panel${open ? ' open' : ''}` }, [
        el('button', {
          class: 'panel-head', 'aria-expanded': String(open),
          onclick: () => {
            if (agent.isOpen()) agent.close();       // 面板互斥：展开资料即收起小蕉
            if (S.phase !== 'reading') {
              // 工作台期间：阅读面板作为布局区域重新展开（不丢工作台状态）；再点当前面板收起
              const wasOpen = body.classList.contains('reading-open');
              const same = S.openPanel === i;
              S.openPanel = i;
              body.classList.toggle('reading-open', !(wasOpen && same));
              renderPanels();
              return;
            }
            S.openPanel = i;
            body.classList.remove('panels-collapsed');
            renderPanels();
          },
        }, [
          el('span', { class: 'pnum', text: `0${i + 1}` }),
          el('h3', { text: def.title }),
          el('span', { class: 'chev', text: '▾' }),
        ]),
        el('div', { class: 'panel-body' }, [def.build()]),
      ]);
      readingCol.appendChild(panel);
    });
  }

  function collapsePanelsForAgent() {
    body.classList.add('panels-collapsed');
    body.classList.remove('reading-open');   // 小蕉展开时，阅读面板让位（布局区域互斥）
  }
  // ---------- 右：工作台 ----------
  function currentStep() { return craft.steps[S.stepIndex] || null; }

  function documentaryPanel(step) {
    const clip = (step?.documentary_clips || []).find((item) => item?.video_url || item?.image_url);
    if (!clip) return null;
    const media = clip.video_url
      ? el('video', { class: 'wb-documentary-video', src: clip.video_url, controls: 'controls', preload: 'metadata', playsinline: 'playsinline' })
      : el('img', { class: 'wb-documentary-video wb-documentary-image', src: craftAssetUrl(craft, clip.image_url), alt: clip.title || step.displayName, loading: 'lazy' });
    const start = Math.max(0, Number(clip.start_seconds) || 0);
    const end = Math.max(0, Number(clip.end_seconds) || 0);
    if (clip.video_url) {
      media.addEventListener('loadedmetadata', () => { if (start && start < media.duration) media.currentTime = start; }, { once: true });
      media.addEventListener('timeupdate', () => { if (end > start && media.currentTime >= end) { media.pause(); media.currentTime = start; } });
    }
    return el('aside', { class: 'wb-documentary', 'aria-label': '当前工序纪录片片段' }, [
      el('p', { class: 'wb-documentary-kicker', text: '纪录片片段' }),
      el('h4', { text: clip.title || step.displayName }),
      media,
      clip.description ? el('p', { class: 'wb-documentary-description', text: clip.description }) : null,
      clip.source_url ? el('a', { class: 'ev-link', href: clip.source_url, target: '_blank', rel: 'noopener noreferrer', text: '查看片段来源' }) : null,
    ]);
  }

  function resourceVisual(name, step = currentStep()) {
    const visual = (step?.resource_visuals || []).find((item) => item.name === name);
    return { shape: visual?.shape || '', scale: Number(visual?.scale) || 1 };
  }

  function carriedMaterialFor(name) {
    return [...S.materialItems.values()].find((item) => item.currentName === name) || null;
  }

  function effectiveSelectedResources(step = currentStep()) {
    const selected = new Set(S.selectedResources);
    for (const name of step?.interactionRule?.allowed_resources || []) {
      if (craft.resourceKinds.get(name) !== 'implement' && carriedMaterialFor(name)) selected.add(name);
    }
    const transforms = materialTransformMap(step);
    for (const item of S.materialItems.values()) {
      if (transforms.has(item.currentName)) selected.add(item.currentName);
    }
    return selected;
  }

  function syncAgentContext() {
    agent.setContext({
      page: 'craft_experience',
      current_step_id: currentStep()?.step_id || null,
      inventory_states: [
        ...[...S.materialItems.values()].map((item) => ({ name: item.currentName, state: `${item.level}级材料 · 已在工作台` })),
        ...[...S.resourceStates.entries()]
          .filter(([name]) => craft.resourceKinds.get(name) === 'implement')
          .map(([name]) => ({ name, state: '工具' })),
      ],
      recent_actions: S.log.slice(-5).map((l) => l.text),
      failure_count: S.failures,
    });
  }

  function logAction(text, evidenceIds = []) {
    S.log.push({ t: new Date(), text, evidenceIds });
    syncAgentContext();
  }

  function clearWorkbench() {
    fields.splice(0).forEach((f) => f.destroy());
    // 卸载粒子模型并释放 GPU 资源
    pmHandles.splice(0).forEach((h) => { try { h.dispose(); } catch (_) {} });
    wbPreviewHandles.splice(0).forEach((h) => { try { h.dispose(); } catch (_) {} });
    workbench.innerHTML = '';
  }

  // --- 未开始：用成品模型显示松散细碎的预览；无模型回退平面墨粒框 ---
  // 平面回退：粒子框 + 代表物（0002/0003 无模型，或模型加载失败时）
  function renderIdleFlat(noteText) {
    const frameWrap = el('div', { class: 'frame-wrap' }, [
      el('canvas', { 'aria-hidden': 'true' }),
      el('img', { src: craftAssetUrl(craft, craft.config.heroFrame), alt: `${craft.title}代表物（纪录片关键帧）` }),
    ]);
    workbench.appendChild(el('div', { class: 'wb-idle' }, [
      frameWrap,
      el('h3', { text: '粒子工作台' }),
      el('p', { class: 'note', text: noteText }),
      el('button', { class: 'btn btn-primary', text: '进入工作台', onclick: startPlay }),
    ]));
    const cv = frameWrap.querySelector('canvas');
    const field = new InkField(cv, { maxParticles: 380 });
    fields.push(field);
    requestAnimationFrame(() => {
      const w = cv.clientWidth, h = cv.clientHeight;
      // 环绕图像的墨粒框
      const pts = [];
      const mx = w * 0.14, my = h * 0.14, rw = w - mx * 2, rh = h - my * 2;
      for (let i = 0; i < 300; i++) {
        const side = i % 4, t = Math.random();
        let x, y;
        if (side === 0) { x = mx + t * rw; y = my; }
        else if (side === 1) { x = mx + t * rw; y = my + rh; }
        else if (side === 2) { x = mx; y = my + t * rh; }
        else { x = mx + rw; y = my + t * rh; }
        pts.push({ x: x + (Math.random() - 0.5) * 14, y: y + (Math.random() - 0.5) * 14, w: 0.5 });
      }
      field.setTargets(pts);
    });
  }

  function renderIdle() {
    clearWorkbench();
    if (!craft.steps.length) {
      workbench.appendChild(el('div', { class: 'wb-idle community-note-idle' }, [
        craft.config.heroFrame ? el('img', { class: 'community-note-cover', src: craftAssetUrl(craft, craft.config.heroFrame), alt: craft.title }) : null,
        el('h3', { text: '社区文化遗产条目' }),
        el('p', { class: 'note', text: '投稿人暂未添加制作工序，因此本条目以资料阅读为主；管理员可以在后台继续补充工序模块。' }),
      ]));
      return;
    }
    const modelSet = CRAFT_MODEL_PATHS[id] || (craft.config?.modelPath ? { finished: craft.config.modelPath } : null);
    if (!modelSet) {
      renderIdleFlat('三维模型待接入，暂以纪录片关键帧展示；建议先查看工序。');
      return;
    }
    // 进入工艺页后直接加载预览；完成态继续复用浏览器中的同一份 GLB 缓存。
    const previewModel = modelSet.finished || modelSet.raw;
    const stage = el('div', { class: 'pm-stage pm-deferred' });
    const previewPoster = craft.config.heroFrame
      ? el('img', { class: 'pm-preview-poster', src: craftAssetUrl(craft, craft.config.heroFrame), alt: `${craft.title}代表图片`, loading: 'lazy' })
      : null;
    if (previewPoster) stage.appendChild(previewPoster);
    let previewLoading = false;
    const startPreviewLoad = async () => {
      if (previewLoading) return;
      previewLoading = true;
      // createParticleModel owns the single loading indicator. Leaving a
      // second placeholder here would cover the finished canvas indefinitely.
      stage.replaceChildren();
      const handle = await mountParticleModel(stage, previewModel, () => {
        previewLoading = false;
        const retry = el('button', { class: 'btn-ghost pm-load-button', type: 'button', text: '重新加载', onclick: startPreviewLoad });
        stage.replaceChildren(el('div', { class: 'pm-deferred-copy' }, [
          previewPoster,
          el('p', { text: '模型加载失败，请检查网络后重试。' }),
          retry,
        ]));
      }, {
        looseAmount: 0.14,
        pointSize: 0.0085,
        alpha: 0.68,
        flowSpeed: 0.042,
        diffuseSpeed: 0.018,
        ...(modelSet.pattern ? { tint: modelSet.rawTint, patternUrl: modelSet.pattern } : {}),
      });
      if (handle && modelSet.pattern) handle.playDyeSweep(0.12);
    };
    workbench.appendChild(el('div', { class: 'wb-idle' }, [
      stage,
      el('h3', { text: '粒子工作台' }),
      el('p', { class: 'note', text: '三维轮廓会自动载入；完成前粒子更松散细碎，完成全部工序后显示高精度成品。' }),
      el('button', { class: 'btn btn-primary', text: '进入工作台', onclick: startPlay }),
    ]));
    requestAnimationFrame(() => { void startPreviewLoad(); });
  }

  function startPlay() {
    S.phase = 'playing';
    body.classList.add('playing');
    body.classList.remove('reading-open');
    setWorkbenchBg(false);      // 大背景继续使用当前非遗详情页；桌子图仅用于中央工作区
    logAction('开始工艺体验');
    renderPlay();
  }

  function quickFillCurrentStep() {
    const step = currentStep();
    if (!step) return;
    const rule = step.interactionRule;
    S.selectedResources.clear();
    const presetResources = Array.isArray(rule.quick_fill?.resources)
      ? rule.quick_fill.resources.filter((name) => rule.allowed_resources.includes(name))
      : [];
    if (presetResources.length) {
      presetResources.forEach((name) => {
        if (craft.resourceKinds.get(name) === 'implement' || !carriedMaterialFor(name)) S.selectedResources.add(name);
      });
    } else {
      for (const group of rule.resource_groups) {
        if (group.mode === 'all') {
          group.options.forEach((name) => {
            if (craft.resourceKinds.get(name) === 'implement' || !carriedMaterialFor(name)) S.selectedResources.add(name);
          });
        } else {
          const required = Math.max(0, group.min || 0);
          const alreadyCarried = group.options.filter((name) => carriedMaterialFor(name)).length;
          group.options
            .filter((name) => !carriedMaterialFor(name))
            .slice(0, Math.max(0, required - alreadyCarried))
            .forEach((name) => S.selectedResources.add(name));
        }
      }
    }
    // 兼容没有必选分组的旧数据：工作台当前仍要求至少选择一项资源。
    if (!S.selectedResources.size && rule.allowed_resources.length) {
      S.selectedResources.add(rule.allowed_resources[0]);
    }
    S.actionSlot = rule.quick_fill?.action_id || rule.action.id;
    renderPlay();
    const filledFeedback = workbench.querySelector('.wb-feedback');
    if (filledFeedback) {
      filledFeedback.className = 'wb-feedback ok';
      filledFeedback.textContent = '已填入本步新增材料与动作；上一步产物已自动保留在工作台。';
    }
  }

  // --- 加工进行 ---
  function renderPlayLegacy() {
    clearWorkbench();
    const step = currentStep();

    // 背包
    const backpack = el('aside', { class: 'backpack', 'aria-label': '材料与物件' }, [
      el('h4', { text: '材料与物件' }),
      el('div', { class: 'bp-sec' }, [
        el('p', { class: 'sec-label', text: '当前步骤候选资源 · 可多选' }),
        ...step.interactionRule.allowed_resources.map((name) => {
          const kind = craft.resourceKinds.get(name) || 'material';
          const st = MATERIAL_STATES[S.resourceStates.get(name) || 'raw'];
          const selected = S.selectedResources.has(name);
          return el('button', {
            class: `bp-item ${kind === 'implement' ? 'resource-implement' : st.cls}${selected ? ' selected' : ''}`,
            onclick: () => {
              if (selected) S.selectedResources.delete(name);
              else S.selectedResources.add(name);
              renderPlay();
            },
          }, [
            el('i', { class: 'state-dot' }),
            el('span', { text: name }),
            el('span', { class: 'bp-state', text: selected ? '已选' : (kind === 'implement' ? '物件' : st.label) }),
          ]);
        }),
      ]),
      el('p', { class: 'small muted', text: step.interactionRule.source === 'legacy_candidate'
        ? (isContentReviewed() ? '候选资源来自兼容规则。' : '候选资源来自旧数据兼容规则，组合关系待人工审核。')
        : '当前步骤使用人工配置的交互规则。' }),
      el('div', { class: 'bp-legend' }, [
        el('div', {}, [el('i', { style: { background: '#8B9D83' } }), '原料']),
        el('div', {}, [el('i', { style: { background: '#C08E3A' } }), '加工中 / 中间态']),
        el('div', {}, [el('i', { style: { background: '#606C38' } }), '可装配']),
        el('div', {}, [el('i', { style: { background: '#7A8172' } }), '工具等可复用物件']),
      ]),
    ]);

    // 主区
    const selected = [...S.selectedResources];
    const resourceSlotEl = el('div', {
      class: `slot resource-slot${selected.length ? ' filled' : ''}`, 'data-slot': 'resources',
    }, [
      el('span', { class: 'slot-label', text: '已选材料' }),
      selected.length
        ? el('div', { class: 'selected-resource-list' }, selected.map((name) => el('button', {
            class: 'selected-resource', text: `${name} ×`, title: `移出 ${name}`,
            onclick: () => { S.selectedResources.delete(name); renderPlay(); },
          })))
        : el('span', { text: '可选择一种或多种材料与物件' }),
    ]);
    const actionSelect = el('select', {
      class: 'action-select', 'aria-label': '选择动作',
      onchange: (event) => { S.actionSlot = event.target.value || null; },
    }, [
      el('option', { value: '', text: '选择动作' }),
      ...craft.actions.map((action) => el('option', {
        value: action.id, text: action.label,
      })),
    ]);
    actionSelect.value = S.actionSlot || '';
    const actionSlotEl = el('div', { class: `slot action-slot${S.actionSlot ? ' filled' : ''}`, 'data-slot': 'action' }, [
      el('span', { class: 'slot-label', text: '动作' }),
      actionSelect,
    ]);

    let physicsHandle = null;
    const feedback = el('p', { class: 'wb-feedback', role: 'status' });
    const canvasArea = el('div', { class: 'wb-canvas-area' }, [resourceSlotEl, actionSlotEl]);

    const progress = el('span', { class: 'wb-progress' }, craft.steps.map((s, i) =>
      el('i', { class: `pg${i < S.stepIndex ? ' done' : i === S.stepIndex ? ' now' : ''}`, title: s.displayName })));

    const documentary = documentaryPanel(step);
    const main = el('div', { class: `wb-main${documentary ? ' has-documentary' : ''}` }, [
      el('div', { class: 'wb-step-bar' }, [
        el('span', { class: 'cur', text: `当前工序 ${S.stepIndex + 1}/${craft.steps.length}：${step.displayName}` }),
        reviewTag(),
        progress,
      ]),
      canvasArea,
      feedback,
      el('div', { class: 'wb-actions' }, [
        el('button', {
          class: 'btn-quick-fill', text: '一键填入',
          title: '自动填入当前步骤所需材料与动作',
          onclick: quickFillCurrentStep,
        }),
        el('button', { class: 'btn btn-primary', text: '执行动作', onclick: () => processStep(feedback, resourceSlotEl, actionSlotEl) }),
        el('button', {
          class: 'btn-ghost', text: '查看纪录片片段',
          onclick: () => openEvidenceModal(craft, step.evidence_ids, { title: `证据 · ${step.displayName}` }),
        }),
        el('span', { class: 'wb-note', text: '基于纪录片与审核资料简化，不构成真实工艺教学。卡住时可以问小蕉。' }),
      ]),
    ]);

    workbench.appendChild(el('div', { class: 'wb-play' }, [backpack, main]));
    syncAgentContext();
  }

  function renderPlayPrevious() {
    clearWorkbench();
    document.body.classList.remove('wb-dragging');
    const step = currentStep();
    if (!step) return;
    const rule = step.interactionRule;
    const allowed = new Set(rule.allowed_resources);
    const actions = rule.actions?.length ? rule.actions : [rule.action];
    const toolNeeded = [...allowed].some((name) => craft.resourceKinds.get(name) === 'implement');

    const backpack = el('aside', { class: 'backpack', 'aria-label': '材料与物件' }, [
      el('h4', { text: '材料与物件' }),
      el('div', { class: 'bp-sec' }, [
        el('p', { class: 'sec-label', text: '当前步骤候选资源 · 可多选' }),
        ...craft.allResources.map((name) => {
          const kind = craft.resourceKinds.get(name) || 'material';
          const st = MATERIAL_STATES[S.resourceStates.get(name) || 'raw'];
          const selected = S.selectedResources.has(name);
          const isAllowed = allowed.has(name);
          const unavailable = !isAllowed || (kind === 'implement' && !toolNeeded);
          return el('button', {
            class: `bp-item ${kind === 'implement' ? 'resource-implement' : st.cls}${selected ? ' selected' : ''}${unavailable ? ' is-unavailable' : ''}`,
            type: 'button', disabled: unavailable,
            title: unavailable
              ? (kind === 'implement' && !toolNeeded ? '该工序不需要工具' : '该资源不属于当前工序')
              : `选择${name}`,
            onclick: () => {
              if (unavailable) return;
              if (selected) S.selectedResources.delete(name);
              else S.selectedResources.add(name);
              renderPlay();
            },
          }, [
            el('i', { class: 'state-dot' }),
            el('i', { class: 'resource-swatch', style: { background: resourceColor(name) } }),
            el('span', { text: name }),
            el('span', { class: 'bp-state', text: selected ? '已选' : (kind === 'implement' ? '工具' : st.label) }),
          ]);
        }),
      ]),
      el('p', { class: 'small muted', text: rule.source === 'legacy_candidate'
        ? (isContentReviewed() ? '候选资源来自兼容规则。' : '候选资源来自旧数据兼容规则，组合关系待人工审核。')
        : '当前步骤使用人工配置的交互规则。' }),
      el('div', { class: 'bp-legend' }, [
        el('div', {}, [el('i', { style: { background: '#8B9D83' } }), '原料']),
        el('div', {}, [el('i', { style: { background: '#C08E3A' } }), '加工中 / 中间态']),
        el('div', {}, [el('i', { style: { background: '#606C38' } }), '可装配']),
        el('div', {}, [el('i', { style: { background: '#7A8172' } }), '工具等可复用物件']),
      ]),
    ]);

    const selected = [...S.selectedResources];
    const resourceSlotEl = el('div', {
      class: `slot resource-slot${selected.length ? ' filled' : ''}`, 'data-slot': 'resources',
    }, [
      el('span', { class: 'slot-label', text: '已选材料' }),
      selected.length
        ? el('div', { class: 'selected-resource-list' }, selected.map((name) => el('button', {
            class: 'selected-resource', type: 'button', text: `${name} ×`, title: `移出 ${name}`,
            onclick: () => { S.selectedResources.delete(name); renderPlay(); },
          })))
        : el('span', { text: '可选择一种或多种材料与物件' }),
    ]);

    const gallery = el('div', {
      class: `wb-object-gallery${selected.length ? '' : ' empty'}`,
      'aria-label': '已选资源的粒子立体预览',
    }, selected.length ? [] : [el('span', { text: '选择左侧材料，粒子会在工作区生成预览' })]);
    selected.forEach((name) => {
      const card = el('div', { class: 'wb-preview-card', title: '拖动旋转，点击随机摆放' }, [
        el('span', { class: 'wb-preview-label', text: name }),
      ]);
      gallery.appendChild(card);
      try { wbPreviewHandles.push(createWorkbenchPreview(card, name, resourceColor(name))); } catch (_) { /* WebGL 不可用时保留文字 */ }
    });

    const actionSlotEl = el('div', {
      class: `slot action-slot action-drop-slot${S.actionSlot ? ' filled' : ''}`, 'data-slot': 'action',
      ondragover: (event) => { event.preventDefault(); event.currentTarget.classList.add('drop-target'); },
      ondragleave: (event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.classList.remove('drop-target'); },
      ondrop: (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.classList.remove('drop-target');
        const actionId = event.dataTransfer?.getData('text/plain');
        if (!actionId || !actions.some((action) => action.id === actionId)) return;
        S.actionSlot = actionId;
        renderPlay();
        requestAnimationFrame(() => {
          const fb = workbench.querySelector('.wb-feedback');
          const rs = workbench.querySelector('[data-slot="resources"]');
          const as = workbench.querySelector('[data-slot="action"]');
          if (fb && rs && as) processStep(fb, rs, as);
        });
      },
    }, [
      el('span', { class: 'slot-label', text: '动作' }),
      S.actionSlot
        ? el('span', { class: 'slot-action-label', text: actions.find((action) => action.id === S.actionSlot)?.label || '已选择动作' })
        : el('span', { class: 'drop-hint', text: '将右侧动作拖到这里' }),
    ]);

    const actionPalette = el('div', { class: 'action-palette', 'aria-label': '可拖动动作' }, actions.map((action) => el('button', {
      class: `action-card${S.actionSlot === action.id ? ' selected' : ''}`,
      type: 'button', draggable: true, 'data-action': action.id,
      title: '拖到工作区执行，点击可先选择',
      ondragstart: (event) => {
        event.dataTransfer?.setData('text/plain', action.id);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        document.body.classList.add('wb-dragging');
      },
      ondragend: () => document.body.classList.remove('wb-dragging'),
      onclick: () => { S.actionSlot = action.id; renderPlay(); },
    }, [el('span', { text: action.label })])));

    const dropAreaHandlers = {
      ondragover: (event) => { event.preventDefault(); event.currentTarget.classList.add('drop-target'); },
      ondragleave: (event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.classList.remove('drop-target'); },
      ondrop: (event) => {
        event.preventDefault();
        event.currentTarget.classList.remove('drop-target');
        const actionId = event.dataTransfer?.getData('text/plain');
        if (!actionId || !actions.some((action) => action.id === actionId)) return;
        S.actionSlot = actionId;
        renderPlay();
        requestAnimationFrame(() => {
          const fb = workbench.querySelector('.wb-feedback');
          const rs = workbench.querySelector('[data-slot="resources"]');
          const as = workbench.querySelector('[data-slot="action"]');
          if (fb && rs && as) processStep(fb, rs, as);
        });
      },
    };
    const canvasArea = el('div', { class: 'wb-canvas-area', ...dropAreaHandlers }, [gallery, resourceSlotEl, actionSlotEl, actionPalette]);

    const feedback = el('p', { class: 'wb-feedback', role: 'status' });
    const progress = el('span', { class: 'wb-progress' }, craft.steps.map((s, i) =>
      el('i', { class: `pg${i < S.stepIndex ? ' done' : i === S.stepIndex ? ' now' : ''}`, title: s.displayName })));
    const documentary = documentaryPanel(step);
    const main = el('div', { class: `wb-main${documentary ? ' has-documentary' : ''}` }, [
      el('div', { class: 'wb-step-bar' }, [
        el('span', { class: 'cur', text: `当前工序 ${S.stepIndex + 1}/${craft.steps.length}：${step.displayName}` }),
        reviewTag(), progress,
      ]),
      canvasArea, feedback,
      el('div', { class: 'wb-actions' }, [
        el('button', { class: 'btn-quick-fill', text: '一键填入', title: '自动填入当前步骤所需材料与动作', onclick: quickFillCurrentStep }),
        el('button', { class: 'btn btn-primary', text: '执行动作', onclick: () => processStep(feedback, resourceSlotEl, actionSlotEl) }),
        el('button', { class: 'btn-ghost', text: '查看纪录片片段', onclick: () => openEvidenceModal(craft, step.evidence_ids, { title: `证据 · ${step.displayName}` }) }),
        el('span', { class: 'wb-note', text: '基于纪录片与审核资料简化，不构成真实工艺教学。卡住时可以问小蕉。' }),
      ]),
    ]);
    workbench.appendChild(el('div', { class: 'wb-play' }, [backpack, main]));
    syncAgentContext();
  }

  function renderPlay() {
    clearWorkbench();
    document.body.classList.remove('wb-dragging');
    const step = currentStep();
    if (!step) return;
    const rule = step.interactionRule;
    const allowed = new Set(rule.allowed_resources);
    const actions = craft.actions.length ? craft.actions : (rule.actions?.length ? rule.actions : [rule.action]);
    const materialNames = rule.allowed_resources.filter((name) => craft.resourceKinds.get(name) !== 'implement');
    const toolNames = craft.allResources.filter((name) => craft.resourceKinds.get(name) === 'implement');
    const backpackScrollKey = step.step_id || String(S.stepIndex);
    let tableSurface;

    const rememberBackpackScroll = (node) => {
      const panel = node?.closest?.('.backpack');
      if (panel) S.backpackScrollByStep.set(backpackScrollKey, panel.scrollTop);
    };

    const resourceButton = (name, kind) => {
      const selected = S.selectedResources.has(name);
      const carried = kind === 'material' ? carriedMaterialFor(name) : null;
      const available = allowed.has(name) && !carried;
      const state = MATERIAL_STATES[S.resourceStates.get(name) || 'raw'];
      let button;
      button = el('button', {
        class: `bp-item ${kind === 'implement' ? 'resource-implement' : state.cls}${selected || carried ? ' selected' : ''}${available ? '' : ' is-unavailable'}${carried ? ' is-carried' : ''}`,
        type: 'button', disabled: !available, 'data-resource': name, 'data-drag-mode': available ? 'pointer' : '',
        'aria-pressed': String(selected),
        title: carried ? `${carried.currentName}已从上一步保留在工作台` : (available ? `点击选择，或按住拖到桌面：${name}` : '当前工序不使用该工具'),
        onpointerdown: (event) => beginPointerResourceDrag(event, name, kind, button),
        onclick: (event) => {
          if (!available) return;
          if (button.dataset.suppressClick === 'true') {
            delete button.dataset.suppressClick;
            return;
          }
          rememberBackpackScroll(event.currentTarget);
          if (selected) S.selectedResources.delete(name);
          else S.selectedResources.add(name);
          renderPlay();
        },
      }, [
        el('i', { class: 'resource-swatch', style: { background: carried?.color || (kind === 'implement' ? TOOL_RESOURCE_COLOR : RAW_RESOURCE_COLOR) } }),
        el('span', { text: carried?.currentName || name }),
        el('span', { class: 'bp-state', text: carried ? `${carried.level}级 · 已在桌面` : (selected ? '待加工' : (kind === 'implement' ? '工具' : state.label)) }),
      ]);
      return button;
    };

    const activeTransforms = materialTransformMap(step);
    const activeCarried = [...S.materialItems.values()].filter((item) => activeTransforms.has(item.currentName));
    const heldCarried = [...S.materialItems.values()].filter((item) => !activeTransforms.has(item.currentName));
    const inheritedButtons = activeCarried.map((item) => el('button', {
      class: 'bp-item selected is-unavailable is-carried', type: 'button', disabled: true,
      title: `${item.currentName}在本步继续加工`,
    }, [
      el('i', { class: 'resource-swatch', style: { background: item.color } }),
      el('span', { text: item.currentName }),
        el('span', { class: 'bp-state', text: `${item.level}级 · 本步使用` }),
      ]));
    const heldButtons = heldCarried.map((item) => el('div', {
      class: 'bp-item is-unavailable is-carried is-held',
      title: `${item.currentName}已暂存，本步不参与加工`,
    }, [
      el('i', { class: 'resource-swatch', style: { background: item.color } }),
      el('span', { text: item.currentName }),
      el('span', { class: 'bp-state', text: `${item.level}级 · 暂存` }),
    ]));

    const backpack = el('aside', {
      class: 'backpack', 'aria-label': '本步材料、继承材料与工具',
      onscroll: (event) => S.backpackScrollByStep.set(backpackScrollKey, event.currentTarget.scrollTop),
    }, [
      el('h4', { text: '背包' }),
      inheritedButtons.length ? el('div', { class: 'bp-sec bp-inherited' }, [
        el('p', { class: 'sec-label', text: '既有材料 · 本步使用' }),
        ...inheritedButtons,
      ]) : null,
      heldButtons.length ? el('div', { class: 'bp-sec bp-held' }, [
        el('p', { class: 'sec-label', text: '暂存材料 · 本步不使用' }),
        ...heldButtons,
      ]) : null,
      el('div', { class: 'bp-sec' }, [
        el('p', { class: 'sec-label', text: '本步所需材料' }),
        ...(materialNames.length ? materialNames.map((name) => resourceButton(name, 'material')) : [
          el('p', { class: 'bp-empty', text: '本步没有新增材料' }),
        ]),
      ]),
      el('div', { class: 'bp-sec bp-tools' }, [
        el('p', { class: 'sec-label', text: '工具' }),
        ...(toolNames.length ? toolNames.map((name) => resourceButton(name, 'implement')) : [
          el('p', { class: 'bp-empty', text: '该项目没有登记工具' }),
        ]),
      ]),
      el('p', { class: 'bp-help', text: '本步使用的既有材料会自动上桌；暂存材料会保留到后续工序，不会被本步改变。' }),
    ]);

    const tableObjects = [
      ...activeCarried.map((item) => ({
        id: item.id,
        name: item.currentName,
        color: item.color,
        shapeName: item.currentName,
        ...resourceVisual(item.currentName),
      })),
      ...[...S.selectedResources]
        .filter((name) => craft.resourceKinds.get(name) !== 'implement' && !carriedMaterialFor(name))
        .map((name) => ({
        id: `material:${S.stepIndex}:${name}`,
        name,
        color: RAW_RESOURCE_COLOR,
        shapeName: name,
        ...resourceVisual(name),
      })),
      ...[...S.selectedResources]
        .filter((name) => craft.resourceKinds.get(name) === 'implement')
        .map((name) => ({ id: `tool:${name}`, name, color: TOOL_RESOURCE_COLOR, shapeName: name, ...resourceVisual(name) })),
    ];

    let physicsHandle = null;
    const feedback = el('p', { class: 'wb-feedback', role: 'status' });
    const executeDroppedAction = (actionId, clientX, clientY) => {
      document.body.classList.remove('wb-dragging');
      tableSurface?.classList.remove('drop-target');
      if (!actionId || !actions.some((action) => action.id === actionId)) return false;
      S.actionSlot = actionId;
      if (actionId === rule.action.id) {
        if (tableSurface.dataset.processing === 'true') return false;
        tableSurface.dataset.processing = 'true';
        feedback.className = 'wb-feedback ok';
        feedback.textContent = '动作已落到桌面，正在完成这道工序。';
        physicsHandle?.ripple(clientX, clientY);
        setTimeout(() => {
          if (tableSurface.isConnected) processStep(feedback, tableSurface, tableSurface);
        }, 520);
        return true;
      }
      processStep(feedback, tableSurface, tableSurface);
      return false;
    };

    const resourceObjectId = (name, kind) => kind === 'implement' ? `tool:${name}` : `material:${S.stepIndex}:${name}`;
    const seedDroppedResourcePosition = (name, kind, clientX, clientY) => {
      const rect = tableSurface.getBoundingClientRect();
      const nx = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
      const ny = Math.min(1, Math.max(0, (clientY - rect.top) / Math.max(1, rect.height)));
      S.workbenchPhysics.set(resourceObjectId(name, kind), {
        position: [-2.15 + nx * 3.8, 2.4, -0.9 + ny * 1.65],
        rotation: [0, nx * Math.PI, 0],
        velocity: [0, -0.12, 0],
      });
    };

    const beginPointerResourceDrag = (event, name, kind, card) => {
      if (event.button !== 0 || card.disabled || tableSurface.dataset.processing === 'true') return;
      rememberBackpackScroll(card);
      const startX = event.clientX;
      const startY = event.clientY;
      const pointerId = event.pointerId;
      let dragging = false;
      let ghost = null;
      const isOverTable = (clientX, clientY) => {
        const rect = tableSurface.getBoundingClientRect();
        return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
      };
      const cleanupDrag = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerCancel);
        try { card.releasePointerCapture?.(pointerId); } catch (_) {}
        ghost?.remove();
        card.classList.remove('is-pointer-dragging');
        tableSurface.classList.remove('drop-target');
        document.body.classList.remove('wb-dragging');
      };
      const onPointerMove = (moveEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        if (!dragging && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) >= 5) {
          dragging = true;
          card.dataset.suppressClick = 'true';
          card.classList.add('is-pointer-dragging');
          document.body.classList.add('wb-dragging');
          ghost = el('div', { class: 'action-drag-ghost resource-drag-ghost', text: name, 'aria-hidden': 'true' });
          document.body.appendChild(ghost);
        }
        if (!dragging) return;
        moveEvent.preventDefault();
        ghost.style.left = `${moveEvent.clientX}px`;
        ghost.style.top = `${moveEvent.clientY}px`;
        tableSurface.classList.toggle('drop-target', isOverTable(moveEvent.clientX, moveEvent.clientY));
      };
      const onPointerUp = (upEvent) => {
        if (upEvent.pointerId !== pointerId) return;
        const shouldDrop = dragging && isOverTable(upEvent.clientX, upEvent.clientY);
        cleanupDrag();
        if (shouldDrop) {
          S.selectedResources.add(name);
          seedDroppedResourcePosition(name, kind, upEvent.clientX, upEvent.clientY);
          renderPlay();
        }
        setTimeout(() => { delete card.dataset.suppressClick; }, 0);
      };
      const onPointerCancel = (cancelEvent) => {
        if (cancelEvent.pointerId === pointerId) cleanupDrag();
      };
      try { card.setPointerCapture?.(pointerId); } catch (_) {}
      window.addEventListener('pointermove', onPointerMove, { passive: false });
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerCancel);
    };

    const beginPointerActionDrag = (event, action, card) => {
      if (event.button !== 0 || tableSurface.dataset.processing === 'true') return;
      const startX = event.clientX;
      const startY = event.clientY;
      const pointerId = event.pointerId;
      let dragging = false;
      let ghost = null;

      const isOverTable = (clientX, clientY) => {
        const rect = tableSurface.getBoundingClientRect();
        return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
      };
      const moveGhost = (clientX, clientY) => {
        if (!ghost) return;
        ghost.style.left = `${clientX}px`;
        ghost.style.top = `${clientY}px`;
      };
      const cleanupDrag = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerCancel);
        try { card.releasePointerCapture?.(pointerId); } catch (_) {}
        ghost?.remove();
        card.classList.remove('is-pointer-dragging');
        tableSurface.classList.remove('drop-target');
        document.body.classList.remove('wb-dragging');
      };
      const onPointerMove = (moveEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        if (!dragging && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) >= 5) {
          dragging = true;
          card.dataset.suppressClick = 'true';
          card.classList.add('is-pointer-dragging');
          document.body.classList.add('wb-dragging');
          ghost = el('div', { class: 'action-drag-ghost', text: action.label, 'aria-hidden': 'true' });
          document.body.appendChild(ghost);
        }
        if (!dragging) return;
        moveEvent.preventDefault();
        moveGhost(moveEvent.clientX, moveEvent.clientY);
        tableSurface.classList.toggle('drop-target', isOverTable(moveEvent.clientX, moveEvent.clientY));
      };
      const onPointerUp = (upEvent) => {
        if (upEvent.pointerId !== pointerId) return;
        const shouldDrop = dragging && isOverTable(upEvent.clientX, upEvent.clientY);
        cleanupDrag();
        if (shouldDrop) executeDroppedAction(action.id, upEvent.clientX, upEvent.clientY);
        setTimeout(() => { delete card.dataset.suppressClick; }, 0);
      };
      const onPointerCancel = (cancelEvent) => {
        if (cancelEvent.pointerId === pointerId) cleanupDrag();
      };

      try { card.setPointerCapture?.(pointerId); } catch (_) {}
      window.addEventListener('pointermove', onPointerMove, { passive: false });
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerCancel);
    };

    tableSurface = el('div', {
      class: `wb-table-surface${tableObjects.length ? ' has-objects' : ''}`,
      'data-slot': 'resources',
      'aria-label': '桌面工作区',
      ondragover: (event) => {
        const types = [...(event.dataTransfer?.types || [])];
        if (types.length && !types.includes('text/plain') && !types.includes('text')) return;
        event.preventDefault();
        event.currentTarget.classList.add('drop-target');
      },
      ondragleave: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.classList.remove('drop-target');
      },
      ondrop: (event) => {
        event.preventDefault();
        document.body.classList.remove('wb-dragging');
        event.currentTarget.classList.remove('drop-target');
        const actionId = event.dataTransfer?.getData('text/plain');
        executeDroppedAction(actionId, event.clientX, event.clientY);
      },
    }, [
      el('div', { class: 'wb-table-head' }, [
        el('span', { class: 'wb-table-title', text: '桌面工作区' }),
        el('span', { class: 'wb-table-tip', text: tableObjects.length ? '拖动物体调整位置；点击物体重新落下' : '从左侧背包选择物品' }),
      ]),
      stepFloatingGuide(step, S.stepIndex, craft.steps.length),
    ]);

    let actionPalette;
    const actionCards = actions.map((action) => {
      let card;
      card = el('button', {
        class: `action-card${S.actionSlot === action.id ? ' selected' : ''}`,
        type: 'button', 'data-action': action.id, 'data-drag-mode': 'pointer',
        title: '按住并向左拖到桌面，松开即可执行',
        onpointerdown: (event) => beginPointerActionDrag(event, action, card),
        onclick: () => {
          if (card.dataset.suppressClick === 'true') {
            delete card.dataset.suppressClick;
            return;
          }
          S.actionSlot = action.id;
          [...actionPalette.querySelectorAll('.action-card')].forEach((node) => node.classList.toggle('selected', node.dataset.action === action.id));
          feedback.className = 'wb-feedback';
          feedback.textContent = '已选择动作，请按住动作卡并向左拖到桌面工作区执行。';
        },
      }, [el('span', { text: action.label })]);
      return card;
    });
    actionPalette = el('aside', { class: 'action-palette', 'aria-label': '动作列表' }, [
      el('p', { class: 'action-title', text: '动作' }),
      ...actionCards,
    ]);

    const progress = el('span', { class: 'wb-progress' }, craft.steps.map((s, i) =>
      el('i', { class: `pg${i < S.stepIndex ? ' done' : i === S.stepIndex ? ' now' : ''}`, title: s.displayName })));
    const documentary = documentaryPanel(step);
    const main = el('div', { class: `wb-main${documentary ? ' has-documentary' : ''}` }, [
      el('div', { class: 'wb-step-bar' }, [
        el('span', { class: 'cur', text: `当前工序 ${S.stepIndex + 1}/${craft.steps.length}：${step.displayName}` }),
        reviewTag(), progress,
      ]),
      el('div', { class: 'wb-stage-layout' }, [tableSurface, actionPalette, documentary]),
      feedback,
      el('div', { class: 'wb-actions' }, [
        el('button', { class: 'btn-quick-fill', text: '一键填入', title: '自动把当前步骤所需物品放到桌面', onclick: quickFillCurrentStep }),
        !documentary && step.evidence_ids?.length ? el('button', { class: 'btn-ghost', text: '查看纪录片证据', onclick: () => openEvidenceModal(craft, step.evidence_ids, { title: `证据 · ${step.displayName}` }) }) : null,
        el('span', { class: 'wb-note', text: '动作需要拖到桌面工作区后才会执行。' }),
      ]),
    ]);

    workbench.appendChild(el('div', { class: 'wb-play wb-play-physics' }, [backpack, main]));
    const savedBackpackScroll = S.backpackScrollByStep.get(backpackScrollKey) || 0;
    backpack.scrollTop = savedBackpackScroll;
    requestAnimationFrame(() => {
      backpack.scrollTop = savedBackpackScroll;
      if (!tableSurface.isConnected) return;
      try {
        physicsHandle = createWorkbenchSurface(tableSurface, tableObjects, { stateStore: S.workbenchPhysics });
        wbPreviewHandles.push(physicsHandle);
      } catch (error) {
        tableSurface.appendChild(el('p', { class: 'wb-table-error', text: '当前浏览器无法显示粒子桌面，请继续使用背包和动作。' }));
      }
    });
    syncAgentContext();
  }

  function fail(msg, feedback, conflictSlotEl) {
    S.failures++;
    feedback.className = 'wb-feedback err';
    feedback.textContent = msg;
    if (conflictSlotEl) {
      conflictSlotEl.classList.add('conflict');
      setTimeout(() => conflictSlotEl.classList.remove('conflict'), 600);
    }
    logAction(`操作未通过：${msg}`);
    const step = currentStep();
    if (S.failures === 2 && S.helpRefusedStep !== step.step_id) {
      jiaoToast('看起来有点卡住了。要看一条提示吗？', [
        { label: '查看线索', onClick: () => {
          feedback.className = 'wb-feedback';
          const groupCount = step.interactionRule.resource_groups.filter((group) => group.min > 0).length;
          feedback.textContent = `线索：当前工序需要完成 ${groupCount} 组资源选择，并匹配一个动作。先检查缺少的是材料还是动作。`;
        } },
        { label: '不用了', onClick: () => { S.helpRefusedStep = step.step_id; } },
      ]);
    } else if (S.failures === 3 && S.helpRefusedStep !== step.step_id) {
      jiaoToast('我可以讲解这一步的原理；有一段相关影像，可直接查看——操作仍然需要你自己完成。', [
        { label: '查看原理与证据', onClick: () => {
          feedback.className = 'wb-feedback';
          feedback.textContent = `原理：${step.action}`;
          openEvidenceModal(craft, step.evidence_ids.slice(0, 1), { title: `证据 · ${step.displayName}` });
        } },
        { label: '不用了', onClick: () => { S.helpRefusedStep = step.step_id; } },
      ]);
    }
  }

  function processStep(feedback, resourceSlotEl, actionSlotEl) {
    const step = currentStep();
    if (!step) return;
    const rule = step.interactionRule;
    const effectiveSelected = effectiveSelectedResources(step);
    const selected = [...effectiveSelected];
    if (rule.allowed_resources.length && !selected.length) {
      fail('请先选择这一步使用的材料或物件。可以多选。', feedback, resourceSlotEl);
      return;
    }
    if (!S.actionSlot) {
      fail('材料已经选好，还需要选择一个动作。', feedback, actionSlotEl);
      return;
    }

    const activeInherited = new Set(
      [...S.materialItems.values()]
        .filter((item) => materialTransformMap(step).has(item.currentName))
        .map((item) => item.currentName),
    );
    const extras = selected.filter((name) => !rule.allowed_resources.includes(name) && !activeInherited.has(name));
    if (extras.length) {
      const name = extras[0];
      const laterIdx = craft.steps.findIndex((s, i) => i > S.stepIndex && s.interactionRule.allowed_resources.includes(name));
      const earlierOk = craft.steps.some((s, i) => i < S.stepIndex && s.interactionRule.allowed_resources.includes(name));
      if (laterIdx !== -1) fail(`「${name}」属于后面的工序，当前步骤暂时不用。`, feedback, resourceSlotEl);
      else if (earlierOk) fail(`「${name}」已在前面的工序使用，当前步骤不需要再次选择。`, feedback, resourceSlotEl);
      else fail(`「${name}」与当前工序「${step.displayName}」不匹配。`, feedback, resourceSlotEl);
      return;
    }

    for (const group of rule.resource_groups) {
      const chosen = group.options.filter((name) => effectiveSelected.has(name));
      if (group.mode === 'all') {
        const missing = group.options.filter((name) => !effectiveSelected.has(name));
        if (missing.length) {
          fail(`还缺少${group.label}。请检查当前选择。`, feedback, resourceSlotEl);
          return;
        }
      } else if (chosen.length < group.min) {
        fail(`还需要从“${group.label}”中选择至少 ${group.min} 项。`, feedback, resourceSlotEl);
        return;
      }
      if (group.max != null && chosen.length > group.max) {
        fail(`“${group.label}”最多选择 ${group.max} 项。`, feedback, resourceSlotEl);
        return;
      }
    }

    if (S.actionSlot !== rule.action.id) {
      const chosenAction = craft.actions.find((action) => action.id === S.actionSlot)?.label || '当前动作';
      fail(`动作「${chosenAction}」不适用于当前工序。材料选择会保留，可以重新选择动作。`, feedback, actionSlotEl);
      return;
    }

    S.failures = 0;
    S.helpRefusedStep = null;
    for (const name of selected) {
      if (craft.resourceKinds.get(name) !== 'implement') S.resourceStates.set(name, 'mid');
    }
    logAction(`完成工序「${step.displayName}」：${selected.join(' + ') || '无需材料'} → ${rule.action.label}`, step.evidence_ids);
    // 本步新材料从被点击的那一刻起就拥有稳定身份；完成动作后沿用同一
    // Three.js 对象位置，仅升级名称、等级和颜色，不再生成“公共工序产物”。
    for (const name of selected) {
      if (craft.resourceKinds.get(name) === 'implement' || carriedMaterialFor(name)) continue;
      const itemId = `material:${S.stepIndex}:${name}`;
      S.materialItems.set(itemId, {
        id: itemId,
        originName: name,
        originStepId: step.step_id,
        lastUsedStepId: null,
        currentName: name,
        level: 0,
        color: RAW_RESOURCE_COLOR,
        ...resourceVisual(name, step),
      });
    }
    const transforms = materialTransformMap(step);
    const upgrades = [];
    for (const [itemId, item] of [...S.materialItems.entries()]) {
      const inputName = item.currentName;
      const mapping = transforms.get(inputName);
      // 没有映射表示材料仅暂存，不参与本步升级或消耗。
      if (!mapping) continue;
      // 明确保存为空表示本步消耗、无产物。
      const outputName = mapping.output_name;
      if (!outputName) {
        S.materialItems.delete(itemId);
        S.workbenchPhysics.delete(itemId);
        upgrades.push(`${inputName}（已消耗）`);
        continue;
      }
      item.level += 1;
      item.currentName = outputName;
      item.lastUsedStepId = step.step_id;
      item.color = materialLevelColor(item.id, item.level);
      Object.assign(item, resourceVisual(outputName, step));
      const physics = S.workbenchPhysics.get(itemId);
      if (physics) physics.velocity = [0, 0.18, 0];
      upgrades.push(`${inputName} → ${outputName}（${item.level}级）`);
    }
    [...S.selectedResources]
      .filter((name) => craft.resourceKinds.get(name) === 'implement')
      .forEach((name) => S.workbenchPhysics.delete(`tool:${name}`));
    S.stepIndex++;
    // Only warm the large finished asset when the visitor is approaching the
    // reveal. It stays out of the critical path for home, map and early steps.
    if (S.stepIndex >= Math.max(1, craft.steps.length - 1)) preloadFinished();
    S.selectedResources.clear();
    S.actionSlot = null;

    if (S.stepIndex >= craft.steps.length) {
      for (const name of craft.allResources) {
        if (craft.resourceKinds.get(name) !== 'implement') S.resourceStates.set(name, 'ready');
      }
      logAction('全部工序执行完成，可以完成作品');
      S.phase = 'finishing';
      renderFinishing();
      return;
    }

    renderPlay();
    const fb = workbench.querySelector('.wb-feedback');
    fb.className = 'wb-feedback ok';
    fb.append(
      el('span', { text: `完成「${step.displayName}」：${upgrades.join('；') || '本步没有材料变化'}。` }),
      el('button', {
        class: 'ev-link', text: '查看纪录片片段',
        onclick: () => openEvidenceModal(craft, step.evidence_ids, { title: `证据 · ${step.displayName}` }),
      }),
    );
    agent.say(`你完成了「${step.displayName}」。下一步是「${currentStep().displayName}」。`);
  }

  // --- 收尾：全部工序完成 → 一键完成作品 ---
  function renderFinishing() {
    clearWorkbench();
    const readyNames = craft.allResources.filter((n) => craft.resourceKinds.get(n) !== 'implement');
    workbench.appendChild(el('div', { class: 'wb-finishing' }, [
      el('div', { class: 'wb-step-bar' }, [
        el('span', { class: 'cur', text: `全部 ${craft.steps.length} 道工序已完成` }),
        reviewTag(),
      ]),
      el('div', { class: 'finish-ready' }, [
        el('h3', { text: '材料已处理完毕' }),
        el('div', { class: 'chip-row' }, readyNames.map((n) => el('span', { class: 'chip chip-ready', text: `${n} · 可装配` }))),
        el('p', { class: 'note', text: '接下来把加工好的材料做成成品：一段收束特效后，玉石质感的实体模型将在中央揭晓。' }),
        el('button', { class: 'btn btn-primary btn-finish', text: '完成作品', onclick: finishWork }),
      ]),
    ]));
    syncAgentContext();
  }

  function finishWork() {
    logAction('完成作品');
    S.phase = 'completed';
    renderComplete();
  }

  // --- 平面成品呈现（无成品模型 / 加载失败回退）：墨粒聚成影像 + 拖拽平移、滚轮缩放 ---
  function renderCompleteFlat(stageWrap) {
    const cv = el('canvas', { class: 'finish-flat-canvas', 'aria-label': '墨粒聚成的成品影像' });
    const pzWrap = el('div', { class: 'pz-wrap' });
    const pzInner = el('div', { class: 'pz-inner' }, [
      el('img', { src: craftAssetUrl(craft, craft.config.finishFrame), alt: `${craft.title}成品（纪录片关键帧）`, draggable: 'false' }),
    ]);
    pzWrap.appendChild(pzInner);
    stageWrap.append(cv, pzWrap, el('span', { class: 'stage-tip', text: '拖拽平移 · 滚轮缩放' }));

    const pz = { x: 0, y: 0, k: 1, dragging: false, sx: 0, sy: 0 };
    const applyPz = () => { pzInner.style.transform = `translate(${pz.x}px, ${pz.y}px) scale(${pz.k})`; };
    pzWrap.addEventListener('pointerdown', (e) => {
      pz.dragging = true; pz.sx = e.clientX - pz.x; pz.sy = e.clientY - pz.y;
      pzWrap.setPointerCapture(e.pointerId);
    });
    pzWrap.addEventListener('pointermove', (e) => {
      if (!pz.dragging) return;
      pz.x = e.clientX - pz.sx; pz.y = e.clientY - pz.sy; applyPz();
    });
    pzWrap.addEventListener('pointerup', () => { pz.dragging = false; });
    pzWrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      pz.k = Math.min(3, Math.max(0.5, pz.k * (e.deltaY < 0 ? 1.1 : 0.9)));
      applyPz();
    }, { passive: false });

    const field = new InkField(cv, { maxParticles: 1500 });
    fields.push(field);
    loadImage(craftAssetUrl(craft, craft.config.finishFrame)).then((img) => {
      const run = () => {
        field.resize();
        const pts = imageTargets(img, cv.clientWidth, cv.clientHeight, { maxPoints: 1300 });
        field.setTargets(pts.length ? pts : blotTargets(cv.clientWidth / 2, cv.clientHeight / 2, 150, 700), { scatterFirst: true });
        setTimeout(() => { pzWrap.classList.add('show'); field.scatter(); }, 2600);
      };
      requestAnimationFrame(run);
    }).catch(() => pzWrap.classList.add('show'));
  }

  function closeHeritageGraph() {
    const explorer = graphExplorer;
    const overlay = graphOverlay;
    graphExplorer = null;
    graphOverlay = null;
    document.body.classList.remove('heritage-graph-open');
    try { explorer?.dispose?.(); } catch (error) { console.warn('知识图谱资源释放失败', error); }
    overlay?.remove();
    const restoreFocus = graphReturnFocus;
    graphReturnFocus = null;
    window.__gestureSystem?.unregisterViewContext?.('craft-graph');
    requestAnimationFrame(() => {
      registerGestureFinishedModel();
      registerGestureScrollZones();
      restoreFocus?.focus?.();
    });
  }

  function openHeritageGraph() {
    if (graphOverlay) return;
    const state = createHeritageGraphState(graphId('heritage', craft.craftId));
    if (!state.root) return;
    graphReturnFocus = document.activeElement;
    const graphHeading = el('h1', { id: 'heritage-graph-heading', text: state.root.title });
    const subtitle = el('p', { class: 'heritage-graph-subtitle', text: '选择一条关系继续探索' });
    const trail = el('nav', { class: 'heritage-graph-trail', 'aria-label': '知识图谱路径' });
    const info = el('aside', { class: 'heritage-graph-info', 'aria-live': 'polite' });
    const canvasHost = el('div', { class: 'heritage-graph-stage', 'aria-label': '知识图谱三维舞台' });
    const closeButton = el('button', { class: 'heritage-graph-close', type: 'button', 'aria-label': '关闭知识图谱', text: '返回完成品' });
    const overlay = el('section', {
      class: 'heritage-graph-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'heritage-graph-heading',
    }, [
      el('div', { class: 'heritage-graph-wash', 'aria-hidden': 'true' }),
      el('header', { class: 'heritage-graph-header' }, [
        el('div', { class: 'heritage-graph-heading' }, [
          el('span', { class: 'heritage-graph-kicker', text: '非遗知识图谱' }),
          graphHeading,
          subtitle,
        ]),
        closeButton,
      ]),
      trail,
      canvasHost,
      info,
      el('p', { class: 'heritage-graph-hint', text: '拖拽旋转 · 滚轮缩放 · 点击节点查看资料', 'aria-hidden': 'true' }),
    ]);
    graphOverlay = overlay;
    document.body.appendChild(overlay);
    document.body.classList.add('heritage-graph-open');
    // Only the foreground Three.js scene may own a gesture drag session.
    window.__gestureSystem?.unregisterViewContext?.('craft-finished-model');
    closeButton.addEventListener('click', closeHeritageGraph);

    const renderTrail = (context) => {
      trail.innerHTML = '';
      (context.breadcrumbs || []).forEach((id, index) => {
        const isLast = index === context.breadcrumbs.length - 1;
        const node = index === 0 ? context.current_root : (index === context.breadcrumbs.length - 1 ? context.selected_node : null);
        trail.appendChild(el('span', { class: isLast ? 'is-current' : '', text: node?.title || id }));
        if (!isLast) trail.appendChild(el('span', { class: 'heritage-graph-trail-sep', text: '·', 'aria-hidden': 'true' }));
      });
    };
    const renderInfo = (context, selected = context.selected_node) => {
      info.innerHTML = '';
      if (!selected) return;
      const heading = el('div', { class: 'heritage-graph-info-head' }, [
        el('span', { class: `heritage-graph-type type-${selected.type}`, text: selected.type === 'heritage' ? '非遗项目' : selected.type === 'region' ? '地区' : selected.type === 'tradition' ? '传统' : '材料' }),
        el('h3', { text: selected.title }),
      ]);
      const summary = selected.summary
        ? el('p', { text: selected.summary })
        : el('p', { class: 'is-muted', text: '该节点的详细摘要与来源正在整理中。' });
      info.append(heading, selected.images?.length ? el('div', { class: 'heritage-graph-image-gallery' }, selected.images.slice(0, 8).map((image) => el('figure', { class: 'heritage-graph-image-card' }, [el('img', { src: image.image_url || image.url, alt: image.title || selected.title, loading: 'lazy' }), image.title || image.description ? el('figcaption', { text: image.title || image.description }) : null]))) : null, summary);
      if (context.mode === 'root') {
        info.appendChild(el('p', { class: 'heritage-graph-info-note', text: '中央节点是当前完成品。三个固定入口只显示已接入并附有来源的关系。' }));
      }
      if (context.mode === 'branch' && selected.type === 'heritage' && selected.id !== context.current_root?.id) {
        info.appendChild(el('button', {
          class: 'btn btn-primary heritage-graph-root-button', type: 'button', text: '以此项目继续探索',
          onclick: () => { graphExplorer?.setRoot(selected); renderGraphUI(); },
        }));
      }
      if (context.mode === 'branch') {
        if (context.previous_node && context.previous_node.id !== selected.id) info.appendChild(el('p', {
          class: 'heritage-graph-info-note', text: context.comparison_summary || (isContentReviewed() ? `与上一节点“${context.previous_node.title}”的关系资料正在整理。` : `与上一节点“${context.previous_node.title}”的关系资料待审核。`),
        }));
      }
      if (context.can_go_back && context.mode !== 'branch') {
        info.appendChild(el('button', {
          class: 'btn-ghost heritage-graph-back-button', type: 'button', text: '上一步',
          onclick: () => { graphExplorer?.goBack(); renderGraphUI(); },
        }));
      }
      if (context.initial_root?.id && context.current_root?.id !== context.initial_root.id) {
        info.appendChild(el('button', {
          class: 'btn-ghost heritage-graph-back-button', type: 'button', text: '返回最初作品',
          onclick: () => { graphExplorer?.returnInitial(); renderGraphUI(); },
        }));
      }
      const reviewLabel = selected.review_status === 'supported' ? '来源支持 · 待人工复核' : selected.review_status === 'verified' ? '已核验' : '';
      const sourceText = selected.source_ids?.length
        ? `${reviewLabel ? `${reviewLabel} · ` : ''}来源记录：${selected.source_ids.join('、')}`
        : '当前节点暂无来源链接。';
      info.appendChild(el('small', { class: 'heritage-graph-source', text: sourceText }));
      if (selected.source_url) info.appendChild(el('a', {
        class: 'ev-link heritage-graph-source-link', href: selected.source_url, target: '_blank', rel: 'noopener noreferrer',
        text: `查看来源：${selected.source_title || '公开资料'}`,
      }));
    };
    const renderGraphUI = () => {
      if (!graphExplorer) return;
      const context = graphExplorer.context();
      graphHeading.textContent = context.mode === 'branch' ? context.selected_node?.title || state.root.title : state.root.title;
      subtitle.textContent = context.mode === 'branch'
        ? `${context.relation_label || '关联项目'} · 当前关系下共 ${context.branch_total} 个节点`
        : '选择一条关系继续探索';
      renderTrail(context);
      renderInfo(context);
      syncAgentContext();
    };
    try {
      graphExplorer = mountHeritageGraph(canvasHost, state, {
        onSelect(selection) {
          if (selection?.unavailable) {
            info.innerHTML = '';
            info.append(
              el('h3', { text: selection.portal.label }),
              el('p', { class: 'is-muted', text: '目前资料中没有找到可公开展示的核验关系，暂不展开。' }),
            );
            return;
          }
          renderGraphUI();
        },
        onChange() { renderGraphUI(); },
      });
      registerGestureHeritageGraph();
      renderGraphUI();
      closeButton.focus();
    } catch (error) {
      info.appendChild(el('p', { class: 'is-muted', text: `星图暂时无法加载：${error.message || '浏览器不支持当前三维效果'}。你仍可以返回完成品。` }));
    }
  }

  // --- 完成态：墨粒外爆 → 成品三维墨点模型居中揭晓（弧线俯冲进场） ---
  function renderComplete() {
    clearWorkbench();
    body.classList.add('playing');
    body.classList.remove('reading-open');

    const modelSet = CRAFT_MODEL_PATHS[id] || (craft.config?.modelPath ? { finished: craft.config.modelPath } : null);
    const hasModel = !!(modelSet && modelSet.finished);

    // 中央主舞台：爆炸画布 + 成品模型舞台叠放
    const burstCv = el('canvas', { class: 'finish-burst', 'aria-hidden': 'true' });
    const ceremony = el('div', { class: 'finish-ceremony', role: 'status', 'aria-live': 'polite' }, [
      el('i', { class: 'finish-ceremony-ring ring-one', 'aria-hidden': 'true' }),
      el('i', { class: 'finish-ceremony-ring ring-two', 'aria-hidden': 'true' }),
      el('span', { class: 'finish-ceremony-seal', text: '成' }),
      el('strong', { text: '工艺收束 · 作品完成' }),
      el('span', { class: 'finish-ceremony-motes', 'aria-hidden': 'true' }, Array.from({ length: 12 }, (_, index) => el('i', { style: { '--i': index } }))),
    ]);
    const pmStage = hasModel ? el('div', { class: 'pm-stage finish-model', style: { opacity: '0' } }) : null;
    const graphEntry = el('button', {
      class: 'heritage-graph-entry', type: 'button', text: '点击完成品，探索知识图谱',
      onclick: openHeritageGraph,
    });
    const zoomControls = hasModel ? el('div', { class: 'pm-zoom-controls', 'aria-label': '模型缩放' }, [
      el('button', { type: 'button', text: '缩小', disabled: true, onclick: () => finishedModelHandle?.zoomBy(0.82) }),
      el('button', { type: 'button', text: '还原', disabled: true, onclick: () => finishedModelHandle?.resetZoom() }),
      el('button', { type: 'button', text: '放大', disabled: true, onclick: () => finishedModelHandle?.zoomBy(1.22) }),
    ]) : null;
    const stageWrap = el('div', { class: 'finish-stage' }, [burstCv, ceremony, ...(pmStage ? [pmStage, zoomControls] : []), graphEntry]);
    const stageCap = el('p', {
      class: 'pm-cap',
      text: hasModel
        ? (modelSet.pattern
          ? '玉石实体成品 · 花纹来自纪录片真实影像取样 · 表面墨粒缓慢下落 · 点击爆散'
          : '玉石实体成品 · 表面墨粒缓慢下落 · 拖拽旋转 · 滚轮缩放 · 点击爆散')
        : '墨粒聚成成品影像 · 拖拽平移 · 滚轮缩放',
    });
    stageWrap.addEventListener('click', (event) => {
      if (event.target.closest('button, .pm-zoom-controls')) return;
      if (event.target.closest('.pm-stage, .pz-wrap')) openHeritageGraph();
    });

    // 侧栏：代表影像 + 已核验的外部资料（置于主舞台侧边，不把模型挤离中心）
    const featuredFacts = (craft.externalFacts || [])
      .filter((fact) => fact.review_status === 'verified_external')
      .slice(0, 3);
    const side = el('aside', { class: 'complete-side' }, [
      el('h4', { text: '代表影像作品' }),
      ...craft.config.works.map((w) => {
        const ev = craft.evMap.get(w.evidenceId);
        return el('figure', {
          class: 'work-item', tabindex: '0', role: 'button',
          onclick: () => openEvidenceModal(craft, [w.evidenceId], { title: w.name }),
          onkeydown: (e) => { if (e.key === 'Enter') openEvidenceModal(craft, [w.evidenceId], { title: w.name }); },
        }, [
          el('img', { src: craftAssetUrl(craft, w.frame), alt: w.name, loading: 'lazy' }),
          el('figcaption', { class: 'wi-cap', text: `${w.name} · 来源：纪录片《${craft.title}》关键帧${ev ? `，时间码 ${evidenceTimecode(ev)}` : ''}` }),
        ]);
      }),
      ...(featuredFacts.length ? [
        el('h4', { text: '延伸资料', style: { marginTop: '20px' } }),
        ...featuredFacts.map((fact) => {
          const source = fact.sources?.[0];
          return el('article', { class: 'heritage-note' }, [
            el('div', { class: 'hn-head' }, [
              el('strong', { text: fact.topic || '项目资料' }),
              el('span', { class: 'tag tag-verified', text: `${fact.authority_tier || 'A'}级·已核验` }),
            ]),
            el('p', { text: fact.statement }),
            source ? el('a', {
              class: 'ev-link', href: source.url, target: '_blank', rel: 'noopener noreferrer',
              text: `${source.publisher} · 查看原文`,
            }) : null,
          ]);
        }),
      ] : []),
      el('div', { style: { marginTop: '16px' } }, [
        el('button', {
          class: 'btn-ghost', text: '重新体验',
          onclick: () => {
            S.phase = 'reading'; S.stepIndex = 0; S.failures = 0;
            S.selectedResources.clear(); S.materialItems.clear(); S.workbenchPhysics.clear(); S.actionSlot = null;
            craft.allResources.forEach((name) => S.resourceStates.set(name, 'raw'));
            body.classList.remove('playing');
            setWorkbenchBg(false);
            logAction('重新开始');
            renderPanels(); renderIdle();
          },
        }),
      ]),
    ]);

    workbench.appendChild(el('div', { class: 'wb-complete finish-v2' }, [
      el('div', { class: 'finish-main' }, [stageWrap, stageCap]),
      side,
    ]));

    // 1) 外爆：墨粒先在舞台中央聚成材料团，0.9s 后四散（渐隐自停）
    const burst = new InkField(burstCv, { maxParticles: 900 });
    fields.push(burst);
    requestAnimationFrame(() => {
      burst.resize();
      burst.setTargets(blotTargets(burstCv.clientWidth / 2, burstCv.clientHeight / 2, 60, 500));
      setTimeout(() => { if (burstCv.isConnected) burst.scatter(); }, 900);
    });
    setTimeout(() => ceremony.classList.add('is-leaving'), 1750);
    setTimeout(() => ceremony.remove(), 2550);

    // 2) 揭晓：外爆后成品模型居中 + 弧线俯冲进场（GLB 已预载，基本瞬时）
    //    药斑布：同一布面，进场后染色扫过（原料色 → 纪录片纹样取色）
    setTimeout(async () => {
      if (!stageWrap.isConnected) return;
      if (!hasModel) { renderCompleteFlat(stageWrap); return; }
      const h = await mountParticleModel(pmStage, modelSet.finished, () => {
        pmStage.remove();
        renderCompleteFlat(stageWrap);
        stageCap.textContent = '成品模型加载失败，已回退为平面呈现 · 拖拽平移 · 滚轮缩放';
      }, {
        detailMode: true,
        solidMode: true,
        particleFraction: 0.24,
        pointSize: 0.011,
        alpha: 0.72,
        flowSpeed: 0.016,
        diffuseSpeed: 0.006,
        dropRate: 0.34,
        ...(modelSet.pattern ? { tint: modelSet.rawTint, patternUrl: modelSet.pattern } : {}),
      });
      if (!h) return;
      finishedModelHandle = h;
      registerGestureFinishedModel();
      pmStage.setAttribute('role', 'button');
      pmStage.setAttribute('tabindex', '0');
      pmStage.setAttribute('aria-label', '打开三维非遗知识图谱');
      pmStage.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openHeritageGraph(); }
      });
      zoomControls.querySelectorAll('button').forEach((button) => { button.disabled = false; });
      pmStage.style.opacity = '1';
      h.playEnter();
      if (modelSet.pattern) setTimeout(() => h.playDyeSweep(2.8), 1500);
    }, 1400);

    logAction('完成作品，进入成果展示');
    agent.say('恭喜你完成了全部工序。成品已在中央展开；侧边可以查看代表影像和已经外部核验的延伸资料。');
    syncAgentContext();
  }

  // ---------- 小蕉挂载与互斥 ----------
  agent.mount();
  agent.setCraft(craft);
  agent.setHost({
    context() {
      const graphContext = graphExplorer?.context?.();
      return {
        route: `/craft/${encodeURIComponent(craft.craftId)}`,
        page_type: graphContext ? 'heritage_graph' : 'heritage_detail',
        current_root: { id: graphId('heritage', craft.craftId), type: 'heritage', title: craft.title, summary: craft.summary },
        ...(graphContext || {
          selected_node: { id: graphId('heritage', craft.craftId), type: 'heritage', title: craft.title, summary: craft.summary },
          visible_nodes: [], breadcrumbs: [graphId('heritage', craft.craftId)],
        }),
        history: S.log.slice(-8),
        available_actions: graphContext?.available_actions || ['get_current_context', 'search_graph', 'expand_branch', 'open_node', 'open_heritage_detail', 'open_region', 'go_back', 'return_to_root', 'focus_model', 'read_summary', 'stop_speaking', 'show_help'],
        context_revision: `craft:${craft.craftId}:${currentStep()?.step_id || 'idle'}:${S.log.length}:${graphContext?.selected_node?.id || ''}`,
      };
    },
    async openNode({ node_id }) {
      const parsed = parseGraphId(node_id);
      if (parsed?.type === 'heritage') { transitionTo(`#/craft/${encodeURIComponent(parsed.rawId)}`); return { ok: true, node_id }; }
      if (parsed?.type === 'region') { transitionTo('#/explore'); return { ok: true, node_id }; }
      if (['material', 'tradition'].includes(parsed?.type)) { transitionTo(`#/graph/${encodeURIComponent(node_id)}`); return { ok: true, node_id }; }
      throw Object.assign(new Error('当前页面暂不支持打开这种节点。'), { code: 'unsupported_node_type' });
    },
    async openHeritageDetail({ heritage_id }) { return this.openNode({ node_id: heritage_id }); },
    async setRootNode({ node_id }) { return this.openNode({ node_id }); },
    async openRegion() { transitionTo('#/explore'); return { ok: true }; },
    async expandBranch({ result }) {
      const region = result?.nodes?.find((node) => node.type === 'region');
      if (region) transitionTo('#/explore');
      return { ok: true };
    },
    async goBack() { transitionTo('#/explore'); return { ok: true }; },
    async returnToRoot() { return { ok: true }; },
    async focusModel() { closeHeritageGraph(); finishedModelHandle?.resetZoom?.(); return { ok: true }; },
    async readSummary() {
      const started = agent.speak(`${craft.title}。${String(craft.summary || '目前资料中没有找到项目摘要。').slice(0, 220)}`);
      return { ok: true, message: started ? '正在为你朗读项目摘要。' : '语音未开启；摘要已经显示在页面上。' };
    },
    async stopSpeaking() { agent.stopSpeaking(); return { ok: true }; },
    async setVoicePreferences(args) { return agent.setVoicePreferences(args); },
    async showHelp() { agent.say('当前可以说：展开位于、属于传统、使用材料，打开另一个项目，返回，回到完成品，或把项目摘要读给我听。'); return { ok: true }; },
  });
  agent.onToggle((open) => { if (open) collapsePanelsForAgent(); });
  syncAgentContext();

  // ---- 手势系统集成 ----
  function registerGestureHeritageGraph() {
    const gs = window.__gestureSystem;
    if (!gs || !graphExplorer) return;
    try {
      const adapter = graphExplorer.gestureAdapter?.();
      if (!adapter) return;
      gs.registerViewContext('craft-graph', {
        threeContexts: [{
          name: 'heritage-graph-3d',
          raycaster: adapter.raycaster,
          camera: adapter.camera,
          getTargets: () => adapter.getRaycastTargets(),
          getInteractiveGroups: () => adapter.getInteractiveGroups(),
          rendererDomElement: adapter.rendererDomElement,
          onHover: (group) => adapter.onHover(group),
          onHoverClear: () => adapter.onHoverClear(),
          onClick: (group) => adapter.onClick(group),
          onDragStart: () => {},
          onDragMove: (dx, dy) => adapter.onDragMove?.(dx, dy),
          onDragEnd: () => {},
          onZoom: (factor) => adapter.zoomBy?.(factor),
          isInteractive: (group) => adapter.isInteractive?.(group) ?? true,
        }],
      });
    } catch { /* gesture not available */ }
  }

  function registerGestureFinishedModel() {
    const gs = window.__gestureSystem;
    if (!gs || !finishedModelHandle || graphExplorer) return;
    try {
      const adapter = finishedModelHandle.gestureAdapter?.();
      if (!adapter) return;
      gs.registerViewContext('craft-finished-model', {
        threeContexts: [{
          name: 'particle-model-finished',
          raycaster: null,
          camera: null,
          getTargets: () => [],
          getInteractiveGroups: () => [],
          rendererDomElement: adapter.rendererDomElement,
          onClick: () => openHeritageGraph(),
          onDragStart: () => adapter.startDrag?.(),
          onDragMove: (dx, dy) => adapter.applyDrag(dx, dy),
          onDragEnd: () => adapter.endDrag(),
          onZoom: (factor) => adapter.zoomBy?.(factor),
        }],
      });
    } catch { /* gesture not available */ }
  }

  function registerGestureScrollZones() {
    const gs = window.__gestureSystem;
    if (!gs) return;
    gs.registerViewContext('craft-panels', {
      scrollZones: [
        { id: 'craft-reading-col', element: readingCol, options: { topZoneHeight: 60, bottomZoneHeight: 60 } },
      ],
    });
  }

  function unregisterGestureContexts() {
    const gs = window.__gestureSystem;
    if (!gs) return;
    gs.unregisterViewContext('craft-graph');
    gs.unregisterViewContext('craft-finished-model');
    gs.unregisterViewContext('craft-panels');
  }

  const onGestureReady = () => {
    registerGestureFinishedModel();
    registerGestureHeritageGraph();
    registerGestureScrollZones();
  };
  document.addEventListener('sh-crafted:gesture-ready', onGestureReady);
  cleanups.push(() => document.removeEventListener('sh-crafted:gesture-ready', onGestureReady));

  // Esc：先收小蕉，再收阅读面板，再从体验退回阅读，最后回地图
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    if (document.querySelector('.modal-mask')) return; // 弹窗自行处理
    if (graphOverlay) { closeHeritageGraph(); return; }
    if (agent.isOpen()) { agent.close(); body.classList.remove('panels-collapsed'); return; }
    if (body.classList.contains('reading-open')) { body.classList.remove('reading-open'); return; }
    if (S.phase === 'playing' || S.phase === 'finishing') {
      S.phase = 'reading';
      body.classList.remove('playing');
      setWorkbenchBg(false);
      renderPanels(); renderIdle();
      return;
    }
    transitionTo('#/explore');
  };
  document.addEventListener('keydown', onKey);
  cleanups.push(() => document.removeEventListener('keydown', onKey));

  renderPanels();
  renderIdle();
  registerGestureScrollZones();

  return {
    cleanup() {
      closeHeritageGraph();
      unregisterGestureContexts();
      cleanups.forEach((fn) => fn());
      fields.splice(0).forEach((f) => f.destroy());
      pmHandles.splice(0).forEach((h) => { try { h.dispose(); } catch (_) {} });
      wbPreviewHandles.splice(0).forEach((h) => { try { h.dispose(); } catch (_) {} });
      agent.unmount();
      ambientBloom.destroy();
      bg.destroy();
      unregisterPage('craft', page);
    },
  };
}
