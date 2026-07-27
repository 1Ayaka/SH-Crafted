// 地图探索：真实三维行政区块模型（FBX）+ 平面示意地图兜底
// - 三维：悬停上浮 + 竹简浮层、点击下潜进入地区空间（空间地台 + 墨粒簇锚点）
// - 平面兜底：WebGL 或模型加载失败时自动切换，并给出提示
// - 搜索/类别筛选、地图/列表切换、Esc 返回在两种模式下均可用
import { el, reviewTag } from '../ui.js';
import { InkField, blotTargets, reducedMotion } from '../particles.js';
import { allCrafts } from '../data.js';
import { DISTRICTS } from '../config.js';
import { topNav, TRANSITION_STATES } from './home.js';
import { agent } from '../agent.js';
import { createMap3D } from '../map3d.js';
import { createLayerBG } from '../layerbg.js';
import { registerPage, unregisterPage, consumeEnter, transitionTo } from '../transitions.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// FBX 节点名（历史行政区划）→ 数据包地区 ID
// 注：象牙篾丝编织绑定到「上海市核心区」节点，归属仍为“地区待核对”（见 config.js）
const NODE_TO_DISTRICT = { '嘉定区': 'jiading', '奉贤区': 'fengxian', '上海市核心区': 'jingan' };

function nodeCrafts(nodeName) {
  const did = NODE_TO_DISTRICT[nodeName];
  return did ? allCrafts().filter((c) => c.config.districtId === did) : [];
}
function districtCrafts(districtId) {
  return allCrafts().filter((c) => c.config.districtId === districtId);
}

export async function exploreView(root) {
  let mode = 'map';
  let map3d = null;
  let mapViewEl = null;      // 地图视图容器（三维或平面，只构建一次）
  let mapInit = false;
  let listViewEl = null;
  let query = '';
  let category = '';
  const strayFields = [];    // 兜底清理用
  const cleanups = [];

  // map_enter：来自首页穿越转场时播放进场（分层背景深层淡入 + 相机俯冲）
  let enterOnce = consumeEnter();

  // t02 分层背景（与首页同一管线，独立 manifest）；fixed 定位铺满长页面
  const bg = await createLayerBG('assets/bg2/manifest.json', {
    scrim: 'top', enter: enterOnce, parallax: true, fixed: true,
  });

  const wrap = el('section', { class: 'view explore' }, [topNav('explore')]);
  if (enterOnce) wrap.classList.add(TRANSITION_STATES.MAP_ENTER);
  wrap.appendChild(bg.el);
  const stageWrap = el('div', { class: 'stage-wrap' });
  wrap.appendChild(stageWrap);
  root.appendChild(wrap);

  // 登记到跨页转场系统（离场时前排图层穿越、UI 淡出）
  registerPage('explore', {
    root: wrap,
    bg,
    fadeUI() {
      wrap.querySelectorAll('.topnav, .stage-wrap').forEach((n) => n.classList.add('ui-fade'));
    },
  });

  agent.unmount(); // 地图页默认不出现小蕉（产品大纲 §9.2）

  // ---------- 工具栏 ----------
  const search = el('input', {
    type: 'search', placeholder: '搜索工艺或地区…', 'aria-label': '搜索工艺或地区',
    oninput: () => { query = search.value.trim(); applyFilter(); if (mode === 'list') renderListView(); },
  });
  const catSel = el('select', {
    'aria-label': '按类别筛选',
    onchange: () => { category = catSel.value; applyFilter(); if (mode === 'list') renderListView(); },
  }, [
    el('option', { value: '', text: '全部类别' }),
    el('option', { value: '传统美术', text: '传统美术（待核对）' }),
    el('option', { value: '传统技艺', text: '传统技艺（待核对）' }),
  ]);
  const segMap = el('button', { class: 'on', text: '地图', onclick: () => setMode('map') });
  const segList = el('button', { text: '列表', onclick: () => setMode('list') });
  const toolbar = el('div', { class: 'toolbar' }, [
    search, catSel,
    el('span', { class: 'seg', role: 'group', 'aria-label': '视图切换' }, [segMap, segList]),
    el('span', { class: 'small muted', text: '类别归属为策展配置，未经官方名录核对' }),
  ]);
  stageWrap.appendChild(toolbar);

  const mapHolder = el('div', {});
  stageWrap.appendChild(mapHolder);

  function setMode(m) {
    mode = m;
    segMap.classList.toggle('on', m === 'map');
    segList.classList.toggle('on', m === 'list');
    render();
  }

  function matches(craft) {
    if (category && craft.config.category !== category) return false;
    if (!query) return true;
    const hay = `${craft.title}${craft.config.districtLabel}${craft.summary}`;
    return query.split(/\s+/).every((q) => hay.includes(q));
  }

  function applyFilter() {
    if (map3d) {
      if (!query && !category) { map3d.setFilter(null); return; }
      map3d.setFilter((nodeName) => {
        const crafts = nodeCrafts(nodeName);
        if (query && nodeName.includes(query)) return true;
        return crafts.some(matches);
      });
    } else if (mapViewEl) {
      mapViewEl.querySelectorAll('.district').forEach((g) => {
        const crafts = districtCrafts(g.dataset.district);
        if (!crafts.length) return;
        g.style.opacity = crafts.some(matches) ? '' : '0.18';
      });
    }
  }

  // ---------- 共享：竹简浮层 ----------
  let slip = null;
  let slipTimer = null;
  let slipFor = null;
  function scheduleSlipRemove() {
    clearTimeout(slipTimer);
    slipTimer = setTimeout(() => { slip?.remove(); slip = null; slipFor = null; }, 220);
  }
  function showSlip(container, title, crafts, x, y) {
    if (slipFor === title && slip?.isConnected) return; // 同一区保持展开，不跟随鼠标重建
    clearTimeout(slipTimer);
    slip?.remove();
    const panel = el('div', { class: 'slip-panel', role: 'menu' }, [
      el('h4', { text: `${title} · 已接入项目` }),
      ...crafts.map((c) => el('button', {
        class: 'slip-item', role: 'menuitem',
        onclick: () => transitionTo(`#/craft/${c.craftId}`),
      }, [
        el('span', { class: 'cn', text: c.title }),
        c.config.districtVerified ? null : el('span', { class: 'tag tag-pending', text: '地区待核对' }),
      ])),
      el('p', { class: 'slip-note', text: '点击项目名称进入详情与工艺体验' }),
    ]);
    panel.addEventListener('mouseenter', () => clearTimeout(slipTimer));
    panel.addEventListener('mouseleave', scheduleSlipRemove);
    panel.style.left = Math.min(x + 14, Math.max(container.clientWidth - 320, 12)) + 'px';
    panel.style.top = Math.max(y - 40, 4) + 'px';
    container.appendChild(panel);
    slip = panel;
    slipFor = title;
  }
  function hideSlip() { scheduleSlipRemove(); }

  // ---------- 共享：墨粒簇锚点 ----------
  function makeCluster(craft, onNav) {
    const anchor = el('div', { class: 'craft-anchor' });
    const cv = el('canvas', {
      width: '150', height: '150', role: 'button', tabindex: '0',
      'aria-label': `${craft.title}，${craft.config.category}（待核对），点击进入详情`,
      style: { width: '150px', height: '150px' },
    });
    anchor.appendChild(cv);
    anchor.appendChild(el('span', { class: 'anchor-name', text: craft.title }));
    const field = new InkField(cv, { maxParticles: 130 });
    const gather = () => field.setTargets(blotTargets(75, 75, 44, 110));
    requestAnimationFrame(gather);

    let tip = null;
    const showTip = () => {
      tip?.remove();
      field.setTargets(blotTargets(75, 75, 58, 110));
      setTimeout(() => field.setTargets(blotTargets(75, 75, 34, 110)), 450);
      tip = el('div', { class: 'cluster-tip' }, [
        el('h4', { text: craft.title }),
        el('p', { class: 'cat-line' }, [
          el('span', { text: `类别：${craft.config.category || '待核对'} ` }),
          el('span', { class: 'tag tag-pending', text: '待核对' }),
          craft.config.districtVerified ? null : el('span', { class: 'tag tag-pending', text: ' 地区待核对' }),
        ]),
        el('p', {}, [el('span', { text: craft.summary.slice(0, 72) + '… ' }), reviewTag()]),
        el('p', { class: 'small muted', text: '点击进入详情与工艺体验', style: { marginTop: '8px' } }),
      ]);
      tip.style.left = '60px';
      tip.style.top = '-30px';
      anchor.appendChild(tip);
    };
    const hideTip = () => { tip?.remove(); tip = null; gather(); };
    cv.addEventListener('mouseenter', showTip);
    cv.addEventListener('mouseleave', hideTip);
    cv.addEventListener('focus', showTip);
    cv.addEventListener('blur', hideTip);
    cv.addEventListener('click', () => onNav(craft));
    cv.addEventListener('keydown', (e) => { if (e.key === 'Enter') onNav(craft); });
    return { el: anchor, field };
  }

  // ============================================================
  // 三维地图
  // ============================================================
  let focusOverlay = null;
  let focusAnchors = [];   // { el, world, field }
  let focusBar = null;

  function exitFocus3D(silent) {
    if (focusOverlay) {
      focusOverlay.remove(); focusOverlay = null;
      focusAnchors.forEach((a) => a.field.destroy());
      focusAnchors = [];
    }
    focusBar?.remove(); focusBar = null;
    if (!silent) map3d?.exitFocus();
  }

  function enterFocus3D(nodeName) {
    const crafts = nodeCrafts(nodeName);
    if (!crafts.length) return;
    exitFocus3D(true);
    hideSlip(); slip?.remove(); slip = null; slipFor = null;
    map3d.focusDistrict(nodeName);

    focusBar = el('div', { class: 'focus-bar' }, [
      el('button', { class: 'back-btn', onclick: () => exitFocus3D() }, ['← 返回上海全景']),
      el('span', { class: 'small muted', text: `正在探索 ${nodeName} · 空间地台 · Esc 返回 · 项目位置为策展空间位置，非实际地址` }),
    ]);
    mapViewEl.insertBefore(focusBar, mapViewEl.firstChild);

    const wrap3d = mapViewEl.querySelector('.map3d-wrap');
    focusOverlay = el('div', { class: 'map3d-focus-overlay' });
    wrap3d.appendChild(focusOverlay);
    focusOverlay.addEventListener('click', (e) => { if (e.target === focusOverlay) exitFocus3D(); });

    crafts.forEach((c, i) => {
      const cluster = makeCluster(c, () => transitionTo(`#/craft/${c.craftId}`));
      cluster.el.style.left = '50%';
      cluster.el.style.top = '45%';
      focusOverlay.appendChild(cluster.el);
      focusAnchors.push({
        el: cluster.el,
        field: cluster.field,
        world: map3d.districtAnchorWorld(nodeName, i, crafts.length),
      });
    });
  }

  async function renderMap3D(container) {
    const wrap3d = el('div', { class: 'map3d-wrap' }, [
      el('div', { class: 'map3d-loading' }, ['正在加载三维地图模型…']),
    ]);
    container.appendChild(wrap3d);
    try {
      map3d = await createMap3D(wrap3d, {
        isLive: (name) => nodeCrafts(name).length > 0,
        craftCount: (name) => nodeCrafts(name).length,
        onHover(name, pos) {
          if (!name || !pos) { hideSlip(); return; }
          const crafts = nodeCrafts(name);
          if (!crafts.length) { hideSlip(); return; }
          showSlip(wrap3d, name, crafts, pos.x, pos.y);
        },
        onSelect(name) { enterFocus3D(name); },
        onBlank() { exitFocus3D(); },
        onFrame(project) {
          for (const a of focusAnchors) {
            if (!a.world) continue;
            const p = project(a.world);
            a.el.style.left = `${p.x}px`;
            a.el.style.top = `${p.y}px`;
            a.el.style.opacity = p.behind ? '0' : '1';
          }
        },
      });
      wrap3d.querySelector('.map3d-loading')?.remove();
      container.appendChild(el('p', { class: 'map-caption', text: '三维模型为项目提供的行政区块模型，节点沿用模型中的历史名称（上海市核心区、南汇区、崇明县等）· 区块上方墨点密度 ∝ 该区已接入项目数' }));
      container.appendChild(el('div', { class: 'map-legend', role: 'note' }, [
        el('span', { class: 'li' }, [el('i', { class: 'swatch live' }), '已有数据接入（可交互）']),
        el('span', { class: 'li' }, [el('i', { class: 'swatch empty' }), '资料待接入']),
        el('span', { class: 'li' }, [el('span', { class: 'dot-demo' }, [el('i'), el('i'), el('i')]), '墨点密度 ∝ 项目数（大小/色泽变化与淡墨雾层为装饰）']),
      ]));
      applyFilter();
      if (enterOnce) { map3d.playEnter(); enterOnce = false; } // 转场进场：弧线俯冲到用户面前
    } catch (err) {
      console.warn('三维地图加载失败，切换平面示意地图：', err);
      map3d = null;
      container.innerHTML = '';
      renderFlatMap(container, '三维地图加载失败，已切换为平面示意地图。');
      if (enterOnce) {   // 平面兜底也有内容进场：轻微放大落定
        enterOnce = false;
        if (!reducedMotion) container.querySelector('.map-stage')?.classList.add('enter-pop');
      }
    }
  }

  // ============================================================
  // 平面示意地图（兜底）
  // ============================================================
  let flatFocusEl = null;
  let flatFocusFields = [];

  function renderFlatMap(container, notice) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 68');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', '上海行政区示意地图（非真实边界）');
    const stage = el('div', { class: 'map-stage' }, [svg]);

    for (const d of DISTRICTS) {
      const crafts = districtCrafts(d.id);
      const live = crafts.length > 0;
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', `district${live ? ' live' : ''}`);
      g.dataset.district = d.id;
      g.setAttribute('tabindex', live ? '0' : '-1');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', live ? `${d.name}，${crafts.length} 门工艺` : `${d.name}，资料待接入`);

      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', d.x); rect.setAttribute('y', d.y);
      rect.setAttribute('width', d.w); rect.setAttribute('height', d.h);
      rect.setAttribute('rx', d.r);
      rect.setAttribute('class', 'tile');
      g.appendChild(rect);

      if (live) {
        const dots = document.createElementNS(SVG_NS, 'g');
        dots.setAttribute('class', 'dots');
        for (let i = 0; i < crafts.length * 7; i++) {
          const c = document.createElementNS(SVG_NS, 'circle');
          c.setAttribute('cx', (d.x + 1.2 + Math.random() * (d.w - 2.4)).toFixed(2));
          c.setAttribute('cy', (d.y + 1.2 + Math.random() * (d.h - 3.4)).toFixed(2));
          c.setAttribute('r', (0.16 + Math.random() * 0.22).toFixed(2));
          dots.appendChild(c);
        }
        g.appendChild(dots);
      }

      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', d.x + d.w / 2);
      label.setAttribute('y', d.y + d.h - 1.6);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('class', 'dname');
      label.textContent = d.name;
      g.appendChild(label);

      const sub = document.createElementNS(SVG_NS, 'text');
      sub.setAttribute('x', d.x + d.w / 2);
      sub.setAttribute('y', d.y + (live ? 3 : d.h / 2 + 1));
      sub.setAttribute('text-anchor', 'middle');
      sub.setAttribute('class', 'dcount');
      sub.textContent = live ? `${crafts.length} 门工艺` : '资料待接入';
      g.appendChild(sub);

      if (live) {
        const enter = () => {
          stage.classList.add('dimmed');
          g.classList.add('hover');
          const stageRect = stage.getBoundingClientRect();
          showSlip(stage, d.name, crafts,
            (d.x + d.w) / 100 * stageRect.width,
            (d.y + d.h / 2) / 68 * (stageRect.width * 0.68));
        };
        const leave = () => {
          stage.classList.remove('dimmed');
          g.classList.remove('hover');
          hideSlip();
        };
        g.addEventListener('mouseenter', enter);
        g.addEventListener('mouseleave', leave);
        g.addEventListener('focus', enter);
        g.addEventListener('blur', leave);
        g.addEventListener('click', () => enterFlatFocus(d, stage));
        g.addEventListener('keydown', (e) => { if (e.key === 'Enter') enterFlatFocus(d, stage); });
      }
      svg.appendChild(g);
    }
    svg.addEventListener('click', (e) => { if (e.target === svg) exitFlatFocus(); });

    if (notice) container.appendChild(el('p', { class: 'map-caption', text: notice, style: { color: 'var(--terracotta)' } }));
    container.appendChild(stage);
    container.appendChild(el('p', { class: 'map-caption', text: '行政区轮廓为示意，待接入真实边界数据 · 区块上的墨点密度对应该区已接入的项目数' }));
    container.appendChild(el('div', { class: 'map-legend', role: 'note' }, [
      el('span', { class: 'li' }, [el('i', { class: 'swatch live' }), '已有数据接入（可交互）']),
      el('span', { class: 'li' }, [el('i', { class: 'swatch empty' }), '资料待接入']),
      el('span', { class: 'li' }, [el('span', { class: 'dot-demo' }, [el('i'), el('i'), el('i')]), '墨点密度 ∝ 项目数']),
    ]));
    applyFilter();
  }

  function enterFlatFocus(d, stage) {
    exitFlatFocus();
    stage.classList.add('focusing');
    stage.querySelectorAll('.district').forEach((g) => g.classList.toggle('focused', g.dataset.district === d.id));
    slip?.remove(); slip = null; slipFor = null;

    const crafts = districtCrafts(d.id);
    const platform = el('div', { class: 'focus-platform' }, [
      el('span', { class: 'platform-label', text: d.name }),
      el('span', { class: 'platform-note', text: '空间地台为平面占位 · 项目位置为策展空间位置，非实际地址' }),
    ]);
    for (const c of crafts) {
      const cluster = makeCluster(c, () => transitionTo(`#/craft/${c.craftId}`));
      cluster.el.style.left = `${c.config.anchor.x * 100}%`;
      cluster.el.style.top = `${c.config.anchor.y * 100}%`;
      platform.appendChild(cluster.el);
      flatFocusFields.push(cluster.field);
    }
    platform.addEventListener('click', (e) => { if (e.target === platform) exitFlatFocus(); });
    flatFocusEl = el('div', { class: 'district-focus' }, [
      el('div', { class: 'focus-head' }, [
        el('button', { class: 'back-btn', onclick: () => exitFlatFocus() }, ['← 返回上海全景']),
        el('span', { class: 'small muted', text: `正在探索 ${d.name} · Esc 返回` }),
      ]),
      platform,
    ]);
    stageWrap.appendChild(flatFocusEl);
  }

  function exitFlatFocus() {
    if (!flatFocusEl) return;
    flatFocusEl.remove(); flatFocusEl = null;
    flatFocusFields.forEach((f) => f.destroy());
    flatFocusFields = [];
    mapViewEl?.querySelector('.map-stage')?.classList.remove('focusing');
    mapViewEl?.querySelectorAll('.district').forEach((g) => g.classList.remove('focused'));
  }

  // ---------- 列表模式 ----------
  function renderListView() {
    listViewEl?.remove();
    const list = el('div', { class: 'craft-list' });
    const groups = new Map();
    for (const c of allCrafts().filter(matches)) {
      const key = c.config.districtLabel || '地区待核对';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    if (!groups.size) {
      list.appendChild(el('p', { class: 'empty-state', text: '没有符合筛选条件的项目 · 其他地区资料待接入' }));
    }
    for (const [dname, crafts] of groups) {
      list.appendChild(el('div', { class: 'district-group' }, [
        el('h3', { text: dname }),
        ...crafts.map((c) => el('article', {
          class: 'craft-card', tabindex: '0', role: 'link',
          onclick: () => transitionTo(`#/craft/${c.craftId}`),
          onkeydown: (e) => { if (e.key === 'Enter') transitionTo(`#/craft/${c.craftId}`); },
        }, [
          el('img', { src: c.baseUrl + c.config.heroFrame, alt: `${c.title}纪录片关键帧`, loading: 'lazy' }),
          el('div', { class: 'cc-body' }, [
            el('h4', { text: c.title }),
            el('p', { class: 'meta' }, [
              el('span', { text: `${c.config.districtLabel} · ${c.config.category} ` }),
              el('span', { class: 'tag tag-pending', text: '类别待核对' }),
              c.config.districtVerified ? null : el('span', { class: 'tag tag-pending', text: ' 地区待核对' }),
            ]),
            el('p', {}, [el('span', { text: c.summary.slice(0, 80) + '… ' }), reviewTag()]),
          ]),
        ])),
      ]));
    }
    listViewEl = list;
    mapHolder.appendChild(list);
  }

  // ---------- 视图调度 ----------
  async function ensureMapBuilt() {
    if (mapInit) return;
    mapInit = true;
    mapViewEl = el('div', { class: 'map-view' });
    mapHolder.appendChild(mapViewEl);
    await renderMap3D(mapViewEl);
  }

  async function render() {
    exitFocus3D(true);
    exitFlatFocus();
    slip?.remove(); slip = null; slipFor = null;
    if (mode === 'list') {
      map3d?.setActive(false);
      if (mapViewEl) mapViewEl.style.display = 'none';
      renderListView();
      return;
    }
    listViewEl?.remove(); listViewEl = null;
    if (mapViewEl) mapViewEl.style.display = '';
    await ensureMapBuilt();
    map3d?.setActive(true);
  }

  // Esc 返回上一层状态
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    if (focusOverlay) { exitFocus3D(); return; }
    exitFlatFocus();
  };
  document.addEventListener('keydown', onKey);
  cleanups.push(() => document.removeEventListener('keydown', onKey));

  render();

  return {
    cleanup() {
      cleanups.forEach((fn) => fn());
      exitFocus3D(true);
      flatFocusFields.forEach((f) => f.destroy());
      strayFields.splice(0).forEach((f) => f.destroy());
      map3d?.dispose();
      map3d = null;
      bg.destroy();
      unregisterPage('explore');
    },
  };
}
