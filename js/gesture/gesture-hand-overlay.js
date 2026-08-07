const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const ACTION_LABELS = {
  tracking: '食指移动指针',
  pinching: '捏合中 · 松开点击',
  palmpress: '张掌按住 · 松开',
  dragging: '按住移动 · 旋转',
  longpress: '持续按住 · 长按',
  zoomout: '握拳 · 缩小',
};

function normalize(input) {
  if (!input || input.length < 21) return null;
  if (typeof input[0] === 'number') return Array.from({ length: 21 }, (_, index) => ({
    x: Number(input[index * 3]), y: Number(input[index * 3 + 1]), z: Number(input[index * 3 + 2]),
  }));
  return Array.from(input).slice(0, 21);
}

export function createGestureHandOverlay() {
  let canvas = null;
  let context = null;
  let badge = null;
  let guide = null;
  let points = null;
  let action = 'tracking';
  let visible = false;

  function mount() {
    if (canvas?.isConnected) return;
    canvas = document.createElement('canvas');
    canvas.className = 'gesture-hand-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    badge = document.createElement('div');
    badge.className = 'gesture-hand-action';
    badge.setAttribute('role', 'status');
    badge.setAttribute('aria-live', 'polite');
    badge.textContent = ACTION_LABELS.tracking;
    guide = document.createElement('aside');
    guide.className = 'gesture-live-guide';
    guide.setAttribute('aria-label', '手势操作说明');
    guide.innerHTML = `
      <strong>隔空手势</strong>
      <span>食指移动指针</span>
      <span>张掌按住旋转 · 收掌释放</span>
      <span>捏合点击/长按 · 握拳缩小</span>
      <button type="button" aria-label="隐藏手势说明">知道了</button>`;
    guide.querySelector('button').addEventListener('click', () => guide.classList.remove('is-visible'));
    document.body.append(canvas, badge, guide);
    context = canvas.getContext('2d');
    resize();
  }

  function resize() {
    if (!canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(window.innerWidth * ratio));
    canvas.height = Math.max(1, Math.round(window.innerHeight * ratio));
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    context?.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
  }

  function draw() {
    if (!context || !canvas) return;
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    if (!visible || !points) return;
    const projected = points.map((point) => ({ x: (1 - point.x) * window.innerWidth, y: point.y * window.innerHeight }));
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = action === 'longpress' ? 5 : 3.2;
    context.strokeStyle = action === 'palmpress' || action === 'zoomout' ? 'rgba(192,142,58,.72)' : 'rgba(241,232,214,.68)';
    context.shadowColor = 'rgba(43,51,39,.22)';
    context.shadowBlur = 8;
    context.beginPath();
    CONNECTIONS.forEach(([from, to]) => {
      context.moveTo(projected[from].x, projected[from].y);
      context.lineTo(projected[to].x, projected[to].y);
    });
    context.stroke();
    context.shadowBlur = 0;
    projected.forEach((point, index) => {
      context.beginPath();
      context.arc(point.x, point.y, index === 8 || index === 4 ? 6 : 4, 0, Math.PI * 2);
      context.fillStyle = index === 8 || index === 4 ? 'rgba(198,107,61,.88)' : 'rgba(96,108,56,.82)';
      context.fill();
      context.lineWidth = 1.2;
      context.strokeStyle = 'rgba(232,220,199,.86)';
      context.stroke();
    });
    const palm = projected[9];
    badge.style.left = `${Math.min(window.innerWidth - 180, Math.max(12, palm.x + 28))}px`;
    badge.style.top = `${Math.min(window.innerHeight - 54, Math.max(12, palm.y + 22))}px`;
  }

  function update(landmarks) {
    mount();
    points = normalize(landmarks);
    visible = Boolean(points);
    canvas.classList.toggle('is-visible', visible);
    badge.classList.toggle('is-visible', visible);
    draw();
  }

  function setAction(next = 'tracking') {
    action = ACTION_LABELS[next] ? next : 'tracking';
    mount();
    badge.textContent = ACTION_LABELS[action];
    badge.dataset.action = action;
    draw();
  }

  function showGuide() { mount(); guide.classList.add('is-visible'); }
  function hide() { visible = false; points = null; canvas?.classList.remove('is-visible'); badge?.classList.remove('is-visible'); draw(); }
  function destroy() { window.removeEventListener('resize', resize); canvas?.remove(); badge?.remove(); guide?.remove(); canvas = null; badge = null; guide = null; context = null; }
  window.addEventListener('resize', resize);
  return { update, setAction, showGuide, hide, destroy };
}
