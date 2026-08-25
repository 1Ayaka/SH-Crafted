const AUTOMATION_RE = /(?:帮我|替我|请你|小蕉).*(?:演示|操作|完成|做完).*(?:工作台|当前工序|这一步|本步)|(?:演示|自动完成|代我完成).*(?:当前工序|这一步|工作台)/;

export function isWorkbenchAutomationQuery(input) {
  return AUTOMATION_RE.test(String(input || '').replace(/\s+/g, ''));
}

function chooseRecommendedResources(step = {}) {
  const carried = new Set(step.carried_resources || []);
  const allowed = new Set(step.allowed_resources || []);
  const preset = (step.quick_fill_resources || []).filter((name) => allowed.has(name) && !carried.has(name));
  if (preset.length) return [...new Set(preset)];

  const selected = [];
  for (const group of step.resource_groups || []) {
    const options = (group.options || []).filter((name) => allowed.has(name));
    if (group.mode === 'all') {
      options.filter((name) => !carried.has(name)).forEach((name) => selected.push(name));
      continue;
    }
    const alreadyCarried = options.filter((name) => carried.has(name)).length;
    const needed = Math.max(0, Number(group.min || 0) - alreadyCarried);
    options.filter((name) => !carried.has(name)).slice(0, needed).forEach((name) => selected.push(name));
  }
  if (!selected.length && allowed.size && ![...allowed].some((name) => carried.has(name))) selected.push([...allowed][0]);
  return [...new Set(selected)];
}

export function planWorkbenchStep(snapshot = {}) {
  const step = snapshot.current_step;
  if (!step || ['finishing', 'completed'].includes(snapshot.phase)) {
    return { ok: false, reason: 'no_active_step', actions: [] };
  }
  if (!['reading', 'playing'].includes(snapshot.phase)) {
    return { ok: false, reason: 'workbench_unavailable', actions: [] };
  }

  const resources = chooseRecommendedResources(step);
  const actions = [];
  if (snapshot.phase === 'reading') {
    actions.push({ tool: 'enter_workbench', args: {}, label: '进入粒子工作台', target: 'workbench-enter' });
  }
  resources
    .filter((name) => !(snapshot.selected_resources || []).includes(name))
    .forEach((resourceName) => actions.push({
      tool: 'select_resource',
      args: { resource_name: resourceName },
      label: `放置${resourceName}`,
      target: `resource:${resourceName}`,
    }));
  actions.push({
    tool: 'select_craft_action',
    args: { action_id: step.action.id },
    label: `选择“${step.action.label}”`,
    target: `action:${step.action.id}`,
  });
  actions.push({
    tool: 'execute_craft_step',
    args: { expected_step_id: step.id },
    label: `执行“${step.name}”`,
    target: 'workbench-table',
  });
  actions.push({
    tool: 'verify_craft_step',
    args: { expected_step_id: step.id, previous_step_index: snapshot.step_index },
    label: '核验工序结果',
    target: 'workbench-table',
  });
  return {
    ok: true,
    goal: `完成当前工序“${step.name}”`,
    expected_step_id: step.id,
    expected_action: step.action,
    resources,
    actions,
  };
}

export function verifyWorkbenchTransition(before = {}, after = {}, expectedStepId = '') {
  const completed = after.last_completed_step_id === expectedStepId;
  const advanced = Number(after.step_index) > Number(before.step_index)
    || ['finishing', 'completed'].includes(after.phase);
  const failureStable = Number(after.failure_count || 0) <= Number(before.failure_count || 0);
  const ok = Boolean(expectedStepId && completed && advanced && failureStable);
  return {
    ok,
    expected_step_id: expectedStepId,
    observed_step_id: after.last_completed_step_id || null,
    advanced,
    failure_stable: failureStable,
    evidence: ok
      ? [`last_completed_step_id=${expectedStepId}`, `phase=${after.phase}`, `step_index=${after.step_index}`]
      : [`expected=${expectedStepId}`, `observed=${after.last_completed_step_id || 'none'}`, `phase=${after.phase}`],
  };
}

export function summarizeWorkbenchRun(plan, verification) {
  if (!plan?.ok) return '当前没有可执行的工序。';
  if (!verification?.ok) return `${plan.goal}没有通过结果核验，我已停止后续动作。`;
  const resources = plan.resources.length ? `使用了${plan.resources.join('、')}，` : '';
  return `${plan.goal}：${resources}执行了“${plan.expected_action.label}”，并通过工作台状态核验。`;
}
