// 手势主编排器 —— 生命周期管理 + 事件分发 + 目标集成
// 参考 voice/voice-controller.js 的模式
import { createGestureStateMachine, GESTURE_STATES } from './gesture-state-machine.js';
import { loadGestureSettings, saveGestureSettings, effectiveConfig } from './gesture-settings.js';
import { createGestureMetrics } from './gesture-metrics.js';
import { createCameraManager } from './camera-manager.js';
import { createWorkerClient } from './mediapipe-worker-client.js';
import { createCoordinateMapper } from './coordinate-mapper.js';
import { createGestureClassifier } from './gesture-classifier.js';
import { createGestureSmoother } from './gesture-smoother.js';
import { createPointerGestureStateMachine } from './pointer-gesture-state-machine.js';
import { createDirectDragSession } from './direct-drag-session.js';

function errorMessage(error) {
  const code = String(error?.code || error?.message || 'GESTURE_ERROR');
  const messages = {
    NotAllowedError: '摄像头权限未开启。你仍可以使用鼠标或语音，也可以在浏览器地址栏中重新允许摄像头。',
    NotFoundError: '未检测到摄像头设备。你仍可以使用鼠标或语音。',
    NotReadableError: '摄像头被其他应用占用，请关闭后重试。',
    OverconstrainedError: '摄像头参数不受支持，尝试使用默认设置。',
    SecurityError: '当前页面未使用 HTTPS，摄像头不可用。请使用安全连接访问。',
    camera_manager_destroyed: '手势管理器已释放。',
    camera_start_timeout: '摄像头启动超时，请检查设备连接。',
    worker_init_timeout: '手势模型加载超时，请刷新页面重试。',
    worker_init_failed: '手势模型加载失败。建议使用 Chrome 或 Edge。',
    INSECURE_CONTEXT: '手势功能需要安全连接（HTTPS 或 localhost）。',
    BROWSER_UNSUPPORTED: '当前浏览器不支持手势功能。建议使用 Chrome 或 Edge 最新版本。',
  };
  return messages[code] || `手势暂时不可用（${code}），可以继续使用鼠标和语音。`;
}

export function createGestureController({
  onEvent,
  onStateChange,
  onNotice,
  onError,
  onMetrics,
  onDiagnostic,
  getActiveThreeContext, // () => 当前活跃的 Three.js 场景信息
  getHoveredTarget,      // () => 当前已解析的悬停目标
} = {}) {
  const settings = loadGestureSettings();
  const machine = createGestureStateMachine({
    onChange: (next, previous, meta) => onStateChange?.(next, previous, meta),
  });

  let camera = null;
  let workerClient = null;
  let mapper = null;
  let classifier = null;
  let smoother = null;
  let metrics = null;
  let destroyed = false;
  let hoveredTarget = null;
  let selectedTarget = null;
  let lastGestureType = null;
  let lastGestureAt = 0;
  let handConfidence = 0;
  let lifecycleGeneration = 0;

  const config = () => effectiveConfig(settings);
  const pointerGesture = createPointerGestureStateMachine({
    clickSlopPx: config().clickSlopPx,
    holdSlopPx: config().holdSlopPx,
    postHoldDragThresholdPx: config().postHoldDragThresholdPx,
    longPressMs: config().longPressMs,
    smoothing: config().dragSmoothing,
  });
  const palmDrag = createDirectDragSession({
    smoothing: config().palmDragSmoothing ?? 0.58,
    gain: config().palmDragGain ?? 1.15,
    maxDeltaPx: config().palmDragMaxDeltaPx ?? 64,
  });

  const persist = () => saveGestureSettings(settings);
  const transition = (next, meta) => {
    if (machine.state() !== next && machine.can(next)) machine.transition(next, meta);
  };

  function emitPointerSemanticEvents(events, screen, timestamp) {
    for (const semantic of events || []) {
      onDiagnostic?.('pointer-semantic', {
        type: semantic.type,
        elapsed_ms: semantic.elapsed,
        distance_px: semantic.distance,
        pointer_state: pointerGesture.state(),
      });
      if (semantic.type === 'long-press-start' || semantic.type === 'long-press-end') {
        onEvent?.({
          type: semantic.type,
          screenX: screen.x,
          screenY: screen.y,
          duration: semantic.elapsed,
          reason: semantic.reason,
          timestamp,
        });
      } else if (semantic.type === 'drag-start' || semantic.type === 'drag-end') {
        onEvent?.({
          type: semantic.type === 'drag-start' ? 'air-drag-start' : 'air-drag-end',
          screenX: screen.x,
          screenY: screen.y,
          duration: semantic.elapsed,
          timestamp,
        });
      } else if (semantic.type === 'drag-move') {
        onEvent?.({
          type: 'air-drag',
          dx: semantic.dx,
          dy: semantic.dy,
          screenX: screen.x,
          screenY: screen.y,
          timestamp,
        });
      }
    }
  }

  // ---- 手势事件处理 ----
  function handleGesture(event) {
    const now = performance.now();
    lastGestureType = event.type;
    lastGestureAt = now;
    if (event.type !== 'cursor') {
      onDiagnostic?.('classifier-event', {
        type: event.type,
        phase: event.phase || '',
        distance: event.distance,
      });
    }

    switch (event.type) {
      case 'cursor': {
        if (!event.visible) {
          onEvent?.({ type: 'cursor-hidden', timestamp: now });
          return;
        }
        // 平滑 + 映射
        const screen = mapper.landmarkToScreen(event.x, event.y);
        const smoothed = smoother.smoothPointer(screen.x, screen.y, now, {
          deadZonePx: config().deadZonePx,
          maxJumpPx: config().maxJumpPx,
        });
        onEvent?.({
          type: 'pointer-move',
          screenX: smoothed.x,
          screenY: smoothed.y,
          velocity: smoothed.velocity,
          timestamp: now,
        });
        break;
      }

      case 'pinch': {
        // 目标解析以用户实际看到的平滑指针位置为准；原始指尖坐标与视觉指针
        // 之间可差几十像素，直接用原始坐标会抓到指针旁边的目标。
        const screen = smoother?.lastPointer?.()
          ?? mapper.landmarkToScreen(event.coords?.x || 0.5, event.coords?.y || 0.5);
        const manipulationScreen = mapper.landmarkToScreen(
          event.manipulationCoords?.x ?? event.coords?.x ?? 0.5,
          event.manipulationCoords?.y ?? event.coords?.y ?? 0.5,
        );
        if (event.phase === 'start') {
          pointerGesture.start(manipulationScreen, now);
          onEvent?.({ type: 'pinch-start', screenX: screen.x, screenY: screen.y, distance: event.distance, timestamp: now });
        } else if (event.phase === 'move') {
          onEvent?.({ type: 'pinch-move', screenX: screen.x, screenY: screen.y, distance: event.distance, timestamp: now });
          emitPointerSemanticEvents(pointerGesture.move(manipulationScreen, now), screen, now);
        } else {
          const outcome = pointerGesture.end(manipulationScreen, now);
          emitPointerSemanticEvents(outcome.events, screen, now);
          onEvent?.({
            type: 'pinch-end',
            screenX: screen.x,
            screenY: screen.y,
            distance: event.distance,
            wasClick: outcome.wasClick,
            duration: outcome.elapsed,
            timestamp: now,
          });
          if (outcome.wasClick) {
            onEvent?.({
              type: 'air-click',
              screenX: screen.x,
              screenY: screen.y,
              target: hoveredTarget,
              timestamp: now,
            });
          }
        }
        break;
      }

      case 'pinch-click':
      case 'long-press':
      case 'drag':
        // These legacy classifier events are intentionally ignored. Pointer
        // semantics are now resolved in screen pixels above.
        break;

      case 'palm': {
        // 同捏合：按下解析以视觉指针位置为准，拖拽增量仍来自掌心锚点。
        const screen = smoother?.lastPointer?.()
          ?? mapper.landmarkToScreen(event.coords?.x ?? 0.5, event.coords?.y ?? 0.5);
        const manipulationScreen = mapper.landmarkToScreen(
          event.manipulationCoords?.x ?? event.coords?.x ?? 0.5,
          event.manipulationCoords?.y ?? event.coords?.y ?? 0.5,
        );
        if (event.phase === 'start') {
          palmDrag.start(manipulationScreen);
          onEvent?.({ type: 'palm-press-start', screenX: screen.x, screenY: screen.y, timestamp: now });
          onEvent?.({ type: 'air-drag-start', screenX: screen.x, screenY: screen.y, timestamp: now, source: 'palm' });
        } else if (event.phase === 'move') {
          onEvent?.({ type: 'palm-press-move', screenX: screen.x, screenY: screen.y, timestamp: now });
          const drag = palmDrag.move(manipulationScreen);
          if (drag) {
            onEvent?.({
              type: 'air-drag',
              dx: drag.dx,
              dy: drag.dy,
              screenX: screen.x,
              screenY: screen.y,
              timestamp: now,
              source: 'palm',
            });
          }
        } else {
          // Do not consume the closing-hand frame as movement: finger closure
          // can shift landmarks even though the palm itself did not move.
          const outcome = palmDrag.end();
          onEvent?.({ type: 'air-drag-end', screenX: screen.x, screenY: screen.y, timestamp: now, source: 'palm' });
          onEvent?.({
            type: 'palm-press-end',
            screenX: screen.x,
            screenY: screen.y,
            wasClick: false,
            dragDistance: outcome.totalDistance,
            timestamp: now,
          });
        }
        break;
      }

      case 'fist': {
        onEvent?.({ type: event.phase === 'end' ? 'fist-end' : 'fist-start', phase: event.phase, timestamp: now });
        break;
      }

      case 'swipe-left': {
        onEvent?.({
          type: 'swipe-left',
          velocity: event.velocity,
          distance: event.distance,
          timestamp: now,
        });
        break;
      }

      case 'hand-lost': {
        pointerGesture.reset();
        palmDrag.reset();
        onEvent?.({ type: 'hand-lost', timestamp: now, hoveredTarget });
        break;
      }

      default:
        break;
    }
  }

  // ---- 帧循环 ----
  function onFrame(bitmap, frameTimestamp) {
    if (destroyed || machine.state() === GESTURE_STATES.DISABLED) {
      bitmap?.close?.();
      return;
    }

    if (!workerClient) {
      bitmap?.close?.();
      return;
    }
    workerClient.sendFrame(bitmap, frameTimestamp);
  }

  function onLandmarks(landmarks, timing, gen) {
    if (destroyed) return;

    const now = performance.now();

    // 更新指标
    metrics?.recordFrame({
      cameraFrameTimestamp: timing?.cameraFrameTimestamp || timing?.inferenceStart,
      inferenceStartTimestamp: timing?.inferenceStart,
      inferenceEndTimestamp: timing?.inferenceEnd,
      mappingTimestamp: now,
    });

    // 更新置信度
    handConfidence = landmarks ? 0.9 : 0;
    onEvent?.({ type: landmarks ? 'hand-landmarks' : 'hand-landmarks-clear', landmarks, timestamp: now });

    // 手势分类
    if (landmarks) {
      classifier.update(landmarks, now);
    } else {
      classifier.update(null, now);
    }

    // 手丢失处理
    const lostDuration = classifier.handLostDuration(now);
    if (lostDuration > config().suspendMs) {
      if (machine.state() === GESTURE_STATES.ACTIVE) {
        transition(GESTURE_STATES.SEARCHING_HAND, { reason: 'hand_lost' });
        onNotice?.('手已离开画面，手势已暂停');
      }
    } else if (classifier.hasHand?.() && machine.state() === GESTURE_STATES.SEARCHING_HAND) {
      transition(GESTURE_STATES.READY, { reason: 'hand_found' });
      transition(GESTURE_STATES.ACTIVE, { reason: 'hand_found' });
      onNotice?.('已重新检测到手势');
    } else if (lostDuration > config().cancelActionMs) {
      // 停止当前拖拽
      onEvent?.({ type: 'hand-lost-cancel', timestamp: now });
    }

    onMetrics?.(metrics?.summary());
  }

  function onCameraError(err) {
    onNotice?.(errorMessage(err));
    if (err?.recoverable) {
      onError?.(err);
      return;
    }
    transition(GESTURE_STATES.ERROR, { error: err.code });
    onError?.(err);
  }

  function onWorkerError(msg) {
    if (String(msg).startsWith('gpu_fallback_to_cpu:')) {
      onNotice?.('图形加速不可用，已自动切换为兼容模式。');
      return;
    }
    onNotice?.(errorMessage({ message: msg }));
    if (String(msg).includes('init_failed') || String(msg).includes('worker_error')) {
      transition(GESTURE_STATES.ERROR, { error: 'WORKER_START_FAILED' });
    }
    onError?.({ code: 'WORKER_ERROR', message: msg });
  }

  // ---- 公共 API ----
  async function start() {
    if (destroyed) return;
    if (machine.state() === GESTURE_STATES.ERROR) stop();
    if (machine.state() !== GESTURE_STATES.DISABLED) return;

    // 检查浏览器支持
    if (!navigator.mediaDevices?.getUserMedia) {
      onNotice?.(errorMessage({ code: 'BROWSER_UNSUPPORTED' }));
      throw new Error('BROWSER_UNSUPPORTED');
    }
    if (!window.isSecureContext) {
      onNotice?.(errorMessage({ code: 'INSECURE_CONTEXT' }));
      throw new Error('INSECURE_CONTEXT');
    }

    const runGeneration = ++lifecycleGeneration;
    const isCurrentRun = () => !destroyed && runGeneration === lifecycleGeneration;
    transition(GESTURE_STATES.REQUESTING_PERMISSION);

    try {
      // 初始化组件
      const effConfig = config();
      onDiagnostic?.('gesture-config', {
        pinch_start_ratio: effConfig.pinchStartRatio,
        pinch_release_ratio: effConfig.pinchReleaseRatio,
        pinch_stable_frames: effConfig.pinchStableFrames,
        long_press_ms: effConfig.longPressMs,
        click_slop_px: effConfig.clickSlopPx,
        hold_slop_px: effConfig.holdSlopPx,
        palm_interaction_enabled: effConfig.palmInteractionEnabled,
      });
      camera = createCameraManager({ onFrame, onError: onCameraError });
      mapper = createCoordinateMapper({
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        mirrored: true,
        edgeInsetX: effConfig.edgeInsetX,
        edgeInsetY: effConfig.edgeInsetY,
        screenOffsetXRatio: effConfig.screenOffsetXRatio,
        screenOffsetYRatio: effConfig.screenOffsetYRatio,
      });
      smoother = createGestureSmoother();
      metrics = createGestureMetrics();

      classifier = createGestureClassifier({
        onGesture: handleGesture,
        onDiagnostic: (data) => onDiagnostic?.('classification-sample', data, true),
        config: effConfig,
      });

      // 启动摄像头
      transition(GESTURE_STATES.CAMERA_STARTING);
      const videoInfo = await camera.start();
      if (!isCurrentRun()) return;
      mapper.setVideoSize(videoInfo.videoWidth, videoInfo.videoHeight);

      // 启动 Worker
      transition(GESTURE_STATES.LOADING_MODEL);
      workerClient = createWorkerClient({
        onReady: () => {
          if (!isCurrentRun()) return;
          if (machine.can(GESTURE_STATES.CALIBRATING)) {
            transition(GESTURE_STATES.CALIBRATING);
          }
          onNotice?.('手势模型已就绪，正在校准…');
        },
        onLandmarks,
        onNotice: onWorkerError,
        onError: onWorkerError,
      });
      await workerClient.init();
      if (!isCurrentRun()) return;

      // 简易校准（记录初始手部位置）
      transition(GESTURE_STATES.CALIBRATING);
      // 等待首次检测到手
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve(); // 超时也继续
        }, 2000);

        const checkLandmarks = () => {
          // 首次检测到手后进入 READY
          if (classifier?.hasHand?.()) {
            clearTimeout(timeout);
            resolve();
          }
        };
        // 简单轮询(最多等 2 秒)
        const interval = setInterval(() => {
          checkLandmarks();
        }, 200);
        setTimeout(() => clearInterval(interval), 2100);
      });
      if (!isCurrentRun()) return;

      // 过渡到活跃状态
      transition(GESTURE_STATES.SEARCHING_HAND);
      transition(GESTURE_STATES.READY);
      transition(GESTURE_STATES.ACTIVE);

      // 启动帧循环
      camera.setTargetFps(24);
      settings.firstTimeCompleted = true;
      persist();
    } catch (error) {
      // stop() invalidates the generation immediately. A late camera/worker
      // completion must never resurrect a user-disabled gesture session.
      if (!isCurrentRun()) return;
      releaseResources();
      onNotice?.(errorMessage(error));
      transition(GESTURE_STATES.ERROR, { error: error?.message || error?.code || 'GESTURE_START_FAILED' });
      throw error;
    }
  }

  function releaseResources() {
    pointerGesture.reset();
    palmDrag.reset();
    camera?.destroy();
    camera = null;

    workerClient?.destroy();
    workerClient = null;

    classifier?.reset();
    classifier = null;

    smoother?.reset();
    smoother = null;

    metrics?.reset();
    metrics = null;

    mapper = null;
    hoveredTarget = null;
    selectedTarget = null;
    handConfidence = 0;
  }

  function stop() {
    lifecycleGeneration++;
    if (machine.state() !== GESTURE_STATES.DISABLED) {
      transition(GESTURE_STATES.DISABLED, { reason: 'user_stop' });
    }
    releaseResources();
  }

  function suspend(reason) {
    if (machine.state() === GESTURE_STATES.DISABLED) return;
    camera?.stop();
    workerClient?.stop();
    transition(GESTURE_STATES.SUSPENDED, { reason });
  }

  async function resume() {
    if (machine.state() !== GESTURE_STATES.SUSPENDED) return;
    try {
      transition(GESTURE_STATES.SEARCHING_HAND, { reason: 'resume' });
      const videoInfo = await camera?.start?.();
      if (videoInfo) mapper?.setVideoSize(videoInfo.videoWidth, videoInfo.videoHeight);
      await workerClient?.init?.();
      transition(GESTURE_STATES.READY, { reason: 'resume_ready' });
      transition(GESTURE_STATES.ACTIVE, { reason: 'resume_active' });
    } catch (error) {
      onNotice?.(errorMessage(error));
      transition(GESTURE_STATES.ERROR, { error: error?.message || error?.code || 'GESTURE_RESUME_FAILED' });
      onError?.(error);
    }
  }

  function setHoveredTarget(target) {
    hoveredTarget = target;
  }

  function setSelectedTarget(target) {
    selectedTarget = target;
  }

  function setEdgeInsets(x, y = x) {
    mapper?.setEdgeInsets(x, y);
  }

  function onVisibilityChange() {
    if (document.hidden) suspend('page_hidden');
  }

  function onPageHide() {
    suspend('page_unload');
  }

  function onResize() {
    mapper?.setViewport(window.innerWidth, window.innerHeight);
  }

  // 注册全局事件
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('resize', onResize);

  function destroy() {
    destroyed = true;
    stop();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('resize', onResize);
  }

  return {
    state: machine.state,
    start,
    stop,
    suspend,
    resume,
    destroy,
    setHoveredTarget,
    setSelectedTarget,
    setEdgeInsets,
    getContext() {
      return {
        enabled: machine.state() !== GESTURE_STATES.DISABLED,
        state: machine.state(),
        hoveredTarget: hoveredTarget || null,
        selectedTarget: selectedTarget || null,
        lastGesture: lastGestureType,
        lastGestureAt,
        confidence: handConfidence,
      };
    },
    metrics: () => metrics?.summary() || null,
    // Deterministic input hook used by smoke tests and diagnostics. It feeds
    // the same classifier event path as camera inference without touching the
    // production camera or synthesizing DOM clicks by itself.
    simulate(event) {
      if (!event || typeof event !== 'object') throw new TypeError('gesture_event_required');
      handleGesture(event);
      return { state: machine.state(), lastGesture: lastGestureType };
    },
  };
}
