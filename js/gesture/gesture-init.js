// 手势系统初始化入口 —— 单例模式，参考 agent.js 的使用模式
// 负责：创建手势控制器 + 交互层 + UI 组件 + 事件路由
// 视图通过 registerViewContext() 注册各自的交互区域
import { createGestureController } from './gesture-controller.js';
import { createInputCoordinator } from '../interaction/input-coordinator.js';
import { createActionRegistry } from '../interaction/action-registry.js';
import { createTargetResolver } from '../interaction/target-resolver.js';
import { createThreeTargetAdapter } from '../interaction/three-target-adapter.js';
import { createDomTargetAdapter } from '../interaction/dom-target-adapter.js';
import { createGestureCursor } from './gesture-cursor.js';
import { createGestureToggle } from './gesture-toggle.js';
import { createGestureStatus } from './gesture-status.js';
import { createGesturePermission } from './gesture-permission.js';
import { createGestureHelp } from './gesture-help.js';
import { createGestureHandOverlay } from './gesture-hand-overlay.js';
import { createVirtualPointer } from './virtual-pointer.js';
import { loadGestureSettings, saveGestureSettings, effectiveConfig } from './gesture-settings.js';
import { shouldBeginDirectPalmDrag } from './gesture-drag-policy.js';
import { createGestureDiagnostics } from './gesture-diagnostics.js';

let instance = null;

export function getGestureSystem() {
  return instance;
}

export function initGesture({ onVoiceStateChange } = {}) {
  if (instance) return instance;

  const coordinator = createInputCoordinator();
  const actionRegistry = createActionRegistry();
  const targetResolver = createTargetResolver({
    hitSlopPx: effectiveConfig(loadGestureSettings()).hitSlopPx,
    threeHitSlopPx: effectiveConfig(loadGestureSettings()).threeHitSlopPx,
  });
  const threeAdapter = createThreeTargetAdapter();
  const domAdapter = createDomTargetAdapter();
  const cursor = createGestureCursor();
  const toggle = createGestureToggle();
  const status = createGestureStatus();
  const handOverlay = createGestureHandOverlay();
  const virtualPointer = createVirtualPointer();
  const help = createGestureHelp();
  const diagnostics = createGestureDiagnostics();

  let currentHovered = null;
  let currentDragTarget = null;
  let currentPressTarget = null;
  let pendingClickTarget = null;
  let longPressActive = false;
  let voiceState = 'DISABLED';
  let toggleRequestGeneration = 0;
  const viewContexts = new Map();
  const PERMISSION_KEY = 'sh-crafted.gesture-permission-acknowledged';
  let permissionAcknowledged = false;

  try {
    permissionAcknowledged = localStorage.getItem(PERMISSION_KEY) === 'true';
  } catch { /* 无 localStorage 时按首次使用处理 */ }

  function targetKey(target) {
    if (!target) return '';
    return `${target.layer}:${target.context || target.name || ''}:${target.targetId || target.mesh?.uuid || ''}`;
  }

  function clickInteractiveElement(element) {
    // Prefer the nearest semantic control, but keep the original hit element
    // as a fallback. Canvas-based views attach their existing click handler to
    // the canvas itself and must remain operable even before a Three context is
    // registered.
    const target = element?.closest?.('button, a, input, select, textarea, summary, [role="button"]') || element;
    if (!target || target.disabled || target.getAttribute('aria-disabled') === 'true') return false;
    target.focus?.({ preventScroll: true });
    if (typeof target.click === 'function') target.click();
    else target.dispatchEvent?.(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    return true;
  }

  function interactiveElement(target) {
    return target?.element?.closest?.('button, a, input, select, textarea, summary, [role="button"]') || target?.element || null;
  }

  function targetLabel(target) {
    return target?.mesh?.userData?.district?.name
      || target?.mesh?.userData?.node?.title
      || target?.group?.userData?.node?.title
      || target?.group?.userData?.portal?.label
      || target?.element?.getAttribute?.('aria-label')
      || target?.element?.textContent?.trim?.().slice(0, 24)
      || '';
  }

  // A drag belongs to the active Three scene for its whole lifetime. The
  // pressed mesh is only used for the optional click; it must not decide
  // whether subsequent frames reach the scene (the pointer may leave it).
  function beginSceneDrag(target) {
    if (target?.layer === 'three_scene') {
      const context = target.context || target.name;
      currentDragTarget = { ...target, context, name: context };
      threeAdapter.dragStart(context, target.group, target.mesh);
      return true;
    }
    // Never let a palm press on a modal, agent panel or regular DOM control
    // rotate a scene behind it. Only an empty canvas hit may use the active
    // scene fallback.
    if (target?.layer && target.layer !== 'empty' && !target.layer.startsWith('three_canvas')) return false;
    const context = threeAdapter.getActiveContext?.();
    if (!context) return false;
    currentDragTarget = { layer: 'three_canvas_fallback', context, name: context };
    threeAdapter.dragStartActive();
    return true;
  }

  function endSceneDrag() {
    if (!currentDragTarget) return;
    const context = currentDragTarget.context || currentDragTarget.name;
    if (currentDragTarget.layer === 'three_canvas_fallback') threeAdapter.dragEndActive();
    else threeAdapter.dragEnd(context);
    currentDragTarget = null;
  }

  // ---- 手势事件 → 输入协调 → 目标解析 → 动作执行 ----

  const controller = createGestureController({
    onEvent(event) {
      if (event.type === 'hand-landmarks') { handOverlay.update(event.landmarks); return; }
      if (event.type === 'hand-landmarks-clear') { handOverlay.hide(); return; }
      if (!['pointer-move', 'pinch-move'].includes(event.type)) {
        diagnostics.record('input-event', {
          type: event.type,
          was_click: event.wasClick,
          duration_ms: event.duration,
          source: event.source || '',
        });
      }
      if (!coordinator.isGestureTypeAllowed(event.type)) return;

      switch (event.type) {
        case 'pointer-move': {
          const resolved = targetResolver.resolve(event.screenX, event.screenY);
          cursor.moveTo(event.screenX, event.screenY);
          virtualPointer.move(resolved, event.screenX, event.screenY);

          // 悬停变化
          if (targetKey(resolved) !== targetKey(currentHovered)) {
            if (currentHovered) {
              threeAdapter.hoverClear(currentHovered.context || currentHovered.name);
              domAdapter.getTarget(currentHovered.targetId)?.handlers?.onHoverLeave?.();
            }
            currentHovered = resolved;
            controller.setHoveredTarget(resolved);

            if (resolved) {
              cursor.setHovering(true);
              if (resolved.layer === 'three_scene' && resolved.group) {
                threeAdapter.hover(resolved.context || resolved.name, resolved.group, resolved.mesh);
              }
              const domTarget = domAdapter.getTarget(resolved.targetId);
              domTarget?.handlers?.onHoverEnter?.();
            } else {
              cursor.setHovering(false);
            }
          }

          // 指针进入注册的滚动热区时，执行与鼠标滚轮等价的平滑滚动。
          const scrollHit = domAdapter.hitTest(event.screenX, event.screenY);
          if (scrollHit?.zone?.type === 'scroll') {
            domAdapter.getTarget(scrollHit.targetId)?.handlers?.onScroll?.(scrollHit.zone.direction);
          }

          break;
        }

        case 'air-click': {
          // Mouse semantics activate the target pressed at pinch start, even
          // when the hand shifts slightly while the fingers separate.
          const resolved = pendingClickTarget || event.target || targetResolver.resolve(event.screenX, event.screenY);
          pendingClickTarget = null;
          if (!resolved) break;

          cursor.confirmFeedback();
          let executed = false;
          if (resolved.layer === 'three_scene') {
            executed = threeAdapter.click(resolved.context || resolved.name, resolved.group, resolved.mesh);
          } else if (resolved.layer === 'gesture_dom' || resolved.layer === 'modal') {
            const domTarget = domAdapter.getTarget(resolved.targetId);
            if (domTarget?.handlers?.onClick) {
              domTarget.handlers.onClick(resolved);
              executed = true;
            } else {
              executed = clickInteractiveElement(resolved.element);
            }
          } else if (resolved.layer === 'dom_fallback') {
            executed = clickInteractiveElement(resolved.element);
          }

          const label = targetLabel(resolved);
          status.setText(executed ? `已点击${label ? `：${label}` : ''}` : '当前位置没有可点击目标');
          window.__gestureLastAction = {
            type: 'click',
            executed,
            layer: resolved.layer || '',
            context: resolved.context || resolved.name || '',
            target: label || resolved.targetId || '',
            at: Date.now(),
          };
          document.dispatchEvent(new CustomEvent('sh-crafted:gesture-action', { detail: window.__gestureLastAction }));
          diagnostics.record('action', window.__gestureLastAction);

          actionRegistry.execute('gesture-click', {
            target: resolved,
            screenX: event.screenX,
            screenY: event.screenY,
          });

          controller.setSelectedTarget(resolved);
          break;
        }

        case 'pinch-start': {
          const resolved = targetResolver.resolve(event.screenX, event.screenY);
          currentPressTarget = resolved;
          pendingClickTarget = null;
          longPressActive = false;
          virtualPointer.down(resolved, event.screenX, event.screenY);
          cursor.setPinching(true);
          handOverlay.setAction('pinching');
          diagnostics.record('press-target', {
            gesture: 'thumb-index-pinch',
            layer: resolved?.layer || 'empty',
            context: resolved?.context || resolved?.name || '',
            target: targetLabel(resolved),
          });
          break;
        }

        case 'pinch-move': {
          if (currentDragTarget?.layer === 'three_scene') {
            // dx/dy 由 air-drag 事件提供
          }
          break;
        }

        case 'pinch-end': {
          pendingClickTarget = event.wasClick ? currentPressTarget : null;
          virtualPointer.up(currentPressTarget, event.screenX, event.screenY);
          endSceneDrag();
          cursor.setPinching(false);
          if (!longPressActive) {
            handOverlay.setAction('idle');
            currentPressTarget = null;
          }
          break;
        }

        case 'long-press-start': {
          longPressActive = true;
          cursor.setLongPress(true);
          handOverlay.setAction('longpress');
          diagnostics.record('long-press', {
            phase: 'start',
            duration_ms: event.duration,
            layer: currentPressTarget?.layer || 'empty',
            target: targetLabel(currentPressTarget),
          });
          // 只有锁定在 Three 画布上的长按才能取得场景拖拽所有权。
          // DOM 控件（尤其地图上的非遗图片）永远不会穿透旋转后方地图。
          if (currentPressTarget?.layer === 'three_scene' && !currentDragTarget) {
            beginSceneDrag(currentPressTarget);
          }
          const longPressElement = interactiveElement(currentPressTarget);
          longPressElement?.classList?.add('is-gesture-longpress');
          longPressElement?.dispatchEvent?.(new CustomEvent('gesturelongpress', { bubbles: true, detail: { source: 'gesture' } }));
          actionRegistry.execute('gesture-long-press', { phase: 'start', target: currentPressTarget });
          break;
        }

        case 'long-press-end': {
          interactiveElement(currentPressTarget)?.classList?.remove('is-gesture-longpress');
          actionRegistry.execute('gesture-long-press', { phase: 'end', target: currentPressTarget });
          longPressActive = false;
          cursor.setLongPress(false);
          currentPressTarget = null;
          pendingClickTarget = null;
          handOverlay.setAction('idle');
          break;
        }

        case 'air-drag': {
          if (currentDragTarget) {
            handOverlay.setAction('dragging');
            threeAdapter.dragMove(currentDragTarget.context || currentDragTarget.name, event.dx, event.dy);
          }
          break;
        }

        case 'air-drag-start': {
          if (currentPressTarget?.layer === 'three_scene' && longPressActive) {
            if (!currentDragTarget) beginSceneDrag(currentPressTarget);
            handOverlay.setAction('dragging');
          }
          break;
        }

        case 'air-drag-end': {
          endSceneDrag();
          handOverlay.setAction('idle');
          break;
        }

        case 'palm-press-start': {
          const resolved = targetResolver.resolve(event.screenX, event.screenY);
          currentPressTarget = resolved;
          pendingClickTarget = null;
          longPressActive = false;
          virtualPointer.down(resolved, event.screenX, event.screenY);
          // 部分全屏场景（地图）把自然放松的张掌识别成持续按下时，会被
          // 摄像头抖动带着移动。此类场景关闭直接张掌拖拽，但仍保留捏合
          // 长按后的精确拖拽；其他场景继续沿用原有的张掌直接操作。
          if (shouldBeginDirectPalmDrag(resolved)) beginSceneDrag(resolved);
          cursor.setPinching(true);
          handOverlay.setAction('palmpress');
          break;
        }

        case 'palm-press-move': {
          break;
        }

        case 'palm-press-end': {
          pendingClickTarget = event.wasClick ? currentPressTarget : null;
          virtualPointer.up(currentPressTarget, event.screenX, event.screenY);
          if (currentDragTarget) {
            endSceneDrag();
          }
          cursor.setPinching(false);
          if (!longPressActive) {
            handOverlay.setAction('idle');
            currentPressTarget = null;
          }
          break;
        }

        case 'fist-start': {
          handOverlay.setAction('zoomout');
          if (!threeAdapter.zoomActive(1.18)) document.querySelector('.heritage-graph-zoom button:first-child, .map-zoom-controls button:first-child')?.click?.();
          status.setText('握拳：缩小');
          actionRegistry.execute('gesture-zoom-out', {});
          break;
        }

        case 'fist-end': {
          handOverlay.setAction('idle');
          break;
        }

        case 'swipe-left': {
          actionRegistry.execute('navigate-back', { source: 'gesture' });
          break;
        }

        case 'hand-lost': {
          cursor.hide();
          handOverlay.hide();
          virtualPointer.cancel();
          longPressActive = false;
          cursor.setLongPress(false);
          currentPressTarget = null;
          pendingClickTarget = null;
          endSceneDrag();
          break;
        }

        case 'cursor-hidden': {
          cursor.hide();
          break;
        }

        default:
          break;
      }
    },

    onStateChange(next, previous, meta) {
      toggle.setState(next);
      status.setState(next, meta?.reason || meta?.error || '');

      if (next === 'ACTIVE' && previous === 'READY') {
        cursor.setOpacity(1);
      }
    },

    onNotice(msg) {
      status.setText(msg);
    },

    onError(err) {
      console.warn('手势系统错误:', err);
      cursor.errorFeedback();
      handOverlay.hide();
    },

    onMetrics(summary) {
      // 调试模式下输出到 debug 面板
      if (window.__gestureMetrics) {
        window.__gestureMetrics = summary;
      }
    },

    onDiagnostic(category, data, sampled = false) {
      if (sampled) diagnostics.sample(category, data, 200);
      else diagnostics.record(category, data);
    },
  });

  actionRegistry.registerAction('gesture-click', async ({ target } = {}) => ({
    target: target || null,
  }));
  actionRegistry.registerAction('gesture-long-press', async ({ phase, target } = {}) => {
    const threeTarget = target?.layer === 'three_scene' ? target : null;
    if (phase === 'start' && threeTarget && !currentDragTarget) {
      currentDragTarget = threeTarget;
      threeAdapter.dragStart(threeTarget.context || threeTarget.name, threeTarget.group, threeTarget.mesh);
    }
    return { phase, target: target || null, armed: Boolean(threeTarget) };
  });
  actionRegistry.registerAction('gesture-zoom-in', async () => ({ factor: 0.84 }));
  actionRegistry.registerAction('gesture-zoom-out', async () => ({ factor: 1.18 }));
  actionRegistry.registerAction('gesture-cancel', async () => ({ canceled: true }));
  actionRegistry.registerAction('navigate-back', async () => {
    // 复用各页面现有 Escape 逻辑：详情图谱、阅读面板、地图焦点和路由
    // 会按与键盘返回相同的优先级逐层退出。
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return { navigated: true };
  });

  // ---- 输入协调器初始化 ----
  function setVoiceState(vs) {
    voiceState = vs;
    coordinator.setVoiceState(vs);
    onVoiceStateChange?.(vs);
  }

  const idleInterval = coordinator.activate();

  // ---- 注册默认 DOM 滚动区域（在视图初始化时通过 registerViewContext 覆盖） ----

  // ---- 手势开关 ----
  const permission = createGesturePermission({
    onAccept: () => {
      permissionAcknowledged = true;
      try { localStorage.setItem(PERMISSION_KEY, 'true'); } catch { /* 降级 */ }
      const firstStart = !loadGestureSettings().firstTimeCompleted;
      void controller.start().then(() => {
        if (controller.state() === 'DISABLED') return;
        saveGestureSettings({ enabled: true });
        cursor.setOpacity(1);
        handOverlay.showGuide();
        if (firstStart) help.show();
      }).catch(() => {});
    },
    onDecline: () => {
      saveGestureSettings({ enabled: false });
      toggle.setState('DISABLED');
      status.setText('手势未开启；你仍可以使用鼠标、键盘或语音。');
    },
  });

  toggle.mount();
  toggle.setOnToggle(async (enabled) => {
    const requestGeneration = ++toggleRequestGeneration;
    if (enabled) {
      try {
        if (controller.state() === 'SUSPENDED') await controller.resume();
        else if (!permissionAcknowledged) permission.show();
        else await controller.start();
        if (requestGeneration !== toggleRequestGeneration || controller.state() === 'DISABLED') return;
        saveGestureSettings({ enabled: true });
        cursor.setOpacity(1);
        handOverlay.showGuide();
      } catch (err) {
        status.setText(err?.message || '手势暂时不可用，请检查摄像头权限。');
      }
    } else {
      saveGestureSettings({ enabled: false });
      permission.dismiss();
      controller.stop();
      virtualPointer.cancel();
      cursor.hide();
      handOverlay.hide();
      status.setState('DISABLED');
    }
  });
  toggle.setOnSettings(() => {
    import('./gesture-settings-panel.js').then((m) => {
      m.createGestureSettingsPanel().show();
    });
  });
  status.mount();

  // 仅在用户此前明确勾选“开机自启”且已经完成过权限说明时恢复。
  // 默认设置为 false，不会因为加载页面而访问摄像头。
  const initialSettings = loadGestureSettings();
  if (initialSettings.enabled && permissionAcknowledged && !document.hidden) {
    queueMicrotask(() => {
      void controller.start().then(() => cursor.setOpacity(1)).catch(() => {});
    });
  }

  // ---- 可见性/卸载处理 ----
  const onVisibilityChange = () => {
    if (document.hidden) {
      controller.suspend('page_hidden');
    } else if (controller.state() === 'SUSPENDED') {
      void controller.resume();
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  // ---- 窗口大小变化 ----
  const onResize = () => {
    domAdapter.updateRects();
  };
  window.addEventListener('resize', onResize);

  targetResolver.setDomHitTester((screenX, screenY) => domAdapter.hitTest(screenX, screenY));

  // ---- 公共 API ----
  instance = {
    controller,
    coordinator,
    actionRegistry,
    targetResolver,
    threeAdapter,
    domAdapter,
    cursor,
    toggle,
    status,
    diagnostics,

    // 视图注册其交互上下文
    registerViewContext(viewId, { threeContexts = [], scrollZones = [], clickTargets = [] } = {}) {
      this.unregisterViewContext(viewId);
      const registered = { three: [], dom: [] };

      // 注册 Three.js 场景
      for (const ctx of threeContexts) {
        targetResolver.registerThreeContext(ctx.name, ctx);
        threeAdapter.registerContext(ctx.name, ctx);
        targetResolver.setActiveThreeContext(ctx.name);
        registered.three.push(ctx.name);
      }

      // 注册 DOM 滚动热区
      for (const zone of scrollZones) {
        domAdapter.registerScrollZone(zone.id, zone.element, zone.options);
        registered.dom.push(zone.id);
      }

      // 注册 DOM 点击目标
      for (const target of clickTargets) {
        domAdapter.register(target.id, target);
        targetResolver.registerDomTarget(target.id, {
          element: target.element,
          rect: target.rect,
        });
        registered.dom.push(target.id);
      }

      viewContexts.set(viewId, registered);
    },

    // 注销视图上下文
    unregisterViewContext(viewId) {
      const registered = viewContexts.get(viewId);
      if (!registered) return;
      registered.three.forEach((name) => {
        targetResolver.unregisterThreeContext(name);
        threeAdapter.unregisterContext(name);
      });
      registered.dom.forEach((id) => {
        targetResolver.unregisterDomTarget(id);
        domAdapter.unregister(id);
      });
      viewContexts.delete(viewId);
    },

    // 语音状态同步
    setVoiceState,

    // 获取当前手势上下文（供 agent 使用）
    getGestureContext() {
      return controller.getContext();
    },

    // 获取当前悬停目标（供 agent context-builder 使用）
    getHoveredTarget() {
      return currentHovered;
    },

    // 销毁
    destroy() {
      coordinator.deactivate(idleInterval);
      permission.destroy();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('resize', onResize);
      [...viewContexts.keys()].forEach((viewId) => instance?.unregisterViewContext(viewId));
      controller.destroy();
      virtualPointer.cancel();
      cursor.destroy();
      handOverlay.destroy();
      help.destroy();
      toggle.destroy();
      status.destroy();
      domAdapter.reset();
      targetResolver.reset();
      threeAdapter.reset();
      actionRegistry.reset();
      currentHovered = null;
      currentDragTarget = null;
      window.__gestureSystem = null;
      window.__gestureDiagnostics = null;
      instance = null;
    },
  };
  window.__gestureDiagnostics = diagnostics;

  window.__gestureSystem = instance;
  document.dispatchEvent(new CustomEvent('sh-crafted:gesture-ready', { detail: { system: instance } }));
  return instance;
}
