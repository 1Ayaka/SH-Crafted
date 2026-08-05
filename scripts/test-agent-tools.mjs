import assert from 'node:assert/strict';
import { createToolRegistry } from '../js/agent/tool-registry.js';
import { createVoiceStateMachine, VOICE_STATES } from '../js/voice/voice-state-machine.js';
import { resolveIntent } from '../js/agent/intent-resolver.js';

globalThis.document = { documentElement: { lang: 'zh-CN' } };
globalThis.location = { hash: '#/explore' };

const registry = createToolRegistry({ getContext: () => ({ route: '/explore', page_type: 'explore' }) });
assert.equal((await registry.execute('not_registered', {})).error.code, 'tool_not_registered');
assert.equal((await registry.execute('expand_branch', { relation: 'MAKES_UP' })).error.code, 'relation_not_allowed');
assert.equal((await registry.execute('search_graph', { query: '七宝', extra: true })).error.code, 'invalid_arguments');
assert.equal((await registry.execute('search_graph', { query: '七宝', limit: '3' })).error.code, 'invalid_arguments');
assert.equal((await registry.execute('open_node', { node_id: 'heritage:missing' })).error.code, 'node_not_found');
assert.equal((await registry.execute('get_current_context')).ok, true);
const intentContext = { visible_nodes: [
  { id: 'heritage:one', type: 'heritage', title: '七宝皮影戏', index: 1 },
  { id: 'heritage:two', type: 'heritage', title: '象牙篾丝编织', index: 2 },
] };
assert.deepEqual(resolveIntent('打开第二个', intentContext), { name: 'open_node', args: { node_id: 'heritage:two', focus_camera: true, open_summary: true } });
assert.equal(resolveIntent('看看七宝皮影戏', intentContext).args.node_id, 'heritage:one');

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
