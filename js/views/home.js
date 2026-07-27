// 首页：manifest 驱动的明度分层背景（layerbg）+ 水墨晕染交互（inkbloom）+ 任意键穿越转场（transitions）
// 分层/视差/漂移全部读取 assets/bg/manifest.json，JS 不硬编码图片相关数值
// 转场走跨页转场系统：home_exit（本页离场）/ map_enter（地图页进场标记类）
import { el, catSVG } from '../ui.js';
import { reducedMotion } from '../particles.js';
import { trueStats } from '../data.js';
import { navigate } from '../router.js';
import { agent } from '../agent.js';
import { createLayerBG } from '../layerbg.js';
import { createInkBloom } from '../inkbloom.js';
import { registerPage, unregisterPage, transitionTo, consumeEnter, isTransitioning } from '../transitions.js';

export function topNav(active) {
  return el('header', { class: 'topnav' }, [
    el('a', { class: 'brand', href: '#/', style: { display: 'flex', alignItems: 'center', gap: '14px' } }, [
      el('span', { class: 'seal', text: '上海非遗' }),
      el('span', { class: 'name', text: '上海非物质文化遗产交互系统' }),
    ]),
    el('nav', {}, [
      el('a', { href: '#/explore', class: active === 'explore' ? 'active' : '', text: '地图探索' }),
      el('a', { href: '#/explore', class: active === 'craft' ? 'active' : '', text: '工艺互动' }),
      el('a', { href: '#/passport', class: active === 'passport' ? 'active' : '', text: '数据护照' }),
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
  bg.fadeEls.push(ambientCanvas, bloomCanvas);

  const hint = el('p', { class: 'press-hint', text: '点击任意键继续', role: 'note' });

  const wrap = el('section', { class: 'view home' }, [
    bg.el,
    topNav('home'),
    el('div', { class: 'hero-copy' }, [
      el('h1', { text: '从地图看上海手艺。' }),
      el('p', {
        class: 'lede',
        text: '按地区浏览非遗项目，查看工序与影像资料，并在交互工作台中完成一次简化制作。',
      }),
      el('div', { class: 'cta-row' }, [
        el('a', { class: 'btn-ghost', href: '#/passport', text: '资料来源' }),
      ]),
    ]),
    el('div', { class: 'hero-block' }, [
      el('div', { class: 'hero-stats' }, [
        el('span', {}, [el('b', { text: String(stats.craftCount) }), `门工艺已接入`]),
        el('span', {}, [el('b', { text: String(stats.districtCount) }), `个行政区有数据`]),
        el('span', {}, [el('b', { text: String(stats.evidenceCount) }), `段纪录片证据`]),
      ]),
      el('p', { class: 'stats-note', text: '统计来自已加载的真实数据包，其余地区资料待接入' }),
    ]),
    hint,
    el('button', {
      class: 'cat-hint', title: '小蕉 · 智能讲解（在工艺页内提供）',
      onclick: () => navigate('#/explore'),
    }, [catSVG(), el('span', { text: '小蕉 · 智能讲解' })]),
  ]);
  root.appendChild(wrap);

  const bloom = createInkBloom(bloomCanvas, bg.manifest, bg.bgDir);
  // 底层环境墨晕：克制、慢生慢灭、落在有墨区域、避开标题文案块（参数可直接在此调）
  const heroCopyEl = wrap.querySelector('.hero-copy');
  const ambientBloom = createInkBloom(ambientCanvas, bg.manifest, bg.bgDir, {
    mode: 'ambient',
    sampleMid: true, // 掺入中间调，墨晕落在纸洗色调里
    ambient: {
      maxAlive: 5,           // 同时存活上限（克制）
      interval: [3.5, 7],    // 生成间隔（秒）
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
  const onTap = (e) => {
    if (e.target.closest('a, button, input, select, textarea')) return; // 资料来源/导航/小蕉不触发
    if (isTransitioning()) return;
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
      bloom.destroy();
      ambientBloom.destroy();
      bg.destroy();
      unregisterPage('home');
      document.removeEventListener('keydown', onKey);
      agent.unmount();
    },
  };
}
