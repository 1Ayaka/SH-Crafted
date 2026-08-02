import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const KB = join(ROOT, 'data', 'knowledge-base');
const sourceDoc = JSON.parse(await readFile(join(KB, 'sources.json'), 'utf8'));
const sources = sourceDoc.sources || [];
const results = new Array(sources.length);
let cursor = 0;

async function check(source, index) {
  const started = Date.now();
  try {
    const response = await fetch(source.url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
      headers: {
        'User-Agent': 'SH-Crafted-KB-LinkCheck/1.0 (+https://avonana.site)',
        Accept: 'text/html,application/xhtml+xml,application/pdf,*/*;q=0.5',
        Range: 'bytes=0-2047',
      },
    });
    await response.body?.cancel().catch(() => {});
    results[index] = {
      source_id: source.source_id,
      status: response.ok ? 'ok' : 'http_error',
      http_status: response.status,
      final_url: response.url,
      content_type: response.headers.get('content-type') || null,
      elapsed_ms: Date.now() - started,
    };
  } catch (error) {
    results[index] = {
      source_id: source.source_id,
      status: 'network_error',
      http_status: null,
      final_url: null,
      content_type: null,
      elapsed_ms: Date.now() - started,
      error: error?.message || String(error),
    };
  }
  const item = results[index];
  console.log(`${item.status === 'ok' ? 'OK  ' : 'FAIL'} ${source.source_id}: ${item.http_status ?? item.error}`);
}

async function worker() {
  while (cursor < sources.length) {
    const index = cursor++;
    await check(sources[index], index);
  }
}

await Promise.all(Array.from({ length: Math.min(5, sources.length) }, worker));
const failures = results.filter((item) => item.status !== 'ok');
const report = {
  schema_version: '1.0',
  checked_at: new Date().toISOString(),
  total: results.length,
  reachable: results.length - failures.length,
  failed: failures.length,
  results,
};
await writeFile(join(KB, 'link-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`来源链接检查：可访问 ${report.reachable}/${report.total}，失败 ${report.failed}`);
if (failures.length) process.exitCode = 1;
