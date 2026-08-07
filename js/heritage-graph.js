import {
  getGraphNode,
  graphPortals,
  relatedHeritageForRelation,
  relationLabel,
  graphNodes,
} from './agent/graph-adapter.js';

export function createHeritageGraphOverviewState() {
  const heritage = graphNodes().filter((node) => node.type === 'heritage');
  const primary = heritage.filter((node) => node.heritage_level === 'primary').slice(0, 10);
  const secondaryPool = heritage.filter((node) => node.heritage_level !== 'primary');
  const links = [];
  const secondary = [];
  primary.forEach((main) => {
    const mainTerms = new Set([...(main.graph_data?.keywords || []), ...(main.graph_data?.relations || []).map((item) => item.title)].filter(Boolean));
    secondaryPool.map((node) => {
      let score = node.district_id && node.district_id === main.district_id ? 3 : 0;
      const terms = [...(node.graph_data?.keywords || []), ...(node.graph_data?.relations || []).map((item) => item.title)].filter(Boolean);
      terms.forEach((term) => { if (mainTerms.has(term)) score += 2; });
      return { node, score };
    }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.node.title.localeCompare(b.node.title, 'zh-CN')).slice(0, 2).forEach(({ node }) => {
      if (!secondary.some((item) => item.id === node.id)) secondary.push(node);
      links.push({ from: main.id, to: node.id });
    });
  });
  return {
    mode: 'overview',
    root: null,
    initialRoot: null,
    selected: null,
    overviewNodes: [...primary.map((node) => ({ ...node, overview_role: 'primary' })), ...secondary.map((node) => ({ ...node, overview_role: 'secondary' }))],
    overviewLinks: links,
    branch: null,
    branchTarget: null,
    branchAllNodes: [],
    branchNodes: [],
    branchPage: 0,
    portals: [],
    path: [],
    rootHistory: [],
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
  state.branchNodes = branchNodes.slice(0, 10);
  state.path = [...state.rootHistory, portal.target];
  return { ok: true, target: portal.target, nodes: state.branchNodes };
}

export function selectGraphNode(state, node) {
  if (!node) return { ok: false, reason: 'missing_node' };
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
  state.portals = graphPortals(state.root.id);
  state.path = [...state.rootHistory];
  return { ok: true, node: state.root };
}

export function setGraphBranchPage(state, page) {
  if (state.mode !== 'branch') return { ok: false, reason: 'not_in_branch' };
  const pageCount = Math.max(1, Math.ceil(state.branchAllNodes.length / 10));
  const nextPage = Math.min(Math.max(Number(page) || 0, 0), pageCount - 1);
  state.branchPage = nextPage;
  state.branchNodes = state.branchAllNodes.slice(nextPage * 10, nextPage * 10 + 10);
  state.selected = state.branchTarget;
  return { ok: true, page: nextPage, page_count: pageCount, nodes: state.branchNodes };
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
  state.portals = graphPortals(state.initialRoot.id);
  state.path = [state.initialRoot];
  return { ok: true, node: state.initialRoot };
}

export function graphStateContext(state) {
  const branchTotal = state.branchAllNodes?.length || state.branchNodes.length;
  const branchPageCount = Math.max(1, Math.ceil(branchTotal / 10));
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
    can_previous_page: state.mode === 'branch' && state.branchPage > 0,
    can_next_page: state.mode === 'branch' && state.branchPage + 1 < branchPageCount,
    breadcrumbs: state.path.map((node) => node.id),
    breadcrumb_nodes: state.path,
    initial_root: state.initialRoot,
    can_go_back: state.mode === 'branch' || state.rootHistory.length > 1,
    available_actions: ['get_current_context', 'search_graph', 'open_node', 'expand_branch', 'open_heritage_detail', 'go_back', 'return_to_root', 'read_summary'],
    relation_label: state.branch ? relationLabel(state.branch) : null,
  };
}
