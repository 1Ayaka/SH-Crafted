// 三维非遗图谱兼容层。
// 当前正式内容仍以 SHIH_* 工艺包与 districts 配置为准；这里提供稳定的
// heritage:/region: 命名空间，后续接入 nodes/edges.jsonl 时只替换本模块。
import { allCrafts, graphContent, graphDataVersion } from '../data.js';
import { DISTRICTS, DISTRICT_PROFILES, CRAFT_CONFIG } from '../config.js';
import { GRAPH_SEED_EDGES, GRAPH_SEED_NODES } from '../graph-seed.js';
import { CURATED_GRAPH_EDGES, CURATED_GRAPH_NODES } from '../graph-curated-catalog.js';

let cachedEdgeVersion = '';
let cachedEdges = [];
let cachedNodeVersion = '';
let cachedNodes = [];
let cachedNodeById = new Map();
let cachedSearchRecords = [];
let cachedSearchTokenIndex = new Map();
let nodeIndexBuilds = 0;

function searchTokens(value) {
  const clean = String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const tokens = new Set(clean.match(/[a-z0-9_-]{2,}/g) || []);
  const compact = clean.replace(/[\s，。！？、；：()（）《》“”‘’]+/g, '');
  for (let index = 0; index + 1 < compact.length; index += 1) tokens.add(compact.slice(index, index + 2));
  return tokens;
}

function allGraphEdges() {
  const version = graphDataVersion();
  if (cachedEdgeVersion === version) return cachedEdges;
  const content = graphContent();
  const seen = new Set();
  cachedEdges = [...(content.edges || []), ...CURATED_GRAPH_EDGES, ...GRAPH_SEED_EDGES].filter((edge) => {
    const id = edge.id || `${edge.from}|${edge.relation}|${edge.to}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  cachedEdgeVersion = version;
  return cachedEdges;
}
const SEARCH_EQUIVALENTS = Object.freeze([
  ['竹子', '竹材', '竹'],
  ['纸张', '纸板', '纸', '宣纸'],
  ['棉纤维', '棉布', '棉花', '棉'],
  ['兽皮', '皮革', '皮'],
  ['象牙', '牙材'],
]);

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

function craftImageUrl(craft, value) {
  const source = String(value || '').trim();
  if (!source || /^(?:[a-z]+:|\/|assets\/|data\/)/i.test(source)) return source;
  return `${craft.baseUrl || ''}${source}`;
}

function craftNode(craft) {
  const primarySource = craft.externalSources?.[0] || {};
  const mainImage = craftImageUrl(craft, craft.config?.heroFrame || craft.config?.works?.[0]?.frame || '');
  const nodeImages = Array.isArray(craft.config?.graphData?.images)
    ? craft.config.graphData.images.filter((image) => image?.image_url || image?.url).map((image) => ({
      ...image,
      image_url: craftImageUrl(craft, image.image_url || image.url),
    }))
    : [];
  const displayImages = nodeImages.length ? nodeImages : (mainImage ? [{
    title: `${craft.title}主图`,
    description: '该节点尚未设置专用图片，当前使用项目主图。',
    image_url: mainImage,
    display_role: 'main-fallback',
  }] : []);
  return {
    id: graphId('heritage', craft.craftId),
    raw_id: craft.craftId,
    detail_available: true,
    type: 'heritage',
    title: craft.title,
    aliases: [craft.title, craft.config?.craftName].filter(Boolean),
    summary: String(craft.summary || '').slice(0, 180),
    overview_image: mainImage,
    graph_data: craft.config?.graphData || {},
    images: displayImages,
    image_display_role: nodeImages.length ? 'node' : (mainImage ? 'main-fallback' : 'empty'),
    district_id: craft.config?.districtId || null,
    heritage_level: craft.config?.heritageLevel || (/^SHIH_\d{4}$/.test(craft.craftId) ? 'primary' : 'secondary'),
    public: true,
    source_ids: (craft.externalSources || []).map((source) => source.source_id).slice(0, 5),
    source_title: primarySource.title || '',
    source_url: primarySource.url || '',
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
    source_title: profile.sourceLabel || `${profile.name || district.name}地区资料`,
    source_url: profile.sourceUrl || '',
  };
}

export function graphNodes() {
  const version = graphDataVersion();
  if (cachedNodeVersion === version) return cachedNodes;
  // 工艺包是按需异步加载的；配置中的轻量节点保证图谱入口、搜索和
  // 智能体在首屏或离线测试时仍能识别稳定 ID。真实工艺包加载后优先覆盖它。
  const configuredCrafts = Object.entries(CRAFT_CONFIG).map(([craftId, config]) => ({
    craftId,
    title: config.craftName || craftId,
    summary: '',
    config,
    externalSources: [],
  }));
  const crafts = [...allCrafts(), ...configuredCrafts].map(craftNode);
  const districts = DISTRICTS.map(districtNode);
  const persisted = graphContent().nodes || [];
  const seen = new Set();
  const seenHeritageTitles = new Set();
  const graphRelations = crafts.flatMap((craft) => (craft.graph_data?.relations || []).map((relation, index) => ({
    id: graphId(relation.type || 'tradition', relation.id || `${craft.raw_id}_${index}_${relation.title}`),
    raw_id: relation.id || `${craft.raw_id}_${index}`,
    type: relation.type || 'tradition',
    title: relation.title,
    aliases: [relation.title],
    summary: relation.summary || '',
    images: relation.images || [],
    public: true,
  })));
  const detailNodes = new Map(crafts.map((node) => [node.id, node]));
  // Some legacy/curated graph seeds use a different ID for the same named
  // heritage project. Resolve those aliases to the canonical craft package
  // so exploration links can still open the detail page.
  const detailNodesByTitle = new Map(crafts
    .filter((node) => node.type === 'heritage' && node.title)
    .map((node) => [String(node.title).trim(), node]));
  cachedNodes = [...persisted, ...crafts, ...districts, ...graphRelations, ...GRAPH_SEED_NODES, ...CURATED_GRAPH_NODES]
    .map((node) => {
      const detail = detailNodes.get(node.id)
        || (node.type === 'heritage' && detailNodesByTitle.get(String(node.title || '').trim()));
      if (!detail) return node;
      const communityImages = (Array.isArray(node.images) ? node.images : []).filter((image) => image?.submission_id || image?.image_origin === 'community_review');
      const detailImages = detail.image_display_role === 'main-fallback' && communityImages.length ? [] : detail.images;
      const images = [...detailImages, ...communityImages]
        .filter((image, index, all) => all.findIndex((other) => (other.image_url || other.url) === (image.image_url || image.url)) === index);
      return {
        ...node,
        raw_id: detail.raw_id,
        detail_available: true,
        canonical_id: detail.id,
        overview_image: detail.overview_image || node.overview_image || '',
        images,
        image_display_role: communityImages.length ? 'node' : detail.image_display_role,
        graph_data: detail.graph_data,
      };
    }).filter((node) => {
    if (seen.has(node.id)) return false;
    const titleKey = node.type === 'heritage' ? String(node.title || '').trim() : '';
    if (titleKey && seenHeritageTitles.has(titleKey)) return false;
    seen.add(node.id);
    if (titleKey) seenHeritageTitles.add(titleKey);
    return true;
  });
  cachedNodeById = new Map(cachedNodes.map((node) => [node.id, node]));
  cachedSearchTokenIndex = new Map();
  cachedSearchRecords = cachedNodes.map((node, index) => {
    const names = [node.title, ...(node.aliases || [])].join(' ').toLowerCase();
    const haystack = `${names} ${node.summary || ''}`.toLowerCase();
    for (const token of searchTokens(haystack)) {
      if (!cachedSearchTokenIndex.has(token)) cachedSearchTokenIndex.set(token, new Set());
      cachedSearchTokenIndex.get(token).add(index);
    }
    return { node, names, haystack, title: String(node.title || '').toLowerCase() };
  });
  cachedNodeVersion = version;
  nodeIndexBuilds += 1;
  return cachedNodes;
}

export function getGraphNode(id) {
  const parsed = parseGraphId(id);
  if (!parsed) return null;
  graphNodes();
  return cachedNodeById.get(id) || null;
}

export function graphIndexStats() {
  graphNodes();
  return { version: cachedNodeVersion, node_count: cachedNodes.length, edge_count: allGraphEdges().length, builds: nodeIndexBuilds };
}

export function searchGraph(query, { types = [...TYPE_SET], limit = 8 } = {}) {
  const clean = String(query || '').trim().toLowerCase();
  if (!clean) return [];
  const allowed = new Set(types.filter((type) => TYPE_SET.has(type)));
  const terms = new Set(clean.split(/[\s，。！？、；：()（）《》“”‘’]+/).filter(Boolean));
  for (const group of SEARCH_EQUIVALENTS) {
    if (group.some((term) => clean.includes(term))) group.forEach((term) => terms.add(term));
  }
  graphNodes();
  const candidateIndexes = new Set();
  for (const token of [...searchTokens(clean), ...[...terms].flatMap((term) => [...searchTokens(term)])]) {
    cachedSearchTokenIndex.get(token)?.forEach((index) => candidateIndexes.add(index));
  }
  const records = candidateIndexes.size
    ? [...candidateIndexes].map((index) => cachedSearchRecords[index])
    : cachedSearchRecords;
  return records
    .filter(({ node }) => allowed.has(node.type))
    .map(({ node, names, haystack, title }) => {
      let score = names.includes(clean) ? 2 : haystack.includes(clean) ? 0.35 : 0;
      if (clean.includes(String(node.title || '').toLowerCase())) score += 1.4;
      for (const alias of (node.aliases || [])) {
        const normalizedAlias = String(alias || '').toLowerCase();
        if (normalizedAlias.length > 1 && clean.includes(normalizedAlias)) score += 0.7;
      }
      for (const term of terms) if (names.includes(term)) score += term.length > 1 ? 0.25 : 0.04;
      else if (haystack.includes(term)) score += term.length > 1 ? 0.06 : 0.01;
      if (title === clean) score += 2;
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
      detail_available: Boolean(node.detail_available),
    }));
}

export function heritageDetailTarget(id) {
  const node = getGraphNode(id);
  return node?.type === 'heritage' && node.detail_available && node.raw_id ? node.raw_id : null;
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
  // 地区归属来自项目配置；传统与材料只来自已核验的种子边，避免把
  // 未经证据确认的文本推断伪装成正式图谱关系。
  const config = CRAFT_CONFIG[node.raw_id] || {};
  const districtId = node.district_id || config.districtId;
  const edges = districtId
    ? [{ relation: 'LOCATED_IN', target_id: graphId('region', districtId), source: 'curated_district_mapping' }]
    : [];
  const customRelations = (node.graph_data?.relations || []).map((relation, index) => ({
    relation: relation.type === 'material' ? 'USES_MATERIAL' : relation.type === 'region' ? 'LOCATED_IN' : 'BELONGS_TO_TRADITION',
    target_id: graphId(relation.type || 'tradition', relation.id || `${node.raw_id}_${index}_${relation.title}`),
    source: 'admin_graph_data',
    source_title: node.graph_data?.summary || '',
  }));
  return [
    ...edges,
    ...customRelations,
    ...allGraphEdges()
      .filter((edge) => edge.from === node.id)
      .map((edge) => ({
        relation: edge.relation,
        target_id: edge.to,
        source: edge.source_id,
        source_title: edge.source_title,
        source_url: edge.source_url,
        evidence: edge.evidence || '',
      })),
  ];
}

export function relatedHeritageForRelation(targetId, relation, { excludeId = null } = {}) {
  const target = getGraphNode(targetId);
  if (!target) return [];
  const ids = new Set(
    allGraphEdges()
      .filter((edge) => edge.relation === relation && edge.to === targetId)
      .map((edge) => edge.from),
  );
  if (relation === 'LOCATED_IN' && target.type === 'region') {
    return [...graphNodes()].filter((node) => node.type === 'heritage' && node.district_id === target.raw_id && node.id !== excludeId);
  }
  return [...ids]
    .filter((id) => id !== excludeId)
    .map((id) => getGraphNode(id))
    .filter(Boolean);
}

export function heritageForGraphTarget(targetId, { excludeId = null } = {}) {
  const target = getGraphNode(targetId);
  if (!target) return { target: null, relation: null, nodes: [] };
  if (target.type === 'heritage') return { target, relation: null, nodes: [target] };
  const relation = {
    region: 'LOCATED_IN',
    tradition: 'BELONGS_TO_TRADITION',
    material: 'USES_MATERIAL',
  }[target.type] || null;
  return {
    target,
    relation,
    nodes: relation ? relatedHeritageForRelation(target.id, relation, { excludeId }) : [],
  };
}

export function graphPortals(rootId) {
  const root = getGraphNode(rootId);
  if (!root || root.type !== 'heritage') return [];
  const edges = relationsForNode(rootId);
  return RELATIONS.map((relation) => {
    const candidates = edges
      .filter((item) => item.relation === relation)
      .map((item) => {
        const target = getGraphNode(item.target_id);
        const relatedCount = target
          ? relatedHeritageForRelation(target.id, relation, { excludeId: root.id }).length
          : -1;
        return { item, target, relatedCount };
      })
      .sort((a, b) => b.relatedCount - a.relatedCount);
    const selected = candidates.find((candidate) => candidate.target) || candidates[0];
    const edge = selected?.item;
    const target = selected?.target || null;
    return {
      relation,
      label: relationLabel(relation),
      target,
      evidence: edge?.source || null,
      source_title: edge?.source_title || null,
      source_url: edge?.source_url || null,
      available: Boolean(target),
      result_count: Math.max(0, selected?.relatedCount || 0),
    };
  });
}

export function graphNeighborhood(rootId) {
  const root = getGraphNode(rootId);
  if (!root) return [];
  const nodes = new Map([[root.id, root]]);
  graphPortals(rootId).forEach((portal) => {
    if (!portal.target) return;
    nodes.set(portal.target.id, portal.target);
    relatedHeritageForRelation(portal.target.id, portal.relation, { excludeId: rootId })
      .forEach((node) => nodes.set(node.id, node));
  });
  return [...nodes.values()];
}

export function relatedHeritageForRegion(regionId, { excludeId = null } = {}) {
  const parsed = parseGraphId(regionId);
  if (!parsed || parsed.type !== 'region') return [];
  return allCrafts()
    .filter((craft) => craft.config?.districtId === parsed.rawId && graphId('heritage', craft.craftId) !== excludeId)
    .map(craftNode);
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
