import {
  getGraphNode,
  graphPortals,
  relatedHeritageForRelation,
  relationLabel,
  graphNodes,
} from './agent/graph-adapter.js';

export function createHeritageGraphOverviewState(candidates = graphNodes()) {
  const heritage = candidates.filter((node) => node.type === 'heritage');
  // Every map project must be present in the overview. Graph-only supplements
  // remain discoverable through their factual region/tradition/material branch
  // instead of competing with map projects for a limited overview slot.
  const projects = heritage.filter((node) => node.content_role === 'map_project' || node.detail_available);
  const projectIds = new Set(projects.map((project) => project.id));
  const supplementPool = heritage.filter((node) => !projectIds.has(node.id));
  const links = [];
  const supplements = [];
  projects.forEach((main) => {
    const mainTerms = new Set([...(main.graph_data?.keywords || []), ...(main.graph_data?.relations || []).map((item) => item.title)].filter(Boolean));
    supplementPool.map((node) => {
      let score = node.district_id && node.district_id === main.district_id ? 3 : 0;
      const terms = [...(node.graph_data?.keywords || []), ...(node.graph_data?.relations || []).map((item) => item.title)].filter(Boolean);
      terms.forEach((term) => { if (mainTerms.has(term)) score += 2; });
      return { node, score };
    }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.node.title.localeCompare(b.node.title, 'zh-CN')).slice(0, 1).forEach(({ node }) => {
      if (supplements.length >= 12) return;
      if (!supplements.some((item) => item.id === node.id)) supplements.push(node);
      links.push({ from: main.id, to: node.id });
    });
  });
  return {
    mode: 'overview',
    root: null,
    initialRoot: null,
    selected: null,
    overviewNodes: [
      ...projects.map((node) => ({ ...node, overview_role: 'map-project' })),
      ...supplements.map((node) => ({ ...node, overview_role: 'graph-supplement' })),
    ],
    overviewLinks: links,
    branch: null,
    branchTarget: null,
    branchAllNodes: [],
    branchNodes: [],
    branchPage: 0,
    portals: [],
    path: [],
    rootHistory: [],
    previousNode: null,
    activeEdge: null,
  };
}

export function createHeritageGraphState(rootId) {
  const root = getGraphNode(rootId);
  return {
    mode: 'root',
    root: root || null,
    initialRoot: root || null,
    selected: root || null,
    branch: null,
    branchTarget: null,
    branchAllNodes: [],
    branchNodes: [],
    branchPage: 0,
    portals: root ? graphPortals(root.id) : [],
    path: root ? [root] : [],
    rootHistory: root ? [root] : [],
    previousNode: null,
    activeEdge: null,
  };
}

export function openGraphBranch(state, relation) {
  const portal = state.portals.find((item) => item.relation === relation);
  if (!portal?.available || !portal.target) return { ok: false, reason: 'not_available' };
  const branchNodes = relatedHeritageForRelation(portal.target.id, relation, { excludeId: state.root?.id });
  state.mode = 'branch';
  state.branch = relation;
  state.branchTarget = portal.target;
  state.selected = portal.target;
  state.branchAllNodes = branchNodes;
  state.branchPage = 0;
  state.branchNodes = branchNodes;
  state.previousNode = state.root;
  state.activeEdge = { relation, target: portal.target };
  state.path = [...state.rootHistory, portal.target];
  return { ok: true, target: portal.target, nodes: state.branchNodes };
}

export function selectGraphNode(state, node) {
  if (!node) return { ok: false, reason: 'missing_node' };
  if (state.selected?.id !== node.id) state.previousNode = state.selected;
  state.selected = node;
  return { ok: true, node };
}

export function setGraphRoot(state, node) {
  if (!node || node.type !== 'heritage') return { ok: false, reason: 'root_must_be_heritage' };
  state.mode = 'root';
  state.root = node;
  state.selected = node;
  state.branch = null;
  state.branchTarget = null;
  state.branchAllNodes = [];
  state.branchNodes = [];
  state.branchPage = 0;
  state.previousNode = null;
  state.activeEdge = null;
  state.portals = graphPortals(node.id);
  if (state.rootHistory.at(-1)?.id !== node.id) state.rootHistory.push(node);
  state.path = [...state.rootHistory];
  return { ok: true, node };
}

export function returnGraphRoot(state) {
  if (!state.root) return { ok: false, reason: 'missing_root' };
  state.mode = 'root';
  state.selected = state.root;
  state.branch = null;
  state.branchTarget = null;
  state.branchAllNodes = [];
  state.branchNodes = [];
  state.branchPage = 0;
  state.previousNode = null;
  state.activeEdge = null;
  state.portals = graphPortals(state.root.id);
  state.path = [...state.rootHistory];
  return { ok: true, node: state.root };
}

export function setGraphBranchPage(state, page) {
  if (state.mode !== 'branch') return { ok: false, reason: 'not_in_branch' };
  state.branchPage = 0;
  state.branchNodes = state.branchAllNodes;
  return { ok: true, page: 0, page_count: 1, nodes: state.branchNodes };
}

export function goBackGraphRoot(state) {
  if (state.mode === 'branch') return returnGraphRoot(state);
  if (state.rootHistory.length <= 1) return { ok: false, reason: 'at_initial_root' };
  state.rootHistory.pop();
  const previous = state.rootHistory.at(-1);
  state.root = previous;
  state.selected = previous;
  state.branch = null;
  state.branchTarget = null;
  state.branchAllNodes = [];
  state.branchNodes = [];
  state.branchPage = 0;
  state.previousNode = null;
  state.activeEdge = null;
  state.portals = graphPortals(previous.id);
  state.path = [...state.rootHistory];
  return { ok: true, node: previous };
}

export function returnInitialGraphRoot(state) {
  if (!state.initialRoot) return { ok: false, reason: 'missing_initial_root' };
  state.rootHistory = [state.initialRoot];
  state.root = state.initialRoot;
  state.selected = state.initialRoot;
  state.mode = 'root';
  state.branch = null;
  state.branchTarget = null;
  state.branchAllNodes = [];
  state.branchNodes = [];
  state.branchPage = 0;
  state.previousNode = null;
  state.activeEdge = null;
  state.portals = graphPortals(state.initialRoot.id);
  state.path = [state.initialRoot];
  return { ok: true, node: state.initialRoot };
}

export function graphStateContext(state) {
  const branchTotal = state.branchAllNodes?.length || state.branchNodes.length;
  const branchPageCount = 1;
  return {
    mode: state.mode,
    current_root: state.root,
    selected_node: state.selected,
    active_branch: state.branch,
    branch_target: state.branchTarget,
    visible_nodes: state.branchNodes,
    branch_total: branchTotal,
    branch_page: state.branchPage || 0,
    branch_page_count: branchPageCount,
    can_previous_page: false,
    can_next_page: false,
    breadcrumbs: state.path.map((node) => node.id),
    breadcrumb_nodes: state.path,
    initial_root: state.initialRoot,
    can_go_back: state.mode === 'branch' || state.rootHistory.length > 1,
    available_actions: ['get_current_context', 'search_graph', 'open_node', 'expand_branch', 'open_heritage_detail', 'go_back', 'return_to_root', 'read_summary'],
    relation_label: state.branch ? relationLabel(state.branch) : null,
    previous_node: state.previousNode || null,
    active_edge: state.activeEdge || null,
    relationship_summary: state.activeEdge?.target?.summary || '',
    comparison_summary: state.previousNode && state.selected && state.previousNode.id !== state.selected.id
      ? `当前节点“${state.selected.title}”与上一节点“${state.previousNode.title}”通过${state.branch ? relationLabel(state.branch) : '图谱关系'}相连；相同之处与差异仍需结合资料核对。`
      : '',
  };
}
