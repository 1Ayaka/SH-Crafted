// 水墨晕染交互：鼠标经过处开出墨团，如笔尖染纸
// 参考配方（AE）：分形杂色(fbm) + 湍流置换(噪声边缘随时间演化) + 径向模糊(径向渐变衰减)
// Canvas 2D 自包含实现，无外部依赖：
//   - 值噪声 + fbm（4 倍频）调制闭合墨团的边缘半径（64 顶点）
//   - 径向渐变做软边，'multiply' 合成，多层叠加如宣纸积墨
//   - 墨色取自分层背景的前排墨层（manifest.particle_sources），低概率出金
//   - 稀疏环境墨晕在暗部区域自然生出，页面静止时也会呼吸
// 封顶 MAX_BLOTS；页面隐藏暂停；prefers-reduced-motion 时完全不启用（静态背景）
import { loadImage, reducedMotion } from './particles.js';

// ---------- 确定性伪随机 + 值噪声 + fbm ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed = 1337) {
  const rand = mulberry32(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = (rand() * (i + 1)) | 0; [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const fade = (t) => t * t * (3 - 2 * t);
  const lat = (ix, iy) => perm[(perm[ix & 255] + iy) & 255] / 255; // 0..1
  function noise2(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const u = fade(fx), v = fade(fy);
    const a = lat(ix, iy), b = lat(ix + 1, iy), c = lat(ix, iy + 1), d = lat(ix + 1, iy + 1);
    return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1; // -1..1
  }
  function fbm(x, y, oct = 4) {
    let sum = 0, amp = 0.5, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) { sum += noise2(x * f, y * f) * amp; norm += amp; amp *= 0.5; f *= 2.03; }
    return sum / norm; // ≈ -1..1
  }
  return { noise2, fbm };
}

const VERTS = 64;                 // 墨团边缘顶点数
const MAX_BLOTS = 70;             // 交互层同屏墨团上限（默认）
const GOLD_PROB = 0.08;           // 金箔色概率
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const rr = (range) => range[0] + Math.random() * (range[1] - range[0]); // 区间内取随机

// mode 'interactive'：鼠标拖尾 + 稀疏环境晕染（内容层画布，scrim 之上）
// mode 'ambient'：仅底层环境晕染（base 层画布，mid 层之下）——大而慢、克制长存，如画作呼吸
export function createInkBloom(canvas, manifest, bgDir, opts = {}) {
  const noop = { destroy() {}, get active() { return 0; } };
  if (reducedMotion) return noop; // 减少动态：不启用晕染，仅静态背景

  const {
    mode = 'interactive',
    trailDist = 30,        // 鼠标拖尾生成间距（px）
    trailAlpha = [0.10, 0.17],
    ambientEvery = [1.6, 3.4],  // 交互层的环境墨晕间隔（秒）
    ambientAlpha = [0.05, 0.09],
    maxBlots = MAX_BLOTS,       // 同屏墨团上限
    sampleMid = false,          // 调色时同时采集中间调（让底层墨晕落在纸洗色调里）
    avoidRect = null,           // () => ({x0,y0,x1,y1}|null)：环境墨晕避开区域（画布坐标）
    ambient = {},               // ambient 模式细化参数（见下）
  } = opts;
  // ambient 模式参数（全部可调，文档见 docs/背景分层与转场系统.md）
  const A = {
    maxAlive: ambient.maxAlive ?? 5,        // 同时存活的墨晕数（克制）
    interval: ambient.interval ?? [3.5, 7], // 生成间隔（秒）
    maxR: ambient.maxR ?? [34, 110],        // 半径区间（大小差异明显）
    alpha: ambient.alpha ?? [0.05, 0.11],   // 峰值透明度（淡墨）
    grow: ambient.grow ?? [3, 6],           // 洇开时长（秒，很慢）
    hold: ambient.hold ?? [2, 5],           // 峰值保持（秒）
    fade: ambient.fade ?? [6, 12],          // 淡出时长（秒，很慢）
  };

  const ctx = canvas.getContext('2d');
  const noise = makeNoise((Math.random() * 1e9) | 0);
  const blots = [];
  const inkPool = [];   // 深松绿墨色（采自 dark 层）
  const goldPool = [];  // 金箔色（采自 gold 层）
  const midPool = [];   // 中间调（采自 mid 层，sampleMid 时启用）
  const ambientPts = []; // 有墨区域候选点（图像坐标，环境墨晕加权落点）
  let SW = 0, SH = 0, fit = { s: 1, ox: 0, oy: 0 };
  let raf = 0, running = false, disposed = false;
  let lastSpawn = null;
  let nextAmbient = mode === 'ambient' ? 1.5 : 1.2; // 秒（相对 start）

  function fitCover() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const s = Math.max(w / SW, h / SH);
    fit = { s, ox: (w - SW * s) / 2, oy: (h - SH * s) / 2 };
  }
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (SW) fitCover();
  }

  // ---------- 调色采样：墨色 / 金（/ 中间调）+ 有墨区域候选点 ----------
  async function prepare() {
    const roles = new Set(manifest.particle_sources || []);
    if (sampleMid) roles.add('mid');
    const srcs = manifest.layers.filter((l) => roles.has(l.role));
    for (const layer of srcs) {
      let img;
      try { img = await loadImage(bgDir + layer.file); } catch { continue; }
      const w = 320;
      const h = Math.round((w * img.naturalHeight) / img.naturalWidth);
      if (!SW) { SW = w; SH = h; }
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const octx = off.getContext('2d', { willReadFrequently: true });
      octx.drawImage(img, 0, 0, w, h);
      const data = octx.getImageData(0, 0, w, h).data;
      const pool = layer.role === 'gold' ? goldPool : layer.role === 'mid' ? midPool : inkPool;
      for (let y = 0; y < h; y += 2) {
        for (let x = 0; x < w; x += 2) {
          const i = (y * w + x) * 4;
          const a = data[i + 3];
          if (a > 34) pool.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
          if (layer.role === 'dark' && a > 60) ambientPts.push({ x, y });
        }
      }
    }
    // 抽稀，控制内存
    while (inkPool.length > 900) inkPool.splice((Math.random() * inkPool.length) | 0, 1);
    while (goldPool.length > 240) goldPool.splice((Math.random() * goldPool.length) | 0, 1);
    while (midPool.length > 600) midPool.splice((Math.random() * midPool.length) | 0, 1);
    while (ambientPts.length > 600) ambientPts.splice((Math.random() * ambientPts.length) | 0, 1);
    if (!SW) { SW = 320; SH = 213; } // 图层全缺失时兜底
    fitCover();
  }

  const pickColor = () => {
    if (goldPool.length && Math.random() < GOLD_PROB) {
      return goldPool[(Math.random() * goldPool.length) | 0];
    }
    // ambient 模式掺入中间调，让底层墨晕落在纸洗色调里
    const midProb = mode === 'ambient' ? 0.45 : 0;
    const pool = (sampleMid && midPool.length && Math.random() < midProb) ? midPool : inkPool;
    if (!pool.length) return { r: 43, g: 51, b: 39 }; // 松墨兜底
    return pool[(Math.random() * pool.length) | 0];
  };

  function spawn(x, y, { maxR, grow, hold, fade, alpha }) {
    if (disposed) return;
    if (blots.length >= maxBlots) blots.shift();
    blots.push({
      x, y, maxR, grow, hold, fade, alpha,
      born: performance.now() / 1000,
      seed: Math.random() * 100,
      fScale: 1.5 + Math.random() * 1.2,   // 边缘噪声角向频率
      evolve: 0.35 + Math.random() * 0.3,  // 湍流演化速度
      color: pickColor(),
    });
  }

  // 环境墨晕候选位置：优先落在画里已有墨的区域附近；避开 avoidRect（如文案块）
  function pickAmbientPos(margin) {
    const rect = avoidRect?.() || null;
    for (let tries = 0; tries < 4; tries++) {
      let x, y;
      if (ambientPts.length && Math.random() < 0.8) {
        const p = ambientPts[(Math.random() * ambientPts.length) | 0];
        x = fit.ox + p.x * fit.s + (Math.random() - 0.5) * 60;
        y = fit.oy + p.y * fit.s + (Math.random() - 0.5) * 60;
      } else {
        x = Math.random() * canvas.clientWidth;
        y = Math.random() * canvas.clientHeight;
      }
      if (rect && x > rect.x0 - margin && x < rect.x1 + margin
        && y > rect.y0 - margin && y < rect.y1 + margin) continue; // 命中避开区，重抽
      return { x, y };
    }
    return null; // 连续命中避开区，本轮放弃
  }

  function spawnAmbient() {
    if (mode === 'ambient') {
      if (blots.length >= A.maxAlive) return; // 克制：达到上限不再生
      const maxR = rr(A.maxR);
      const pos = pickAmbientPos(maxR * 0.4);
      if (!pos) return;
      spawn(pos.x, pos.y, {
        maxR,
        grow: rr(A.grow),
        hold: rr(A.hold),
        fade: rr(A.fade),
        alpha: rr(A.alpha),
      });
      return;
    }
    // 交互层的稀疏环境墨晕（小而淡）
    const pos = pickAmbientPos(30) || {
      x: Math.random() * canvas.clientWidth,
      y: Math.random() * canvas.clientHeight,
    };
    spawn(pos.x, pos.y, {
      maxR: 26 + Math.random() * 46,
      grow: 1.8 + Math.random() * 0.8,
      hold: 0.5 + Math.random() * 0.7,
      fade: 3 + Math.random() * 2,
      alpha: ambientAlpha[0] + Math.random() * (ambientAlpha[1] - ambientAlpha[0]),
    });
  }

  function drawBlot(b, t) {
    const age = t - b.born;
    let R, a;
    if (age < b.grow) {
      const k = age / b.grow;
      R = b.maxR * easeOutCubic(k);
      a = b.alpha * Math.min(1, age / (b.grow * 0.22));
    } else if (age < b.grow + b.hold) {
      R = b.maxR; a = b.alpha;
    } else {
      const fk = (age - b.grow - b.hold) / b.fade;
      if (fk >= 1) return false;
      R = b.maxR * (1 + 0.14 * fk);  // 淡出时微微继续洇开
      a = b.alpha * (1 - fk);
    }
    if (R < 0.5 || a <= 0.001) return true;

    // 噪声边缘（湍流置换感）：角向 fbm + 随时间演化
    ctx.beginPath();
    for (let i = 0; i <= VERTS; i++) {
      const th = (i / VERTS) * Math.PI * 2;
      const n = noise.fbm(Math.cos(th) * b.fScale + b.seed, Math.sin(th) * b.fScale + b.seed * 1.7 + t * b.evolve);
      const r = R * (0.66 + 0.34 * (0.5 + 0.5 * n));
      const px = b.x + Math.cos(th) * r;
      const py = b.y + Math.sin(th) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    const { r, g, b: bb } = b.color;
    const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, R * 1.18);
    grad.addColorStop(0, `rgba(${r},${g},${bb},${(a * 0.95).toFixed(3)})`);
    grad.addColorStop(0.55, `rgba(${r},${g},${bb},${(a * 0.5).toFixed(3)})`);
    grad.addColorStop(1, `rgba(${r},${g},${bb},0)`);
    ctx.fillStyle = grad;
    ctx.fill();
    // 墨心：更小半径的低透明度叠加，模拟积墨
    const core = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, R * 0.52);
    core.addColorStop(0, `rgba(${r},${g},${bb},${(a * 0.4).toFixed(3)})`);
    core.addColorStop(1, `rgba(${r},${g},${bb},0)`);
    ctx.fillStyle = core;
    ctx.fill();
    return true;
  }

  const startT = performance.now() / 1000;
  function tick() {
    if (!running) return;
    const t = performance.now() / 1000;
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    ctx.globalCompositeOperation = 'multiply'; // 宣纸积墨
    for (let i = blots.length - 1; i >= 0; i--) {
      if (!drawBlot(blots[i], t)) blots.splice(i, 1);
    }
    ctx.globalCompositeOperation = 'source-over';
    if (t - startT >= nextAmbient) {
      nextAmbient = t - startT + (mode === 'ambient'
        ? rr(A.interval)
        : ambientEvery[0] + Math.random() * (ambientEvery[1] - ambientEvery[0]));
      spawnAmbient();
    }
    raf = requestAnimationFrame(tick);
  }

  const start = () => { if (!running && !disposed) { running = true; raf = requestAnimationFrame(tick); } };
  const stop = () => { running = false; cancelAnimationFrame(raf); };

  const onMove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) { lastSpawn = null; return; }
    if (lastSpawn) {
      const dx = x - lastSpawn.x, dy = y - lastSpawn.y;
      if (dx * dx + dy * dy < trailDist * trailDist) return;
    }
    lastSpawn = { x, y };
    spawn(x, y, {
      maxR: 18 + Math.random() * 30,
      grow: 1.1 + Math.random() * 0.9,
      hold: 0.2 + Math.random() * 0.4,
      fade: 1.8 + Math.random() * 1.4,
      alpha: trailAlpha[0] + Math.random() * (trailAlpha[1] - trailAlpha[0]),
    });
  };
  const onVis = () => (document.hidden ? stop() : start());

  resize();
  prepare();
  window.addEventListener('resize', resize);
  if (mode === 'interactive') window.addEventListener('mousemove', onMove);
  document.addEventListener('visibilitychange', onVis);
  start();

  return {
    destroy() {
      disposed = true;
      stop();
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('visibilitychange', onVis);
    },
    get active() { return blots.length; },
  };
}
