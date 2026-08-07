// 手势偏好设置 —— localStorage 持久化，参考 voice/voice-controller.js 的 PREF_KEY 模式
const DEFAULTS = Object.freeze({
  enabled: false,
  sensitivity: 0.5,          // 0–1：捏合阈值整体缩放
  cursorSpeed: 0.5,          // 0–1：指针增益
  smoothingIntensity: 0.5,   // 0–1：平滑强度
  showCameraPreview: false,  // 调试：显示摄像头预览
  dominantHand: 'right',     // 'left' | 'right'
  scrollZoneEnabled: true,
  calibration: null,          // { centerX, centerY, rangeX, rangeY } | null
  firstTimeCompleted: false,
  showHelpOnStart: true,
  palmPressStableFrames: 5,
  palmReleaseStableFrames: 4,
  palmDragSmoothing: 0.58,
  palmDragGain: 1.15,
  palmDragMaxDeltaPx: 64,
  swipeEnabled: false,
  hitSlopPx: 30,
  edgeInsetX: 0.10,
  edgeInsetY: 0.10,
});

const PREF_KEY = 'sh-crafted.gesture-preferences';

export function loadGestureSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    return { ...DEFAULTS, ...stored };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveGestureSettings(partial) {
  const current = loadGestureSettings();
  const next = { ...current, ...partial };
  // 清理 null/undefined 值
  for (const key of Object.keys(next)) {
    if (next[key] === undefined) delete next[key];
  }
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(next));
  } catch {
    // localStorage 满或不可用，静默降级
  }
  return next;
}

export function resetGestureSettings() {
  try {
    localStorage.removeItem(PREF_KEY);
  } catch {
    // 静默
  }
  return { ...DEFAULTS };
}

// 从用户设置推导的运行时参数
export function effectiveConfig(settings) {
  const s = settings || loadGestureSettings();
  const sensitivity = Math.max(0, Math.min(1, Number(s.sensitivity ?? 0.5)));
  const cursorSpeed = Math.max(0, Math.min(1, Number(s.cursorSpeed ?? 0.5)));
  const defaultPinchStart = 0.36 + sensitivity * 0.10;
  const pinchStartRatio = Number.isFinite(Number(s.pinchStartRatio))
    ? Math.max(0.2, Math.min(0.5, Number(s.pinchStartRatio)))
    : defaultPinchStart;
  const hitSlopPx = Number.isFinite(Number(s.hitSlopPx))
    ? Math.max(12, Math.min(56, Number(s.hitSlopPx)))
    : 24 + sensitivity * 12;
  const edgeInsetX = Number.isFinite(Number(s.edgeInsetX))
    ? Math.max(0.04, Math.min(0.2, Number(s.edgeInsetX)))
    : 0.10;
  const edgeInsetY = Number.isFinite(Number(s.edgeInsetY))
    ? Math.max(0.04, Math.min(0.2, Number(s.edgeInsetY)))
    : 0.10;
  return {
    // 指针死区 (px) — 平滑强度越高，死区越大
    deadZonePx: 2 + (1 - s.smoothingIntensity) * 6,
    // 最大单帧跳变 (px) — 异常值剔除阈值
    maxJumpPx: 120 + s.smoothingIntensity * 80,
    // 磁吸半径 (CSS px)
    magnetRadiusPx: 32 + sensitivity * 40,
    // 目标稳定帧数
    targetStableFrames: 2 + Math.round((1 - sensitivity) * 4),
    // 捏合起始阈值 (归一化距离比)
    pinchStartRatio,
    // 捏合释放阈值 (必须 > startRatio)
    pinchReleaseRatio: Math.max(pinchStartRatio + 0.1, Math.min(0.68, Number(s.pinchReleaseRatio) || pinchStartRatio + 0.14)),
    // 捏合稳定帧数
    pinchStableFrames: 2,
    // 点击冷却 (ms)
    clickCooldownMs: 140 + (1 - sensitivity) * 100,
    // 屏幕像素状态机：轻微位移即可进入拖拽
    dragThresholdPx: 10 + (1 - sensitivity) * 2,
    // 长按静止窗口允许的平滑位移
    stationarySlopPx: 8,
    // 手掌锚点的逐帧平滑系数
    dragSmoothing: 0.30,
    // 持续捏合进入长按的时间
    longPressMs: 560,
    // 张掌进入鼠标按下状态的稳定帧数
    palmPressStableFrames: Math.max(2, Math.min(10, Number(s.palmPressStableFrames) || 5)),
    // 张掌短暂识别抖动不会立即释放拖拽
    palmReleaseStableFrames: Math.max(2, Math.min(8, Number(s.palmReleaseStableFrames) || 4)),
    // 张掌拖拽独立于点击/长按阈值，直接输出连续屏幕增量
    palmDragSmoothing: Math.max(0.2, Math.min(1, Number(s.palmDragSmoothing) || 0.58)),
    palmDragGain: Math.max(0.5, Math.min(2.5, Number(s.palmDragGain) || 1.15)),
    palmDragMaxDeltaPx: Math.max(24, Math.min(120, Number(s.palmDragMaxDeltaPx) || 64)),
    // 捏合距离 EMA 系数与释放迟滞帧数；闭合方向用更快系数尽快确认捏合
    pinchSmoothing: 0.35,
    pinchSmoothingClose: 0.55,
    pinchReleaseFrames: 3,
    // 张掌专用于按下拖拽，默认关闭会抢占拖拽的旧挥手返回识别
    swipeEnabled: s.swipeEnabled === true,
    // 手势按钮的额外屏幕命中范围
    hitSlopPx,
    // 摄像头安全区映射：手不用抵到镜头边缘即可触达屏幕边缘
    edgeInsetX,
    edgeInsetY,
    // 握拳缩小：较短稳定窗口，持续握拳时以克制频率重复缩小
    fistStableFrames: 5,
    fistRepeatMs: 650,
    // 挥动最小位移比 (归一化)
    swipeMinDistanceRatio: 0.22 + (1 - sensitivity) * 0.10,
    // 挥动最大时长 (ms)
    swipeMaxDurationMs: 360 + (1 - sensitivity) * 120,
    // 挥动冷却 (ms)
    swipeCooldownMs: 700 + (1 - sensitivity) * 400,
    // 手丢失短时保持 (ms)
    shortLossMs: 250 + s.smoothingIntensity * 100,
    // 手丢失取消动作 (ms)
    cancelActionMs: 500 + s.smoothingIntensity * 200,
    // 手丢失暂停 (ms)
    suspendMs: 1500 + s.smoothingIntensity * 500,
    // 指针速度增益
    cursorGain: 0.6 + cursorSpeed * 0.8,
  };
}
