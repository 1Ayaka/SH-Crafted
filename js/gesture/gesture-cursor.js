// 隔空指针 —— 水墨玉石风格 DOM 元素
// 视觉：低饱和 moss/ink 中心 + sage 半透明外环，捏合时收拢 + ochre/terracotta 点缀
// 禁止霓虹蓝、赛博朋克、扫描线、高频波纹
export function createGestureCursor() {
  let el = null;
  let visible = false;
  let pinching = false;
  let hovering = false;
  let opacity = 1;

  function ensureElement() {
    if (el?.isConnected) return;
    el = document.createElement('div');
    el.className = 'air-cursor';
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('data-gesture-cursor', '');

    // 内圆（moss 实心）
    const inner = document.createElement('div');
    inner.className = 'air-cursor-inner';
    el.appendChild(inner);

    // 外环（sage 半透明）
    const ring = document.createElement('div');
    ring.className = 'air-cursor-ring';
    el.appendChild(ring);

    document.body.appendChild(el);
  }

  function moveTo(screenX, screenY) {
    ensureElement();
    el.style.left = `${screenX}px`;
    el.style.top = `${screenY}px`;
    if (!visible) {
      visible = true;
      el.classList.add('is-visible');
    }
  }

  function hide() {
    if (el) {
      visible = false;
      el.classList.remove('is-visible');
    }
  }

  function setPinching(active) {
    if (pinching === active) return;
    pinching = active;
    ensureElement();
    if (active) {
      el.classList.add('is-pinching');
    } else {
      el.classList.remove('is-pinching');
    }
  }

  function setHovering(active) {
    if (hovering === active) return;
    hovering = active;
    ensureElement();
    if (active) {
      el.classList.add('is-hovering');
    } else {
      el.classList.remove('is-hovering');
    }
  }

  function setLongPress(active) {
    ensureElement();
    el.classList.toggle('is-longpress', Boolean(active));
  }

  function setOpacity(value) {
    opacity = Math.max(0, Math.min(1, value));
    if (el) {
      el.style.opacity = String(opacity);
    }
  }

  // 确认反馈：短促墨晕扩散
  function confirmFeedback() {
    ensureElement();
    el.classList.add('is-confirmed');
    setTimeout(() => el.classList.remove('is-confirmed'), 360);
  }

  // 错误反馈：短促 terracotta 闪烁
  function errorFeedback() {
    ensureElement();
    el.classList.add('is-error');
    setTimeout(() => el.classList.remove('is-error'), 500);
  }

  function destroy() {
    if (el) {
      el.remove();
      el = null;
    }
    visible = false;
    pinching = false;
    hovering = false;
  }

  return {
    moveTo,
    hide,
    setPinching,
    setHovering,
    setLongPress,
    setOpacity,
    confirmFeedback,
    errorFeedback,
    destroy,
    element: () => el,
  };
}
