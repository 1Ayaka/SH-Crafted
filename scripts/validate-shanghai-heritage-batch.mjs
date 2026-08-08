import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(process.env.HERITAGE_BATCH_PATH
  || join(process.env.USERPROFILE || '.', 'Desktop', '探物志-上海非遗补充'));
const districtIds = [
  'baoshan', 'changning', 'chongming', 'fengxian', 'hongkou', 'huangpu', 'jiading', 'jingan',
  'jinshan', 'minhang', 'pudong', 'putuo', 'qingpu', 'songjiang', 'xuhui', 'yangpu',
];
const expected = { admin: 2, user: 6 };
const errors = [];
const warnings = [];
const records = { admin: [], user: [] };

function issue(list, file, message) {
  list.push({ file: file.replace(`${root}\\`, ''), message });
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validEmbeddedPng(value) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(value || ''));
  if (!match) return false;
  try {
    const data = Buffer.from(match[1], 'base64');
    return data.length > 100 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  } catch {
    return false;
  }
}

function checkImage(image, file, label) {
  if (!image || typeof image !== 'object') {
    issue(errors, file, `${label} 缺失`);
    return;
  }
  if (!hasText(image.image_url)) issue(errors, file, `${label}.image_url 为空`);
  if (!hasText(image.description)) issue(errors, file, `${label}.description 为空`);
  if (String(image.image_url || '').startsWith('data:') && !validEmbeddedPng(image.image_url)) {
    issue(errors, file, `${label} 不是可解码的 PNG data URI`);
  }
  if (/\.(pdf|djvu)(?:$|[?#])/i.test(String(image.image_url || ''))) {
    issue(errors, file, `${label} 错把 PDF/DJVU 当作图片`);
  }
}

function checkRecord(record, kind, file) {
  const graph = kind === 'admin' ? record.graph_data : record.star_data;
  if (record.schema !== 'sh-crafted.heritage-submission/v1') issue(errors, file, 'schema 不正确');
  if (!hasText(record.title)) issue(errors, file, 'title 为空');
  if (!districtIds.includes(record.district_id)) issue(errors, file, `district_id 无效：${record.district_id || '(空)'}`);
  if (!hasText(record.summary) || record.summary.length < 80) issue(errors, file, 'summary 过短（至少 80 字）');
  if (!hasText(record.history) || record.history.length < 50) issue(errors, file, 'history 过短（至少 50 字）');
  if (!hasText(record.features) || record.features.length < 50) issue(errors, file, 'features 过短（至少 50 字）');
  if (!hasText(record.source_url)) issue(errors, file, 'source_url 为空');
  if (kind === 'admin' && (!/^LOCAL_[a-z0-9_]+$/i.test(record.id || '') || record.update_existing !== true)) {
    issue(errors, file, '管理员记录必须有稳定 LOCAL_ ID 且 update_existing=true');
  }
  if (kind === 'user' && (record.kind !== 'full' || record.include_steps !== true)) {
    issue(errors, file, '用户记录必须为 kind=full 且 include_steps=true');
  }

  if (!Array.isArray(record.overview_images) || record.overview_images.length < 1) {
    issue(errors, file, '至少需要 1 张概览图');
  } else {
    record.overview_images.forEach((image, index) => checkImage(image, file, `overview_images[${index}]`));
  }

  if (!Array.isArray(record.steps) || record.steps.length < 4) {
    issue(errors, file, '至少需要 4 道工序');
  } else {
    record.steps.forEach((step, index) => {
      const label = `steps[${index}]`;
      for (const key of ['name', 'description', 'result']) {
        if (!hasText(step?.[key])) issue(errors, file, `${label}.${key} 为空`);
      }
      for (const key of ['materials', 'tools', 'actions']) {
        if (!Array.isArray(step?.[key]) || !step[key].some(hasText)) issue(errors, file, `${label}.${key} 为空`);
      }
      if (!Array.isArray(step?.documentary_clips)) issue(errors, file, `${label}.documentary_clips 必须是数组`);
    });
  }

  if (!graph || typeof graph !== 'object') {
    issue(errors, file, `${kind === 'admin' ? 'graph_data' : 'star_data'} 缺失`);
  } else {
    if (!hasText(graph.summary) || graph.summary.length < 50) issue(errors, file, '星图 summary 过短（至少 50 字）');
    if (!Array.isArray(graph.keywords) || graph.keywords.length < 3) issue(errors, file, '星图 keywords 至少 3 个');
    if (!Array.isArray(graph.relations) || graph.relations.length < 3) issue(errors, file, '星图 relations 至少 3 个');
    else graph.relations.forEach((relation, index) => {
      const item = typeof relation === 'string' ? { title: relation } : relation;
      if (!hasText(item?.title)) issue(errors, file, `星图 relations[${index}].title 为空`);
      if (kind === 'admin' && !hasText(item?.summary)) issue(errors, file, `星图 relations[${index}].summary 为空`);
    });
    if (!Array.isArray(graph.images) || graph.images.length < 1) issue(errors, file, '星图至少需要 1 张节点图片');
    else graph.images.forEach((image, index) => checkImage(image, file, `星图 images[${index}]`));
  }

  const raw = JSON.stringify(record);
  for (const forbidden of ['待补充：', '非遗资源补充候选', '具体项目级信息待专家核验']) {
    if (raw.includes(forbidden)) issue(errors, file, `包含旧批次占位文案：${forbidden}`);
  }
  if (record.collection_status !== 'needs_review') issue(warnings, file, 'collection_status 建议保持 needs_review，待内容管理员核验后发布');
}

for (const kind of ['admin', 'user']) {
  for (const districtId of districtIds) {
    const directory = join(root, kind, districtId);
    let names = [];
    try {
      names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
    } catch (error) {
      issue(errors, directory, `目录读取失败：${error.message}`);
      continue;
    }
    if (names.length !== expected[kind]) issue(errors, directory, `应有 ${expected[kind]} 份 JSON，实际 ${names.length} 份`);
    for (const name of names) {
      const file = join(directory, name);
      try {
        const record = JSON.parse(await readFile(file, 'utf8'));
        records[kind].push({ file, record });
        checkRecord(record, kind, file);
      } catch (error) {
        issue(errors, file, `JSON 解析失败：${error.message}`);
      }
    }
  }
}

for (const districtId of districtIds) {
  const adminTitles = new Set(records.admin.filter(({ record }) => record.district_id === districtId).map(({ record }) => record.title));
  for (const { file, record } of records.user.filter((item) => item.record.district_id === districtId)) {
    if (adminTitles.has(record.title)) issue(errors, file, '与同区管理员项目重名');
  }
}

const idOwners = new Map();
for (const { file, record } of records.admin) {
  if (idOwners.has(record.id)) issue(errors, file, `稳定 ID 与 ${idOwners.get(record.id)} 重复`);
  else idOwners.set(record.id, file.replace(`${root}\\`, ''));
}

const report = {
  generated_at: new Date().toISOString(),
  root,
  passed: errors.length === 0,
  counts: { admin: records.admin.length, user: records.user.length, total: records.admin.length + records.user.length },
  rules: { districts: districtIds.length, admin_per_district: expected.admin, user_per_district: expected.user, minimum_steps: 4 },
  errors,
  warnings,
};
await writeFile(join(root, 'validation-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

if (errors.length) {
  console.error(`批次校验失败：${errors.length} 个错误，${warnings.length} 个提醒。`);
  for (const item of errors.slice(0, 30)) console.error(`- ${item.file}: ${item.message}`);
  process.exitCode = 1;
} else {
  console.log(`批次校验通过：管理员 ${records.admin.length} 条，用户 ${records.user.length} 条，${warnings.length} 个发布前提醒。`);
}
