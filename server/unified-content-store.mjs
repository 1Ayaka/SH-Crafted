import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const CONTENT_COLLECTIONS = ['districts', 'crafts', 'craft_steps', 'craft_gallery', 'site_texts', 'graph_nodes', 'graph_edges'];
const COMMUNITY_COLLECTIONS = ['submissions'];

function revision() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function validContent(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Array.isArray(value.crafts) && Array.isArray(value.craft_steps);
}

function validCommunity(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Array.isArray(value.submissions);
}

function clone(value) { return structuredClone(value); }

export async function createUnifiedContentStore({ dbPath, legacyContentPath, legacyCommunityPath, seedContent, seedCommunity } = {}) {
  await mkdir(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS store_meta (
      store_name TEXT PRIMARY KEY,
      revision TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      root_payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS store_entities (
      store_name TEXT NOT NULL,
      collection TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      payload TEXT NOT NULL,
      PRIMARY KEY (store_name, collection, entity_id)
    );
    CREATE INDEX IF NOT EXISTS idx_store_entities_order
      ON store_entities(store_name, collection, sort_order, entity_id);
    CREATE TABLE IF NOT EXISTS store_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_name TEXT NOT NULL,
      revision TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );
  `);

  const collections = { content: CONTENT_COLLECTIONS, community: COMMUNITY_COLLECTIONS };
  const split = (storeName, value) => {
    const root = {};
    const arrays = collections[storeName] || [];
    for (const [key, item] of Object.entries(value || {})) {
      if (!arrays.includes(key)) root[key] = clone(item);
    }
    return { root, arrays };
  };
  const compose = (storeName) => {
    const meta = db.prepare('SELECT revision, updated_at, root_payload FROM store_meta WHERE store_name = ?').get(storeName);
    if (!meta) return null;
    const value = JSON.parse(meta.root_payload);
    // Preserve the source array order for compatibility; callers can still sort by
    // the entity's explicit `sort` field when they need editorial ordering.
    const rows = db.prepare('SELECT collection, entity_id, sort_order, payload FROM store_entities WHERE store_name = ? ORDER BY collection, rowid').all(storeName);
    for (const collection of collections[storeName] || []) {
      value[collection] = rows.filter((row) => row.collection === collection).map((row) => JSON.parse(row.payload));
    }
    value.revision = meta.revision;
    value.updated_at = meta.updated_at;
    return value;
  };
  const write = (storeName, value, { keepHistory = true } = {}) => {
    const now = new Date().toISOString();
    const next = clone(value);
    next.revision ||= revision();
    next.updated_at = now;
    const { root, arrays } = split(storeName, next);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`INSERT INTO store_meta(store_name, revision, updated_at, root_payload)
        VALUES(?, ?, ?, ?)
        ON CONFLICT(store_name) DO UPDATE SET revision=excluded.revision, updated_at=excluded.updated_at, root_payload=excluded.root_payload`)
        .run(storeName, next.revision, next.updated_at, JSON.stringify(root));
      db.prepare('DELETE FROM store_entities WHERE store_name = ?').run(storeName);
      const insert = db.prepare('INSERT INTO store_entities(store_name, collection, entity_id, sort_order, payload) VALUES(?, ?, ?, ?, ?)');
      for (const collection of arrays) {
        for (const [index, item] of (Array.isArray(next[collection]) ? next[collection] : []).entries()) {
          const id = String(item?.id ?? `${collection}_${index + 1}`);
          insert.run(storeName, collection, id, Number(item?.sort ?? index + 1) || index + 1, JSON.stringify(item));
        }
      }
      if (keepHistory) db.prepare('INSERT INTO store_history(store_name, revision, created_at, payload) VALUES(?, ?, ?, ?)').run(storeName, next.revision, now, JSON.stringify(next));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return next;
  };

  const migrate = async (storeName, legacyPath, seed, validator) => {
    let current = compose(storeName);
    if (current) return current;
    let legacy;
    try {
      legacy = await readJson(legacyPath);
    } catch (error) {
      const backup = `${legacyPath}.invalid-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
      await copyFile(legacyPath, backup).catch(() => {});
      throw new Error(`invalid_${storeName}_store: ${error.message}`);
    }
    if (legacy && !validator(legacy)) {
      const backup = `${legacyPath}.invalid-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
      await copyFile(legacyPath, backup).catch(() => {});
      throw new Error(`invalid_${storeName}_store`);
    }
    current = legacy || (seed || {});
    if (!validator(current)) throw new Error(`invalid_${storeName}_store`);
    if (validator(legacy)) {
      const backup = `${legacyPath}.pre-db-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
      await copyFile(legacyPath, backup).catch(() => {});
    }
    current = { ...current, revision: current.revision || revision(), updated_at: current.updated_at || new Date().toISOString() };
    return write(storeName, current);
  };

  const content = await migrate('content', legacyContentPath, seedContent, validContent);
  const community = await migrate('community', legacyCommunityPath, seedCommunity, validCommunity);
  return {
    dbPath,
    content,
    community,
    read(storeName) { return compose(storeName); },
    write(storeName, value) { return write(storeName, value); },
    close() { db.close(); },
  };
}
