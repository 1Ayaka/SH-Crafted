import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

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
    { key: 'footer.icp', group_name: '页脚', label: 'ICP备案号', content: '滇ICP备2026003342号' },
  ];

  return {
    version: 1,
    updated_at: new Date().toISOString(),
    districts,
    crafts,
    craft_steps: craftSteps,
    craft_gallery: craftGallery,
    site_texts: siteTexts,
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const content = await buildContentSeed();
  console.log(JSON.stringify({
    districts: content.districts.length,
    crafts: content.crafts.length,
    craft_steps: content.craft_steps.length,
    craft_gallery: content.craft_gallery.length,
    site_texts: content.site_texts.length,
  }, null, 2));
}
