// 手势分类器 —— 从 21 个手部关键点检测 6 种手势
// 输入：MediaPipe HandLandmarker 的归一化关键点数组 [{x,y,z,visibility}, ...]
// 输出：高层次手势事件 { type, phase, coords, ... }

// 关键点索引（MediaPipe Hand Landmarker）
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_FINGER_MCP = 5;
const INDEX_FINGER_PIP = 6;
const INDEX_FINGER_TIP = 8;
const MIDDLE_FINGER_MCP = 9;
const MIDDLE_FINGER_PIP = 10;
const MIDDLE_FINGER_TIP = 12;
const RING_FINGER_MCP = 13;
const RING_FINGER_PIP = 14;
const RING_FINGER_TIP = 16;
const PINKY_MCP = 17;
const PINKY_PIP = 18;
const PINKY_TIP = 20;

function distance3d(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function distance2d(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function handScale(landmarks) {
  // Use a robust 2D palm scale. MediaPipe fingertip Z values are intentionally
  // relative and can fluctuate enough to hide a real thumb/index contact.
  return Math.max(
    distance2d(landmarks[WRIST], landmarks[MIDDLE_FINGER_MCP]),
    distance2d(landmarks[INDEX_FINGER_MCP], landmarks[PINKY_MCP]),
    0.08,
  );
}

function palmCenter(landmarks) {
  // 手腕 + 四个掌指关节的加权平均。掌心由手根部关键点组成，
  // 手指弯曲、指尖接触都不会让它移动，是指针和拖拽的统一锚点。
  const points = [WRIST, INDEX_FINGER_MCP, MIDDLE_FINGER_MCP, RING_FINGER_MCP, PINKY_MCP];
  const weights = [0.5, 1, 1, 1, 1];
  let cx = 0, cy = 0, totalW = 0;
  for (let i = 0; i < points.length; i++) {
    const idx = points[i];
    const w = weights[i];
    cx += landmarks[idx].x * w;
    cy += landmarks[idx].y * w;
    totalW += w;
  }
  return { x: cx / totalW, y: cy / totalW };
}

// Worker 为降低传输开销会返回 [x, y, z, ...]，而测试页和旧适配器可能
// 仍然传入 [{ x, y, z }, ...]。在分类器入口统一成点对象，避免两条运行链路
// 出现不同的识别结果。
function normalizeLandmarks(input) {
  if (!input || input.length < 21) return null;

  if (typeof input[0] === 'number') {
    const points = [];
    for (let i = 0; i < 21; i++) {
      const x = Number(input[i * 3]);
      const y = Number(input[i * 3 + 1]);
      const z = Number(input[i * 3 + 2]);
      if (![x, y, z].every(Number.isFinite)) return null;
      points.push({ x, y, z });
    }
    return points;
  }

  const points = Array.from(input).slice(0, 21);
  if (points.length < 21 || points.some((point) => (
    !point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))
  ))) return null;
  return points;
}

export function createGestureClassifier({ onGesture, config } = {}) {
  const cfg = config || {};

  // 捏合状态机
  let pinchState = 'idle';      // idle | active | suppressed
  let pinchStableCount = 0;
  let pinchReleaseStableCount = 0;
  let pinchDistanceEma = null;
  let lastPinchReleaseTime = -Infinity;

  // 张掌状态
  let palmStableCount = 0;
  let palmReleaseStableCount = 0;
  let palmActive = false;
  let lastPalmEndTime = 0;
  let fistSuppressedAfterPalm = false;

  // 握拳状态
  let fistStableCount = 0;
  let fistActive = false;
  let lastFistPulseTime = 0;

  // 挥动追踪
  let swipeTracking = false;
  let swipePoints = [];
  let lastSwipeTime = 0;

  // 上一帧的手存在状态
  let handWasPresent = false;
  let handLostSince = 0;
  let lastHandTimestamp = 0;

  // 手指是否伸直：比较指尖/指节到手腕的三维距离。
  // 手前倾时指尖在图像平面上的投影会缩短（透视缩短），纯二维距离会把
  // 朝向前方的伸直手指误判为弯曲；z 分量补回这部分长度。
  function isFingerExtended(landmarks, tipIdx, pipIdx, mcpIdx) {
    const wrist = landmarks[WRIST];
    const tipDistance = distance3d(wrist, landmarks[tipIdx]);
    const pipDistance = distance3d(wrist, landmarks[pipIdx]);
    const mcpDistance = distance3d(wrist, landmarks[mcpIdx]);
    return tipDistance > pipDistance * 1.06 && tipDistance > mcpDistance * 1.18;
  }

  // 所有手指是否伸直（张掌判定）
  // 小指的关键点最容易识别抖动：食指/中指必须伸直，四指中允许一根放宽。
  function isOpenPalm(landmarks) {
    const extended = [
      [INDEX_FINGER_TIP, INDEX_FINGER_PIP, INDEX_FINGER_MCP],
      [MIDDLE_FINGER_TIP, MIDDLE_FINGER_PIP, MIDDLE_FINGER_MCP],
      [RING_FINGER_TIP, RING_FINGER_PIP, RING_FINGER_MCP],
      [PINKY_TIP, PINKY_PIP, PINKY_MCP],
    ].map(([tip, pip, mcp]) => isFingerExtended(landmarks, tip, pip, mcp));
    return extended[0] && extended[1] && extended.filter(Boolean).length >= 3;
  }

  function isFist(landmarks) {
    const curledCount = [
      [INDEX_FINGER_TIP, INDEX_FINGER_PIP],
      [MIDDLE_FINGER_TIP, MIDDLE_FINGER_PIP],
      [RING_FINGER_TIP, RING_FINGER_PIP],
      [PINKY_TIP, PINKY_PIP],
    ].filter(([tip, pip]) => distance3d(landmarks[WRIST], landmarks[tip]) < distance3d(landmarks[WRIST], landmarks[pip]) * 1.08).length;
    return curledCount >= 3;
  }

  // 捏合距离比（相对于手掌尺度）
  function pinchRatio(landmarks) {
    const pinchDist = distance2d(landmarks[THUMB_TIP], landmarks[INDEX_FINGER_TIP]);
    const scale = handScale(landmarks);
    return pinchDist / Math.max(scale, 0.01);
  }

  function resetPinch() {
    pinchState = 'idle';
    pinchStableCount = 0;
    pinchReleaseStableCount = 0;
    pinchDistanceEma = null;
  }

  function resetPalm() {
    palmStableCount = 0;
    palmReleaseStableCount = 0;
    palmActive = false;
  }

  function resetFist() {
    fistStableCount = 0;
    fistActive = false;
    lastFistPulseTime = 0;
  }

  function resetSwipe() {
    swipeTracking = false;
    swipePoints = [];
  }

  return {
    // 每帧调用一次，landmarks 为 MediaPipe 的 21 个归一化关键点数组
    // timestamp 为 performance.now() 毫秒值
    update(landmarks, timestamp) {
      landmarks = normalizeLandmarks(landmarks);
      if (!landmarks || landmarks.length < 21) {
        // 手丢失
        if (handWasPresent) {
          handLostSince = timestamp;
          onGesture?.({ type: 'hand-lost', timestamp });
        }
        handWasPresent = false;
        resetPinch();
        resetSwipe();
        if (fistActive) onGesture?.({ type: 'fist', phase: 'end', timestamp });
        resetFist();
        if (palmActive) {
          resetPalm();
        }
        return;
      }

      handWasPresent = true;
      handLostSince = 0;
      lastHandTimestamp = timestamp;

      const wrist = landmarks[WRIST];
      const rawPinchDist = pinchRatio(landmarks);
      // 非对称 EMA：闭合（距离变小）用更快系数尽快确认捏合，
      // 张开保持慢系数，配合释放迟滞帧避免闪断。
      const pinchSmoothing = Math.max(0.05, Math.min(1, Number(cfg.pinchSmoothing ?? 0.35)));
      const pinchSmoothingClose = Math.max(pinchSmoothing, Math.min(1, Number(cfg.pinchSmoothingClose ?? 0.55)));
      pinchDistanceEma = pinchDistanceEma === null
        ? rawPinchDist
        : pinchDistanceEma + (rawPinchDist - pinchDistanceEma)
          * (rawPinchDist < pinchDistanceEma ? pinchSmoothingClose : pinchSmoothing);
      const pinchDist = pinchDistanceEma;
      // 掌心是指针与拖拽的统一锚点：手指弯曲、指尖接触都不会让它移动。
      const palm = palmCenter(landmarks);
      const pinchStartRatio = cfg.pinchStartRatio ?? 0.38;
      const pinchReleaseRatio = cfg.pinchReleaseRatio ?? 0.52;
      const pinchStableFrames = cfg.pinchStableFrames ?? 2;
      const clickCooldownMs = cfg.clickCooldownMs ?? 320;
      const pinchReleaseFrames = Math.max(1, Number(cfg.pinchReleaseFrames ?? 3));
      const palmPressStableFrames = cfg.palmPressStableFrames ?? 6;
      const palmReleaseStableFrames = Math.max(2, Number(cfg.palmReleaseStableFrames ?? 4));
      const fistStableFrames = cfg.fistStableFrames ?? 5;
      const fistRepeatMs = cfg.fistRepeatMs ?? 650;
      const swipeMinDistance = cfg.swipeMinDistanceRatio ?? 0.28;
      const swipeMaxDuration = cfg.swipeMaxDurationMs ?? 420;
      const swipeCooldownMs = cfg.swipeCooldownMs ?? 800;
      const swipeEnabled = cfg.swipeEnabled === true;
      const pinchPose = pinchDist < pinchReleaseRatio;
      // A thumb/index contact wins over fist. Without this guard a
      // pinch made with the other fingers curled is frequently classified as
      // a fist before the pinch state machine can start.
      const fistClosed = isFist(landmarks) && !pinchPose;
      // 张掌与捏合互斥：拇指-食指进入真实接触区（起始阈值以内）时不累计
      // 张掌稳定帧，避免“其他手指伸直的慢速捏合”被张掌抢占；拇指只是
      // 放松搭在食指附近（起始阈值以外）不影响张掌。
      const palmOpen = isOpenPalm(landmarks) && pinchDist >= pinchStartRatio;
      const palmEvent = (phase) => ({
        type: 'palm',
        phase,
        // 掌心同时负责命中目标与拖拽位移。
        coords: { x: palm.x, y: palm.y },
        manipulationCoords: { x: palm.x, y: palm.y },
        timestamp,
      });

      // ---- 挥动检测 ----
      if (!swipeEnabled && swipeTracking) resetSwipe();
      if (swipeEnabled && !swipeTracking && palmOpen && !palmActive && pinchState === 'idle') {
        if (palm.x > 0.5 && timestamp - lastSwipeTime > swipeCooldownMs) {
          // 从右半部开始追踪
          swipeTracking = true;
          swipePoints = [{ x: palm.x, y: palm.y, t: timestamp }];
        }
      }

      if (swipeEnabled && swipeTracking && !palmActive) {
        swipePoints.push({ x: palm.x, y: palm.y, t: timestamp });
        // 保留最近 600ms 的点
        const cutoff = timestamp - 600;
        swipePoints = swipePoints.filter((p) => p.t > cutoff);

        // 检查是否完成一次挥动
        if (swipePoints.length >= 4) {
          const first = swipePoints[0];
          const last = swipePoints[swipePoints.length - 1];
          const duration = last.t - first.t;
          const dx = last.x - first.x;
          const dy = last.y - first.y;
          const totalDist = Math.sqrt(dx * dx + dy * dy);
          const velocityX = Math.abs(dx) / (duration / 1000);

          if (
            duration < swipeMaxDuration &&
            totalDist > swipeMinDistance &&
            Math.abs(dx) > Math.abs(dy) * 2.5 &&    // 横向为主
            velocityX > 0.4 &&                        // 最小速度
            dx < 0                                     // 右→左
          ) {
            lastSwipeTime = timestamp;
            resetSwipe();
            onGesture?.({ type: 'swipe-left', velocity: velocityX, distance: totalDist, timestamp });
            return; // 挥动优先，不继续处理其他手势
          } else if (duration > swipeMaxDuration || (!palmOpen && swipePoints.length > 6)) {
            // 超时或手型变化，放弃
            resetSwipe();
          }
        }
      }

      // ---- 握拳检测：快速触发，持续握拳时按节流间隔重复缩小 ----
      if (palmOpen) fistSuppressedAfterPalm = false;
      if (!palmOpen && !fistClosed && !palmActive) fistSuppressedAfterPalm = false;
      if (fistClosed && pinchState === 'idle' && !palmActive && !fistSuppressedAfterPalm) {
        fistStableCount++;
        if (fistStableCount >= fistStableFrames) {
          if (!fistActive) {
            fistActive = true;
            lastFistPulseTime = timestamp;
            onGesture?.({ type: 'fist', phase: 'start', coords: palm, timestamp });
          } else if (timestamp - lastFistPulseTime >= fistRepeatMs) {
            lastFistPulseTime = timestamp;
            onGesture?.({ type: 'fist', phase: 'pulse', coords: palm, timestamp });
          }
        }
      } else if (!fistClosed && fistActive) {
        fistActive = false;
        fistStableCount = 0;
        onGesture?.({ type: 'fist', phase: 'end', coords: palm, timestamp });
      } else if (!fistClosed) {
        fistStableCount = Math.max(0, fistStableCount - 1);
      }

      // ---- 张掌按下检测：张掌相当于鼠标按下，移动期间可旋转/拖动 ----
      if (palmOpen && pinchState === 'idle' && !fistActive) {
        palmReleaseStableCount = 0;
        palmStableCount++;
        if (palmStableCount >= palmPressStableFrames && !palmActive) {
          palmActive = true;
          onGesture?.(palmEvent('start'));
        } else if (palmActive) {
          onGesture?.(palmEvent('move'));
        }
      } else if (palmActive) {
        palmReleaseStableCount++;
        if (palmReleaseStableCount >= palmReleaseStableFrames) {
          palmActive = false;
          palmStableCount = 0;
          palmReleaseStableCount = 0;
          lastPalmEndTime = timestamp;
          fistSuppressedAfterPalm = true;
          onGesture?.(palmEvent('end'));
        } else {
          // Keep the held pointer alive through brief pose uncertainty while
          // the hand turns sideways during a drag.
          onGesture?.(palmEvent('move'));
        }
      } else if (!palmOpen) {
        palmStableCount = Math.max(0, palmStableCount - 1);
      }

      // ---- 捏合检测（迟滞） ----
      if (!fistClosed && !palmActive && pinchState === 'idle' && pinchDist < pinchStartRatio) {
        pinchStableCount++;
        if (pinchStableCount >= pinchStableFrames) {
          pinchStableCount = 0;
          if (timestamp - lastPinchReleaseTime < clickCooldownMs) {
            // 冷却期内吞掉本次捏合：保持 suppressed 直到手指真正张开。
            // 直接重置会让“按住不放”在冷却结束后补发一次幻影点击。
            pinchState = 'suppressed';
          } else {
            // 进入捏合
            pinchState = 'active';
            onGesture?.({ type: 'pinch', phase: 'start', distance: pinchDist, coords: { x: palm.x, y: palm.y }, manipulationCoords: { x: palm.x, y: palm.y }, timestamp });
          }
        }
      } else if (pinchState === 'active') {
        // Classifier only reports raw pinch lifecycle. Screen-space click,
        // hold and drag semantics are resolved by pointer-gesture-state-machine.
        onGesture?.({
          type: 'pinch',
          phase: 'move',
          distance: pinchDist,
          coords: { x: palm.x, y: palm.y },
          manipulationCoords: { x: palm.x, y: palm.y },
          timestamp,
        });

        if (pinchDist > pinchReleaseRatio) {
          pinchReleaseStableCount++;
        } else {
          pinchReleaseStableCount = 0;
        }

        if (pinchReleaseStableCount >= pinchReleaseFrames) {
          // 连续多帧超过释放阈值才结束捏合，避免单帧闪断。
          lastPinchReleaseTime = timestamp;

          onGesture?.({
            type: 'pinch',
            phase: 'end',
            distance: pinchDist,
            coords: { x: palm.x, y: palm.y },
            manipulationCoords: { x: palm.x, y: palm.y },
            timestamp,
          });
          resetPinch();
        }
      } else if (pinchState === 'suppressed') {
        // 冷却吞掉的捏合：等手指真正张开后才回到 idle，期间不触发任何事件。
        if (pinchDist > pinchReleaseRatio) {
          pinchReleaseStableCount++;
          if (pinchReleaseStableCount >= pinchReleaseFrames) resetPinch();
        } else {
          pinchReleaseStableCount = 0;
        }
      } else if (pinchState === 'idle' && pinchDist >= pinchStartRatio) {
        pinchStableCount = 0;
      }

      // ---- 指针移动 ----
      // 指针锚定在掌心：指尖在任何手型变化（捏合、收指）下都会移动，
      // 掌心只随手整体移动，从根本上避免指针被手型变化带着乱飘。
      onGesture?.({
        type: 'cursor',
        x: palm.x,
        y: palm.y,
        visible: true,
        timestamp,
      });
    },

    // 手丢失后的时间（ms）
    handLostDuration(timestamp) {
      return handLostSince > 0 ? timestamp - handLostSince : 0;
    },

    hasHand() {
      return handWasPresent;
    },

    // 当前捏合状态
    isPinching() {
      return pinchState === 'active';
    },

    // 当前张掌状态
    isPalmOpen() {
      return palmActive;
    },

    // 重置所有内部状态
    reset() {
      resetPinch();
      resetPalm();
      fistSuppressedAfterPalm = false;
      resetFist();
      resetSwipe();
      handWasPresent = false;
      handLostSince = 0;
    },

    _debug() {
      return {
        pinchState,
        pinchStableCount,
        palmActive,
        palmStableCount,
        fistActive,
        fistStableCount,
        swipeTracking,
        handLostDuration: handLostSince,
      };
    },
  };
}
