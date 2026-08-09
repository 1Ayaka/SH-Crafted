const ASSET_ROOT = 'assets/mascot/cat/';
const RIG_URL = `${ASSET_ROOT}rig.json`;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const randomBetween = (min, max) => min + Math.random() * (max - min);
const multiply = (left, right) => [
  left[0] * right[0] + left[2] * right[1],
  left[1] * right[0] + left[3] * right[1],
  left[0] * right[2] + left[2] * right[3],
  left[1] * right[2] + left[3] * right[3],
  left[0] * right[4] + left[2] * right[5] + left[4],
  left[1] * right[4] + left[3] * right[5] + left[5],
];
const translation = (x, y) => [1, 0, 0, 1, x, y];
const rotation = (angle) => [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0];

let assetsPromise = null;
function loadAssets() {
  if (assetsPromise) return assetsPromise;
  assetsPromise = fetch(RIG_URL).then(async (response) => {
    if (!response.ok) throw new Error(`mascot_rig_${response.status}`);
    const rig = await response.json();
    const bones = new Map(rig.bones.map((bone) => [bone.id, bone]));
    const images = new Map();
    await Promise.all([...new Set(rig.sprites.map((sprite) => sprite.image))].map((name) => new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => { images.set(name, image); resolve(); };
      image.onerror = reject;
      image.src = `${ASSET_ROOT}${name}`;
    })));
    return { rig, bones, images };
  });
  return assetsPromise;
}

const LEGS = ['hip/chest/legFR', 'hip/chest/legFL', 'hip/legBL', 'hip/legBR'];
const FEET = ['hip/chest/legFR/Bone2D', 'hip/chest/legFL/Bone2D', 'hip/legBL/Bone2D', 'hip/legBR/Bone2D'];
const HEAD = 'hip/chest/head';
const EAR_LEFT = 'hip/chest/head/jaw/earL1';
const EAR_RIGHT = 'hip/chest/head/jaw/earR1';
const HANG_BASE_ANGLE = -1.18;
const RESTING_STATES = new Set(['sleeping', 'fallen']);
const FAB_CANVAS_BELOW_PX = 180;
const FAB_WALK_FOOT_OFFSET_PX = 220;
const FAB_SURFACE_REFRESH_MS = 240;

function stateTargets(state, time, movement, transient) {
  const target = new Map();
  const set = (id, angle) => target.set(id, angle);
  const add = (id, angle) => target.set(id, (target.get(id) || 0) + angle);
  const tailWave = Math.sin(time * (state === 'walking' ? 6.2 : 2.05)) * (state === 'walking' ? 0.19 : 0.1);
  set('hip/tail1', tailWave);
  set('hip/tail1/tail2', tailWave * 0.88 + Math.sin(time * 2.05 - 0.48) * 0.055);
  set('hip/tail1/tail2/tail3', tailWave * 0.74 + Math.sin(time * 2.05 - 0.94) * 0.065);
  set('hip/tail1/tail2/tail3/tail4', tailWave * 0.62 + Math.sin(time * 2.05 - 1.38) * 0.075);

  if (state === 'grabbed' || state === 'falling') {
    const swing = clamp(-movement.vx * 0.0035, -0.42, 0.42);
    LEGS.forEach((id, index) => set(id, 1.08 + swing * (index % 2 ? -0.72 : 0.82)));
    FEET.forEach((id, index) => set(id, -0.12 - swing * (index % 2 ? -0.34 : 0.42)));
    // Each tail joint settles toward a world-down chain while retaining inertia.
    const tailInertia = clamp(-movement.vx * 0.0014, -0.24, 0.24);
    set('hip/tail1', -1.18 + tailInertia + Math.sin(time * 3.7) * 0.075);
    set('hip/tail1/tail2', -0.58 + tailInertia * 0.62 + Math.sin(time * 3.35 - 0.5) * 0.055);
    set('hip/tail1/tail2/tail3', -0.15 + tailInertia * 0.36 + Math.sin(time * 3.05 - 0.9) * 0.04);
    set('hip/tail1/tail2/tail3/tail4', tailInertia * 0.18 + Math.sin(time * 2.8 - 1.3) * 0.03);
    const earInertia = clamp(movement.vx * 0.00012, -0.16, 0.16);
    set(EAR_LEFT, -0.08 + earInertia);
    set(EAR_RIGHT, 0.08 + earInertia);
    set(HEAD, -HANG_BASE_ANGLE - movement.angle);
    return target;
  }
  if (state === 'walking') {
    const step = Math.sin(time * 8.4);
    LEGS.forEach((id, index) => set(id, step * (index % 2 ? -0.3 : 0.3)));
    FEET.forEach((id, index) => set(id, -step * (index % 2 ? -0.18 : 0.18)));
    set('hip/chest', Math.sin(time * 16.8) * 0.024);
    set(HEAD, Math.sin(time * 8.4 + 0.7) * 0.035);
  } else if (state === 'sleeping') {
    set(LEGS[0], -1.28); set(LEGS[1], -1.42);
    set(LEGS[2], 1.34); set(LEGS[3], 1.2);
    set(FEET[0], 0.18); set(FEET[1], 0.12);
    set(FEET[2], -0.16); set(FEET[3], -0.12);
    set('hip/chest', 0.04 + Math.sin(time * 1.3) * 0.008);
    set(HEAD, 0.06 + Math.sin(time * 1.3) * 0.012);
    set(EAR_LEFT, -0.035);
    set(EAR_RIGHT, 0.035);
    set('hip/tail1', -0.72 + Math.sin(time * 0.9) * 0.025);
    set('hip/tail1/tail2', -0.3);
    set('hip/tail1/tail2/tail3', -0.12);
  } else if (state === 'fallen') {
    set(LEGS[0], -1.12); set(LEGS[1], -1.48);
    set(LEGS[2], 1.46); set(LEGS[3], 1.08);
    FEET.forEach((id, index) => set(id, index < 2 ? 0.18 : -0.16));
    set('hip/chest', movement.angle * 0.2);
    set(HEAD, -movement.angle * 0.28);
    set('hip/tail1', -0.82 + Math.sin(time * 3.2) * 0.08);
    set('hip/tail1/tail2', -0.24);
  } else if (state === 'listening' || state === 'awake') {
    set(EAR_LEFT, -0.115);
    set(EAR_RIGHT, 0.115);
    set(HEAD, Math.sin(time * 2.2) * 0.032);
  } else if (state === 'thinking') {
    set(HEAD, Math.sin(time * 2.6) * 0.088);
    set(EAR_LEFT, Math.sin(time * 3.2) * 0.07);
    set(EAR_RIGHT, -Math.sin(time * 3.2) * 0.07);
  } else if (state === 'speaking') {
    set('hip/chest/head/jaw', (Math.sin(time * 10) + 1) * 0.044);
    set('hip/chest', Math.sin(time * 3.3) * 0.023);
    add('hip/tail1', Math.sin(time * 5.4) * 0.1);
  } else if (state === 'error') {
    set(HEAD, 0.1);
    set(EAR_LEFT, 0.15);
    set(EAR_RIGHT, -0.15);
  } else {
    set('hip/chest', Math.sin(time * 1.6) * 0.015);
  }

  const earCycle = time % 8.4;
  if (earCycle < 0.62 && !['sleeping', 'fallen'].includes(state)) {
    const flick = Math.sin((earCycle / 0.62) * Math.PI * 3) * 0.13;
    add(EAR_LEFT, flick);
    add(EAR_RIGHT, -flick * 0.78);
  } else if (state === 'sleeping' && earCycle < 0.34) {
    add(EAR_LEFT, Math.sin((earCycle / 0.34) * Math.PI * 2) * 0.055);
  }
  if (transient === 'tap') {
    const wiggle = Math.sin(time * 28) * 0.225;
    set(EAR_LEFT, -0.1 + wiggle);
    set(EAR_RIGHT, 0.1 - wiggle);
    add('hip/tail1', Math.sin(time * 15) * 0.28);
    add('hip/tail1/tail2', Math.sin(time * 15 - 0.65) * 0.2);
  }
  return target;
}

function stateOffsets(state) {
  const offsets = new Map();
  if (state === 'sleeping') {
    // Lowering the root moves the full body, all limbs and the tail together.
    offsets.set('hip', { x: 0, y: 112 });
    offsets.set('hip/chest', { x: -5, y: 2 });
    offsets.set(HEAD, { x: 2, y: 6 });
    offsets.set('hip/legBL', { x: 8, y: 0 });
    offsets.set('hip/legBR', { x: 6, y: 0 });
  } else if (state === 'fallen') {
    offsets.set('hip', { x: 0, y: 78 });
    offsets.set('hip/chest', { x: -4, y: 2 });
    offsets.set(HEAD, { x: 0, y: 7 });
  }
  return offsets;
}

export function createCatMascot({ className = '', interactive = false, animate = true, autonomous = interactive, onBehavior = null, surfaceProvider = null } = {}) {
  const root = document.createElement('span');
  root.className = `cat-mascot ${className}`.trim();
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', '小蕉，探物志智能体小猫');
  const canvas = document.createElement('canvas');
  root.appendChild(canvas);
  const context = canvas.getContext('2d', { alpha: true });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let assets = null;
  let frame = 0;
  let disposed = false;
  let lastTime = performance.now();
  let externalState = 'idle';
  let motionState = 'idle';
  let transient = '';
  let transientUntil = 0;
  let behaviorUntil = 0;
  let nextAutonomyAt = performance.now() + randomBetween(6500, 10500);
  let walkingDirection = -1;
  let dragging = false;
  let pointerId = null;
  let pointerStart = null;
  let movedDuringPress = false;
  let suppressClickUntil = 0;
  let walkSurface = null;
  let lastSurfaceRefreshAt = 0;
  const movement = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, angularVelocity: 0 };
  const gaze = { x: 0, y: 0, targetX: 0, targetY: 0 };
  const boneState = new Map();

  const notify = (type, detail = {}) => onBehavior?.(type, { state: effectiveState(), ...detail });
  const effectiveState = () => dragging ? 'grabbed' : (motionState !== 'idle' ? motionState : externalState);
  const applyPosition = () => { root.style.translate = `${movement.x}px ${movement.y}px`; };
  const scheduleAutonomy = (delay = randomBetween(6500, 11000)) => { nextAutonomyAt = performance.now() + delay; };
  const startTransient = (name, duration) => { transient = name; transientUntil = performance.now() + duration; };

  const hostElement = () => root.closest('.agent-fab');
  const bottomTrackTop = () => innerHeight - 20;
  const currentTrackTop = () => walkSurface?.top ?? bottomTrackTop();
  const surfaceCandidates = () => {
    if (!surfaceProvider) return [];
    try {
      return (surfaceProvider() || [])
        .filter((surface) => surface && Number.isFinite(surface.left) && Number.isFinite(surface.right) && Number.isFinite(surface.top))
        .filter((surface) => surface.right - surface.left >= 220 && surface.bottom - surface.top >= 70);
    } catch (_) {
      return [];
    }
  };
  const setWalkSurface = (surface, { worldCenter = null, worldFootY = null } = {}) => {
    const host = hostElement();
    if (!host || !surface) return;
    const hostWidth = host.offsetWidth || 184;
    const rootWidth = root.offsetWidth || hostWidth;
    const previousRect = root.getBoundingClientRect();
    const previousCenter = worldCenter ?? (previousRect.width ? previousRect.left + previousRect.width / 2 : null);
    const hostLeft = clamp(surface.left + (surface.right - surface.left - hostWidth) / 2, 8, innerWidth - hostWidth - 8);
    const hostTop = surface.top - FAB_WALK_FOOT_OFFSET_PX;
    host.style.left = `${hostLeft}px`;
    host.style.right = 'auto';
    host.style.top = `${hostTop}px`;
    host.style.bottom = 'auto';
    host.style.zIndex = String(surface.zIndex || '');
    host.dataset.catWalkSurface = surface.id || 'component';
    const min = surface.left + 16 - (hostLeft + (hostWidth - rootWidth) / 2);
    const max = surface.right - 16 - rootWidth - (hostLeft + (hostWidth - rootWidth) / 2);
    const nextX = previousCenter == null
      ? (min + max) / 2
      : previousCenter - (hostLeft + hostWidth / 2);
    movement.x = clamp(nextX, Math.min(min, max), Math.max(min, max));
    movement.y = worldFootY == null ? 0 : Math.min(0, worldFootY - surface.top);
    walkSurface = surface;
    applyPosition();
  };
  const clearWalkSurface = ({ worldCenter = null, worldFootY = null } = {}) => {
    const host = hostElement();
    if (!host || (!walkSurface && worldCenter == null && worldFootY == null)) return;
    const previousRect = root.getBoundingClientRect();
    const previousCenter = worldCenter ?? (previousRect.width ? previousRect.left + previousRect.width / 2 : null);
    const rootWidth = root.offsetWidth || previousRect.width || 181;
    host.style.left = '';
    host.style.right = '';
    host.style.top = '';
    host.style.bottom = '';
    host.style.zIndex = '';
    delete host.dataset.catWalkSurface;
    const baseLeft = host.offsetLeft + (host.offsetWidth - rootWidth) / 2;
    movement.x = previousCenter == null ? 0 : clamp(previousCenter - rootWidth / 2 - baseLeft, 18 - baseLeft, innerWidth - 18 - rootWidth - baseLeft);
    movement.y = worldFootY == null ? 0 : Math.min(0, worldFootY - bottomTrackTop());
    walkSurface = null;
    applyPosition();
  };
  const refreshWalkSurface = (now) => {
    if (!surfaceProvider || !walkSurface || dragging || motionState === 'falling') return;
    if (now - lastSurfaceRefreshAt < FAB_SURFACE_REFRESH_MS) return;
    lastSurfaceRefreshAt = now;
    const current = surfaceCandidates().find((surface) => surface.id === walkSurface.id);
    if (!current || current.top >= innerHeight - 28 || current.bottom <= 48) {
      clearWalkSurface();
      return;
    }
    setWalkSurface(current);
  };
  const dropSurfaceAt = (worldCenter, worldFootY) => surfaceCandidates()
    .filter((surface) => worldCenter >= surface.left - 42 && worldCenter <= surface.right + 42)
    .filter((surface) => Math.abs(surface.top - worldFootY) <= 96)
    .sort((a, b) => Math.abs(a.top - worldFootY) - Math.abs(b.top - worldFootY))[0] || null;

  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // clientWidth/clientHeight are invariant under hover/drag CSS transforms.
    // Using getBoundingClientRect here would rebuild the render coordinate
    // system while the button scales and visibly move the head anchor.
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  };
  const observer = new ResizeObserver(resize);
  observer.observe(root);

  const boneMatrix = (bone, matrices, angles, offsets) => {
    if (matrices.has(bone.id)) return matrices.get(bone.id);
    const parent = bone.parent ? assets.bones.get(bone.parent) : null;
    const offset = offsets.get(bone.id) || { x: 0, y: 0 };
    const local = multiply(translation(bone.x + offset.x, bone.y + offset.y), rotation(angles.get(bone.id) || 0));
    const matrix = parent ? multiply(boneMatrix(parent, matrices, angles, offsets), local) : local;
    matrices.set(bone.id, matrix);
    return matrix;
  };

  const bounds = () => {
    const host = root.closest('.agent-fab');
    const width = root.offsetWidth || root.getBoundingClientRect().width;
    const baseLeft = host
      ? host.offsetLeft + (host.offsetWidth - width) / 2
      : root.getBoundingClientRect().left - movement.x;
    if (walkSurface) {
      const min = walkSurface.left + 16 - baseLeft;
      const max = walkSurface.right - 16 - width - baseLeft;
      return { min: Math.min(min, max), max: Math.max(min, max) };
    }
    return { min: 18 - baseLeft, max: innerWidth - 18 - width - baseLeft };
  };

  const updateMotion = (now, delta) => {
    if (transient && now >= transientUntil) transient = '';
    if (externalState !== 'idle' && motionState !== 'falling' && motionState !== 'fallen') {
      motionState = 'idle';
      scheduleAutonomy();
    }
    if (motionState === 'walking') {
      const limit = bounds();
      movement.vx = walkingDirection * (reducedMotion ? 12 : 34);
      movement.x += movement.vx * delta;
      if (movement.x <= limit.min || movement.x >= limit.max) {
        movement.x = clamp(movement.x, limit.min, limit.max);
        walkingDirection *= -1;
      }
      if (now >= behaviorUntil) {
        motionState = 'sleeping';
        movement.vx = 0;
        behaviorUntil = now + randomBetween(4500, 7500);
        notify('sleep');
      }
    } else if (motionState === 'sleeping') {
      movement.vx = 0;
      if (now >= behaviorUntil) {
        motionState = 'idle';
        notify('wake');
        scheduleAutonomy(randomBetween(7000, 12000));
      }
    } else if (motionState === 'falling') {
      movement.vy += (reducedMotion ? 600 : 1500) * delta;
      movement.y += movement.vy * delta;
      movement.x += movement.vx * delta;
      movement.vx *= Math.exp(-1.8 * delta);
      movement.angularVelocity += clamp(-movement.vx * 0.001, -0.8, 0.8) * delta;
      movement.angle += movement.angularVelocity;
      const limit = bounds();
      movement.x = clamp(movement.x, limit.min, limit.max);
      if (movement.y >= 0) {
        movement.y = 0;
        movement.vy = 0;
        movement.vx = 0;
        movement.angle = clamp(movement.angle || (walkingDirection * 0.62), -0.72, 0.72);
        motionState = 'fallen';
        behaviorUntil = now + (reducedMotion ? 350 : 1050);
        notify('land');
      }
    } else if (motionState === 'fallen') {
      if (now >= behaviorUntil) {
        movement.angle *= Math.exp(-8 * delta);
        if (Math.abs(movement.angle) < 0.015) {
          movement.angle = 0;
          motionState = 'idle';
          notify('recover');
          scheduleAutonomy();
        }
      }
    } else if (autonomous && externalState === 'idle' && !dragging && now >= nextAutonomyAt) {
      motionState = 'walking';
      walkingDirection = Math.random() > 0.25 ? -1 : 1;
      behaviorUntil = now + randomBetween(4500, 8000);
      notify('walk');
    }
    applyPosition();
  };

  const draw = (now) => {
    if (disposed || !assets) return;
    frame = 0;
    resize();
    const delta = Math.min(0.04, Math.max(0.001, (now - lastTime) / 1000));
    lastTime = now;
    refreshWalkSurface(now);
    updateMotion(now, delta);
    movement.vx *= dragging ? Math.exp(-5 * delta) : 1;
    movement.vy *= dragging ? Math.exp(-5 * delta) : 1;
    gaze.x += (gaze.targetX - gaze.x) * Math.min(1, delta * 8);
    gaze.y += (gaze.targetY - gaze.y) * Math.min(1, delta * 8);

    const state = effectiveState();
    const targets = stateTargets(state, now / 1000, movement, transient);
    const offsets = stateOffsets(state);
    const angles = new Map();
    for (const bone of assets.rig.bones) {
      const physics = boneState.get(bone.id) || { angle: 0, velocity: 0 };
      const target = (targets.get(bone.id) || 0) * (reducedMotion ? 0.35 : 1);
      const tail = bone.id.includes('/tail');
      const ear = bone.id.includes('/ear');
      const anchoredHead = state === 'grabbed' && bone.id === HEAD;
      const stiffness = anchoredHead ? 68 : (ear ? 43 : (tail ? (state === 'grabbed' ? 160 : 25) : 34));
      const damping = anchoredHead ? 10 : (ear ? 6.8 : (tail ? (state === 'grabbed' ? 9 : 4.35) : 6.2));
      physics.velocity += (target - physics.angle) * stiffness * delta;
      physics.velocity *= Math.exp(-damping * delta);
      physics.angle += physics.velocity * delta;
      boneState.set(bone.id, physics);
      angles.set(bone.id, physics.angle);
    }

    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    const viewport = assets.rig.viewport;
    const isFab = root.classList.contains('cat-mascot-fab');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const scale = isFab
      ? (root.offsetWidth * dpr) / viewport.width
      : Math.min(width / viewport.width, height / viewport.height);
    const fitX = (width - viewport.width * scale) / 2 - viewport.x * scale;
    const matrices = new Map();
    const grab = assets.bones.get(assets.rig.grabBone);
    const hanging = state === 'grabbed' || state === 'falling';
    const poseAngle = hanging ? HANG_BASE_ANGLE + clamp(movement.angle, -0.38, 0.38) : 0;
    // All poses share one camera transform. Changing state can rotate around
    // the head, but can never move the head's screen-space anchor.
    const groundY = isFab ? height - FAB_CANVAS_BELOW_PX * dpr : height;
    const fitY = groundY - (viewport.y + viewport.height) * scale;
    const anchorCanvasX = grab ? fitX + grab.restX * scale : 0;
    const anchorCanvasY = grab ? fitY + grab.restY * scale : 0;
    context.save();
    context.setTransform(scale, 0, 0, scale, fitX, fitY);
    if (grab && poseAngle) {
      context.translate(grab.restX, grab.restY);
      context.rotate(poseAngle);
      context.translate(-grab.restX, -grab.restY);
    }
    for (const sprite of assets.rig.sprites) {
      const image = assets.images.get(sprite.image);
      const bone = assets.bones.get(sprite.bone);
      if (!image || !bone) continue;
      const current = boneMatrix(bone, matrices, angles, offsets);
      const deltaBone = multiply(current, translation(-bone.restX, -bone.restY));
      const eyeOffset = sprite.id.startsWith('eye-') && !['sleeping', 'fallen'].includes(state) ? gaze : { x: 0, y: 0 };
      const spriteMatrix = multiply(deltaBone, multiply(translation(sprite.x + eyeOffset.x, sprite.y + eyeOffset.y), rotation(sprite.rotation || 0)));
      context.save();
      context.transform(...spriteMatrix);
      context.drawImage(image, 0, 0);
      context.restore();
    }
    context.restore();
    canvas.style.transform = walkingDirection < 0 ? 'scaleX(-1)' : '';
    root.dataset.ready = 'true';
    root.dataset.state = state;
    root.dataset.motion = motionState;
    root.dataset.transient = transient;
    root.dataset.gaze = `${gaze.x.toFixed(2)},${gaze.y.toFixed(2)}`;
    root.dataset.direction = walkingDirection < 0 ? 'left' : 'right';
    root.dataset.poseMode = RESTING_STATES.has(state) ? 'ragdoll-flat' : (hanging ? 'ragdoll-hang' : 'natural');
    root.dataset.tailAngle = (angles.get('hip/tail1') || 0).toFixed(3);
    root.dataset.poseAngle = poseAngle.toFixed(3);
    if (grab) {
      const cssScaleX = canvas.clientWidth / width;
      const cssScaleY = canvas.clientHeight / height;
      const unmirroredX = anchorCanvasX * cssScaleX;
      const localAnchorX = canvas.offsetLeft + (walkingDirection < 0 ? canvas.clientWidth - unmirroredX : unmirroredX);
      const localAnchorY = canvas.offsetTop + anchorCanvasY * cssScaleY;
      root.dataset.anchorLocal = `${localAnchorX.toFixed(2)},${localAnchorY.toFixed(2)}`;

      const corners = [
        [viewport.x, viewport.y],
        [viewport.x + viewport.width, viewport.y],
        [viewport.x + viewport.width, viewport.y + viewport.height],
        [viewport.x, viewport.y + viewport.height],
      ].map(([modelX, modelY]) => {
        const x = fitX + modelX * scale;
        const y = fitY + modelY * scale;
        if (!poseAngle) return [x, y];
        const dx = x - anchorCanvasX;
        const dy = y - anchorCanvasY;
        return [
          anchorCanvasX + dx * Math.cos(poseAngle) - dy * Math.sin(poseAngle),
          anchorCanvasY + dx * Math.sin(poseAngle) + dy * Math.cos(poseAngle),
        ];
      });
      const margin = 1 * dpr;
      root.dataset.poseClipped = String(corners.some(([x, y]) => x < margin || x > width - margin || y < margin || y > height - margin));
    }
    if (animate || dragging || motionState !== 'idle' || transient) frame = requestAnimationFrame(draw);
  };

  const requestDraw = () => { if (assets && !frame) frame = requestAnimationFrame(draw); };
  loadAssets().then((loaded) => {
    if (disposed) return;
    assets = loaded;
    lastTime = performance.now();
    frame = requestAnimationFrame(draw);
  }).catch(() => { root.dataset.ready = 'false'; });

  const pointerMove = (event) => {
    if (!dragging || event.pointerId !== pointerId || !pointerStart) return;
    const rect = root.getBoundingClientRect();
    const width = root.offsetWidth || rect.width;
    const baseLeft = rect.left - movement.x;
    const nextX = clamp(pointerStart.worldX + event.clientX - pointerStart.x, 18 - baseLeft, innerWidth - 18 - width - baseLeft);
    const nextY = clamp(pointerStart.worldY + event.clientY - pointerStart.y, -innerHeight, innerHeight);
    movement.vx = (nextX - movement.x) * 18;
    movement.vy = (nextY - movement.y) * 18;
    const inertialAngle = clamp(-movement.vx * 0.00019, -0.38, 0.38);
    movement.angularVelocity = (inertialAngle - movement.angle) * 0.62;
    movement.angle = clamp(movement.angle + movement.angularVelocity, -0.38, 0.38);
    movement.x = nextX;
    movement.y = nextY;
    movedDuringPress ||= Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 7;
    if (movedDuringPress) suppressClickUntil = performance.now() + 500;
    applyPosition();
    event.preventDefault();
  };
  const pointerUp = (event) => {
    if (!dragging || event.pointerId !== pointerId) return;
    dragging = false;
    try { root.releasePointerCapture?.(pointerId); } catch { /* Synthetic pointer ids are not native pointers. */ }
    pointerId = null;
    document.removeEventListener('pointermove', pointerMove);
    document.removeEventListener('pointerup', pointerUp);
    document.removeEventListener('pointercancel', pointerUp);
    if (movedDuringPress) {
      const rect = root.getBoundingClientRect();
      const worldCenter = rect.left + rect.width / 2;
      const worldFootY = currentTrackTop() + movement.y;
      const target = dropSurfaceAt(worldCenter, worldFootY);
      if (target) setWalkSurface(target, { worldCenter, worldFootY });
      else clearWalkSurface({ worldCenter, worldFootY });
      motionState = 'falling';
      movement.vy = Math.max(45, movement.vy * 0.35);
      movement.vx *= 0.18;
      notify('drop', { surface: target?.id || 'bottom' });
    } else {
      startTransient('tap', 620);
      suppressClickUntil = performance.now() + 220;
      notify('tap');
    }
    pointerStart = null;
    requestDraw();
  };
  const pointerDown = (event) => {
    if (!interactive || event.button !== 0) return;
    pointerId = event.pointerId;
    pointerStart = { x: event.clientX, y: event.clientY, worldX: movement.x, worldY: movement.y };
    movedDuringPress = false;
    dragging = true;
    motionState = 'idle';
    movement.vx = 0;
    movement.vy = 0;
    try { root.setPointerCapture?.(pointerId); } catch { /* Synthetic gesture pointers cannot be captured. */ }
    document.addEventListener('pointermove', pointerMove);
    document.addEventListener('pointerup', pointerUp);
    document.addEventListener('pointercancel', pointerUp);
    notify('grab');
    requestDraw();
    event.preventDefault();
  };
  const trackGaze = (event) => {
    if (!interactive || dragging || !root.isConnected) return;
    const rect = root.getBoundingClientRect();
    const dx = clamp((event.clientX - (rect.left + rect.width * 0.62)) / Math.max(1, innerWidth * 0.22), -1, 1);
    const dy = clamp((event.clientY - (rect.top + rect.height * 0.32)) / Math.max(1, innerHeight * 0.24), -1, 1);
    gaze.targetX = dx * 5 * (walkingDirection < 0 ? -1 : 1);
    gaze.targetY = dy * 3;
  };
  const playMotion = (type, { duration } = {}) => {
    if (type === 'reset') {
      externalState = 'idle';
      motionState = 'idle';
      movement.x = 0; movement.y = 0; movement.vx = 0; movement.vy = 0; movement.angle = 0;
      boneState.clear();
      refreshWalkSurface(performance.now());
      applyPosition();
      scheduleAutonomy();
    } else if (type === 'tap') {
      startTransient('tap', duration || 620);
      notify('tap');
    } else if (type === 'walk') {
      externalState = 'idle';
      motionState = 'walking';
      behaviorUntil = performance.now() + (duration || 5200);
      notify('walk');
    } else if (type === 'sleep') {
      externalState = 'idle';
      motionState = 'sleeping';
      behaviorUntil = performance.now() + (duration || 5200);
      notify('sleep');
    } else if (type === 'drop') {
      externalState = 'idle';
      motionState = 'falling';
      movement.y = Math.min(movement.y, -Math.min(innerHeight * 0.35, 260));
      movement.vy = 50;
      notify('drop');
    }
    requestDraw();
  };
  const onCommand = (event) => playMotion(event.detail?.type, event.detail || {});
  root.addEventListener('pointerdown', pointerDown);
  root.addEventListener('mascot-command', onCommand);
  if (interactive) window.addEventListener('pointermove', trackGaze, { passive: true });

  return {
    element: root,
    setState(next) {
      externalState = next || 'idle';
      if (externalState !== 'idle') {
        motionState = 'idle';
        movement.x = externalState === 'awake' ? 0 : movement.x;
        movement.y = 0;
        movement.angle = 0;
        applyPosition();
      } else scheduleAutonomy();
      requestDraw();
    },
    react(type) {
      playMotion(type);
    },
    play: playMotion,
    consumeClickSuppression() { return performance.now() < suppressClickUntil; },
    destroy() {
      disposed = true;
      cancelAnimationFrame(frame);
      frame = 0;
      observer.disconnect();
      root.removeEventListener('mascot-command', onCommand);
      window.removeEventListener('pointermove', trackGaze);
      document.removeEventListener('pointermove', pointerMove);
      document.removeEventListener('pointerup', pointerUp);
      document.removeEventListener('pointercancel', pointerUp);
    },
  };
}
