const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const port = Number(process.env.E2E_PORT || 7111);
const base = `http://127.0.0.1:${port}`;
const sources = ['avmirror', 'av01', 'javrider'];
const limit = Number(process.env.E2E_WORKS || 5);
const server = spawn(process.execPath, ['server.js'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, LOCAL_MODE: 'true', BIND_HOST: '127.0.0.1', LAN_HOST: '127.0.0.1', PORT: String(port), BROWSER_HEADLESS: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
server.stdout.on('data', chunk => { logs += chunk; });
server.stderr.on('data', chunk => { logs += chunk; });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(url, options = {}) {
  const response = await fetch(url, { redirect: 'follow', ...options });
  const body = Buffer.from(await response.arrayBuffer());
  return { status: response.status, type: response.headers.get('content-type') || '', body, url: response.url };
}
function result(source, id, title) { return { source, id, title, catalog: 0, meta: 0, image: 0, streams: 0, media: [], errors: [] }; }
async function main() {
  for (let i = 0; i < 30; i++) { try { if ((await request(`${base}/health`)).status === 200) break; } catch {} await sleep(500); }
  const report = { startedAt: new Date().toISOString(), base, worksPerSource: limit, sources: [], logs: '' };
  for (const source of sources) {
    const sourceReport = { source, catalogStatus: 0, works: [] };
    try {
      const catalog = await request(`${base}/catalog/movie/${source}.json`);
      sourceReport.catalogStatus = catalog.status;
      const metas = JSON.parse(catalog.body.toString()).metas || [];
      for (const item of metas.slice(0, limit)) {
        const r = result(source, item.id, item.name);
        sourceReport.works.push(r);
        try {
          const id = encodeURIComponent(item.id);
          const meta = await request(`${base}/meta/movie/${id}.json`);
          r.meta = meta.status;
          const metaJson = JSON.parse(meta.body.toString()).meta || {};
          if (metaJson.poster) { const image = await request(metaJson.poster); r.image = image.status; if (image.status !== 200) r.errors.push(`image:${image.status}`); }
          const streams = await request(`${base}/stream/movie/${id}.json`);
          r.streams = streams.status;
          const streamJson = JSON.parse(streams.body.toString());
          for (const stream of (streamJson.streams || []).filter(x => x.url).slice(0, 3)) {
            const media = await request(stream.url);
            const entry = { title: stream.title, status: media.status, type: media.type, bytes: media.body.length };
            if (media.status === 200 && /mpegurl|text\/plain/i.test(media.type)) {
              const uri = media.body.toString().split(/\r?\n/).find(line => line.trim() && !line.startsWith('#'));
              if (uri) { const segment = await request(new URL(uri.trim(), media.url).href, { headers: { range: 'bytes=0-1023' } }); entry.segmentStatus = segment.status; entry.segmentType = segment.type; }
            }
            r.media.push(entry);
            if (media.status !== 200 || entry.segmentStatus && ![200, 206].includes(entry.segmentStatus)) r.errors.push(`media:${media.status}/segment:${entry.segmentStatus || '-'}`);
          }
          if (!r.media.length) r.errors.push('no-media-url');
        } catch (error) { r.errors.push(error.message); }
      }
    } catch (error) { sourceReport.error = error.message; }
    report.sources.push(sourceReport);
  }
  report.logs = logs.slice(-12000);
  fs.writeFileSync(path.resolve(__dirname, '..', 'dist-e2e-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  const failures = report.sources.flatMap(x => x.works).filter(x => x.errors.length).length;
  server.kill('SIGTERM');
  process.exitCode = failures ? 1 : 0;
}
main().catch(error => { console.error(error); server.kill('SIGTERM'); process.exitCode = 1; });
