import assert from 'node:assert/strict';
import { createHeritageGraphState, goBackGraphRoot, graphStateContext, openGraphBranch, returnGraphRoot, returnInitialGraphRoot, selectGraphNode, setGraphBranchPage, setGraphRoot } from '../js/heritage-graph.js';
import { graphNeighborhood, graphPortals, heritageForGraphTarget, relatedHeritageForRelation } from '../js/agent/graph-adapter.js';
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
assert.ok(shadowLeaves.some((node) => node.id === 'heritage:tangshan_shadow'), '皮影传统分支应包含唐山皮影戏');
const qibaoState = createHeritageGraphState('heritage:SHIH_0007');
assert.equal(openGraphBranch(qibaoState, 'LOCATED_IN').ok, true);
assert.ok(qibaoState.branchAllNodes.length > 10, '闵行地区分支应支持多组节点');
assert.equal(setGraphBranchPage(qibaoState, 1).page, 1, '可以浏览下一组节点');
assert.ok(qibaoState.branchNodes.length > 0 && qibaoState.branchNodes.length <= 10);

const coverage = {};
for (const rootId of GRAPH_PROJECT_MINIMUMS) {
  const neighborhood = graphNeighborhood(rootId);
  coverage[rootId] = neighborhood.length;
  assert.ok(neighborhood.length >= 24, `${rootId} 至少应接入 24 个一跳可探索节点，当前 ${neighborhood.length}`);
}
assert.equal(new Set(CURATED_GRAPH_NODES.map((node) => node.id)).size, CURATED_GRAPH_NODES.length, '扩展目录不得包含重复节点 ID');
assert.ok(CURATED_GRAPH_NODES.every((node) => node.source_ids?.length && node.source_title), '扩展目录节点必须有来源');
assert.ok(CURATED_GRAPH_EDGES.every((edge) => edge.source_id && edge.source_title), '扩展目录关系必须有来源');
assert.ok(heritageForGraphTarget('material:ivory').nodes.some((node) => node.id === 'heritage:SHIH_0004'), '象牙材料节点应能反向定位到真实非遗项目');

console.log('heritage graph state tests passed', coverage);
