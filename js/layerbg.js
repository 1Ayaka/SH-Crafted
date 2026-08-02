// 可复用分层背景组件：任意页面凭一份 manifest（tools/split_layers.py 生成）即可获得
//   图层叠放（后→前） + 后排正弦漂移 + 鼠标视差 + 进场（深层依次淡入）/ 离场（前排穿越）动画
// 用法：
//   const bg = await createLayerBG('assets/bg/manifest.json', { scrim: 'left', enter, parallax: true });
//   wrap.prepend(bg.el);                     // 也可以 appendChild 其他覆盖层（如墨晕画布）
//   await bg.zoomThrough();                  // 离场穿越（transitions.js 自动调用）
//   bg.destroy();                            // 页面 cleanup 时调用
// manifest  schema 见 docs/背景分层与转场系统.md；JS 不硬编码图片相关数值
import { reducedMotion } from './particles.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const FRAME_INTERVAL = 1000 / 30;
const manifestCache = new Map();

async function loadManifest(url) {
  if (!manifestCache.has(url)) {
    manifestCache.set(url, fetch(url).then((response) => {
      if (!response.ok) throw new Error(`背景清单加载失败：${response.status} ${url}`);
      return response.json();
    }).catch((error) => {
      manifestCache.delete(url);
      throw error;
    }));
  }
  return manifestCache.get(url);
}

export async function createLayerBG(manifestUrl, opts = {}) {
  const {
    scrim = null,        // 'left'（首页文字区）| 'top'（导航/工具栏区）| null
    enter = false,       // 是否播放进场（深层图层依次淡入，配合转场系统）
    parallax = false,    // 鼠标视差
    drift = true,        // 后排漂移
    fixed = false,       // 长页面用 fixed 定位（地图页），短页用 absolute（默认）
    active = true,       // 不可见的备用背景可延迟启动动画
  } = opts;

  const bgDir = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);
  const manifest = await loadManifest(manifestUrl);
  const layerSpecs = manifest.layers;

  // ---------- DOM ----------
  const stack = document.createElement('div');
  stack.className = 'bg-stack' + (fixed ? ' bg-fixed' : '');
  stack.setAttribute('aria-hidden', 'true');
  const layerEls = layerSpecs.map((l, i) => {
    const img = document.createElement('img');
    img.className = 'bg-layer';
    img.dataset.role = l.role || `layer-${i}`;
    img.src = bgDir + l.file;
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    img.loading = 'eager';
    img.fetchPriority = i === 0 ? 'high' : 'auto';
    img.style.zIndex = String(i + 1);
    stack.appendChild(img);
    return img;
  });
  // 可选的原图细节层：分层图负责墨色与景深，原图以可控透明度补回纸张/纹理细节。
  // 这对大屏放大尤其重要，也允许工作台直接替换为用户提供的新桌面图。
  let detailEl = null;
  if (manifest.direct_source) {
    detailEl = document.createElement('img');
    detailEl.className = 'bg-layer bg-layer-detail';
    detailEl.dataset.role = 'detail';
    detailEl.src = manifest.direct_source;
    detailEl.alt = '';
    detailEl.draggable = false;
    detailEl.decoding = 'async';
    detailEl.loading = 'eager';
    detailEl.fetchPriority = 'high';
    detailEl.style.zIndex = String(layerSpecs.length + 1);
    detailEl.style.opacity = String(manifest.direct_source_opacity ?? 1);
    stack.appendChild(detailEl);
  }
  if (scrim) {
    const s = document.createElement('div');
    s.className = scrim === 'top' ? 'bg-scrim bg-scrim-top' : 'bg-scrim';
    s.style.zIndex = String(layerSpecs.length + (detailEl ? 2 : 1));
    stack.appendChild(s);
  }

  // ---------- 漂移 + 视差 ----------
  let mx = 0, my = 0, cx = 0, cy = 0, raf = 0, running = false, locked = false;
  let enabled = active;
  let lastFrame = 0;
  let enterRaf = 0;
  let enterTimer = 0;
  const PAR = 14;
  const movingLayers = layerEls
    .map((node, i) => ({ node, i }))
    .filter(({ i }) => (drift && layerSpecs[i].drift) || (parallax && layerSpecs[i].parallax));
  movingLayers.forEach(({ node }) => node.classList.add('is-bg-moving'));
  function onMove(e) {
    mx = (e.clientX / window.innerWidth - 0.5) * 2;
    my = (e.clientY / window.innerHeight - 0.5) * 2;
  }
  function tick(t) {
    if (!running || locked) return;
    raf = requestAnimationFrame(tick);
    if (t - lastFrame < FRAME_INTERVAL) return;
    const dt = lastFrame ? Math.min(100, t - lastFrame) : FRAME_INTERVAL;
    lastFrame = t;
    const follow = 1 - Math.pow(0.96, dt / (1000 / 60));
    cx += (mx - cx) * follow;
    cy += (my - cy) * follow;
    movingLayers.forEach(({ node, i }) => {
      const l = layerSpecs[i];
      const dx = drift && l.drift ? Math.sin(t * l.speed + i * 2.1) * l.drift : 0;
      const dy = drift && l.drift ? Math.cos(t * l.speed * 0.8 + i * 1.7) * l.drift * 0.6 : 0;
      const px = parallax ? -cx * PAR * l.parallax : 0;
      const py = parallax ? -cy * PAR * l.parallax : 0;
      node.style.transform = `translate3d(${(px + dx).toFixed(2)}px, ${(py + dy).toFixed(2)}px, 0) scale(1.04)`;
    });
  }
  function start() {
    if (running || reducedMotion || locked || !enabled || document.hidden || !movingLayers.length) return;
    running = true;
    lastFrame = 0;
    raf = requestAnimationFrame(tick);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    raf = 0;
  }
  function setActive(value) {
    enabled = Boolean(value);
    if (enabled) start();
    else stop();
  }
  const onVis = () => (document.hidden ? stop() : start());

  // ---------- 进场：base 层立即可见，深层依次淡入落定 ----------
  function playEnter() {
    if (reducedMotion || !enter) { layerEls.forEach((n) => { n.style.opacity = '1'; }); start(); return; }
    layerEls.forEach((node, i) => {
      if (i === 0) return; // base（最后排）直接可见，作为转场落点
      const delay = 90 + i * 150;
      node.classList.add('is-bg-transitioning');
      node.style.opacity = '0';
      node.style.transform = 'scale(1.09)';
      node.style.transition = `opacity 640ms ease ${delay}ms, transform 940ms cubic-bezier(0.2, 0.7, 0.3, 1) ${delay}ms`;
      enterRaf = requestAnimationFrame(() => {
        node.style.opacity = '1';
        node.style.transform = 'scale(1.04)';
      });
    });
    // 深层落定后再启动漂移/视差，避免 transform 冲突
    enterTimer = setTimeout(() => {
      layerEls.forEach((n) => {
        n.style.transition = '';
        n.classList.remove('is-bg-transitioning');
      });
      start();
    }, 90 + layerEls.length * 150 + 980);
  }

  // ---------- 离场：前排图层由前到后穿越镜头（base 层保留给转场交叉淡融） ----------
  async function zoomThrough() {
    locked = true;
    stop();
    cancelAnimationFrame(enterRaf);
    clearTimeout(enterTimer);
    if (reducedMotion) return; // reduced 路径由 transitions.js 做整页交叉淡入淡出
    const frontFirst = layerEls.slice(1).reverse(); // 最前 → 次前 …（不含 base）
    frontFirst.forEach((node, i) => {
      node.classList.add('is-bg-transitioning');
      node.style.transition = `transform 560ms cubic-bezier(0.5, 0.05, 0.75, 0.4) ${i * 75}ms,`
        + ` opacity 380ms ease ${i * 75 + 90}ms`;
      requestAnimationFrame(() => {
        node.style.transform = `scale(${(1.9 + i * 0.22).toFixed(2)})`;
        node.style.opacity = '0';
      });
    });
    for (const n of bg.fadeEls) {
      n.style.transition = 'opacity 420ms ease 80ms';
      n.style.opacity = '0';
    }
    const last = Math.max(0, frontFirst.length - 1);
    await wait(190 + last * 75 + 380); // 前排全部掠过后交棒（base 仍在）
  }

  const bg = {
    el: stack,
    manifest,
    bgDir,
    layers: layerSpecs,
    layerEls,
    detailEl,
    fadeEls: [],        // 离场时一并淡出的覆盖层（如墨晕画布）
    zoomThrough,
    setActive,
    get locked() { return locked; },
    destroy() {
      locked = true;
      stop();
      cancelAnimationFrame(enterRaf);
      clearTimeout(enterTimer);
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('visibilitychange', onVis);
      // el 的移除交给路由 innerHTML 清空或 transitions.js 的 ghost 回收
    },
  };

  if (parallax) window.addEventListener('mousemove', onMove);
  document.addEventListener('visibilitychange', onVis);
  playEnter();
  return bg;
}
