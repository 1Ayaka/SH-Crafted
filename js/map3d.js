// 三维上海地图：加载用户提供的 shanghai_map.fbx（历史行政区划节点，按原样摆放）
// - 半透明苔绿/鼠尾草绿区块 + 松墨描边；渲染器透明底，分层背景画（bg2）从画布下透出
// - 进场：高远俯视 → 贝塞尔弧线俯冲 → 低斜近地的“身处地图中”机位（约 3.2s，可打断）
// - 悬停：区块缓慢上浮（仅 Y）、描边增强、其他区变暗
// - 点击：镜头沿弧线 tween 下潜（可中断），当前区更透明成为空间地台，其他区退为轮廓
// - 数据粒子：各区上方的墨点数量 ∝ 已接入项目数（大小/色泽的确定性变化与淡墨雾层为装饰，见页脚图例）
import * as THREE from 'three';
import { FBXLoader } from '../vendor/loaders/FBXLoader.js';
import { OrbitControls } from '../vendor/controls/OrbitControls.js';
import { reducedMotion } from './particles.js';

const INK = 0x2B3327;
const MOSS = 0x606C38;
const SAGE = 0x8B9D83;

const easeInOutQuart = (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2);

// 柔边墨点贴图（数据点与雾层共用，白色径向渐变，材质 color 染色）
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

export const DISTRICT_NODE_NAMES = [
  '上海市核心区', '南汇区', '嘉定区', '奉贤区', '宝山区', '崇明县',
  '松江区', '浦东新区', '金山区', '闵行区', '青浦区',
];

export async function createMap3D(container, hooks) {
  // hooks: { onHover(name|null, pos|null), onSelect(name), onBlank(), isLive(name), craftCount(name), onFrame(projectFn) }
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0); // 透明底：分层背景画从画布下透出
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.domElement.className = 'map3d-canvas';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene(); // 无 scene.background / 雾：保持透明，融入背景画

  const camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.1, 5000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.45; // 不允许钻到地图下方
  controls.screenSpacePanning = false;

  scene.add(new THREE.HemisphereLight(0xF4EBD8, SAGE, 1.0));
  const sun = new THREE.DirectionalLight(0xFFF1DA, 1.4);
  sun.position.set(0.4, 1, 0.35);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xE8DCC7, 0.35));

  // ---- 加载 FBX ----
  const loader = new FBXLoader();
  const fbx = await loader.loadAsync('assets/models/shanghai_map.fbx');
  scene.add(fbx);

  const districts = new Map(); // name -> { node, meshes, edgeMats, bodyMats, bbox, baseY, rise, riseTarget, points }
  fbx.traverse((o) => {
    if (DISTRICT_NODE_NAMES.includes(o.name) && !districts.has(o.name)) {
      districts.set(o.name, { node: o, meshes: [], edgeMats: [], bodyMats: [], baseY: o.position.y, rise: 0, riseTarget: 0 });
    }
  });
  if (!districts.size) throw new Error('FBX 中未找到任何行政区节点');

  const findDistrict = (o) => {
    let p = o;
    while (p) { if (districts.has(p.name)) return districts.get(p.name); p = p.parent; }
    return null;
  };

  const raycastTargets = [];
  let districtIndex = 0;
  fbx.traverse((o) => {
    if (!o.isMesh) return;
    const d = findDistrict(o);
    if (!d) return;
    if (d.index === undefined) d.index = districtIndex++;
    const live = hooks.isLive(d.node.name);
    const bodyColor = new THREE.Color(live ? MOSS : SAGE);
    bodyColor.offsetHSL((d.index % 4) * 0.018 - 0.02, live ? 0.02 : -0.06, live ? 0.02 : 0.1);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: bodyColor,
      transparent: true,
      opacity: live ? 0.68 : 0.3,
      roughness: 0.92,
      metalness: 0,
      depthWrite: true,
    });
    const edgeMat = new THREE.LineBasicMaterial({
      color: INK, transparent: true, opacity: live ? 0.5 : 0.28,
    });
    o.material = bodyMat;
    o.userData.district = d;
    d.meshes.push(o);
    d.bodyMats.push(bodyMat);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 24), edgeMat);
    edges.position.copy(o.position);
    edges.quaternion.copy(o.quaternion);
    edges.scale.copy(o.scale);
    o.parent.add(edges);
    d.edgeMats.push(edgeMat);
    raycastTargets.push(o);
  });

  for (const [name, d] of districts) {
    d.bbox = new THREE.Box3().setFromObject(d.node);
    d.name = name;
  }

  // ---- 数据粒子：墨点数量 ∝ 已接入项目数 ----
  // 大小/色泽按 (点序号, 区序号) 确定性散列分为三档（两档松墨 + 少量金箔点），变化为装饰；
  // 每点记录基准位置，主循环中做缓慢呼吸漂移；点密度始终 ∝ 项目数（图例保持真实）
  const globalBox = new THREE.Box3().setFromObject(fbx);
  const globalSize = globalBox.getSize(new THREE.Vector3());
  const globalCenter = globalBox.getCenter(new THREE.Vector3());
  const dotSize = Math.max(globalSize.x, globalSize.z) * 0.0075;
  const softDot = makeSoftDotTexture();
  const DOT_STYLES = [
    { color: INK, size: 0.7, opacity: 0.55 },
    { color: 0x3A4632, size: 1.05, opacity: 0.8 },
    { color: 0x9A7B36, size: 0.85, opacity: 0.7 }, // 金箔点（约 6%）
  ];
  const dotHash = (i, salt) => {
    let h = Math.imul(i + 1, 2654435761) ^ Math.imul(salt + 1, 40503);
    h ^= h >>> 13;
    return h >>> 0;
  };
  for (const d of districts.values()) {
    const count = hooks.craftCount(d.name);
    if (!count) continue;
    const n = count * 42;
    const bucketPos = [[], [], []];
    const c = d.bbox.getCenter(new THREE.Vector3());
    const s = d.bbox.getSize(new THREE.Vector3());
    for (let i = 0; i < n; i++) {
      const h = dotHash(i, d.index ?? 0);
      const bi = h % 17 === 0 ? 2 : h % 2; // ~6% 金箔点，其余两档墨色交替
      bucketPos[bi].push(
        c.x + (Math.random() - 0.5) * s.x * 0.86,
        d.bbox.max.y + Math.random() * s.y * 1.2 + dotSize * 2.5, // 低斜机位下需更高悬浮，避免被区块遮挡
        c.z + (Math.random() - 0.5) * s.z * 0.86,
      );
    }
    d.points = [];
    bucketPos.forEach((arr, bi) => {
      if (!arr.length) return;
      const pos = new Float32Array(arr);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const st = DOT_STYLES[bi];
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({
        color: st.color, size: dotSize * st.size, transparent: true, opacity: st.opacity,
        sizeAttenuation: true, map: softDot, depthWrite: false,
      }));
      pts.userData.base = pos.slice(); // 呼吸漂移基准
      scene.add(pts);
      d.points.push(pts);
    });
  }

  // ---- 淡墨雾层（装饰）：地面上方稀疏大墨点，极淡，缓慢呼吸；与数据墨点视觉可区分 ----
  const maxDimHaze = Math.max(globalSize.x, globalSize.z);
  const hazeN = 22;
  const hazePos = new Float32Array(hazeN * 3);
  for (let i = 0; i < hazeN; i++) {
    hazePos[i * 3] = globalCenter.x + (Math.random() - 0.5) * globalSize.x * 1.15;
    hazePos[i * 3 + 1] = globalBox.max.y * (0.35 + Math.random() * 0.85);
    hazePos[i * 3 + 2] = globalCenter.z + (Math.random() - 0.5) * globalSize.z * 1.15;
  }
  const hazeGeo = new THREE.BufferGeometry();
  hazeGeo.setAttribute('position', new THREE.BufferAttribute(hazePos, 3));
  const haze = new THREE.Points(hazeGeo, new THREE.PointsMaterial({
    color: SAGE, size: maxDimHaze * 0.06, transparent: true, opacity: 0.045,
    sizeAttenuation: true, map: softDot, depthWrite: false,
  }));
  scene.add(haze);

  // ---- 相机取景：低斜近地的“身处地图中”机位（仰角约 39°，比旧顶视更低更近）----
  const maxDim = Math.max(globalSize.x, globalSize.z);
  const fitDist = (maxDim / (2 * Math.tan((camera.fov * Math.PI) / 360))) * 1.06;
  const overviewDir = new THREE.Vector3(0.12, 0.62, 0.76).normalize(); // 仰角 ≈ 39°
  const overview = {
    pos: globalCenter.clone().add(overviewDir.clone().multiplyScalar(fitDist * 0.92)),
    target: globalCenter.clone(),
  };
  camera.position.copy(overview.pos);
  controls.target.copy(overview.target);
  controls.minDistance = fitDist * 0.16; // 允许更贴近地台
  controls.maxDistance = fitDist * 2.4;
  controls.update();

  // ---- 相机 tween：二次贝塞尔弧线路径 + easeInOutQuart（慢起 → 掠过 → 落定）----
  // pos(k) = (1-k)²·from + 2(1-k)k·ctrl + k²·to；ctrl 取中点并向上抬 arc 比例，形成先扬后落的弧线
  let tween = null;
  function tweenCamera(toPos, toTarget, duration = 1200, arc = 0.35) {
    if (reducedMotion) {
      camera.position.copy(toPos);
      controls.target.copy(toTarget);
      controls.update();
      return;
    }
    const fromPos = camera.position.clone();
    const ctrl = fromPos.clone().add(toPos).multiplyScalar(0.5);
    ctrl.y = Math.max(fromPos.y, toPos.y) * (1 + arc);
    tween = {
      fromPos, ctrl,
      fromTarget: controls.target.clone(),
      toPos: toPos.clone(), toTarget: toTarget.clone(), t: 0, duration,
    };
  }
  controls.addEventListener('start', () => { tween = null; }); // 用户操作可中断镜头

  // ---- 进场俯冲：高远俯视（≈90° 顶视）→ 弧线 swoop → 低斜机位，约 3.2s ----
  function playEnter() {
    if (reducedMotion) {
      camera.position.copy(overview.pos);
      controls.target.copy(overview.target);
      controls.update();
      return;
    }
    const startDir = new THREE.Vector3(0.06, 1.0, 0.14).normalize();
    camera.position.copy(globalCenter.clone().add(startDir.multiplyScalar(fitDist * 2.05)));
    controls.target.copy(overview.target);
    controls.update();
    tweenCamera(overview.pos, overview.target, 3200, 0.12);
  }

  // ---- 悬停 / 点击 ----
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovered = null;
  let pointerDirty = false;
  let lastClient = { x: 0, y: 0 };

  function applyHover(name) {
    if (hovered === name) return;
    hovered = name;
    for (const d of districts.values()) {
      const isHov = d.name === name;
      const dim = name && !isHov;
      const live = hooks.isLive(d.name);
      const focus = focused === d.name;
      const baseOpacity = focus ? 0.26 : live ? 0.68 : 0.3;
      d.bodyMats.forEach((m) => { m.opacity = dim ? baseOpacity * 0.4 : isHov ? Math.min(0.85, baseOpacity + 0.15) : baseOpacity; });
      d.edgeMats.forEach((m) => { m.opacity = dim ? 0.12 : isHov ? 0.85 : focus ? 0.6 : live ? 0.5 : 0.28; });
      d.riseTarget = isHov && !focused ? Math.max(d.bbox ? d.bbox.getSize(new THREE.Vector3()).y : 0, maxDim * 0.012) : 0;
      if (reducedMotion) d.rise = d.riseTarget;
    }
    renderer.domElement.style.cursor = name && hooks.isLive(name) ? 'pointer' : 'default';
  }

  renderer.domElement.addEventListener('pointermove', (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    lastClient = { x: e.clientX - r.left, y: e.clientY - r.top };
    pointerDirty = true;
  });
  renderer.domElement.addEventListener('pointerleave', () => { applyHover(null); hooks.onHover(null, null); });
  renderer.domElement.addEventListener('click', () => {
    if (hovered && hooks.isLive(hovered)) hooks.onSelect(hovered);
    else if (!hovered) hooks.onBlank();
  });

  // ---- 地区聚焦：沿弧线下降掠过城区上空，落向该区 ----
  let focused = null;
  function focusDistrict(name) {
    const d = districts.get(name);
    if (!d) return;
    focused = name;
    const c = d.bbox.getCenter(new THREE.Vector3());
    const s = d.bbox.getSize(new THREE.Vector3());
    const dist = Math.max(s.x, s.z) * 1.9;
    const dir = new THREE.Vector3(0.3, 0.55, 0.72).normalize(); // 仰角 ≈ 35°，贴近地台
    tweenCamera(c.clone().add(dir.multiplyScalar(dist)), c, 1500, 0.4);
    for (const o of districts.values()) {
      const isF = o === d;
      o.bodyMats.forEach((m) => { m.opacity = isF ? 0.26 : 0.05; });
      o.edgeMats.forEach((m) => { m.opacity = isF ? 0.6 : 0.12; });
      if (o.points) o.points.forEach((p) => { p.visible = isF; });
    }
  }
  function exitFocus() {
    if (!focused) return;
    focused = null;
    tweenCamera(overview.pos, overview.target, 1200, 0.35);
    applyHover(null);
    for (const d of districts.values()) { if (d.points) d.points.forEach((p) => { p.visible = true; }); }
  }

  // ---- 投影：世界坐标 → 容器内像素 ----
  const tmpV = new THREE.Vector3();
  function project(worldPos) {
    tmpV.copy(worldPos).project(camera);
    return {
      x: (tmpV.x * 0.5 + 0.5) * container.clientWidth,
      y: (-tmpV.y * 0.5 + 0.5) * container.clientHeight,
      behind: tmpV.z > 1,
    };
  }
  function districtAnchorWorld(name, index, total) {
    const d = districts.get(name);
    if (!d) return null;
    const c = d.bbox.getCenter(new THREE.Vector3());
    const s = d.bbox.getSize(new THREE.Vector3());
    const spread = total > 1 ? 0.36 : 0;
    const offset = total > 1 ? (index / (total - 1) - 0.5) * 2 * spread : 0;
    return new THREE.Vector3(c.x + offset * s.x, d.bbox.max.y + s.y * 0.5 + dotSize * 2, c.z);
  }
  function districtLabelWorld(name) {
    const d = districts.get(name);
    if (!d) return null;
    const c = d.bbox.getCenter(new THREE.Vector3());
    return new THREE.Vector3(c.x, d.bbox.max.y + dotSize * 4, c.z);
  }

  // ---- 筛选高亮 ----
  function setFilter(matchFnOrNull) {
    for (const d of districts.values()) {
      const live = hooks.isLive(d.name);
      const base = focused === d.name ? 0.26 : live ? 0.68 : 0.3;
      const hit = !matchFnOrNull || matchFnOrNull(d.name);
      d.bodyMats.forEach((m) => { m.opacity = hit ? base : base * 0.18; });
      d.edgeMats.forEach((m) => { m.opacity = hit ? (live ? 0.5 : 0.28) : 0.08; });
    }
  }

  // ---- 主循环 ----
  let active = true;
  let raf = 0;
  const clock = new THREE.Clock();
  function tick() {
    if (!active) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    if (tween) {
      tween.t += dt * 1000;
      const raw = Math.min(1, tween.t / tween.duration);
      const k = easeInOutQuart(raw); // 慢起 → 掠过 → 落定
      const u = 1 - k;
      camera.position.set(
        u * u * tween.fromPos.x + 2 * u * k * tween.ctrl.x + k * k * tween.toPos.x,
        u * u * tween.fromPos.y + 2 * u * k * tween.ctrl.y + k * k * tween.toPos.y,
        u * u * tween.fromPos.z + 2 * u * k * tween.ctrl.z + k * k * tween.toPos.z,
      );
      controls.target.lerpVectors(tween.fromTarget, tween.toTarget, k);
      if (raw >= 1) tween = null;
    }
    // 数据墨点呼吸漂移 + 雾层脉动（装饰性环境动效）
    if (!reducedMotion) {
      const bt = clock.elapsedTime;
      for (const d of districts.values()) {
        if (!d.points) continue;
        for (const pts of d.points) {
          if (!pts.visible) continue;
          const attr = pts.geometry.attributes.position;
          const base = pts.userData.base;
          const arr = attr.array;
          for (let i = 0; i < attr.count; i++) {
            arr[i * 3 + 1] = base[i * 3 + 1] + Math.sin(bt * 0.7 + i * 1.71) * dotSize * 0.55;
            arr[i * 3] = base[i * 3] + Math.sin(bt * 0.23 + i * 2.3) * dotSize * 0.3;
          }
          attr.needsUpdate = true;
        }
      }
      haze.material.opacity = 0.038 + (Math.sin(bt * 0.3) + 1) * 0.012;
    }
    // 上浮缓动（约 400–600ms 体感，仅 Y 方向）
    for (const d of districts.values()) {
      if (Math.abs(d.riseTarget - d.rise) > 0.0001) {
        d.rise += (d.riseTarget - d.rise) * (reducedMotion ? 1 : 0.08);
        d.node.position.y = d.baseY + d.rise;
      }
    }
    if (pointerDirty) {
      pointerDirty = false;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(raycastTargets, false)[0];
      const name = hit?.object?.userData?.district?.name || null;
      if (name !== hovered) {
        applyHover(name);
        hooks.onHover(name, name ? lastClient : null);
      } else if (name) {
        hooks.onHover(name, lastClient);
      }
    }
    controls.update();
    renderer.render(scene, camera);
    hooks.onFrame?.(project);
    raf = requestAnimationFrame(tick);
  }

  function setActive(v) {
    if (v === active) return;
    active = v;
    if (v) { clock.getDelta(); raf = requestAnimationFrame(tick); }
    else cancelAnimationFrame(raf);
  }

  const onVis = () => setActive(!document.hidden);
  document.addEventListener('visibilitychange', onVis);
  const ro = new ResizeObserver(() => {
    if (!container.clientWidth) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });
  ro.observe(container);

  raf = requestAnimationFrame(tick);

  return {
    focusDistrict,
    exitFocus,
    playEnter,
    setFilter,
    setActive,
    project,
    districtAnchorWorld,
    districtLabelWorld,
    get focused() { return focused; },
    districtNames: [...districts.keys()],
    dispose() {
      setActive(false);
      document.removeEventListener('visibilitychange', onVis);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        for (const m of [].concat(o.material || [])) m?.dispose?.();
      });
    },
  };
}
