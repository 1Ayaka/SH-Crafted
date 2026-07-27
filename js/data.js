// 数据加载：只读取项目 data/ 下的真实数据包
import { CRAFT_CONFIG, CRAFT_ORDER, INTERACTION_OVERRIDES } from './config.js';

const store = {
  catalog: null,
  crafts: new Map(), // craftId(video_id) -> CraftRecord
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

function actionLabel(step, index) {
  const override = INTERACTION_OVERRIDES[step.step_id]?.action;
  if (override?.label) return override;
  const mappingAction = step.interaction_mapping?.action;
  if (mappingAction?.label) return mappingAction;
  const name = stepDisplayName(step, index);
  return { id: step.step_id + '_action', label: name };
}

// 兼容旧 process_steps：materials 与 tools 都转成可选资源。
// 旧数组无法表达“全部需要/任选其一”，因此默认每组至少选一个，并标记为 legacy_candidate。
// 人工规则可以通过 interaction_mapping.resource_groups 或 INTERACTION_OVERRIDES 精确覆盖。
function interactionRule(step, index) {
  const override = INTERACTION_OVERRIDES[step.step_id] || {};
  const mapping = step.interaction_mapping || {};
  const materials = uniq(step.materials);
  const tools = uniq(step.tools);
  const explicitGroups = override.resource_groups || mapping.resource_groups;
  const groups = explicitGroups || [
    ...(materials.length ? [{ id: 'materials', label: '相关材料', mode: 'any', min: 1, options: materials }] : []),
    ...(tools.length ? [{ id: 'implements', label: '相关物件', mode: 'any', min: 1, options: tools }] : []),
  ];
  const normalizedGroups = groups.map((group, i) => ({
    id: group.id || `group_${i + 1}`,
    label: group.label || `资源组 ${i + 1}`,
    mode: group.mode || 'any',
    min: group.mode === 'all' ? uniq(group.options).length : Math.max(0, group.min ?? 1),
    max: group.max ?? null,
    options: uniq(group.options),
  }));
  return {
    schema_version: '2.0',
    source: explicitGroups ? 'curated' : 'legacy_candidate',
    action: override.action || mapping.action || actionLabel(step, index),
    resource_groups: normalizedGroups,
    allowed_resources: uniq(normalizedGroups.flatMap((group) => group.options)),
    review_status: override.review_status || mapping.review_status || step.review_status || 'needs_review',
  };
}

export async function loadAll(onProgress) {
  if (store.catalog) return store;
  const base = 'data/';
  store.catalog = await fetchJson(base + 'catalog.json');

  for (const pkg of store.catalog.packages) {
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
    const normalizedSteps = steps
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
    const record = {
      craftId: pkg.video_id,
      title: pkg.title,
      directory: pkg.directory,
      baseUrl: dir,
      manifest,
      draft,
      summary: draft.summary_candidate || '',
      steps: normalizedSteps,
      evidence,
      evMap,
      claims,
      config: cfg,
      // 由数据推导：材料与工具全集（并集，保持出现顺序）
      allMaterials: [...new Set(steps.flatMap((s) => s.materials || []))],
      allTools: [...new Set(steps.flatMap((s) => s.tools || []))],
      allResources,
      resourceKinds,
      actions: [...new Map(normalizedSteps.map((s) => [s.interactionRule.action.id, s.interactionRule.action])).values()],
      people: [...new Set(evidence.flatMap((e) => e.entities_candidate?.people || []))],
      artifacts: [...new Set(evidence.flatMap((e) => e.entities_candidate?.artifacts || []))],
      places: [...new Set(evidence.flatMap((e) => e.entities_candidate?.places || []))],
    };
    store.crafts.set(pkg.video_id, record);
    onProgress?.(pkg.title);
  }
  return store;
}

export function getCraft(craftId) {
  return store.crafts.get(craftId) || null;
}

export function allCrafts() {
  return CRAFT_ORDER.map((id) => store.crafts.get(id)).filter(Boolean);
}

// 真实统计：仅由已加载数据推导，不虚构
export function trueStats() {
  const crafts = allCrafts();
  const districtIds = new Set(crafts.map((c) => c.config.districtId).filter(Boolean));
  const steps = crafts.reduce((n, c) => n + c.steps.length, 0);
  const evidenceCount = crafts.reduce((n, c) => n + c.evidence.length, 0);
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
