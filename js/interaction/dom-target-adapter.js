// DOM 手势目标适配器 —— 为可滚动面板和手势按钮注册交互区域
// 用于滚动热区、特殊按钮等，与 Three.js 目标分离管理
export function createDomTargetAdapter() {
  const targets = new Map(); // id → { element, zones, handlers, enabled }

  function register(id, options = {}) {
    const target = {
      id,
      element: options.element || null,
      zones: options.zones || [],       // [{ rect: {left,top,right,bottom}, type: 'scroll'|'click' }]
      handlers: {
        onHover: options.onHover || null,
        onHoverEnter: options.onHoverEnter || null,
        onHoverLeave: options.onHoverLeave || null,
        onClick: options.onClick || null,
        onScroll: options.onScroll || null,
        onScrollEnd: options.onScrollEnd || null,
      },
      enabled: options.enabled !== false,
      metadata: options.metadata || {},
    };
    targets.set(id, target);
    return id;
  }

  function unregister(id) {
    targets.delete(id);
  }

  function setEnabled(id, enabled) {
    const target = targets.get(id);
    if (target) target.enabled = Boolean(enabled);
  }

  function getTarget(id) {
    return targets.get(id) || null;
  }

  // 注册滚动热区（如详情面板顶部/底部）
  function registerScrollZone(id, element, { topZoneHeight = 60, bottomZoneHeight = 60, scrollSpeed = 2 } = {}) {
    if (!element) return null;

    const rect = element.getBoundingClientRect();
    const zones = [];

    if (topZoneHeight > 0) {
      zones.push({
        rect: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.top + topZoneHeight,
        },
        height: topZoneHeight,
        type: 'scroll',
        direction: -1, // 向上滚动
        speed: scrollSpeed,
      });
    }

    if (bottomZoneHeight > 0) {
      zones.push({
        rect: {
          left: rect.left,
          top: rect.bottom - bottomZoneHeight,
          right: rect.right,
          bottom: rect.bottom,
        },
        height: bottomZoneHeight,
        type: 'scroll',
        direction: 1, // 向下滚动
        speed: scrollSpeed,
      });
    }

    return register(id, {
      element,
      zones,
      onScroll(delta) {
        // 平滑滚动
        element.scrollBy({ top: delta * scrollSpeed, behavior: 'auto' });
      },
    });
  }

  // 查找命中的区域
  function hitTest(screenX, screenY) {
    const results = [];
    for (const [, target] of targets) {
      if (!target.enabled) continue;
      for (const zone of target.zones) {
        const r = zone.rect;
        if (
          screenX >= r.left &&
          screenX <= r.right &&
          screenY >= r.top &&
          screenY <= r.bottom
        ) {
          results.push({
            targetId: target.id,
            zone,
            target,
            screenX,
            screenY,
          });
        }
      }
    }
    // 返回最小区域（最具体的目标）
    results.sort((a, b) => {
      const areaA = (a.zone.rect.right - a.zone.rect.left) * (a.zone.rect.bottom - a.zone.rect.top);
      const areaB = (b.zone.rect.right - b.zone.rect.left) * (b.zone.rect.bottom - b.zone.rect.top);
      return areaA - areaB;
    });
    return results[0] || null;
  }

  // 更新所有区域的边界（resize/scroll 后调用）
  function updateRects() {
    for (const [, target] of targets) {
      if (!target.element?.isConnected) continue;
      const elementRect = target.element.getBoundingClientRect();
      for (const zone of target.zones) {
        if (zone.type === 'scroll') {
          if (zone.direction === -1) {
            zone.rect = {
              left: elementRect.left,
              top: elementRect.top,
              right: elementRect.right,
              bottom: elementRect.top + (zone.height ?? 60),
            };
          } else {
            zone.rect = {
              left: elementRect.left,
              top: elementRect.bottom - (zone.height ?? 60),
              right: elementRect.right,
              bottom: elementRect.bottom,
            };
          }
        }
      }
    }
  }

  function reset() {
    targets.clear();
  }

  return {
    register,
    unregister,
    setEnabled,
    getTarget,
    registerScrollZone,
    hitTest,
    updateRects,
    reset,
  };
}
