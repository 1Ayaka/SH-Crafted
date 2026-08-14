import { access } from 'node:fs/promises';
import { dirname, join, normalize, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dbPath = normalize(process.argv[2] || process.env.CONTENT_DB_PATH || join(process.cwd(), '.content', 'content.db'));
const uploadDir = normalize(process.argv[3] || process.env.CONTENT_UPLOAD_DIR || join(dirname(dbPath), 'uploads'));
const db = new DatabaseSync(dbPath, { readOnly: true });

function compose(storeName) {
  const meta = db.prepare('SELECT revision, updated_at, root_payload FROM store_meta WHERE store_name = ?').get(storeName);
  if (!meta) return null;
  const value = JSON.parse(meta.root_payload);
  const rows = db.prepare('SELECT collection, payload FROM store_entities WHERE store_name = ? ORDER BY collection, rowid').all(storeName);
  for (const row of rows) {
    value[row.collection] ||= [];
    value[row.collection].push(JSON.parse(row.payload));
  }
  return { ...value, revision: meta.revision, updated_at: meta.updated_at };
}

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values.filter(Boolean)) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

function imageSources(content, community) {
  const values = [];
  const add = (owner, value) => {
    const source = String(value || '').trim();
    if (source) values.push({ owner, source });
  };
  for (const craft of content.crafts || []) add(`craft:${craft.id}:cover`, craft.cover_path);
  for (const image of content.craft_gallery || []) add(`gallery:${image.id || image.craft_id}`, image.image_url || image.source_path);
  for (const step of content.craft_steps || []) add(`step:${step.id}`, step.step_image?.image_url);
  for (const node of content.graph_nodes || []) {
    add(`graph:${node.id}:overview`, node.overview_image);
    for (const [index, image] of (node.images || []).entries()) add(`graph:${node.id}:image:${index + 1}`, image?.image_url || image?.url);
  }
  for (const submission of community?.submissions || []) {
    add(`submission:${submission.id}:cover`, submission.cover_url);
    for (const [index, image] of (submission.images || []).entries()) add(`submission:${submission.id}:image:${index + 1}`, image?.image_url || image?.url);
  }
  return values;
}

function uploadFile(source) {
  const prefix = '/content-uploads/';
  if (!source.startsWith(prefix)) return null;
  const candidate = normalize(join(uploadDir, source.slice(prefix.length)));
  const rel = relative(uploadDir, candidate);
  return !rel || rel.startsWith('..') ? null : candidate;
}

try {
  const quickCheck = db.prepare('PRAGMA quick_check').get()?.quick_check || 'unknown';
  const content = compose('content');
  const community = compose('community');
  if (!content) throw new Error('content store is missing');
  const crafts = content.crafts || [];
  const nodes = content.graph_nodes || [];
  const edges = content.graph_edges || [];
  const craftIds = new Set(crafts.map((craft) => craft.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const missingProjectNodes = crafts.filter((craft) => !nodeIds.has(`heritage:${craft.id}`)).map((craft) => craft.id);
  const missingDistrictEdges = crafts.filter((craft) => craft.district_id && !edges.some((edge) => edge.from === `heritage:${craft.id}` && edge.to === `region:${craft.district_id}` && edge.relation === 'LOCATED_IN')).map((craft) => craft.id);
  const orphanEdges = edges.filter((edge) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to)).map((edge) => edge.id || `${edge.from}|${edge.relation}|${edge.to}`);
  const graphOnlyHeritage = nodes.filter((node) => node.type === 'heritage' && !craftIds.has(node.raw_id)).map((node) => ({ id: node.id, title: node.title || '' }));
  const staleProjectNodes = nodes.filter((node) => {
    if (node.type !== 'heritage' || !craftIds.has(node.raw_id)) return false;
    const craft = crafts.find((item) => item.id === node.raw_id);
    return node.title !== craft.title || node.summary !== (craft.graph_data?.summary || craft.summary || '') || node.district_id !== (craft.district_id || '') || node.overview_image !== (craft.cover_path || '');
  }).map((node) => node.id);
  const missingImages = [];
  const suspiciousImages = [];
  for (const item of imageSources(content, community)) {
    const file = uploadFile(item.source);
    if (file && await access(file).then(() => false).catch(() => true)) missingImages.push(item);
    else if (/^(?:blob:|data:)/i.test(item.source) || (!file && !/^(?:https?:\/\/|\/|assets\/|data\/)/i.test(item.source))) {
      suspiciousImages.push({ owner: item.owner, source_preview: item.source.slice(0, 160), source_length: item.source.length });
    }
  }
  const report = {
    ok: quickCheck === 'ok' && !duplicates(crafts.map((craft) => craft.id)).length && !duplicates(nodes.map((node) => node.id)).length && !orphanEdges.length,
    database: { path: dbPath, quick_check: quickCheck },
    revisions: {
      content: content.revision,
      community: community?.revision || '',
    },
    counts: {
      crafts: crafts.length,
      steps: (content.craft_steps || []).length,
      gallery: (content.craft_gallery || []).length,
      graph_nodes: nodes.length,
      graph_edges: edges.length,
      graph_only_heritage: graphOnlyHeritage.length,
      submissions: (community?.submissions || []).length,
    },
    blocking: {
      duplicate_craft_ids: duplicates(crafts.map((craft) => craft.id)),
      duplicate_graph_node_ids: duplicates(nodes.map((node) => node.id)),
      orphan_edges: orphanEdges,
    },
    synchronization: {
      missing_project_nodes: missingProjectNodes,
      missing_district_edges: missingDistrictEdges,
      stale_project_nodes: staleProjectNodes,
      graph_only_heritage_count: graphOnlyHeritage.length,
      graph_only_heritage_sample: graphOnlyHeritage.slice(0, 20),
    },
    image_warnings: {
      missing_local_files: missingImages,
      suspicious_sources: suspiciousImages,
      projects_without_cover: crafts.filter((craft) => !String(craft.cover_path || '').trim()).map((craft) => craft.id),
    },
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  db.close();
}
