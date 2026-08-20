// 手势权限说明对话框 —— 首次开启时展示隐私与使用说明
import { el } from '../ui.js';

export function createGesturePermission({ onAccept, onDecline } = {}) {
  let overlay = null;
  let restoreFocus = null;
  let acceptButton = null;
  let onKeyDown = null;

  function show() {
    if (overlay) return;
    restoreFocus = document.activeElement;

    acceptButton = el('button', {
      class: 'btn btn-primary',
      text: '开启手势',
      onclick: () => { dismiss(); onAccept?.(); },
    });

    overlay = el('div', { class: 'gesture-permission-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gp-heading' }, [
      el('div', { class: 'gesture-permission-card' }, [
        el('h2', { id: 'gp-heading', text: '隔空手势' }),
        el('p', { class: 'gp-lead', text: '开启摄像头后，页面会显示跟随你的半透明虚拟手：移动手掌控制指针，拇指与食指捏合用于点击和长按，其他普通姿态保持闲置。' }),

        el('div', { class: 'gp-section' }, [
          el('h3', { text: '我们会做什么' }),
          el('ul', {}, [
            el('li', { text: '仅识别人手 21 个关键点坐标，不保存任何图像' }),
            el('li', { text: '所有计算在本地浏览器完成，不上传任何数据' }),
            el('li', { text: '功能默认关闭，仅在您主动开启后运行' }),
          ]),
        ]),

        el('div', { class: 'gp-section' }, [
          el('h3', { text: '我们不会做什么' }),
          el('ul', {}, [
            el('li', { text: '不会录制、存储或传输摄像头画面' }),
            el('li', { text: '不会用于身份识别或行为追踪' }),
            el('li', { text: '不会在后台偷偷开启摄像头' }),
          ]),
        ]),

        el('div', { class: 'gp-section' }, [
          el('h3', { text: '手势说明' }),
          el('ul', { class: 'gp-gesture-list' }, [
            el('li', {}, [el('strong', { text: '食指移动' }), ' — 移动隔空指针']),
            el('li', {}, [el('strong', { text: '捏合后松开' }), ' — 点击当前目标']),
            el('li', {}, [el('strong', { text: '张掌按住' }), ' — 鼠标按下 / 拖拽旋转']),
            el('li', {}, [el('strong', { text: '持续捏合' }), ' — 长按 / 拖拽旋转']),
            el('li', {}, [el('strong', { text: '握拳' }), ' — 缩小']),
            el('li', {}, [el('strong', { text: '向左挥动' }), ' — 返回上一页']),
          ]),
        ]),

        el('p', { class: 'gp-note', text: '鼠标、触屏、键盘和语音功能完全不受影响，手势只是一种额外的增强方式。' }),

        el('div', { class: 'gp-actions' }, [
          acceptButton,
          el('button', { class: 'btn-ghost', text: '暂不使用', onclick: () => { dismiss(); onDecline?.(); } }),
        ]),
      ]),
    ]);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { dismiss(); onDecline?.(); }
    });

    document.body.appendChild(overlay);
    onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
        onDecline?.();
      }
    };
    overlay.addEventListener('keydown', onKeyDown);
    requestAnimationFrame(() => overlay.classList.add('is-visible'));
    requestAnimationFrame(() => acceptButton?.focus());
  }

  function dismiss() {
    if (!overlay) return;
    overlay.removeEventListener('keydown', onKeyDown);
    overlay.classList.remove('is-visible');
    const focusTarget = restoreFocus;
    setTimeout(() => {
      overlay?.remove();
      overlay = null;
      acceptButton = null;
      onKeyDown = null;
      restoreFocus = null;
      focusTarget?.focus?.();
    }, 300);
  }

  function destroy() {
    dismiss();
  }

  return { show, dismiss, destroy };
}
