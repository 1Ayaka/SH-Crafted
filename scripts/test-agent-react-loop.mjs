import assert from 'node:assert/strict';
import { runReactLoop } from '../js/agent/react-runner.js';

const asks = [];
const executions = [];
const responses = [
  { type: 'tool_calls', assistant_content: '', tool_calls: [{ id: 'one', name: 'search_graph', arguments: { query: '嘉定竹刻' } }] },
  { type: 'tool_calls', assistant_content: '', tool_calls: [{ id: 'two', name: 'open_heritage_detail', arguments: { heritage_id: 'heritage:SHIH_0001' } }] },
  { type: 'assistant_message', content: '已经为你打开嘉定竹刻。', mode: 'model-react' },
];
const result = await runReactLoop({
  ask: async (react) => { asks.push(react); return responses[asks.length - 1]; },
  execute: async (name, args) => {
    executions.push({ name, args });
    if (name === 'search_graph') return { ok: true, results: [{ id: 'heritage:SHIH_0001', title: '嘉定竹刻' }] };
    return { ok: true, route: '/craft/SHIH_0001' };
  },
});
assert.equal(asks.length, 3);
assert.deepEqual(executions.map((item) => item.name), ['search_graph', 'open_heritage_detail']);
assert.match(asks[1].steps[0].tool_results[0].results[0].id, /SHIH_0001/);
assert.equal(asks[2].steps[1].tool_results[0].route, '/craft/SHIH_0001');
assert.equal(asks[2].steps.length, 2, 'later turns must retain the complete observation/action history');
assert.equal(result.content, '已经为你打开嘉定竹刻。');
assert.deepEqual(result.react_trace.map((item) => `${item.tool}:${item.ok}`), ['search_graph:true', 'open_heritage_detail:true']);

let count = 0;
const limited = await runReactLoop({
  ask: async () => ({ type: 'tool_calls', tool_calls: [{ id: `c${++count}`, name: 'search_graph', arguments: { query: '循环' } }] }),
  execute: async () => ({ ok: true }), maxIterations: 3,
});
assert.equal(count, 3);
assert.equal(limited.mode, 'model-react-limit');
console.log('agent ReAct multi-step loop tests passed');
