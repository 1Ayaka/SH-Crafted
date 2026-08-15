import assert from 'node:assert/strict';
import { createHeritageGraphOverviewState, createHeritageGraphState, goBackGraphRoot, graphStateContext, openGraphBranch, returnGraphRoot, returnInitialGraphRoot, selectGraphNode, setGraphBranchPage, setGraphRoot } from '../js/heritage-graph.js';

const root = { id: 'heritage:root', type: 'heritage', title: '根项目' };
const region = { id: 'region:demo', type: 'region', title: '示例地区' };
const related = { id: 'heritage:related', type: 'heritage', title: '关联项目' };
const state = {
  mode: 'root', root, initialRoot: root, selected: root, branch: null, branchTarget: null,
  branchNodes: [], portals: [{ relation: 'LOCATED_IN', label: '位于', target: region, available: true }], path: [root], rootHistory: [root],
};

assert.equal(openGraphBranch(state, 'BELONGS_TO_TRADITION').ok, false, '未接入的关系不能展开');
assert.equal(selectGraphNode(state, related).node, related, '可见节点可以被选中');
assert.equal(setGraphRoot(state, related).ok, true, '非遗项目可以成为新的根节点');
assert.equal(state.root.id, related.id);
assert.equal(goBackGraphRoot(state).node.id, root.id, '切换根节点后可以回到上一步');
setGraphRoot(state, related);
assert.equal(returnInitialGraphRoot(state).node.id, root.id, '可以返回最初完成品');
state.root = root;
state.rootHistory = [root];
state.portals = [{ relation: 'LOCATED_IN', label: '位于', target: region, available: true }];
assert.equal(openGraphBranch(state, 'LOCATED_IN').ok, true, '已核验地区关系可以展开');
assert.equal(state.branchTarget.id, region.id);
assert.equal(graphStateContext(state).active_branch, 'LOCATED_IN');
assert.equal(setGraphBranchPage(state, 1).page, 0, '分支不再分页');
assert.equal(returnGraphRoot(state).ok, true, '可以返回当前完成品根节点');
assert.equal(state.mode, 'root');

const overview = createHeritageGraphOverviewState([
  { id: 'heritage:map-primary', type: 'heritage', title: '原地图项目', content_role: 'map_project', detail_available: true, heritage_level: 'primary', district_id: 'a' },
  { id: 'heritage:map-secondary', type: 'heritage', title: '新增地图项目', content_role: 'map_project', detail_available: true, heritage_level: 'secondary', district_id: 'b' },
  { id: 'heritage:map-empty', type: 'heritage', title: '无关键词地图项目', content_role: 'map_project', detail_available: true, heritage_level: 'secondary' },
  { id: 'heritage:supplement', type: 'heritage', title: '星图补充资料', content_role: 'graph_supplement', detail_available: false, district_id: 'a' },
]);
const overviewProjects = overview.overviewNodes.filter((node) => node.overview_role === 'map-project');
assert.deepEqual(
  overviewProjects.map((node) => node.id),
  ['heritage:map-primary', 'heritage:map-secondary', 'heritage:map-empty'],
  '所有地图项目都必须进入星图总览，不能按等级、关键词或关系完整度抽样',
);
assert.equal(overview.overviewNodes.find((node) => node.id === 'heritage:supplement')?.overview_role, 'graph-supplement');
console.log('heritage graph state tests passed');
