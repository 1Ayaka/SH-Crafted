import { readFile } from 'node:fs/promises';
import { createUnifiedContentStore } from '../server/unified-content-store.mjs';
import { buildContentSeed } from './content-seed.mjs';

const env = (name, fallback) => process.env[name] || fallback;
const contentPath = env('CONTENT_STORE_PATH', '.content/content.json');
const communityPath = env('COMMUNITY_STORE_PATH', '.content/community.json');
const dbPath = env('CONTENT_DB_PATH', '.content/content.db');
const read = async (path, fallback) => { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; } };

const seed = await buildContentSeed();
const communitySeed = { version: 1, engagement: {}, submissions: [] };
const store = await createUnifiedContentStore({
  dbPath,
  legacyContentPath: contentPath,
  legacyCommunityPath: communityPath,
  seedContent: await read(contentPath, seed),
  seedCommunity: await read(communityPath, communitySeed),
});
const content = store.read('content');
const community = store.read('community');
console.log(JSON.stringify({
  db_path: dbPath,
  content_revision: content.revision,
  community_revision: community.revision,
  districts: content.districts?.length || 0,
  crafts: content.crafts?.length || 0,
  craft_steps: content.craft_steps?.length || 0,
  craft_gallery: content.craft_gallery?.length || 0,
  submissions: community.submissions?.length || 0,
}, null, 2));
store.close();

