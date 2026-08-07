// 输入协调器 —— 统一管理鼠标、触屏、键盘、语音、手势的输入冲突
// 规则：
//   1. 触屏优先：有触屏活动时抑制手势
//   2. 鼠标 + 手势：鼠标移动时手势降级，200ms 无鼠标事件后手势恢复
//   3. 语音 + 手势共存：语音 LISTENING/SPEAKING 时抑制张掌按下，允许 cursor-move + pinch
//   4. 键盘输入框聚焦时抑制手势点击
//   5. 新的明确输入取消旧的可取消动画
export function createInputCoordinator() {
  const state = {
    mouseActive: false,
    mouseLastMove: 0,
    touchActive: false,
    touchCount: 0,
    keyboardFocused: false,
    voiceState: 'DISABLED',
    gestureActive: false,
    gestureGraceUntil: 0,
    gestureAllowed: true,
    pendingCancel: null,
  };

  // 启用手势时需要满足的条件
  const checks = {
    // 触屏活跃 → 禁用手势
    touch() { return !state.touchActive; },
    // 鼠标最近 200ms 在移动 → 手势降级；已有手势按下后保持连续性。
    mouse() {
      const now = performance.now();
      return state.gestureActive
        || now < state.gestureGraceUntil
        || now - state.mouseLastMove > 200;
    },
    // 键盘焦点只影响最终点击，不阻断指针移动和按住拖动。
    keyboard() { return true; },
    // 语音状态 → 允许光标和捏合，抑制张掌按下
    voice() { return true; },
  };

  // ---- 事件监听 ----

  function onMouseMove(event) {
    // Gesture-generated compatibility mouse events are untrusted. They must
    // not suppress the gesture stream that produced them.
    if (event && event.isTrusted === false) return;
    state.mouseActive = true;
    state.mouseLastMove = performance.now();
  }

  function onMouseIdle() {
    state.mouseActive = false;
  }

  function onTouchStart(event) {
    state.touchActive = true;
    state.touchCount = event.touches?.length || 1;
  }

  function onTouchEnd() {
    state.touchActive = false;
    state.touchCount = 0;
  }

  function onFocusIn(event) {
    const tag = event.target?.tagName?.toLowerCase();
    const isEditable = event.target?.isContentEditable
      || event.target?.dataset?.gestureBlocked === 'true';
    state.keyboardFocused = (tag === 'input' || tag === 'textarea' || tag === 'select' || isEditable);
  }

  function onFocusOut() {
    state.keyboardFocused = false;
  }

  function setVoiceState(vs) {
    state.voiceState = vs;
  }

  // 检查手势是否允许
  function isGestureAllowed() {
    for (const [, check] of Object.entries(checks)) {
      if (!check()) return false;
    }
    return state.gestureAllowed;
  }

  // 检查特定手势类型是否允许
  function isGestureTypeAllowed(gestureType) {
    const releaseGesture = () => {
      state.gestureActive = false;
      state.gestureGraceUntil = performance.now() + 140;
    };
    const gestureBegins = gestureType === 'pinch-start' || gestureType === 'palm-press-start';
    if (gestureBegins) state.gestureActive = true;
    if (!isGestureAllowed()) {
      if (gestureBegins) releaseGesture();
      return false;
    }

    // 语音 LISTENING/TRANSCRIBING/SPEAKING 时抑制张掌按下
    if (gestureType === 'palm-press-start' || gestureType === 'palm-press-move' || gestureType === 'palm-press-end') {
      const voiceBlocked = ['LISTENING', 'TRANSCRIBING', 'THINKING', 'SPEAKING'];
      if (voiceBlocked.includes(state.voiceState)) {
        if (gestureBegins) releaseGesture();
        return false;
      }
    }

    // 键盘聚焦时抑制点击类手势
    if (state.keyboardFocused && gestureType === 'air-click') {
      releaseGesture();
      return false;
    }

    if (gestureType === 'air-click' || gestureType === 'long-press-end' || gestureType === 'air-drag-end') {
      releaseGesture();
    }

    return true;
  }

  // 设置手势显式允许/禁止
  function setGestureAllowed(allowed) {
    state.gestureAllowed = allowed;
  }

  // 请求取消当前操作
  function requestCancel(cancelFn) {
    if (state.pendingCancel) {
      try { state.pendingCancel(); } catch {}
    }
    state.pendingCancel = cancelFn;
  }

  function clearCancel() {
    state.pendingCancel = null;
  }

  function executeCancel() {
    if (state.pendingCancel) {
      try { state.pendingCancel(); } catch {}
      state.pendingCancel = null;
      return true;
    }
    return false;
  }

  // ---- 生命周期 ----
  function activate() {
    document.addEventListener('mousemove', onMouseMove, { passive: true });
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    document.addEventListener('focusin', onFocusIn, { passive: true });
    document.addEventListener('focusout', onFocusOut, { passive: true });
    // 鼠标空闲检测
    const idleInterval = setInterval(() => {
      if (performance.now() - state.mouseLastMove > 200) {
        onMouseIdle();
      }
    }, 250);
    return idleInterval;
  }

  function deactivate(idleInterval) {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('touchstart', onTouchStart);
    document.removeEventListener('touchend', onTouchEnd);
    document.removeEventListener('focusin', onFocusIn);
    document.removeEventListener('focusout', onFocusOut);
    if (idleInterval) clearInterval(idleInterval);
    clearCancel();
  }

  function reset() {
    state.mouseActive = false;
    state.mouseLastMove = 0;
    state.touchActive = false;
    state.touchCount = 0;
    state.keyboardFocused = false;
    state.voiceState = 'DISABLED';
    state.gestureActive = false;
    state.gestureGraceUntil = 0;
    state.gestureAllowed = true;
    clearCancel();
  }

  return {
    // 查询
    isGestureAllowed,
    isGestureTypeAllowed,

    // 设置
    setGestureAllowed,
    setVoiceState,

    // 取消
    requestCancel,
    executeCancel,
    clearCancel,

    // 生命周期
    activate,
    deactivate,
    reset,

    // 调试
    _state: () => ({ ...state }),
  };
}
