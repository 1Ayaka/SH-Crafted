import assert from 'node:assert/strict';
import { createToolRegistry } from '../js/agent/tool-registry.js';
import { createVoiceStateMachine, VOICE_STATES } from '../js/voice/voice-state-machine.js';
import { resolveIntent } from '../js/agent/intent-resolver.js';
import { graphIndexStats, heritageDetailTarget, heritageForGraphTarget, searchGraph } from '../js/agent/graph-adapter.js';
import { sanitizeAgentText } from '../js/agent/response-sanitizer.js';

globalThis.document = { documentElement: { lang: 'zh-CN' } };
globalThis.location = { hash: '#/explore' };

const registry = createToolRegistry({ getContext: () => ({ route: '/explore', page_type: 'explore' }) });
assert.equal((await registry.execute('not_registered', {})).error.code, 'tool_not_registered');
assert.equal((await registry.execute('expand_branch', { relation: 'MAKES_UP' })).error.code, 'relation_not_allowed');
assert.equal((await registry.execute('search_graph', { query: '七宝', extra: true })).error.code, 'invalid_arguments');
assert.equal((await registry.execute('search_graph', { query: '七宝', limit: '3' })).error.code, 'invalid_arguments');
assert.equal((await registry.execute('open_node', { node_id: 'heritage:missing' })).error.code, 'node_not_found');
assert.equal((await registry.execute('get_current_context')).ok, true);
const bambooResults = searchGraph('竹子', { limit: 8 });
assert.equal(bambooResults.some((node) => node.id === 'material:bamboo'), true);
const initialGraphIndex = graphIndexStats();
for (let index = 0; index < 100; index += 1) searchGraph(index % 2 ? '竹子' : '牙雕', { limit: 8 });
const repeatedGraphIndex = graphIndexStats();
assert.equal(repeatedGraphIndex.builds, initialGraphIndex.builds, '重复检索不应重建图谱索引');
for (const title of ['嘉定竹刻', '南桥撕纸', '药斑布', '象牙篾丝编织', '崇明土布', '月份牌年画', '七宝皮影戏', '毛氏风筝']) {
  assert.equal(searchGraph(title, { types: ['heritage'], limit: 4 }).some((node) => node.type === 'heritage'), true, `${title} 未命中非遗节点`);
}
assert.equal(heritageDetailTarget('heritage:SHIH_0002'), 'SHIH_0002', '南桥撕纸图谱节点应稳定映射到项目详情');
assert.equal(heritageDetailTarget('heritage:related_foam_paper_print'), null, '只有关系资料的节点不应伪装成项目详情');
assert.equal(
  sanitizeAgentText('它不用剪刀【ev_SHIH_0002_0480000_0674000】。（资料）（资料）。'),
  '它不用剪刀。（资料）。',
  '回答中不应暴露内部证据编号或重复资料标记',
);
const bambooHeritage = heritageForGraphTarget('material:bamboo').nodes;
assert.equal(bambooHeritage.some((node) => node.type === 'heritage'), true);
assert.equal(bambooHeritage.some((node) => /竹刻|风筝/.test(node.title)), true);
assert.equal(resolveIntent('竹子', { visible_nodes: [] }), null);
assert.equal(resolveIntent('打开竹材', { visible_nodes: [] }).name, 'open_node');
let openedNode = null;
const navigationRegistry = createToolRegistry({
  getContext: () => ({ route: '/craft/SHIH_0001', page_type: 'heritage_detail' }),
  host: { openNode: async ({ node_id }) => { openedNode = node_id; return { ok: true }; } },
});
assert.equal((await navigationRegistry.execute('open_node', { node_id: 'material:bamboo' })).ok, true);
assert.equal(openedNode, 'material:bamboo');
let openedHeritage = null;
const heritageNavigationRegistry = createToolRegistry({
  getContext: () => ({ route: '/explore', page_type: 'heritage_explore' }),
  host: { openHeritageDetail: async ({ heritage_id }) => { openedHeritage = heritageDetailTarget(heritage_id); return { ok: true }; } },
});
assert.equal((await heritageNavigationRegistry.execute('open_heritage_detail', { heritage_id: 'heritage:SHIH_0002' })).ok, true);
assert.equal(openedHeritage, 'SHIH_0002');
assert.equal((await heritageNavigationRegistry.execute('open_heritage_detail', { heritage_id: 'heritage:related_foam_paper_print' })).error.code, 'node_not_found');
const intentContext = { visible_nodes: [
  { id: 'heritage:one', type: 'heritage', title: '七宝皮影戏', index: 1 },
  { id: 'heritage:two', type: 'heritage', title: '象牙篾丝编织', index: 2 },
] };
assert.deepEqual(resolveIntent('打开第二个', intentContext), { name: 'open_node', args: { node_id: 'heritage:two', focus_camera: true, open_summary: true } });
assert.equal(resolveIntent('看看七宝皮影戏', intentContext).args.node_id, 'heritage:one');
const ivoryIntent = resolveIntent('我想看一下还有什么象牙非遗', intentContext);
assert.equal(ivoryIntent.name, 'open_node');
assert.equal(ivoryIntent.args.node_id, 'tradition:ivory_carving');

assert.equal(sanitizeAgentText('【0480000_0674000】'), '', '纯数字内部时间段引用不应显示给用户');
assert.equal(
  sanitizeAgentText('可以继续看[嘉定竹刻](#/craft/not-a-real-id)，也可访问 https://invalid.example/missing。'),
  '可以继续看嘉定竹刻，也可访问。',
  '模型生成的 Markdown 链接与裸链接不应直接出现在对话正文',
);
assert.equal(
  sanitizeAgentText('<a href="javascript:void(0)">查看相关项目</a>'),
  '查看相关项目',
  '模型生成的 HTML 链接只保留可读标签',
);

const changes = [];
const machine = createVoiceStateMachine({ onChange: (next) => changes.push(next) });
assert.equal(machine.state(), VOICE_STATES.DISABLED);
machine.transition(VOICE_STATES.REQUESTING_PERMISSION);
machine.transition(VOICE_STATES.WAKE_LISTENING);
assert.throws(() => machine.transition(VOICE_STATES.EXECUTING), /invalid_voice_transition/);
machine.transition(VOICE_STATES.AWAKENED);
machine.transition(VOICE_STATES.LISTENING);
assert.deepEqual(changes, [VOICE_STATES.REQUESTING_PERMISSION, VOICE_STATES.WAKE_LISTENING, VOICE_STATES.AWAKENED, VOICE_STATES.LISTENING]);
console.log('智能体工具与语音状态机测试：通过');
