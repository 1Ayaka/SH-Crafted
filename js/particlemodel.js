// 粒子化三维模型：把 GLB 表面采样为墨点云（实墨 → 洇散 → 飘散，沿遮罩连续渐变流动）
// 模型路径注册表在 js/config.js（CRAFT_MODEL_PATHS）；本模块保持通用：
//   createParticleModel(container, glbUrl, opts) → { el, setActive, scatter, zoomBy, resetZoom, playEnter, playDyeSweep, dispose }
//   preloadModel(glbUrl) / preloadPattern(imgUrl) → 提前加载（完成态成品模型即时揭晓用）
// - 表面采样：自写采样器按三角面积加权 + 重心插值（位置 + UV），总量 clamp 在 [MIN_PTS, MAX_PTS]
// - 遮罩驱动（assets/mask-gradient-ltr.png，左→右 黑→灰）映射模型局部 X 轴，**连续语义**：
//     v=0（黑）→ 完全稳定、最浓；v→1（灰）→ 漂移更快、更淡，但始终可见（轮廓不丢）
//     每颗墨点沿 +v 方向缓慢漂移，行尽（行程随 v 增大）渐隐后在自己的家位置重生（数量守恒）
// - 交互：拖拽旋转、滚轮/双指缩放；无拖拽点击 → 散墨：外爆 → 停顿 → 自行合并回家
// - opts.tint：单色原料（未染布 / 白纸）；opts.patternUrl：按平面 UV 从纹样图取色（药斑布成品）
// - playEnter()：弧线俯冲进场（完成态揭晓）；playDyeSweep()：染色扫过（原料色 → 纹样色）
// - prefers-reduced-motion：静态密实渲染（仍可拖拽旋转），无漂移/散墨/扫染动画
// - 性能：GLB 懒加载（本模块由页面 dynamic import），离屏/隐藏暂停，dispose 释放全部 GPU 资源
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { reducedMotion } from './particles.js';

const MASK_URL = 'assets/mask-gradient-ltr.png';
// ---- 可调参数 ----
const MIN_PTS = 24000, MAX_PTS = 60000, DENSITY = 12000; // N = clamp(面积×DENSITY)
const TARGET_DIM = 2.2;                  // 模型归一化后的最长边（世界单位）
const FADE_MIN = 0.55;                   // 灰端最低可见度（1 - FADE_MIN×v 为透明度下限系数）
const RESPAWN_FADE = 0.7;                // 漂移重生后的淡入时长（秒）
const SCATTER_BURST = 0.25, SCATTER_HOLD = 0.35, SCATTER_BACK = 1.7; // 散墨：外爆/停顿/合并（秒）
const ENTER_DUR = 1.7;                   // 进场弧线俯冲时长（秒）
const INK = new THREE.Color(0x2B3327), INK2 = new THREE.Color(0x3A4632);
const SAGE = new THREE.Color(0x8B9D83), GOLD = new THREE.Color(0x9A7B36);
// 药斑布纹样色池：靛蓝染区 / 防染白区
const INDIGO = [new THREE.Color(0x1E3A66), new THREE.Color(0x254A7A), new THREE.Color(0x2B406E)];
const RESIST = new THREE.Color(0xEDE6D4);

// ---- GLB / 纹样图：全模块共享预载缓存 ----
// 保留当前项目附近的少量模型即可；已完成的最久未使用项优先淘汰。
// 加载中的条目暂不淘汰，避免并发预载时对同一 GLB 发起重复请求；完成后会再次收缩。
const GLTF_CACHE_LIMIT = 3;
const gltfCache = new Map();

function trimGLTFCache() {
  while (gltfCache.size > GLTF_CACHE_LIMIT) {
    const oldestSettled = [...gltfCache].find(([, entry]) => entry.settled);
    if (!oldestSettled) return;
    gltfCache.delete(oldestSettled[0]);
  }
}

function loadGLTF(url) {
  const cached = gltfCache.get(url);
  if (cached) {
    // Map 的插入顺序即 LRU 顺序：命中后移到末尾。
    gltfCache.delete(url);
    gltfCache.set(url, cached);
    return cached.promise;
  }

  const entry = { promise: null, settled: false };
  entry.promise = new GLTFLoader().loadAsync(url).then(
    (gltf) => {
      entry.settled = true;
      trimGLTFCache();
      return gltf;
    },
    (error) => {
      entry.settled = true;
      // 统一清除拒绝态，createParticleModel 与 preloadModel 失败后都可正常重试。
      if (gltfCache.get(url) === entry) gltfCache.delete(url);
      throw error;
    },
  );
  gltfCache.set(url, entry);
  trimGLTFCache();
  return entry.promise;
}
export function preloadModel(url) { if (url) loadGLTF(url).catch(() => {}); }

const patternCache = new Map();
function loadPattern(url) {
  if (!patternCache.has(url)) {
    patternCache.set(url, new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const w = 256, h = 256;
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const cx = cv.getContext('2d', { willReadFrequently: true });
        cx.drawImage(img, 0, 0, w, h);
        const data = cx.getImageData(0, 0, w, h).data;
        // sample(u, v)（UV 空间，v 向上）→ { dyed, lum }：dyed=靛蓝染区
        resolve((u, v) => {
          const x = Math.max(0, Math.min(w - 1, Math.round(((u % 1) + 1) % 1 * (w - 1))));
          const y = Math.max(0, Math.min(h - 1, Math.round((1 - (((v % 1) + 1) % 1)) * (h - 1))));
          const i = (y * w + x) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const dyed = b > r + 14 && b >= g && (r + g + b) < 600;
          return { dyed, lum: (r + g + b) / 765 };
        });
      };
      img.onerror = () => resolve(null);
      img.src = url;
    }));
  }
  return patternCache.get(url);
}
export function preloadPattern(url) { if (url) loadPattern(url); }

// ---- 遮罩：全模块共享加载一次 ----
let maskPromise = null;
function loadMask() {
  if (!maskPromise) {
    maskPromise = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const w = 64, h = 8;
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const cx = cv.getContext('2d', { willReadFrequently: true });
        cx.drawImage(img, 0, 0, w, h);
        const data = cx.getImageData(0, 0, w, h).data;
        const row = new Float32Array(w);
        for (let x = 0; x < w; x++) {
          let lum = 0;
          for (let y = 0; y < h; y++) {
            const i = (y * w + x) * 4;
            lum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          }
          row[x] = lum / h / 255;
        }
        resolve((u) => row[Math.max(0, Math.min(w - 1, Math.round(u * (w - 1))))]);
      };
      img.onerror = () => resolve((u) => u); // 遮罩缺失：退化为按 X 线性渐变
      img.src = MASK_URL;
    });
  }
  return maskPromise;
}

// 柔边墨点贴图（与 map3d 同款径向渐变）
function makeSoftDotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// 成品粒子不再只取默认墨色：如果 GLB 带有 baseColorTexture，先把纹理缩放
// 到可控的像素缓存，再按采样点的 UV 取色。这样可以保留风筝的彩绘和皮影的
// 透雕细节，同时避免每个粒子都触发一次 canvas 读回。
const texturePixelCache = new WeakMap();
function getTexturePixels(texture) {
  const image = texture?.image;
  if (!image) return null;
  if (texturePixelCache.has(image)) return texturePixelCache.get(image);
  try {
    const maxSize = 512;
    const ratio = Math.min(1, maxSize / Math.max(image.width || maxSize, image.height || maxSize));
    const width = Math.max(1, Math.round((image.width || maxSize) * ratio));
    const height = Math.max(1, Math.round((image.height || maxSize) * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, width, height);
    const record = { width, height, data: ctx.getImageData(0, 0, width, height).data };
    texturePixelCache.set(image, record);
    return record;
  } catch (_) {
    texturePixelCache.set(image, null);
    return null;
  }
}

function makeMaterialColorSampler(material) {
  const base = material?.color?.clone?.() || new THREE.Color(0.72, 0.72, 0.72);
  const texture = material?.map || null;
  const pixels = getTexturePixels(texture);
  const texColor = new THREE.Color();
  return {
    sample(u, v, out) {
      out.copy(base);
      if (!pixels) return 1;
      const uu = ((u % 1) + 1) % 1;
      const vv = ((v % 1) + 1) % 1;
      const x = Math.max(0, Math.min(pixels.width - 1, Math.floor(uu * pixels.width)));
      const yCoord = texture?.flipY ? vv : 1 - vv;
      const y = Math.max(0, Math.min(pixels.height - 1, Math.floor(yCoord * pixels.height)));
      const i = (y * pixels.width + x) * 4;
      texColor.setRGB(
        pixels.data[i] / 255,
        pixels.data[i + 1] / 255,
        pixels.data[i + 2] / 255,
        THREE.SRGBColorSpace,
      );
      out.multiply(texColor);
      return pixels.data[i + 3] / 255;
    },
  };
}

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeInOutQuart = (t) => (t < 0.5 ? 8 * t ** 4 : 1 - Math.pow(-2 * t + 2, 4) / 2);

// 按面积加权的表面采样器（位置 + UV 重心插值，替代 MeshSurfaceSampler 以取 UV）
function makeSampler(mesh) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv || null;
  const idx = geo.index;
  const groups = geo.groups || [];
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const cum = new Float32Array(triCount);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  let total = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);
    ab.subVectors(b, a); ac.subVectors(c, a);
    total += ab.cross(ac).length() / 2;
    cum[t] = total;
  }
  const triOf = (r) => {
    let lo = 0, hi = triCount - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const materialIndexAt = (triangle) => {
    if (!Array.isArray(mesh.material)) return 0;
    const start = triangle * 3;
    const group = groups.find((g) => start >= g.start && start < g.start + g.count);
    return group?.materialIndex || 0;
  };
  return {
    area: total,
    sample(outP, outUV) {
      const t = triOf(Math.random() * total);
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      let r1 = Math.random(), r2 = Math.random();
      const sr1 = Math.sqrt(r1);
      const w0 = 1 - sr1, w1 = sr1 * (1 - r2), w2 = sr1 * r2;
      outP.set(
        pos.getX(i0) * w0 + pos.getX(i1) * w1 + pos.getX(i2) * w2,
        pos.getY(i0) * w0 + pos.getY(i1) * w1 + pos.getY(i2) * w2,
        pos.getZ(i0) * w0 + pos.getZ(i1) * w1 + pos.getZ(i2) * w2,
      ).applyMatrix4(mesh.matrixWorld);
      if (uv && outUV) {
        outUV.u = uv.getX(i0) * w0 + uv.getX(i1) * w1 + uv.getX(i2) * w2;
        outUV.v = uv.getY(i0) * w0 + uv.getY(i1) * w1 + uv.getY(i2) * w2;
      } else if (outUV) { outUV.u = 0; outUV.v = 0; }
      return materialIndexAt(t);
    },
  };
}

/**
 * 在 container 内挂载一个粒子模型。返回 Promise<handle>；失败 reject（调用方回退平面关键帧）。
 * opts:
 *   pointSize / alpha / flowSpeed / diffuseSpeed —— 微调
 *   tint: 0xRRGGBB —— 单色原料（未染布、白纸等），覆盖默认墨绿/鼠尾草/金调色板
 *   patternUrl —— 平面 UV → 纹样图取色（成品药斑布）；patternRepeat: [横, 纵] 平铺次数
 *   solidMode —— 保留实体网格并替换为地图同系玉石材质；粒子仅作点缀
 * handle = { el, setActive(v), scatter(), zoomBy(factor), resetZoom(), playEnter(), playDyeSweep(dur?), dispose() }
 */
export async function createParticleModel(container, url, opts = {}) {
  const {
    pointSize = 0.02,       // 墨点基础尺寸（世界单位，归一化后）
    alpha = 0.88,           // 实体区峰值透明度
    flowSpeed = 0.10,       // 漂移基础流速（世界单位/秒，乘 v）
    diffuseSpeed = 0.02,    // 噪声摆动幅度
    tint = null,
    patternUrl = null,
    patternRepeat = [1, 2],
    detailMode = false,     // 成品态：提高采样密度并压低漂移，保留小构件和轮廓
    dropRate = detailMode ? 0.075 : 0, // 成品粒子轻微下坠，渐隐后从原位补回
    looseAmount = 0,        // 完成前预览：在成品轮廓周围增加细碎离散量；完成态保持 0
    solidMode = false,
    particleFraction = solidMode ? 0.2 : 1,
  } = opts;

  const loadingEl = document.createElement('div');
  loadingEl.className = 'pm-loading';
  loadingEl.textContent = '模型加载中…';
  container.appendChild(loadingEl);

  const [gltf, maskAt, patternAt] = await Promise.all([
    loadGLTF(url),
    loadMask(),
    patternUrl ? loadPattern(patternUrl) : Promise.resolve(null),
  ]);

  // ---------- 表面采样（位置 + UV） ----------
  const meshes = [];
  gltf.scene.updateWorldMatrix(true, true);
  gltf.scene.traverse((o) => { if (o.isMesh && o.geometry?.attributes?.position) meshes.push(o); });
  if (!meshes.length) throw new Error('GLB 中未找到网格');
  const samplers = meshes.map(makeSampler);
  const materialSamplers = meshes.map((mesh) => {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    return materials.map(makeMaterialColorSampler);
  });
  const totalArea = samplers.reduce((s, x) => s + x.area, 0);
  const minPoints = detailMode ? 48000 : MIN_PTS;
  const maxPoints = detailMode ? 100000 : MAX_PTS;
  const density = detailMode ? 20000 : DENSITY;
  const total = Math.max(minPoints, Math.min(maxPoints, Math.round(totalArea * density)));

  const home = new Float32Array(total * 3);   // 归一化后的家位置
  const uvs = new Float32Array(total * 2);    // 平面 UV（纹样取色 / 染色扫过用）
  const p = new THREE.Vector3();
  const uvTmp = { u: 0, v: 0 };
  let k = 0;
  const rawPts = [];
  const sampledMeshIndices = new Uint8Array(total);
  const sampledMaterialIndices = new Uint8Array(total);
  const bbox = new THREE.Box3();
  // 给每个网格保留最低采样额，避免成品的细小配件因面积占比太低而消失。
  const perMeshFloor = detailMode ? Math.min(96, Math.floor(total / meshes.length / 2)) : 1;
  const proportionalBudget = Math.max(0, total - perMeshFloor * meshes.length);
  for (let m = 0; m < meshes.length; m++) {
    const n = perMeshFloor + Math.round((samplers[m].area / totalArea) * proportionalBudget);
    for (let i = 0; i < n && k < total; i++, k++) {
      sampledMeshIndices[k] = m;
      sampledMaterialIndices[k] = samplers[m].sample(p, uvTmp) || 0;
      rawPts.push(p.x, p.y, p.z);
      uvs[k * 2] = uvTmp.u; uvs[k * 2 + 1] = uvTmp.v;
      bbox.expandByPoint(p);
    }
  }
  const count = k;
  const size = bbox.getSize(new THREE.Vector3());
  const center = bbox.getCenter(new THREE.Vector3());
  const norm = TARGET_DIM / Math.max(size.x, size.y, size.z);

  // 平面模型自动转正：最薄轴朝向镜头（如 XZ 水平面 → 立起为 XY）
  let baseRotX = 0;
  if (size.y <= Math.min(size.x, size.z) * 0.05) baseRotX = -Math.PI / 2;

  const maskV = new Float32Array(count);      // 遮罩值 v（0=黑 稳定 … 1=灰 稀疏）
  for (let i = 0; i < count; i++) {
    const x = rawPts[i * 3], y = rawPts[i * 3 + 1], z = rawPts[i * 3 + 2];
    const loosePhase = (i + 1) * 12.9898;
    const looseScale = looseAmount * (0.38 + ((i * 2654435761 >>> 0) % 997) / 997 * 0.62);
    home[i * 3] = (x - center.x) * norm + Math.sin(loosePhase) * looseScale;
    home[i * 3 + 1] = (y - center.y) * norm + Math.cos(loosePhase * 1.37) * looseScale;
    home[i * 3 + 2] = (z - center.z) * norm + Math.sin(loosePhase * 0.73) * looseScale;
    maskV[i] = maskAt((x - bbox.min.x) / (size.x || 1)) * (detailMode ? 0.22 : 1);
  }

  // ---------- 颜色 / 尺寸 / 状态 ----------
  const colors = new Float32Array(count * 3);      // 当前色（渲染）
  const colorsRaw = new Float32Array(count * 3);   // 原料色（染色扫过起点）
  const colorsPat = new Float32Array(count * 3);   // 纹样色（染色扫过终点 = 成品呈现）
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  const offset = new Float32Array(count * 3);      // 当前漂移偏移
  const phase = new Float32Array(count);           // 个体相位
  const fade = new Float32Array(count);            // 重生淡入 0→1
  const hash = (i) => {
    let h = Math.imul(i + 1, 2654435761);
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  };
  const c = new THREE.Color();
  const tintColor = tint != null ? new THREE.Color(tint) : null;
  for (let i = 0; i < count; i++) {
    const h = hash(i);
    let sizeMul = 1, alphaMul = 1;
    if (patternAt) {
      // 纹样取色：靛蓝染区 / 防染白区（白区更稀更淡）
      const s = patternAt(uvs[i * 2] * patternRepeat[0], uvs[i * 2 + 1] * patternRepeat[1]);
      if (s.dyed) {
        c.copy(INDIGO[(h * INDIGO.length) | 0]).offsetHSL(0, 0, (h - 0.5) * 0.06);
      } else {
        c.copy(RESIST).offsetHSL(0, 0, (h - 0.5) * 0.05);
        sizeMul = 0.62; alphaMul = 0.5;
      }
    } else if (tintColor) {
      c.copy(tintColor).offsetHSL(0, 0, (h - 0.5) * 0.07);
    } else {
      const colorSampler = materialSamplers[sampledMeshIndices[i]]?.[sampledMaterialIndices[i]];
      if (colorSampler) {
        const textureAlpha = colorSampler.sample(uvs[i * 2], uvs[i * 2 + 1], c);
        // 透明贴图仍保留少量骨架点，避免细线或操纵杆因采样落在透明像素上消失。
        alphaMul *= 0.52 + textureAlpha * 0.48;
        sizeMul *= 0.86 + textureAlpha * 0.14;
      } else if (h % 0.997 < 0.08) c.copy(GOLD);
      else if (h < 0.45) c.copy(INK);
      else if (h < 0.8) c.copy(INK2);
      else c.copy(SAGE);
    }
    colorsPat[i * 3] = c.r; colorsPat[i * 3 + 1] = c.g; colorsPat[i * 3 + 2] = c.b;
    // 原料色：有纹样时起点为未染布色；否则与成品同色（无扫染需求）
    if (patternAt) {
      const rc = tintColor || new THREE.Color(0xDCD2BA);
      colorsRaw[i * 3] = rc.r; colorsRaw[i * 3 + 1] = rc.g; colorsRaw[i * 3 + 2] = rc.b;
    } else {
      colorsRaw[i * 3] = c.r; colorsRaw[i * 3 + 1] = c.g; colorsRaw[i * 3 + 2] = c.b;
    }
    colors[i * 3] = colorsRaw[i * 3]; colors[i * 3 + 1] = colorsRaw[i * 3 + 1]; colors[i * 3 + 2] = colorsRaw[i * 3 + 2];
    sizes[i] = pointSize * (0.7 + h * 0.9) * sizeMul;
    alphas[i] = h <= particleFraction ? alpha * (0.75 + h * 0.25) * alphaMul : 0;
    phase[i] = h * Math.PI * 2;
    fade[i] = 1;
  }

  // ---------- 渲染 ----------
  loadingEl.remove();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.94;
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.domElement.className = 'pm-canvas';
  renderer.domElement.dataset.modelMode = detailMode ? 'finished-detail' : (looseAmount > 0 ? 'finished-loose-preview' : 'standard');
  renderer.domElement.dataset.looseAmount = String(looseAmount);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, container.clientWidth / container.clientHeight, 0.1, 100);
  const camHome = new THREE.Vector3(0, 0.35, 3.72); // TARGET_DIM 2.2 + 边距，fov40 下完整入画
  camera.position.copy(camHome);
  camera.lookAt(0, 0, 0);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(home.slice(0, count * 3), 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas.slice(), 1)); // 拷贝一份作渲染缓冲：tick 每帧读 alphas（基础值）写 alphaArr，必须隔离否则透明度逐帧连乘衰减
  const softTex = makeSoftDotTexture();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: softTex }, uScale: { value: 1 }, uFade: { value: 1 } },
    vertexShader: `
      attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
      uniform float uScale; uniform float uFade;
      varying vec3 vColor; varying float vAlpha;
      void main() {
        vColor = aColor; vAlpha = aAlpha * uFade;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      varying vec3 vColor; varying float vAlpha;
      void main() {
        float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vColor, a);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  const group = new THREE.Group();
  group.add(points);
  scene.add(group);

  // 完成态保留真实网格细节，材质沿用地图的半透玉石参数；点云只覆盖少量表面并向下飘落。
  const solidMaterials = [];
  const solidGeometries = [];
  if (solidMode) {
    const jadeBase = new THREE.Color(0x81977d);
    const makeJadeMaterial = (sourceMaterial, materialIndex) => {
      const source = sourceMaterial || {};
      const hasTexture = Boolean(source.map);
      const originalColor = source.color?.clone?.() || new THREE.Color(0xd7ddcf);
      // 有贴图时只覆一层很轻的玉色，避免把模型原有彩绘重新染成单色。
      originalColor.lerp(jadeBase, hasTexture ? 0.1 : 0.32);
      originalColor.offsetHSL((materialIndex % 3 - 1) * 0.008, -0.025, 0.015);
      const sourceOpacity = Number.isFinite(source.opacity) ? source.opacity : 1;
      const baseOpacity = Math.min(hasTexture ? 0.64 : 0.69, Math.max(0.5, sourceOpacity * (hasTexture ? 0.62 : 0.67)));
      const material = new THREE.MeshPhysicalMaterial({
        name: `${source.name || '原模型材质'} · 半透明玉石`,
        color: originalColor,
        map: source.map || null,
        alphaMap: source.alphaMap || null,
        normalMap: source.normalMap || null,
        normalScale: source.normalScale?.clone?.() || new THREE.Vector2(1, 1),
        bumpMap: source.bumpMap || null,
        bumpScale: Number.isFinite(source.bumpScale) ? source.bumpScale * 0.7 : 0.035,
        roughnessMap: source.roughnessMap || null,
        metalnessMap: source.metalnessMap || null,
        aoMap: source.aoMap || null,
        aoMapIntensity: Number.isFinite(source.aoMapIntensity) ? source.aoMapIntensity : 0.75,
        emissive: source.emissive?.clone?.().multiplyScalar(0.45) || new THREE.Color(0x000000),
        emissiveMap: source.emissiveMap || null,
        emissiveIntensity: Number.isFinite(source.emissiveIntensity) ? source.emissiveIntensity * 0.45 : 0,
        transparent: true,
        opacity: baseOpacity,
        transmission: hasTexture ? 0.18 : 0.24,
        thickness: 0.28,
        attenuationColor: 0x8fa58a,
        attenuationDistance: 1.8,
        ior: 1.43,
        roughness: Math.max(0.78, Number.isFinite(source.roughness) ? source.roughness : 0.82),
        metalness: Math.min(0.08, Number(source.metalness) || 0),
        clearcoat: 0.012,
        clearcoatRoughness: 0.96,
        specularIntensity: 0.18,
        specularColor: 0xdde6d9,
        alphaTest: Number(source.alphaTest) || 0,
        depthWrite: true,
        side: source.side ?? THREE.DoubleSide,
      });
      material.userData.baseOpacity = baseOpacity;
      solidMaterials.push(material);
      return material;
    };
    meshes.forEach((sourceMesh, index) => {
      const solidGeometry = sourceMesh.geometry.clone();
      solidGeometry.applyMatrix4(sourceMesh.matrixWorld);
      solidGeometry.translate(-center.x, -center.y, -center.z);
      solidGeometries.push(solidGeometry);
      const sourceHasMaterialArray = Array.isArray(sourceMesh.material);
      const sourceMaterials = sourceHasMaterialArray ? sourceMesh.material : [sourceMesh.material];
      const convertedMaterials = sourceMaterials.map((material, materialIndex) => makeJadeMaterial(material, index + materialIndex));
      // Three.js 只有带 geometry groups 的网格才能使用材质数组；单材质网格必须继续传单个材质。
      const solidMaterial = sourceHasMaterialArray ? convertedMaterials : convertedMaterials[0];
      const mesh = new THREE.Mesh(solidGeometry, solidMaterial);
      mesh.renderOrder = -1;
      group.add(mesh);
    });
    group.scale.setScalar(norm);
    points.scale.setScalar(1 / norm);
    scene.add(new THREE.HemisphereLight(0xf4ebd8, 0x566a59, 1.25));
    const jadeLight = new THREE.DirectionalLight(0xfff1da, 1.5);
    jadeLight.position.set(-2.4, 4.5, 3.2);
    scene.add(jadeLight);
    scene.add(new THREE.AmbientLight(0xe8dcc7, 0.35));
  }

  function setUScale() {
    const hpx = renderer.domElement.height; // 绘制缓冲像素高
    mat.uniforms.uScale.value = (hpx * camera.zoom) / (2 * Math.tan((camera.fov * Math.PI) / 360));
  }
  setUScale();

  // ---------- 交互：拖拽旋转 + 点击散墨 + 滚轮/双指缩放 ----------
  const rot = { x: 0, y: 0, vx: 0, vy: 0, dragging: false, sx: 0, sy: 0, moved: 0, t0: 0 };
  const zoom = { current: 1, target: 1, min: 0.62, max: 1.9 };
  const pointers = new Map();
  let pinchStartDistance = 0;
  let pinchStartZoom = 1;
  let pinching = false;
  const el = renderer.domElement;
  el.style.cursor = 'grab';
  let scatterAge = -1;               // <0 无散墨
  const SCATTER_DUR = SCATTER_BURST + SCATTER_HOLD + SCATTER_BACK;
  let enterAge = -1;                 // <0 无进场
  let enterFrom = null;
  let dyeAge = -1;                   // <0 无染色扫过
  let dyeDur = 2.6;
  let revealFade = 1;
  let currentScatterAmp = 0;
  const clampZoom = (value) => Math.max(zoom.min, Math.min(zoom.max, value));
  const setZoomTarget = (value) => { zoom.target = clampZoom(value); };
  const pointerDistance = () => {
    const pts = [...pointers.values()];
    return pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
  };
  const onDown = (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    el.setPointerCapture(e.pointerId);
    if (pointers.size >= 2) {
      pinching = true;
      pinchStartDistance = pointerDistance() || 1;
      pinchStartZoom = zoom.target;
      rot.dragging = false;
      rot.moved = 999;
      el.style.cursor = 'grabbing';
      return;
    }
    rot.dragging = true; rot.sx = e.clientX; rot.sy = e.clientY;
    rot.moved = 0; rot.t0 = performance.now(); rot.vx = 0; rot.vy = 0;
    el.style.cursor = 'grabbing';
  };
  const onMove = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) {
      const distance = pointerDistance();
      if (distance > 0) setZoomTarget(pinchStartZoom * (distance / pinchStartDistance));
      return;
    }
    if (!rot.dragging) return;
    const dx = e.clientX - rot.sx, dy = e.clientY - rot.sy;
    rot.moved += Math.abs(dx) + Math.abs(dy);
    rot.sx = e.clientX; rot.sy = e.clientY;
    rot.y += dx * 0.005;
    rot.x = Math.max(-0.5, Math.min(0.5, rot.x + dy * 0.004));
    rot.vy = dx * 0.005; rot.vx = dy * 0.004;
  };
  const onUp = (e) => {
    pointers.delete(e.pointerId);
    if (pinching) {
      if (pointers.size < 2) pinching = false;
      if (pointers.size === 1) {
        const remaining = [...pointers.values()][0];
        rot.sx = remaining.x; rot.sy = remaining.y; rot.dragging = true; rot.moved = 999;
      } else if (!pointers.size) {
        rot.dragging = false;
        el.style.cursor = 'grab';
      }
      return;
    }
    if (!rot.dragging) return;
    rot.dragging = false;
    el.style.cursor = 'grab';
    // 无拖拽点击 → 散墨（外爆 → 停顿 → 自行合并回家）
    if (rot.moved < 6 && performance.now() - rot.t0 < 450 && !reducedMotion) scatterAge = 0;
  };
  const onWheel = (e) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? container.clientHeight : 1;
    setZoomTarget(zoom.target * Math.exp(-e.deltaY * unit * 0.0012));
  };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('wheel', onWheel, { passive: false });

  // ---------- 主循环 ----------
  const posAttr = geo.attributes.position;
  const alphaAttr = geo.attributes.aAlpha;
  const colorAttr = geo.attributes.aColor;
  const posArr = posAttr.array;
  const alphaArr = alphaAttr.array;
  const colorArr = colorAttr.array;
  let active = true, raf = 0, timer = 0, last = performance.now();

  // 调度：优先 rAF；rAF 饥饿环境（headless 虚拟时间截图、极端节流）由 setTimeout 心跳兜底
  function schedule() {
    raf = requestAnimationFrame(tick);
    timer = setTimeout(() => { cancelAnimationFrame(raf); tick(); }, 120);
  }

  function tick() {
    if (!active) return;
    clearTimeout(timer);
    // 统一用 performance.now() 作时钟：headless 虚拟时间下 rAF 回调时间戳可能冻结或与时钟不同源；
    // dt 钳到 [0, 0.05]，避免后台标签页恢复或时钟跳变把计时器打成负数
    const now = performance.now();
    const dt = Math.max(0, Math.min((now - last) / 1000, 0.05));
    last = now;
    const t = now / 1000;

    // 进场弧线俯冲：相机自高远处沿弧线落位，点云整体淡入
    if (enterAge >= 0) {
      enterAge += dt;
      const p = Math.min(enterAge / ENTER_DUR, 1);
      const e = easeInOutQuart(p);
      camera.position.set(
        enterFrom.x * (1 - e) + camHome.x * e + Math.sin(e * Math.PI) * 0.7,
        enterFrom.y * (1 - e) + camHome.y * e,
        enterFrom.z * (1 - e) + camHome.z * e,
      );
      camera.lookAt(0, 0, 0);
      mat.uniforms.uFade.value = easeOutCubic(p);
      revealFade = easeOutCubic(p);
      if (p >= 1) { enterAge = -1; camera.position.copy(camHome); camera.lookAt(0, 0, 0); mat.uniforms.uFade.value = 1; }
    }

    // 阻尼自转
    if (!rot.dragging && (Math.abs(rot.vx) > 1e-5 || Math.abs(rot.vy) > 1e-5)) {
      rot.y += rot.vy; rot.x = Math.max(-0.5, Math.min(0.5, rot.x + rot.vx));
      rot.vx *= 0.94; rot.vy *= 0.94;
    }
    group.rotation.y = rot.y;
    group.rotation.x = baseRotX + rot.x;

    // 缩放采用相机 zoom，避免改变模型归一化尺寸；缓动兼容滚轮和触控板的连续输入。
    if (Math.abs(zoom.current - zoom.target) > 0.0005) {
      zoom.current += (zoom.target - zoom.current) * Math.min(1, dt * 12);
      camera.zoom = zoom.current;
      camera.updateProjectionMatrix();
      setUScale();
    }

    // 染色扫过（原料色 → 纹样色，front 沿 UV-u 推进，带噪声边缘）
    if (dyeAge >= 0) {
      dyeAge += dt;
      const p = Math.min(dyeAge / dyeDur, 1);
      const front = -0.12 + 1.3 * easeInOutCubic(p);
      for (let i = 0; i < count; i++) {
        const n = Math.sin(phase[i] * 37.7) * 0.09;
        const mix = Math.max(0, Math.min(1, (front - (uvs[i * 2] + n)) / 0.09 + 0.5));
        const i3 = i * 3;
        colorArr[i3] = colorsRaw[i3] + (colorsPat[i3] - colorsRaw[i3]) * mix;
        colorArr[i3 + 1] = colorsRaw[i3 + 1] + (colorsPat[i3 + 1] - colorsRaw[i3 + 1]) * mix;
        colorArr[i3 + 2] = colorsRaw[i3 + 2] + (colorsPat[i3 + 2] - colorsRaw[i3 + 2]) * mix;
      }
      colorAttr.needsUpdate = true;
      if (p >= 1) dyeAge = -1;
    }

    if (!reducedMotion) {
      if (scatterAge >= 0) scatterAge += dt;
      // 散墨包络：外爆（easeOut）→ 停顿 → 合并回家（easeInOut）
      let scAmp = 0;
      if (scatterAge >= 0) {
        const a = scatterAge;
        if (a < SCATTER_BURST) scAmp = easeOutCubic(a / SCATTER_BURST);
        else if (a < SCATTER_BURST + SCATTER_HOLD) scAmp = 1;
        else if (a < SCATTER_DUR) scAmp = 1 - easeInOutCubic((a - SCATTER_BURST - SCATTER_HOLD) / SCATTER_BACK);
        else { scatterAge = -1; scAmp = 0; }
      }
      currentScatterAmp = scAmp;
      const driftDamp = 1 - scAmp * 0.85; // 散墨期间漂移被压制，保证干净合并
      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        const v = maskV[i];
        const h = phase[i];
        // 连续漂移：速度随 v 增大；行尽渐隐后回家重生（数量守恒）
        let ox = offset[i3] + v * flowSpeed * (0.7 + 0.6 * Math.sin(h * 5)) * dt * driftDamp;
        let oy = offset[i3 + 1] + Math.sin(t * 0.9 + h * 3.7) * diffuseSpeed * v * dt;
        let oz = offset[i3 + 2] + Math.cos(t * 0.8 + h * 2.9) * diffuseSpeed * v * dt;
        // 成品不是整块同时坠落：不同遮罩密度的点以不同速度向下散开，
        // 到达下方阈值后淡出并在家位置重新出现，形成自然的呼吸式消散。
        const dropWeight = detailMode
          ? Math.max(0, v - 0.012) * (0.82 + 0.18 * Math.sin(h * 23.7))
          : 0;
        oy -= dropRate * dropWeight * dt;
        // 稳定区微颤（不累积）
        const tremor = 0.006 * (1 - v * 0.55);
        ox += Math.sin(t * 1.3 + h) * tremor * 0.12;
        oy += Math.cos(t * 1.1 + h * 1.7) * tremor * 0.12;
        const maxTravel = 0.08 + v * 0.32;
        const kT = maxTravel > 0 ? ox / maxTravel : 0;
        const dropTravel = detailMode ? Math.max(0, -oy) / (0.12 + v * 0.62) : 0;
        const travel = Math.max(kT, dropTravel);
        let aMul;
        if (travel >= 1) { ox = 0; oy = 0; oz = 0; fade[i] = 0; aMul = 0; }
        else {
          if (fade[i] < 1) fade[i] = Math.min(1, fade[i] + dt / RESPAWN_FADE);
          const travelFade = travel > 0.55 ? 1 - ((travel - 0.55) / 0.45) * 0.85 : 1;
          aMul = fade[i] * travelFade * (1 - FADE_MIN * v);
        }
        offset[i3] = ox; offset[i3 + 1] = oy; offset[i3 + 2] = oz;
        // 散墨位移（径向外爆 + 噪声涡）
        let sx = 0, sy = 0, sz = 0;
        if (scAmp > 0) {
          const hx = home[i3], hy = home[i3 + 1], hz = home[i3 + 2];
          const len = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
          const amp = scAmp * (0.32 + 0.4 * Math.sin(h * 13));
          sx = (hx / len) * amp + Math.sin(h * 91 + scatterAge * 6) * 0.09 * scAmp;
          sy = (hy / len) * amp + Math.cos(h * 57 + scatterAge * 5) * 0.09 * scAmp;
          sz = (hz / len) * amp;
        }
        posArr[i3] = home[i3] + ox + sx;
        posArr[i3 + 1] = home[i3 + 1] + oy + sy;
        posArr[i3 + 2] = home[i3 + 2] + oz + sz;
        alphaArr[i] = alphas[i] * aMul * (scAmp > 0 ? 1 - scAmp * 0.35 : 1);
      }
      posAttr.needsUpdate = true;
      alphaAttr.needsUpdate = true;
    }
    if (solidMode) {
      const scatterVisibility = 1 - currentScatterAmp * 0.94;
      solidMaterials.forEach((material) => {
        material.opacity = material.userData.baseOpacity * revealFade * scatterVisibility;
      });
    }
    renderer.render(scene, camera);
    schedule();
  }

  function setActive(v) {
    if (v === active) return;
    active = v;
    if (v) { last = performance.now(); schedule(); }
    else { cancelAnimationFrame(raf); clearTimeout(timer); }
  }
  const onVis = () => setActive(!document.hidden);
  document.addEventListener('visibilitychange', onVis);
  const io = new IntersectionObserver((entries) => {
    setActive(entries[0]?.isIntersecting !== false && !document.hidden);
  }, { threshold: 0.02 });
  io.observe(el);
  const ro = new ResizeObserver(() => {
    if (!container.clientWidth) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
    setUScale();
  });
  ro.observe(container);

  schedule();

  return {
    el,
    setActive,
    scatter() { if (!reducedMotion) scatterAge = 0; },
    zoomBy(factor) { setZoomTarget(zoom.target * factor); },
    resetZoom() { setZoomTarget(1); },
    // 完成态揭晓：相机弧线俯冲进场（模型已预载，立即开始）
    playEnter() {
      if (reducedMotion) return;
      enterFrom = new THREE.Vector3(1.8, 3.4, 9.6);
      camera.position.copy(enterFrom);
      mat.uniforms.uFade.value = 0;
      enterAge = 0;
    },
    // 染色扫过：原料色 → 纹样色（药斑布染靛）；reduced-motion 瞬时完成
    playDyeSweep(dur = 2.6) {
      if (!patternAt) return;
      if (reducedMotion) {
        colorArr.set(colorsPat.subarray(0, count * 3));
        colorAttr.needsUpdate = true;
        return;
      }
      dyeDur = dur;
      dyeAge = 0;
    },
    dispose() {
      setActive(false);
      document.removeEventListener('visibilitychange', onVis);
      io.disconnect();
      ro.disconnect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      geo.dispose();
      mat.dispose();
      solidGeometries.forEach((geometry) => geometry.dispose());
      solidMaterials.forEach((material) => material.dispose());
      softTex.dispose();
      renderer.dispose();
      el.remove();
    },
  };
}
