import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA = join(ROOT, 'data');
const KB = join(DATA, 'knowledge-base');

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const readJsonl = async (path) => (await readFile(path, 'utf8'))
  .split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, i) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`${path}:${i + 1} JSON解析失败: ${error.message}`); }
  });
const compact = (values) => [...new Set((values || []).filter(Boolean))];
const digest = (value) => createHash('sha256').update(value).digest('hex').slice(0, 16);

const catalog = await readJson(join(DATA, 'catalog.json'));
const sourceDoc = await readJson(join(KB, 'sources.json'));
const externalFacts = await readJsonl(join(KB, 'facts.jsonl'));
const craftIds = new Set(catalog.packages.map((pkg) => pkg.video_id));
const sourceMap = new Map();
const errors = [];
const warnings = [];

for (const source of sourceDoc.sources) {
  if (!source.source_id || sourceMap.has(source.source_id)) errors.push(`重复或空来源编号: ${source.source_id || '(空)'}`);
  sourceMap.set(source.source_id, source);
  if (!/^https:\/\//.test(source.url || '')) errors.push(`${source.source_id}: URL必须使用HTTPS`);
  if (!['A', 'B', 'C'].includes(source.authority_tier)) errors.push(`${source.source_id}: 无效来源等级`);
  for (const id of source.craft_ids || []) if (!craftIds.has(id)) errors.push(`${source.source_id}: 未知项目 ${id}`);
}

const factIds = new Set();
for (const fact of externalFacts) {
  if (!fact.fact_id || factIds.has(fact.fact_id)) errors.push(`重复或空事实编号: ${fact.fact_id || '(空)'}`);
  factIds.add(fact.fact_id);
  if (!fact.statement?.trim()) errors.push(`${fact.fact_id}: statement为空`);
  if (!(fact.source_ids || []).length) errors.push(`${fact.fact_id}: 没有来源`);
  for (const sourceId of fact.source_ids || []) if (!sourceMap.has(sourceId)) errors.push(`${fact.fact_id}: 未知来源 ${sourceId}`);
  for (const id of fact.craft_ids || []) if (!craftIds.has(id)) errors.push(`${fact.fact_id}: 未知项目 ${id}`);
  const tiers = (fact.source_ids || []).map((id) => sourceMap.get(id)?.authority_tier).filter(Boolean);
  if (fact.authority_tier && tiers.length && !tiers.includes(fact.authority_tier)) warnings.push(`${fact.fact_id}: 声明等级与来源等级不一致`);
}

const chunks = [];
const chunkIds = new Set();
function addChunk(chunk) {
  const text = String(chunk.text || '').replace(/\s+/g, ' ').trim();
  if (!text) { warnings.push(`${chunk.chunk_id}: 空文本，已跳过`); return; }
  if (chunkIds.has(chunk.chunk_id)) { errors.push(`重复块编号: ${chunk.chunk_id}`); return; }
  chunkIds.add(chunk.chunk_id);
  chunks.push({
    schema_version: '1.0',
    chunk_id: chunk.chunk_id,
    kind: chunk.kind,
    craft_ids: compact(chunk.craft_ids),
    district_ids: compact(chunk.district_ids),
    title: chunk.title || '',
    text,
    source_ids: compact(chunk.source_ids),
    evidence_ids: compact(chunk.evidence_ids),
    authority_tier: chunk.authority_tier || null,
    review_status: chunk.review_status || 'needs_review',
    content_hash: digest(text),
  });
}

for (const source of sourceDoc.sources) {
  addChunk({
    chunk_id: `source_${source.source_id}`,
    kind: 'source_profile',
    craft_ids: source.craft_ids,
    title: source.title,
    text: `${source.title}。发布者：${source.publisher}。主题：${(source.topics || []).join('、')}。链接：${source.url}`,
    source_ids: [source.source_id],
    authority_tier: source.authority_tier,
    review_status: 'source_registered',
  });
}

for (const fact of externalFacts) {
  addChunk({
    chunk_id: fact.fact_id,
    kind: 'external_fact',
    craft_ids: fact.craft_ids,
    district_ids: fact.district_ids,
    title: fact.topic,
    text: fact.statement,
    source_ids: fact.source_ids,
    authority_tier: fact.authority_tier,
    review_status: fact.review_status,
  });
}

for (const pkg of catalog.packages) {
  const base = join(DATA, pkg.directory);
  const [draft, evidence, claims, steps] = await Promise.all([
    readJson(join(base, 'knowledge', 'knowledge_draft.json')),
    readJsonl(join(base, 'knowledge', 'evidence.jsonl')),
    readJsonl(join(base, 'knowledge', 'claims.jsonl')),
    readJsonl(join(base, 'knowledge', 'process_steps.jsonl')),
  ]);
  addChunk({
    chunk_id: `summary_${pkg.video_id}`,
    kind: 'video_summary', craft_ids: [pkg.video_id], title: `${pkg.title}视频摘要`,
    text: draft.summary_candidate, review_status: 'needs_review',
  });
  for (const item of evidence) {
    addChunk({
      chunk_id: item.evidence_id,
      kind: 'video_evidence', craft_ids: [pkg.video_id], title: `${pkg.title}纪录片证据`,
      text: [item.transcript_raw, item.visual_description_raw].filter(Boolean).join('。'),
      evidence_ids: [item.evidence_id], review_status: item.review_status || 'needs_review',
    });
  }
  for (const claim of claims) {
    addChunk({
      chunk_id: claim.claim_id,
      kind: 'video_claim', craft_ids: [pkg.video_id], title: `${pkg.title}事实主张`,
      text: claim.statement, evidence_ids: claim.evidence_ids,
      review_status: claim.review_status || 'needs_review',
    });
  }
  for (const step of steps) {
    addChunk({
      chunk_id: step.step_id,
      kind: 'process_step', craft_ids: [pkg.video_id], title: step.name || `${pkg.title}工序`,
      text: `${step.name || '工序'}。动作：${step.action || '待补充'}。材料：${(step.materials || []).join('、') || '未记录'}。工具：${(step.tools || []).join('、') || '未记录'}。${step.result ? `结果：${step.result}` : ''}`,
      evidence_ids: step.evidence_ids, review_status: step.review_status || 'needs_review',
    });
  }

  const entityGroups = new Map();
  for (const item of evidence) {
    const entities = item.entities_candidate || {};
    for (const [type, values] of Object.entries(entities)) {
      for (const value of Array.isArray(values) ? values : []) {
        const label = typeof value === 'string' ? value : value?.name;
        if (!label) continue;
        const key = `${type}:${label}`;
        if (!entityGroups.has(key)) entityGroups.set(key, { type, label, evidenceIds: [] });
        entityGroups.get(key).evidenceIds.push(item.evidence_id);
      }
    }
  }
  let entityNo = 0;
  for (const entity of entityGroups.values()) {
    entityNo += 1;
    addChunk({
      chunk_id: `entity_${pkg.video_id}_${String(entityNo).padStart(3, '0')}_${digest(`${entity.type}:${entity.label}`)}`,
      kind: 'entity', craft_ids: [pkg.video_id], title: entity.type,
      text: `${pkg.title}资料中识别到的${entity.type}：${entity.label}`,
      evidence_ids: entity.evidenceIds, review_status: 'needs_review',
    });
  }
}

const perCraft = {};
for (const id of craftIds) {
  const own = chunks.filter((chunk) => chunk.craft_ids.includes(id));
  perCraft[id] = {
    chunks: own.length,
    external_facts: own.filter((chunk) => chunk.kind === 'external_fact').length,
    video_evidence: own.filter((chunk) => chunk.kind === 'video_evidence').length,
    claims: own.filter((chunk) => chunk.kind === 'video_claim').length,
    steps: own.filter((chunk) => chunk.kind === 'process_step').length,
    entities: own.filter((chunk) => chunk.kind === 'entity').length,
    sources: new Set(own.flatMap((chunk) => chunk.source_ids)).size,
  };
  if (!perCraft[id].external_facts) errors.push(`${id}: 没有外部事实覆盖`);
}

const duplicateHashes = new Map();
for (const chunk of chunks) {
  if (!duplicateHashes.has(chunk.content_hash)) duplicateHashes.set(chunk.content_hash, []);
  duplicateHashes.get(chunk.content_hash).push(chunk.chunk_id);
}
const duplicates = [...duplicateHashes.values()].filter((ids) => ids.length > 1);
if (duplicates.length) warnings.push(`发现 ${duplicates.length} 组相同文本块`);

const stats = {
  schema_version: '1.0',
  generated_at: new Date().toISOString(),
  total_chunks: chunks.length,
  external_sources: sourceDoc.sources.length,
  external_facts: externalFacts.length,
  authority: Object.fromEntries(['A', 'B', 'C'].map((tier) => [tier, sourceDoc.sources.filter((s) => s.authority_tier === tier).length])),
  review_status: Object.fromEntries([...new Set(chunks.map((c) => c.review_status))].sort().map((status) => [status, chunks.filter((c) => c.review_status === status).length])),
  kinds: Object.fromEntries([...new Set(chunks.map((c) => c.kind))].sort().map((kind) => [kind, chunks.filter((c) => c.kind === kind).length])),
  per_craft: perCraft,
  duplicate_text_groups: duplicates,
  warnings,
  errors,
};

await mkdir(KB, { recursive: true });
await writeFile(join(KB, 'index.jsonl'), `${chunks.map((chunk) => JSON.stringify(chunk)).join('\n')}\n`, 'utf8');
await writeFile(join(KB, 'stats.json'), `${JSON.stringify(stats, null, 2)}\n`, 'utf8');

console.log(`知识库构建完成：${chunks.length} 块 / ${externalFacts.length} 条外部事实 / ${sourceDoc.sources.length} 个外部来源`);
for (const [id, value] of Object.entries(perCraft)) console.log(`${id}: ${value.chunks} 块，外部事实 ${value.external_facts}，来源 ${value.sources}`);
for (const warning of warnings) console.warn(`WARN ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`ERROR ${error}`);
  process.exitCode = 1;
}
