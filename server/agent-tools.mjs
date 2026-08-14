const EMPTY = { type: 'object', additionalProperties: false, properties: {}, required: [] };

export const AGENT_CLIENT_TOOLS = Object.freeze([
  {
    name: 'get_current_context',
    description: '读取用户当前所在页面、选中的非遗或图谱节点以及可见内容。遇到“这个、下一步、刚才”等指代时优先调用。',
    parameters: EMPTY,
  },
  {
    name: 'search_graph',
    description: '在站内已公开的非遗知识图谱中检索项目、地区、传统或材料。需要先找到准确节点 ID 时调用。',
    parameters: { type: 'object', additionalProperties: false, required: ['query'], properties: {
      query: { type: 'string', description: '简短的检索词' },
      types: { type: 'array', items: { type: 'string', enum: ['heritage', 'region', 'tradition', 'material'] } },
      limit: { type: 'integer', minimum: 1, maximum: 8 },
      scope: { type: 'string', enum: ['current_or_global', 'current', 'global'] },
    } },
  },
  {
    name: 'open_node',
    description: '打开一个已经检索确认的站内知识星图节点。不得猜测节点 ID。',
    parameters: { type: 'object', additionalProperties: false, required: ['node_id'], properties: {
      node_id: { type: 'string', pattern: '^(heritage|region|tradition|material):[A-Za-z0-9_-]+$' },
      focus_camera: { type: 'boolean' }, open_summary: { type: 'boolean' },
    } },
  },
  {
    name: 'open_heritage_detail',
    description: '打开一个已确认存在详情页的非遗项目。不得猜测项目 ID；不确定时先 search_graph。',
    parameters: { type: 'object', additionalProperties: false, required: ['heritage_id'], properties: {
      heritage_id: { type: 'string', pattern: '^heritage:[A-Za-z0-9_-]+$' },
      section: { type: 'string', enum: ['overview', 'process', 'materials', 'inheritors', 'sources', 'graph'] },
    } },
  },
  {
    name: 'open_region',
    description: '打开一个已确认存在的上海地区探索页。',
    parameters: { type: 'object', additionalProperties: false, required: ['region_id'], properties: {
      region_id: { type: 'string', pattern: '^region:[A-Za-z0-9_-]+$' },
    } },
  },
  {
    name: 'expand_branch',
    description: '在当前知识星图中展开地区、传统或材料关系分支。',
    parameters: { type: 'object', additionalProperties: false, required: ['relation'], properties: {
      relation: { type: 'string', enum: ['LOCATED_IN', 'BELONGS_TO_TRADITION', 'USES_MATERIAL'] },
    } },
  },
  { name: 'go_back', description: '返回用户站内探索路径的上一步。', parameters: EMPTY },
  { name: 'return_to_root', description: '回到本次知识星图探索的根节点。', parameters: EMPTY },
  { name: 'focus_model', description: '把工作台镜头移回当前完成品。', parameters: EMPTY },
  {
    name: 'read_summary', description: '朗读当前或指定公开节点的摘要。',
    parameters: { type: 'object', additionalProperties: false, required: ['target_id'], properties: {
      target_id: { type: 'string', pattern: '^(heritage|region|tradition|material):[A-Za-z0-9_-]+$' },
      content: { type: 'string', enum: ['summary', 'relation', 'source'] },
      max_seconds: { type: 'integer', minimum: 5, maximum: 35 },
    } },
  },
  { name: 'stop_speaking', description: '立即停止小蕉的语音朗读。', parameters: EMPTY },
  { name: 'show_help', description: '显示当前页面可用的交互和智能体能力。', parameters: EMPTY },
]);

const byName = new Map(AGENT_CLIENT_TOOLS.map((tool) => [tool.name, tool]));

export function modelTools(requestedNames = []) {
  const requested = new Set(Array.isArray(requestedNames) ? requestedNames : []);
  return AGENT_CLIENT_TOOLS
    .filter((tool) => !requested.size || requested.has(tool.name))
    .map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
}

export function normalizeToolCalls(value, max = 3) {
  return (Array.isArray(value) ? value : []).slice(0, max).map((call, index) => {
    const name = String(call?.function?.name || '');
    if (!byName.has(name)) return null;
    let args;
    try { args = JSON.parse(call.function.arguments || '{}'); } catch { return null; }
    if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
    return { id: String(call.id || `tool_call_${index + 1}`), name, arguments: args };
  }).filter(Boolean);
}

export function toolResultMessages(calls = [], results = []) {
  return calls.map((call, index) => ({
    role: 'tool', tool_call_id: call.id,
    content: JSON.stringify(results[index] || { ok: false, error: { code: 'missing_result' } }).slice(0, 6000),
  }));
}

