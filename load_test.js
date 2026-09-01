const base = process.env.BASE_URL || 'http://127.0.0.1:7000';
const endpoint = process.env.ENDPOINT || '/health';
const levels = (process.env.LEVELS || '10,25,50,100').split(',').map(Number);
const durationMs = Number(process.env.DURATION_MS || 5000);

async function oneRequest(url) {
  const started = performance.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const body = await response.arrayBuffer();
    return { ok: response.ok, status: response.status, ms: performance.now() - started, bytes: body.byteLength };
  } catch (error) {
    return { ok: false, status: 0, ms: performance.now() - started, error: error.name || String(error) };
  }
}

async function run(concurrency) {
  const url = `${base}${endpoint}`;
  const results = [];
  const endAt = Date.now() + durationMs;
  let active = 0;
  let issued = 0;
  await new Promise(resolve => {
    const pump = () => {
      while (active < concurrency && Date.now() < endAt) {
        active++;
        issued++;
        oneRequest(url).then(result => results.push(result)).finally(() => {
          active--;
          if (Date.now() < endAt) pump();
          else if (active === 0) resolve();
        });
      }
      if (active === 0 && Date.now() >= endAt) resolve();
    };
    pump();
  });
  results.sort((a, b) => a.ms - b.ms);
  const successful = results.filter(x => x.ok);
  const latencies = results.map(x => x.ms);
  const percentile = p => latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * p) - 1)] : 0;
  const avg = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
  const errors = results.length - successful.length;
  console.log(JSON.stringify({ endpoint, concurrency, durationMs, issued, completed: results.length, success: successful.length, errors, rps: Number((results.length / (durationMs / 1000)).toFixed(2)), avgMs: Number(avg.toFixed(2)), p50Ms: Number(percentile(0.50).toFixed(2)), p95Ms: Number(percentile(0.95).toFixed(2)), p99Ms: Number(percentile(0.99).toFixed(2)), statuses: results.reduce((m, x) => ((m[x.status] = (m[x.status] || 0) + 1), m), {}) }));
}

(async () => {
  console.log(JSON.stringify({ base, endpoint, levels, durationMs }));
  for (const level of levels) await run(level);
})();
