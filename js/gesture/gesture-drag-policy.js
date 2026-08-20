// Scene-local gesture capability checks. Keeping this separate from the DOM
// event router makes the map exception explicit and independently testable.
export function shouldBeginDirectPalmDrag(target) {
  return target?.allowDirectPalmDrag !== false;
}
