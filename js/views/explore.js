// 地图探索：带真实厚度的 GLB 行政区块模型 + 平面示意地图兜底
// - 三维：悬停上浮 + 竹简浮层、点击下潜进入地区空间（空间地台 + 墨粒簇锚点）
// - 平面兜底：WebGL 或模型加载失败时自动切换，并给出提示
// - 搜索/类别筛选、地图/列表切换、Esc 返回在两种模式下均可用
import { el, reviewTag, jiaoToast } from '../ui.js';
import { InkField, blotTargets, reducedMotion } from '../particles.js';
import { allCrafts, craftAssetUrl, ensureCraftLoaded, siteText } from '../data.js';
import { DISTRICTS, DISTRICT_PROFILES } from '../config.js';
import { topNav, TRANSITION_STATES } from './home.js';
import { agent } from '../agent.js';
import { createMap3D } from '../map3d.js';
import { createLayerBG } from '../layerbg.js';
import { registerPage, unregisterPage, consumeEnter, transitionTo } from '../transitions.js';
import { saveCraft, saveDistrict } from '../admin.js';
import { mountEditableModule } from '../editable.js';
import { claimInheritor, engagementFor, inheritorButtonText, recordCraftView } from '../community.js';
import { graphId, parseGraphId } from '../agent/graph-adapter.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// GLB 节点名（历史行政区划）→ 数据包地区 ID
// 注：象牙篾丝编织绑定到「上海市核心区」节点，归属仍为“地区待核对”（见 config.js）
const NODE_TO_DISTRICT = {
  '上海市核心区': 'jingan', '南汇区': 'nanhui', '嘉定区': 'jiading',
  '奉贤区': 'fengxian', '宝山区': 'baoshan', '崇明县': 'chongming',
  '松江区': 'songjiang', '浦东新区': 'pudong', '金山区': 'jinshan',
  '闵行区': 'minhang', '青浦区': 'qingpu',
};

export async function exploreView(root) {
  const craftRecords = allCrafts();
  const craftsByDistrict = new Map();
  for (const craft of craftRecords) {
    const districtId = craft.config.districtId;
    if (!craftsByDistrict.has(districtId)) craftsByDistrict.set(districtId, []);
    craftsByDistrict.get(districtId).push(craft);
  }
  const districtCrafts = (districtId) => craftsByDistrict.get(districtId) || [];
  const nodeCrafts = (nodeName) => districtCrafts(NODE_TO_DISTRICT[nodeName]);
  let mode = 'map';
  let map3d = null;
  let mapViewEl = null;      // 地图视图容器（三维或平面，只构建一次）
  let mapBuildPromise = null;
  let gestureRegisterTimer = 0;
  let listViewEl = null;
  const LIST_PAGE_SIZE = 60;
  let listRenderLimit = LIST_PAGE_SIZE;
  let query = '';
  let category = '';
  let activeDistrictId = null;
  let selectedCraft = null;
  const explorationHistory = [];
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

  const wrap = el('section', { class: 'view explore is-map-mode' }, [topNav('explore')]);
  if (enterOnce) wrap.classList.add(TRANSITION_STATES.MAP_ENTER);
  wrap.appendChild(bg.el);
  const stageWrap = el('div', { class: 'stage-wrap' });
  wrap.appendChild(stageWrap);
  root.appendChild(wrap);

  // 登记到跨页转场系统（离场时前排图层穿越、UI 淡出）
  const transitionRegistration = {
    root: wrap,
    bg,
    fadeUI() {
      wrap.querySelectorAll('.topnav, .stage-wrap').forEach((n) => n.classList.add('ui-fade'));
    },
  };
  registerPage('explore', transitionRegistration);

  agent.unmount(); // 地图页默认不出现小蕉（产品大纲 §9.2）

  // ---------- 工具栏 ----------
  const search = el('input', {
    type: 'search', placeholder: '搜索工艺或地区…', 'aria-label': '搜索工艺或地区',
    oninput: () => { query = search.value.trim(); listRenderLimit = LIST_PAGE_SIZE; applyFilter(); if (mode === 'list') renderListView(); },
  });
  const segMap = el('button', { class: 'on', text: '地图', onclick: () => setMode('map') });
  const segList = el('button', { text: '列表', onclick: () => setMode('list') });
  const mapZoom = el('span', { class: 'map-zoom-controls', role: 'group', 'aria-label': '地图缩放' }, [
    el('button', { type: 'button', text: '缩小', onclick: () => map3d?.gestureAdapter?.().zoomBy(1.18) }),
    el('button', { type: 'button', text: '还原', onclick: () => map3d?.gestureAdapter?.().resetView() }),
    el('button', { type: 'button', text: '放大', onclick: () => map3d?.gestureAdapter?.().zoomBy(0.84) }),
  ]);
  let contributionDistrictId = '';
  const contributeButton = el('button', {
    class: 'toolbar-contribute', type: 'button', text: '添加文化遗产', hidden: true,
    onclick: () => {
      if (contributionDistrictId) location.hash = `#/contribute/${encodeURIComponent(contributionDistrictId)}`;
    },
  });
  function setContributionDistrict(districtId = '') {
    contributionDistrictId = districtId || '';
    contributeButton.hidden = !contributionDistrictId;
  }
  const toolbar = el('div', { class: 'toolbar' }, [
    search,
    el('span', { class: 'seg', role: 'group', 'aria-label': '视图切换' }, [segMap, segList]),
    mapZoom,
    contributeButton,
  ]);
  stageWrap.appendChild(toolbar);

  const mapHolder = el('div', { class: 'map-holder' });
  stageWrap.appendChild(mapHolder);

  function setMode(m) {
    mode = m;
    wrap.classList.toggle('is-map-mode', m === 'map');
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
    selectedCraft = craft;
    // The map only carries catalogue metadata. Warm this one package while the
    // visitor reads its introduction so opening the detail feels immediate.
    ensureCraftLoaded(craft.craftId).catch(() => {});
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
      el('p', {}, [summary, craft.config.community ? el('span', { class: 'tag tag-community', text: '社区审核通过' }) : reviewTag()]),
    ]);
    const inheritButton = el('button', { class: 'btn btn-primary', text: siteText('craft.inherit_button', '成为传承人') });
    const refreshInheritorLabel = (engagement) => {
      if (inheritButton.isConnected) inheritButton.textContent = inheritorButtonText(engagement);
    };
    recordCraftView(craft.craftId).then(refreshInheritorLabel).catch(() => {
      engagementFor(craft.craftId).then(refreshInheritorLabel).catch(() => {});
    });
    inheritButton.addEventListener('click', async () => {
      inheritButton.disabled = true;
      const previous = inheritButton.textContent;
      inheritButton.textContent = '正在登记…';
      try {
        const engagement = await claimInheritor(craft.craftId);
        refreshInheritorLabel(engagement);
        transitionTo(`#/craft/${craft.craftId}`);
      } catch {
        inheritButton.disabled = false;
        inheritButton.textContent = previous;
        jiaoToast('登记暂时失败，请检查网络后重试。');
      }
    });
    projectPanel = el('aside', { class: 'project-story', 'aria-label': `${craft.title}项目介绍` }, [
      el('button', { class: 'project-story-close', text: '关闭', onclick: () => clearProjectPanel() }),
      el('p', { class: 'project-story-kicker', text: '非遗项目' }),
      projectHeading,
      el('p', { class: 'project-story-meta' }, [
        document.createTextNode(`${craft.config.districtLabel || '地区待核对'} · ${craft.config.category || '类别待核对'} `),
        craft.config.community ? el('span', { class: 'tag tag-community', text: '社区共建' }) : null,
      ]),
      el('div', { class: 'project-story-scroll' }, [
        intro,
        gallery.length ? el('section', { class: 'project-story-section' }, [
          el('h3', { text: craft.config.community ? '社区资料图片' : '纪录片影像' }),
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
    registerGestureExploreScrollZones();
    mountEditableModule(projectHeading, [{ key: 'title', element: title }], (values) => saveCraft(craft.craftId, values));
    mountEditableModule(intro, [{ key: 'summary', element: summary }], (values) => saveCraft(craft.craftId, values));
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
        craft.config.heroFrame
          ? el('img', { src: craftAssetUrl(craft, craft.config.heroFrame), alt: `${craft.title}代表图片`, loading: 'lazy' })
          : el('span', { class: 'craft-anchor-placeholder', text: '社区条目' }),
      ]),
      el('span', { class: 'anchor-name', text: craft.title }),
    ]);
    anchor.appendChild(hit);
    const field = new InkField(cv, { maxParticles: 130 });
    const gather = () => field.setTargets(blotTargets(66, 50, 38, 100));
    requestAnimationFrame(gather);

    const showTip = () => {
      ensureCraftLoaded(craft.craftId).catch(() => {});
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
    setContributionDistrict();
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
    activeDistrictId = NODE_TO_DISTRICT[nodeName] || null;
    explorationHistory.push(graphId('region', activeDistrictId || nodeName));
    exitFocus3D(true, true);
    hideSlip(); slip?.remove(); slip = null; slipFor = null;
    map3d.focusDistrict(nodeName);
    const districtId = NODE_TO_DISTRICT[nodeName];
    setContributionDistrict(districtId);
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

    const visibleCrafts = crafts.slice(0, 36);
    visibleCrafts.forEach((c, i) => {
      const cluster = makeCluster(c, (craft) => showProjectPanel(mapViewEl, craft));
      cluster.el.style.left = '50%';
      cluster.el.style.top = '45%';
      focusOverlay.appendChild(cluster.el);
      focusAnchors.push({
        el: cluster.el,
        field: cluster.field,
        world: map3d.districtAnchorWorld(nodeName, i, visibleCrafts.length),
      });
    });
    if (crafts.length > visibleCrafts.length) focusOverlay.appendChild(el('p', {
      class: 'map-anchor-overflow',
      text: `本区另有 ${crafts.length - visibleCrafts.length} 项，请使用上方搜索或列表查看`,
    }));
  }

  async function renderMap3D(container) {
    const wrap3d = el('div', { class: 'map3d-wrap' }, [
      el('div', { class: 'map3d-loading', role: 'status' }, [
        el('div', { class: 'map-loading-silhouette', 'aria-hidden': 'true' }),
        el('p', { text: '正在准备三维地图' }),
        el('span', { text: '页面已经可以操作，地图就绪后会自动显示。' }),
        el('button', { class: 'btn-ghost', type: 'button', text: '先使用列表', onclick: () => setMode('list') }),
      ]),
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
          // 锚点的底缘贴住区块顶面；卡片本身向上展开，避免悬浮在地图上方。
          const surfaceOffset = Math.max(4, Math.min(8, wrap3d.clientHeight * 0.012));
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
        mapBuildPromise = null;
        return;
      }
      map3d = instance;
      if (mode !== 'map') map3d.setActive(false);
      registerGestureMap3D();
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
    activeDistrictId = d.id;
    explorationHistory.push(graphId('region', d.id));
    exitFlatFocus(true);
    stage.classList.add('focusing');
    stage.querySelectorAll('.district').forEach((g) => g.classList.toggle('focused', g.dataset.district === d.id));
    slip?.remove(); slip = null; slipFor = null;
    setContributionDistrict(d.id);

    const crafts = districtCrafts(d.id);
    const platform = el('div', { class: 'focus-platform' }, [
      el('span', { class: 'platform-label', text: d.name }),
      el('span', { class: 'platform-note', text: '空间地台为平面占位 · 项目位置为策展空间位置，非实际地址' }),
    ]);
    const visibleCrafts = crafts.slice(0, 36);
    for (const c of visibleCrafts) {
      const cluster = makeCluster(c, (craft) => showProjectPanel(flatFocusEl, craft));
      cluster.el.style.left = `${c.config.anchor.x * 100}%`;
      cluster.el.style.top = `${c.config.anchor.y * 100}%`;
      platform.appendChild(cluster.el);
      flatFocusFields.push(cluster.field);
    }
    if (crafts.length > visibleCrafts.length) platform.appendChild(el('p', {
      class: 'map-anchor-overflow',
      text: `本区另有 ${crafts.length - visibleCrafts.length} 项，请使用上方搜索或列表查看`,
    }));
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
    setContributionDistrict();
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
    const matchingCrafts = craftRecords.filter(matches);
    const visibleCrafts = matchingCrafts.slice(0, listRenderLimit);
    const groups = new Map();
    for (const c of visibleCrafts) {
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
          onclick: () => { void recordCraftView(c.craftId).catch(() => {}); transitionTo(`#/craft/${c.craftId}`); },
          onkeydown: (e) => { if (e.key === 'Enter') { void recordCraftView(c.craftId).catch(() => {}); transitionTo(`#/craft/${c.craftId}`); } },
        }, [
          c.config.heroFrame
            ? el('img', { src: craftAssetUrl(c, c.config.heroFrame), alt: `${c.title}代表图片`, loading: 'lazy' })
            : el('div', { class: 'craft-card-placeholder', text: '社区条目' }),
          el('div', { class: 'cc-body' }, [
            el('h4', { text: c.title }),
            el('p', { class: 'meta' }, [
              el('span', { text: `${c.config.districtLabel} · ${c.config.category} ` }),
              c.config.community
                ? el('span', { class: 'tag tag-community', text: '社区审核通过' })
                : el('span', { class: 'tag tag-pending', text: '类别待核对' }),
              c.config.districtVerified ? null : el('span', { class: 'tag tag-pending', text: ' 地区待核对' }),
            ]),
            el('p', {}, [el('span', { text: c.summary.slice(0, 80) + '… ' }), c.config.community ? null : reviewTag()]),
          ]),
        ])),
      ]));
    }
    if (visibleCrafts.length < matchingCrafts.length) list.appendChild(el('button', {
      class: 'btn-ghost craft-list-more', type: 'button',
      text: `继续加载（已显示 ${visibleCrafts.length}/${matchingCrafts.length}）`,
      onclick: () => { listRenderLimit += LIST_PAGE_SIZE; renderListView(); },
    }));
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

  // ---- 手势系统集成 ----
  function registerGestureMap3D() {
    const gs = window.__gestureSystem;
    if (!map3d || viewDisposed) return;
    if (!gs) {
      clearTimeout(gestureRegisterTimer);
      gestureRegisterTimer = window.setTimeout(registerGestureMap3D, 250);
      return;
    }
    clearTimeout(gestureRegisterTimer);
    gestureRegisterTimer = 0;
    try {
      const adapter = map3d.gestureAdapter?.();
      if (!adapter) return;
      gs.registerViewContext('explore-map3d', {
        threeContexts: [{
          name: 'map3d',
          raycaster: adapter.raycaster,
          camera: adapter.camera,
          getTargets: () => adapter.getRaycastTargets(),
          getInteractiveGroups: () => adapter.getDistrictNames(),
          rendererDomElement: adapter.rendererDomElement,
          onHover: (group, mesh) => adapter.onHover(mesh || group),
          onHoverClear: () => adapter.onHoverClear(),
          onClick: (group, mesh) => adapter.onClick(mesh || group),
          onDragStart: () => {},
          onDragMove: (dx, dy) => adapter.onDragMove?.(dx, dy),
          onDragEnd: () => {},
          onZoom: (factor) => adapter.zoomBy?.(factor),
          isInteractive: () => true,
        }],
      });
    } catch { /* gesture not available */ }
  }

  function registerGestureExploreScrollZones() {
    const gs = window.__gestureSystem;
    if (!gs) return;
    const projectScroll = projectPanel?.querySelector('.project-story-scroll');
    gs.registerViewContext('explore-panels', {
      scrollZones: [
        ...(projectScroll ? [{ id: 'explore-project-scroll', element: projectScroll, options: { topZoneHeight: 60, bottomZoneHeight: 60 } }] : []),
      ],
    });
  }

  function unregisterGestureExploreContexts() {
    const gs = window.__gestureSystem;
    if (!gs) return;
    gs.unregisterViewContext('explore-map3d');
    gs.unregisterViewContext('explore-panels');
  }

  // app.js loads the gesture module asynchronously. Re-register when it
  // becomes available so map-first and gesture-first startup orders behave
  // identically.
  const onGestureReady = () => {
    registerGestureMap3D();
    if (projectPanel) registerGestureExploreScrollZones();
  };
  document.addEventListener('sh-crafted:gesture-ready', onGestureReady);
  cleanups.push(() => document.removeEventListener('sh-crafted:gesture-ready', onGestureReady));
  cleanups.push(() => clearTimeout(gestureRegisterTimer));

  // Esc 返回上一层状态
  const onKey = (e) => {
    if (!wrap.isConnected) return;
    if (e.key !== 'Escape') return;
    if (projectPanel) { clearProjectPanel(); return; }
    if (focusOverlay) { exitFocus3D(); return; }
    exitFlatFocus();
  };
  document.addEventListener('keydown', onKey);
  cleanups.push(() => document.removeEventListener('keydown', onKey));

  render();

  function contextForAgent() {
    const districtCraftsForContext = activeDistrictId ? districtCrafts(activeDistrictId) : craftRecords;
    return {
      route: '/explore', page_type: 'heritage_explore',
      current_root: selectedCraft ? { id: graphId('heritage', selectedCraft.craftId), type: 'heritage', title: selectedCraft.title } : null,
      selected_node: selectedCraft ? { id: graphId('heritage', selectedCraft.craftId), type: 'heritage', title: selectedCraft.title, summary: selectedCraft.summary } : null,
      active_branch: activeDistrictId ? 'LOCATED_IN' : null,
      visible_nodes: districtCraftsForContext.slice(0, 12).map((craft, index) => ({ id: graphId('heritage', craft.craftId), type: 'heritage', title: craft.title, index: index + 1, aliases: [craft.title] })),
      breadcrumbs: explorationHistory.slice(-8),
      history: explorationHistory.slice(-8),
      available_actions: ['get_current_context', 'search_graph', 'open_node', 'open_region', 'open_heritage_detail', 'go_back', 'show_help'],
      context_revision: 'explore-local',
    };
  }

  function districtNodeName(districtId) {
    return Object.entries(NODE_TO_DISTRICT).find(([, id]) => id === districtId)?.[0] || null;
  }

  const agentHost = {
    context: contextForAgent,
    async openNode({ node_id }) {
      const parsed = parseGraphId(node_id);
      if (parsed?.type === 'heritage') {
        const craft = craftRecords.find((item) => item.craftId === parsed.rawId);
        if (!craft) throw Object.assign(new Error('没有找到这个项目。'), { code: 'node_not_found' });
        selectedCraft = craft;
        transitionTo(`#/craft/${encodeURIComponent(craft.craftId)}`);
        return { ok: true, node_id };
      }
      if (parsed?.type === 'region') return this.openRegion({ region_id: node_id });
      if (['material', 'tradition'].includes(parsed?.type)) { transitionTo(`#/graph/${encodeURIComponent(node_id)}`); return { ok: true, node_id }; }
      throw Object.assign(new Error('当前页面不支持打开这种节点。'), { code: 'unsupported_node_type' });
    },
    async openHeritageDetail({ heritage_id }) { return this.openNode({ node_id: heritage_id }); },
    async setRootNode({ node_id }) { return this.openNode({ node_id }); },
    async openRegion({ region_id }) {
      const parsed = parseGraphId(region_id);
      const district = DISTRICTS.find((item) => item.id === parsed?.rawId);
      if (!district) throw Object.assign(new Error('没有找到这个地区。'), { code: 'node_not_found' });
      mode = 'map'; setMode('map'); await ensureMapBuilt();
      const nodeName = districtNodeName(district.id);
      if (map3d && nodeName) enterFocus3D(nodeName);
      else if (mapViewEl?.querySelector('.map-stage')) enterFlatFocus(district, mapViewEl.querySelector('.map-stage'));
      return { ok: true, region_id };
    },
    async expandBranch({ result }) {
      if (result?.nodes?.length === 1 && result.nodes[0].type === 'region') await this.openRegion({ region_id: result.nodes[0].id });
      return { ok: true };
    },
    async goBack() {
      if (projectPanel) { clearProjectPanel(); return { ok: true }; }
      if (focusOverlay) { exitFocus3D(); return { ok: true }; }
      if (flatFocusEl) { exitFlatFocus(); return { ok: true }; }
      transitionTo('#/'); return { ok: true };
    },
    async returnToRoot() {
      if (selectedCraft) { transitionTo(`#/craft/${encodeURIComponent(selectedCraft.craftId)}`); return { ok: true }; }
      selectedCraft = null; activeDistrictId = null; await this.goBack(); return { ok: true };
    },
    async focusModel() { return { ok: true }; },
    async readSummary({ target_id }) {
      const parsed = parseGraphId(target_id); const craft = craftRecords.find((item) => item.craftId === parsed?.rawId);
      if (!craft) return { ok: true, message: '当前没有可朗读的项目摘要，请先打开一个非遗项目。' };
      const spoken = `${craft.title}。${String(craft.summary || '目前资料中没有找到项目摘要。').slice(0, 220)}`;
      const started = agent.speak(spoken);
      return { ok: true, message: started ? '正在为你朗读项目摘要。' : '语音未开启；摘要已经显示在页面上。' };
    },
    async stopSpeaking() { agent.stopSpeaking(); return { ok: true }; },
    async setVoicePreferences(args) { return agent.setVoicePreferences(args); },
    async showHelp() { agent.say('当前可以说：打开某个项目、打开某个地区、查看第二个、返回、回到完成品或把摘要读给我听。'); return { ok: true }; },
  };
  agent.mount();
  agent.setHost(agentHost);

  return {
    deactivate() {
      map3d?.setActive(false);
      bg.setActive(false);
      unregisterPage('explore', wrap);
    },
    activate() {
      agent.mount();
      agent.setHost(agentHost);
      wrap.querySelectorAll('.ui-fade').forEach((node) => node.classList.remove('ui-fade'));
      wrap.classList.remove(TRANSITION_STATES.MAP_ENTER);
      bg.resetTransition();
      bg.setActive(true);
      registerPage('explore', transitionRegistration);
      requestAnimationFrame(() => {
        map3d?.resize?.();
        if (mode === 'map') {
          if (map3d) map3d.setActive(true);
          else render();
        }
      });
    },
    cleanup() {
      viewDisposed = true;
      renderGeneration++;
      clearTimeout(slipTimer);
      slip?.remove(); slip = null; slipFor = null;
      cleanups.forEach((fn) => fn());
      unregisterGestureExploreContexts();
      exitFocus3D(true, true);
      exitFlatFocus(true);
      flushPanelExits();
      flatFocusFields.forEach((f) => f.destroy());
      map3d?.dispose();
      map3d = null;
      agent.unmount();
      bg.destroy();
      unregisterPage('explore', wrap);
    },
  };
}
