import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const KB = join(ROOT, 'data', 'knowledge-base');
const readJson = async (name) => JSON.parse(await readFile(join(KB, name), 'utf8'));
const readJsonl = async (name) => (await readFile(join(KB, name), 'utf8')).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(JSON.parse);
const [sourceDoc, facts, stats, crawl, links, index] = await Promise.all([
  readJson('sources.json'), readJsonl('facts.jsonl'), readJson('stats.json'), readJson('crawl-report.json'), readJson('link-report.json'), readJsonl('index.jsonl'),
]);

const errors = [];
const warnings = [];
const sourceMap = new Map(sourceDoc.sources.map((source) => [source.source_id, source]));
const factMap = new Map(facts.map((fact) => [fact.fact_id, fact]));
const indexMap = new Map(index.map((chunk) => [chunk.chunk_id, chunk]));

if (sourceMap.size !== sourceDoc.sources.length) errors.push('来源编号存在重复');
if (factMap.size !== facts.length) errors.push('事实编号存在重复');
if (indexMap.size !== index.length) errors.push('索引块编号存在重复');
if (index.length !== stats.total_chunks) errors.push(`索引行数 ${index.length} 与统计 ${stats.total_chunks} 不一致`);
if ((stats.errors || []).length) errors.push(`构建统计包含 ${stats.errors.length} 个错误`);

for (const fact of facts) {
  if (!indexMap.has(fact.fact_id)) errors.push(`${fact.fact_id}: 未进入统一索引`);
  for (const sourceId of fact.source_ids || []) if (!sourceMap.has(sourceId)) errors.push(`${fact.fact_id}: 悬空来源 ${sourceId}`);
}

for (const [craftId, coverage] of Object.entries(stats.per_craft || {})) {
  const craftFacts = facts.filter((fact) => fact.craft_ids?.includes(craftId));
  if (coverage.external_facts < 10) errors.push(`${craftId}: 外部事实不足10条（${coverage.external_facts}）`);
  if (coverage.sources < 5) errors.push(`${craftId}: 来源不足5个（${coverage.sources}）`);
  const topics = new Set(craftFacts.map((fact) => fact.topic).filter(Boolean));
  if (topics.size < 6) errors.push(`${craftId}: 外部事实主题不足6类（${topics.size}）`);
  const tiers = new Set(craftFacts.flatMap((fact) => fact.source_ids).map((id) => sourceMap.get(id)?.authority_tier));
  if (!tiers.has('A') && !tiers.has('B')) errors.push(`${craftId}: 没有A/B级来源支持`);
}

const crawlMap = new Map(crawl.results.map((item) => [item.source_id, item]));
const linkMap = new Map((links.results || []).map((item) => [item.source_id, item]));
if (links.total !== sourceDoc.sources.length) errors.push(`链接报告来源数 ${links.total} 与登记册 ${sourceDoc.sources.length} 不一致`);
if (!links.checked_at || Date.now() - new Date(links.checked_at).getTime() > 14 * 24 * 60 * 60 * 1000) {
  errors.push('来源链接报告缺失或已超过14天，请运行 npm run kb:links');
}
for (const source of sourceDoc.sources) {
  const link = linkMap.get(source.source_id);
  if (!link) errors.push(`${source.source_id}: 缺少链接可访问性检查`);
  else if (link.status !== 'ok') errors.push(`${source.source_id}: 原文链接当前不可访问（${link.http_status || link.error || link.status}）`);
  if (!source.crawl?.enabled || source.crawl?.format !== 'html') continue;
  const result = crawlMap.get(source.source_id);
  if (!result) { errors.push(`${source.source_id}: 缺少抓取结果`); continue; }
  if (result.status !== 'ok') { errors.push(`${source.source_id}: 抓取状态 ${result.status}`); continue; }
  const snapshotPath = join(KB, 'snapshots', `${source.source_id}.json`);
  try {
    await access(snapshotPath);
    const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
    const actualHash = createHash('sha256').update(snapshot.extracted_text || '').digest('hex');
    if (actualHash !== snapshot.sha256 || actualHash !== result.sha256) errors.push(`${source.source_id}: 快照哈希不一致`);
    if ((snapshot.extracted_text || '').length < 100) errors.push(`${source.source_id}: 快照正文过短`);
    const searchable = snapshot.extracted_text || '';
    if (!(source.topics || []).some((topic) => searchable.includes(topic))) warnings.push(`${source.source_id}: 正文未直接命中登记主题，建议人工复核页面抽取范围`);
  } catch (error) {
    errors.push(`${source.source_id}: 快照不可读（${error.message}）`);
  }
}

const report = {
  schema_version: '1.0', generated_at: new Date().toISOString(), passed: errors.length === 0,
  totals: {
    chunks: index.length, sources: sourceDoc.sources.length, crawlable_sources: sourceDoc.sources.filter((s) => s.crawl?.enabled && s.crawl?.format === 'html').length,
    facts: facts.length, verified_external: facts.filter((f) => f.review_status === 'verified_external').length,
    needs_review: facts.filter((f) => f.review_status !== 'verified_external').length,
  },
  per_craft: stats.per_craft,
  warnings, errors,
};
await writeFile(join(KB, 'audit-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`知识库审计：${report.passed ? '通过' : '失败'}`);
console.log(`索引 ${report.totals.chunks} 块；来源 ${report.totals.sources}；外部事实 ${report.totals.facts}（已外部核验 ${report.totals.verified_external}，待复核 ${report.totals.needs_review}）`);
for (const warning of warnings) console.warn(`WARN ${warning}`);
for (const error of errors) console.error(`ERROR ${error}`);
if (errors.length) process.exitCode = 1;
