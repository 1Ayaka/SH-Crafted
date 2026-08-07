import assert from 'node:assert/strict';
import { createGestureClassifier } from '../js/gesture/gesture-classifier.js';
import { createGestureStateMachine, GESTURE_STATES } from '../js/gesture/gesture-state-machine.js';
import { createActionRegistry } from '../js/interaction/action-registry.js';
import { createPointerGestureStateMachine, POINTER_GESTURE_STATES } from '../js/gesture/pointer-gesture-state-machine.js';
import { createCoordinateMapper } from '../js/gesture/coordinate-mapper.js';
import { createInputCoordinator } from '../js/interaction/input-coordinator.js';
import { createDirectDragSession } from '../js/gesture/direct-drag-session.js';
import { createThreeTargetAdapter } from '../js/interaction/three-target-adapter.js';

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

const pointerClick = createPointerGestureStateMachine({ dragThresholdPx: 10, stationarySlopPx: 8, longPressMs: 560, smoothing: 1 });
pointerClick.start({ x: 100, y: 100 }, 0);
pointerClick.move({ x: 105, y: 104 }, 120);
const clickOutcome = pointerClick.end({ x: 106, y: 105 }, 180);
assert.equal(clickOutcome.type, 'click', '阈值内的自然手抖不应取消点击');
assert.equal(clickOutcome.wasClick, true);

const pointerDrag = createPointerGestureStateMachine({ dragThresholdPx: 10, stationarySlopPx: 8, longPressMs: 560, smoothing: 1 });
pointerDrag.start({ x: 100, y: 100 }, 0);
const dragStartEvents = pointerDrag.move({ x: 112, y: 100 }, 120);
assert.ok(dragStartEvents.some((event) => event.type === 'drag-start'), '超过像素阈值应立即进入拖拽');
const dragMoveEvents = pointerDrag.move({ x: 124, y: 106 }, 150);
assert.ok(dragMoveEvents.some((event) => event.type === 'drag-move' && event.dx === 12 && event.dy === 6), '拖拽应输出逐帧像素增量');
const dragOutcome = pointerDrag.end({ x: 124, y: 106 }, 180);
assert.equal(dragOutcome.type, 'drag-end');
assert.ok(dragOutcome.events.some((event) => event.type === 'drag-end'), '释放应输出拖拽结束事件');

const pointerHoldDrag = createPointerGestureStateMachine({ dragThresholdPx: 10, stationarySlopPx: 8, longPressMs: 560, smoothing: 1 });
pointerHoldDrag.start({ x: 100, y: 100 }, 0);
const holdStart = pointerHoldDrag.move({ x: 104, y: 103 }, 600);
assert.ok(holdStart.some((event) => event.type === 'long-press-start'));
const holdToDrag = pointerHoldDrag.move({ x: 115, y: 103 }, 650);
assert.ok(holdToDrag.some((event) => event.type === 'long-press-end'));
assert.ok(holdToDrag.some((event) => event.type === 'drag-start'));
assert.equal(pointerHoldDrag.state(), POINTER_GESTURE_STATES.DRAGGING);

const movingPointer = createPointerGestureStateMachine({ dragThresholdPx: 10, stationarySlopPx: 8, longPressMs: 560, smoothing: 1 });
movingPointer.start({ x: 100, y: 100 }, 0);
const movingEvents = movingPointer.move({ x: 111, y: 100 }, 300);
assert.ok(movingEvents.some((event) => event.type === 'drag-start'), '移动超过 10px 应优先进入拖拽');
assert.ok(!movingEvents.some((event) => event.type === 'long-press-start'), '已移动的按下状态不得误报长按');

const nonStationaryHold = createPointerGestureStateMachine({ dragThresholdPx: 10, stationarySlopPx: 8, longPressMs: 560, smoothing: 1 });
nonStationaryHold.start({ x: 100, y: 100 }, 0);
nonStationaryHold.move({ x: 109, y: 100 }, 180);
nonStationaryHold.move({ x: 100, y: 100 }, 600);
assert.equal(nonStationaryHold.state(), POINTER_GESTURE_STATES.PRESSED, '超过静止窗口位移后不应误触发长按');

const coordinator = createInputCoordinator();
assert.equal(coordinator.isGestureTypeAllowed('pinch-start'), true);
assert.equal(coordinator.isGestureTypeAllowed('air-drag-end'), true);
assert.equal(coordinator.isGestureTypeAllowed('pinch-end'), true, '拖拽结束后的兼容释放事件应通过宽限窗口');

const directDrag = createDirectDragSession({ smoothing: 1, gain: 1, minDeltaPx: 0, maxDeltaPx: 64 });
directDrag.start({ x: 100, y: 100 });
const directMove = directDrag.move({ x: 114, y: 106 });
assert.deepEqual({ dx: directMove.dx, dy: directMove.dy }, { dx: 14, dy: 6 }, '张掌移动必须首帧直接产生拖拽增量');
assert.equal(directDrag.end({ x: 114, y: 106 }).type, 'drag-end');

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
assert.ok(poseEvents.some((event) => event.type === 'palm' && event.phase === 'start'), '稳定张掌应触发按下手势');
assert.ok(poseEvents.some((event) => event.type === 'palm' && event.phase === 'move'), '张掌保持期间应持续输出按下移动事件');
poseClassifier.update(poseHand('fist'), 1100);
poseClassifier.update(poseHand('fist'), 1134);
poseClassifier.update(poseHand('fist'), 1168);
assert.ok(!poseEvents.some((event) => event.type === 'palm' && event.phase === 'end'), '短暂手型抖动不应释放张掌拖拽');
poseClassifier.update(poseHand('fist'), 1202);
assert.ok(poseEvents.some((event) => event.type === 'palm' && event.phase === 'end'), '收掌应释放张掌按下状态');

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
const { createTargetResolver } = await import('../js/interaction/target-resolver.js');
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

// 张掌时拇指放松搭在食指附近（距离比落在捏合起止阈值之间）不应压制旋转手势。
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
assert.ok(
  relaxedPalmEvents.some((event) => event.type === 'palm' && event.phase === 'start'),
  '拇指放松靠近食指不应压制张掌按下',
);
assert.ok(
  !relaxedPalmEvents.some((event) => event.type === 'pinch' && event.phase === 'start'),
  '放松的拇指不应被误判为捏合',
);

console.log('gesture tests: PASS');
