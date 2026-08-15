import * as THREE from 'three';
import { OrbitControls } from '../vendor/controls/OrbitControls.js';
import { reducedMotion } from './particles.js';
import { goBackGraphRoot, graphStateContext, openGraphBranch, returnGraphRoot, returnInitialGraphRoot, selectGraphNode, setGraphBranchPage, setGraphRoot } from './heritage-graph.js';

const STAR_WHITE = 0xffffff;
const STAR_SOFT = 0xffffff;
const ROOT_RINGS = [0.92, 1.68, 2.58, 3.62, 4.82, 6.18];
const BRANCH_RINGS = [0.88, 1.62, 2.48, 3.48, 4.62, 5.9];

const damp = (current, target, speed, dt) => THREE.MathUtils.lerp(current, target, reducedMotion ? 1 : 1 - Math.exp(-speed * dt));
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function stableUnit(value, salt = '') {
  let hash = 2166136261;
  const source = `${salt}:${value || ''}`;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function stableRange(value, salt, min, max) {
  return THREE.MathUtils.lerp(min, max, stableUnit(value, salt));
}

function nodePosition(node, index, total, minRadius = 2.72, maxRadius = 4.72, height = 0.12) {
  const id = node?.id || `${index}`;
  const segment = (Math.PI * 2) / Math.max(total, 1);
  const angleJitter = (stableUnit(id, 'angle') - 0.5) * segment * 0.58;
  const angle = -Math.PI / 2 + index * segment + angleJitter;
  const radius = stableRange(id, 'line-length', minRadius, maxRadius);
  return new THREE.Vector3(
    Math.cos(angle) * radius,
    height + stableRange(id, 'height', -1.15, 1.15),
    Math.sin(angle) * radius + stableRange(id, 'depth', -1.2, 1.2),
  );
}

function makeStarField() {
  const group = new THREE.Group();
  const layer = (count, zMin, zMax, opacity, size, seed) => {
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const id = `${seed}:${index}`;
      positions[index * 3] = stableRange(id, 'x', -10, 10);
      positions[index * 3 + 1] = stableRange(id, 'y', -5.5, 6.5);
      positions[index * 3 + 2] = stableRange(id, 'z', zMin, zMax);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0xf5f0dd, size, transparent: true, opacity, depthWrite: false, sizeAttenuation: true });
    const points = new THREE.Points(geometry, material);
    points.userData.basePositions = positions.slice();
    return points;
  };
  group.add(layer(130, -8, -2.5, 0.28, 0.085, 'far'));
  group.add(layer(95, 1.5, 7, 0.10, 0.16, 'near'));
  group.userData.isStarField = true;
  return group;
}

function makeMistTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  const blooms = [
    [112, 142, 118, .62], [230, 104, 150, .52], [350, 146, 132, .46], [438, 104, 92, .34],
  ];
  blooms.forEach(([x, y, radius, alpha]) => {
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(235,239,227,${alpha})`);
    gradient.addColorStop(.38, `rgba(222,232,219,${alpha * .62})`);
    gradient.addColorStop(1, 'rgba(210,224,213,0)');
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function makeMistField() {
  const group = new THREE.Group();
  const texture = makeMistTexture();
  const layers = [
    [-5.8, 1.8, -5.5, 7.8, 2.5, .14, .08],
    [4.7, -1.6, -3.2, 8.4, 2.7, .13, -.06],
    [-4.4, -2.1, .8, 6.8, 2.2, .085, .1],
    [5.2, 1.9, 2.4, 7.2, 2.4, .07, -.08],
    [0, -2.8, 4.3, 9.8, 2.5, .055, .045],
  ];
  layers.forEach(([x, y, z, width, height, opacity, drift], index) => {
    const material = new THREE.SpriteMaterial({
      map: texture,
      color: index < 2 ? 0xdbe5d7 : 0xeff0df,
      transparent: true,
      opacity,
      depthWrite: false,
      depthTest: true,
      toneMapped: true,
      fog: true,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(x, y, z);
    sprite.scale.set(width, height, 1);
    sprite.renderOrder = z > 0 ? 5 : 0;
    sprite.userData.mistOriginX = x;
    sprite.userData.mistOriginY = y;
    sprite.userData.mistDrift = drift;
    sprite.userData.mistPhase = index * 1.37;
    group.add(sprite);
  });
  group.userData.texture = texture;
  return group;
}

function portalPosition(portal, index) {
  const id = portal?.target?.id || portal?.relation || `portal:${index}`;
  const baseAngles = [-Math.PI * 0.84, -Math.PI * 0.16, Math.PI * 0.5];
  const angle = baseAngles[index] + stableRange(id, 'portal-angle', -0.08, 0.08);
  const radius = stableRange(id, 'portal-line-length', 3.05, 4.25);
  return new THREE.Vector3(
    Math.cos(angle) * radius,
    stableRange(id, 'portal-height', -0.06, 0.34),
    Math.sin(angle) * radius,
  );
}

function makeNodeMesh(node, scale, baseOpacity = 0.58) {
  const group = new THREE.Group();
  const geometry = new THREE.SphereGeometry(0.31 * scale, 30, 22);
  geometry.scale(1, 0.94 + ((node.id.length % 5) * 0.015), 1);
  const material = new THREE.MeshPhysicalMaterial({
    color: STAR_WHITE,
    roughness: 0.24,
    metalness: 0,
    transmission: 0.18,
    thickness: 0.42,
    clearcoat: 0.38,
    clearcoatRoughness: 0.22,
    emissive: STAR_WHITE,
    emissiveIntensity: 0.1,
    transparent: true,
    opacity: reducedMotion ? baseOpacity : 0.05,
  });
  material.userData.baseOpacity = baseOpacity;
  material.userData.targetOpacity = baseOpacity;
  material.userData.isNodeSurface = true;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.node = node;
  mesh.userData.graphGroup = group;
  group.add(mesh);

  const haloMaterial = new THREE.MeshBasicMaterial({
    color: STAR_WHITE,
    transparent: true,
    opacity: reducedMotion ? 0.18 : 0,
    depthWrite: false,
  });
  haloMaterial.userData.baseOpacity = 0.18;
  haloMaterial.userData.targetOpacity = 0.18;
  haloMaterial.userData.isNodeHalo = true;
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.47 * scale, 0.008 * scale, 8, 64), haloMaterial);
  halo.rotation.x = Math.PI / 2;
  group.add(halo);

  group.userData.node = node;
  group.userData.mesh = mesh;
  group.userData.baseScale = 1;
  group.userData.targetScale = 1;
  group.scale.setScalar(reducedMotion ? 1 : 0.78);
  return group;
}

function makeLine(from, to, opacity = 0.42, participants = []) {
  const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
  const material = new THREE.LineBasicMaterial({ color: STAR_WHITE, transparent: true, opacity: reducedMotion ? opacity : 0 });
  material.userData.baseOpacity = opacity;
  material.userData.targetOpacity = opacity;
  const line = new THREE.Line(geometry, material);
  line.userData.participants = participants;
  return line;
}

function makeOrbitRings(center, radii) {
  const group = new THREE.Group();
  radii.forEach((radius, index) => {
    const points = Array.from({ length: 192 }, (_, pointIndex) => {
      const angle = (pointIndex / 192) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    });
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const baseOpacity = Math.max(0.075, 0.23 - index * 0.026);
    const material = new THREE.LineBasicMaterial({
      color: index < 2 ? STAR_WHITE : STAR_SOFT,
      transparent: true,
      opacity: reducedMotion ? baseOpacity : 0,
      depthWrite: false,
    });
    material.userData.baseOpacity = baseOpacity;
    material.userData.targetOpacity = baseOpacity;
    material.userData.isOrbitRing = true;
    const ring = new THREE.LineLoop(geometry, material);
    ring.position.copy(center);
    ring.position.y = center.y - 0.2 + index * 0.018;
    ring.rotation.y = (index % 2 ? 1 : -1) * index * 0.035;
    group.add(ring);
  });
  return group;
}

export function mountHeritageGraph(container, state, { onSelect, onChange } = {}) {
  const width = Math.max(1, container.clientWidth);
  const height = Math.max(1, container.clientHeight);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.domElement.className = 'heritage-graph-canvas';
  renderer.domElement.setAttribute('aria-label', '三维非遗知识图谱');
  renderer.domElement.dataset.nodeMaterial = 'white-translucent';
  renderer.domElement.dataset.lineLengthMode = 'stable-id-random';
  renderer.domElement.dataset.hoverTransition = 'damped-opacity-scale';
  renderer.domElement.dataset.mistDepth = 'five-z-layers';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x83968a, 0.026);
  const starField = makeStarField();
  scene.add(starField);
  const mistField = makeMistField();
  scene.add(mistField);
  const camera = new THREE.PerspectiveCamera(39, width / height, 0.1, 120);
  camera.position.set(0, 4.1, 10.2);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;
  controls.minDistance = 5.2;
  controls.maxDistance = 17;
  controls.maxPolarAngle = Math.PI * 0.62;
  controls.target.set(0, 0.05, 0);

  scene.add(new THREE.HemisphereLight(0xf0ead8, 0x26382e, 1.35));
  const key = new THREE.DirectionalLight(0xfff1d2, 1.7);
  key.position.set(4, 6, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xb7c8b9, 0.75);
  rim.position.set(-4, 2, -5);
  scene.add(rim);
  scene.add(new THREE.AmbientLight(0xd4decf, 0.28));

  const graphGroup = new THREE.Group();
  scene.add(graphGroup);
  const labels = new Map();
  const interactiveGroups = new Set();
  const lineObjects = new Set();
  const raycastTargets = [];
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(2, 2);
  const clock = new THREE.Clock();
  let hoveredGroup = null;
  let pointerDirty = false;
  let pointerDown = null;
  let cameraTween = null;
  let raf = 0;
  let disposed = false;
  let released = false;

  const clearGroup = () => {
    hoveredGroup = null;
    interactiveGroups.clear();
    lineObjects.clear();
    raycastTargets.length = 0;
    while (graphGroup.children.length) {
      const child = graphGroup.children.pop();
      child.traverse((object) => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) object.material.forEach((item) => item.dispose?.());
        else object.material?.dispose?.();
      });
    }
    labels.forEach(({ label }) => label.remove());
    labels.clear();
  };

  const registerNode = (group) => {
    interactiveGroups.add(group);
    raycastTargets.push(group.userData.mesh);
    return group;
  };

  const registerLine = (line) => {
    lineObjects.add(line);
    graphGroup.add(line);
  };

  const addLabel = (node, position, kind = '', group = null) => {
    const label = document.createElement('span');
    label.className = `heritage-graph-label ${kind}`.trim();
    label.textContent = node.title;
    label.setAttribute('data-node-id', node.id);
    container.appendChild(label);
    labels.set(`${node.id}:${kind}`, { label, position: position.clone(), opacity: reducedMotion ? 1 : 0, group });
  };

  const setCameraView = (mode) => {
    const toPosition = mode === 'branch' ? new THREE.Vector3(0, 4.45, 10.8) : mode === 'overview' ? new THREE.Vector3(0, 5.4, 12.4) : new THREE.Vector3(0, 4.1, 10.2);
    const toTarget = new THREE.Vector3(0, mode === 'branch' ? 0.12 : 0.05, 0);
    cameraTween = {
      startedAt: performance.now(),
      duration: reducedMotion ? 0 : 820,
      fromPosition: camera.position.clone(),
      fromTarget: controls.target.clone(),
      toPosition,
      toTarget,
    };
  };

  const drawState = () => {
    clearGroup();
    const root = state.root;
    if (disposed) return;
    if (state.mode === 'overview') {
      const nodes = (state.overviewNodes || []).filter((node) => node?.type === 'heritage');
      const primary = nodes.filter((node) => node.overview_role === 'map-project');
      const secondary = nodes.filter((node) => node.overview_role !== 'map-project');
      const positions = new Map();
      primary.forEach((node, index) => positions.set(node.id, nodePosition(node, index, primary.length, 1.65, 5.15, 0.08)));
      secondary.forEach((node, index) => positions.set(node.id, nodePosition(node, index, secondary.length, 5.45, 7.25, 0.02)));
      nodes.forEach((node, index) => {
        const isProject = node.overview_role === 'map-project';
        const group = registerNode(makeNodeMesh(node, isProject ? 0.68 : 0.52, isProject ? 0.52 : 0.38));
        const position = positions.get(node.id) || nodePosition(node, index, nodes.length, 2.1, 5.8, 0.05);
        group.position.copy(position);
        graphGroup.add(group);
        addLabel(node, position, `overview-node ${node.overview_role || 'secondary'}`, group);
      });
      const nodePositions = new Map([...positions.entries()]);
      (state.overviewLinks || []).forEach((link) => {
        const from = nodePositions.get(link.from); const to = nodePositions.get(link.to);
        if (from && to) registerLine(makeLine(from, to, 0.12));
      });
      renderer.domElement.dataset.nodeCount = String(interactiveGroups.size);
      renderer.domElement.dataset.graphMode = 'overview';
      renderer.domElement.dataset.pagination = 'disabled';
      renderer.domElement.dataset.starField = 'interactive-depth';
      setCameraView('overview');
      return;
    }
    if (!root) return;
    const rootPosition = state.mode === 'branch' ? new THREE.Vector3(-3.85, 0.14, 0) : new THREE.Vector3(0, 0.2, 0);
    const rootMesh = registerNode(makeNodeMesh(root, state.mode === 'branch' ? 0.78 : 1.42, 0.72));
    rootMesh.position.copy(rootPosition);
    graphGroup.add(rootMesh);
    addLabel(root, rootPosition, 'root', rootMesh);

    if (state.mode === 'root') {
      graphGroup.add(makeOrbitRings(rootPosition, ROOT_RINGS));
      // Root view is deliberately shallow: show only the three curated first-level
      // relation portals. A portal can then open one second-level branch.
      const visibleNodes = state.portals.map((portal) => portal.target).filter(Boolean).slice(0, 3);
      visibleNodes.forEach((portalNode, index) => {
        const portal = state.portals.find((item) => item.target?.id === portalNode.id) || { available: true, relation: portalNode.type, label: portalNode.title, target: portalNode, result_count: 0 };
        const position = nodePosition(portalNode, index, visibleNodes.length, 2.9, 5.35, 0.14);
        const portalMesh = registerNode(makeNodeMesh(portalNode, portalNode.type === 'heritage' ? 0.72 : 0.88, 0.48));
        portalMesh.position.copy(position);
        if (portal) portalMesh.userData.portal = portal;
        graphGroup.add(portalMesh);
        registerLine(makeLine(rootPosition, position, 0.20, [rootMesh, portalMesh]));
        addLabel({ id: portal.relation, title: `${portal.label}${portal.target ? ` · ${portal.target.title}${portal.result_count ? `（${portal.result_count}项）` : ''}` : ' · 资料待补充'}` }, position, portal.available ? 'portal' : 'portal is-disabled', portalMesh);
      });
    } else {
      const center = state.branchTarget;
      const centerPosition = new THREE.Vector3(0, 0.25, 0);
      const centerMesh = registerNode(makeNodeMesh(center, 1.12, 0.68));
      centerMesh.position.copy(centerPosition);
      graphGroup.add(centerMesh);
      graphGroup.add(makeOrbitRings(centerPosition, BRANCH_RINGS));
      registerLine(makeLine(rootPosition, centerPosition, 0.52, [rootMesh, centerMesh]));
      addLabel(center, centerPosition, 'branch-center', centerMesh);
      state.branchNodes.forEach((node, index) => {
        const position = nodePosition(node, index, state.branchNodes.length);
        const nodeMesh = registerNode(makeNodeMesh(node, 0.8, 0.5));
        nodeMesh.position.copy(position);
        graphGroup.add(nodeMesh);
        registerLine(makeLine(centerPosition, position, 0.34, [centerMesh, nodeMesh]));
        addLabel(node, position, 'branch-node', nodeMesh);
      });
    }
    renderer.domElement.dataset.ringCount = String((state.mode === 'root' ? ROOT_RINGS : BRANCH_RINGS).length);
    renderer.domElement.dataset.nodeCount = String(interactiveGroups.size);
    renderer.domElement.dataset.pagination = 'disabled';
    renderer.domElement.dataset.starField = 'interactive-depth';
    setCameraView(state.mode);
  };

  const applyHover = (nextGroup) => {
    if (hoveredGroup === nextGroup) return;
    hoveredGroup = nextGroup;
    renderer.domElement.dataset.hoveredNode = nextGroup?.userData?.node?.id || nextGroup?.userData?.portal?.target?.id || '';
    renderer.domElement.style.cursor = nextGroup ? 'pointer' : 'grab';
    interactiveGroups.forEach((group) => {
      const isHovered = group === nextGroup;
      const dimmed = Boolean(nextGroup && !isHovered);
      group.userData.targetScale = isHovered ? 1.16 : dimmed ? 0.94 : 1;
      group.traverse((object) => {
        const material = object.material;
        if (!material?.userData) return;
        if (material.userData.isNodeSurface) material.userData.targetOpacity = isHovered ? 0.98 : dimmed ? 0.16 : material.userData.baseOpacity;
        if (material.userData.isNodeHalo) material.userData.targetOpacity = isHovered ? 0.52 : dimmed ? 0.035 : material.userData.baseOpacity;
      });
    });
    lineObjects.forEach((line) => {
      const connected = nextGroup && line.userData.participants.includes(nextGroup);
      line.material.userData.targetOpacity = nextGroup ? (connected ? 0.62 : 0.055) : line.material.userData.baseOpacity;
    });
  };

  const projectLabels = (dt) => {
    labels.forEach((entry) => {
      const point = entry.position.clone().project(camera);
      const x = (point.x * 0.5 + 0.5) * container.clientWidth;
      const y = (-point.y * 0.5 + 0.5) * container.clientHeight;
      const dimmed = hoveredGroup && entry.group && entry.group !== hoveredGroup;
      const targetOpacity = point.z > 1 ? 0 : dimmed ? 0.2 : 1;
      entry.opacity = damp(entry.opacity, targetOpacity, 7.5, dt);
      entry.label.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      entry.label.style.opacity = String(entry.opacity);
    });
  };

  const updateVisuals = (dt) => {
    interactiveGroups.forEach((group) => {
      const scale = damp(group.scale.x, group.userData.targetScale, 7.2, dt);
      group.scale.setScalar(scale);
      group.traverse((object) => {
        const material = object.material;
        if (material?.userData?.targetOpacity != null) material.opacity = damp(material.opacity, material.userData.targetOpacity, 7.8, dt);
      });
    });
    lineObjects.forEach((line) => {
      line.material.opacity = damp(line.material.opacity, line.material.userData.targetOpacity, 6.4, dt);
    });
    graphGroup.traverse((object) => {
      if (object.material?.userData?.isOrbitRing) object.material.opacity = damp(object.material.opacity, object.material.userData.targetOpacity, 3.8, dt);
    });
  };

  const updatePointer = (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    pointerDirty = true;
  };
  const onPointerMove = (event) => updatePointer(event);
  const onPointerLeave = () => { pointer.set(2, 2); pointerDirty = false; applyHover(null); };
  const onPointerDown = (event) => { pointerDown = { x: event.clientX, y: event.clientY }; };
  const onPointerUp = (event) => {
    if (!pointerDown || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 7) { pointerDown = null; return; }
    pointerDown = null;
    const current = hoveredGroup;
    if (!current) {
      if (state.mode === 'branch') {
        returnGraphRoot(state);
        drawState();
        onChange?.(state, graphStateContext(state));
      }
      return;
    }
    const portal = current.userData.portal;
    if (portal) {
      if (!portal.available) { onSelect?.({ unavailable: true, portal }); return; }
      openGraphBranch(state, portal.relation);
      drawState();
      onChange?.(state, graphStateContext(state));
      return;
    }
    if (current.userData.node) {
      selectGraphNode(state, current.userData.node);
      onSelect?.(current.userData.node);
      onChange?.(state, graphStateContext(state));
    }
  };
  renderer.domElement.addEventListener('pointermove', onPointerMove, { passive: true });
  renderer.domElement.addEventListener('pointerleave', onPointerLeave);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);

  const cancelCameraTween = () => { cameraTween = null; };
  controls.addEventListener('start', cancelCameraTween);

  const resize = () => {
    const nextWidth = Math.max(1, container.clientWidth);
    const nextHeight = Math.max(1, container.clientHeight);
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(nextWidth, nextHeight, false);
  };
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(container);
  window.addEventListener('resize', resize);

  const animate = () => {
    if (disposed || document.hidden) { raf = 0; return; }
    const dt = Math.min(clock.getDelta(), 0.05);
    if (pointerDirty) {
      pointerDirty = false;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(raycastTargets, false)[0];
      applyHover(hit?.object?.userData?.graphGroup || null);
    }
    const targetX = pointer.x > 1 ? 0 : pointer.x * 0.22;
    const targetY = pointer.y > 1 ? 0 : pointer.y * 0.16;
    starField.position.x = damp(starField.position.x, targetX, 2.8, dt);
    starField.position.y = damp(starField.position.y, targetY, 2.8, dt);
    starField.rotation.y = damp(starField.rotation.y, targetX * 0.06, 1.8, dt);
    const mistTime = clock.elapsedTime;
    mistField.children.forEach((mist) => {
      const phase = mist.userData.mistPhase;
      const drift = mist.userData.mistDrift;
      mist.position.x = mist.userData.mistOriginX + Math.sin(mistTime * .12 + phase) * drift * 8;
      mist.position.y = mist.userData.mistOriginY + Math.cos(mistTime * .09 + phase) * Math.abs(drift) * 2.6;
    });
    if (cameraTween) {
      const progress = cameraTween.duration ? Math.min(1, (performance.now() - cameraTween.startedAt) / cameraTween.duration) : 1;
      const eased = easeInOutCubic(progress);
      camera.position.lerpVectors(cameraTween.fromPosition, cameraTween.toPosition, eased);
      controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, eased);
      if (progress >= 1) cameraTween = null;
    }
    controls.update();
    updateVisuals(dt);
    projectLabels(dt);
    try { renderer.render(scene, camera); } catch (error) {
      disposed = true;
      console.warn('知识图谱渲染已停止', error);
      return;
    }
    raf = requestAnimationFrame(animate);
  };

  const onVisibilityChange = () => {
    if (!document.hidden && !disposed && !raf) { clock.getDelta(); animate(); }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  drawState();
  animate();

  // ---- 手势系统适配（gestureAdapter） ----
  // 暴露内部状态供 three-target-adapter 注册，让隔空手势能复用现有
  // applyHover / 点击 / 悬停逻辑，不重写任何渲染代码。
  const gestureAdapter = {
    getRaycastTargets: () => raycastTargets,
    getInteractiveGroups: () => interactiveGroups,
    raycaster,
    camera,
    rendererDomElement: renderer.domElement,
    onHover(group) { applyHover(group); },
    onHoverClear() { applyHover(null); },
    onClick(group) {
      if (!group) {
        if (state.mode === 'branch') {
          returnGraphRoot(state);
          drawState();
          onChange?.(state, graphStateContext(state));
        }
        return;
      }
      const portal = group.userData?.portal;
      if (portal) {
        if (!portal.available) { onSelect?.({ unavailable: true, portal }); return; }
        openGraphBranch(state, portal.relation);
        drawState();
        onChange?.(state, graphStateContext(state));
        return;
      }
      if (group.userData?.node) {
        selectGraphNode(state, group.userData.node);
        onSelect?.(group.userData.node);
        onChange?.(state, graphStateContext(state));
      }
    },
    onDragMove(dx = 0, dy = 0) {
      cancelCameraTween();
      const offset = camera.position.clone().sub(controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta -= Number(dx || 0) * 0.0045;
      spherical.phi = THREE.MathUtils.clamp(spherical.phi + Number(dy || 0) * 0.0045, 0.28, Math.PI * 0.62);
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
      controls.update();
    },
    zoomBy(factor = 1) {
      cancelCameraTween();
      const offset = camera.position.clone().sub(controls.target);
      const distance = THREE.MathUtils.clamp(offset.length() * Number(factor || 1), controls.minDistance, controls.maxDistance);
      camera.position.copy(controls.target).add(offset.normalize().multiplyScalar(distance));
      controls.update();
    },
    resetView() { setCameraView(state.mode); },
    isInteractive(group) {
      if (!group) return false;
      const portal = group.userData?.portal;
      if (portal && !portal.available) return false;
      return Boolean(portal || group.userData?.node);
    },
    getHoveredNodeData() {
      if (!hoveredGroup) return null;
      const node = hoveredGroup.userData?.node;
      const portal = hoveredGroup.userData?.portal;
      if (node) return { type: node.type, id: node.id, title: node.title };
      if (portal?.target) return { type: portal.target.type, id: portal.target.id, title: portal.target.title };
      return null;
    },
  };

  return {
    redraw() { drawState(); },
    branch(relation) { const result = openGraphBranch(state, relation); drawState(); onChange?.(state, graphStateContext(state)); return result; },
    setRoot(node) { const result = setGraphRoot(state, node); drawState(); onChange?.(state, graphStateContext(state)); return result; },
    returnRoot() { const result = returnGraphRoot(state); drawState(); onChange?.(state, graphStateContext(state)); return result; },
    previousPage() { const result = setGraphBranchPage(state, state.branchPage - 1); drawState(); onChange?.(state, graphStateContext(state)); return result; },
    nextPage() { const result = setGraphBranchPage(state, state.branchPage + 1); drawState(); onChange?.(state, graphStateContext(state)); return result; },
    goBack() { const result = goBackGraphRoot(state); drawState(); onChange?.(state, graphStateContext(state)); return result; },
    returnInitial() { const result = returnInitialGraphRoot(state); drawState(); onChange?.(state, graphStateContext(state)); return result; },
    context() { return graphStateContext(state); },
    gestureAdapter: () => gestureAdapter,
    dispose() {
      if (released) return;
      released = true;
      disposed = true;
      cancelAnimationFrame(raf);
      raf = 0;
      resizeObserver?.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      controls.removeEventListener('start', cancelCameraTween);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      applyHover(null);
      clearGroup();
      mistField.children.forEach((mist) => mist.material?.dispose?.());
      mistField.userData.texture?.dispose?.();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
