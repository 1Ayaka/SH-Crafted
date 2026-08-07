// 手势帮助覆盖层 —— 展示所有可用手势的图示和说明
import { el } from '../ui.js';

export function createGestureHelp({ onClose } = {}) {
  let overlay = null;

  const GESTURES = [
    { icon: '指', name: '食指移动', desc: '伸出食指移动页面上的玉石手骨架与隔空指针。' },
    { icon: '点', name: '捏合松开', desc: '拇指与食指捏合后松开，等价于鼠标点击。' },
    { icon: '按', name: '张掌按住', desc: '张开手并保持，相当于鼠标按下；在三维空间移动可旋转，收掌释放。' },
    { icon: '缩', name: '握拳缩小', desc: '握拳并短暂停稳，缩小当前地图、模型或星图。' },
    { icon: '点', name: '持续捏合', desc: '捏合后保持约半秒进入长按；也可以拖拽三维场景。' },
    { icon: '返', name: '左挥返回', desc: '手掌从右向左快速挥动，返回上一层。' },
  ];

  function build() {
    return el('div', { class: 'gesture-help-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gh-heading' }, [
      el('div', { class: 'gesture-help-card' }, [
        el('div', { class: 'gh-head' }, [
          el('h2', { id: 'gh-heading', text: '手势指南' }),
          el('button', { class: 'gh-close', 'aria-label': '关闭帮助', text: '关闭', onclick: dismiss }),
        ]),

        el('p', { class: 'gh-lead', text: '隔空手势是一种增强交互方式，不替代鼠标、触屏或语音。你可以随时关闭摄像头。' }),

        el('ul', { class: 'gh-list' }, GESTURES.map((g) => (
          el('li', { class: 'gh-item' }, [
            el('span', { class: 'gh-icon', 'aria-hidden': 'true', text: g.icon }),
            el('div', { class: 'gh-body' }, [
              el('strong', { text: g.name }),
              el('p', { text: g.desc }),
            ]),
          ])
        ))),

        el('div', { class: 'gh-tips' }, [
          el('h3', { text: '小贴士' }),
          el('ul', {}, [
            el('li', { text: '保持手部在摄像头可见范围内，光线充足效果更好。' }),
            el('li', { text: '张掌后立即按住三维场景，移动即可旋转；收掌释放。点击请使用食指与拇指捏合。' }),
            el('li', { text: '如果手势不灵敏，可以在设置中调整指针速度和捏合距离。' }),
            el('li', { text: '手不用伸到摄像头边缘，靠近边缘的安全区即可触达屏幕边缘。' }),
          ]),
        ]),

        el('div', { class: 'gh-actions' }, [
          el('button', { class: 'btn btn-primary', text: '知道了', onclick: dismiss }),
        ]),
      ]),
    ]);
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
