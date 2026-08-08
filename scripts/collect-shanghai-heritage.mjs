// Generate an audit-ready Shanghai heritage import batch.
// Admin records: two carefully enriched primary entries per district.
// User records: six separate community candidates per district.
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { DISTRICTS } from '../js/config.js';
import { CURATED_REGION_SETS } from '../js/graph-curated-catalog.js';
import {
  ADMIN_SELECTION, IMAGE_SEARCH_QUERY, buildHeritageContent, classifyHeritage,
} from './shanghai-heritage-content.mjs';

const ROOT = process.env.DESKTOP_PATH || join(process.env.USERPROFILE || '.', 'Desktop', '探物志-上海非遗补充');
const SCHEMA = 'sh-crafted.heritage-submission/v1';
const OFFICIAL_CATALOG = 'https://www.ihchina.cn/project.html';

const EXTRA_CANDIDATES = {
  baoshan: ['罗店彩灯', '宝山锣鼓', '顾村龙舞', '吴淞船模制作技艺', '罗泾十字挑花', '宝山民歌', '罗店划龙船习俗', '宝山沪剧'],
  qingpu: ['青浦田歌', '朱家角水乡民俗', '练塘宣卷', '青浦摇快船', '青浦蓝印花布', '水乡婚俗（青浦）', '青浦船拳', '朱家角民间故事'],
  songjiang: ['松江顾绣', '泗泾十鹿九回头', '松江滚灯', '叶榭软糕', '松江竹刻', '广富林民俗技艺', '松江剪纸', '松江皮影戏'],
  jinshan: ['金山农民画', '枫泾丁蹄制作技艺', '金山丝毯织造技艺', '金山民歌', '廊下土布织造', '山阳田歌', '金山堰菜制作技艺', '朱泾花灯'],
  pudong: ['浦东说书', '三林刺绣', '三林舞龙', '曹路黄草编', '浦东派琵琶艺术', '浦东剪纸', '浦东锣鼓书', '上海绒绣（浦东）'],
  xuhui: ['海派旗袍制作技艺', '上海剪纸（徐汇）', '龙华庙会', '海派篆刻（徐汇）', '书画装裱修复技艺（徐汇）', '海派盆景', '土山湾手工艺', '龙华撞钟习俗'],
  changning: ['海派盆景（长宁）', '上海绒绣', '长宁民间舞蹈', '海派旗袍（长宁）', '江南丝竹（长宁）', '传统香囊制作（长宁）', '海派盘扣制作（长宁）', '长宁民间故事'],
  putuo: ['上海道教音乐（普陀）', '真如羊肉制作技艺', '普陀传统香囊', '江南丝竹（普陀）', '沪派武术', '普陀剪纸', '真如麦秆画', '普陀民间故事'],
  huangpu: ['朵云轩木版水印技艺', '豫园灯彩', '海派月份牌年画', '海派篆刻（黄浦）', '老大房糕点制作技艺', '上海剪纸（黄浦）', '上海本帮菜肴传统烹饪技艺', '五香豆制作技艺'],
  hongkou: ['海派漫画', '石库门里弄营造技艺', '上海说唱（虹口）', '鲁庵印泥制作技艺', '海派旗袍（虹口）', '虹口民间舞蹈', '木偶戏（虹口）', '海派书画装裱技艺（虹口）'],
  yangpu: ['海派风筝制作技艺', '杨浦钩针编织', '上海剪纸（杨浦）', '民间龙舞（杨浦）', '江南丝竹（杨浦）', '传统木作技艺（杨浦）', '沪剧（杨浦）', '杨浦民间故事'],
};

const sourceByDistrict = new Map([
  ['jiading', 'https://www.shanghai.gov.cn/gwk/search/content/2faf1cc9044e410b8c2664f794a04f02'],
  ['fengxian', 'https://www.shanghai.gov.cn/fengxian/index.html'],
  ['jingan', 'https://www.jingan.gov.cn/BigFileUpLoadStorage/temp/2025-01-21/44ba7e45-8ec6-48b6-bffc-d214617be3d0/%E9%9D%99%E5%BA%9C%E5%8F%91%5B2025%5D1%E5%8F%B7.pdf'],
  ['chongming', 'https://www.shanghai.gov.cn/cmsres/27/27d2c91c06aa4360bbedcb76d07b9e32/884f49ff94ef0a0dca6ef67f03eec182.pdf'],
  ['minhang', 'https://www.shanghai.gov.cn/minhang/index.html'],
]);
const curated = new Map(CURATED_REGION_SETS.map(([districtId, districtName, source, items]) => [
  districtId, { districtName, sourceUrl: source.source_url || OFFICIAL_CATALOG, items: items.map(([slug, title]) => ({ slug, title })) },
]));
const cleanSlug = (value) => String(value).normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'heritage';

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function proceduralFallback(type) {
  const width = 320, height = 200;
  const palettes = {
    music: [[56, 78, 64], [210, 184, 149]], performance: [[90, 52, 46], [210, 184, 149]],
    oral: [[72, 70, 58], [220, 205, 174]], food: [[126, 78, 50], [224, 190, 139]],
    textile: [[90, 94, 66], [202, 130, 86]], visual: [[76, 92, 72], [190, 107, 61]],
    construction: [[74, 72, 65], [170, 145, 114]], custom: [[116, 64, 51], [205, 164, 82]],
    garden: [[54, 82, 61], [169, 180, 132]], craft: [[68, 78, 65], [193, 150, 94]],
  };
  const [a, b] = palettes[type] || palettes.craft;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1); raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const wave = (Math.sin(x / 42) + Math.cos(y / 36) + 2) / 4;
      const vignette = Math.max(0, 1 - Math.hypot(x - width / 2, y - height / 2) / 215);
      const t = Math.min(1, Math.max(0, wave * 0.42 + vignette * 0.48));
      for (let c = 0; c < 3; c += 1) raw[row + 1 + x * 3 + c] = Math.round(a[c] * (1 - t) + b[c] * t);
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

async function fetchCommonsContextImage(type) {
  const query = IMAGE_SEARCH_QUERY[type] || IMAGE_SEARCH_QUERY.craft;
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=10&prop=imageinfo&iiprop=url%7Cmime&iiurlwidth=1000&format=json&origin=*`;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'TanwuzhiHeritageCollector/2.0' } });
    if (!response.ok) return null;
    const data = await response.json();
    const pages = Object.values(data?.query?.pages || {});
    for (const page of pages) {
      const info = page?.imageinfo?.[0];
      if (!/^image\/(jpeg|png|webp)$/i.test(info?.mime || '')) continue;
      const imageUrl = info.thumburl || info.url;
      if (!imageUrl) continue;
      const probe = await fetch(imageUrl, { method: 'HEAD', signal: controller.signal }).catch(() => null);
      if (probe?.ok && /^image\//i.test(probe.headers.get('content-type') || '')) return { imageUrl, sourceUrl: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}` };
    }
    return null;
  } catch { return null; } finally { clearTimeout(timer); }
}

function imageRecord(title, type, image) {
  const contextual = Boolean(image?.imageUrl);
  return {
    title: `${title}概览语境图`, image_url: image?.imageUrl || proceduralFallback(type),
    description: contextual
      ? `用于${title}概览的同类别文化语境图，不作为该项目实物或传承人档案照片；管理员发布前应优先替换为已获授权的项目图片。`
      : `用于${title}概览的系统生成类别语境占位图，不是项目实物照片；管理员发布前应替换为已获授权的项目图片。`,
    source_url: image?.sourceUrl || '', image_status: contextual ? 'verified_context_image_needs_replacement' : 'generated_placeholder_needs_replacement',
  };
}

function makeAdmin(record, district, index, image, sourceUrl) {
  const content = buildHeritageContent({ title: record.title, district, sourceUrl, admin: true });
  const id = `LOCAL_${district.id}_${String(index + 1).padStart(2, '0')}_${cleanSlug(record.slug || record.title)}`;
  return {
    schema: SCHEMA, id, update_existing: true, update_mode: 'replace_imported',
    title: record.title, district_id: district.id, category: content.category,
    summary: content.summary, history: content.history, features: content.features,
    source_url: sourceUrl, cover_url: image.image_url, model_path: '', review_status: 'needs_review',
    overview_images: [image],
    graph_data: { summary: content.graphSummary, relations: content.relations, keywords: content.keywords, images: [image] },
    steps: content.steps, collection_method: 'structured_editorial_enrichment', collection_status: 'needs_review',
  };
}

function makeUser(record, district, image, sourceUrl) {
  const content = buildHeritageContent({ title: record.title, district, sourceUrl, admin: false });
  return {
    schema: SCHEMA, kind: 'full', include_steps: true,
    title: record.title, district_id: district.id, category: content.category,
    summary: content.summary, history: content.history, features: content.features,
    source_url: sourceUrl, cover_url: image.image_url, gallery_urls: [], overview_images: [image],
    star_data: { summary: content.graphSummary, relations: content.relations.map((item) => item.title), keywords: content.keywords, images: [image] },
    steps: content.steps, contributor_name: '待投稿人确认', contributor_contact: '',
    collection_method: 'structured_editorial_enrichment', collection_status: 'needs_review',
  };
}

async function clearJsonDirectory(directory) {
  await mkdir(directory, { recursive: true });
  for (const filename of await readdir(directory)) if (filename.endsWith('.json')) await unlink(join(directory, filename));
}

async function main() {
  await mkdir(ROOT, { recursive: true });
  const types = Object.keys(IMAGE_SEARCH_QUERY);
  const imageByType = new Map(await Promise.all(types.map(async (type) => [type, await fetchCommonsContextImage(type)])));
  const manifest = {
    schema: 'tanwuzhi.shanghai-heritage-batch/v2', generated_at: new Date().toISOString(), output_root: ROOT,
    rules: { admin_per_district: 2, user_per_district: 6, admin_user_titles_separate: true, image_required: true, minimum_steps: 4, all_records_need_review: true }, districts: [],
  };
  for (const district of DISTRICTS) {
    const set = curated.get(district.id);
    const raw = set?.items || (EXTRA_CANDIDATES[district.id] || []).map((title) => ({ title, slug: '' }));
    const sourceUrl = set?.sourceUrl || sourceByDistrict.get(district.id) || OFFICIAL_CATALOG;
    const selectedTitles = ADMIN_SELECTION[district.id] || raw.slice(0, 2).map((item) => item.title);
    const adminItems = selectedTitles.map((title) => raw.find((item) => item.title === title) || ({ title, slug: '' }));
    const userItems = raw.filter((item) => !selectedTitles.includes(item.title)).slice(0, 6);
    if (adminItems.length !== 2 || userItems.length !== 6) throw new Error(`${district.id} 数据不足：管理员 ${adminItems.length}，用户 ${userItems.length}`);
    const adminDir = join(ROOT, 'admin', district.id); const userDir = join(ROOT, 'user', district.id);
    await clearJsonDirectory(adminDir); await clearJsonDirectory(userDir);
    const adminRecords = adminItems.map((item, index) => {
      const type = classifyHeritage(item.title); return makeAdmin(item, district, index, imageRecord(item.title, type, imageByType.get(type)), sourceUrl);
    });
    const userRecords = userItems.map((item) => {
      const type = classifyHeritage(item.title); return makeUser(item, district, imageRecord(item.title, type, imageByType.get(type)), sourceUrl);
    });
    await Promise.all(adminRecords.map((record, index) => writeFile(join(adminDir, `${district.id}-${String(index + 1).padStart(2, '0')}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8')));
    await Promise.all(userRecords.map((record, index) => writeFile(join(userDir, `${district.id}-${String(index + 1).padStart(2, '0')}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8')));
    manifest.districts.push({ id: district.id, name: district.name, source_url: sourceUrl, admin_count: 2, user_count: 6, admin_directory: `admin/${district.id}`, user_directory: `user/${district.id}`, records_need_review: true });
  }
  await writeFile(join(ROOT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeFile(join(ROOT, 'README.md'), `# 探物志上海非遗补充批次 v2\n\n- 生成时间：${manifest.generated_at}\n- 覆盖地区：16 个\n- 管理员 JSON：每区 2 条，共 32 条；每条含 4 道结构化工序、材料工具、星图关系与概览图说明。\n- 用户 JSON：每区 6 条，共 96 条；与同区管理员条目不重名，按完整投稿导入。\n- 所有条目仍需内容管理员核对项目级事实和图片授权。\n\n## 重新导入顺序\n\n1. 先部署包含“同 ID 安全更新”功能的新版后台，并备份服务器内容库。旧版后台会把相同条目生成新 ID，不能用来覆盖旧批次。\n2. 登录管理员后台，逐份导入 admin 目录中的 JSON。v2 JSON 带稳定 id 和 update_existing，旧脚本生成且尚未人工维护的同 ID 项目会原位补齐。\n3. 若后台提示“已经被管理员维护过”，不要强行覆盖，应在编辑页人工合并。这说明协作者已经修改了该项目。\n4. 原有 SHIH_0001 至 SHIH_0008 永远不会被这批 JSON 覆盖；新 JSON 的 model_path 为空时也会保留服务器已有模型。\n5. user 目录中的 JSON 只会填充用户投稿表单，不会覆盖已经提交或发布的内容；已发布条目请由管理员编辑。\n\n可在项目目录运行 npm run heritage:validate-batch，再次核对数量、字段、工序、图片说明和星图关系。结果同时写入本目录 validation-report.json。\n\n## 图片与纪录片说明\n\n概览图只使用经 HTTP 与 MIME 检查的 Wikimedia Commons 同类别语境图；找不到时使用系统生成的类别占位图。两者都在 description 中明确不是项目档案照片，发布前应优先替换。\n\n没有可核验地址的纪录片片段保持 documentary_clips 为空数组，不编造视频链接；管理员可在工序编辑器中拖入或替换获得授权的媒体。\n`, 'utf8');
  console.log(JSON.stringify({ output: ROOT, districts: 16, admin_records: 32, user_records: 96, images: Object.fromEntries([...imageByType].map(([type, value]) => [type, Boolean(value)])) }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
