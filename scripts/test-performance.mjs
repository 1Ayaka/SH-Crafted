import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { graphIndexStats, searchGraph } from '../js/agent/graph-adapter.js';

globalThis.document = { documentElement: { lang: 'zh-CN' } };
globalThis.location = { hash: '#/explore' };

searchGraph('竹子');
const before = graphIndexStats();
const queries = ['竹子', '牙雕', '嘉定竹刻', '材料', '上海非遗'];
const iterations = 3000;
const started = performance.now();
for (let index = 0; index < iterations; index += 1) searchGraph(queries[index % queries.length], { limit: 8 });
const elapsed = performance.now() - started;
const after = graphIndexStats();
const average = elapsed / iterations;

assert.equal(after.builds, before.builds, '高频检索期间不应重复构建图谱索引');
assert.ok(average < 2, `平均图谱检索耗时过高：${average.toFixed(3)}ms`);
console.log(JSON.stringify({
  searches: iterations,
  average_ms: Number(average.toFixed(4)),
  node_count: after.node_count,
  edge_count: after.edge_count,
  index_builds: after.builds,
}, null, 2));
