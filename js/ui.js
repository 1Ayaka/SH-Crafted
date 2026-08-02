// UI 基础工具：DOM 创建、证据浮窗、通用弹窗
import { evidenceTimecode } from './data.js';

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function reviewTag(text = '待审核') {
  return el('span', { class: 'tag tag-review', text, title: '该内容由 AI 自动抽取，人工审核尚未完成' });
}

export function catSVG(cls = 'cat') {
  return el('span', { class: cls, role: 'img', 'aria-label': '小蕉（猫剪影）' }, [
    el('span', { class: 'ears' }), el('span', { class: 'eyes' }),
  ]);
}

let escHandler = null;
export function openModal({ title, body, onClose }) {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', escHandler); onClose?.(); };
  escHandler = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', escHandler);
  const mask = el('div', { class: 'modal-mask', onclick: (e) => { if (e.target === mask) close(); } }, [
    el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
      el('div', { class: 'm-head' }, [
        el('h3', { text: title }),
        el('button', { class: 'm-close', text: '×', 'aria-label': '关闭', onclick: close }),
      ]),
      el('div', { class: 'm-body' }, [body]),
    ]),
  ]);
  root.appendChild(mask);
  return close;
}

// 纪录片证据浮窗：关键帧 + 转写原文 + 时间码
export function openEvidenceModal(craft, evidenceIds, { title = '纪录片证据' } = {}) {
  const body = el('div', {});
  body.appendChild(el('p', {
    class: 'small muted',
    text: '视频片段待接入，当前为关键帧证据；转写为 AI 自动生成，内容待审核。',
    style: { marginBottom: '6px' },
  }));
  let found = 0;
  for (const id of evidenceIds) {
    const ev = craft.evMap.get(id);
    if (!ev) continue;
    found++;
    const block = el('div', { class: 'ev-block' }, [
      el('span', { class: 'tc', text: `时间码 ${evidenceTimecode(ev)}` }),
    ]);
    for (const fp of (ev.frame_paths || []).slice(0, 2)) {
      block.appendChild(el('img', { src: craft.baseUrl + fp, alt: ev.visual_description_raw || '纪录片关键帧', loading: 'lazy' }));
    }
    if (ev.transcript_raw) block.appendChild(el('blockquote', { text: ev.transcript_raw }));
    if (ev.visual_description_raw) block.appendChild(el('p', { class: 'vis', text: `画面：${ev.visual_description_raw}` }));
    block.appendChild(el('p', { class: 'small muted', text: `来源：纪录片《${craft.title}》关键帧 · 证据编号 ${ev.evidence_id}` }));
    body.appendChild(block);
  }
  if (!found) body.appendChild(el('p', { class: 'empty-state', text: '该步骤的证据资料待补充' }));
  return openModal({ title, body });
}

export function jiaoToast(message, actions = []) {
  const root = document.getElementById('toast-root');
  root.querySelector('.jiao-toast')?.remove();
  const toast = el('div', { class: 'jiao-toast', role: 'status' }, [
    catSVG(),
    el('div', { style: { flex: '1' } }, [
      el('p', { text: message }),
      actions.length
        ? el('div', { class: 'jt-actions' }, actions.map((a) =>
            el('button', { text: a.label, onclick: () => { a.onClick?.(); toast.remove(); } })))
        : null,
    ]),
    el('button', { class: 'jt-dismiss', text: '×', 'aria-label': '暂不', onclick: () => toast.remove() }),
  ]);
  root.appendChild(toast);
  setTimeout(() => toast.isConnected && toast.remove(), 12000);
}
