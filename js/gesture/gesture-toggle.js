// 手势开关 FAB 按钮 —— 固定于右下角，与 agent FAB 相邻
// 包含摄像头状态指示点（绿色=活跃，灰色=关闭，红色=错误）
import { GESTURE_STATES } from './gesture-state-machine.js';

export function createGestureToggle({ onToggle, onSettings } = {}) {
  let el = null;
  let dotEl = null;
  let labelEl = null;
  let iconEl = null;
  let currentState = GESTURE_STATES.DISABLED;
  let mounted = false;
  let toggleCallback = onToggle || null;
  let settingsCallback = onSettings || null;
  let settingsLongPressTriggered = false;

  function ensureElement() {
    if (el?.isConnected) return;

    el = document.createElement('button');
    el.className = 'gesture-toggle';
    el.setAttribute('aria-label', '开启手势探索模式');
    el.setAttribute('title', '隔空手势探索');
    el.setAttribute('type', 'button');

    // 摄像头状态指示点
    dotEl = document.createElement('span');
    dotEl.className = 'gesture-toggle-dot';
    dotEl.setAttribute('aria-hidden', 'true');
    el.appendChild(dotEl);

    // 手势图标
    iconEl = document.createElement('span');
    iconEl.className = 'gesture-toggle-icon';
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.textContent = '手';
    el.appendChild(iconEl);

    // 短标签
    labelEl = document.createElement('span');
    labelEl.className = 'gesture-toggle-label';
    labelEl.textContent = '手势';
    el.appendChild(labelEl);

    el.addEventListener('click', () => {
      if (settingsLongPressTriggered) {
        settingsLongPressTriggered = false;
        return;
      }
      const isActive = currentState !== GESTURE_STATES.DISABLED
        && currentState !== GESTURE_STATES.ERROR
        && currentState !== GESTURE_STATES.SUSPENDED;
      toggleCallback?.(!isActive);
    });

    // 长按打开设置
    let longPressTimer = 0;
    el.addEventListener('pointerdown', () => {
      settingsLongPressTriggered = false;
      longPressTimer = setTimeout(() => {
        settingsLongPressTriggered = true;
        settingsCallback?.();
      }, 800);
    });
    el.addEventListener('pointerup', () => clearTimeout(longPressTimer));
    el.addEventListener('pointerleave', () => clearTimeout(longPressTimer));
  }

  function mount(parent = document.body) {
    ensureElement();
    if (!mounted) {
      parent.appendChild(el);
      mounted = true;
    }
  }

  function unmount() {
    if (el) {
      el.remove();
      mounted = false;
    }
  }

  function setState(state) {
    currentState = state;
    if (!el) return;

    el.dataset.gestureState = state;

    const active = state !== GESTURE_STATES.DISABLED
      && state !== GESTURE_STATES.ERROR
      && state !== GESTURE_STATES.SUSPENDED;
    const label = state === GESTURE_STATES.SUSPENDED
      ? '恢复手势探索模式'
      : (active ? '关闭手势探索模式' : '开启手势探索模式');
    el.setAttribute('aria-label', label);

    // 状态指示点颜色
    if (dotEl) {
      dotEl.className = 'gesture-toggle-dot';
      if (state === GESTURE_STATES.ERROR) {
        dotEl.classList.add('is-error');
      } else if (active) {
        dotEl.classList.add('is-active');
      }
    }

    // 按钮激活态
    if (active) {
      el.classList.add('is-active');
    } else {
      el.classList.remove('is-active');
    }
  }

  function setEnabled(enabled) {
    if (el) {
      el.disabled = !enabled;
      el.style.opacity = enabled ? '' : '0.45';
    }
  }

  function setOnToggle(fn) { toggleCallback = fn; }
  function setOnSettings(fn) { settingsCallback = fn; }

  function destroy() {
    unmount();
    el = null;
    dotEl = null;
    iconEl = null;
    labelEl = null;
    toggleCallback = null;
    settingsCallback = null;
    settingsLongPressTriggered = false;
  }

  return {
    mount,
    unmount,
    setState,
    setEnabled,
    setOnToggle,
    setOnSettings,
    destroy,
    element: () => el,
  };
}
