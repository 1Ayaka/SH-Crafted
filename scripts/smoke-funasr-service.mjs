const base = process.env.FUNASR_HEALTH_URL || 'http://127.0.0.1:10095';
if (process.env.FUNASR_INTEGRATION_TEST !== '1') {
  console.log(`FunASR integration test skipped; set FUNASR_INTEGRATION_TEST=1 to probe ${base}`);
  process.exit(0);
}
try {
  const response = await fetch(base, { signal: AbortSignal.timeout(3000) });
  console.log(JSON.stringify({ url: base, status: response.status, ok: response.ok }));
  if (!response.ok && response.status !== 404) process.exitCode = 1;
} catch (error) {
  console.error(`FunASR service unavailable at ${base}: ${error.message}`);
  process.exitCode = 1;
}
