// 地图探索：带真实厚度的 GLB 行政区块模型 + 平面示意地图兜底
// - 三维：悬停上浮 + 竹简浮层、点击下潜进入地区空间（空间地台 + 墨粒簇锚点）
// - 平面兜底：WebGL 或模型加载失败时自动切换，并给出提示
// - 搜索/类别筛选、地图/列表切换、Esc 返回在两种模式下均可用
import { el, reviewTag } from '../ui.js';
import { InkField, blotTargets, reducedMotion } from '../particles.js';
import { allCrafts, craftAssetUrl, siteText } from '../data.js';
import { DISTRICTS, DISTRICT_PROFILES } from '../config.js';
import { topNav, TRANSITION_STATES } from './home.js';
import { agent } from '../agent.js';
import { createMap3D } from '../map3d.js';
import { createLayerBG } from '../layerbg.js';
import { registerPage, unregisterPage, consumeEnter, transitionTo } from '../transitions.js';
import { saveCraft, saveDistrict, saveSiteTexts } from '../admin.js';
import { mountEditableModule } from '../editable.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// GLB 节点名（历史行政区划）→ 数据包地区 ID
// 注：象牙篾丝编织绑定到「上海市核心区」节点，归属仍为“地区待核对”（见 config.js）
const NODE_TO_DISTRICT = {
  '上海市核心区': 'jingan', '南汇区': 'nanhui', '嘉定区': 'jiading',
  '奉贤区': 'fengxian', '宝山区': 'baoshan', '崇明县': 'chongming',
  '松江区': 'songjiang', '浦东新区': 'pudong', '金山区': 'jinshan',
  '闵行区': 'minhang', '青浦区': 'qingpu',
};

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
  let mapBuildPromise = null;
  let listViewEl = null;
  let query = '';
  let category = '';
  const cleanups = [];
  let viewDisposed = false;
  let renderGeneration = 0;
  const exitingPanels = new Map();

  function removePanelWithMotion(node, immediate = false) {
    if (!node) return;
    const previous = exitingPanels.get(node);
    if (previous) {
      previous();
      return;
    }
    if (immediate || reducedMotion || viewDisposed || !node.isConnected) {
      node.remove();
      return;
    }

    let finished = false;
    let timer = 0;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      node.removeEventListener('animationend', onAnimationEnd);
      exitingPanels.delete(node);
      node.remove();
    };
    const onAnimationEnd = (event) => {
      if (event.target === node) finish();
    };
    exitingPanels.set(node, finish);
    node.addEventListener('animationend', onAnimationEnd);
    node.classList.add('is-exiting');
    timer = setTimeout(finish, 460);
  }

  function flushPanelExits() {
    [...exitingPanels.values()].forEach((finish) => finish());
  }

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
        const districtName = DISTRICT_PROFILES[g.dataset.district]?.name || '';
        const nameHit = query && query.split(/\s+/).every((term) => districtName.includes(term));
        const hit = (!query && !category) || nameHit || crafts.some(matches);
        g.style.opacity = hit ? '' : '0.18';
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
  function positionSlip(panel, container, pos) {
    if (!pos) return;
    const gap = 18;
    const pad = 12;
    const width = panel.offsetWidth || 270;
    const height = panel.offsetHeight || 180;
    let left = pos.x + gap;
    let top = pos.y + gap;
    if (left + width > container.clientWidth - pad) left = pos.x - width - gap;
    if (top + height > container.clientHeight - pad) top = pos.y - height - gap;
    panel.style.left = `${Math.max(pad, Math.min(left, container.clientWidth - width - pad))}px`;
    panel.style.top = `${Math.max(pad, Math.min(top, container.clientHeight - height - pad))}px`;
  }
  function showSlip(container, title, crafts, pos) {
    if (slipFor === title && slip?.isConnected) {
      positionSlip(slip, container, pos);
      return;
    }
    clearTimeout(slipTimer);
    slip?.remove();
    const panel = el('div', { class: 'slip-panel', role: 'status' }, [
      el('h4', { text: `${title} · 区域内容` }),
      ...(crafts.length ? crafts.map((c) => el('div', {
        class: 'slip-item',
      }, [
        el('span', { class: 'cn', text: c.title }),
        c.config.districtVerified ? null : el('span', { class: 'tag tag-pending', text: '地区待核对' }),
      ])) : [el('p', { class: 'slip-empty', text: '当前暂无接入项目' })]),
      el('p', { class: 'slip-note', text: '点击地图中的行政区，进入地区后再选择项目' }),
    ]);
    panel.addEventListener('mouseenter', () => clearTimeout(slipTimer));
    panel.addEventListener('mouseleave', scheduleSlipRemove);
    container.appendChild(panel);
    slip = panel;
    slipFor = title;
    positionSlip(panel, container, pos);
  }
  function hideSlip() { scheduleSlipRemove(); }

  function makeDistrictPanel(districtId, fallbackName, crafts, onBack) {
    const profile = DISTRICT_PROFILES[districtId] || {};
    const name = fallbackName === '上海市核心区'
      ? `上海市核心区（${(profile.name || '静安区').replace(/区$/, '')}项目）`
      : (profile.name || fallbackName);
    const nameText = el('h2', { text: name });
    const districtHeading = el('div', { class: 'district-story-heading' }, [
      el('p', { class: 'district-story-kicker', text: '地区探索' }),
      nameText,
    ]);
    mountEditableModule(districtHeading, [{ key: 'name', element: nameText }], (values) => saveDistrict(districtId, values));
    const pending = (label, key, value) => {
      const text = value
        ? el('p', { text: value })
        : el('p', { class: 'district-story-pending', text: '内容待补充' });
      const section = el('section', { class: 'district-story-section' }, [el('h3', { text: label }), text]);
      mountEditableModule(section, [{ key, element: text }], (values) => saveDistrict(districtId, values));
      return section;
    };
    const panel = el('aside', { class: 'district-story', 'aria-label': `${name}地区介绍` }, [
      el('button', { class: 'back-btn', onclick: onBack }, ['← 返回上海全景']),
      districtHeading,
      el('p', { class: 'district-story-count', text: `当前接入 ${crafts.length} 项非遗内容` }),
      pending('区名由来', 'origin', profile.origin),
      pending('地区特色', 'features', profile.features),
      pending('非遗概览', 'heritage_overview', profile.heritageOverview),
      profile.sourceUrl ? el('a', {
        class: 'district-story-source', href: profile.sourceUrl, target: '_blank', rel: 'noopener noreferrer',
        text: `资料来源：${profile.sourceLabel || '公开资料'}`,
      }) : null,
      el('p', {
        class: 'district-story-tip',
        text: crafts.length
          ? '点击地图上漂浮的非遗项目，在右侧查看项目介绍'
          : '当前暂无接入项目，可先浏览本区介绍。',
      }),
    ]);
    return panel;
  }

  let projectPanel = null;
  let projectPanelHost = null;
  function clearProjectPanel({ immediate = false } = {}) {
    const closingPanel = projectPanel;
    const closingHost = projectPanelHost;
    projectPanel = null;
    projectPanelHost = null;
    closingHost?.classList.remove('has-project-detail');
    removePanelWithMotion(closingPanel, immediate);
  }
  function showProjectPanel(host, craft) {
    // 项目间切换保留新面板的入场动画，但立即清理旧面板，避免两个可编辑模块重叠。
    clearProjectPanel({ immediate: true });
    projectPanelHost = host;
    host.classList.add('has-project-detail');
    const gallery = craft.config.works || [];
    const title = el('h2', { text: craft.title });
    const projectHeading = el('div', { class: 'project-story-heading' }, [title]);
    const summary = el('span', { text: craft.summary });
    const intro = el('section', { class: 'project-story-section' }, [
      el('h3', { text: '项目简介' }),
      el('p', {}, [summary, reviewTag()]),
    ]);
    const inheritButton = el('button', {
      class: 'btn btn-primary', text: siteText('craft.inherit_button', '成为传承人'),
      onclick: () => transitionTo(`#/craft/${craft.craftId}`),
    });
    projectPanel = el('aside', { class: 'project-story', 'aria-label': `${craft.title}项目介绍` }, [
      el('button', { class: 'project-story-close', text: '关闭', onclick: () => clearProjectPanel() }),
      el('p', { class: 'project-story-kicker', text: '非遗项目' }),
      projectHeading,
      el('p', { class: 'project-story-meta', text: `${craft.config.districtLabel || '地区待核对'} · ${craft.config.category || '类别待核对'}` }),
      el('div', { class: 'project-story-scroll' }, [
        intro,
        gallery.length ? el('section', { class: 'project-story-section' }, [
          el('h3', { text: '纪录片影像' }),
          el('div', { class: 'project-story-gallery' }, gallery.map((work) => el('figure', {}, [
            el('img', { src: craftAssetUrl(craft, work.frame), alt: work.name, loading: 'lazy' }),
            el('figcaption', { text: work.name }),
          ]))),
        ]) : null,
      ]),
      el('div', { class: 'project-story-action' }, [
        inheritButton,
      ]),
    ]);
    host.appendChild(projectPanel);
    mountEditableModule(projectHeading, [{ key: 'title', element: title }], (values) => saveCraft(craft.craftId, values));
    mountEditableModule(intro, [{ key: 'summary', element: summary }], (values) => saveCraft(craft.craftId, values));
    mountEditableModule(projectPanel.querySelector('.project-story-action'), [{ key: 'craft.inherit_button', element: inheritButton }], (values) => (
      saveSiteTexts([{ key: 'craft.inherit_button', content: values['craft.inherit_button'] }])
    ));
  }

  // ---------- 共享：墨粒簇锚点 ----------
  function makeCluster(craft, onSelect) {
    const anchor = el('div', { class: 'craft-anchor' });
    const cv = el('canvas', {
      width: '132', height: '106', 'aria-hidden': 'true',
      style: { width: '132px', height: '106px' },
    });
    const hit = el('button', {
      class: 'craft-anchor-hit', 'aria-label': `${craft.title}，点击查看项目介绍`,
    }, [
      el('span', { class: 'craft-anchor-visual' }, [
        cv,
        el('img', { src: craftAssetUrl(craft, craft.config.heroFrame), alt: `${craft.title}纪录片关键帧`, loading: 'lazy' }),
      ]),
      el('span', { class: 'anchor-name', text: craft.title }),
    ]);
    anchor.appendChild(hit);
    const field = new InkField(cv, { maxParticles: 130 });
    const gather = () => field.setTargets(blotTargets(66, 50, 38, 100));
    requestAnimationFrame(gather);

    const showTip = () => {
      field.setTargets(blotTargets(66, 50, 48, 110));
      anchor.classList.add('is-hovered');
    };
    const hideTip = () => { anchor.classList.remove('is-hovered'); gather(); };
    hit.addEventListener('mouseenter', showTip);
    hit.addEventListener('mouseleave', hideTip);
    hit.addEventListener('focus', showTip);
    hit.addEventListener('blur', hideTip);
    hit.addEventListener('click', (event) => { event.stopPropagation(); onSelect(craft); });
    return { el: anchor, field };
  }

  // ============================================================
  // 三维地图
  // ============================================================
  let focusOverlay = null;
  let focusAnchors = [];   // { el, world, field }
  let focusPanel = null;

  function exitFocus3D(silent, immediate = false) {
    clearProjectPanel({ immediate });
    if (focusOverlay) {
      focusOverlay.remove(); focusOverlay = null;
      focusAnchors.forEach((a) => a.field.destroy());
      focusAnchors = [];
    }
    const closingFocusPanel = focusPanel;
    focusPanel = null;
    removePanelWithMotion(closingFocusPanel, immediate);
    mapViewEl?.classList.remove('is-district-focus');
    if (!silent) map3d?.exitFocus();
  }

  function enterFocus3D(nodeName) {
    const crafts = nodeCrafts(nodeName);
    exitFocus3D(true, true);
    hideSlip(); slip?.remove(); slip = null; slipFor = null;
    map3d.focusDistrict(nodeName);
    const districtId = NODE_TO_DISTRICT[nodeName];
    mapViewEl.classList.add('is-district-focus');
    focusPanel = makeDistrictPanel(districtId, nodeName, crafts, () => exitFocus3D());
    mapViewEl.appendChild(focusPanel);

    const wrap3d = mapViewEl.querySelector('.map3d-wrap');
    focusOverlay = el('div', { class: 'map3d-focus-overlay' });
    wrap3d.appendChild(focusOverlay);
    focusOverlay.addEventListener('click', (e) => {
      if (e.target !== focusOverlay) return;
      if (projectPanel) clearProjectPanel();
      else exitFocus3D();
    });

    crafts.forEach((c, i) => {
      const cluster = makeCluster(c, (craft) => showProjectPanel(mapViewEl, craft));
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
      const instance = await createMap3D(wrap3d, {
        isLive: (name) => nodeCrafts(name).length > 0,
        craftCount: (name) => nodeCrafts(name).length,
        onHover(name, pos) {
          if (!name || !pos) { hideSlip(); return; }
          const crafts = nodeCrafts(name);
          showSlip(wrap3d, name, crafts, pos);
        },
        onSelect(name) { enterFocus3D(name); },
        onBlank() { exitFocus3D(); },
        onFrame(project) {
          // GLB 锚点位于区块顶面上方；将卡片的视觉重心下沉，使图片底缘贴近地图表面。
          const surfaceOffset = Math.max(12, Math.min(24, wrap3d.clientHeight * 0.03));
          for (const a of focusAnchors) {
            if (!a.world) continue;
            const p = project(a.world);
            a.el.style.left = `${p.x}px`;
            a.el.style.top = `${p.y + surfaceOffset}px`;
            a.el.style.opacity = p.behind ? '0' : '1';
          }
        },
      });
      if (viewDisposed || !container.isConnected) {
        instance.dispose();
        return;
      }
      map3d = instance;
      if (mode !== 'map') map3d.setActive(false);
      wrap3d.querySelector('.map3d-loading')?.remove();
      container.appendChild(el('p', { class: 'map-caption', text: '三维模型为项目提供的行政区块模型，节点沿用模型中的历史名称（上海市核心区、南汇区、崇明县等）· 所有上海区块均可点击查看地区介绍' }));
      container.appendChild(el('div', { class: 'map-legend', role: 'note' }, [
        el('span', { class: 'li' }, [el('i', { class: 'swatch live' }), '已有项目']),
        el('span', { class: 'li' }, [el('i', { class: 'swatch empty' }), '暂无项目（仍可查看地区）']),
        el('span', { class: 'li' }, [el('span', { class: 'dot-demo' }, [el('i'), el('i'), el('i')]), '地区边缘粒子瀑布']),
      ]));
      applyFilter();
      if (enterOnce) { map3d.playEnter(); enterOnce = false; } // 转场进场：弧线俯冲到用户面前
    } catch (err) {
      if (viewDisposed || !container.isConnected) return;
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
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', live ? `${d.name}，${crafts.length} 门工艺` : `${d.name}，暂无接入项目，可查看地区介绍`);

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
      sub.textContent = live ? `${crafts.length} 门工艺` : '暂无接入项目';
      g.appendChild(sub);

      const enter = (event) => {
        stage.classList.add('dimmed');
        g.classList.add('hover');
        const rect = stage.getBoundingClientRect();
        const targetRect = g.getBoundingClientRect();
        const pos = event?.clientX != null
          ? { x: event.clientX - rect.left, y: event.clientY - rect.top }
          : { x: targetRect.left + targetRect.width / 2 - rect.left, y: targetRect.top + targetRect.height / 2 - rect.top };
        showSlip(stage, d.name, crafts, pos);
      };
      const leave = () => {
        stage.classList.remove('dimmed');
        g.classList.remove('hover');
        hideSlip();
      };
      g.addEventListener('mouseenter', enter);
      g.addEventListener('pointermove', enter);
      g.addEventListener('mouseleave', leave);
      g.addEventListener('focus', enter);
      g.addEventListener('blur', leave);
      g.addEventListener('click', () => enterFlatFocus(d, stage));
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter') enterFlatFocus(d, stage); });
      svg.appendChild(g);
    }
    svg.addEventListener('click', (e) => { if (e.target === svg) exitFlatFocus(); });

    if (notice) container.appendChild(el('p', { class: 'map-caption', text: notice, style: { color: 'var(--terracotta)' } }));
    container.appendChild(stage);
    container.appendChild(el('p', { class: 'map-caption', text: '行政区轮廓为示意，待接入真实边界数据 · 区块上的墨点密度对应该区已接入的项目数' }));
    container.appendChild(el('div', { class: 'map-legend', role: 'note' }, [
      el('span', { class: 'li' }, [el('i', { class: 'swatch live' }), '已有数据接入（可交互）']),
      el('span', { class: 'li' }, [el('i', { class: 'swatch empty' }), '暂无项目（仍可查看地区）']),
      el('span', { class: 'li' }, [el('span', { class: 'dot-demo' }, [el('i'), el('i'), el('i')]), '墨点密度 ∝ 项目数']),
    ]));
    applyFilter();
  }

  function enterFlatFocus(d, stage) {
    exitFlatFocus(true);
    stage.classList.add('focusing');
    stage.querySelectorAll('.district').forEach((g) => g.classList.toggle('focused', g.dataset.district === d.id));
    slip?.remove(); slip = null; slipFor = null;

    const crafts = districtCrafts(d.id);
    const platform = el('div', { class: 'focus-platform' }, [
      el('span', { class: 'platform-label', text: d.name }),
      el('span', { class: 'platform-note', text: '空间地台为平面占位 · 项目位置为策展空间位置，非实际地址' }),
    ]);
    for (const c of crafts) {
      const cluster = makeCluster(c, (craft) => showProjectPanel(flatFocusEl, craft));
      cluster.el.style.left = `${c.config.anchor.x * 100}%`;
      cluster.el.style.top = `${c.config.anchor.y * 100}%`;
      platform.appendChild(cluster.el);
      flatFocusFields.push(cluster.field);
    }
    platform.addEventListener('click', (e) => {
      if (e.target !== platform) return;
      if (projectPanel) clearProjectPanel();
      else exitFlatFocus();
    });
    flatFocusEl = el('div', { class: 'district-focus' }, [
      makeDistrictPanel(d.id, d.name, crafts, () => exitFlatFocus()),
      el('div', { class: 'flat-focus-map' }, [platform]),
    ]);
    stageWrap.appendChild(flatFocusEl);
  }

  function exitFlatFocus(immediate = false) {
    if (!flatFocusEl) return;
    clearProjectPanel({ immediate });
    const closingFlatFocus = flatFocusEl;
    flatFocusEl = null;
    removePanelWithMotion(closingFlatFocus, immediate);
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
          el('img', { src: craftAssetUrl(c, c.config.heroFrame), alt: `${c.title}纪录片关键帧`, loading: 'lazy' }),
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
    if (mapBuildPromise) return mapBuildPromise;
    mapViewEl = el('div', { class: 'map-view' });
    mapHolder.appendChild(mapViewEl);
    mapBuildPromise = renderMap3D(mapViewEl);
    return mapBuildPromise;
  }

  async function render() {
    const generation = ++renderGeneration;
    exitFocus3D(true, true);
    // 列表切换会清除视觉聚焦，也必须同步重置 three.js 内部状态，否则射线选择保持禁用。
    map3d?.exitFocus();
    exitFlatFocus(true);
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
    if (viewDisposed || generation !== renderGeneration || mode !== 'map') return;
    map3d?.setActive(true);
  }

  // Esc 返回上一层状态
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    if (projectPanel) { clearProjectPanel(); return; }
    if (focusOverlay) { exitFocus3D(); return; }
    exitFlatFocus();
  };
  document.addEventListener('keydown', onKey);
  cleanups.push(() => document.removeEventListener('keydown', onKey));

  render();

  return {
    cleanup() {
      viewDisposed = true;
      renderGeneration++;
      clearTimeout(slipTimer);
      slip?.remove(); slip = null; slipFor = null;
      cleanups.forEach((fn) => fn());
      exitFocus3D(true, true);
      exitFlatFocus(true);
      flushPanelExits();
      flatFocusFields.forEach((f) => f.destroy());
      map3d?.dispose();
      map3d = null;
      bg.destroy();
      unregisterPage('explore', wrap);
    },
  };
}
