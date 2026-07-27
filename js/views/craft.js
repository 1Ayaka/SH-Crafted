// 非遗详情 + 粒子工作台（核心页）
// 状态机：CRAFT_READING → CRAFT_PLAYING → finishing（一键完成作品）→ CRAFT_COMPLETED
// 规则判定全部来自 process_steps.jsonl（真实数据），失败分级提示，绝不自动完成
// 本页已接入跨页系统：assets/bg-crafts/<id>/ 分层背景 + 底层环境墨晕 + transitions 转场登记
// 工作台背景：assets/bg-workbench/（进入工作台时与工艺背景交叉淡融）
// 模型（config.CRAFT_MODEL_PATHS）：未开始态原料粒子模型；完成态成品居中揭晓（外爆 → 俯冲进场）
import { el, reviewTag, openEvidenceModal, jiaoToast } from '../ui.js';
import { InkField, blotTargets, imageTargets, loadImage } from '../particles.js';
import { getCraft, evidenceTimecode } from '../data.js';
import { MATERIAL_STATES, CRAFT_MODEL_PATHS } from '../config.js';
import { topNav } from './home.js';
import { agent } from '../agent.js';
import { createLayerBG } from '../layerbg.js';
import { createInkBloom } from '../inkbloom.js';
import { registerPage, unregisterPage, transitionTo, consumeEnter } from '../transitions.js';

export async function craftView(root, { id }) {
  const craft = getCraft(id);
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
    actionSlot: null,
    failures: 0,                 // 连续失败
    helpRefusedStep: null,
    log: [],                     // 操作回放
  };
  const fields = [];
  const cleanups = [];
  const pmHandles = [];          // 粒子模型句柄（clearWorkbench/cleanup 时 dispose）

  // ---------- 工艺专属分层背景 + 底层环境墨晕（与首页同一管线）----------
  const entering = consumeEnter();
  const bg = await createLayerBG(`assets/bg-crafts/${id}/manifest.json`, {
    scrim: 'left', enter: entering, parallax: true, fixed: true,
  });
  const ambientCanvas = el('canvas', { class: 'bg-bloom', 'aria-hidden': 'true', style: { zIndex: '1' } });
  bg.el.insertBefore(ambientCanvas, bg.layerEls[1] || null);
  bg.fadeEls.push(ambientCanvas);

  // ---------- 页面骨架 ----------
  const head = el('div', { class: 'craft-head' }, [
    el('button', { class: 'back-btn', onclick: () => transitionTo('#/explore') }, ['← 返回地图']),
    el('h2', { text: craft.title }),
    el('span', { class: 'meta' }, [
      el('span', { text: `${craft.config.districtLabel || '地区待核对'} · ${craft.config.category || '类别待核对'} ` }),
      el('span', { class: 'tag tag-pending', text: '类别待核对' }),
      craft.config.districtVerified ? null : el('span', { class: 'tag tag-pending', text: ' 地区待核对' }),
    ]),
    el('span', { class: 'spacer' }),
    el('a', { href: '#/passport', class: 'small', text: '数据护照 →' }),
  ]);

  const body = el('div', { class: 'craft-body' });
  const readingCol = el('div', { class: 'reading-col' });
  const workbench = el('div', { class: 'workbench-col' });
  const restoreBtn = el('button', {
    class: 'restore-handle', text: '展开资料',
    onclick: () => restorePanels(),
  });
  body.append(readingCol, restoreBtn, workbench);
  const page = el('section', { class: 'view craft-page' }, [bg.el, topNav('craft'), head, body]);
  root.appendChild(page);

  // ---------- 工作台专属分层背景（进入工作台时与工艺背景交叉淡融）----------
  const wbBg = await createLayerBG('assets/bg-workbench/manifest.json', {
    scrim: 'left', enter: false, parallax: false, drift: true, fixed: true,
  });
  wbBg.el.classList.add('wb-bg');
  page.appendChild(wbBg.el);        // 与工艺背景同 z-index，DOM 居后 → 叠于其上
  bg.fadeEls.push(wbBg.el);         // 离场转场时一并淡出

  // 工作台背景开关：工艺背景压暗、工作台背景淡入
  function setWorkbenchBg(on) {
    wbBg.el.classList.toggle('show', on);
    bg.el.classList.toggle('dimmed', on);
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
    const modelSet = CRAFT_MODEL_PATHS[id];
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
    frag.appendChild(el('p', {}, [el('span', { text: craft.summary + ' ' }), reviewTag()]));
    frag.appendChild(el('p', { class: 'small muted', text: '以上简介为 AI 从纪录片自动生成的草稿（summary_candidate），人工审核尚未完成。' }));
    frag.appendChild(el('h5', { text: '资料中的事实陈述（自动抽取）' }));
    if (!craft.claims.length) frag.appendChild(el('p', { class: 'empty-state', text: '资料待补充' }));
    for (const c of craft.claims) {
      frag.appendChild(el('div', { class: 'claim-item' }, [
        el('span', { text: c.statement + ' ' }),
        reviewTag(),
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
    frag.appendChild(el('h5', { text: '工序（顺序为候选顺序，待审核）' }));
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
          ? el('p', { class: 'st-meta', text: '交互规则由旧数据兼容生成，资源组合方式待人工审核。' })
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
    frag.appendChild(el('h5', { text: '资料中出现的人物' }));
    frag.appendChild(craft.people.length
      ? el('div', { class: 'chip-row' }, craft.people.map((p) => el('span', { class: 'chip', text: p })))
      : el('p', { class: 'empty-state', text: '资料待补充' }));
    frag.appendChild(el('p', { class: 'small muted', text: '人名来自 AI 转写实体识别，存在同音误识别风险，全部待审核。' }));
    frag.appendChild(el('h5', { text: '代表作品与器物' }));
    frag.appendChild(craft.artifacts.length
      ? el('div', { class: 'chip-row' }, craft.artifacts.map((a) => el('span', { class: 'chip', text: a })))
      : el('p', { class: 'empty-state', text: '资料待补充' }));
    frag.appendChild(el('h5', { text: '资料来源' }));
    frag.appendChild(el('p', { class: 'small', text: `纪录片《${craft.title}》（${craft.manifest.video.source_filename}）· 证据 ${craft.evidence.length} 段 · 全部由火山引擎视频理解自动抽取` }));
    frag.appendChild(el('p', {}, [reviewTag('全部内容待人工审核')]));
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
  function restorePanels() {
    body.classList.remove('panels-collapsed');
    if (S.phase !== 'reading') body.classList.add('reading-open');
    renderPanels();
    if (agent.isOpen()) agent.close();
  }

  // ---------- 右：工作台 ----------
  function currentStep() { return craft.steps[S.stepIndex] || null; }

  function syncAgentContext() {
    agent.setContext({
      page: 'craft_experience',
      current_step_id: currentStep()?.step_id || null,
      inventory_states: [...S.resourceStates.entries()].map(([name, st]) => ({
        name,
        state: craft.resourceKinds.get(name) === 'implement' ? '物件' : MATERIAL_STATES[st].label,
      })),
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
    workbench.innerHTML = '';
  }

  // --- 未开始：有模型展示原料三维墨点模型；无模型回退平面墨粒框 ---
  // 平面回退：粒子框 + 代表物（0002/0003 无模型，或模型加载失败时）
  function renderIdleFlat(noteText) {
    const frameWrap = el('div', { class: 'frame-wrap' }, [
      el('canvas', { 'aria-hidden': 'true' }),
      el('img', { src: craft.baseUrl + craft.config.heroFrame, alt: `${craft.title}代表物（纪录片关键帧）` }),
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
    const modelSet = CRAFT_MODEL_PATHS[id];
    if (!modelSet) {
      renderIdleFlat('三维模型待接入，暂以纪录片关键帧展示；建议先查看工序。');
      return;
    }
    // 未开始态：展示原材料三维墨点模型
    const stage = el('div', { class: 'pm-stage' });
    workbench.appendChild(el('div', { class: 'wb-idle' }, [
      stage,
      el('h3', { text: '粒子工作台' }),
      el('p', { class: 'note', text: '原料三维墨点模型 · 拖拽旋转 · 点击散墨；基于纪录片与审核资料简化，不构成真实工艺教学。' }),
      el('button', { class: 'btn btn-primary', text: '进入工作台', onclick: startPlay }),
    ]));
    mountParticleModel(stage, modelSet.raw,
      () => { clearWorkbench(); renderIdleFlat('模型加载失败，已回退为平面关键帧；建议先查看工序。'); },
      modelSet.rawTint != null ? { tint: modelSet.rawTint } : {});
  }

  function startPlay() {
    S.phase = 'playing';
    body.classList.add('playing');
    body.classList.remove('reading-open');
    setWorkbenchBg(true);       // 交叉淡融到工作台背景
    preloadFinished();          // 成品模型提前预载，完成时瞬时揭晓
    logAction('开始工艺体验');
    renderPlay();
  }

  // --- 加工进行 ---
  function renderPlay() {
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
        ? '候选资源来自旧数据兼容规则，组合关系待人工审核。'
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

    const feedback = el('p', { class: 'wb-feedback', role: 'status' });
    const canvasArea = el('div', { class: 'wb-canvas-area' }, [resourceSlotEl, actionSlotEl]);

    const progress = el('span', { class: 'wb-progress' }, craft.steps.map((s, i) =>
      el('i', { class: `pg${i < S.stepIndex ? ' done' : i === S.stepIndex ? ' now' : ''}`, title: s.displayName })));

    const main = el('div', { class: 'wb-main' }, [
      el('div', { class: 'wb-step-bar' }, [
        el('span', { class: 'cur', text: `当前工序 ${S.stepIndex + 1}/${craft.steps.length}：${step.displayName}` }),
        reviewTag(),
        progress,
      ]),
      canvasArea,
      feedback,
      el('div', { class: 'wb-actions' }, [
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
    const selected = [...S.selectedResources];
    if (!selected.length) {
      fail('请先选择这一步使用的材料或物件。可以多选。', feedback, resourceSlotEl);
      return;
    }
    if (!S.actionSlot) {
      fail('材料已经选好，还需要选择一个动作。', feedback, actionSlotEl);
      return;
    }

    const extras = selected.filter((name) => !rule.allowed_resources.includes(name));
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
      const chosen = group.options.filter((name) => S.selectedResources.has(name));
      if (group.mode === 'all') {
        const missing = group.options.filter((name) => !S.selectedResources.has(name));
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
    logAction(`完成工序「${step.displayName}」：${selected.join(' + ')} → ${rule.action.label}`, step.evidence_ids);
    S.stepIndex++;
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
      el('span', { text: `完成「${step.displayName}」：${selected.join('、')}，执行${rule.action.label}。` }),
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
        el('p', { class: 'note', text: '接下来把加工好的材料做成成品：墨粒外爆后，成品将以三维墨点模型在中央揭晓。' }),
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
      el('img', { src: craft.baseUrl + craft.config.finishFrame, alt: `${craft.title}成品（纪录片关键帧）`, draggable: 'false' }),
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
    loadImage(craft.baseUrl + craft.config.finishFrame).then((img) => {
      const run = () => {
        field.resize();
        const pts = imageTargets(img, cv.clientWidth, cv.clientHeight, { maxPoints: 1300 });
        field.setTargets(pts.length ? pts : blotTargets(cv.clientWidth / 2, cv.clientHeight / 2, 150, 700), { scatterFirst: true });
        setTimeout(() => { pzWrap.classList.add('show'); field.scatter(); }, 2600);
      };
      requestAnimationFrame(run);
    }).catch(() => pzWrap.classList.add('show'));
  }

  // --- 完成态：墨粒外爆 → 成品三维墨点模型居中揭晓（弧线俯冲进场） ---
  function renderComplete() {
    clearWorkbench();
    body.classList.add('playing');
    body.classList.remove('reading-open');

    const modelSet = CRAFT_MODEL_PATHS[id];
    const hasModel = !!(modelSet && modelSet.finished);

    // 中央主舞台：爆炸画布 + 成品模型舞台叠放
    const burstCv = el('canvas', { class: 'finish-burst', 'aria-hidden': 'true' });
    const pmStage = hasModel ? el('div', { class: 'pm-stage finish-model', style: { opacity: '0' } }) : null;
    const stageWrap = el('div', { class: 'finish-stage' }, [burstCv, ...(pmStage ? [pmStage] : [])]);
    const stageCap = el('p', {
      class: 'pm-cap',
      text: hasModel
        ? (modelSet.pattern
          ? '成品三维墨点模型 · 花纹来自纪录片真实影像取样 · 拖拽旋转 · 点击散墨'
          : '成品三维墨点模型 · 拖拽旋转 · 点击散墨')
        : '墨粒聚成成品影像 · 拖拽平移 · 滚轮缩放',
    });

    // 侧栏：代表作品 + 操作回看（置于主舞台侧边，不把模型挤离中心）
    const side = el('aside', { class: 'complete-side' }, [
      el('h4', { text: '代表作品 / 影像' }),
      ...craft.config.works.map((w) => {
        const ev = craft.evMap.get(w.evidenceId);
        return el('figure', {
          class: 'work-item', tabindex: '0', role: 'button',
          onclick: () => openEvidenceModal(craft, [w.evidenceId], { title: w.name }),
          onkeydown: (e) => { if (e.key === 'Enter') openEvidenceModal(craft, [w.evidenceId], { title: w.name }); },
        }, [
          el('img', { src: craft.baseUrl + w.frame, alt: w.name, loading: 'lazy' }),
          el('figcaption', { class: 'wi-cap', text: `${w.name} · 来源：纪录片《${craft.title}》关键帧${ev ? `，时间码 ${evidenceTimecode(ev)}` : ''}` }),
        ]);
      }),
      el('h4', { text: '操作回看', style: { marginTop: '18px' } }),
      ...S.log.map((l) => el('div', { class: 'replay-item' }, [
        el('span', { class: 'rt', text: `${String(l.t.getHours()).padStart(2, '0')}:${String(l.t.getMinutes()).padStart(2, '0')}:${String(l.t.getSeconds()).padStart(2, '0')}` }),
        el('span', { text: l.text + ' ' }),
        l.evidenceIds.length
          ? el('button', {
              class: 'ev-link', text: '证据',
              onclick: () => openEvidenceModal(craft, l.evidenceIds, { title: '证据 · 操作回放' }),
            })
          : null,
      ])),
      el('div', { style: { marginTop: '16px' } }, [
        el('button', {
          class: 'btn-ghost', text: '重新体验',
          onclick: () => {
            S.phase = 'reading'; S.stepIndex = 0; S.failures = 0;
            S.selectedResources.clear(); S.actionSlot = null;
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

    // 2) 揭晓：外爆后成品模型居中 + 弧线俯冲进场（GLB 已预载，基本瞬时）
    //    药斑布：同一布面，进场后染色扫过（原料色 → 纪录片纹样取色）
    setTimeout(async () => {
      if (!stageWrap.isConnected) return;
      if (!hasModel) { renderCompleteFlat(stageWrap); return; }
      const h = await mountParticleModel(pmStage, modelSet.finished, () => {
        pmStage.remove();
        renderCompleteFlat(stageWrap);
        stageCap.textContent = '成品模型加载失败，已回退为平面呈现 · 拖拽平移 · 滚轮缩放';
      }, modelSet.pattern ? { tint: modelSet.rawTint, patternUrl: modelSet.pattern } : {});
      if (!h) return;
      pmStage.style.opacity = '1';
      h.playEnter();
      if (modelSet.pattern) setTimeout(() => h.playDyeSweep(2.8), 1500);
    }, 1400);

    logAction('完成作品，进入成果展示');
    agent.say('恭喜你完成了全部工序。成品已在中央展开；侧边可以看到代表作品与影像来源，也可以打开「操作回看」。');
    syncAgentContext();
  }

  // ---------- 小蕉挂载与互斥 ----------
  agent.mount();
  agent.setCraft(craft);
  agent.onToggle((open) => { if (open) collapsePanelsForAgent(); });
  syncAgentContext();

  // Esc：先收小蕉，再收阅读面板，再从体验退回阅读，最后回地图
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    if (document.querySelector('.modal-mask')) return; // 弹窗自行处理
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

  return {
    cleanup() {
      cleanups.forEach((fn) => fn());
      fields.splice(0).forEach((f) => f.destroy());
      pmHandles.splice(0).forEach((h) => { try { h.dispose(); } catch (_) {} });
      agent.unmount();
      ambientBloom.destroy();
      wbBg.destroy();
      bg.destroy();
      unregisterPage('craft');
    },
  };
}
