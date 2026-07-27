// 墨粒引擎：贯穿全站的“有依据的墨粒聚散”
// - 纯 Canvas 2D，requestAnimationFrame，粒子数封顶
// - 页面隐藏时暂停；prefers-reduced-motion 时只静态渲染
// - 粒子聚（setTargets）对应数据/操作状态，散（scatter）对应离场

const REDUCED = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function cap() {
  const small = window.innerWidth < 900 || (navigator.hardwareConcurrency || 8) <= 4;
  return small ? 620 : 1400;
}

export class InkField {
  constructor(canvas, { color = '43, 51, 39', maxParticles } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.color = color;
    this.max = Math.min(maxParticles ?? cap(), 2000);
    this.particles = [];
    this.targets = [];
    this.raf = 0;
    this.running = false;
    this.t = 0;
    this._resize = this.resize.bind(this);
    this._tick = this.tick.bind(this);
    this._vis = () => { document.hidden ? this.stop() : this.start(); };
    window.addEventListener('resize', this._resize);
    document.addEventListener('visibilitychange', this._vis);
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // points: [{x, y, w?}] 画布坐标；w 为可选权重（粒子大小）
  setTargets(points, { scatterFirst = false } = {}) {
    this.targets = points;
    const n = Math.min(this.max, Math.max(points.length, 60));
    while (this.particles.length < n) this.particles.push(this._spawn(scatterFirst));
    this.particles.length = n;
    this.particles.forEach((p, i) => {
      const tp = points.length ? points[i % points.length] : { x: this.w / 2, y: this.h / 2 };
      p.tx = tp.x; p.ty = tp.y;
      p.size = 0.6 + ((tp.w ?? 0.5) * 1.7) + Math.random() * 0.5;
      p.gather = true;
      p.phase = Math.random() * Math.PI * 2;
      p.breath = 0.6 + Math.random() * 1.4;
    });
    if (REDUCED) this._drawStatic();
    else this.start();
  }

  scatter() {
    this.particles.forEach((p) => {
      p.gather = false;
      const a = Math.random() * Math.PI * 2;
      const sp = 0.4 + Math.random() * 1.6;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp - 0.3;
    });
    if (REDUCED) { this.ctx.clearRect(0, 0, this.w, this.h); this.particles = []; return; }
    this.start();
  }

  _spawn(anywhere) {
    return {
      x: Math.random() * this.w,
      y: anywhere ? Math.random() * this.h : -10 - Math.random() * 40,
      vx: 0, vy: 0, tx: 0, ty: 0,
      size: 1, gather: true, phase: 0, breath: 1, alpha: 0,
    };
  }

  start() {
    if (this.running || REDUCED) return;
    this.running = true;
    this.raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this._resize);
    document.removeEventListener('visibilitychange', this._vis);
  }

  tick() {
    if (!this.running) return;
    this.t += 0.016;
    const { ctx } = this;
    ctx.clearRect(0, 0, this.w, this.h);
    let alive = 0;
    for (const p of this.particles) {
      if (p.gather) {
        // 呼吸式目标偏移
        const bx = p.tx + Math.sin(this.t * p.breath + p.phase) * 2.2;
        const by = p.ty + Math.cos(this.t * p.breath * 0.8 + p.phase) * 2.2;
        p.vx += (bx - p.x) * 0.012;
        p.vy += (by - p.y) * 0.012;
        p.vx *= 0.9; p.vy *= 0.9;
        p.alpha = Math.min(0.85, p.alpha + 0.008);
      } else {
        p.vx *= 0.995; p.vy *= 0.995;
        p.vy += 0.004; // 轻微上扬后飘落
        p.alpha -= 0.006;
      }
      p.x += p.vx; p.y += p.vy;
      if (p.alpha > 0.01) {
        alive++;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${this.color},${p.alpha.toFixed(3)})`;
        ctx.fill();
      }
    }
    if (!alive && !this.particles.some((p) => p.gather)) { this.stop(); this.particles = []; return; }
    this.raf = requestAnimationFrame(this._tick);
  }

  _drawStatic() {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.w, this.h);
    for (const p of this.particles) {
      ctx.beginPath();
      ctx.arc(p.tx, p.ty, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${this.color},0.7)`;
      ctx.fill();
    }
  }
}

// 有机墨团目标点：多层正弦扰动的团块 + 外圈弥散
export function blotTargets(cx, cy, radius, count) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const wobble = 1 + 0.22 * Math.sin(a * 3 + 1.3) + 0.13 * Math.sin(a * 7 + 4.1) + 0.08 * Math.cos(a * 11);
    const rr = radius * wobble * Math.pow(Math.random(), 0.42);
    pts.push({
      x: cx + Math.cos(a) * rr,
      y: cy + Math.sin(a) * rr * 0.86,
      w: 1 - rr / (radius * 1.5),
    });
  }
  // 弥散尾迹
  for (let i = 0; i < count * 0.35; i++) {
    const a = -0.6 + Math.random() * 1.8;
    const rr = radius * (1.05 + Math.random() * 0.9);
    pts.push({
      x: cx + Math.cos(a) * rr + radius * 0.4,
      y: cy + Math.sin(a) * rr * 0.8 - radius * 0.5,
      w: 0.15,
    });
  }
  return pts;
}

// 从图片暗部采样目标点（墨粒聚成影像轮廓）
export function imageTargets(img, w, h, { threshold = 105, maxPoints = 1300 } = {}) {
  const off = document.createElement('canvas');
  const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight) * 0.92;
  const iw = Math.max(1, Math.round(img.naturalWidth * scale));
  const ih = Math.max(1, Math.round(img.naturalHeight * scale));
  off.width = iw; off.height = ih;
  const octx = off.getContext('2d', { willReadFrequently: true });
  octx.drawImage(img, 0, 0, iw, ih);
  const data = octx.getImageData(0, 0, iw, ih).data;
  const ox = (w - iw) / 2, oy = (h - ih) / 2;
  const pts = [];
  const stride = 2;
  for (let y = 0; y < ih; y += stride) {
    for (let x = 0; x < iw; x += stride) {
      const idx = (y * iw + x) * 4;
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      if (lum < threshold) {
        pts.push({ x: ox + x, y: oy + y, w: (threshold - lum) / threshold });
      }
    }
  }
  // 均匀抽稀到上限
  while (pts.length > maxPoints) pts.splice(Math.floor(Math.random() * pts.length), 1);
  return pts;
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// 将一张背景图拆成基础层、暗部、中间调和亮部，供首页做轻微的景深错动。
// 这是材质分层，不改变原图内容；透明度和位移由页面 CSS 控制。
export function mountLayeredTexture(root, src) {
  const layerRoot = document.createElement('div');
  layerRoot.className = 'texture-layers';
  layerRoot.setAttribute('aria-hidden', 'true');
  const names = ['base', 'deep', 'mid', 'light'];
  const canvases = names.map((name) => {
    const canvas = document.createElement('canvas');
    canvas.className = `texture-layer texture-${name}`;
    layerRoot.appendChild(canvas);
    return canvas;
  });
  root.prepend(layerRoot);
  let disposed = false;
  let raf = 0;

  const paint = (img) => {
    if (disposed) return;
    const rect = root.getBoundingClientRect();
    const w = Math.max(1, Math.min(960, Math.round(rect.width)));
    const h = Math.max(1, Math.round(rect.height));
    const iw = Math.max(1, Math.round(img.naturalWidth * Math.max(w / img.naturalWidth, h / img.naturalHeight)));
    const ih = Math.max(1, Math.round(img.naturalHeight * Math.max(w / img.naturalWidth, h / img.naturalHeight)));
    const source = document.createElement('canvas');
    source.width = iw; source.height = ih;
    source.getContext('2d').drawImage(img, (iw - w) / -2, (ih - h) / -2, iw, ih);
    const pixels = source.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    canvases.forEach((canvas) => { canvas.width = w; canvas.height = h; });
    const contexts = canvases.map((canvas) => canvas.getContext('2d'));
    const base = contexts[0].createImageData(w, h);
    const deep = contexts[1].createImageData(w, h);
    const mid = contexts[2].createImageData(w, h);
    const light = contexts[3].createImageData(w, h);
    for (let i = 0; i < pixels.length; i += 4) {
      const lum = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      const darkA = Math.max(0, Math.min(1, (132 - lum) / 110));
      const midA = Math.max(0, Math.min(1, 1 - Math.abs(lum - 128) / 92));
      const lightA = Math.max(0, Math.min(1, (lum - 118) / 130));
      for (const data of [base, deep, mid, light]) {
        data.data[i] = pixels[i]; data.data[i + 1] = pixels[i + 1]; data.data[i + 2] = pixels[i + 2];
      }
      base.data[i + 3] = 255;
      deep.data[i + 3] = Math.round(darkA * 200);
      mid.data[i + 3] = Math.round(midA * 150);
      light.data[i + 3] = Math.round(lightA * 180);
    }
    contexts[0].putImageData(base, 0, 0);
    contexts[1].putImageData(deep, 0, 0);
    contexts[2].putImageData(mid, 0, 0);
    contexts[3].putImageData(light, 0, 0);
  };

  loadImage(src).then((img) => {
    paint(img);
    const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => paint(img)); };
    window.addEventListener('resize', onResize);
    layerRoot._cleanup = () => window.removeEventListener('resize', onResize);
  }).catch(() => layerRoot.remove());

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    layerRoot._cleanup?.();
    layerRoot.remove();
  };
}

export const reducedMotion = REDUCED;
