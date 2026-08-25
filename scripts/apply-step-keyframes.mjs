import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildContentSeed } from './content-seed.mjs';
import { createUnifiedContentStore } from '../server/unified-content-store.mjs';

const ROOT = join(import.meta.dirname, '..');
const DB_PATH = String(process.env.CONTENT_DB_PATH || '').trim() || join(ROOT, '.content', 'content.db');
const RESTORE_MISSING_STEPS = process.argv.includes('--restore-missing-steps');

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function makeStepImage({ pkg, step, keyframe }) {
  const imageUrl = `data/${pkg.directory}/${keyframe.frame_path}`;
  const label = step.name || step.actions?.[0]?.label || `工序 ${step.sort || ''}`.trim();
  const evidenceId = keyframe.evidence_id || step.evidence_ids?.[0] || '';
  const sourceTimeMs = Number(keyframe.time_ms || 0);
  return {
    image_url: imageUrl,
    alt: `${label}纪录片关键帧`,
    source_time_ms: sourceTimeMs,
    evidence_id: evidenceId,
    match_level: keyframe.match_level || 'representative',
    note: keyframe.note || '',
  };
}

const catalog = await readJson(join(ROOT, 'data', 'catalog.json'));
const packagesByVideoId = new Map(catalog.packages.map((pkg) => [pkg.video_id, pkg]));
const keyframesByStepId = new Map();

for (const pkg of catalog.packages) {
  const doc = await readJson(join(ROOT, 'data', pkg.directory, 'media', 'step_keyframes.json'));
  for (const keyframe of doc.steps || []) {
    keyframesByStepId.set(keyframe.step_id, { pkg, keyframe });
  }
}

const seedContent = await buildContentSeed();
const store = await createUnifiedContentStore({
  dbPath: DB_PATH,
  legacyContentPath: join(ROOT, '.content', 'content.json'),
  legacyCommunityPath: join(ROOT, '.content', 'community.json'),
  seedContent,
  seedCommunity: { version: 1, submissions: [] },
});

try {
  const current = store.read('content');
  const counts = new Map();
  let updated = 0;
  const currentStepIds = new Set(current.craft_steps.map((step) => step.id));
  const missingSteps = seedContent.craft_steps.filter((step) => (
    keyframesByStepId.has(step.id) && !currentStepIds.has(step.id)
  ));
  const sourceSteps = RESTORE_MISSING_STEPS
    ? [...current.craft_steps, ...missingSteps]
    : current.craft_steps;
  if (RESTORE_MISSING_STEPS && missingSteps.length) {
    console.log(`从数据包补回 ${missingSteps.length} 道旧内容库缺失的工序：${missingSteps.map((step) => step.id).join('、')}`);
  } else if (missingSteps.length) {
    console.log(`保留当前内容库结构，跳过 ${missingSteps.length} 道不存在的工序：${missingSteps.map((step) => step.id).join('、')}`);
  }
  const craftSteps = sourceSteps.map((step) => {
    const mapping = keyframesByStepId.get(step.id);
    if (!mapping) return step;
    const pkg = packagesByVideoId.get(step.craft_id) || mapping.pkg;
    const stepImage = makeStepImage({ pkg, step, keyframe: mapping.keyframe });
    const preservedClips = (step.documentary_clips || []).filter((item) => (
      item?.video_url || (item?.image_url && item.image_url !== stepImage.image_url)
    ));
    updated += 1;
    counts.set(step.craft_id, (counts.get(step.craft_id) || 0) + 1);
    return {
      ...step,
      step_image: stepImage,
      documentary_clips: preservedClips,
    };
  });

  const expectedUpdates = keyframesByStepId.size - (RESTORE_MISSING_STEPS ? 0 : missingSteps.length);
  if (updated !== expectedUpdates) {
    throw new Error(`关键帧映射接入数量异常：预计更新 ${expectedUpdates} 条，实际更新 ${updated} 条。`);
  }

  const next = store.write('content', { ...current, revision: '', craft_steps: craftSteps });
  console.log(`已写入 ${updated} 道工序，内容版本：${next.revision}`);
  console.log(`内容库：${DB_PATH}`);
  for (const pkg of catalog.packages) {
    console.log(`${pkg.video_id}: ${counts.get(pkg.video_id) || 0} 道工序`);
  }
} finally {
  store.close();
}
