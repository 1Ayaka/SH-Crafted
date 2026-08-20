// 手势设置面板 —— 灵敏度、指针速度、手势开关等
import { el } from '../ui.js';
import { loadGestureSettings, saveGestureSettings, resetGestureSettings } from './gesture-settings.js';

export function createGestureSettingsPanel({ onClose } = {}) {
  let overlay = null;
  const settings = loadGestureSettings();

  function build() {
    const sensitivityLabel = el('span', { class: 'gs-range-label' });
    const cursorSpeedLabel = el('span', { class: 'gs-range-label' });
    const pinchLabel = el('span', { class: 'gs-range-label' });
    const hitSlopLabel = el('span', { class: 'gs-range-label' });
    const longPressLabel = el('span', { class: 'gs-range-label' });
    sensitivityLabel.textContent = `${Number(settings.sensitivity ?? 0.5).toFixed(1)}×`;
    cursorSpeedLabel.textContent = `${Number(settings.cursorSpeed ?? 0.5).toFixed(1)}×`;
    pinchLabel.textContent = Number(settings.pinchStartRatio ?? 0.29).toFixed(2);
    hitSlopLabel.textContent = `${Math.round(Number(settings.hitSlopPx ?? 30))}px`;
    longPressLabel.textContent = `${Math.round(Number(settings.longPressMs ?? 700))}ms`;

    return el('div', { class: 'gesture-settings-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gs-heading' }, [
      el('div', { class: 'gesture-settings-card' }, [
        el('div', { class: 'gs-head' }, [
          el('h2', { id: 'gs-heading', text: '手势设置' }),
          el('button', { class: 'gs-close', 'aria-label': '关闭设置', text: '✕', onclick: dismiss }),
        ]),

        // 指针灵敏度
        el('div', { class: 'gs-field' }, [
          el('label', { text: '指针灵敏度' }),
          el('input', {
            type: 'range', min: '0.0', max: '1.0', step: '0.1',
            'aria-label': '指针灵敏度',
            value: String(settings.sensitivity ?? 0.5),
            oninput: (e) => {
              settings.sensitivity = parseFloat(e.target.value);
              sensitivityLabel.textContent = `${settings.sensitivity.toFixed(1)}×`;
              persist();
            },
          }),
          sensitivityLabel,
        ]),

        // 指针速度
        el('div', { class: 'gs-field' }, [
          el('label', { text: '指针速度' }),
          el('input', {
            type: 'range', min: '0.0', max: '1.0', step: '0.1',
            'aria-label': '指针速度',
            value: String(settings.cursorSpeed ?? 0.5),
            oninput: (e) => {
              settings.cursorSpeed = parseFloat(e.target.value);
              cursorSpeedLabel.textContent = `${settings.cursorSpeed.toFixed(1)}×`;
              persist();
            },
          }),
          cursorSpeedLabel,
        ]),

        // 捏合灵敏度
        el('div', { class: 'gs-field' }, [
          el('label', { text: '捏合触发距离' }),
          el('input', {
            type: 'range', min: '0.2', max: '0.5', step: '0.01',
            'aria-label': '捏合触发距离',
            value: String(settings.pinchStartRatio ?? 0.29),
            oninput: (e) => {
              settings.pinchStartRatio = parseFloat(e.target.value);
              settings.pinchReleaseRatio = Math.min(0.5, settings.pinchStartRatio + 0.1);
              pinchLabel.textContent = settings.pinchStartRatio.toFixed(2);
              persist();
            },
          }),
          pinchLabel,
        ]),

        // 手势开关
        el('div', { class: 'gs-field' }, [
          el('label', { text: '按钮命中范围' }),
          el('input', {
            type: 'range', min: '12', max: '56', step: '2',
            'aria-label': '按钮命中范围',
            value: String(settings.hitSlopPx ?? 30),
            oninput: (e) => {
              settings.hitSlopPx = parseFloat(e.target.value);
              hitSlopLabel.textContent = `${Math.round(settings.hitSlopPx)}px`;
              persist();
              window.__gestureSystem?.targetResolver?.setHitSlopPx?.(settings.hitSlopPx);
            },
          }),
          hitSlopLabel,
        ]),

        el('div', { class: 'gs-field' }, [
          el('label', { text: '持续捏合进入长按' }),
          el('input', {
            type: 'range', min: '400', max: '1400', step: '50',
            'aria-label': '持续捏合进入长按的时间',
            value: String(settings.longPressMs ?? 700),
            oninput: (e) => {
              settings.longPressMs = parseInt(e.target.value, 10);
              longPressLabel.textContent = `${settings.longPressMs}ms`;
              persist();
            },
          }),
          longPressLabel,
          el('small', { class: 'muted', text: '调整后刷新页面生效。' }),
        ]),

        // 手势开关
        el('div', { class: 'gs-field gs-field-check' }, [
          el('label', { text: '开机自启手势' }),
          el('input', {
            type: 'checkbox',
            checked: settings.enabled || false,
            onchange: (e) => {
              settings.enabled = e.target.checked;
              persist();
            },
          }),
        ]),

        // 重置
        el('div', { class: 'gs-actions' }, [
          el('button', { class: 'btn-ghost', text: '导出诊断日志', onclick: () => {
            window.__gestureDiagnostics?.download?.();
          } }),
          el('button', { class: 'btn-ghost', text: '清空日志', onclick: () => {
            window.__gestureDiagnostics?.clear?.();
          } }),
          el('button', { class: 'btn-ghost', text: '恢复默认', onclick: () => {
            resetGestureSettings();
            dismiss();
          } }),
          el('button', { class: 'btn btn-primary', text: '完成', onclick: dismiss }),
        ]),
      ]),
    ]);
  }

  function persist() {
    saveGestureSettings(settings);
    window.__gestureSystem?.controller?.setEdgeInsets?.(settings.edgeInsetX ?? 0.10, settings.edgeInsetY ?? 0.10);
  }

  function show() {
    if (overlay) return;
    overlay = build();
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) dismiss();
    });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('is-visible'));
  }

  function dismiss() {
    if (!overlay) return;
    overlay.classList.remove('is-visible');
    setTimeout(() => { overlay?.remove(); overlay = null; onClose?.(); }, 300);
  }

  function destroy() {
    dismiss();
  }

  return { show, dismiss, destroy };
}
