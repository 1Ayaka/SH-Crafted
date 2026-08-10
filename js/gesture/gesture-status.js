// 手势状态指示器 —— 小号文字，显示当前手势状态
// 参考 voice controller 的 voiceStatus 显示模式
import { GESTURE_STATES } from './gesture-state-machine.js';

const LABELS = Object.freeze({
  DISABLED: '',
  REQUESTING_PERMISSION: '正在申请摄像头权限…',
  CAMERA_STARTING: '正在启动摄像头…',
  LOADING_MODEL: '正在加载手势模型…',
  CALIBRATING: '正在校准…',
  SEARCHING_HAND: '等待检测手部…',
  READY: '手势就绪',
  ACTIVE: '手势跟踪中',
  SUSPENDED: '手势已暂停',
  ERROR: '手势暂不可用',
});

export function createGestureStatus() {
  let el = null;
  let currentState = GESTURE_STATES.DISABLED;

  function ensureElement() {
    if (el?.isConnected) return;
    el = document.createElement('span');
    el.className = 'gesture-status';
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('role', 'status');
  }

  function mount(parent = document.body) {
    ensureElement();
    const host = parent?.appendChild ? parent : document.body;
    if (!el.isConnected) host.appendChild(el);
  }

  function unmount() {
    if (el) el.remove();
  }

  function setState(state, detail = '') {
    currentState = state;
    if (!el) return;
    const label = LABELS[state] || state;
    el.textContent = detail ? `${label} — ${detail}` : label;
    el.dataset.gestureState = state;

    // 有内容就显示
    if (label) {
      el.classList.add('is-visible');
      if (state === GESTURE_STATES.ACTIVE) el.classList.add('is-active');
      else el.classList.remove('is-active');
      if (state === GESTURE_STATES.ERROR) el.classList.add('is-error');
      else el.classList.remove('is-error');
    } else {
      el.classList.remove('is-visible', 'is-active', 'is-error');
    }

    // 3 秒后自动隐藏（非 ACTIVE/ERROR 状态）
    if (state !== GESTURE_STATES.ACTIVE && state !== GESTURE_STATES.ERROR) {
      clearTimeout(el._hideTimer);
      el._hideTimer = setTimeout(() => {
        el.classList.remove('is-visible');
      }, 3000);
    }
  }

  function setText(text) {
    if (!el) return;
    el.textContent = text;
    if (text) {
      el.classList.add('is-visible');
      clearTimeout(el._hideTimer);
      el._hideTimer = setTimeout(() => {
        el.classList.remove('is-visible');
      }, 3000);
    }
  }

  function destroy() {
    unmount();
    el = null;
  }

  return {
    mount,
    unmount,
    setState,
    setText,
    destroy,
    element: () => el,
  };
}
