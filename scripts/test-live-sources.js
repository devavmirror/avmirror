const { scrapeCatalog, scrapeMeta, scrapeStreams, closeBrowser } = require("../scraper");
const { scrapeAv01Catalog, scrapeAv01Meta, scrapeAv01Streams } = require("../av01");
const { scrapeJavRiderCatalog, scrapeJavRiderMeta, scrapeJavRiderStreams, closeJavRiderBrowser } = require("../javrider");
const fs = require("node:fs/promises");

async function one(label, catalog, meta, streams, options) {
  const result = { label, catalog: { ok: false }, meta: { ok: false }, streams: { ok: false } };
  try {
    const items = await catalog(options);
    result.catalog = { ok: Array.isArray(items) && items.length > 0, count: Array.isArray(items) ? items.length : 0 };
    const item = items?.[0];
    if (!item?.id) throw new Error("catalog returned no usable item");
    const metadata = await meta(item.id);
    result.meta = { ok: !!metadata, id: item.id, name: metadata?.name || null };
    const found = await streams(item.id);
    result.streams = { ok: Array.isArray(found) && found.some(s => /^https?:\/\//i.test(s?.url || "")), count: Array.isArray(found) ? found.length : 0, urls: (found || []).slice(0, 3).map(s => s.url).filter(Boolean) };
  } catch (error) { result.error = error.message; }
  console.log(JSON.stringify(result));
  return result;
}

(async () => {
  const results = [];
  try {
    results.push(await one("AVMirror/Jav.guru", scrapeCatalog, scrapeMeta, scrapeStreams, { page: 1, search: "", genre: "", mode: "avmirror" }));
    results.push(await one("AV01", scrapeAv01Catalog, scrapeAv01Meta, scrapeAv01Streams, { page: 1, search: "", genre: "", mode: "av01" }));
    results.push(await one("JavRider", scrapeJavRiderCatalog, scrapeJavRiderMeta, scrapeJavRiderStreams, { page: 1, search: "", genre: "", mode: "javrider" }));
  } finally {
    await Promise.allSettled([closeBrowser(), closeJavRiderBrowser()]);
  }
  await fs.writeFile("/tmp/avmirror-live-results.json", JSON.stringify(results, null, 2) + "\n");
  const passed = results.filter(r => r.catalog.ok && r.meta.ok && r.streams.ok).length;
  console.log(`LIVE_RESULT ${passed}/${results.length}`);
  if (passed !== results.length) process.exitCode = 1;
})();
