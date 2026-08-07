// Converts gesture coordinates into the same pointer/mouse event sequence used
// by the existing UI. Events are synthetic by design and never replace native
// mouse, keyboard or touch input.
export function createVirtualPointer() {
  let hoveredElement = null;
  let pressedElement = null;
  let pressedThreeScene = false;
  let lastPoint = { x: 0, y: 0 };

  function elementFor(target, x, y) {
    return target?.element || document.elementFromPoint(x, y) || null;
  }

  function emit(element, type, x, y, pressed = false, bubbles = true) {
    if (!element?.dispatchEvent) return;
    const common = {
      bubbles,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      button: 0,
      buttons: pressed ? 1 : 0,
    };
    try {
      element.dispatchEvent(new PointerEvent(type, {
        ...common,
        pointerId: 913,
        pointerType: 'mouse',
        isPrimary: true,
      }));
    } catch {
      // PointerEvent is unavailable in a few older browsers; mouse fallback is
      // emitted below for event types with an equivalent.
    }
  }

  function emitMouse(element, type, x, y, pressed = false, bubbles = true) {
    if (!element?.dispatchEvent) return;
    try {
      element.dispatchEvent(new MouseEvent(type, {
        bubbles,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        button: 0,
        buttons: pressed ? 1 : 0,
      }));
    } catch { /* Pointer events remain available. */ }
  }

  function move(target, x, y) {
    lastPoint = { x, y };
    const next = elementFor(target, x, y);
    if (next !== hoveredElement) {
      if (hoveredElement) {
        hoveredElement.classList?.remove('is-gesture-hover');
        emit(hoveredElement, 'pointerout', x, y, Boolean(pressedElement));
        emit(hoveredElement, 'pointerleave', x, y, Boolean(pressedElement), false);
        emitMouse(hoveredElement, 'mouseout', x, y, Boolean(pressedElement));
        emitMouse(hoveredElement, 'mouseleave', x, y, Boolean(pressedElement), false);
      }
      hoveredElement = next;
      if (hoveredElement) {
        hoveredElement.classList?.add('is-gesture-hover');
        emit(hoveredElement, 'pointerover', x, y, Boolean(pressedElement));
        emit(hoveredElement, 'pointerenter', x, y, Boolean(pressedElement), false);
        emitMouse(hoveredElement, 'mouseover', x, y, Boolean(pressedElement));
        emitMouse(hoveredElement, 'mouseenter', x, y, Boolean(pressedElement), false);
      }
    }
    if (hoveredElement) {
      emit(hoveredElement, 'pointermove', x, y, Boolean(pressedElement));
      emitMouse(hoveredElement, 'mousemove', x, y, Boolean(pressedElement));
    }
    return hoveredElement;
  }

  function down(target, x, y) {
    move(target, x, y);
    pressedElement = elementFor(target, x, y) || hoveredElement;
    if (!pressedElement) return null;
    pressedThreeScene = target?.layer === 'three_scene';
    pressedElement.classList?.add('is-gesture-pressed');
    // OrbitControls calls setPointerCapture() for pointerdown. Browsers reject
    // capture for synthetic pointers, so Three.js uses its registered gesture
    // drag/click adapter while DOM controls receive the full pointer sequence.
    if (!pressedThreeScene) emit(pressedElement, 'pointerdown', x, y, true);
    emitMouse(pressedElement, 'mousedown', x, y, true);
    return pressedElement;
  }

  function up(target, x, y) {
    const element = pressedElement || elementFor(target, x, y) || hoveredElement;
    if (!element) return null;
    if (!pressedThreeScene) emit(element, 'pointerup', x, y, false);
    emitMouse(element, 'mouseup', x, y, false);
    element.classList?.remove('is-gesture-pressed');
    pressedElement = null;
    pressedThreeScene = false;
    return element;
  }

  function cancel() {
    if (pressedElement) {
      if (!pressedThreeScene) emit(pressedElement, 'pointercancel', lastPoint.x, lastPoint.y, false);
      emitMouse(pressedElement, 'mouseup', lastPoint.x, lastPoint.y, false);
      pressedElement.classList?.remove('is-gesture-pressed');
    }
    hoveredElement?.classList?.remove('is-gesture-hover');
    pressedElement = null;
    pressedThreeScene = false;
    hoveredElement = null;
  }

  return { move, down, up, cancel, hovered: () => hoveredElement, pressed: () => pressedElement };
}
