// 多层目标解析器 —— 按优先级解析悬停/点击目标
// 优先级：模态对话框 > Agent 面板 > 手势 DOM 目标 > Three.js 射线命中 > DOM 底层 > 空白区域
const LAYERS = Object.freeze({
  MODAL: { priority: 0, label: 'modal' },
  AGENT_PANEL: { priority: 1, label: 'agent_panel' },
  GESTURE_DOM: { priority: 2, label: 'gesture_dom' },
  THREE_SCENE: { priority: 3, label: 'three_scene' },
  DOM_FALLBACK: { priority: 4, label: 'dom_fallback' },
  EMPTY: { priority: 5, label: 'empty' },
});

export function createTargetResolver({ hitSlopPx = 28 } = {}) {
  const threeContexts = new Map();   // name → { raycaster, camera, targets, rendererDomElement }
  const domTargets = new Map();      // id → { element, rect, handlers }
  const gestures = new Map();        // id → { element, action, enabled }
  let activeThreeContext = null;     // 当前活跃的 Three.js 场景名称
  let activeModalSelector = null;    // 当前打开的模态选择器（如 '.heritage-graph-overlay'）
  let agentPanelSelector = null;     // Agent 面板选择器
  let domHitTester = null;           // 动态 DOM 热区命中器（例如滚动区域）
  let gestureHitSlopPx = Math.max(0, Math.min(64, Number(hitSlopPx) || 28));

  // ---- 注册 ----

  function registerThreeContext(name, context) {
    threeContexts.set(name, {
      raycaster: context.raycaster,
      camera: context.camera,
      targets: context.targets,       // Array of meshes (live reference)
      getTargets: context.getTargets,
      interactiveCanvas: context.interactiveCanvas !== false,
      rendererDomElement: context.rendererDomElement,
    });
  }

  function unregisterThreeContext(name) {
    threeContexts.delete(name);
  }

  function setActiveThreeContext(name) {
    activeThreeContext = name;
  }

  function registerDomTarget(id, { element, rect, onHover, onClick, onScroll, onLeave } = {}) {
    domTargets.set(id, { element, rect, onHover, onClick, onScroll, onLeave, enabled: true });
  }

  function unregisterDomTarget(id) {
    domTargets.delete(id);
  }

  function setDomTargetEnabled(id, enabled) {
    const target = domTargets.get(id);
    if (target) target.enabled = enabled;
  }

  function setActiveModal(selector) {
    activeModalSelector = selector || null;
  }

  function setAgentPanelSelector(selector) {
    agentPanelSelector = selector || null;
  }

  function setDomHitTester(fn) {
    domHitTester = typeof fn === 'function' ? fn : null;
  }

  function setHitSlopPx(value) {
    gestureHitSlopPx = Math.max(0, Math.min(64, Number(value) || 0));
  }

  // ---- 解析 ----

  function isInsideElement(screenX, screenY, element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return (
      screenX >= rect.left &&
      screenX <= rect.right &&
      screenY >= rect.top &&
      screenY <= rect.bottom
    );
  }

  function isInsideRect(screenX, screenY, rect, padding = 0) {
    if (!rect) return false;
    return (
      screenX >= rect.left - padding &&
      screenX <= rect.right + padding &&
      screenY >= rect.top - padding &&
      screenY <= rect.bottom + padding
    );
  }

  function isUsableInteractiveElement(element) {
    if (!element?.isConnected) return false;
    if (element.disabled || element.getAttribute?.('aria-disabled') === 'true') return false;
    if (element.getAttribute?.('aria-hidden') === 'true') return false;
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    const view = element.ownerDocument?.defaultView;
    const style = view?.getComputedStyle?.(element);
    return !style || (style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none');
  }

  function resolveExpandedDom(screenX, screenY, scope = null) {
    const candidates = scope?.querySelectorAll
      ? scope.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"], input[type="reset"], summary')
      : document.querySelectorAll?.('button, a, [role="button"], input[type="button"], input[type="submit"], input[type="reset"], summary') || [];
    let best = null;
    let bestScore = Infinity;
    for (const element of candidates) {
      if (!isUsableInteractiveElement(element)) continue;
      const rect = element.getBoundingClientRect();
      if (!isInsideRect(screenX, screenY, rect, gestureHitSlopPx)) continue;
      if (scope && !scope.contains(element)) continue;
      const dx = screenX < rect.left ? rect.left - screenX : screenX > rect.right ? screenX - rect.right : 0;
      const dy = screenY < rect.top ? rect.top - screenY : screenY > rect.bottom ? screenY - rect.bottom : 0;
      const distance = Math.hypot(dx, dy);
      const area = Math.max(1, rect.width * rect.height);
      const score = distance * 1000 + area * 0.001;
      if (score < bestScore) {
        best = { element, rect };
        bestScore = score;
      }
    }
    if (!best) return null;
    return {
      layer: LAYERS.DOM_FALLBACK.label,
      element: best.element,
      rect: best.rect,
      gestureExpanded: !isInsideRect(screenX, screenY, best.rect),
      screen: { x: screenX, y: screenY },
    };
  }

  function resolveThreeScene(screenX, screenY) {
    // 遍历所有注册的 Three.js 场景，优先使用活跃场景
    const contexts = [];
    if (activeThreeContext && threeContexts.has(activeThreeContext)) {
      contexts.push({ name: activeThreeContext, ctx: threeContexts.get(activeThreeContext) });
    }
    for (const [name, ctx] of threeContexts) {
      if (name !== activeThreeContext) contexts.push({ name, ctx });
    }

    for (const { name, ctx } of contexts) {
      if (!ctx.rendererDomElement?.isConnected) continue;

      const rect = ctx.rendererDomElement.getBoundingClientRect();
      if (!isInsideElement(screenX, screenY, ctx.rendererDomElement)) continue;

      // 计算 NDC
      const ndcX = ((screenX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((screenY - rect.top) / rect.height) * 2 + 1;

      const targets = ctx.getTargets?.() || ctx.targets || [];
      const hits = ctx.raycaster && ctx.camera && targets.length
        ? (() => {
          ctx.raycaster.setFromCamera({ x: ndcX, y: ndcY }, ctx.camera);
          return ctx.raycaster.intersectObjects(targets, false);
        })()
        : [];

      if (hits.length > 0) {
        const hit = hits[0];
        const mesh = hit.object;
        const group = mesh.userData?.graphGroup || mesh;
        return {
          layer: LAYERS.THREE_SCENE.label,
          context: name,
          name,
          targetId: mesh.userData?.node?.id || mesh.userData?.id || mesh.uuid || name,
          element: ctx.rendererDomElement,
          mesh,
          group,
          userData: mesh.userData,
          point: hit.point,
          distance: hit.distance,
          ndc: { x: ndcX, y: ndcY },
          screen: { x: screenX, y: screenY },
        };
      }

      // 完成品模型等场景以整个画布作为可交互目标。
      if (ctx.interactiveCanvas) {
        return {
          layer: LAYERS.THREE_SCENE.label,
          context: name,
          name,
          targetId: name,
          element: ctx.rendererDomElement,
          mesh: null,
          group: null,
          ndc: { x: ndcX, y: ndcY },
          screen: { x: screenX, y: screenY },
        };
      }
    }

    return null;
  }

  function resolveDomGesture(screenX, screenY) {
    // 先扫描真实矩形，保证扩展命中区不会抢走另一个按钮的精确命中。
    for (const [targetId, target] of domTargets) {
      if (!target.enabled || !target.element?.isConnected) continue;
      const rect = target.rect || target.element.getBoundingClientRect();
      if (
        screenX >= rect.left &&
        screenX <= rect.right &&
        screenY >= rect.top &&
        screenY <= rect.bottom
      ) {
        return {
          layer: LAYERS.GESTURE_DOM.label,
          element: target.element,
          rect,
          id: targetId,
          targetId,
          onHover: target.onHover,
          onClick: target.onClick,
          onScroll: target.onScroll,
          onLeave: target.onLeave,
          screen: { x: screenX, y: screenY },
        };
      }
    }

    // 没有精确命中时，再在所有扩展区中选择距离最近的目标。
    let best = null;
    let bestDistance = Infinity;
    for (const [targetId, target] of domTargets) {
      if (!target.enabled || !target.element?.isConnected) continue;
      const rect = target.rect || target.element.getBoundingClientRect();
      if (isInsideRect(screenX, screenY, rect, gestureHitSlopPx)) {
        const dx = screenX < rect.left ? rect.left - screenX : screenX > rect.right ? screenX - rect.right : 0;
        const dy = screenY < rect.top ? rect.top - screenY : screenY > rect.bottom ? screenY - rect.bottom : 0;
        const distance = Math.hypot(dx, dy);
        if (distance < bestDistance) {
          best = { targetId, target, rect };
          bestDistance = distance;
        }
      }
    }
    if (best) {
      const { targetId, target, rect } = best;
      return {
        layer: LAYERS.GESTURE_DOM.label,
        element: target.element,
        rect,
        id: targetId,
        targetId,
        onHover: target.onHover,
        onClick: target.onClick,
        onScroll: target.onScroll,
        onLeave: target.onLeave,
        gestureExpanded: true,
        screen: { x: screenX, y: screenY },
      };
    }
    return null;
  }

  function resolve(screenX, screenY) {
    // 1. 检查模态对话框
    if (activeModalSelector) {
      const modal = document.querySelector(activeModalSelector);
      if (modal && isInsideElement(screenX, screenY, modal)) {
        const domResult = resolveDomGesture(screenX, screenY);
        if (domResult && modal.contains(domResult.element)) {
          domResult.layer = LAYERS.MODAL.label;
          return domResult;
        }
        const expanded = resolveExpandedDom(screenX, screenY, modal);
        if (expanded) {
          expanded.layer = LAYERS.MODAL.label;
          return expanded;
        }
        const modalElement = document.elementFromPoint(screenX, screenY);
        if (modalElement && modal.contains(modalElement)) {
          return {
            layer: LAYERS.DOM_FALLBACK.label,
            element: modalElement,
            screen: { x: screenX, y: screenY },
          };
        }
        return {
          layer: LAYERS.MODAL.label,
          element: modal,
          screen: { x: screenX, y: screenY },
        };
      }
      // 模态打开时，限制目标在模态内
      if (modal) {
        // 获取模态内注册的 DOM 目标
        const domResult = resolveDomGesture(screenX, screenY);
        if (domResult && modal.contains(domResult.element)) {
          domResult.layer = LAYERS.MODAL.label;
          return domResult;
        }
        const expanded = resolveExpandedDom(screenX, screenY, modal);
        if (expanded) {
          expanded.layer = LAYERS.MODAL.label;
          return expanded;
        }
        return { layer: LAYERS.MODAL.label, element: modal, restricted: true, screen: { x: screenX, y: screenY } };
      }
    }

    // 2. Agent 面板
    if (agentPanelSelector) {
      const agentPanel = document.querySelector(agentPanelSelector);
      if (agentPanel && isInsideElement(screenX, screenY, agentPanel)) {
        const panelElement = document.elementFromPoint(screenX, screenY);
        if (panelElement && agentPanel.contains(panelElement)) {
          return {
            layer: LAYERS.DOM_FALLBACK.label,
            element: panelElement,
            screen: { x: screenX, y: screenY },
          };
        }
        const expanded = resolveExpandedDom(screenX, screenY, agentPanel);
        if (expanded) return expanded;
        return {
          layer: LAYERS.AGENT_PANEL.label,
          element: agentPanel,
          screen: { x: screenX, y: screenY },
        };
      }
    }

    // 3. 注册的手势 DOM 目标（滚动区域、特殊按钮）
    const domResult = resolveDomGesture(screenX, screenY);
    if (domResult) return domResult;

    const dynamicDomResult = domHitTester?.(screenX, screenY);
    if (dynamicDomResult) {
      return {
        layer: LAYERS.GESTURE_DOM.label,
        targetId: dynamicDomResult.targetId,
        element: dynamicDomResult.target?.element || null,
        zone: dynamicDomResult.zone || null,
        screen: { x: screenX, y: screenY },
      };
    }

    // 手势专用扩展命中区：标准按钮和链接的外围也可以被食指指针命中。
    const expandedDomResult = resolveExpandedDom(screenX, screenY);
    if (expandedDomResult) return expandedDomResult;

    // 4. Three.js 场景射线检测
    const threeResult = resolveThreeScene(screenX, screenY);
    if (threeResult?.mesh) return threeResult;

    // 5. DOM 底层元素
    if (threeResult) return threeResult; // Three.js 画布但无命中

    const domElement = document.elementFromPoint(screenX, screenY);
    if (domElement && domElement !== document.body && domElement !== document.documentElement) {
      return {
        layer: LAYERS.DOM_FALLBACK.label,
        element: domElement,
        screen: { x: screenX, y: screenY },
      };
    }

    // 6. 空白区域
    return { layer: LAYERS.EMPTY.label, screen: { x: screenX, y: screenY } };
  }

  function reset() {
    threeContexts.clear();
    domTargets.clear();
    gestures.clear();
    activeThreeContext = null;
    activeModalSelector = null;
    agentPanelSelector = null;
    domHitTester = null;
  }

  return {
    registerThreeContext,
    unregisterThreeContext,
    setActiveThreeContext,
    registerDomTarget,
    unregisterDomTarget,
    setDomTargetEnabled,
    setActiveModal,
    setAgentPanelSelector,
    setDomHitTester,
    setHitSlopPx,
    resolve,
    reset,
    LAYERS,
  };
}
