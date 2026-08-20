import assert from 'node:assert/strict';
import { createGestureClassifier } from '../js/gesture/gesture-classifier.js';
import { createGestureStateMachine, GESTURE_STATES } from '../js/gesture/gesture-state-machine.js';
import { createActionRegistry } from '../js/interaction/action-registry.js';
import { createPointerGestureStateMachine, POINTER_GESTURE_STATES } from '../js/gesture/pointer-gesture-state-machine.js';
import { createCoordinateMapper } from '../js/gesture/coordinate-mapper.js';
import { createInputCoordinator } from '../js/interaction/input-coordinator.js';
import { createDirectDragSession } from '../js/gesture/direct-drag-session.js';
import { createThreeTargetAdapter } from '../js/interaction/three-target-adapter.js';
import { createCameraManager } from '../js/gesture/camera-manager.js';
import { createTargetResolver } from '../js/interaction/target-resolver.js';
import { shouldBeginDirectPalmDrag } from '../js/gesture/gesture-drag-policy.js';
import { createGestureDiagnostics } from '../js/gesture/gesture-diagnostics.js';

const events = [];
const classifier = createGestureClassifier({ onGesture: (event) => events.push(event) });
const packedLandmarks = new Float32Array(21 * 3);
packedLandmarks[8 * 3] = 0.42;
packedLandmarks[8 * 3 + 1] = 0.36;
classifier.update(packedLandmarks, 100);
const cursor = events.find((event) => event.type === 'cursor');
assert.ok(cursor, 'packed landmarks should produce a cursor event');
// 指针锚定在掌心（手腕 + 掌指关节加权平均），而不是指尖
assert.ok(Math.abs(cursor.x - 0) < 0.001);
assert.ok(Math.abs(cursor.y - 0) < 0.001);
assert.equal(classifier.hasHand(), true);

const objectLandmarks = Array.from({ length: 21 }, (_, index) => ({
  x: index === 8 ? 0.2 : 0.5,
  y: index === 8 ? 0.3 : 0.5,
  z: 0,
}));
classifier.update(objectLandmarks, 140);
assert.ok(Math.abs(events.filter((event) => event.type === 'cursor').at(-1).x - 0.5) < 0.001);

const pinchEvents = [];
const pinchClassifier = createGestureClassifier({ onGesture: (event) => pinchEvents.push(event) });
const makeHand = (thumbX) => Array.from({ length: 21 }, (_, index) => ({
  x: index === 4 ? thumbX : index === 8 ? 0.5 : 0.5,
  y: index === 0 ? 0.8 : index === 4 || index === 8 ? 0.3 : 0.5,
  z: 0,
}));
pinchClassifier.update(makeHand(0.54), 0);
pinchClassifier.update(makeHand(0.54), 40);
pinchClassifier.update(makeHand(0.54), 80);
pinchClassifier.update(makeHand(0.85), 120);
pinchClassifier.update(makeHand(0.85), 160);
pinchClassifier.update(makeHand(0.85), 200);
pinchClassifier.update(makeHand(0.85), 240);
assert.ok(pinchEvents.some((event) => event.type === 'pinch' && event.phase === 'end'));

// Real MediaPipe Z estimates at touching fingertips can differ substantially.
// Pinch recognition must use image-plane distance and win over a fist-like pose.
const depthPinchEvents = [];
const depthPinchClassifier = createGestureClassifier({ onGesture: (event) => depthPinchEvents.push(event) });
const depthPinchHand = (released = false) => Array.from({ length: 21 }, (_, index) => {
  const point = { x: 0.5, y: 0.62, z: 0 };
  if (index === 0) Object.assign(point, { x: 0.5, y: 0.82 });
  if (index === 9) Object.assign(point, { x: 0.5, y: 0.56 });
  if (index === 4) Object.assign(point, { x: released ? 0.78 : 0.49, y: 0.34, z: -0.22 });
  if (index === 8) Object.assign(point, { x: 0.51, y: 0.34, z: 0.22 });
  return point;
});
depthPinchClassifier.update(depthPinchHand(), 0);
depthPinchClassifier.update(depthPinchHand(), 45);
depthPinchClassifier.update(depthPinchHand(true), 100);
depthPinchClassifier.update(depthPinchHand(true), 145);
depthPinchClassifier.update(depthPinchHand(true), 190);
depthPinchClassifier.update(depthPinchHand(true), 235);
assert.ok(depthPinchEvents.some((event) => event.type === 'pinch' && event.phase === 'start'), '深度抖动或卷曲手指不应阻止捏合');
assert.ok(depthPinchEvents.some((event) => event.type === 'pinch' && event.phase === 'end'), '捏合松开应结束原始捏合周期');
assert.ok(depthPinchEvents.some((event) => event.type === 'pinch' && event.manipulationCoords), '捏合事件应包含稳定操作锚点');

const pointerClick = createPointerGestureStateMachine({ clickSlopPx: 34, holdSlopPx: 42, longPressMs: 520, smoothing: 1 });
pointerClick.start({ x: 100, y: 100 }, 0);
pointerClick.move({ x: 121, y: 112 }, 120);
const clickOutcome = pointerClick.end({ x: 126, y: 116 }, 180);
assert.equal(clickOutcome.type, 'click', '摄像头放大后的自然手抖不应取消点击');
assert.equal(clickOutcome.wasClick, true);

const prematureSceneDrag = createPointerGestureStateMachine({ clickSlopPx: 34, holdSlopPx: 42, longPressMs: 520, smoothing: 1 });
prematureSceneDrag.start({ x: 100, y: 100 }, 0);
const prematureMove = prematureSceneDrag.move({ x: 138, y: 100 }, 120);
assert.ok(!prematureMove.some((event) => event.type === 'drag-start'), '长按前的移动不得穿透为场景拖拽');
const canceledOutcome = prematureSceneDrag.end({ x: 138, y: 100 }, 180);
assert.equal(canceledOutcome.type, 'cancel', '明显移动过的短按应安全取消而不是误点或旋转');

const pointerHoldDrag = createPointerGestureStateMachine({ clickSlopPx: 34, holdSlopPx: 42, longPressMs: 520, postHoldDragThresholdPx: 6, smoothing: 1 });
pointerHoldDrag.start({ x: 100, y: 100 }, 0);
const holdStart = pointerHoldDrag.move({ x: 124, y: 112 }, 540);
assert.ok(holdStart.some((event) => event.type === 'long-press-start'));
const holdToDrag = pointerHoldDrag.move({ x: 132, y: 112 }, 580);
assert.ok(holdToDrag.some((event) => event.type === 'drag-start'));
assert.ok(holdToDrag.some((event) => event.type === 'drag-move'), '长按确认后的首段移动不得丢失');
assert.ok(!holdToDrag.some((event) => event.type === 'long-press-end'), '开始旋转时应继续持有长按所有权');
assert.equal(pointerHoldDrag.state(), POINTER_GESTURE_STATES.DRAGGING);
const dragOutcome = pointerHoldDrag.end({ x: 140, y: 118 }, 620);
assert.equal(dragOutcome.type, 'drag-end');
assert.ok(dragOutcome.events.some((event) => event.type === 'drag-end'));
assert.ok(dragOutcome.events.some((event) => event.type === 'long-press-end'), '释放时应一次性结束拖拽和长按');

const movingPointer = createPointerGestureStateMachine({ clickSlopPx: 34, holdSlopPx: 42, longPressMs: 520, smoothing: 1 });
movingPointer.start({ x: 100, y: 100 }, 0);
const movingEvents = movingPointer.move({ x: 145, y: 100 }, 300);
assert.ok(!movingEvents.some((event) => event.type === 'drag-start'), '未长按时不应旋转场景');
assert.ok(!movingEvents.some((event) => event.type === 'long-press-start'));

const nonStationaryHold = createPointerGestureStateMachine({ clickSlopPx: 34, holdSlopPx: 42, longPressMs: 520, smoothing: 1 });
nonStationaryHold.start({ x: 100, y: 100 }, 0);
nonStationaryHold.move({ x: 146, y: 100 }, 180);
nonStationaryHold.move({ x: 100, y: 100 }, 600);
assert.equal(nonStationaryHold.state(), POINTER_GESTURE_STATES.PRESSED, '离开长按容差区后即使回到原点也不应误触发长按');

const thresholdClick = createPointerGestureStateMachine({ longPressMs: 700, smoothing: 1 });
thresholdClick.start({ x: 100, y: 100 }, 0);
thresholdClick.move({ x: 102, y: 101 }, 650);
assert.equal(thresholdClick.end({ x: 102, y: 101 }, 660).wasClick, true, '低于阈值的捏合只能在松开时点击');
const thresholdHold = createPointerGestureStateMachine({ longPressMs: 700, smoothing: 1 });
thresholdHold.start({ x: 100, y: 100 }, 0);
assert.ok(thresholdHold.move({ x: 102, y: 101 }, 710).some((event) => event.type === 'long-press-start'), '只有持续捏合超过阈值才能进入长按');

const coordinator = createInputCoordinator();
assert.equal(coordinator.isGestureTypeAllowed('pinch-start'), true);
assert.equal(coordinator.isGestureTypeAllowed('air-drag-end'), true);
assert.equal(coordinator.isGestureTypeAllowed('pinch-end'), true, '拖拽结束后的兼容释放事件应通过宽限窗口');

const directDrag = createDirectDragSession({ smoothing: 1, gain: 1, minDeltaPx: 0, maxDeltaPx: 64 });
directDrag.start({ x: 100, y: 100 });
const directMove = directDrag.move({ x: 114, y: 106 });
assert.deepEqual({ dx: directMove.dx, dy: directMove.dy }, { dx: 14, dy: 6 }, '张掌移动必须首帧直接产生拖拽增量');
assert.equal(directDrag.end({ x: 114, y: 106 }).type, 'drag-end');

// 全屏地图可以关闭张掌直接拖拽，但不改变其他 Three.js 场景的默认行为。
const originalDocument = globalThis.document;
const mapCanvas = {
  isConnected: true,
  getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }),
};
globalThis.document = {
  elementFromPoint: () => mapCanvas,
  querySelector: () => null,
  querySelectorAll: () => [],
};
try {
  const dragPolicyResolver = createTargetResolver();
  dragPolicyResolver.registerThreeContext('map3d', {
    rendererDomElement: mapCanvas,
    interactiveCanvas: true,
    allowDirectPalmDrag: false,
  });
  dragPolicyResolver.setActiveThreeContext('map3d');
  assert.equal(
    dragPolicyResolver.resolve(400, 300)?.allowDirectPalmDrag,
    false,
    '地图目标必须保留禁止张掌直接拖拽的场景策略',
  );
  assert.equal(
    shouldBeginDirectPalmDrag(dragPolicyResolver.resolve(400, 300)),
    false,
    '地图的放松张掌不得开始场景拖拽',
  );

  dragPolicyResolver.registerThreeContext('craft-model', {
    rendererDomElement: mapCanvas,
    interactiveCanvas: true,
  });
  dragPolicyResolver.setActiveThreeContext('craft-model');
  assert.equal(
    dragPolicyResolver.resolve(400, 300)?.allowDirectPalmDrag,
    true,
    '其他 Three.js 场景应继续默认允许张掌直接拖拽',
  );
  assert.equal(shouldBeginDirectPalmDrag(dragPolicyResolver.resolve(400, 300)), true);
} finally {
  globalThis.document = originalDocument;
}

const directThree = createThreeTargetAdapter();
const directThreeEvents = [];
directThree.registerContext('map-test', {
  onDragStart: () => directThreeEvents.push('start'),
  onDragMove: (dx, dy) => directThreeEvents.push(['move', dx, dy]),
  onDragEnd: () => directThreeEvents.push('end'),
});
const routedDrag = createDirectDragSession({ smoothing: 1, gain: 1 });
directThree.dragStart('map-test');
routedDrag.start({ x: 200, y: 180 });
const routedMove = routedDrag.move({ x: 232, y: 168 });
directThree.dragMove('map-test', routedMove.dx, routedMove.dy);
routedDrag.end({ x: 232, y: 168 });
directThree.dragEnd('map-test');
assert.deepEqual(directThreeEvents, ['start', ['move', 32, -12], 'end'], '张掌拖拽必须完整贯通 Three 场景适配器');

// A scene drag remains routed after the pointer leaves the original mesh.
const lockedScene = createThreeTargetAdapter();
const lockedEvents = [];
lockedScene.registerContext('locked-map', {
  onDragStart: () => lockedEvents.push('start'),
  onDragMove: (dx, dy) => lockedEvents.push(['move', dx, dy]),
  onDragEnd: () => lockedEvents.push('end'),
});
lockedScene.dragStart('locked-map', null, null);
lockedScene.dragMove('locked-map', 18, 0);
lockedScene.dragMove('locked-map', -7, 4);
lockedScene.dragEnd('locked-map');
assert.deepEqual(lockedEvents, ['start', ['move', 18, 0], ['move', -7, 4], 'end'], '场景拖拽离开原节点后仍应持续旋转当前场景');

const poseEvents = [];
const poseClassifier = createGestureClassifier({ onGesture: (event) => poseEvents.push(event) });
const poseHand = (pose) => Array.from({ length: 21 }, (_, index) => {
  const pipIndices = new Set([6, 10, 14, 18]);
  const tipIndices = new Set([8, 12, 16, 20]);
  const mcpIndices = new Set([5, 9, 13, 17]);
  let y = index === 0 ? 0.82 : mcpIndices.has(index) ? 0.58 : pipIndices.has(index) ? 0.48 : 0.5;
  if (tipIndices.has(index)) y = pose === 'fist' ? 0.7 : 0.2;
  return { x: 0.38 + (index % 4) * 0.08, y, z: 0 };
});
for (let frame = 0; frame < 10; frame += 1) poseClassifier.update(poseHand('fist'), frame * 34);
poseClassifier.update(poseHand('palm'), 380);
for (let frame = 0; frame < 17; frame += 1) poseClassifier.update(poseHand('palm'), 420 + frame * 34);
assert.ok(poseEvents.some((event) => event.type === 'fist' && event.phase === 'start'), '稳定握拳应触发缩小手势');
assert.ok(!poseEvents.some((event) => event.type === 'palm'), '稳定张掌必须保持闲置，不得产生按下、移动或释放事件');

const edgeMapper = createCoordinateMapper({
  viewportWidth: 1000,
  viewportHeight: 800,
  videoWidth: 1000,
  videoHeight: 800,
  mirrored: false,
  edgeInsetX: 0.1,
  edgeInsetY: 0.1,
});
assert.ok(edgeMapper.landmarkToScreen(0.1, 0.1).x <= 1, '摄像头安全区左边缘应映射到屏幕左边缘');
assert.ok(edgeMapper.landmarkToScreen(0.9, 0.9).x >= 999, '摄像头安全区右边缘应映射到屏幕右边缘');
assert.ok(Math.abs(edgeMapper.landmarkToScreen(0.5, 0.5).x - 500) < 1, '摄像头中心映射应保持稳定');

const offsetMapper = createCoordinateMapper({
  viewportWidth: 1000,
  viewportHeight: 800,
  videoWidth: 1000,
  videoHeight: 800,
  mirrored: false,
  edgeInsetX: 0,
  edgeInsetY: 0,
  screenOffsetXRatio: -0.018,
  screenOffsetYRatio: -0.022,
});
assert.deepEqual(
  offsetMapper.landmarkToScreen(0.5, 0.5),
  { x: 482, y: 382.4 },
  '最终手势锚点应按视口比例轻微左移、上移',
);

const machine = createGestureStateMachine();
for (const state of [
  GESTURE_STATES.REQUESTING_PERMISSION,
  GESTURE_STATES.CAMERA_STARTING,
  GESTURE_STATES.LOADING_MODEL,
  GESTURE_STATES.CALIBRATING,
  GESTURE_STATES.SEARCHING_HAND,
  GESTURE_STATES.READY,
  GESTURE_STATES.ACTIVE,
]) machine.transition(state);
assert.equal(machine.state(), GESTURE_STATES.ACTIVE);

const actions = createActionRegistry();
actions.registerAction('gesture-click', async ({ target }) => ({ target }));
const actionResult = await actions.execute('gesture-click', { target: { id: 'test' } });
assert.equal(actionResult.success, true);
assert.equal(actionResult.target.id, 'test');

globalThis.document = {
  querySelector: () => null,
  elementFromPoint: () => null,
};

// If the user switches gestures off while the browser permission prompt is
// still pending, a late stream must be stopped instead of reopening gestures.
let resolvePendingMedia;
let lateTrackStopped = false;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    mediaDevices: {
      getUserMedia: () => new Promise((resolve) => { resolvePendingMedia = resolve; }),
    },
  },
});
const pendingCamera = createCameraManager();
const pendingCameraStart = pendingCamera.start();
pendingCamera.destroy();
resolvePendingMedia({
  getTracks: () => [{ stop: () => { lateTrackStopped = true; } }],
});
await assert.rejects(pendingCameraStart, /camera_manager_destroyed/);
assert.equal(lateTrackStopped, true, '关闭后才返回的摄像头流必须立即停止');

const resolver = createTargetResolver();
const mesh = { uuid: 'mesh-1', userData: { node: { id: 'heritage:test' } } };
const renderer = {
  isConnected: true,
  getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }),
};
resolver.registerThreeContext('test-scene', {
  rendererDomElement: renderer,
  getTargets: () => [mesh],
  camera: {},
  raycaster: {
    setFromCamera() {},
    intersectObjects: () => [{ object: mesh, point: {}, distance: 1 }],
  },
});
const resolved = resolver.resolve(50, 50);
assert.equal(resolved.layer, 'three_scene');
assert.equal(resolved.targetId, 'heritage:test');

// 指针锚定掌心：指尖卷曲/抖动（尤其捏合期间）不得带动指针乱飘。
const lockEvents = [];
const lockClassifier = createGestureClassifier({ onGesture: (event) => lockEvents.push(event) });
const lockHand = (thumbTip, indexTip) => Array.from({ length: 21 }, (_, index) => {
  if (index === 0) return { x: 0.5, y: 0.82, z: 0 };
  if (index === 4) return { x: thumbTip.x, y: thumbTip.y, z: 0 };
  if (index === 8) return { x: indexTip.x, y: indexTip.y, z: 0 };
  return { x: 0.5 + (index % 3) * 0.03, y: 0.6, z: 0 };
});
// lockHand 的掌心 = 手腕×0.5 与 MediaPipe 的四个掌指关节(5、9、13、17) 的加权平均
const lockPalmX = (0.5 * 0.5 + 0.56 + 0.5 + 0.53 + 0.56) / 4.5;
const lockPalmY = (0.82 * 0.5 + 0.6 + 0.6 + 0.6 + 0.6) / 4.5;
lockClassifier.update(lockHand({ x: 0.62, y: 0.3 }, { x: 0.5, y: 0.34 }), 0); // 未捏合
lockClassifier.update(lockHand({ x: 0.48, y: 0.36 }, { x: 0.5, y: 0.34 }), 40);
lockClassifier.update(lockHand({ x: 0.48, y: 0.36 }, { x: 0.5, y: 0.34 }), 80); // 捏合开始
lockClassifier.update(lockHand({ x: 0.5, y: 0.37 }, { x: 0.56, y: 0.38 }), 120); // 指尖抖动，掌心不动
lockClassifier.update(lockHand({ x: 0.49, y: 0.35 }, { x: 0.58, y: 0.33 }), 160);
assert.ok(lockEvents.some((event) => event.type === 'pinch' && event.phase === 'start'), '捏合应正常触发');
const allCursors = lockEvents.filter((event) => event.type === 'cursor');
assert.equal(allCursors.length, 5);
assert.ok(
  allCursors.every((event) => Math.abs(event.x - lockPalmX) < 0.001 && Math.abs(event.y - lockPalmY) < 0.001),
  '任何手型下指针都应锚定掌心，指尖移动不得带动指针位置',
);

// 冷却期内按住不放不得补发幻影捏合；松开后应恢复正常。
const cooldownEvents = [];
const cooldownClassifier = createGestureClassifier({ onGesture: (event) => cooldownEvents.push(event) });
const pinchedHand = () => lockHand({ x: 0.48, y: 0.36 }, { x: 0.5, y: 0.34 });
const releasedHand = () => lockHand({ x: 0.72, y: 0.4 }, { x: 0.5, y: 0.34 });
cooldownClassifier.update(pinchedHand(), 0);
cooldownClassifier.update(pinchedHand(), 40); // 第一次捏合开始
for (let frame = 0; frame < 5; frame += 1) cooldownClassifier.update(releasedHand(), 80 + frame * 40); // 松开，end 触发
for (let frame = 0; frame < 12; frame += 1) cooldownClassifier.update(pinchedHand(), 280 + frame * 40); // 冷却期内二次捏合并按住
assert.equal(
  cooldownEvents.filter((event) => event.type === 'pinch' && event.phase === 'start').length,
  1,
  '冷却期内按住不放不得补发幻影捏合',
);
for (let frame = 0; frame < 5; frame += 1) cooldownClassifier.update(releasedHand(), 760 + frame * 40); // 真正松开
cooldownClassifier.update(pinchedHand(), 1000);
cooldownClassifier.update(pinchedHand(), 1040);
cooldownClassifier.update(pinchedHand(), 1080);
assert.equal(
  cooldownEvents.filter((event) => event.type === 'pinch' && event.phase === 'start').length,
  2,
  '冷却吞掉的捏合松开后，再次捏合应正常触发',
);

// 自然张掌和拇指放松靠近食指都应保持闲置，不得产生按下或长按。
const relaxedPalmEvents = [];
const relaxedPalmClassifier = createGestureClassifier({ onGesture: (event) => relaxedPalmEvents.push(event) });
const relaxedPalmHand = () => Array.from({ length: 21 }, (_, index) => {
  if (index === 0) return { x: 0.5, y: 0.82, z: 0 };
  if (index === 4) return { x: 0.48, y: 0.4, z: 0 }; // 拇指放松，靠近食指但不构成捏合
  if (index === 8) return { x: 0.42, y: 0.3, z: 0 };
  if ([6, 10, 14, 18].includes(index)) return { x: 0.42 + (index - 6) * 0.02, y: 0.42, z: 0 };
  if ([5, 9, 13, 17].includes(index)) return { x: 0.42 + (index - 5) * 0.02, y: 0.56, z: 0 };
  return { x: 0.44 + (index % 4) * 0.04, y: 0.3, z: 0 }; // 其余指尖伸直
});
for (let frame = 0; frame < 8; frame += 1) relaxedPalmClassifier.update(relaxedPalmHand(), frame * 40);
assert.ok(!relaxedPalmEvents.some((event) => event.type === 'palm'), '自然张掌不得再解释为按下或拖拽');
assert.ok(
  !relaxedPalmEvents.some((event) => event.type === 'pinch' && event.phase === 'start'),
  '放松的拇指不应被误判为捏合',
);

const diagnostics = createGestureDiagnostics({ limit: 8 });
diagnostics.record('classification-sample', { filtered_pinch_ratio: 0.31, landmarks: [{ x: 1, y: 2 }] });
diagnostics.record('pointer-semantic', { type: 'long-press-start', elapsed_ms: 710 });
const diagnosticPayload = JSON.parse(diagnostics.exportText());
assert.equal(diagnosticPayload.schema, 'sh-crafted-gesture-diagnostics/v1');
assert.equal(diagnosticPayload.entries.some((entry) => entry.type === 'long-press-start'), true);
assert.equal(diagnosticPayload.entries.some((entry) => Object.hasOwn(entry, 'landmarks')), false, '诊断日志不得保存原始手部关键点或摄像头内容');

console.log('gesture tests: PASS');
