import assert from 'node:assert/strict';

import { MAP_LOAD_POLICY, allocateOverviewMarkerBudget, compactMarkerCount, flatParticleCount, markerWeight, progressiveAnchorSlots } from '../js/map-load-policy.js';

for (const total of [1, 12, 13, 100, 10_000]) {
  const visible = compactMarkerCount(total);
  assert.ok(visible <= MAP_LOAD_POLICY.overviewMarkerLimit, '全景标记数必须有硬上限');
  const represented = Array.from({ length: visible }, (_, index) => markerWeight(total, index, visible))
    .reduce((sum, weight) => sum + weight, 0);
  assert.equal(represented, total, '折叠标记必须完整表示实际项目数量');
  assert.ok(flatParticleCount(total) <= MAP_LOAD_POLICY.flatParticleLimit, '平面墨点数必须有硬上限');
}

assert.equal(compactMarkerCount(0), 0);
assert.equal(flatParticleCount(0), 0);
assert.ok(MAP_LOAD_POLICY.focusAnchorBatch < MAP_LOAD_POLICY.focusAnchorLimit, '地区近景必须分批渲染');
const slots = progressiveAnchorSlots(MAP_LOAD_POLICY.focusAnchorLimit);
assert.equal(new Set(slots).size, MAP_LOAD_POLICY.focusAnchorLimit, '渐进锚点位置不得重复');
assert.equal(slots[0], 0, '首批锚点应从地区一侧开始铺开');
assert.equal(slots[MAP_LOAD_POLICY.focusAnchorBatch - 1], MAP_LOAD_POLICY.focusAnchorLimit - 1, '首批锚点应覆盖地区另一侧');
const denseDistricts = Array.from({ length: 16 }, (_, index) => ({ id: `district-${index}`, count: (index + 1) * 100 }));
const budget = allocateOverviewMarkerBudget(denseDistricts);
assert.ok([...budget.values()].every((count) => count >= 1 && count <= MAP_LOAD_POLICY.overviewMarkerLimit), '每个有项目地区应至少一个标记且不得超过局部上限');
assert.ok([...budget.values()].reduce((sum, count) => sum + count, 0) <= MAP_LOAD_POLICY.overviewMarkerBudget, '全景标记必须受全局预算约束');
assert.ok(budget.get('district-15') >= budget.get('district-0'), '高密度地区应获得不少于低密度地区的标记预算');

console.log(JSON.stringify({
  simulated_projects_per_district: 10_000,
  overview_marker_nodes: compactMarkerCount(10_000),
  global_overview_marker_budget: MAP_LOAD_POLICY.overviewMarkerBudget,
  flat_particle_nodes: flatParticleCount(10_000),
  initial_focus_canvases: MAP_LOAD_POLICY.focusAnchorBatch,
  maximum_focus_canvases: MAP_LOAD_POLICY.focusAnchorLimit,
}, null, 2));
