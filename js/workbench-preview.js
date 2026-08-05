// 工作台共享点云场景：材料/工具在同一张桌面上受重力落下，可拖动，点击后重新投放。
import * as THREE from 'three';

const TAU = Math.PI * 2;
const FLOOR_Y = -0.72;
const GRAVITY = -4.8;

function seededRandom(value) {
  let seed = 2166136261;
  for (const char of String(value)) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return () => {
    seed += 0x6D2B79F5;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const RESOURCE_SHAPES = [
  { id: 'sphere', label: '圆润球体' },
  { id: 'cube', label: '方块' },
  { id: 'slab', label: '薄片 / 布面' },
  { id: 'rod', label: '横向长杆' },
  { id: 'cylinder', label: '圆柱 / 杯筒' },
  { id: 'cone', label: '锥体' },
  { id: 'disk', label: '圆盘' },
  { id: 'ring', label: '圆环' },
  { id: 'bowl', label: '碗形' },
  { id: 'bundle', label: '成束材料' },
];

const SHAPE_IDS = new Set(RESOURCE_SHAPES.map((shape) => shape.id));

export function resourceShape(name, configuredShape = '') {
  if (SHAPE_IDS.has(configuredShape)) return configuredShape;
  const value = String(name || '');
  if (/(?:杯|盏|筒|罐|瓶|cup|mug|cylinder)/i.test(value)) return 'cylinder';
  if (/(?:碗|钵|盆|bowl)/i.test(value)) return 'bowl';
  if (/(?:环|圈|镯|ring)/i.test(value)) return 'ring';
  if (/(?:盘|碟|砚|disk|plate)/i.test(value)) return 'disk';
  if (/(?:锥|漏斗|cone)/i.test(value)) return 'cone';
  if (/(?:束|穗|刷|毫|bundle)/i.test(value)) return 'bundle';
  if (/(?:纸|布|帛|绢|棉|纱|线|画|页|纸板|皮革|皮影|cloth|paper)/i.test(value)) return 'slab';
  if (/(?:磨|石|砚|砖|块|缸|碗|灰|土|粉|stone|block)/i.test(value)) return 'cube';
  if (/(?:竹|木|棍|棒|杆|笔|刀|针|剪|锯|锤|工具|梭|筒|弓|架|尺|bamboo|tool)/i.test(value)) return 'rod';
  return 'sphere';
}

function addBoxPoints(points, random, [sx, sy, sz], count) {
  for (let i = 0; i < count; i += 1) {
    const face = Math.floor(random() * 6);
    const x = (random() - 0.5) * sx;
    const y = (random() - 0.5) * sy;
    const z = (random() - 0.5) * sz;
    if (face === 0) points.push(x, y, sz / 2);
    else if (face === 1) points.push(x, y, -sz / 2);
    else if (face === 2) points.push(x, sy / 2, z);
    else if (face === 3) points.push(x, -sy / 2, z);
    else if (face === 4) points.push(sx / 2, y, z);
    else points.push(-sx / 2, y, z);
  }
}

function shapeGeometry(name, configuredShape = '', count = 1250) {
  const random = seededRandom(name);
  const kind = resourceShape(name, configuredShape);
  const points = [];
  let proxyGeometry;
  let halfHeight;
  if (kind === 'slab') {
    addBoxPoints(points, random, [1.35, 0.12, 0.72], count);
    proxyGeometry = new THREE.BoxGeometry(1.35, 0.12, 0.72);
    halfHeight = 0.06;
  } else if (kind === 'cube') {
    addBoxPoints(points, random, [0.68, 0.68, 0.68], count);
    proxyGeometry = new THREE.BoxGeometry(0.68, 0.68, 0.68);
    halfHeight = 0.34;
  } else if (kind === 'rod') {
    const radius = 0.16;
    for (let i = 0; i < count; i += 1) {
      const theta = random() * TAU;
      const x = (random() - 0.5) * 1.28;
      const r = radius * Math.sqrt(random());
      points.push(x, Math.cos(theta) * r, Math.sin(theta) * r);
    }
    proxyGeometry = new THREE.CylinderGeometry(radius, radius, 1.28, 12);
    proxyGeometry.rotateZ(Math.PI / 2);
    halfHeight = radius;
  } else if (kind === 'cylinder') {
    const radius = 0.34, height = 0.78;
    for (let i = 0; i < count; i += 1) {
      const theta = random() * TAU;
      const r = random() < 0.82 ? radius : radius * Math.sqrt(random());
      points.push(Math.cos(theta) * r, (random() - 0.5) * height, Math.sin(theta) * r);
    }
    proxyGeometry = new THREE.CylinderGeometry(radius, radius, height, 18);
    halfHeight = height / 2;
  } else if (kind === 'cone') {
    const radius = 0.42, height = 0.86;
    for (let i = 0; i < count; i += 1) {
      const y = random(), theta = random() * TAU, r = radius * (1 - y);
      points.push(Math.cos(theta) * r, y * height - height / 2, Math.sin(theta) * r);
    }
    proxyGeometry = new THREE.ConeGeometry(radius, height, 18);
    halfHeight = height / 2;
  } else if (kind === 'disk') {
    const radius = 0.48, height = 0.1;
    for (let i = 0; i < count; i += 1) {
      const theta = random() * TAU, r = radius * Math.sqrt(random());
      points.push(Math.cos(theta) * r, (random() - 0.5) * height, Math.sin(theta) * r);
    }
    proxyGeometry = new THREE.CylinderGeometry(radius, radius, height, 22);
    halfHeight = height / 2;
  } else if (kind === 'ring') {
    const major = 0.38, tube = 0.11;
    for (let i = 0; i < count; i += 1) {
      const u = random() * TAU, v = random() * TAU;
      points.push((major + tube * Math.cos(v)) * Math.cos(u), tube * Math.sin(v), (major + tube * Math.cos(v)) * Math.sin(u));
    }
    proxyGeometry = new THREE.TorusGeometry(major, tube, 10, 22);
    proxyGeometry.rotateX(Math.PI / 2);
    halfHeight = tube;
  } else if (kind === 'bowl') {
    const radius = 0.48;
    for (let i = 0; i < count; i += 1) {
      const theta = random() * TAU, phi = Math.PI / 2 + random() * Math.PI / 2;
      const r = radius * (0.93 + random() * 0.07);
      points.push(Math.sin(phi) * Math.cos(theta) * r, Math.cos(phi) * r + radius * 0.45, Math.sin(phi) * Math.sin(theta) * r);
    }
    proxyGeometry = new THREE.SphereGeometry(radius, 18, 10, 0, TAU, Math.PI / 2, Math.PI / 2);
    proxyGeometry.translate(0, radius * 0.45, 0);
    halfHeight = radius * 0.55;
  } else if (kind === 'bundle') {
    const radius = 0.1, length = 1.05, offsets = [-0.16, 0, 0.16];
    for (let i = 0; i < count; i += 1) {
      const theta = random() * TAU, r = radius * Math.sqrt(random());
      points.push(offsets[i % offsets.length] + Math.cos(theta) * r, (random() - 0.5) * length, Math.sin(theta) * r);
    }
    proxyGeometry = new THREE.BoxGeometry(0.52, length, 0.24);
    halfHeight = length / 2;
  } else {
    const radius = 0.4;
    for (let i = 0; i < count; i += 1) {
      const y = random() * 2 - 1;
      const theta = random() * TAU;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      const shell = radius * (0.9 + random() * 0.1);
      points.push(Math.cos(theta) * ring * shell, y * shell, Math.sin(theta) * ring * shell);
    }
    proxyGeometry = new THREE.SphereGeometry(radius, 16, 12);
    halfHeight = radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points), 3));
  return { kind, geometry, proxyGeometry, halfHeight };
}

function softPointTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 48;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(24, 24, 1, 24, 24, 24);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.55, 'rgba(255,255,255,.78)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 48, 48);
  return new THREE.CanvasTexture(canvas);
}

function randomDropPosition(index = 0) {
  return new THREE.Vector3(
    -1.55 + Math.random() * 2.75,
    1.45 + Math.random() * 0.9 + index * 0.08,
    -0.55 + Math.random() * 1.25,
  );
}

export function createWorkbenchSurface(container, descriptors = [], options = {}) {
  const stateStore = options.stateStore || new Map();
  const canvas = document.createElement('canvas');
  canvas.className = 'wb-table-canvas';
  canvas.setAttribute('aria-label', '工作台粒子物体区域：拖动物体调整位置，点击物体重新投放');
  container.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
  // 保留当前俯视角，只收窄视野实现轻微拉近。
  camera.position.set(0, 8, 5.35);
  camera.lookAt(0, -0.38, 0);
  scene.add(new THREE.HemisphereLight(0xf4ead5, 0x405044, 1.35));
  const key = new THREE.DirectionalLight(0xfff1cf, 1.3);
  key.position.set(-3, 6, 4);
  scene.add(key);

  const table = new THREE.Mesh(
    new THREE.PlaneGeometry(5.7, 3.15),
    new THREE.MeshStandardMaterial({ color: 0xb7a789, transparent: true, opacity: 0.2, roughness: 0.96, metalness: 0 }),
  );
  table.rotation.x = -Math.PI / 2;
  table.position.y = FLOOR_Y;
  scene.add(table);

  const pointTexture = softPointTexture();
  const proxyMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
  const shadowGeometry = new THREE.CircleGeometry(0.48, 28);
  const objects = descriptors.map((descriptor, index) => {
    const shape = shapeGeometry(descriptor.shapeName || descriptor.name, descriptor.shape || '');
    const visualScale = THREE.MathUtils.clamp(Number(descriptor.scale) || 1, 0.6, 1.6);
    const group = new THREE.Group();
    const saved = stateStore.get(descriptor.id);
    if (saved?.position) group.position.fromArray(saved.position);
    else group.position.copy(randomDropPosition(index));
    if (saved?.rotation) group.rotation.set(...saved.rotation);
    else group.rotation.set((Math.random() - 0.5) * 0.32, Math.random() * TAU, (Math.random() - 0.5) * 0.22);
    group.scale.setScalar(visualScale);
    const material = new THREE.PointsMaterial({
      color: new THREE.Color(descriptor.color),
      size: shape.kind === 'slab' ? 0.048 : 0.056,
      map: pointTexture,
      transparent: true,
      opacity: 0.92,
      alphaTest: 0.025,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const cloud = new THREE.Points(shape.geometry, material);
    const proxy = new THREE.Mesh(shape.proxyGeometry, proxyMaterial);
    proxy.userData.itemId = descriptor.id;
    group.add(cloud, proxy);
    scene.add(group);

    const shadow = new THREE.Mesh(
      shadowGeometry,
      new THREE.MeshBasicMaterial({ color: 0x26342c, transparent: true, opacity: 0.13, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(group.position.x, FLOOR_Y + 0.006, group.position.z);
    scene.add(shadow);

    const label = document.createElement('span');
    label.className = 'wb-object-label';
    label.textContent = descriptor.name;
    label.dataset.objectId = descriptor.id;
    label.style.setProperty('--object-label-accent', descriptor.color);
    container.appendChild(label);
    return {
      ...descriptor,
      restored: Boolean(saved),
      kind: shape.kind,
      group,
      cloud,
      proxy,
      shadow,
      label,
      halfHeight: shape.halfHeight * visualScale,
      velocity: saved?.velocity
        ? new THREE.Vector3().fromArray(saved.velocity)
        : new THREE.Vector3((Math.random() - 0.5) * 0.24, 0, (Math.random() - 0.5) * 0.18),
      held: false,
      geometry: shape.geometry,
      proxyGeometry: shape.proxyGeometry,
      material,
    };
  });
  const ripples = [];

  container.dataset.physics = 'gravity';
  container.dataset.objectCount = String(objects.length);
  container.dataset.objectLabelCount = String(objects.length);
  container.dataset.restoredCount = String(objects.filter((item) => item.restored).length);
  container.dataset.shapeKinds = [...new Set(objects.map((item) => item.kind))].join(',');

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();
  let activeItem = null;
  let pointerStart = null;
  let disposed = false;
  let frame = 0;
  let lastTime = performance.now();
  const projectedLabel = new THREE.Vector3();

  const updatePointer = (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  };
  const playRipple = (clientX, clientY) => {
    const center = new THREE.Vector3(0, FLOOR_Y + 0.035, 0);
    if (Number.isFinite(clientX) && Number.isFinite(clientY) && (clientX || clientY)) {
      updatePointer({ clientX, clientY });
      dragPlane.constant = -(FLOOR_Y + 0.035);
      raycaster.ray.intersectPlane(dragPlane, center);
    }
    const count = 150;
    const positions = new Float32Array(count * 3);
    const angles = new Float32Array(count);
    const offsets = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      angles[i] = (i / count) * TAU + (Math.random() - 0.5) * 0.055;
      offsets[i] = (i % 3) * 0.095 + Math.random() * 0.035;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xc08e3a,
      size: 0.048,
      map: pointTexture,
      transparent: true,
      opacity: 0.78,
      alphaTest: 0.02,
      depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    scene.add(points);
    ripples.push({ center, age: 0, duration: 0.78, positions, angles, offsets, geometry, material, points });
    container.dataset.ripple = 'active';
  };
  const findItem = (event) => {
    updatePointer(event);
    const hits = raycaster.intersectObjects(objects.map((item) => item.proxy), false);
    const id = hits[0]?.object?.userData?.itemId;
    return objects.find((item) => item.id === id) || null;
  };
  const resetItem = (item) => {
    item.group.position.copy(randomDropPosition());
    item.group.rotation.set((Math.random() - 0.5) * 0.38, Math.random() * TAU, (Math.random() - 0.5) * 0.26);
    item.velocity.set((Math.random() - 0.5) * 0.42, 0.2 + Math.random() * 0.25, (Math.random() - 0.5) * 0.26);
  };
  const onPointerDown = (event) => {
    activeItem = findItem(event);
    if (!activeItem) return;
    activeItem.held = true;
    pointerStart = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture?.(event.pointerId);
    canvas.classList.add('is-grabbing');
  };
  const onPointerMove = (event) => {
    if (!activeItem) return;
    updatePointer(event);
    const targetY = FLOOR_Y + activeItem.halfHeight;
    dragPlane.constant = -targetY;
    if (raycaster.ray.intersectPlane(dragPlane, hitPoint)) {
      activeItem.group.position.x = THREE.MathUtils.clamp(hitPoint.x, -2.25, 1.75);
      activeItem.group.position.y = targetY;
      activeItem.group.position.z = THREE.MathUtils.clamp(hitPoint.z, -1.15, 1.1);
      activeItem.velocity.set(0, 0, 0);
    }
  };
  const onPointerUp = (event) => {
    if (!activeItem) return;
    const moved = pointerStart ? Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) : 0;
    activeItem.held = false;
    if (moved < 5) resetItem(activeItem);
    else activeItem.velocity.set((Math.random() - 0.5) * 0.12, 0.06, (Math.random() - 0.5) * 0.1);
    activeItem = null;
    pointerStart = null;
    canvas.classList.remove('is-grabbing');
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  const resize = () => {
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  const render = (time) => {
    if (disposed) return;
    frame = requestAnimationFrame(render);
    const dt = Math.min(0.034, Math.max(0.001, (time - lastTime) / 1000));
    lastTime = time;
    objects.forEach((item) => {
      if (!item.held) {
        item.velocity.y += GRAVITY * dt;
        item.group.position.addScaledVector(item.velocity, dt);
        const restY = FLOOR_Y + item.halfHeight;
        if (item.group.position.y <= restY) {
          item.group.position.y = restY;
          if (Math.abs(item.velocity.y) > 0.34) item.velocity.y *= -0.22;
          else item.velocity.y = 0;
          item.velocity.x *= 0.84;
          item.velocity.z *= 0.84;
        }
        item.group.position.x = THREE.MathUtils.clamp(item.group.position.x, -2.3, 1.8);
        item.group.position.z = THREE.MathUtils.clamp(item.group.position.z, -1.18, 1.12);
        if (Math.abs(item.velocity.x) > 0.002) item.group.rotation.z += item.velocity.x * dt * 0.35;
      }
      const height = Math.max(0, item.group.position.y - (FLOOR_Y + item.halfHeight));
      item.shadow.position.x = item.group.position.x;
      item.shadow.position.z = item.group.position.z;
      const shadowScale = 0.65 + item.halfHeight * 0.8;
      item.shadow.scale.setScalar(shadowScale + height * 0.05);
      item.shadow.material.opacity = 0.14 / (1 + height * 0.9);
      projectedLabel.copy(item.group.position);
      projectedLabel.y += item.halfHeight + 0.2;
      projectedLabel.project(camera);
      if (projectedLabel.z < -1 || projectedLabel.z > 1) {
        item.label.hidden = true;
      } else {
        item.label.hidden = false;
        const projectedX = (projectedLabel.x * 0.5 + 0.5) * canvas.clientWidth;
        const projectedY = (-projectedLabel.y * 0.5 + 0.5) * canvas.clientHeight;
        // 新物体从镜头上方落下时，名称先停留在工序说明下方；进入画面后再继续跟随。
        item.label.style.left = `${THREE.MathUtils.clamp(projectedX, 42, Math.max(42, canvas.clientWidth - 42))}px`;
        item.label.style.top = `${THREE.MathUtils.clamp(projectedY, 202, Math.max(202, canvas.clientHeight - 24))}px`;
      }
      stateStore.set(item.id, {
        position: item.group.position.toArray(),
        rotation: [item.group.rotation.x, item.group.rotation.y, item.group.rotation.z],
        velocity: item.velocity.toArray(),
      });
    });
    for (let i = ripples.length - 1; i >= 0; i -= 1) {
      const ripple = ripples[i];
      ripple.age += dt;
      const progress = Math.min(1, ripple.age / ripple.duration);
      const radius = 0.08 + progress * 2.45;
      for (let p = 0; p < ripple.angles.length; p += 1) {
        const ring = radius - ripple.offsets[p] * (0.4 + progress);
        const p3 = p * 3;
        ripple.positions[p3] = ripple.center.x + Math.cos(ripple.angles[p]) * ring;
        ripple.positions[p3 + 1] = ripple.center.y + Math.sin(progress * Math.PI) * 0.025;
        ripple.positions[p3 + 2] = ripple.center.z + Math.sin(ripple.angles[p]) * ring * 0.52;
      }
      ripple.geometry.attributes.position.needsUpdate = true;
      ripple.material.opacity = Math.pow(1 - progress, 1.35) * 0.78;
      ripple.material.size = 0.048 - progress * 0.018;
      if (progress >= 1) {
        scene.remove(ripple.points);
        ripple.geometry.dispose();
        ripple.material.dispose();
        ripples.splice(i, 1);
      }
    }
    if (!ripples.length && container.dataset.ripple === 'active') container.dataset.ripple = 'complete';
    renderer.render(scene, camera);
  };
  frame = requestAnimationFrame(render);

  return {
    ripple: playRipple,
    randomizeAll() { objects.forEach(resetItem); },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      objects.forEach((item) => {
        stateStore.set(item.id, {
          position: item.group.position.toArray(),
          rotation: [item.group.rotation.x, item.group.rotation.y, item.group.rotation.z],
          velocity: item.velocity.toArray(),
        });
        item.geometry.dispose();
        item.proxyGeometry.dispose();
        item.material.dispose();
        item.shadow.material.dispose();
        item.label.remove();
      });
      ripples.forEach((ripple) => {
        ripple.geometry.dispose();
        ripple.material.dispose();
      });
      shadowGeometry.dispose();
      pointTexture.dispose();
      proxyMaterial.dispose();
      table.geometry.dispose();
      table.material.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
