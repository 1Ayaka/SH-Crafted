// 数据加载：只读取项目 data/ 下的真实数据包
import { CRAFT_CONFIG, CRAFT_ORDER, DISTRICT_PROFILES, INTERACTION_OVERRIDES } from './config.js';

const store = {
  catalog: null,
  crafts: new Map(), // craftId(video_id) -> CraftRecord
  knowledgeSources: new Map(),
  externalFacts: [],
  knowledgeStats: null,
  authorityPolicy: {},
  siteTexts: new Map(),
  editorialSource: 'git-fallback',
  revision: '',
  craftLoads: new Map(),
  craftLoaders: new Map(),
};

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`加载失败 ${res.status}: ${url}`);
  return res.json();
}

async function fetchJsonl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`加载失败 ${res.status}: ${url}`);
  const text = await res.text();
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

// 步骤显示名：name 为空时取 action 第一个短句（仍是真实数据内容）
function stepDisplayName(step, index) {
  if (step.name) return step.name;
  const first = (step.action || '').split(/[，。；,.;]/)[0].trim();
  return first.length > 14 ? first.slice(0, 14) + '…' : (first || `步骤 ${index + 1}`);
}

function uniq(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function jsonValue(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    // 兼容旧后台中以空格分隔保存的 tags 字段。
    return Array.isArray(fallback) ? value.split(/\s+/).filter(Boolean) : fallback;
  }
}

function actionLabel(step, index) {
  const override = INTERACTION_OVERRIDES[step.step_id]?.action;
  if (override?.label) return override;
  const mappingAction = step.interaction_mapping?.action;
  if (mappingAction?.label) return mappingAction;
  const name = stepDisplayName(step, index);
  return { id: step.step_id + '_action', label: name };
}

// 兼容旧 process_steps：旧数组无法表达“全部需要/任选其一”，因此仍按每组至少选一个处理。
// 站内后台维护的工序默认把列出的材料与工具视为必需项；显式分组规则优先。
// 人工规则也可以通过 interaction_mapping.resource_groups 或 INTERACTION_OVERRIDES 精确覆盖。
function interactionRule(step, index) {
  const override = INTERACTION_OVERRIDES[step.step_id] || {};
  const mapping = step.interaction_mapping || {};
  const materials = uniq(step.materials);
  const tools = uniq(step.tools);
  const managedGroups = jsonValue(step.managed_resource_groups, null);
  const explicitGroups = step.site_managed
    ? (managedGroups || override.resource_groups || mapping.resource_groups)
    : (override.resource_groups || mapping.resource_groups);
  const fallbackMode = step.site_managed ? 'all' : 'any';
  const groups = explicitGroups || [
    ...(materials.length ? [{ id: 'materials', label: '所需材料', mode: fallbackMode, min: fallbackMode === 'all' ? materials.length : 1, options: materials }] : []),
    ...(tools.length ? [{ id: 'implements', label: '所需工具', mode: fallbackMode, min: fallbackMode === 'all' ? tools.length : 1, options: tools }] : []),
  ];
  const normalizedGroups = groups.map((group, i) => ({
    id: group.id || `group_${i + 1}`,
    label: group.label || `资源组 ${i + 1}`,
    mode: group.mode || 'any',
    min: group.mode === 'all' ? uniq(group.options).length : Math.max(0, group.min ?? 1),
    max: group.max ?? null,
    options: uniq(group.options),
  }));
  const storedActions = jsonValue(step.managed_actions ?? step.actions, []);
  const actions = Array.isArray(storedActions) && storedActions.length
    ? storedActions.map((action, actionIndex) => ({
      id: action.id || `${step.step_id}_action_${actionIndex + 1}`,
      label: action.label || `操作 ${actionIndex + 1}`,
    }))
    : [override.action || mapping.action || actionLabel(step, index)];
  const correctActionId = step.managed_correct_action_id || step.correct_action_id;
  const correctAction = actions.find((action) => action.id === correctActionId) || actions[0];
  return {
    schema_version: '2.0',
    source: step.site_managed ? 'admin' : (explicitGroups ? 'curated' : 'legacy_candidate'),
    action: correctAction,
    actions,
    resource_groups: normalizedGroups,
    allowed_resources: uniq(normalizedGroups.flatMap((group) => group.options)),
    quick_fill: step.site_managed && step.managed_has_quick_fill
      ? step.managed_quick_fill
      : (override.quick_fill || mapping.quick_fill || null),
    review_status: override.review_status || mapping.review_status || step.review_status || 'needs_review',
  };
}

export async function loadAll(onProgress) {
  if (store.catalog) return store;
  const base = 'data/';
  const [catalog, sourceDoc, externalFacts, knowledgeStats, editorial] = await Promise.all([
    fetchJson(base + 'catalog.json'),
    fetchJson(base + 'knowledge-base/sources.json'),
    fetchJsonl(base + 'knowledge-base/facts.jsonl'),
    fetchJson(base + 'knowledge-base/stats.json'),
    fetchJson('/api/content').catch(() => null),
  ]);
  store.catalog = catalog;
  store.knowledgeSources = new Map(sourceDoc.sources.map((source) => [source.source_id, source]));
  store.externalFacts = externalFacts;
  store.knowledgeStats = knowledgeStats;
  store.authorityPolicy = sourceDoc.authority_policy || {};
  store.editorialSource = editorial?.source || 'git-fallback';
  store.revision = editorial?.revision || '';
  store.siteTexts = new Map((editorial?.site_texts || []).map((item) => [item.key, item.content]));

  for (const profile of editorial?.districts || []) {
    const fallback = DISTRICT_PROFILES[profile.id] || {};
    DISTRICT_PROFILES[profile.id] = {
      ...fallback,
      // A persisted blank means "not edited yet", not "erase the curated
      // fallback". This also lets newly added district profiles appear on an
      // existing deployment before an editor saves its first revision.
      name: profile.name || fallback.name || '',
      origin: profile.origin || fallback.origin || '',
      features: profile.features || fallback.features || '',
      heritageOverview: profile.heritage_overview || fallback.heritageOverview || '',
      sourceLabel: profile.source_label || fallback.sourceLabel || '',
      sourceUrl: profile.source_url || fallback.sourceUrl || '',
    };
  }

  const editorialCrafts = new Map((editorial?.crafts || []).map((item) => [item.id, item]));
  const editorialSteps = new Map();
  for (const step of editorial?.craft_steps || []) {
    if (!editorialSteps.has(step.craft_id)) editorialSteps.set(step.craft_id, []);
    editorialSteps.get(step.craft_id).push(step);
  }
  const editorialGallery = new Map();
  for (const work of editorial?.craft_gallery || []) {
    if (!editorialGallery.has(work.craft_id)) editorialGallery.set(work.craft_id, []);
    editorialGallery.get(work.craft_id).push(work);
  }

  // Put a lightweight catalogue record on screen immediately. The five
  // package files (claims/evidence/steps/etc.) are hydrated only when that
  // particular detail page is opened (or the evidence passport requests all).
  for (const pkg of store.catalog.packages) {
    const cfg = CRAFT_CONFIG[pkg.video_id] || {};
    const managedCraft = editorialCrafts.get(pkg.video_id);
    if (managedCraft) {
      cfg.craftName = managedCraft.title || cfg.craftName;
      cfg.districtId = managedCraft.district_id || cfg.districtId;
      cfg.category = managedCraft.category || cfg.category;
      if (managedCraft.cover_path) cfg.heroFrame = managedCraft.cover_path.replace(`data/${pkg.directory}/`, '');
      if (managedCraft.graph_data) cfg.graphData = managedCraft.graph_data;
    }
    const managedWorks = editorialGallery.get(pkg.video_id);
    if (managedWorks?.length) cfg.works = managedWorks.slice().sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999)).map((work) => ({
      frame: work.image_url || work.source_path,
      name: work.title || '',
      evidenceId: work.evidence_id || '',
    }));
    const summary = managedCraft?.summary || '';
    const metrics = knowledgeStats?.per_craft?.[pkg.video_id] || {};
    store.crafts.set(pkg.video_id, {
      craftId: pkg.video_id, title: managedCraft?.title || pkg.title,
      directory: pkg.directory, baseUrl: base + pkg.directory + '/',
      manifest: { video: { source_filename: pkg.title } }, draft: { summary_candidate: summary }, summary,
      steps: [], evidence: [], evMap: new Map(), claims: [], config: cfg,
      allMaterials: [], allTools: [], allResources: [], resourceKinds: new Map(), actions: [],
      people: [], artifacts: [], places: [], externalFacts: [], externalSources: [],
      stepCount: editorialSteps.get(pkg.video_id)?.length || metrics.steps || 0,
      evidenceCount: metrics.video_evidence || 0,
      hydrated: false,
    });
  }

  // Each package is independent. Loading them concurrently avoids multiplying
  // network round-trip latency by the number of heritage packages.
  store.catalog.packages.forEach((pkg) => {
    const loader = () => (async () => {
    const dir = base + pkg.directory + '/';
    const [manifest, draft, steps, evidence, claims] = await Promise.all([
      fetchJson(dir + 'manifest.json'),
      fetchJson(dir + 'knowledge/knowledge_draft.json'),
      fetchJsonl(dir + 'knowledge/process_steps.jsonl'),
      fetchJsonl(dir + 'knowledge/evidence.jsonl'),
      fetchJsonl(dir + 'knowledge/claims.jsonl'),
    ]);
    const evMap = new Map(evidence.map((e) => [e.evidence_id, e]));
    const cfg = CRAFT_CONFIG[pkg.video_id] || {};
    const managedCraft = editorialCrafts.get(pkg.video_id);
    if (managedCraft) {
      cfg.craftName = managedCraft.title || cfg.craftName;
      cfg.districtId = managedCraft.district_id || cfg.districtId;
      cfg.category = managedCraft.category || cfg.category;
      if (managedCraft.cover_path) cfg.heroFrame = managedCraft.cover_path.replace(`data/${pkg.directory}/`, '');
    }
    const managedWorks = editorialGallery.get(pkg.video_id);
    if (managedWorks?.length) {
      cfg.works = managedWorks
        .slice()
        .sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999))
        .map((work) => ({
          frame: work.image_url || work.source_path,
          name: work.title || '',
          evidenceId: work.evidence_id || '',
        }));
    }

    const sourceSteps = new Map(steps.map((step) => [step.step_id, step]));
    const managedSteps = editorialSteps.get(pkg.video_id);
    const effectiveSteps = managedSteps?.length
      ? managedSteps.map((step) => ({
        ...(sourceSteps.get(step.source_step_id || step.id) || {}),
        step_id: step.id,
        video_id: pkg.video_id,
        order_candidate: step.sort,
        name: step.name || '',
        action: step.action || '',
        guide_text: step.guide_text || '',
        guide_bold_ranges: jsonValue(step.guide_bold_ranges, []),
        result: step.result || '',
        materials: jsonValue(step.materials, []),
        material_transforms: jsonValue(step.material_transforms, []),
        tools: jsonValue(step.tools, []),
        resource_visuals: jsonValue(step.resource_visuals, []),
        documentary_clips: jsonValue(step.documentary_clips, []),
        evidence_ids: jsonValue(step.evidence_ids, []),
        review_status: step.review_status || 'needs_review',
        managed_resource_groups: jsonValue(step.resource_groups, null),
        managed_quick_fill: jsonValue(step.quick_fill, null),
        managed_has_quick_fill: Object.prototype.hasOwnProperty.call(step, 'quick_fill'),
        managed_actions: jsonValue(step.actions, []),
        managed_correct_action_id: step.correct_action_id || '',
        site_managed: true,
      }))
      : steps;
    const normalizedSteps = effectiveSteps
      .slice()
      .sort((a, b) => (a.order_candidate ?? 99) - (b.order_candidate ?? 99))
      .map((s, i) => ({
        ...s,
        displayName: stepDisplayName(s, i),
        interactionRule: interactionRule(s, i),
      }));
    const resourceKinds = new Map();
    for (const step of normalizedSteps) {
      for (const name of step.materials || []) if (!resourceKinds.has(name)) resourceKinds.set(name, 'material');
      for (const name of step.tools || []) if (!resourceKinds.has(name)) resourceKinds.set(name, 'implement');
    }
    const allResources = uniq(normalizedSteps.flatMap((s) => s.interactionRule.allowed_resources));
    const craftExternalFacts = externalFacts
      .filter((fact) => fact.craft_ids?.includes(pkg.video_id))
      .map((fact) => ({
        ...fact,
        sources: (fact.source_ids || []).map((sourceId) => store.knowledgeSources.get(sourceId)).filter(Boolean),
      }));
    const craftExternalSources = [...new Map(
      craftExternalFacts.flatMap((fact) => fact.sources).map((source) => [source.source_id, source]),
    ).values()];
    const record = {
      craftId: pkg.video_id,
      title: managedCraft?.title || pkg.title,
      directory: pkg.directory,
      baseUrl: dir,
      manifest,
      draft,
      summary: managedCraft?.summary || draft.summary_candidate || '',
      steps: normalizedSteps,
      evidence,
      evMap,
      claims,
      config: cfg,
      // 由数据推导：材料与工具全集（并集，保持出现顺序）
      allMaterials: [...new Set(normalizedSteps.flatMap((s) => s.materials || []))],
      allTools: [...new Set(normalizedSteps.flatMap((s) => s.tools || []))],
      allResources,
      resourceKinds,
      actions: [...new Map(normalizedSteps.flatMap((s) => s.interactionRule.actions).map((action) => [action.id, action])).values()],
      people: [...new Set(evidence.flatMap((e) => e.entities_candidate?.people || []))],
      artifacts: [...new Set(evidence.flatMap((e) => e.entities_candidate?.artifacts || []))],
      places: [...new Set(evidence.flatMap((e) => e.entities_candidate?.places || []))],
      externalFacts: craftExternalFacts,
      externalSources: craftExternalSources,
    };
    Object.assign(store.crafts.get(pkg.video_id), record, {
      stepCount: normalizedSteps.length,
      evidenceCount: evidence.length,
      hydrated: true,
    });
    onProgress?.(pkg.title);
    return record;
    })().catch((error) => {
      const record = store.crafts.get(pkg.video_id);
      if (record) record.loadError = error;
      console.warn(`Craft package deferred load failed: ${pkg.video_id}`, error);
      return null;
    });
    store.craftLoaders.set(pkg.video_id, loader);
  });

  // Approved community submissions have no source package directory. They are
  // promoted into the same runtime craft/step/gallery schema and receive a
  // lightweight record here so map, detail and admin views can treat them like
  // the original projects.
  for (const managedCraft of editorialCrafts.values()) {
    if (store.crafts.has(managedCraft.id)) continue;
    const managedCraftSteps = (editorialSteps.get(managedCraft.id) || [])
      .slice()
      .sort((a, b) => (a.sort ?? 99) - (b.sort ?? 99))
      .map((step, index) => {
        const normalized = {
          ...step,
          step_id: step.id,
          video_id: managedCraft.id,
          order_candidate: step.sort,
          name: step.name || '',
          action: step.action || '',
          guide_text: step.guide_text || '',
          guide_bold_ranges: jsonValue(step.guide_bold_ranges, []),
          result: step.result || '',
          materials: jsonValue(step.materials, []),
          material_transforms: jsonValue(step.material_transforms, []),
          tools: jsonValue(step.tools, []),
          resource_visuals: jsonValue(step.resource_visuals, []),
          documentary_clips: jsonValue(step.documentary_clips, []),
          evidence_ids: [],
          managed_resource_groups: jsonValue(step.resource_groups, null),
          managed_quick_fill: jsonValue(step.quick_fill, null),
          managed_has_quick_fill: Object.prototype.hasOwnProperty.call(step, 'quick_fill'),
          managed_actions: jsonValue(step.actions, []),
          managed_correct_action_id: step.correct_action_id || '',
          site_managed: true,
        };
        return { ...normalized, displayName: stepDisplayName(normalized, index), interactionRule: interactionRule(normalized, index) };
      });
    const resourceKinds = new Map();
    for (const step of managedCraftSteps) {
      for (const name of step.materials || []) if (!resourceKinds.has(name)) resourceKinds.set(name, 'material');
      for (const name of step.tools || []) if (!resourceKinds.has(name)) resourceKinds.set(name, 'implement');
    }
    const works = (editorialGallery.get(managedCraft.id) || [])
      .slice()
      .sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999))
      .map((work) => ({ frame: work.image_url || work.source_path || '', name: work.title || '', evidenceId: '' }));
    const district = DISTRICT_PROFILES[managedCraft.district_id] || {};
    const sequence = store.crafts.size;
    const anchor = { x: 0.3 + (sequence % 4) * 0.13, y: 0.34 + (sequence % 3) * 0.13 };
    const details = managedCraft.community_details || {};
    const claims = [details.history, details.features].filter(Boolean).map((statement, index) => ({
      claim_id: `${managedCraft.id}_community_${index + 1}`,
      statement,
      evidence_ids: [],
      review_status: 'approved_community',
    }));
    const allResources = uniq(managedCraftSteps.flatMap((step) => step.interactionRule.allowed_resources));
    store.crafts.set(managedCraft.id, {
      craftId: managedCraft.id,
      title: managedCraft.title,
      directory: '',
      baseUrl: '',
      manifest: { video: { source_filename: '社区投稿' } },
      draft: { summary_candidate: managedCraft.summary || '' },
      summary: managedCraft.summary || '',
      steps: managedCraftSteps,
      evidence: [],
      evMap: new Map(),
      claims,
      config: {
        craftName: managedCraft.title,
        districtId: managedCraft.district_id,
        districtLabel: district.name || '地区待审核',
        districtVerified: true,
        category: managedCraft.category || '类别待审核',
        heroFrame: managedCraft.cover_path || '',
        modelPath: managedCraft.model_path || '',
        works,
        anchor,
        backgroundManifest: 'assets/bg2/manifest.json',
        community: true,
        contentSource: managedCraft.source || 'community',
        heritageLevel: managedCraft.source === 'admin-import' ? 'primary' : 'secondary',
        graphData: managedCraft.graph_data || details.star_data || {},
      },
      allMaterials: [...new Set(managedCraftSteps.flatMap((step) => step.materials || []))],
      allTools: [...new Set(managedCraftSteps.flatMap((step) => step.tools || []))],
      allResources,
      resourceKinds,
      actions: [...new Map(managedCraftSteps.flatMap((step) => step.interactionRule.actions).map((action) => [action.id, action])).values()],
      people: [],
      artifacts: [],
      places: [],
      externalFacts: [],
      externalSources: [],
      communityDetails: details,
    });
    onProgress?.(managedCraft.title);
  }
  return store;
}

export function getCraft(craftId) {
  return store.crafts.get(craftId) || null;
}

export async function ensureCraftLoaded(craftId) {
  let pending = store.craftLoads.get(craftId);
  if (!pending && store.craftLoaders.has(craftId)) {
    pending = store.craftLoaders.get(craftId)();
    store.craftLoads.set(craftId, pending);
  }
  if (pending) await pending;
  return getCraft(craftId);
}

export async function hydrateAllCrafts() {
  const ids = [...store.craftLoaders.keys()];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, ids.length) }, async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      await ensureCraftLoaded(id);
    }
  });
  await Promise.all(workers);
  return allCrafts();
}

export function allCrafts() {
  const known = CRAFT_ORDER.map((id) => store.crafts.get(id)).filter(Boolean);
  const community = [...store.crafts.values()].filter((craft) => !CRAFT_ORDER.includes(craft.craftId));
  return known.concat(community);
}

export function knowledgeOverview() {
  return {
    stats: store.knowledgeStats,
    sources: [...store.knowledgeSources.values()],
    externalFacts: store.externalFacts,
    authorityPolicy: store.authorityPolicy,
  };
}

// 真实统计：仅由已加载数据推导，不虚构
export function trueStats() {
  const crafts = allCrafts();
  const districtIds = new Set(crafts.map((c) => c.config.districtId).filter(Boolean));
  const steps = crafts.reduce((n, c) => n + (c.stepCount ?? c.steps.length), 0);
  const evidenceCount = crafts.reduce((n, c) => n + (c.evidenceCount ?? c.evidence.length), 0);
  return {
    craftCount: crafts.length,
    districtCount: districtIds.size,
    stepCount: steps,
    evidenceCount,
  };
}

export function msToTimecode(ms) {
  const total = Math.round((ms || 0) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function evidenceTimecode(ev) {
  return `${msToTimecode(ev.start_ms)}–${msToTimecode(ev.end_ms)}`;
}

export function siteText(key, fallback = '') {
  return store.siteTexts.get(key) || fallback;
}

export function contentRevision() {
  return store.revision;
}

export function craftAssetUrl(craft, path) {
  if (!path) return '';
  if (/^(?:https?:)?\/\//.test(path) || path.startsWith('/')) return path;
  if (path.startsWith('data/')) return path;
  return craft.baseUrl + path;
}
