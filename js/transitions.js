// 跨页转场系统：当前页图层穿越 → 下一页 base 层已在落点 → 深层依次淡入 → 内容进场
// 接口（详见 docs/背景分层与转场系统.md）：
//   registerPage(name, { root, bg, fadeUI })   页面挂载时登记；bg 为 createLayerBG 的返回值
//   unregisterPage(name)                       页面 cleanup 时注销
//   transitionTo('#/explore')                  触发穿越转场；返回是否成功发起
//   consumeEnter()                             下一页挂载时取走“来自转场”标记（只生效一次）
//   isTransitioning()
// 流程（transitionTo）：
//   1) fadeUI()：当前页 UI 先行淡出（240ms）
//   2) bg.zoomThrough()：前排图层由前到后放大掠过镜头（base 层保留）
//   3) 旧背景整体提升为 body 下的 fixed ghost → navigate() → 新页挂载，
//      其 base 层立即可见作为落点（createLayerBG enter），深层依次淡入
//   4) ghost 380ms 淡出回收，完成 base → base 的交叉淡融，无硬切
//   reduced-motion：跳过穿越，整页 240ms 交叉淡入淡出（page-xfade）
import { navigate } from './router.js';
import { reducedMotion } from './particles.js';

const pages = new Map();
let currentName = null;
let transitioning = false;
let pendingEnter = false;
let unlockTimer = 0;

export function registerPage(name, api) {
  if (api?.root && !api.root.isConnected) return;
  pages.set(name, api);
  currentName = name;
}

export function unregisterPage(name, root = null) {
  if (root && pages.get(name)?.root !== root) return;
  pages.delete(name);
  if (currentName === name) currentName = null;
}

export function isTransitioning() {
  return transitioning;
}

// 下一页在视图函数开头调用一次：true 表示本次挂载来自转场，应播放进场动画
export function consumeEnter() {
  const v = pendingEnter;
  pendingEnter = false;
  return v;
}

export async function transitionTo(hash) {
  if (transitioning || location.hash === hash) return false;
  const cur = currentName ? pages.get(currentName) : null;
  transitioning = true;
  const release = (delay) => {
    clearTimeout(unlockTimer);
    unlockTimer = setTimeout(() => { transitioning = false; }, delay);
  };
  try {
    // reduced-motion 或无分层背景的页面：快速交叉淡入淡出
    if (reducedMotion || !cur?.bg) {
      cur?.root?.classList.add('page-xfade');
      pendingEnter = true;
      const delay = reducedMotion ? 220 : (cur?.root ? 70 : 0);
      setTimeout(() => navigate(hash), delay);
      release(delay + 280);
      return true;
    }
    cur.fadeUI?.();                    // 1) UI 淡出
    await cur.bg.zoomThrough();        // 2) 前排图层穿越（约 0.9–1.2s，base 保留）
    // 3) ghost 交棒：旧背景在路由切换后继续存活，与新页 base 交叉淡融
    // 使用视觉克隆完成交叉淡融，原背景留在路由挂载点中。
    // 地图页采用 keep-alive 时可直接恢复原 DOM/WebGL，不会因 ghost 回收而丢背景。
    const ghost = cur.bg.el.cloneNode(true);
    ghost.classList.add('bg-ghost');
    document.body.appendChild(ghost);
    pendingEnter = true;
    navigate(hash);
    requestAnimationFrame(() => {
      ghost.style.transition = 'opacity 380ms ease 60ms';
      ghost.style.opacity = '0';
    });
    setTimeout(() => ghost.remove(), 520);
    release(560);
    return true;
  } catch (err) {
    console.warn('转场失败，改为直接跳转：', err);
    transitioning = false;
    navigate(hash);
    return false;
  }
}
