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
import { loadGestureSettings, effectiveConfig } from './gesture-settings.js';

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
  });
  const threeAdapter = createThreeTargetAdapter();
  const domAdapter = createDomTargetAdapter();
  const cursor = createGestureCursor();
  const toggle = createGestureToggle();
  const status = createGestureStatus();
  const handOverlay = createGestureHandOverlay();
  const virtualPointer = createVirtualPointer();
  const help = createGestureHelp();

  let currentHovered = null;
  let currentDragTarget = null;
  let currentPressTarget = null;
  let pendingClickTarget = null;
  let longPressActive = false;
  let voiceState = 'DISABLED';
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

  // ---- 手势事件 → 输入协调 → 目标解析 → 动作执行 ----

  const controller = createGestureController({
    onEvent(event) {
      if (event.type === 'hand-landmarks') { handOverlay.update(event.landmarks); return; }
      if (event.type === 'hand-landmarks-clear') { handOverlay.hide(); return; }
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
          if (resolved?.layer === 'three_scene') {
            currentDragTarget = resolved;
            threeAdapter.dragStart(resolved.context || resolved.name, resolved.group, resolved.mesh);
          }
          cursor.setPinching(true);
          handOverlay.setAction('pinching');
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
          if (currentDragTarget) {
            if (currentDragTarget.layer === 'three_scene') {
              threeAdapter.dragEnd(currentDragTarget.context || currentDragTarget.name);
            }
            currentDragTarget = null;
          }
          cursor.setPinching(false);
          if (!longPressActive) {
            handOverlay.setAction('tracking');
            currentPressTarget = null;
          }
          break;
        }

        case 'long-press-start': {
          longPressActive = true;
          cursor.setLongPress(true);
          handOverlay.setAction('longpress');
          // 长按是“抓住”的确认点。若目标是 Three 场景且此前尚未建立
          // 拖拽上下文，在这里补一次 dragStart，保证长按本身可接管旋转。
          if (currentPressTarget?.layer === 'three_scene' && !currentDragTarget) {
            currentDragTarget = currentPressTarget;
            threeAdapter.dragStart(currentDragTarget.context || currentDragTarget.name, currentDragTarget.group, currentDragTarget.mesh);
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
          handOverlay.setAction('tracking');
          break;
        }

        case 'air-drag': {
          if (currentDragTarget?.layer === 'three_scene') {
            handOverlay.setAction('dragging');
            threeAdapter.dragMove(currentDragTarget.context || currentDragTarget.name, event.dx, event.dy);
          } else if (currentDragTarget?.layer === 'three_canvas_fallback') {
            handOverlay.setAction('dragging');
            threeAdapter.dragMoveActive(event.dx, event.dy);
          }
          break;
        }

        case 'air-drag-start': {
          if (currentPressTarget?.layer === 'three_scene') {
            if (!currentDragTarget) {
              currentDragTarget = currentPressTarget;
              threeAdapter.dragStart(currentDragTarget.context || currentDragTarget.name, currentDragTarget.group, currentDragTarget.mesh);
            }
            handOverlay.setAction('dragging');
          } else if (!currentDragTarget && threeAdapter.getActiveContext?.()) {
            currentDragTarget = {
              layer: 'three_canvas_fallback',
              context: threeAdapter.getActiveContext(),
              name: threeAdapter.getActiveContext(),
            };
            threeAdapter.dragStartActive();
            handOverlay.setAction('dragging');
          }
          break;
        }

        case 'air-drag-end': {
          if (currentDragTarget?.layer === 'three_scene') {
            threeAdapter.dragEnd(currentDragTarget.context || currentDragTarget.name);
            currentDragTarget = null;
          } else if (currentDragTarget?.layer === 'three_canvas_fallback') {
            threeAdapter.dragEndActive();
            currentDragTarget = null;
          }
          handOverlay.setAction('tracking');
          break;
        }

        case 'palm-press-start': {
          const resolved = targetResolver.resolve(event.screenX, event.screenY);
          currentPressTarget = resolved;
          pendingClickTarget = null;
          longPressActive = false;
          virtualPointer.down(resolved, event.screenX, event.screenY);
          if (resolved?.layer === 'three_scene') {
            currentDragTarget = resolved;
            threeAdapter.dragStart(resolved.context || resolved.name, resolved.group, resolved.mesh);
          } else if (threeAdapter.getActiveContext?.() && !resolved?.layer?.includes('dom')) {
            currentDragTarget = {
              layer: 'three_canvas_fallback',
              context: threeAdapter.getActiveContext(),
              name: threeAdapter.getActiveContext(),
            };
            threeAdapter.dragStartActive();
          }
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
            if (currentDragTarget.layer === 'three_scene') {
              threeAdapter.dragEnd(currentDragTarget.context || currentDragTarget.name);
            } else if (currentDragTarget.layer === 'three_canvas_fallback') {
              threeAdapter.dragEndActive();
            }
            currentDragTarget = null;
          }
          cursor.setPinching(false);
          if (!longPressActive) {
            handOverlay.setAction('tracking');
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
          handOverlay.setAction('tracking');
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
          if (currentDragTarget) {
            threeAdapter.dragEnd(currentDragTarget.context || currentDragTarget.name);
            currentDragTarget = null;
          }
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
        cursor.setOpacity(1);
        handOverlay.showGuide();
        if (firstStart) help.show();
      }).catch(() => {});
    },
    onDecline: () => {
      toggle.setState('DISABLED');
      status.setText('手势未开启；你仍可以使用鼠标、键盘或语音。');
    },
  });

  toggle.mount();
  toggle.setOnToggle(async (enabled) => {
    if (enabled) {
      try {
        if (controller.state() === 'SUSPENDED') await controller.resume();
        else if (!permissionAcknowledged) permission.show();
        else await controller.start();
        cursor.setOpacity(1);
        handOverlay.showGuide();
      } catch (err) {
        status.setText(err?.message || '手势暂时不可用，请检查摄像头权限。');
      }
    } else {
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
      instance = null;
    },
  };

  window.__gestureSystem = instance;
  document.dispatchEvent(new CustomEvent('sh-crafted:gesture-ready', { detail: { system: instance } }));
  return instance;
}
