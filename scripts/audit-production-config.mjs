const production = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const username = String(process.env.ADMIN_USERNAME || '').trim();
const password = String(process.env.ADMIN_PASSWORD || '').trim();
const issues = [];

if (production) {
  if (!username || !password) issues.push('生产环境必须显式设置 ADMIN_USERNAME 和 ADMIN_PASSWORD');
  if (username === 'djt' && password === '12345689') issues.push('生产环境禁止使用默认管理员密码');
  if (String(process.env.ADMIN_COOKIE_SECURE || '').toLowerCase() !== 'true') issues.push('HTTPS 部署应设置 ADMIN_COOKIE_SECURE=true');
  if (!process.env.CONTENT_DB_PATH) issues.push('生产环境应设置 CONTENT_DB_PATH 指向独立持久化目录');
}

if (issues.length) {
  console.error(JSON.stringify({ ok: false, issues }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, mode: production ? 'production' : 'development' }, null, 2));
}
