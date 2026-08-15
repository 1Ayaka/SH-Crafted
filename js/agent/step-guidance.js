const STEP_GUIDANCE_PATTERN = /(?:下一步|接下来|然后|当前|这一步|本步|现在).{0,12}(?:材料|原料|工具|资源|怎么|怎样|该|要|需要|做|操作|开始|继续)|(?:我该|该从哪里|从哪里|从哪).{0,10}(?:做|开始|继续)/;

export function isCurrentStepGuidanceQuery(value) {
  return STEP_GUIDANCE_PATTERN.test(String(value || '').replace(/\s+/g, ''));
}

function resourceInstruction(group) {
  const options = [...new Set((group?.options || []).filter(Boolean))];
  if (!options.length) return '';
  const label = group.label || '资源';
  if (group.mode === 'all') return `${label}：${options.join('、')}`;
  const minimum = Math.max(1, Number(group.min) || 1);
  return `${label}任选 ${minimum} 项：${options.join('、')}`;
}

export function currentStepGuidance(craft, context = {}) {
  const steps = Array.isArray(craft?.steps) ? craft.steps : [];
  if (!steps.length || !context.current_step_id) return null;
  const index = steps.findIndex((step) => step.step_id === context.current_step_id);
  if (index < 0) return null;
  const step = steps[index];
  const rule = step.interactionRule || {};
  const resourceInstructions = (rule.resource_groups || []).map(resourceInstruction).filter(Boolean);
  const action = rule.correctAction?.label
    || (rule.actions || []).find((item) => item?.id === rule.action?.id)?.label
    || rule.action?.label
    || step.action
    || step.displayName;
  return {
    id: step.step_id,
    name: step.displayName || step.name || `工序 ${index + 1}`,
    number: index + 1,
    total: steps.length,
    action: String(action || ''),
    guide: String(step.guide_text || step.action || ''),
    result: String(step.result || ''),
    resourceInstructions,
    inventory: Array.isArray(context.inventory_states) ? context.inventory_states : [],
  };
}
