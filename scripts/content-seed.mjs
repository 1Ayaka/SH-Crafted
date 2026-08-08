import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GRAPH_SEED_EDGES, GRAPH_SEED_NODES } from '../js/graph-seed.js';
import { CURATED_GRAPH_EDGES, CURATED_GRAPH_NODES } from '../js/graph-curated-catalog.js';

const ROOT = join(import.meta.dirname, '..');

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readJsonl(path) {
  const raw = await readFile(path, 'utf8');
  return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(JSON.parse);
}

export async function buildContentSeed() {
  const config = await import(pathToFileURL(join(ROOT, 'js', 'config.js')));
  const catalog = await readJson(join(ROOT, 'data', 'catalog.json'));
  const currentDistrictIds = new Set(config.DISTRICTS.map((district) => district.id));
  // 地图模型还保留“南汇区”等历史区划节点。资料档案可以独立于
  // 现行 16 区平面示意图存在，这样后台保存时仍能找到对应记录。
  const districtRecords = [
    ...config.DISTRICTS,
    ...Object.entries(config.DISTRICT_PROFILES)
      .filter(([id]) => !currentDistrictIds.has(id))
      .map(([id, profile]) => ({ id, name: profile.name || id })),
  ];
  const districts = districtRecords.map((district, index) => {
    const profile = config.DISTRICT_PROFILES[district.id] || {};
    return {
      id: district.id,
      sort: index + 1,
      name: profile.name || district.name,
      origin: profile.origin || '',
      features: profile.features || '',
      heritage_overview: profile.heritageOverview || '',
      source_label: profile.sourceLabel || '',
      source_url: profile.sourceUrl || '',
    };
  });

  const crafts = [];
  const craftSteps = [];
  const craftGallery = [];
  for (const [craftIndex, pkg] of catalog.packages.entries()) {
    const directory = join(ROOT, 'data', pkg.directory);
    const draft = await readJson(join(directory, 'knowledge', 'knowledge_draft.json'));
    const steps = await readJsonl(join(directory, 'knowledge', 'process_steps.jsonl'));
    const curated = config.CRAFT_CONFIG[pkg.video_id] || {};
    crafts.push({
      id: pkg.video_id,
      sort: craftIndex + 1,
      title: curated.craftName || pkg.title,
      district_id: curated.districtId || null,
      category: curated.category || '',
      summary: draft.summary_candidate || '',
      cover_path: curated.heroFrame ? `data/${pkg.directory}/${curated.heroFrame}` : '',
      source_directory: pkg.directory,
    });

    steps
      .slice()
      .sort((a, b) => (a.order_candidate ?? 999) - (b.order_candidate ?? 999))
      .forEach((step, stepIndex) => {
        const interaction = config.INTERACTION_OVERRIDES[step.step_id] || step.interaction_mapping || {};
        const action = interaction.action || {
          id: `${step.step_id}_action`,
          label: step.name || String(step.action || '').split(/[，。；,.;]/)[0].slice(0, 18) || `工序 ${stepIndex + 1}`,
        };
        craftSteps.push({
          id: step.step_id,
          sort: stepIndex + 1,
          craft_id: pkg.video_id,
          source_step_id: step.step_id,
          name: step.name || '',
          action: step.action || '',
          result: step.result || '',
          materials: step.materials || [],
          material_transforms: (step.materials || []).map((name) => ({ input_name: name, output_name: name })),
          tools: step.tools || [],
          resource_groups: interaction.resource_groups || null,
          actions: [action],
          correct_action_id: action.id,
          quick_fill: interaction.quick_fill || null,
          evidence_ids: step.evidence_ids || [],
          review_status: step.review_status || 'needs_review',
        });
      });

    for (const [workIndex, work] of (curated.works || []).entries()) {
      craftGallery.push({
        id: `${pkg.video_id}_work_${String(workIndex + 1).padStart(2, '0')}`,
        sort: workIndex + 1,
        craft_id: pkg.video_id,
        title: work.name || '',
        source_path: work.frame ? `data/${pkg.directory}/${work.frame}` : '',
        evidence_id: work.evidenceId || '',
      });
    }
  }

  const siteTexts = [
    { key: 'home.title', group_name: '首页', label: '首页主标题', content: '从地图看上海手艺。' },
    { key: 'home.lede', group_name: '首页', label: '首页介绍', content: '按地区浏览非遗项目，查看工序与影像资料，并在交互工作台中完成一次简化制作。' },
    { key: 'home.source_button', group_name: '首页', label: '资料来源按钮', content: '资料来源' },
    { key: 'home.stats_note', group_name: '首页', label: '数据统计说明', content: '统计来自已加载的真实数据包，其余地区资料待接入' },
    { key: 'craft.inherit_button', group_name: '非遗项目', label: '进入体验按钮', content: '成为传承人' },
    { key: 'map.center.name', group_name: '地图', label: '中心城区名称', content: '上海中心城区' },
    { key: 'map.center.origin', group_name: '地图', label: '中心城区区域关系', content: '地图模型将黄浦、徐汇、长宁、静安、普陀五区聚合为中心城区节点；项目仍分别维护各自的现行行政区 ID。' },
    { key: 'map.center.features', group_name: '地图', label: '中心城区地域特色', content: '黄浦的老城厢与外滩、徐汇的衡复风貌与龙华、长宁的多元社区、静安的苏州河两岸、普陀的工业水岸，共同构成上海中心城区的多层城市文化。' },
    { key: 'map.center.heritage_overview', group_name: '地图', label: '中心城区非遗概览', content: '这里汇集五区已审核和后续新增的非遗内容，覆盖传统美术、服饰工艺、饮食、戏曲、民俗与城市生活技艺。' },
    { key: 'footer.icp', group_name: '页脚', label: 'ICP备案号', content: '滇ICP备2026003342号' },
  ];

  const graphNodes = new Map();
  const addNode = (node) => { if (node?.id && !graphNodes.has(node.id)) graphNodes.set(node.id, structuredClone(node)); };
  [...GRAPH_SEED_NODES, ...CURATED_GRAPH_NODES].forEach(addNode);
  districts.forEach((district) => addNode({
    id: `region:${district.id}`, type: 'region', title: district.name, aliases: [district.name, district.name.replace(/区$/, '')],
    summary: district.heritage_overview || '', source_ids: district.source_url ? [`region_source:${district.id}`] : [],
    source_title: district.source_label || '', source_url: district.source_url || '', review_status: 'published', published: true,
  }));
  crafts.forEach((craft) => addNode({
    id: `heritage:${craft.id}`, type: 'heritage', title: craft.title, aliases: [craft.title], summary: craft.summary,
    district_id: craft.district_id, heritage_level: /^SHIH_000[1-8]$/.test(craft.id) ? 'primary' : 'secondary',
    protected: /^SHIH_000[1-8]$/.test(craft.id), published: true, review_status: 'published',
  }));
  const graphEdges = new Map();
  const addEdge = (edge) => {
    if (!edge?.from || !edge?.to || !edge?.relation) return;
    const id = edge.id || `${edge.from}|${edge.relation}|${edge.to}`;
    if (!graphEdges.has(id)) graphEdges.set(id, { ...structuredClone(edge), id });
  };
  [...GRAPH_SEED_EDGES, ...CURATED_GRAPH_EDGES].forEach((edge) => addEdge({ ...edge, origin: edge.origin || 'curated_seed' }));
  crafts.filter((craft) => craft.district_id).forEach((craft) => addEdge({
    from: `heritage:${craft.id}`, relation: 'LOCATED_IN', to: `region:${craft.district_id}`,
    origin: 'craft_district', review_status: 'published', published: true,
  }));

  return {
    version: 1,
    updated_at: new Date().toISOString(),
    districts,
    crafts,
    craft_steps: craftSteps,
    craft_gallery: craftGallery,
    site_texts: siteTexts,
    graph_nodes: [...graphNodes.values()],
    graph_edges: [...graphEdges.values()],
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const content = await buildContentSeed();
  console.log(JSON.stringify({
    districts: content.districts.length,
    crafts: content.crafts.length,
    craft_steps: content.craft_steps.length,
    craft_gallery: content.craft_gallery.length,
    graph_nodes: content.graph_nodes.length,
    graph_edges: content.graph_edges.length,
    site_texts: content.site_texts.length,
  }, null, 2));
}
