// 三维上海地图：加载用户提供的 上海map_v2.glb（含实体厚度与上海以外区域）
// - 顶部实体、底部渐隐的玉石区块 + 松墨描边；渲染器透明底，分层背景画从画布下透出
// - 进场：高远俯视 → 贝塞尔弧线俯冲 → 低斜近地的“身处地图中”机位（约 3.2s，可打断）
// - 悬停：区块缓慢上浮（仅 Y）、描边增强、其他区变暗
// - 点击：镜头沿弧线 tween 下潜（可中断），当前区更透明成为空间地台，其他区退为轮廓
// - 数据粒子：从行政区底部轮廓沿多尺度噪声形成黑白水墨瀑布
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { OrbitControls } from '../vendor/controls/OrbitControls.js';
import { reducedMotion } from './particles.js';

const SAGE = 0x8B9D83;
const JADE_BOTTOM = 0x3C493D;
const INK_PARTICLE = 0x252622;
const OUTSIDE_NODE_NAME = '以外的陆地';

const easeInOutQuart = (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2);

function ensurePlanarUv(geometry, matrixWorld, mapBounds) {
  const position = geometry.getAttribute('position');
  if (!position) return;
  const spanX = Math.max(mapBounds.max.x - mapBounds.min.x, 0.0001);
  const spanZ = Math.max(mapBounds.max.z - mapBounds.min.z, 0.0001);
  const uv = new Float32Array(position.count * 2);
  const world = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    world.fromBufferAttribute(position, i).applyMatrix4(matrixWorld);
    uv[i * 2] = (world.x - mapBounds.min.x) / spanX;
    uv[i * 2 + 1] = (world.z - mapBounds.min.z) / spanZ;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function offsetPlanarUv(geometry, seed) {
  const uv = geometry.getAttribute('uv');
  if (!uv) return;
  // 每个区从贴图的不同位置、不同尺度取样，避免行政区之间出现机械重复。
  const offsetX = ((Math.sin(seed * 12.9898) * 43758.5453) % 1 + 1) % 1;
  const offsetY = ((Math.sin(seed * 78.233) * 19341.1379) % 1 + 1) % 1;
  const scale = 1.2 + (((Math.sin(seed * 31.17) * 15731.743) % 1 + 1) % 1) * 0.48;
  for (let i = 0; i < uv.count; i += 1) {
    uv.setXY(i, uv.getX(i) * scale + offsetX, uv.getY(i) * scale + offsetY);
  }
  uv.needsUpdate = true;
}

function makeJadeTexture(image) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 768;
  const context = canvas.getContext('2d');
  let atlasSeed = 0x74657874;
  const atlasRand = () => {
    atlasSeed = (Math.imul(atlasSeed, 1664525) + 1013904223) >>> 0;
    return atlasSeed / 4294967296;
  };
  context.fillStyle = '#b9c5b2';
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Seeded 4×4 atlas samples the complete supplied painting instead of only
  // taking its centre crop. Slight overlaps soften tile seams; restrained
  // contrast keeps both the dark cyan and pale paper areas usable as jade.
  const grid = 4;
  const cell = canvas.width / grid;
  const sourceMin = Math.min(image.width, image.height);
  context.globalAlpha = 0.68;
  context.filter = 'saturate(48%) contrast(58%) brightness(121%) blur(0.45px)';
  for (let row = 0; row < grid; row += 1) {
    for (let col = 0; col < grid; col += 1) {
      const sourceSize = sourceMin * (0.24 + atlasRand() * 0.14);
      const sourceX = THREE.MathUtils.clamp(
        ((col + atlasRand() * 0.82) / grid) * image.width - sourceSize * 0.34,
        0,
        image.width - sourceSize,
      );
      const sourceY = THREE.MathUtils.clamp(
        ((row + atlasRand() * 0.82) / grid) * image.height - sourceSize * 0.34,
        0,
        image.height - sourceSize,
      );
      context.drawImage(
        image,
        sourceX, sourceY, sourceSize, sourceSize,
        col * cell - 5, row * cell - 5, cell + 10, cell + 10,
      );
    }
  }
  context.filter = 'none';
  context.globalAlpha = 0.24;
  context.globalCompositeOperation = 'screen';
  context.fillStyle = '#dce4d4';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = 'source-over';
  context.globalAlpha = 1;

  // Mineral threads keep the supplied painting recognizable as a pixel
  // source while adding the fine internal structure expected from jade.
  let seed = 0x6a616465;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  context.save();
  context.globalCompositeOperation = 'soft-light';
  context.lineCap = 'round';
  for (let i = 0; i < 34; i += 1) {
    const startX = -80 + rand() * 928;
    const startY = rand() * 768;
    const direction = rand() > 0.5 ? 1 : -1;
    context.beginPath();
    context.moveTo(startX, startY);
    context.bezierCurveTo(
      startX + direction * (90 + rand() * 160),
      startY - 80 + rand() * 160,
      startX + direction * (220 + rand() * 240),
      startY - 120 + rand() * 240,
      startX + direction * (390 + rand() * 320),
      startY - 100 + rand() * 200,
    );
    context.strokeStyle = rand() > 0.34
      ? `rgba(38,66,48,${0.025 + rand() * 0.045})`
      : `rgba(231,238,220,${0.04 + rand() * 0.06})`;
    context.lineWidth = 0.7 + rand() * 2.4;
    context.stroke();
  }
  context.restore();
  return new THREE.CanvasTexture(canvas);
}

function makeJadeEnvironment() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  const base = context.createLinearGradient(0, 0, 0, canvas.height);
  base.addColorStop(0, '#cdd8c8');
  base.addColorStop(0.44, '#81917d');
  base.addColorStop(1, '#38443a');
  context.fillStyle = base;
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const [x, y, radius, alpha] of [
    [190, 120, 190, 0.82],
    [760, 210, 150, 0.48],
    [520, 420, 260, 0.22],
  ]) {
    const glow = context.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, `rgba(244,235,211,${alpha})`);
    glow.addColorStop(1, 'rgba(244,235,211,0)');
    context.fillStyle = glow;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function applyVerticalJadeGradient(material, minY, maxY) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.jadeMinY = { value: minY };
    shader.uniforms.jadeMaxY = { value: maxY };
    shader.uniforms.jadeBottomColor = { value: new THREE.Color(JADE_BOTTOM) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float jadeMinY;\nuniform float jadeMaxY;\nvarying float vJadeHeight;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvJadeHeight = clamp((position.y - jadeMinY) / max(jadeMaxY - jadeMinY, 0.0001), 0.0, 1.0);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 jadeBottomColor;\nvarying float vJadeHeight;`)
      .replace('#include <map_fragment>', `
        #include <map_fragment>
        float jadeSolid = smoothstep(0.03, 0.72, vJadeHeight);
        diffuseColor.rgb = mix(jadeBottomColor, diffuseColor.rgb, smoothstep(0.02, 0.58, vJadeHeight));
        diffuseColor.a *= mix(0.08, 1.0, jadeSolid);
      `);
  };
  material.customProgramCacheKey = () => 'vertical-jade-gradient-v2';
}

function collectBottomTriangles(mesh, districtBox) {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  if (!position) return [];
  const index = geometry.getIndex();
  const districtHeight = Math.max(districtBox.max.y - districtBox.min.y, 0.0001);
  const bottomLimit = districtBox.min.y + districtHeight * 0.045;
  const triangles = [];
  let cumulativeArea = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const triangleCount = index ? index.count / 3 : position.count / 3;
  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const ia = index ? index.getX(triangleIndex * 3) : triangleIndex * 3;
    const ib = index ? index.getX(triangleIndex * 3 + 1) : triangleIndex * 3 + 1;
    const ic = index ? index.getX(triangleIndex * 3 + 2) : triangleIndex * 3 + 2;
    a.fromBufferAttribute(position, ia).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(position, ib).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(position, ic).applyMatrix4(mesh.matrixWorld);
    if (Math.max(a.y, b.y, c.y) > bottomLimit) continue;
    const area = ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() * 0.5;
    if (area < 1e-7) continue;
    cumulativeArea += area;
    triangles.push({ a: a.clone(), b: b.clone(), c: c.clone(), area, cumulativeArea });
  }
  return triangles;
}

function collectBottomEdgeSegments(mesh, edgeGeometry, districtBox) {
  const position = edgeGeometry.getAttribute('position');
  if (!position) return [];
  const height = Math.max(districtBox.max.y - districtBox.min.y, 0.0001);
  const bottomLimit = districtBox.min.y + height * 0.07;
  const segments = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let i = 0; i + 1 < position.count; i += 2) {
    a.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(position, i + 1).applyMatrix4(mesh.matrixWorld);
    if (a.y > bottomLimit || b.y > bottomLimit) continue;
    const length = a.distanceTo(b);
    if (length < 1e-5) continue;
    segments.push({ a: a.clone(), b: b.clone(), length, cumulativeLength: 0 });
  }
  return segments;
}

function sampleEdge(segment, target = new THREE.Vector3()) {
  return target.lerpVectors(segment.a, segment.b, Math.random());
}

function flowDensity(x, z, time, seed, scale) {
  const nx = x / Math.max(scale, 0.0001);
  const nz = z / Math.max(scale, 0.0001);
  const broad = Math.sin(nx * 10.7 + seed * 0.71 + Math.sin(nz * 7.3 - time * 0.13));
  const medium = Math.sin(nz * 18.2 - seed * 1.13 + Math.cos(nx * 13.5 + time * 0.09));
  const fine = Math.sin((nx + nz) * 31.7 + seed * 2.17 - time * 0.21);
  const value = 0.5 + 0.5 * (broad * 0.58 + medium * 0.28 + fine * 0.14);
  return THREE.MathUtils.clamp(0.08 + Math.pow(THREE.MathUtils.clamp(value, 0, 1), 1.55) * 0.92, 0.08, 1);
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
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
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
  const jadeEnvironment = makeJadeEnvironment();
  scene.environment = jadeEnvironment;

  // ---- 加载带真实厚度的 GLB ----
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync('assets/models/上海map_v2.glb');
  const mapRoot = gltf.scene;
  scene.add(mapRoot);

  // The supplied painting is used as low-contrast pixel grain, rather than
  // pasted over the districts at full strength. Planar UVs keep it available
  // even when a future GLB export omits texture coordinates.
  let jadeTexture = null;
  let jadeBumpTexture = null;
  try {
    const jadeSource = await new THREE.TextureLoader().loadAsync('assets/t地图贴图.png');
    jadeTexture = makeJadeTexture(jadeSource.image);
    jadeSource.dispose();
    jadeTexture.colorSpace = THREE.SRGBColorSpace;
    jadeTexture.wrapS = jadeTexture.wrapT = THREE.MirroredRepeatWrapping;
    jadeTexture.repeat.set(1.18, 1.18);
    jadeTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    jadeBumpTexture = jadeTexture.clone();
    jadeBumpTexture.colorSpace = THREE.NoColorSpace;
    jadeBumpTexture.needsUpdate = true;
    renderer.domElement.dataset.jadeTextureLoaded = 'true';
    renderer.domElement.dataset.jadeTextureSource = 't地图贴图.png';
  } catch (error) {
    renderer.domElement.dataset.jadeTextureLoaded = 'false';
    renderer.domElement.dataset.jadeTextureSource = 't地图贴图.png';
    console.warn('玉石纹理加载失败，地图继续使用半透明玉色材质。', error);
  }

  const districts = new Map(); // name -> { node, meshes, edgeMats, bodyMats, bbox, baseY, rise, riseTarget, points }
  mapRoot.traverse((o) => {
    if (DISTRICT_NODE_NAMES.includes(o.name) && !districts.has(o.name)) {
      districts.set(o.name, { node: o, meshes: [], edgeMats: [], bodyMats: [], baseY: o.position.y, rise: 0, riseTarget: 0 });
    }
  });
  if (!districts.size) throw new Error('上海map_v2.glb 中未找到任何行政区节点');

  const findDistrict = (o) => {
    let p = o;
    while (p) { if (districts.has(p.name)) return districts.get(p.name); p = p.parent; }
    return null;
  };

  mapRoot.updateMatrixWorld(true);
  const mapTextureBox = new THREE.Box3();
  for (const d of districts.values()) mapTextureBox.union(new THREE.Box3().setFromObject(d.node));

  const raycastTargets = [];
  let districtIndex = 0;
  mapRoot.traverse((o) => {
    if (!o.isMesh) return;
    const d = findDistrict(o);
    if (!d) {
      let p = o;
      let isOutside = false;
      while (p) {
        if (p.name === OUTSIDE_NODE_NAME) { isOutside = true; break; }
        p = p.parent;
      }
      if (!isOutside) return;
      const outsideMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x7E827F,
        transparent: true,
        opacity: 0.24,
        transmission: 0.04,
        roughness: 0.8,
        metalness: 0,
        clearcoat: 0.08,
        clearcoatRoughness: 0.82,
        depthWrite: false,
        side: THREE.FrontSide,
      });
      o.material = outsideMaterial;
      o.renderOrder = -1;
      o.userData.isOutsideLand = true;
      return;
    }
    if (d.index === undefined) d.index = districtIndex++;
    const live = hooks.isLive(d.node.name);
    ensurePlanarUv(o.geometry, o.matrixWorld, mapTextureBox);
    offsetPlanarUv(o.geometry, (d.index + 1) * 17.31 + d.meshes.length * 7.13);
    o.geometry.computeBoundingBox();
    const localSize = o.geometry.boundingBox.getSize(new THREE.Vector3());
    const footprint = Math.max(localSize.x, localSize.z);

    const bodyColor = new THREE.Color(live ? 0x9FB493 : 0xBAC4B3);
    bodyColor.offsetHSL((d.index % 4) * 0.012 - 0.018, live ? -0.04 : -0.1, live ? 0.015 : 0.055);
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: bodyColor,
      map: jadeTexture,
      bumpMap: jadeBumpTexture,
      bumpScale: Math.max(0.012, localSize.y * 0.018),
      roughnessMap: jadeBumpTexture,
      transparent: true,
      opacity: 1,
      transmission: live ? 0.14 : 0.08,
      thickness: Math.max(0.25, localSize.y * 0.72),
      attenuationColor: live ? 0x83A07E : 0xABB5A5,
      attenuationDistance: Math.max(0.45, localSize.y * 1.8),
      ior: 1.47,
      roughness: 0.56,
      metalness: 0,
      clearcoat: 0.34,
      clearcoatRoughness: 0.22,
      specularIntensity: 0.7,
      specularColor: 0xE3EADC,
      envMapIntensity: 0.82,
      depthWrite: true,
      side: THREE.FrontSide,
      dithering: true,
    });
    applyVerticalJadeGradient(bodyMat, o.geometry.boundingBox.min.y, o.geometry.boundingBox.max.y);
    const edgeMat = new THREE.LineBasicMaterial({
      // The seams should read as a faint mineral joint, not a black GIS grid.
      // Hover/focus raises opacity below, while the resting map stays cohesive.
      color: live ? 0xAFB7A6 : 0xC2BCA8,
      transparent: true,
      opacity: live ? 0.085 : 0.045,
      depthWrite: false,
      toneMapped: true,
    });
    o.material = bodyMat;
    o.renderOrder = 1;
    o.userData.district = d;
    d.meshes.push(o);
    d.bodyMats.push(bodyMat);
    const edgeGeometry = new THREE.EdgesGeometry(o.geometry, 24);
    const edges = new THREE.LineSegments(edgeGeometry, edgeMat);
    edges.renderOrder = 3;
    o.add(edges);
    d.edgeMats.push(edgeMat);
    if (!d.edgeGeometries) d.edgeGeometries = [];
    d.edgeGeometries.push({ geometry: edgeGeometry, mesh: o });
    raycastTargets.push(o);
  });

  renderer.domElement.dataset.mapMaterial = 'translucent-jade';
  renderer.domElement.dataset.particleMotion = 'removed';
  renderer.domElement.dataset.particleStyle = 'removed';
  renderer.domElement.dataset.edgeStyle = 'subtle-jade-mineral';
  renderer.domElement.dataset.waterLayer = 'removed';
  renderer.domElement.dataset.districtCount = String(districts.size);
  renderer.domElement.dataset.clickableDistrictCount = String(districts.size);

  for (const [name, d] of districts) {
    d.bbox = new THREE.Box3().setFromObject(d.node);
    d.name = name;
  }

  // 地图页保持干净的玉石地台，不再渲染边缘瀑布粒子；成品粒子只在详情页出现。
  // 出生点从真实底面三角形按面积取样，多尺度流动噪声控制局部疏密与横向摆动。
  const globalBox = new THREE.Box3().setFromObject(mapRoot);
  const globalSize = globalBox.getSize(new THREE.Vector3());
  const globalCenter = globalBox.getCenter(new THREE.Vector3());
  const maxDim = Math.max(globalSize.x, globalSize.z);
  const mapParticlesEnabled = false;

  // A slightly larger sprite makes each fall read as a liquid drop instead of
  // airborne dust. The long point sprite contains both the drop and its trail.
  const dotSize = Math.max(globalSize.x, globalSize.z) * 0.092;
  const particleFloor = globalBox.min.y - maxDim * 0.24;
  const particleMaterial = new THREE.ShaderMaterial({
    uniforms: {
      viewportScale: { value: container.clientHeight * renderer.getPixelRatio() * 0.5 },
    },
    vertexShader: `
      attribute vec3 color;
      attribute float particleSize;
      attribute float particleOpacity;
      attribute float particleInk;
      varying vec3 vParticleColor;
      varying float vParticleOpacity;
      varying float vParticleInk;
      uniform float viewportScale;
      void main() {
        vParticleColor = color;
        vParticleOpacity = particleOpacity;
        vParticleInk = particleInk;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        // Keep the silhouette legible at overview distance. A hard lower bound
        // prevents the droplets collapsing back into one-pixel "dust".
        gl_PointSize = clamp(
          particleSize * viewportScale / max(0.001, -viewPosition.z),
          8.5,
          27.0
        );
      }
    `,
    fragmentShader: `
      varying vec3 vParticleColor;
      varying float vParticleOpacity;
      varying float vParticleInk;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;

        // A crisp teardrop: round water body low in the sprite, tapering into a
        // fine vertical neck. fwidth keeps the silhouette sharp at every zoom.
        vec2 bulbP = vec2(p.x * 1.08, (p.y + 0.35) * 1.02);
        float bulbSdf = length(bulbP) - 0.42;
        float taper = mix(0.045, 0.17, clamp((0.66 - p.y) / 0.98, 0.0, 1.0));
        float neckSdf = max(abs(p.x) - taper, max(-0.18 - p.y, p.y - 0.72));
        float dropSdf = min(bulbSdf, neckSdf);
        float aa = max(fwidth(dropSdf) * 1.15, 0.006);
        float drop = 1.0 - smoothstep(-aa, aa, dropSdf);

        // A narrow ink stroke gives the drop a hand-brushed tail without using
        // a coloured glow or a hard digital streak.
        float trailMask = (1.0 - smoothstep(0.08, 0.34, abs(p.x)))
          * smoothstep(-0.14, 0.12, p.y)
          * (1.0 - smoothstep(0.68, 0.98, p.y))
          * vParticleInk;
        float trailCore = (1.0 - smoothstep(0.0, 0.105, abs(p.x)))
          * smoothstep(-0.10, 0.22, p.y)
          * (1.0 - smoothstep(0.72, 0.97, p.y))
          * vParticleInk;

        // Paper-white edge, charcoal body and uneven ink density give the
        // waterfall a monochrome xuan-paper reading.
        float inside = 1.0 - smoothstep(-0.16, -0.025, dropSdf);
        float rim = max(0.0, drop - inside);
        float highlight = smoothstep(0.12, 0.0, length(vec2(p.x + 0.12, p.y + 0.48)));
        vec3 inkBlack = vec3(0.08, 0.08, 0.075);
        vec3 inkGrey = vec3(0.42, 0.41, 0.38);
        vec3 paperWhite = vec3(0.92, 0.9, 0.83);
        vec3 inkBody = mix(inkGrey, inkBlack, clamp(vParticleInk * 0.72 + 0.12, 0.0, 1.0));
        vec3 finalColor = mix(inkBody, paperWhite, 0.08 + rim * 0.76 + highlight * 0.62);
        finalColor = mix(finalColor, inkBlack, trailCore * 0.58 + trailMask * 0.14);
        float alpha = max(drop * (0.94 + rim * 0.06), trailMask * 0.64 + trailCore * 0.9)
          * vParticleOpacity;
        if (alpha < 0.035) discard;
        gl_FragColor = vec4(finalColor, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: true,
  });

  const chooseEdgeSample = (points, time) => {
    const { edgeSegments, totalEdgeLength, seed } = points.userData;
    let fallback = null;
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const edgeCursor = Math.random() * totalEdgeLength;
      let low = 0;
      let high = edgeSegments.length - 1;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (edgeSegments[middle].cumulativeLength < edgeCursor) low = middle + 1;
        else high = middle;
      }
      const point = sampleEdge(edgeSegments[low]);
      const density = flowDensity(point.x, point.z, time, seed, maxDim);
      fallback = { point, density };
      if (Math.random() <= density * 0.92) return fallback;
    }
    return fallback;
  };

  const resetFallingParticle = (points, index, initial = false, time = 0) => {
    const {
      district, districtCenter, speed, driftX, driftZ, phase, age, life, density,
    } = points.userData;
    const sample = chooseEdgeSample(points, time);
    const positions = points.geometry.attributes.position.array;
    const spawnY = sample.point.y + (district?.rise || 0);
    speed[index] = maxDim * (0.038 + Math.random() * 0.05) * (0.82 + sample.density * 0.46);
    const radialX = sample.point.x - districtCenter.x;
    const radialZ = sample.point.z - districtCenter.z;
    const radialLength = Math.max(0.0001, Math.hypot(radialX, radialZ));
    const lip = maxDim * (0.003 + sample.density * 0.004);
    const peel = maxDim * (0.0035 + sample.density * 0.0045);
    driftX[index] = (radialX / radialLength) * peel + (Math.random() - 0.5) * maxDim * 0.0022;
    driftZ[index] = (radialZ / radialLength) * peel + (Math.random() - 0.5) * maxDim * 0.0022;
    phase[index] = Math.random() * Math.PI * 2;
    density[index] = sample.density;
    const inkAttribute = points.geometry.attributes.particleInk;
    if (inkAttribute) {
      inkAttribute.array[index] = sample.density > 0.58 && Math.random() < 0.42 ? 1 : 0.23;
      inkAttribute.needsUpdate = true;
    }
    life[index] = Math.max(0.8, (spawnY - particleFloor) / speed[index]);
    age[index] = initial ? Math.random() * life[index] : 0;
    positions[index * 3] = sample.point.x + (radialX / radialLength) * lip;
    positions[index * 3 + 1] = spawnY - speed[index] * age[index];
    positions[index * 3 + 2] = sample.point.z + (radialZ / radialLength) * lip;
  };
  mapRoot.updateMatrixWorld(true);
  let totalParticleCount = 0;
  let totalBottomTriangleCount = 0;
  let totalEdgeSampleCount = 0;
  for (const d of mapParticlesEnabled ? districts.values() : []) {
    const count = hooks.craftCount(d.name);
    const bottomTriangles = d.meshes.flatMap((mesh) => collectBottomTriangles(mesh, d.bbox));
    const edgeSegments = (d.edgeGeometries || []).flatMap(({ geometry, mesh }) => (
      collectBottomEdgeSegments(mesh, geometry, d.bbox)
    ));
    if (!edgeSegments.length) continue;
    let totalEdgeLength = 0;
    for (const segment of edgeSegments) {
      totalEdgeLength += segment.length;
      segment.cumulativeLength = totalEdgeLength;
    }
    // Fewer, larger drops keep the silhouette legible and avoid a dusty field.
    const n = 30 + count * 15;
    totalParticleCount += n;
    totalBottomTriangleCount += bottomTriangles.length;
    totalEdgeSampleCount += edgeSegments.length;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const speed = new Float32Array(n);
    const driftX = new Float32Array(n);
    const driftZ = new Float32Array(n);
    const phase = new Float32Array(n);
    const age = new Float32Array(n);
    const life = new Float32Array(n);
    const density = new Float32Array(n);
    const sizes = new Float32Array(n);
    const opacities = new Float32Array(n);
    const inkLevels = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('particleSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('particleOpacity', new THREE.BufferAttribute(opacities, 1));
    geo.setAttribute('particleInk', new THREE.BufferAttribute(inkLevels, 1));
    const pts = new THREE.Points(geo, particleMaterial);
    pts.renderOrder = 2;
    Object.assign(pts.userData, {
      edgeSegments,
      totalEdgeLength,
      speed,
      driftX,
      driftZ,
      phase,
      age,
      life,
      density,
      district: d,
      districtCenter: d.bbox.getCenter(new THREE.Vector3()),
      seed: (d.index + 1) * 1.618,
    });
    const bottomColor = new THREE.Color(INK_PARTICLE);
    for (let i = 0; i < n; i++) {
      resetFallingParticle(pts, i, true, Math.random() * 24);
      colors[i * 3] = bottomColor.r;
      colors[i * 3 + 1] = bottomColor.g;
      colors[i * 3 + 2] = bottomColor.b;
      const progress = age[i] / life[i];
      sizes[i] = dotSize * (0.78 + density[i] * 0.58) * (1 - progress * 0.15);
      opacities[i] = (0.82 + density[i] * 0.18) * (1 - THREE.MathUtils.smoothstep(progress, 0.8, 1));
      // Seeded by the already-noisy density field: darker ink gathers in a few
      // moving streams rather than appearing as a uniform decorative effect.
      inkLevels[i] = density[i] > 0.58 && Math.random() < 0.42 ? 1 : 0.23;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.attributes.particleSize.needsUpdate = true;
    geo.attributes.particleOpacity.needsUpdate = true;
    geo.attributes.particleInk.needsUpdate = true;
    scene.add(pts);
    d.points = [pts];
    d.particlePaused = false;
  }
  renderer.domElement.dataset.particleCount = '0';
  renderer.domElement.dataset.bottomTriangleCount = '0';
  renderer.domElement.dataset.edgeSampleCount = '0';

  // No airborne haze: the space above the jade stays clear for labels and project cards.

  // ---- 相机取景：低斜近地的“身处地图中”机位（仰角约 39°，比旧顶视更低更近）----
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

  function applyHover(name, force = false) {
    if (!force && hovered === name) return;
    hovered = name;
    for (const d of districts.values()) {
      const isHov = d.name === name;
      const dim = name && !isHov;
      const live = hooks.isLive(d.name);
      const focus = focused === d.name;
      const wasPaused = d.particlePaused;
      d.particlePaused = Boolean(isHov && !focused);
      if (d.particlePaused && !wasPaused && d.points) {
        // 区块抬起时，停止补充新粒子；已有粒子获得一次向外、向下的“抖落”加速度。
        for (const pts of d.points) {
          for (let i = 0; i < pts.userData.speed.length; i += 1) {
            pts.userData.speed[i] *= 2.1 + Math.random() * 1.3;
            pts.userData.driftX[i] += (Math.random() - 0.5) * maxDim * 0.012;
            pts.userData.driftZ[i] += (Math.random() - 0.5) * maxDim * 0.012;
          }
        }
      }
      const baseOpacity = 1;
      d.bodyMats.forEach((m) => { m.opacity = dim ? baseOpacity * 0.4 : isHov ? 1 : baseOpacity; });
      d.edgeMats.forEach((m) => {
        m.opacity = dim ? 0.018 : isHov ? 0.34 : focus ? 0.24 : live ? 0.085 : 0.045;
      });
      const districtHeight = d.bbox ? d.bbox.getSize(new THREE.Vector3()).y : 0;
      d.riseTarget = isHov && !focused
        ? Math.max(maxDim * 0.035, Math.min(districtHeight * 0.58, maxDim * 0.055))
        : 0;
      if (reducedMotion) {
        d.rise = d.riseTarget;
        d.node.position.y = d.baseY + d.rise;
      }
    }
    renderer.domElement.style.cursor = name ? 'pointer' : 'default';
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
    if (focused) { hooks.onBlank(); return; }
    if (hovered) hooks.onSelect(hovered);
    else if (!hovered) hooks.onBlank();
  });

  // ---- 地区聚焦：沿弧线下降掠过城区上空，落向该区 ----
  let focused = null;
  let activeFilter = null;
  function focusDistrict(name) {
    const d = districts.get(name);
    if (!d) return;
    focused = name;
    applyHover(null, true);
    const c = d.bbox.getCenter(new THREE.Vector3());
    const s = d.bbox.getSize(new THREE.Vector3());
    const dist = Math.max(s.x, s.z) * 1.38;
    const dir = new THREE.Vector3(0.3, 0.55, 0.72).normalize(); // 仰角 ≈ 35°，贴近地台
    tweenCamera(c.clone().add(dir.multiplyScalar(dist)), c, 1500, 0.4);
    for (const o of districts.values()) {
      const isF = o === d;
      o.bodyMats.forEach((m) => { m.opacity = isF ? 1 : 0.12; });
      o.edgeMats.forEach((m) => { m.opacity = isF ? 0.24 : 0.018; });
      if (o.points) o.points.forEach((p) => { p.visible = isF; });
    }
  }
  function exitFocus() {
    if (!focused) return;
    focused = null;
    tweenCamera(overview.pos, overview.target, 1200, 0.35);
    applyHover(null, true);
    for (const d of districts.values()) { if (d.points) d.points.forEach((p) => { p.visible = true; }); }
    setFilter(activeFilter);
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
    // Anchor directly on the district's top face. It must not inherit the
    // waterfall sprite size: doing so pushed project cards far above the map.
    return new THREE.Vector3(c.x + offset * s.x, d.bbox.max.y + maxDim * 0.0025, c.z);
  }
  function districtLabelWorld(name) {
    const d = districts.get(name);
    if (!d) return null;
    const c = d.bbox.getCenter(new THREE.Vector3());
    return new THREE.Vector3(c.x, d.bbox.max.y + dotSize * 4, c.z);
  }

  // ---- 筛选高亮 ----
  function setFilter(matchFnOrNull) {
    activeFilter = matchFnOrNull;
    for (const d of districts.values()) {
      const live = hooks.isLive(d.name);
      const isFocused = focused === d.name;
      const base = focused ? (isFocused ? 1 : 0.12) : 1;
      const edgeBase = focused ? (isFocused ? 0.24 : 0.018) : (live ? 0.085 : 0.045);
      const hit = !matchFnOrNull || matchFnOrNull(d.name);
      d.bodyMats.forEach((m) => { m.opacity = hit ? base : base * 0.18; });
      d.edgeMats.forEach((m) => { m.opacity = hit ? edgeBase : 0.012; });
    }
  }

  // ---- 主循环 ----
  let requestedActive = true;
  let active = !document.hidden;
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
    // 行政区底边的粒子瀑布；悬停区停止补充，已有粒子会快速抖落。
    if (!reducedMotion) {
      const now = clock.elapsedTime;
      for (const d of districts.values()) {
        if (!d.points) continue;
        for (const pts of d.points) {
          if (!pts.visible) continue;
          const attr = pts.geometry.attributes.position;
          const sizeAttr = pts.geometry.attributes.particleSize;
          const opacityAttr = pts.geometry.attributes.particleOpacity;
          const arr = attr.array;
          for (let i = 0; i < attr.count; i++) {
            pts.userData.age[i] += dt;
            if (pts.userData.age[i] >= pts.userData.life[i] || arr[i * 3 + 1] <= particleFloor) {
              if (d.particlePaused) {
                pts.userData.age[i] = pts.userData.life[i];
                opacityAttr.array[i] = 0;
                continue;
              }
              resetFallingParticle(pts, i, false, now);
            }
            const progress = pts.userData.age[i] / pts.userData.life[i];
            const flow = Math.sin(now * 0.82 + pts.userData.phase[i]) * maxDim * 0.00085;
            arr[i * 3] += (pts.userData.driftX[i] + flow) * dt;
            arr[i * 3 + 1] -= pts.userData.speed[i] * dt;
            arr[i * 3 + 2] += (pts.userData.driftZ[i] + Math.cos(now * 0.67 + pts.userData.phase[i]) * maxDim * 0.0007) * dt;
            const appear = THREE.MathUtils.smoothstep(progress, 0, 0.09);
            const fade = 1 - THREE.MathUtils.smoothstep(progress, 0.78, 1);
            const pulse = 0.82 + Math.sin(now * 1.2 + pts.userData.phase[i]) * 0.18;
            opacityAttr.array[i] = (0.6 + pts.userData.density[i] * 0.4) * appear * fade * pulse;
            sizeAttr.array[i] = dotSize * (0.74 + pts.userData.density[i] * 0.62) * (1 - progress * 0.18);
          }
          attr.needsUpdate = true;
          sizeAttr.needsUpdate = true;
          opacityAttr.needsUpdate = true;
        }
      }
    }
    // 上浮缓动（约 400–600ms 体感，仅 Y 方向）
    for (const d of districts.values()) {
      if (Math.abs(d.riseTarget - d.rise) > 0.0001) {
        d.rise += (d.riseTarget - d.rise) * (reducedMotion ? 1 : 0.08);
        d.node.position.y = d.baseY + d.rise;
      }
    }
    if (pointerDirty && !focused) {
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
    } else if (focused && hovered) applyHover(null);
    controls.update();
    renderer.render(scene, camera);
    hooks.onFrame?.(project);
    raf = requestAnimationFrame(tick);
  }

  function syncActive() {
    const next = requestedActive && !document.hidden;
    if (next === active) return;
    active = next;
    if (next) { clock.getDelta(); raf = requestAnimationFrame(tick); }
    else cancelAnimationFrame(raf);
  }

  function setActive(v) {
    requestedActive = Boolean(v);
    syncActive();
  }

  const onVis = () => syncActive();
  document.addEventListener('visibilitychange', onVis);
  const ro = new ResizeObserver(() => {
    if (!container.clientWidth) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
    particleMaterial.uniforms.viewportScale.value = container.clientHeight * renderer.getPixelRatio() * 0.5;
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
      jadeTexture?.dispose();
      jadeBumpTexture?.dispose();
      jadeEnvironment.dispose();
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        for (const m of [].concat(o.material || [])) m?.dispose?.();
      });
    },
  };
}
