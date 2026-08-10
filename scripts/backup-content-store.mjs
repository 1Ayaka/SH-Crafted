import { mkdir, copyFile, chmod, cp, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';

const dbPath = process.env.CONTENT_DB_PATH || '/var/lib/sh-crafted/content.db';
const backupDir = process.env.CONTENT_BACKUP_DIR || '/var/backups/sh-crafted';
const uploadDir = process.env.CONTENT_UPLOAD_DIR || join(dirname(dbPath), 'uploads');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = join(backupDir, `content-${stamp}.db`);
await mkdir(dirname(target), { recursive: true });
const db = new DatabaseSync(dbPath, { readOnly: true });
try { await backup(db, target); } finally { db.close(); }
await chmod(target, 0o640);
for (const [label, legacy] of [['content', process.env.CONTENT_STORE_PATH], ['community', process.env.COMMUNITY_STORE_PATH]]) {
  if (!legacy) continue;
  try { await copyFile(legacy, join(backupDir, `${label}-${stamp}.json`)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const uploadBackup = join(backupDir, `uploads-${stamp}`);
if ((await stat(uploadDir).catch(() => null))?.isDirectory()) await cp(uploadDir, uploadBackup, { recursive: true, errorOnExist: true });
console.log(`内容数据库备份已生成：${target}${(await stat(uploadBackup).catch(() => null)) ? `；上传资源（步骤图片与 Logo）：${uploadBackup}` : ''}`);
