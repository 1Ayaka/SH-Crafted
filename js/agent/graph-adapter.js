// 三维非遗图谱兼容层。
// 当前正式内容仍以 SHIH_* 工艺包与 districts 配置为准；这里提供稳定的
// heritage:/region: 命名空间，后续接入 nodes/edges.jsonl 时只替换本模块。
import { allCrafts } from '../data.js';
import { DISTRICTS, DISTRICT_PROFILES, CRAFT_CONFIG } from '../config.js';

const RELATIONS = Object.freeze([
  'LOCATED_IN',
  'BELONGS_TO_TRADITION',
  'USES_MATERIAL',
]);

const TYPE_SET = new Set(['heritage', 'region', 'tradition', 'material']);

export function graphId(type, rawId) {
  return `${type}:${String(rawId || '').replace(/[^A-Za-z0-9_-]/g, '')}`;
}

export function parseGraphId(value) {
  const match = String(value || '').match(/^(heritage|region|tradition|material):([A-Za-z0-9_-]+)$/);
  return match ? { type: match[1], rawId: match[2] } : null;
}

function craftNode(craft) {
  return {
    id: graphId('heritage', craft.craftId),
    raw_id: craft.craftId,
    type: 'heritage',
    title: craft.title,
    aliases: [craft.title, craft.config?.craftName].filter(Boolean),
    summary: String(craft.summary || '').slice(0, 180),
    district_id: craft.config?.districtId || null,
    public: true,
    source_ids: (craft.externalSources || []).map((source) => source.source_id).slice(0, 5),
  };
}

function districtNode(district) {
  const profile = DISTRICT_PROFILES[district.id] || {};
  return {
    id: graphId('region', district.id),
    raw_id: district.id,
    type: 'region',
    title: profile.name || district.name,
    aliases: [profile.name || district.name, String(profile.name || district.name).replace(/区$/, '')],
    summary: String(profile.heritageOverview || '').slice(0, 180),
    public: true,
    source_ids: profile.sourceUrl ? [`region_source:${district.id}`] : [],
  };
}

export function graphNodes() {
  const crafts = allCrafts().map(craftNode);
  const districts = DISTRICTS.map(districtNode);
  return [...crafts, ...districts];
}

export function getGraphNode(id) {
  const parsed = parseGraphId(id);
  if (!parsed) return null;
  return graphNodes().find((node) => node.id === id) || null;
}

export function searchGraph(query, { types = [...TYPE_SET], limit = 8 } = {}) {
  const clean = String(query || '').trim().toLowerCase();
  if (!clean) return [];
  const allowed = new Set(types.filter((type) => TYPE_SET.has(type)));
  const terms = clean.split(/[\s，。！？、；：()（）《》“”‘’]+/).filter(Boolean);
  return graphNodes()
    .filter((node) => allowed.has(node.type))
    .map((node) => {
      const names = [node.title, ...(node.aliases || [])].join(' ').toLowerCase();
      const haystack = `${names} ${node.summary}`.toLowerCase();
      let score = names.includes(clean) ? 2 : haystack.includes(clean) ? 0.35 : 0;
      for (const term of terms) if (names.includes(term)) score += term.length > 1 ? 0.25 : 0.04;
      else if (haystack.includes(term)) score += term.length > 1 ? 0.06 : 0.01;
      if (node.title.toLowerCase() === clean) score += 2;
      return { node, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.node.title.localeCompare(b.node.title, 'zh-CN'))
    .slice(0, Math.min(Math.max(Number(limit) || 8, 1), 12))
    .map(({ node, score }) => ({
      id: node.id,
      title: node.title,
      type: node.type,
      aliases: node.aliases,
      summary: node.summary,
      score: Number(score.toFixed(3)),
      raw_id: node.raw_id,
    }));
}

export function relationLabel(relation) {
  return {
    LOCATED_IN: '位于',
    BELONGS_TO_TRADITION: '属于传统',
    USES_MATERIAL: '使用材料',
  }[relation] || relation;
}

export function isSupportedRelation(relation) {
  return RELATIONS.includes(relation);
}

export function relationsForNode(id) {
  const node = getGraphNode(id);
  if (!node || node.type !== 'heritage') return [];
  // 目前只有地区归属来自已存在的策展/审核数据；传统与材料不从类别或
  // 文本推断，避免把未经证据确认的关系伪装成正式图谱关系。
  const config = CRAFT_CONFIG[node.raw_id] || {};
  return config.districtId
    ? [{ relation: 'LOCATED_IN', target_id: graphId('region', config.districtId), source: 'curated_district_mapping' }]
    : [];
}

export function expandGraphBranch(rootId, relation) {
  if (!isSupportedRelation(relation)) return { relation, nodes: [], count: 0, error: 'relation_not_allowed' };
  const edges = relationsForNode(rootId).filter((edge) => edge.relation === relation);
  return {
    relation,
    relation_label: relationLabel(relation),
    nodes: edges.map((edge, index) => {
      const node = getGraphNode(edge.target_id);
      return node ? { ...node, index: index + 1, evidence: edge.source } : null;
    }).filter(Boolean),
    count: edges.length,
    evidence_status: edges.length ? 'curated_mapping' : 'not_available',
  };
}

export function nodeFromRawId(rawId) {
  return getGraphNode(graphId('heritage', rawId)) || getGraphNode(graphId('region', rawId));
}
