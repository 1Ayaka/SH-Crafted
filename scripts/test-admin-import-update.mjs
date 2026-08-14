import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { buildContentSeed } from './content-seed.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1))), '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'sh-crafted-import-update-'));
const contentStore = path.join(temporary, 'content.json');
const communityStore = path.join(temporary, 'community.json');
const contentDb = path.join(temporary, 'content.db');
const freePort = () => new Promise((resolve, reject) => {
  const socket = net.createServer();
  socket.on('error', reject);
  socket.listen(0, '127.0.0.1', () => {
    const { port } = socket.address();
    socket.close(() => resolve(port));
  });
});
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
let server;

function startServer() {
  return spawn(process.execPath, ['server.mjs', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: root,
    env: {
      ...process.env,
      CONTENT_STORE_PATH: contentStore,
      COMMUNITY_STORE_PATH: communityStore,
      CONTENT_DB_PATH: contentDb,
      ADMIN_USERNAME: 'import-test-admin',
      ADMIN_PASSWORD: 'import-test-password',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

async function waitForServer() {
  let stderr = '';
  server.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`测试服务器启动失败：${stderr}`);
    try {
      const response = await fetch(`${base}/`);
      if (response.ok) return;
    } catch { /* still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`测试服务器启动超时：${stderr}`);
}

async function request(pathname, { method = 'GET', body, cookie = '' } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      Origin: base,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function expectStatus(result, status, error = '') {
  if (result.response.status !== status || (error && result.payload.error !== error)) {
    throw new Error(`预期 HTTP ${status}${error ? `/${error}` : ''}，实际 ${result.response.status}/${result.payload.error || ''}`);
  }
}

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
function importRecord(id, revision = '', overrides = {}) {
  return {
    schema: 'sh-crafted.heritage-submission/v1',
    id,
    update_existing: true,
    revision,
    title: `导入保护测试 ${id}`,
    district_id: 'jiading',
    category: '传统技艺',
    summary: '这是一条只写入临时隔离数据库的自动化测试内容，用于确认管理员重新导入不会覆盖原始八项或协作者已经手工修改的项目。',
    history: '海棠式测试历史线索，用于确认管理员导入资料能够进入智能体的统一检索。',
    features: '测试特色资料。',
    source_url: 'https://example.invalid/source',
    cover_url: 'https://example.invalid/cover.png',
    model_path: 'assets/models/crafts/import-protection-test.glb',
    images: [{ title: '测试其他图片', image_url: png, description: '仅供自动化测试使用的嵌入图片。', source_url: 'https://example.invalid/image-source' }],
    graph_data: {
      summary: '测试星图资料。', keywords: ['测试', '导入', '保护'], images: [{ title: '测试节点图', image_url: png, description: '测试节点图片。' }],
      relations: [{ type: 'region', title: '嘉定区', summary: '测试地区关系。' }],
    },
    steps: Array.from({ length: 4 }, (_, index) => ({
      name: `测试工序 ${index + 1}`, description: `测试工序 ${index + 1} 的说明。`, result: `测试结果 ${index + 1}`,
      materials: [`材料 ${index + 1}`], tools: [`工具 ${index + 1}`], actions: [`动作 ${index + 1}`], documentary_clips: [],
    })),
    ...overrides,
  };
}

try {
  const legacyId = 'LOCAL_jiading_99';
  const legacyTitle = '旧批次迁移测试项目';
  const legacySeed = await buildContentSeed();
  legacySeed.crafts.push({
    id: legacyId,
    sort: Math.max(...legacySeed.crafts.map((craft) => Number(craft.sort) || 0)) + 1,
    title: legacyTitle,
    district_id: 'jiading',
    category: '传统技艺（候选）',
    summary: '非遗资源补充候选。现有公开资料提示该项目需要继续核验。',
    cover_path: 'https://upload.wikimedia.org/legacy-placeholder.jpg',
    model_path: '',
    source: 'admin-import',
    graph_data: { summary: '', relations: [], keywords: ['待核验'], images: [] },
  });
  legacySeed.revision = `legacy-import-test-${Date.now()}`;
  await writeFile(contentStore, `${JSON.stringify(legacySeed)}\n`, 'utf8');

  server = startServer();
  await waitForServer();

  const login = await request('/api/admin/login', {
    method: 'POST', body: { username: 'import-test-admin', password: 'import-test-password' },
  });
  expectStatus(login, 200);
  const cookie = (login.response.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie.startsWith('sh_admin=')) throw new Error('管理员登录未返回会话 Cookie');

  const initialContent = await request('/api/content');
  expectStatus(initialContent, 200);
  const initialV1 = await request('/api/v1/content');
  expectStatus(initialV1, 200);
  if (initialV1.payload.api_version !== 'v1' || initialV1.payload.revision !== initialContent.payload.revision) throw new Error('v1 内容 API 与兼容 API 基线不一致');
  const initialProjectNodes = initialV1.payload.graph_nodes.filter((node) => node.content_role === 'map_project');
  if (initialProjectNodes.length !== initialV1.payload.crafts.length || !initialProjectNodes.every((node) => node.detail_available)) {
    throw new Error(`地图项目没有一对一进入统一星图读模型（项目 ${initialV1.payload.crafts.length}，项目节点 ${initialProjectNodes.length}）`);
  }
  const heritageTitles = initialV1.payload.graph_nodes.filter((node) => node.type === 'heritage').map((node) => String(node.title || '').normalize('NFKC').trim().toLowerCase());
  if (new Set(heritageTitles).size !== heritageTitles.length) throw new Error('统一星图读模型仍然输出同名重复非遗节点');
    const districtEdges = new Set(initialV1.payload.graph_edges.filter((edge) => edge.relation === 'LOCATED_IN').map((edge) => `${edge.from}|${edge.to}`));
    const regionIds = new Set(initialV1.payload.graph_nodes.filter((node) => node.type === 'region').map((node) => node.id));
    if (!initialV1.payload.graph_nodes.filter((node) => node.type === 'heritage' && regionIds.has(`region:${node.district_id}`)).every((node) => districtEdges.has(`${node.id}|region:${node.district_id}`))) {
    throw new Error('星图非遗节点没有自动建立地区关系');
  }
  const originalPrimary = initialContent.payload.crafts.find((craft) => craft.id === 'SHIH_0001');
  if (!originalPrimary) throw new Error('隔离内容库缺少原始主非遗 SHIH_0001');

  const legacyUpdated = await request('/api/admin/crafts/import', {
    method: 'POST', cookie,
    body: importRecord(legacyId, initialContent.payload.revision, { title: legacyTitle }),
  });
  expectStatus(legacyUpdated, 200);
  let content = await request('/api/content');
  if (content.payload.craft_steps.filter((step) => step.craft_id === legacyId).length !== 4) {
    throw new Error('旧批次空工序项目未被新版 JSON 补齐');
  }

  const firstId = 'LOCAL_IMPORT_PROTECTION_01';
  const created = await request('/api/admin/crafts/import', {
    method: 'POST', cookie, body: importRecord(firstId, content.payload.revision),
  });
  expectStatus(created, 201);

  content = await request('/api/content');
  const createdCraft = content.payload.crafts.find((craft) => craft.id === firstId);
  if (!createdCraft) throw new Error('管理员导入后项目不存在');
  if (content.payload.craft_steps.filter((step) => step.craft_id === firstId).length !== 4) throw new Error('管理员导入后工序不是 4 条');
  const importedImage = content.payload.craft_gallery.find((image) => image.craft_id === firstId);
  if (!importedImage) throw new Error('管理员导入后其他图片未写入图库');
  if (importedImage.source_url !== 'https://example.invalid/image-source') throw new Error('图片来源未被统一内容库保留');
  const knowledgeSearch = await request('/api/kb/search', {
    method: 'POST', body: { query: '海棠式测试历史线索' },
  });
  expectStatus(knowledgeSearch, 200);
  if (!knowledgeSearch.payload.results?.some((item) => item.craft_ids?.includes(firstId))) {
    throw new Error('管理员导入的历史资料未进入智能体统一检索');
  }

  const updated = await request('/api/admin/crafts/import', {
    method: 'POST', cookie,
    body: importRecord(firstId, content.payload.revision, { summary: '更新后的测试简介，验证相同稳定 ID 能替换旧批次空内容，同时保留服务器中已经存在且新 JSON 未提供的模型路径。', model_path: '' }),
  });
  expectStatus(updated, 200);
  content = await request('/api/content');
  const updatedCraft = content.payload.crafts.find((craft) => craft.id === firstId);
  if (!updatedCraft.summary.startsWith('更新后的测试简介')) throw new Error('相同稳定 ID 未更新原记录');
  const updatedGraphNode = content.payload.graph_nodes.find((node) => node.id === `heritage:${firstId}`);
  if (updatedGraphNode?.title !== updatedCraft.title || updatedGraphNode?.summary !== updatedCraft.summary || updatedGraphNode?.overview_image !== updatedCraft.cover_path) {
    throw new Error('地图项目更新后统一星图读模型没有同步使用项目字段');
  }
  if (updatedCraft.model_path !== 'assets/models/crafts/import-protection-test.glb') throw new Error('空 model_path 清除了服务器已有模型');
  if (content.payload.crafts.filter((craft) => craft.id === firstId).length !== 1) throw new Error('相同稳定 ID 产生了重复项目');

  const alternateId = 'LOCAL_IMPORT_SAME_TITLE_DIFFERENT_ID';
  const sameTitleUpdate = await request('/api/admin/crafts/import', {
    method: 'POST', cookie,
    body: importRecord(alternateId, content.payload.revision, {
      title: updatedCraft.title,
      summary: '通过相同名称和相同区县定位已有项目，即使上传文件携带了不同 ID，也应覆盖原有记录而不是新增重复项目。',
    }),
  });
  expectStatus(sameTitleUpdate, 200);
  if (sameTitleUpdate.payload.craft_id !== firstId || !sameTitleUpdate.payload.updated) {
    throw new Error('相同名称和区县未覆盖原项目');
  }
  content = await request('/api/content');
  if (content.payload.crafts.some((craft) => craft.id === alternateId)) throw new Error('同名覆盖产生了新 ID 项目');
  if (content.payload.crafts.filter((craft) => craft.title === updatedCraft.title && craft.district_id === 'jiading').length !== 1) {
    throw new Error('同名覆盖后仍有重复项目');
  }

  const duplicate = await request('/api/admin/crafts/import', {
    method: 'POST', cookie, body: { ...importRecord(firstId, content.payload.revision), update_existing: false },
  });
  expectStatus(duplicate, 409, 'duplicate_craft_id');

  const protectedAttempt = await request('/api/admin/crafts/import', {
    method: 'POST', cookie,
    body: importRecord('SHIH_0001', content.payload.revision, { title: originalPrimary.title }),
  });
  expectStatus(protectedAttempt, 409, 'protected_existing_craft');

  const staleRevision = content.payload.revision;
  const secondId = 'LOCAL_IMPORT_PROTECTION_02';
  const secondCreated = await request('/api/admin/crafts/import', {
    method: 'POST', cookie, body: importRecord(secondId, staleRevision, { cover_url: '', images: [] }),
  });
  expectStatus(secondCreated, 201);
  let noImageContent = await request('/api/v1/content');
  const noImageCraft = noImageContent.payload.crafts.find((craft) => craft.id === secondId);
  const noImageGraphNode = noImageContent.payload.graph_nodes.find((node) => node.id === `heritage:${secondId}`);
  if (!noImageCraft || noImageCraft.cover_path || !noImageGraphNode?.detail_available || noImageGraphNode.overview_image) {
    throw new Error(`无图管理员导入未能同时进入地图和统一星图（项目=${Boolean(noImageCraft)}，封面=${noImageCraft?.cover_path || ''}，节点=${Boolean(noImageGraphNode)}，详情=${Boolean(noImageGraphNode?.detail_available)}，节点主图=${noImageGraphNode?.overview_image || ''}）`);
  }
  const staleUpdate = await request('/api/admin/crafts/import', {
    method: 'POST', cookie, body: importRecord(firstId, staleRevision, { summary: '这次更新故意使用过期 revision，必须被内容冲突保护拒绝，不能覆盖其他管理员刚刚保存的数据。' }),
  });
  expectStatus(staleUpdate, 409, 'content_conflict');

  content = await request('/api/content');
  const manualEdit = await request(`/api/admin/crafts/${firstId}`, {
    method: 'PUT', cookie, body: {
      revision: content.payload.revision,
      summary: '',
      category: '',
      claims: [
        { id: 'reviewed_claim_1', statement: '管理员确认的第一条事实陈述。', evidence_ids: ['ev_001'] },
        { id: 'reviewed_claim_2', statement: '管理员确认的第二条事实陈述。', evidence_ids: [] },
      ],
    },
  });
  expectStatus(manualEdit, 200);
  content = await request('/api/content');
  const editedCraft = content.payload.crafts.find((craft) => craft.id === firstId);
  if (editedCraft.summary !== '' || editedCraft.category !== '' || editedCraft.claims?.length !== 2) throw new Error('项目正文或事实陈述未按管理员修改持久化');
  const clearClaims = await request(`/api/admin/crafts/${firstId}`, {
    method: 'PUT', cookie, body: { revision: content.payload.revision, claims: [] },
  });
  expectStatus(clearClaims, 200);
  content = await request('/api/content');
  if (content.payload.crafts.find((craft) => craft.id === firstId)?.claims?.length !== 0) throw new Error('管理员删除事实陈述后数据再次回退');
  const overwriteEdited = await request('/api/admin/crafts/import', {
    method: 'POST', cookie, body: importRecord(firstId, content.payload.revision),
  });
  expectStatus(overwriteEdited, 409, 'existing_content_modified');

  content = await request('/api/content');
  const protectedBulkDelete = await request('/api/admin/crafts/bulk-delete', {
    method: 'POST', cookie,
    body: { ids: ['SHIH_0001', secondId], revision: content.payload.revision },
  });
  expectStatus(protectedBulkDelete, 409, 'protected_craft_delete');
  content = await request('/api/content');
  if (!content.payload.crafts.some((craft) => craft.id === secondId)) throw new Error('含受保护项目的批次发生了部分删除');

  const deleted = await request('/api/admin/crafts/bulk-delete', {
    method: 'POST', cookie,
    body: { ids: [firstId, secondId], revision: content.payload.revision },
  });
  expectStatus(deleted, 200);
  if (deleted.payload.deleted_count !== 2) throw new Error('批量删除数量不正确');
  content = await request('/api/content');
  const deletedIds = new Set([firstId, secondId]);
  if (content.payload.crafts.some((craft) => deletedIds.has(craft.id))) throw new Error('批量删除后项目仍存在');
  if (content.payload.craft_steps.some((step) => deletedIds.has(step.craft_id))) throw new Error('批量删除后工序仍存在');
  if (content.payload.craft_gallery.some((image) => deletedIds.has(image.craft_id))) throw new Error('批量删除后图库仍存在');
  const deletedGraphIds = new Set([firstId, secondId, `heritage:${firstId}`, `heritage:${secondId}`]);
  if (content.payload.graph_nodes.some((node) => deletedGraphIds.has(node.id) || deletedIds.has(node.raw_id))) throw new Error('批量删除后星图节点仍存在');
  if (content.payload.graph_edges.some((edge) => deletedGraphIds.has(edge.from) || deletedGraphIds.has(edge.to))) throw new Error('批量删除后星图关系仍存在');
  if (!content.payload.crafts.some((craft) => craft.id === 'SHIH_0001')) throw new Error('批量删除影响了原始主非遗');

  const persisted = JSON.parse(await readFile(contentStore, 'utf8').catch(() => '{}'));
  if (persisted.crafts && persisted.crafts.find((craft) => craft.id === 'SHIH_0001')?.title !== originalPrimary.title) {
    throw new Error('原始主非遗在持久化内容中被改变');
  }
  console.log('管理员内容保护测试通过：旧批次迁移、更新冲突、原始 8 项保护，以及项目/工序/图库/星图批量删除均正常。');
} finally {
  if (server && server.exitCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill();
    await exited;
  }
  await rm(temporary, { recursive: true, force: true });
}
