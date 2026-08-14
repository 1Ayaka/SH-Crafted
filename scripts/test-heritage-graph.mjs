import assert from 'node:assert/strict';
import { createHeritageGraphState, goBackGraphRoot, graphStateContext, openGraphBranch, returnGraphRoot, returnInitialGraphRoot, selectGraphNode, setGraphBranchPage, setGraphRoot } from '../js/heritage-graph.js';
import { graphNeighborhood, graphNodes, graphPortals, heritageForGraphTarget, relatedHeritageForRelation } from '../js/agent/graph-adapter.js';
import { CURATED_GRAPH_EDGES, CURATED_GRAPH_NODES, GRAPH_PROJECT_MINIMUMS } from '../js/graph-curated-catalog.js';

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
assert.equal(returnGraphRoot(state).ok, true, '可以返回当前完成品根节点');
assert.equal(state.mode, 'root');

const qibaoPortals = graphPortals('heritage:SHIH_0007');
assert.deepEqual(qibaoPortals.map((portal) => portal.relation), ['LOCATED_IN', 'BELONGS_TO_TRADITION', 'USES_MATERIAL']);
assert.ok(qibaoPortals.every((portal) => portal.available && portal.target), '七宝皮影三条入口都应有已核验目标');
const shadowPortal = qibaoPortals.find((portal) => portal.relation === 'BELONGS_TO_TRADITION');
const shadowLeaves = relatedHeritageForRelation(shadowPortal.target.id, shadowPortal.relation, { excludeId: 'heritage:SHIH_0007' });
assert.ok(!shadowLeaves.some((node) => node.id === 'heritage:tangshan_shadow'), '未进入地图项目库的静态扩展项目不应单独出现在星图');
const qibaoState = createHeritageGraphState('heritage:SHIH_0007');
assert.equal(openGraphBranch(qibaoState, 'LOCATED_IN').ok, true);
assert.ok(qibaoState.branchAllNodes.every((node) => node.detail_available), '地区分支不得混入地图项目库之外的静态项目');
assert.equal(setGraphBranchPage(qibaoState, 1).page, 0, '分支不再分页');
assert.equal(qibaoState.branchNodes.length, qibaoState.branchAllNodes.length, '分支节点全部可见');

const coverage = {};
for (const rootId of GRAPH_PROJECT_MINIMUMS) coverage[rootId] = graphNeighborhood(rootId).length;
assert.ok(graphNodes().filter((node) => node.type === 'heritage').every((node) => node.detail_available), '星图中的非遗项目必须都能在地图/详情项目库中打开');
assert.equal(new Set(CURATED_GRAPH_NODES.map((node) => node.id)).size, CURATED_GRAPH_NODES.length, '扩展目录不得包含重复节点 ID');
assert.ok(CURATED_GRAPH_NODES.every((node) => node.source_ids?.length && node.source_title), '扩展目录节点必须有来源');
assert.ok(CURATED_GRAPH_EDGES.every((edge) => edge.source_id && edge.source_title), '扩展目录关系必须有来源');
assert.ok(heritageForGraphTarget('material:ivory').nodes.some((node) => node.id === 'heritage:SHIH_0004'), '象牙材料节点应能反向定位到真实非遗项目');

console.log('heritage graph state tests passed', coverage);
