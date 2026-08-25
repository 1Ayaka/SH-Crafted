import assert from 'node:assert/strict';
import { createToolRegistry } from '../js/agent/tool-registry.js';
import {
  isWorkbenchAutomationQuery,
  planWorkbenchStep,
  summarizeWorkbenchRun,
  verifyWorkbenchTransition,
} from '../js/agent/workbench-orchestrator.js';
import { buildContentSeed } from './content-seed.mjs';

const before = {
  phase: 'reading', step_index: 0, step_total: 3, selected_resources: [], failure_count: 0,
  current_step: {
    id: 'step-carve', name: '雕刻', allowed_resources: ['竹片', '刻刀'], carried_resources: [],
    quick_fill_resources: ['竹片', '刻刀'],
    resource_groups: [
      { label: '材料', mode: 'all', min: 1, options: ['竹片'] },
      { label: '工具', mode: 'all', min: 1, options: ['刻刀'] },
    ],
    action: { id: 'carve', label: '沿纹样雕刻' },
  },
};

assert.equal(isWorkbenchAutomationQuery('小蕉，帮我演示当前工序'), true);
assert.equal(isWorkbenchAutomationQuery('这一步怎么做'), false, '普通讲解问题不能误触自动操作');
const plan = planWorkbenchStep(before);
assert.equal(plan.ok, true);
assert.deepEqual(plan.actions.map((item) => item.tool), [
  'enter_workbench', 'select_resource', 'select_resource', 'select_craft_action', 'execute_craft_step', 'verify_craft_step',
]);
assert.deepEqual(plan.resources, ['竹片', '刻刀']);

const after = { phase: 'playing', step_index: 1, failure_count: 0, last_completed_step_id: 'step-carve' };
const verified = verifyWorkbenchTransition(before, after, 'step-carve');
assert.equal(verified.ok, true);
assert.match(summarizeWorkbenchRun(plan, verified), /竹片、刻刀/);
assert.equal(verifyWorkbenchTransition(before, { ...after, last_completed_step_id: 'wrong' }, 'step-carve').ok, false);

const calls = [];
const host = {
  inspectWorkbench: async () => ({ ok: true, snapshot: before }),
  enterWorkbench: async () => ({ ok: true }),
  selectResource: async (args) => { calls.push(['resource', args.resource_name]); return { ok: true }; },
  selectCraftAction: async (args) => { calls.push(['action', args.action_id]); return { ok: true }; },
  executeCraftStep: async () => ({ ok: true, completed_step_id: 'step-carve' }),
  verifyCraftStep: async () => ({ ok: true, verification: verified }),
};
const registry = createToolRegistry({ getContext: () => ({ page_type: 'heritage_detail' }), host });
assert.equal((await registry.execute('inspect_workbench', {})).ok, true);
assert.equal((await registry.execute('select_resource', { resource_name: '' })).error.code, 'invalid_arguments');
assert.equal((await registry.execute('select_resource', { resource_name: '竹片', extra: true })).error.code, 'invalid_arguments');
assert.equal((await registry.execute('select_resource', { resource_name: '竹片' })).ok, true);
assert.equal((await registry.execute('select_craft_action', { action_id: 'carve' })).ok, true);
assert.deepEqual(calls, [['resource', '竹片'], ['action', 'carve']]);

const seed = await buildContentSeed();
const projectIds = new Set();
for (const step of seed.craft_steps) {
  const groups = step.resource_groups || [
    ...(step.materials?.length ? [{ label: '所需材料', mode: 'any', min: 1, options: step.materials }] : []),
    ...(step.tools?.length ? [{ label: '所需工具', mode: 'any', min: 1, options: step.tools }] : []),
  ];
  const allowedResources = [...new Set(groups.flatMap((group) => group.options || []))];
  const action = (step.actions || []).find((item) => item.id === step.correct_action_id) || step.actions?.[0];
  const planned = planWorkbenchStep({
    phase: 'playing', step_index: Math.max(0, Number(step.sort || 1) - 1), selected_resources: [], failure_count: 0,
    current_step: {
      id: step.id, name: step.name || action?.label || step.id, allowed_resources: allowedResources,
      carried_resources: [], quick_fill_resources: step.quick_fill?.resources || [], resource_groups: groups,
      action,
    },
  });
  assert.equal(planned.ok, true, `${step.craft_id}/${step.id} 无法生成通用执行计划`);
  assert.equal(planned.actions.at(-2)?.tool, 'execute_craft_step', `${step.id} 缺少执行动作`);
  assert.equal(planned.actions.at(-1)?.tool, 'verify_craft_step', `${step.id} 缺少结果核验`);
  assert.ok(planned.resources.every((name) => allowedResources.includes(name)), `${step.id} 选择了规则外资源`);
  projectIds.add(step.craft_id);
}
assert.equal(projectIds.size, 8, '通用规划测试未覆盖全部 8 个核心非遗项目');
assert.equal(seed.craft_steps.length, 38, '通用规划测试未覆盖全部核心工序');

console.log(`工作台智能体规划、工具契约与验证器测试：通过（${projectIds.size} 个项目，${seed.craft_steps.length} 道工序）`);
