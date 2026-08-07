import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const KB = join(ROOT, 'data', 'knowledge-base');
const SNAPSHOTS = join(KB, 'snapshots');
const sourceDoc = JSON.parse(await readFile(join(KB, 'sources.json'), 'utf8'));
const requested = process.argv.indexOf('--source');
const requestedId = requested >= 0 ? process.argv[requested + 1] : null;
const sources = sourceDoc.sources.filter((source) => {
  if (requestedId) return source.source_id === requestedId;
  return source.crawl?.enabled && source.crawl?.format === 'html';
});

if (requestedId && !sources.length) throw new Error(`找不到来源或来源未登记: ${requestedId}`);

const decodeEntities = (text) => text
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

function htmlToText(html) {
  const cleaned = html
    .replace(/<!--[^]*?-->/g, ' ')
    .replace(/<(script|style|svg|noscript|form|nav|footer|header)[^>]*>[^]*?<\/\1>/gi, ' ')
    .replace(/<(br|p|div|li|h[1-6]|tr|section|article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(cleaned)
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseRobots(text, pathname) {
  let applies = false;
  const disallowed = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [name, ...rest] = line.split(':');
    const value = rest.join(':').trim();
    if (name.trim().toLowerCase() === 'user-agent') applies = value === '*';
    if (applies && name.trim().toLowerCase() === 'disallow' && value) disallowed.push(value);
  }
  return !disallowed.some((prefix) => pathname.startsWith(prefix));
}

async function allowedByRobots(url) {
  const parsed = new URL(url);
  const robotsUrl = `${parsed.origin}/robots.txt`;
  try {
    const response = await fetch(robotsUrl, { headers: { 'User-Agent': 'Tanwuzhi-KB/1.0 (+https://avonana.site)' }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) return { allowed: true, robots_url: robotsUrl, status: response.status };
    const body = await response.text();
    return { allowed: parseRobots(body, parsed.pathname), robots_url: robotsUrl, status: response.status };
  } catch (error) {
    return { allowed: true, robots_url: robotsUrl, status: null, warning: error.message };
  }
}

await mkdir(SNAPSHOTS, { recursive: true });
const report = [];
for (const source of sources) {
  const robots = await allowedByRobots(source.url);
  if (!robots.allowed) {
    report.push({ source_id: source.source_id, status: 'robots_disallowed', robots });
    console.warn(`SKIP ${source.source_id}: robots.txt 禁止抓取`);
    continue;
  }
  try {
    const response = await fetch(source.url, {
      redirect: 'follow', signal: AbortSignal.timeout(25000),
      headers: { 'User-Agent': 'Tanwuzhi-KB/1.0 (+https://avonana.site)', Accept: 'text/html,application/xhtml+xml' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!/html|text\//i.test(contentType)) throw new Error(`不支持的Content-Type: ${contentType}`);
    const html = await response.text();
    const text = htmlToText(html);
    if (text.length < 100) throw new Error(`正文过短: ${text.length}`);
    const snapshot = {
      schema_version: '1.0', source_id: source.source_id, requested_url: source.url,
      final_url: response.url, fetched_at: new Date().toISOString(), http_status: response.status,
      content_type: contentType, robots, text_length: text.length,
      sha256: createHash('sha256').update(text).digest('hex'), extracted_text: text,
      usage: '仅供资料核对与后续摘要整理；不得直接作为已审核事实发布。',
    };
    await writeFile(join(SNAPSHOTS, `${source.source_id}.json`), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    report.push({ source_id: source.source_id, status: 'ok', text_length: text.length, sha256: snapshot.sha256 });
    console.log(`OK   ${source.source_id}: ${text.length} 字符`);
  } catch (error) {
    report.push({ source_id: source.source_id, status: 'failed', error: error.message, robots });
    console.warn(`FAIL ${source.source_id}: ${error.message}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 600));
}

await writeFile(join(KB, 'crawl-report.json'), `${JSON.stringify({ generated_at: new Date().toISOString(), results: report }, null, 2)}\n`, 'utf8');
const failed = report.filter((item) => item.status === 'failed').length;
console.log(`抓取完成：成功 ${report.filter((item) => item.status === 'ok').length}，robots跳过 ${report.filter((item) => item.status === 'robots_disallowed').length}，失败 ${failed}`);
if (failed) process.exitCode = 2;
