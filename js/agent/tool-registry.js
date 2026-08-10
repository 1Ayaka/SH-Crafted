import { buildAgentContext } from './context-builder.js';
import { expandGraphBranch, getGraphNode, heritageDetailTarget, isSupportedRelation, searchGraph } from './graph-adapter.js';

const relationEnum = ['LOCATED_IN', 'BELONGS_TO_TRADITION', 'USES_MATERIAL'];
const risk = { R0: 'R0', R1: 'R1', R2: 'R2', R3: 'R3' };

export const TOOL_SCHEMAS = Object.freeze({
  get_current_context: { type: 'object', additionalProperties: false, properties: {}, required: [] },
  search_graph: { type: 'object', additionalProperties: false, required: ['query'], properties: {
    query: { type: 'string', minLength: 1, maxLength: 120 },
    types: { type: 'array', items: { type: 'string', enum: ['heritage', 'region', 'tradition', 'material'] }, maxItems: 4 },
    limit: { type: 'integer', minimum: 1, maximum: 12 },
    scope: { type: 'string', enum: ['current_or_global', 'current', 'global'] },
  }},
  open_node: { type: 'object', additionalProperties: false, required: ['node_id'], properties: {
    node_id: { type: 'string', pattern: '^(heritage|region|tradition|material):[A-Za-z0-9_-]+$' },
    focus_camera: { type: 'boolean' }, open_summary: { type: 'boolean' },
  }},
  expand_branch: { type: 'object', additionalProperties: false, required: ['relation'], properties: {
    relation: { type: 'string', enum: relationEnum },
  }},
  set_root_node: { type: 'object', additionalProperties: false, required: ['node_id'], properties: {
    node_id: { type: 'string', pattern: '^heritage:[A-Za-z0-9_-]+$' }, preserve_history: { type: 'boolean' },
  }},
  open_heritage_detail: { type: 'object', additionalProperties: false, required: ['heritage_id'], properties: {
    heritage_id: { type: 'string', pattern: '^heritage:[A-Za-z0-9_-]+$' },
    section: { type: 'string', enum: ['overview', 'process', 'materials', 'inheritors', 'sources', 'graph'] },
  }},
  open_region: { type: 'object', additionalProperties: false, required: ['region_id'], properties: {
    region_id: { type: 'string', pattern: '^region:[A-Za-z0-9_-]+$' },
  }},
  open_source: { type: 'object', additionalProperties: false, required: ['source_id'], properties: {
    source_id: { type: 'string', minLength: 1, maxLength: 160 },
  }},
  go_back: { type: 'object', additionalProperties: false, properties: {}, required: [] },
  return_to_root: { type: 'object', additionalProperties: false, properties: {}, required: [] },
  focus_model: { type: 'object', additionalProperties: false, properties: {}, required: [] },
  read_summary: { type: 'object', additionalProperties: false, required: ['target_id'], properties: {
    target_id: { type: 'string', pattern: '^(heritage|region|tradition|material):[A-Za-z0-9_-]+$' },
    content: { type: 'string', enum: ['summary', 'relation', 'source'] },
    max_seconds: { type: 'integer', minimum: 5, maximum: 35 },
  }},
  stop_speaking: { type: 'object', additionalProperties: false, properties: {}, required: [] },
  set_voice_preferences: { type: 'object', additionalProperties: false, properties: {
    wake_enabled: { type: 'boolean' }, tts_enabled: { type: 'boolean' },
    speech_rate: { type: 'number', minimum: 0.6, maximum: 1.4 },
    prompt_sound: { type: 'boolean' }, continuous_seconds: { type: 'integer', minimum: 15, maximum: 30 },
  }},
  show_help: { type: 'object', additionalProperties: false, properties: {}, required: [] },
});

const META = Object.freeze({
  get_current_context: { description: '读取当前站内页面与图谱上下文', risk: risk.R0, confirm: false },
  search_graph: { description: '检索已存在的非遗图谱节点', risk: risk.R0, confirm: false },
  open_node: { description: '打开已经验证的站内图谱节点', risk: risk.R1, confirm: false },
  expand_branch: { description: '展开三个固定图谱分支之一', risk: risk.R1, confirm: false },
  set_root_node: { description: '把已选非遗项目设为探索根节点', risk: risk.R1, confirm: false },
  open_heritage_detail: { description: '打开非遗项目详情页', risk: risk.R1, confirm: false },
  open_region: { description: '打开地区探索页', risk: risk.R1, confirm: false },
  open_source: { description: '在确认后打开可信来源', risk: risk.R2, confirm: true },
  go_back: { description: '返回内部探索路径上一步', risk: risk.R1, confirm: false },
  return_to_root: { description: '返回本次探索的初始项目', risk: risk.R1, confirm: false },
  focus_model: { description: '把镜头移回当前完成品', risk: risk.R1, confirm: false },
  read_summary: { description: '朗读当前节点的短摘要', risk: risk.R0, confirm: false },
  stop_speaking: { description: '立即停止朗读', risk: risk.R0, confirm: false },
  set_voice_preferences: { description: '调整本地语音偏好', risk: risk.R2, confirm: false },
  show_help: { description: '显示当前页面可执行操作', risk: risk.R0, confirm: false },
});

function fail(code, message, details = {}) {
  return { ok: false, error: { code, message, ...details } };
}

function typeMatches(value, type) {
  if (type === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function validateValue(value, schema, path) {
  if (!typeMatches(value, schema.type)) return `${path} 类型不正确。`;
  if (schema.enum && !schema.enum.includes(value)) return `${path} 不是允许的枚举值。`;
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) return `${path} 不能为空。`;
    if (schema.maxLength != null && value.length > schema.maxLength) return `${path} 超出长度限制。`;
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return `${path} 格式不正确。`;
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) return `${path} 小于允许范围。`;
    if (schema.maximum != null && value > schema.maximum) return `${path} 大于允许范围。`;
  }
  if (Array.isArray(value)) {
    if (schema.maxItems != null && value.length > schema.maxItems) return `${path} 项数过多。`;
    for (const [index, item] of value.entries()) { const error = validateValue(item, schema.items, `${path}[${index}]`); if (error) return error; }
  }
  return '';
}

function validate(name, args) {
  const schema = TOOL_SCHEMAS[name];
  if (!schema || !args || typeof args !== 'object' || Array.isArray(args)) return fail('invalid_arguments', '工具参数不是对象。');
  for (const key of Object.keys(args)) if (!(key in schema.properties)) return fail('invalid_arguments', `不接受参数：${key}。`);
  for (const key of schema.required) if (!(key in args)) return fail('missing_argument', `缺少参数：${key}。`);
  if (name === 'expand_branch' && !isSupportedRelation(args.relation)) return fail('relation_not_allowed', '只能展开位于、属于传统、使用材料三个分支。');
  for (const [key, value] of Object.entries(args)) {
    const message = validateValue(value, schema.properties[key], key);
    if (message) return fail('invalid_arguments', message);
  }
  if (name.includes('node') || name === 'read_summary') {
    if (typeof args.node_id === 'string' && !getGraphNode(args.node_id)) return fail('node_not_found', '没有找到这个公开节点。');
    if (typeof args.target_id === 'string' && !getGraphNode(args.target_id)) return fail('node_not_found', '没有找到这个公开节点。');
  }
  if (name === 'open_heritage_detail' && !heritageDetailTarget(args.heritage_id)) return fail('node_not_found', '这个关系节点暂时没有对应的非遗详情页。');
  if (name === 'open_region' && !getGraphNode(args.region_id)) return fail('node_not_found', '没有找到这个地区节点。');
  return null;
}

export function createToolRegistry({ getContext, host = {}, voice = {} } = {}) {
  const registry = new Map();
  const context = () => buildAgentContext(getContext?.() || {}, voice.state?.() || 'DISABLED');
  const executeHost = async (method, args) => {
    if (typeof host[method] !== 'function') return fail('host_unavailable', '当前页面还不支持这项站内操作。');
    try { return await host[method](args); } catch (error) { return fail(error.code || 'execution_failed', error.message || '操作暂时失败。'); }
  };

  const add = (name, handler) => registry.set(name, { name, schema: TOOL_SCHEMAS[name], ...META[name], handler });
  add('get_current_context', async () => ({ ok: true, context: context() }));
  add('search_graph', async (args) => ({ ok: true, query: args.query, results: searchGraph(args.query, args) }));
  add('open_node', async (args) => executeHost('openNode', args));
  add('expand_branch', async (args) => {
    const current = context().current_root?.id || context().selected_node?.id;
    const result = expandGraphBranch(current, args.relation);
    if (result.error) return fail(result.error, '这条关系不在允许范围内。');
    if (!result.count) return { ok: true, ...result, message: '当前资料中没有找到这条关系。' };
    const hostResult = await executeHost('expandBranch', { ...args, result });
    return hostResult.ok === false ? hostResult : { ok: true, ...result, ...hostResult };
  });
  add('set_root_node', async (args) => executeHost('setRootNode', args));
  add('open_heritage_detail', async (args) => executeHost('openHeritageDetail', args));
  add('open_region', async (args) => executeHost('openRegion', args));
  add('open_source', async (args) => executeHost('openSource', args));
  add('go_back', async () => executeHost('goBack', {}));
  add('return_to_root', async () => executeHost('returnToRoot', {}));
  add('focus_model', async () => executeHost('focusModel', {}));
  add('read_summary', async (args) => executeHost('readSummary', args));
  add('stop_speaking', async () => executeHost('stopSpeaking', {}));
  add('set_voice_preferences', async (args) => executeHost('setVoicePreferences', args));
  add('show_help', async () => executeHost('showHelp', { context: context() }));

  return {
    list: () => [...registry.values()].map(({ handler, ...tool }) => tool),
    get: (name) => registry.get(name),
    async execute(name, args = {}) {
      const tool = registry.get(name);
      if (!tool) return fail('tool_not_registered', '这个操作不在允许范围内。');
      const invalid = validate(name, args);
      if (invalid) return invalid;
      const result = await tool.handler(args);
      return { request_id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, tool_name: name, ...result };
    },
  };
}
