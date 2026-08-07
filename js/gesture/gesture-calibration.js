// 手势校准覆盖层 —— 首次使用时引导用户稳定手部位置
import { el } from '../ui.js';

export function createGestureCalibration({ onComplete, onSkip } = {}) {
  let overlay = null;
  let timer = null;

  function show() {
    if (overlay) return;

    const countdown = el('span', { class: 'gcal-countdown', text: '3' });
    const hint = el('p', { class: 'gcal-hint', text: '请将手自然伸出，保持在摄像头前方' });

    overlay = el('div', { class: 'gesture-calibration-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': '手势校准' }, [
      el('div', { class: 'gesture-calibration-card' }, [
        el('div', { class: 'gcal-icon', 'aria-hidden': 'true' }, ['✋']),
        el('h2', { text: '校准手势' }),
        hint,
        countdown,
        el('button', { class: 'btn-ghost gcal-skip', text: '跳过校准', onclick: () => { dismiss(); onSkip?.(); } }),
      ]),
    ]);

    document.body.appendChild(overlay);

    let remaining = 3;
    timer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(timer);
        timer = null;
        dismiss();
        onComplete?.();
        return;
      }
      countdown.textContent = String(remaining);
    }, 800);

    requestAnimationFrame(() => overlay.classList.add('is-visible'));
  }

  function dismiss() {
    if (timer) { clearInterval(timer); timer = null; }
    if (!overlay) return;
    overlay.classList.remove('is-visible');
    setTimeout(() => { overlay?.remove(); overlay = null; }, 300);
  }

  function destroy() {
    dismiss();
  }

  return { show, dismiss, destroy };
}
