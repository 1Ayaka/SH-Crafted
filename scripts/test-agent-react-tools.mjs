import assert from 'node:assert/strict';
import { AGENT_CLIENT_TOOLS, modelTools, normalizeToolCalls, toolResultMessages } from '../server/agent-tools.mjs';

assert.ok(AGENT_CLIENT_TOOLS.length >= 10, 'tool inventory should expose useful site capabilities');
const selected = modelTools(['search_graph', 'open_heritage_detail']);
assert.deepEqual(selected.map((item) => item.function.name), ['search_graph', 'open_heritage_detail']);
assert.equal(selected[0].function.parameters.additionalProperties, false);

const calls = normalizeToolCalls([
  { id: 'call-1', function: { name: 'search_graph', arguments: '{"query":"嘉定竹刻","types":["heritage"]}' } },
  { id: 'call-2', function: { name: 'invented_delete', arguments: '{}' } },
  { id: 'call-3', function: { name: 'open_node', arguments: '{broken' } },
]);
assert.equal(calls.length, 1, 'unknown tools and invalid JSON must be rejected');
assert.equal(calls[0].name, 'search_graph');
const messages = toolResultMessages(calls, [{ ok: true, results: [{ id: 'heritage:SHIH_0001' }] }]);
assert.equal(messages[0].role, 'tool');
assert.equal(messages[0].tool_call_id, 'call-1');
assert.match(messages[0].content, /heritage:SHIH_0001/);
console.log('agent ReAct tool protocol tests passed');
