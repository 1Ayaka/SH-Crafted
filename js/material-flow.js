function materialName(value) {
  return String(value || '').trim();
}

export function materialTransformMap(step) {
  const map = new Map();
  for (const entry of (Array.isArray(step?.material_transforms) ? step.material_transforms : [])) {
    const inputName = materialName(entry?.input_name);
    if (!inputName || map.has(inputName)) continue;
    map.set(inputName, {
      input_name: inputName,
      output_name: materialName(entry?.output_name),
    });
  }
  // Legacy/source steps may not have persisted transforms yet. Materials listed
  // for the step still participate and continue under the same name by default.
  for (const rawName of (Array.isArray(step?.materials) ? step.materials : [])) {
    const inputName = materialName(rawName);
    if (inputName && !map.has(inputName)) {
      map.set(inputName, { input_name: inputName, output_name: inputName });
    }
  }
  return map;
}

// Simulates the named material inventory before a step. A transform means that
// the material participates in that step; no transform means it remains stored.
// This mirrors the workbench while keeping the persisted schema backward compatible.
export function materialInventoryBeforeStep(steps, targetIndex) {
  const inventory = [];
  const limit = Math.max(0, Math.min(Number(targetIndex) || 0, steps?.length || 0));

  for (let index = 0; index < limit; index += 1) {
    const step = steps[index] || {};
    for (const rawName of (Array.isArray(step.materials) ? step.materials : [])) {
      const name = materialName(rawName);
      if (name && !inventory.some((item) => item.currentName === name)) {
        inventory.push({
          id: `material:${step.id || step.step_id || index}:${name}`,
          currentName: name,
          originStepId: step.id || step.step_id || null,
        });
      }
    }

    const transforms = materialTransformMap(step);
    for (let itemIndex = inventory.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = inventory[itemIndex];
      const transform = transforms.get(item.currentName);
      if (!transform) continue;
      if (!transform.output_name) inventory.splice(itemIndex, 1);
      else item.currentName = transform.output_name;
    }
  }

  return inventory;
}

export function uniqueMaterialNames(items) {
  return [...new Set((items || []).map((item) => materialName(item?.currentName ?? item)).filter(Boolean))];
}
