// 首页：manifest 驱动的明度分层背景（layerbg）+ 水墨晕染交互（inkbloom）+ 任意键穿越转场（transitions）
// 分层/视差/漂移全部读取 assets/bg/manifest.json，JS 不硬编码图片相关数值
// 转场走跨页转场系统：home_exit（本页离场）/ map_enter（地图页进场标记类）
import { el, brandLogo } from '../ui.js';
import { reducedMotion } from '../particles.js';
import { siteText, trueStats } from '../data.js';
import { navigate } from '../router.js';
import { agent } from '../agent.js';
import { createLayerBG } from '../layerbg.js';
import { createInkBloom } from '../inkbloom.js';
import { createHomeParticleField } from '../homeparticles.js';
import { registerPage, unregisterPage, transitionTo, consumeEnter, isTransitioning } from '../transitions.js';
import { isAdmin, logout, saveSiteTexts } from '../admin.js';
import { mountEditableModule } from '../editable.js';

export function topNav(active) {
  const editing = isAdmin();
  return el('header', { class: 'topnav' }, [
    el('a', { class: 'brand', href: '#/', 'aria-label': '返回初始页', style: { display: 'flex', alignItems: 'center', gap: '14px' } }, [
      brandLogo('brand-logo', '探物志 Logo'),
      el('span', { class: 'name', text: '探物志-上海非遗交互数字平台' }),
    ]),
    el('nav', {}, [
      el('a', { href: '#/explore', class: active === 'explore' ? 'active' : '', text: '地图探索' }),
      el('a', { href: '#/graph', class: active === 'graph' ? 'active graph-nav-link' : 'graph-nav-link', text: '知识星图' }),
      el('a', { href: '#/passport', class: active === 'passport' ? 'active' : '', text: '数据护照' }),
      editing ? el('button', { class: 'admin-nav-logout', type: 'button', text: '退出', onclick: () => logout() }) : null,
    ]),
  ]);
}

// 转场状态名（产品大纲 §4.1 预留接口）：home_exit = 首页离场，map_enter = 地图页进场标记类
export const TRANSITION_STATES = { HOME_EXIT: 'home_exit', MAP_ENTER: 'map_enter' };

export async function homeView(root) {
  const stats = trueStats();
  const entering = consumeEnter(); // 从其他页转场回到首页时播放进场

  // ---------- 分层背景 + 晕染画布（底层环境 + 交互拖尾两层）----------
  const bg = await createLayerBG('assets/bg/manifest.json', {
    scrim: 'left', enter: entering, parallax: true,
  });
  // 底层环境墨晕：与 base 层同 z 序、紧随 base 之后（mid/dark/gold 层之下），读起来像画作本身在呼吸
  const ambientCanvas = el('canvas', {
    class: 'bg-bloom', 'aria-hidden': 'true',
    style: { zIndex: '1' },
  });
  bg.el.insertBefore(ambientCanvas, bg.layerEls[1] || null);
  const bloomCanvas = el('canvas', {
    class: 'bg-bloom', 'aria-hidden': 'true',
    style: { zIndex: String(bg.layers.length + 2) }, // scrim 之上、UI 之下
  });
  bg.el.appendChild(bloomCanvas);
  const particleCanvas = el('canvas', {
    class: 'home-particle-field home-ripple-particles', 'aria-hidden': 'true',
    style: { zIndex: String(bg.layers.length + 1) },
  });
  bg.el.appendChild(particleCanvas);
  bg.fadeEls.push(ambientCanvas, bloomCanvas, particleCanvas);

  const hint = el('p', { class: 'press-hint', text: '点击任意键继续', role: 'note' });

  const homeTitle = el('h1', { text: siteText('home.title', '从地图看上海手艺。') });
  const homeLede = el('p', {
    class: 'lede',
    text: siteText('home.lede', '按地区浏览非遗项目，查看工序与影像资料，并在交互工作台中完成一次简化制作。'),
  });
  const sourceButton = el('a', { class: 'btn-ghost', href: '#/passport', text: siteText('home.source_button', '资料来源') });
  const heroCopy = el('div', { class: 'hero-copy' }, [
    homeTitle,
    homeLede,
    el('div', { class: 'cta-row' }, [sourceButton]),
  ]);
  const statsNote = el('p', { class: 'stats-note', text: siteText('home.stats_note', '统计来自已加载的真实数据包，其余地区资料待接入') });
  const heroBlock = el('div', { class: 'hero-block' }, [
    el('div', { class: 'hero-stats' }, [
      el('span', {}, [el('b', { text: String(stats.craftCount) }), `门工艺已接入`]),
      el('span', {}, [el('b', { text: String(stats.districtCount) }), `个行政区有数据`]),
      el('span', {}, [el('b', { text: String(stats.evidenceCount) }), `段纪录片证据`]),
    ]),
    statsNote,
  ]);

  const wrap = el('section', { class: 'view home' }, [
    bg.el,
    topNav('home'),
    heroCopy,
    heroBlock,
    hint,
    el('button', {
      class: 'cat-hint', title: '小蕉 · 智能讲解（在工艺页内提供）',
      onclick: () => navigate('#/explore'),
    }, [brandLogo('brand-logo cat-hint-logo', '小蕉 Logo'), el('span', { text: '小蕉 · 智能讲解' })]),
  ]);
  root.appendChild(wrap);

  // 首屏先完成挂载和事件绑定，荷叶、荷花在浏览器空闲时渐进加载。
  // 这一步不能阻塞 homeView 返回，否则慢网下连“进入地图”都无法点击。
  let particleField = { burst: () => Promise.resolve(), destroy() {} };
  let particleInitHandle = 0;
  let disposed = false;
  const startParticleField = () => {
    particleInitHandle = 0;
    createHomeParticleField(particleCanvas, bg.layerEls[0], {
      sourceLayer: bg.layers[0]?.role || 'layer-0',
      spriteSources: [
        { src: 'assets/home/lotus-leaf-512.jpg', kind: 'leaf' },
        { src: 'assets/home/lotus-flower-512.jpg', kind: 'flower' },
      ],
    }).then((field) => {
      if (disposed) field.destroy();
      else particleField = field;
    }).catch(() => {});
  };
  if ('requestIdleCallback' in window) particleInitHandle = requestIdleCallback(startParticleField, { timeout: 900 });
  else particleInitHandle = setTimeout(startParticleField, 180);

  // 首页空闲时预热地图模块和小体积地图资源；仅下载/解码，不创建 WebGL。
  const warmMap = () => import('../map3d.js').then((module) => module.preloadMap3DAssets?.()).catch(() => {});
  if ('requestIdleCallback' in window) requestIdleCallback(warmMap, { timeout: 1800 });
  else setTimeout(warmMap, 700);

  const editableCleanups = [
    mountEditableModule(heroCopy, [
      { key: 'home.title', element: homeTitle },
      { key: 'home.lede', element: homeLede },
      { key: 'home.source_button', element: sourceButton },
    ], (values) => saveSiteTexts(Object.entries(values).map(([key, content]) => ({ key, content })))),
    mountEditableModule(heroBlock, [
      { key: 'home.stats_note', element: statsNote },
    ], (values) => saveSiteTexts(Object.entries(values).map(([key, content]) => ({ key, content })))),
  ];

  const bloom = createInkBloom(bloomCanvas, bg.manifest, bg.bgDir, {
    trailDist: 68,
    trailAlpha: [0.065, 0.11],
    ambientEvery: [0.85, 1.55],
    ambientAlpha: [0.045, 0.075],
  });
  // 底层环境墨晕：克制、慢生慢灭、落在有墨区域、避开标题文案块（参数可直接在此调）
  const heroCopyEl = wrap.querySelector('.hero-copy');
  const ambientBloom = createInkBloom(ambientCanvas, bg.manifest, bg.bgDir, {
    mode: 'ambient',
    sampleMid: true, // 掺入中间调，墨晕落在纸洗色调里
    ambient: {
      maxAlive: 12,          // 自发墨晕更丰盈，但仍避开首页文字
      interval: [1.25, 2.4], // 缩短生成间隔
      maxR: [34, 110],       // 半径（大小差异明显）
      alpha: [0.05, 0.11],   // 峰值透明度（淡墨）
      grow: [3, 6],          // 洇开（秒）
      hold: [2, 5],          // 保持（秒）
      fade: [6, 12],         // 淡出（秒）
    },
    avoidRect: () => {
      const c = ambientCanvas.getBoundingClientRect();
      const h = heroCopyEl.getBoundingClientRect();
      return { x0: h.left - c.left, y0: h.top - c.top, x1: h.right - c.left, y1: h.bottom - c.top };
    },
  });

  // ---------- 登记到跨页转场系统 ----------
  const uiEls = wrap.querySelectorAll('.topnav, .hero-copy, .hero-block, .press-hint, .cat-hint');
  registerPage('home', {
    root: wrap,
    bg,
    fadeUI() { uiEls.forEach((n) => n.classList.add('ui-fade')); },
  });

  // ---------- home_exit：任意键 / 点击空白 → 穿越到地图 ----------
  const onKey = (e) => {
    if (e.key === 'Escape' || e.ctrlKey || e.metaKey || e.altKey) return; // Esc 与系统快捷键不触发
    if (e.target?.closest?.('input, textarea, select, [contenteditable]')) return; // 输入场景不触发
    if (isTransitioning()) return;
    wrap.classList.add(TRANSITION_STATES.HOME_EXIT);
    transitionTo('#/explore');
  };
  let departureStarted = false;
  const onTap = async (e) => {
    if (e.target.closest('a, button, input, select, textarea')) return; // 资料来源/导航/小蕉不触发
    if (isTransitioning() || departureStarted) return;
    departureStarted = true;
    const bounds = particleCanvas.getBoundingClientRect();
    await particleField.burst(e.clientX - bounds.left, e.clientY - bounds.top);
    wrap.classList.add(TRANSITION_STATES.HOME_EXIT);
    transitionTo('#/explore');
  };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', onTap);

  agent.mount();
  agent.setCraft(null);
  agent.setContext({ page: 'home', current_step_id: null, inventory_states: [], failure_count: 0 });

  return {
    cleanup() {
      disposed = true;
      if (particleInitHandle) {
        if ('cancelIdleCallback' in window) cancelIdleCallback(particleInitHandle);
        else clearTimeout(particleInitHandle);
      }
      bloom.destroy();
      particleField.destroy();
      editableCleanups.forEach((cleanup) => cleanup());
      ambientBloom.destroy();
      bg.destroy();
      unregisterPage('home', wrap);
      document.removeEventListener('keydown', onKey);
      agent.unmount();
    },
  };
}
