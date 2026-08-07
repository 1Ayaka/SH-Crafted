// Three.js 场景适配器 —— 为每个 Three.js 上下文注册交互目标
// 手势系统通过此适配器进行射线检测和调用现有交互方法
// 非侵入式：Three.js 场景继续拥有自己的 pointer 事件和 animate loop
export function createThreeTargetAdapter() {
  const contexts = new Map(); // name → context info
  let activeContext = null;

  function registerContext(name, info) {
    contexts.set(name, {
      name,
      raycaster: info.raycaster,
      camera: info.camera,
      getTargets: info.getTargets,           // () => Array<THREE.Mesh>
      getInteractiveGroups: info.getInteractiveGroups, // () => Set<THREE.Group> | null
      rendererDomElement: info.rendererDomElement,
      onHover: info.onHover || null,         // (group, mesh, userData) => void
      onHoverClear: info.onHoverClear || null, // () => void
      onClick: info.onClick || null,         // (group, mesh, userData) => void
      onDragStart: info.onDragStart || null, // (group, mesh, userData) => void
      onDragMove: info.onDragMove || null,   // (dx, dy) => void
      onDragEnd: info.onDragEnd || null,     // () => void
      onZoom: info.onZoom || null,           // (factor) => void
      getCursorStyle: info.getCursorStyle || null, // (group) => string | null
    });
    activeContext = name;
  }

  function unregisterContext(name) {
    contexts.delete(name);
    if (activeContext === name) activeContext = [...contexts.keys()].at(-1) || null;
  }

  // 射线检测 — 返回命中信息
  function raycast(name, ndcX, ndcY) {
    const ctx = contexts.get(name);
    if (!ctx) return null;

    ctx.raycaster.setFromCamera(
      { x: ndcX, y: ndcY },
      ctx.camera,
    );

    const targets = ctx.getTargets?.() || [];
    if (!targets.length) return null;

    const hits = ctx.raycaster.intersectObjects(targets, false);
    if (!hits.length) return null;

    const hit = hits[0];
    const mesh = hit.object;
    const group = mesh.userData?.graphGroup || mesh.parent || mesh;

    return {
      group,
      mesh,
      userData: mesh.userData || {},
      point: hit.point,
      distance: hit.distance,
      name,
    };
  }

  // 悬停
  function hover(name, group, mesh) {
    const ctx = contexts.get(name);
    if (ctx?.onHover) {
      ctx.onHover(group, mesh, mesh?.userData || {});
    }
  }

  function hoverClear(name) {
    const ctx = contexts.get(name);
    if (ctx?.onHoverClear) {
      ctx.onHoverClear();
    }
  }

  // 点击
  function click(name, group, mesh) {
    const ctx = contexts.get(name);
    if (ctx?.onClick) {
      ctx.onClick(group, mesh, mesh?.userData || {});
      return true;
    }
    return false;
  }

  // 拖拽
  function dragStart(name, group, mesh) {
    const ctx = contexts.get(name);
    if (ctx?.onDragStart) {
      ctx.onDragStart(group, mesh, mesh?.userData || {});
    }
  }

  function dragMove(name, dx, dy) {
    const ctx = contexts.get(name);
    if (ctx?.onDragMove) {
      ctx.onDragMove(dx, dy);
    }
  }

  function dragEnd(name) {
    const ctx = contexts.get(name);
    if (ctx?.onDragEnd) {
      ctx.onDragEnd();
    }
  }

  // 手势可能从画布空白处开始，此时没有 raycast mesh，但仍应驱动当前场景相机。
  function dragStartActive(group = null, mesh = null) {
    if (activeContext) dragStart(activeContext, group, mesh);
    return activeContext;
  }

  function dragMoveActive(dx, dy) {
    if (activeContext) dragMove(activeContext, dx, dy);
    return Boolean(activeContext);
  }

  function dragEndActive() {
    if (activeContext) dragEnd(activeContext);
    return activeContext;
  }

  function zoom(name, factor) {
    const ctx = contexts.get(name || activeContext);
    if (!ctx?.onZoom) return false;
    ctx.onZoom(factor);
    return true;
  }

  function zoomActive(factor) { return zoom(activeContext, factor); }

  // 获取所有注册的上下文名称
  function contextNames() {
    return [...contexts.keys()];
  }

  // 获取 renderer DOM 元素（用于坐标映射）
  function getRendererElement(name) {
    return contexts.get(name)?.rendererDomElement || null;
  }

  function reset() {
    contexts.clear();
    activeContext = null;
  }

  return {
    registerContext,
    unregisterContext,
    raycast,
    hover,
    hoverClear,
    click,
    dragStart,
    dragMove,
    dragEnd,
    dragStartActive,
    dragMoveActive,
    dragEndActive,
    zoom,
    zoomActive,
    contextNames,
    getActiveContext: () => activeContext,
    getRendererElement,
    reset,
  };
}
