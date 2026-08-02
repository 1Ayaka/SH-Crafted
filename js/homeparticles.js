// Home lotus field: image sprites sampled over the visible wash layer.
// The public API stays compatible with the previous point field so the home
// transition can keep awaiting burst() before routing to the map.
import { reducedMotion } from './particles.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rand = (min, max) => min + Math.random() * (max - min);

function waitForImage(image) {
  if (image.complete && image.naturalWidth) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      image.removeEventListener('load', done);
      image.removeEventListener('error', done);
      resolve();
    };
    image.addEventListener('load', done, { once: true });
    image.addEventListener('error', done, { once: true });
  });
}

function loadImage(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => resolve(null), { once: true });
    image.src = src;
  });
}

function sampleVisibleImage(image, width, height) {
  if (!image.naturalWidth || !image.naturalHeight) return null;
  const sampleWidth = Math.min(280, Math.max(120, Math.round(width / 5)));
  const sampleHeight = Math.max(80, Math.round(sampleWidth * height / Math.max(1, width)));
  const canvas = document.createElement('canvas');
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  // bg-layer uses object-fit: cover. Recreate the visible source crop so the
  // botanical field still follows the light/dark rhythm of the original art.
  const rect = image.getBoundingClientRect();
  const scale = Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
  const renderedWidth = image.naturalWidth * scale;
  const renderedHeight = image.naturalHeight * scale;
  const imageLeft = rect.left + (rect.width - renderedWidth) * 0.5;
  const imageTop = rect.top + (rect.height - renderedHeight) * 0.5;
  const sx = clamp((0 - imageLeft) / scale, 0, image.naturalWidth);
  const sy = clamp((0 - imageTop) / scale, 0, image.naturalHeight);
  const sw = clamp(width / scale, 1, image.naturalWidth - sx);
  const sh = clamp(height / scale, 1, image.naturalHeight - sy);

  try {
    context.drawImage(image, sx, sy, sw, sh, 0, 0, sampleWidth, sampleHeight);
    return {
      width: sampleWidth,
      height: sampleHeight,
      pixels: context.getImageData(0, 0, sampleWidth, sampleHeight).data,
    };
  } catch {
    return null;
  }
}

function sampleWeight(sample, x, y) {
  if (!sample) return 0.55;
  const px = clamp(Math.floor(x * sample.width), 0, sample.width - 1);
  const py = clamp(Math.floor(y * sample.height), 0, sample.height - 1);
  const index = (py * sample.width + px) * 4;
  const r = sample.pixels[index];
  const g = sample.pixels[index + 1];
  const b = sample.pixels[index + 2];
  const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  return clamp(0.11 + (230 - luminance) / 185 + chroma / 310, 0.08, 1);
}

function chromaKeySprite(image, maxSize = 360) {
  const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const work = document.createElement('canvas');
  work.width = width;
  work.height = height;
  const context = work.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, width, height);

  const frame = context.getImageData(0, 0, width, height);
  const pixels = frame.data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const greenLead = g - Math.max(r, b);
      const keyed = g > 70 && g > r * 1.13 && g > b * 1.13;
      const matte = keyed ? clamp((92 - greenLead) / 72, 0, 1) : 1;
      pixels[i + 3] = Math.round(pixels[i + 3] * matte);
      if (matte < 1) pixels[i + 1] = Math.round(Math.min(g, Math.max(r, b) * 1.04));
      if (pixels[i + 3] > 7) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  context.putImageData(frame, 0, 0);
  if (maxX < minX || maxY < minY) return null;

  const padding = 3;
  const cropX = Math.max(0, minX - padding);
  const cropY = Math.max(0, minY - padding);
  const cropWidth = Math.min(width - cropX, maxX - minX + 1 + padding * 2);
  const cropHeight = Math.min(height - cropY, maxY - minY + 1 + padding * 2);
  const sprite = document.createElement('canvas');
  sprite.width = cropWidth;
  sprite.height = cropHeight;
  sprite.getContext('2d')?.drawImage(work, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  return sprite;
}

function tintSprite(source, color, strength) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d');
  if (!context) return source;
  context.drawImage(source, 0, 0);
  context.globalCompositeOperation = 'source-atop';
  context.globalAlpha = strength;
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

async function loadSpriteSet(sources) {
  const loaded = await Promise.all(sources.map(async (entry) => {
    const image = await loadImage(entry.src);
    if (!image) return null;
    const cutout = chromaKeySprite(image);
    if (!cutout) return null;
    const tones = entry.kind === 'flower'
      ? [['#c66b3d', 0.16], ['#b08b6e', 0.12], ['#c08e3a', 0.08]]
      : [['#606c38', 0.17], ['#8b9d83', 0.13], ['#6f7568', 0.09]];
    return {
      kind: entry.kind || 'leaf',
      variants: tones.map(([color, strength]) => tintSprite(cutout, color, strength)),
    };
  }));
  return loaded.filter(Boolean);
}

export async function createHomeParticleField(canvas, sourceImage, options = {}) {
  await waitForImage(sourceImage);
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) return { burst: () => Promise.resolve(), destroy() {} };

  const sources = options.spriteSources || [];
  const spriteGroups = await loadSpriteSet(sources);
  let width = 1;
  let height = 1;
  let botanicals = [];
  let frame = 0;
  let running = false;
  let destroyed = false;
  let lastFrame = 0;
  let resizeTimer = 0;
  let burstTimer = 0;
  let burstState = null;
  let burstId = 0;
  const pointer = { x: 0, y: 0, vx: 0, vy: 0, active: false };
  const isCoarse = matchMedia('(pointer: coarse)').matches;
  const targetFps = isCoarse ? 30 : 45;

  function buildBotanicals() {
    const sample = sampleVisibleImage(sourceImage, width, height);
    const density = reducedMotion ? 0.000016 : (isCoarse ? 0.00003 : 0.000042);
    const minSprites = reducedMotion ? 14 : (isCoarse ? 26 : 38);
    const maxSprites = reducedMotion ? 28 : (isCoarse ? 42 : 58);
    const target = clamp(
      Math.round(width * height * density),
      minSprites,
      maxSprites,
    );
    const hasFlower = spriteGroups.some((group) => group.kind === 'flower');
    const flowerQuota = hasFlower ? (target >= 50 ? 3 : 2) : 0;
    // 先绘制荷叶、最后绘制 2—3 朵荷花，避免花被叶片覆盖。
    const plannedKinds = [
      ...Array.from({ length: target - flowerQuota }, () => 'leaf'),
      ...Array.from({ length: flowerQuota }, () => 'flower'),
    ];
    const next = [];
    let attempts = 0;
    while (spriteGroups.length && next.length < target && attempts < target * 32) {
      attempts += 1;
      const desiredKind = plannedKinds[next.length];
      const placedFlowerCount = next.filter((item) => item.kind === 'flower').length;
      // 第一朵固定在左下，第二朵在右上；第三朵回到左下形成更清楚的主次。
      const bottomLeft = desiredKind === 'flower'
        ? placedFlowerCount !== 1
        : Math.random() < 0.57;
      const angle = Math.random() * Math.PI * 2;
      // Bias gently toward the outer rings so each corner reads as a pond-bank
      // composition, not one opaque pile of overlapping cutouts.
      const radius = Math.pow(Math.random(), 0.78);
      const cluster = bottomLeft
        ? { x: 0.145, y: 0.835, rx: 0.2, ry: 0.16 }
        : { x: 0.885, y: 0.245, rx: 0.18, ry: 0.145 };
      let nx = clamp(cluster.x + Math.cos(angle) * cluster.rx * radius, bottomLeft ? 0.012 : 0.675, bottomLeft ? 0.405 : 0.988);
      let ny = clamp(cluster.y + Math.sin(angle) * cluster.ry * radius, bottomLeft ? 0.66 : 0.135, bottomLeft ? 0.988 : 0.42);
      if (desiredKind === 'flower' && bottomLeft) {
        const flowerSlot = placedFlowerCount === 0
          ? { x: 0.135, y: 0.79 }
          : { x: 0.245, y: 0.715 };
        nx = flowerSlot.x + rand(-0.018, 0.018);
        ny = flowerSlot.y + rand(-0.016, 0.016);
      }
      // Preserve the hero copy, the navigation and the lower-left guide icon.
      if (nx < 0.47 && ny < 0.62) continue;
      if (!bottomLeft && ny < 0.115) continue;
      if (bottomLeft && nx < 0.105 && ny > 0.89 && Math.random() < 0.82) continue;
      const weight = sampleWeight(sample, nx, ny);
      if (Math.random() > 0.5 + Math.pow(weight, 0.78) * 0.46) continue;
      const group = spriteGroups.find((candidate) => candidate.kind === desiredKind)
        || spriteGroups.find((candidate) => candidate.kind === 'leaf')
        || spriteGroups[0];
      const sprite = group.variants[Math.floor(Math.random() * group.variants.length)];
      const x = nx * width;
      const y = ny * height;
      const feature = Math.random() < (group.kind === 'flower' ? 0.64 : 0.11);
      const size = group.kind === 'flower'
        ? (feature ? rand(148, 188) : rand(isCoarse ? 98 : 108, isCoarse ? 142 : 154))
        : (feature ? rand(96, 132) : rand(isCoarse ? 42 : 48, isCoarse ? 84 : 96));
      const itemAlpha = group.kind === 'flower'
        ? rand(feature ? 0.62 : 0.52, feature ? 0.76 : 0.66)
        : rand(0.18, feature ? 0.44 : 0.35);
      next.push({
        kind: group.kind,
        corner: bottomLeft ? 'bottom-left' : 'top-right',
        sprite,
        homeX: x,
        homeY: y,
        x,
        y,
        vx: 0,
        vy: 0,
        size,
        alpha: bottomLeft && group.kind === 'flower'
          ? Math.min(0.84, itemAlpha + 0.1)
          : (bottomLeft && group.kind === 'leaf' ? Math.min(0.58, itemAlpha + 0.14) : itemAlpha),
        phase: rand(0, Math.PI * 2),
        drift: rand(0.55, 1.35),
        rotation: rand(-Math.PI, Math.PI),
        rotationBias: rand(-0.003, 0.003),
        burstId: -1,
      });
    }
    botanicals = next;
    canvas.dataset.particleCount = String(botanicals.length);
    canvas.dataset.spriteCount = String(botanicals.length);
    canvas.dataset.flowerCount = String(botanicals.filter((item) => item.kind === 'flower').length);
    canvas.dataset.bottomLeftFlowerCount = String(botanicals.filter((item) => item.kind === 'flower' && item.corner === 'bottom-left').length);
    canvas.dataset.leafCount = String(botanicals.filter((item) => item.kind === 'leaf').length);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, isCoarse ? 1.15 : 1.5);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildBotanicals();
    if (reducedMotion) draw(performance.now(), 0);
  }

  function draw(now, dt = 16.7) {
    context.clearRect(0, 0, width, height);
    const burstAge = burstState ? now - burstState.startedAt : Infinity;
    const burstProgress = burstState ? clamp(burstAge / burstState.duration, 0, 1) : 0;
    const exitAlpha = burstState ? 1 - Math.pow(clamp((burstProgress - 0.15) / 0.85, 0, 1), 1.22) : 1;
    const pointerRadius = isCoarse ? 94 : 145;
    const timeScale = clamp(dt / 16.7, 0.3, 2.2);

    for (const item of botanicals) {
      if (!reducedMotion) {
        const breathingX = Math.cos(now * 0.0003 + item.phase) * 1.6 * item.drift;
        const breathingY = Math.sin(now * 0.00043 + item.phase) * 2.8 * item.drift;
        const targetX = item.homeX + breathingX;
        const targetY = item.homeY + breathingY;

        if (pointer.active && !burstState) {
          const dx = item.x - pointer.x;
          const dy = item.y - pointer.y;
          const distance = Math.hypot(dx, dy) || 1;
          if (distance < pointerRadius + item.size * 0.35) {
            const influence = Math.pow(1 - distance / (pointerRadius + item.size * 0.35), 2);
            const sweepX = Math.abs(pointer.vx) > 0.2 ? pointer.vx * 0.038 : dx / distance;
            const sweepY = Math.abs(pointer.vy) > 0.2 ? pointer.vy * 0.038 : dy / distance;
            item.vx += (dx / distance * 1.05 + sweepX) * influence * timeScale;
            item.vy += (dy / distance * 1.05 + sweepY) * influence * timeScale;
          }
        }

        if (burstState && item.burstId !== burstState.id) {
          const dx = item.x - burstState.x;
          const dy = item.y - burstState.y;
          const distance = Math.hypot(dx, dy) || 1;
          const waveRadius = burstProgress * Math.hypot(width, height) * 0.76;
          if (distance <= waveRadius + 74) {
            const force = rand(9.5, 17.5) * (1 - Math.min(0.68, distance / Math.hypot(width, height)));
            item.vx += dx / distance * force;
            item.vy += dy / distance * force;
            item.rotationBias += rand(-0.02, 0.02);
            item.burstId = burstState.id;
          }
        }

        const spring = burstState ? 0.001 : 0.0046;
        item.vx += (targetX - item.x) * spring * timeScale;
        item.vy += (targetY - item.y) * spring * timeScale;
        const damping = Math.pow(burstState ? 0.962 : 0.925, timeScale);
        item.vx *= damping;
        item.vy *= damping;
        item.x += item.vx * timeScale;
        item.y += item.vy * timeScale;
        item.rotation += (item.rotationBias + item.vx * 0.00055) * timeScale;
        item.rotationBias *= Math.pow(0.987, timeScale);
      }

      const breath = reducedMotion ? 1 : 0.93 + Math.sin(now * 0.00068 + item.phase) * 0.07;
      const alpha = item.alpha * (0.84 + breath * 0.16) * exitAlpha;
      if (alpha <= 0.008) continue;
      const drawWidth = item.size * breath;
      const aspect = item.sprite.height / Math.max(1, item.sprite.width);
      context.save();
      context.translate(item.x, item.y);
      context.rotate(item.rotation);
      context.globalAlpha = alpha;
      if (item.kind === 'flower' && item.corner === 'bottom-left') {
        context.filter = 'contrast(1.42) saturate(1.14) brightness(0.76)';
        context.shadowColor = 'rgba(96,108,56,.42)';
        context.shadowBlur = 7;
      }
      context.drawImage(item.sprite, -drawWidth * 0.5, -drawWidth * aspect * 0.5, drawWidth, drawWidth * aspect);
      context.restore();
    }
  }

  function tick(now) {
    if (!running || destroyed) return;
    frame = requestAnimationFrame(tick);
    const interval = 1000 / targetFps;
    if (now - lastFrame < interval) return;
    const dt = lastFrame ? now - lastFrame : interval;
    lastFrame = now;
    pointer.vx *= 0.72;
    pointer.vy *= 0.72;
    draw(now, dt);
  }

  function start() {
    if (running || destroyed || document.hidden || reducedMotion) return;
    running = true;
    lastFrame = 0;
    frame = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(frame);
    frame = 0;
  }

  function onPointerMove(event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    pointer.vx = clamp(x - pointer.x, -38, 38);
    pointer.vy = clamp(y - pointer.y, -38, 38);
    pointer.x = x;
    pointer.y = y;
    pointer.active = true;
  }

  function onPointerLeave() {
    pointer.active = false;
  }

  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  }

  function onVisibilityChange() {
    if (document.hidden) stop();
    else start();
  }

  const host = canvas.closest('.home') || canvas.parentElement;
  canvas.dataset.sourceLayer = options.sourceLayer || sourceImage.dataset.role || 'layer-0';
  canvas.dataset.interaction = reducedMotion ? 'static-reduced-motion' : 'ripple-return-burst';
  canvas.dataset.assetKinds = [...new Set(spriteGroups.map((group) => group.kind))].join(',');
  canvas.dataset.fieldType = 'lotus-sprites';
  canvas.dataset.layout = 'corner-clusters';
  host?.addEventListener('pointermove', onPointerMove, { passive: true });
  host?.addEventListener('pointerleave', onPointerLeave);
  window.addEventListener('resize', onResize, { passive: true });
  document.addEventListener('visibilitychange', onVisibilityChange);
  resize();
  canvas.dataset.ready = String(spriteGroups.length > 0);
  start();

  return {
    burst(x, y) {
      if (destroyed || reducedMotion) return Promise.resolve();
      clearTimeout(burstTimer);
      burstState = {
        id: ++burstId,
        x: clamp(x, 0, width),
        y: clamp(y, 0, height),
        startedAt: performance.now(),
        duration: 440,
      };
      pointer.active = false;
      return new Promise((resolve) => {
        burstTimer = setTimeout(resolve, 295);
      });
    },
    destroy() {
      destroyed = true;
      stop();
      clearTimeout(resizeTimer);
      clearTimeout(burstTimer);
      host?.removeEventListener('pointermove', onPointerMove);
      host?.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      botanicals = [];
      context.clearRect(0, 0, width, height);
    },
  };
}
