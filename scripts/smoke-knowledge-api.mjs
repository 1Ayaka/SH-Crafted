const base = (process.argv.find((arg) => arg.startsWith('--base='))?.slice(7)
  || process.env.KB_BASE_URL
  || 'http://127.0.0.1:7100').replace(/\/$/, '');

const cases = [
  { craft_id: 'SHIH_0001', query: '嘉定竹刻有什么历史和代表技法', expectTier: 'A' },
  { craft_id: 'SHIH_0002', query: '南桥撕纸和上海剪纸有什么区别', expectKind: 'external_fact' },
  { craft_id: 'SHIH_0003', query: '药斑布使用什么材料染色', expectSource: true },
  { craft_id: 'SHIH_0004', query: '象牙篾丝编织有哪些历史文物，现代展示有什么合规要求', expectTier: 'A' },
  { craft_id: 'SHIH_0005', query: '崇明土布有哪些工序和纹样', expectSource: true },
  { craft_id: 'SHIH_0006', query: '月份牌年画如何形成，有什么城市文化价值', expectSource: true },
  { craft_id: 'SHIH_0007', query: '七宝皮影戏的保护单位和代表性传承人是谁', expectTier: 'A' },
  { craft_id: 'SHIH_0008', query: '毛氏风筝如何传承', expectSource: true },
];

const errors = [];
for (const test of cases) {
  const response = await fetch(`${base}/api/kb/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ query: test.query, craft_id: test.craft_id, limit: 5 }),
  }).catch((error) => ({ ok: false, status: 0, error }));
  if (!response.ok) {
    errors.push(`${test.craft_id}: HTTP ${response.status || 0} ${response.error?.message || ''}`);
    continue;
  }
  const result = await response.json();
  if (result.total_chunks < 1) errors.push(`${test.craft_id}: 服务端未载入知识索引`);
  if (!Array.isArray(result.results) || result.results.length < 1) errors.push(`${test.craft_id}: 查询无结果`);
  if (result.results?.some((item) => item.craft_ids?.length && !item.craft_ids.includes(test.craft_id))) {
    errors.push(`${test.craft_id}: 返回了其他项目的专属片段`);
  }
  if (test.expectTier && !result.results?.some((item) => item.authority_tier === test.expectTier)) {
    errors.push(`${test.craft_id}: 未命中 ${test.expectTier} 级来源`);
  }
  if (test.expectKind && !result.results?.some((item) => item.kind === test.expectKind)) {
    errors.push(`${test.craft_id}: 未命中 ${test.expectKind} 类型`);
  }
  if (test.expectSource && !result.results?.some((item) => item.sources?.length)) {
    errors.push(`${test.craft_id}: 结果没有可追溯来源`);
  }
  console.log(`${test.craft_id}：${result.results?.length || 0} 条命中 / 索引 ${result.total_chunks || 0} 条`);
}

if (errors.length) {
  for (const error of errors) console.error(`ERROR ${error}`);
  process.exitCode = 1;
} else {
  console.log('知识库 API 冒烟测试：通过');
}
