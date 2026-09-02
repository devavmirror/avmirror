const fs = require("node:fs/promises");
const path = require("node:path");
const { scrapeCatalog, scrapeMeta, closeBrowser } = require("../scraper");
const { scrapeAv01Catalog, scrapeAv01Meta } = require("../av01");
const { scrapeJavRiderCatalog, scrapeJavRiderMeta } = require("../javrider");

const ROOT = path.resolve(__dirname, "../cache");
const pages = Math.max(1, Number(process.env.CACHE_PAGES || 1));
const metaLimit = Math.max(0, Number(process.env.CACHE_META_LIMIT || 40));
const sources = [
  { id: "avmirror", catalog: scrapeCatalog, meta: scrapeMeta },
  { id: "avmirror-popular", catalog: scrapeCatalog, meta: scrapeMeta },
  { id: "av01", catalog: scrapeAv01Catalog, meta: scrapeAv01Meta },
  { id: "av01-popular", catalog: scrapeAv01Catalog, meta: scrapeAv01Meta },
  { id: "javrider", catalog: scrapeJavRiderCatalog, meta: scrapeJavRiderMeta },
  { id: "javrider-popular", catalog: scrapeJavRiderCatalog, meta: scrapeJavRiderMeta }
];

async function writeJson(relative, value) {
  const target = path.join(ROOT, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(value, null, 2) + "\n");
}

async function main() {
  const index = { generatedAt: new Date().toISOString(), ttlSeconds: 21600, catalogs: [], metadata: [] };
  try {
    for (const source of sources) {
      for (let page = 1; page <= pages; page++) {
        const options = { page, search: "", genre: "", mode: source.id };
        const metas = source.id.startsWith("av01") ? await source.catalog(options) : source.id.startsWith("javrider") ? await source.catalog(options) : await source.catalog(options);
        const payload = { metas: Array.isArray(metas) ? metas : [], cacheMaxAge: 900, staleRevalidate: 3600 };
        await writeJson(`catalog/${encodeURIComponent(source.id)}/${page}.json`, payload);
        index.catalogs.push({ source: source.id, page, count: payload.metas.length });
        if (page === 1 && metaLimit > 0) {
          for (const item of payload.metas.slice(0, metaLimit)) {
            try {
              const meta = await source.meta(item.id);
              if (meta) {
                await writeJson(`meta/${encodeURIComponent(item.id)}.json`, { meta, cacheMaxAge: 3600, staleRevalidate: 7200 });
                index.metadata.push(item.id);
              }
            } catch (error) { console.warn(`meta ${item.id}: ${error.message}`); }
          }
        }
      }
    }
    await writeJson("cache-index.json", index);
    console.log(`Cache atualizado: ${index.catalogs.length} páginas, ${index.metadata.length} metadados.`);
  } finally {
    await Promise.allSettled([closeBrowser(), require("../javrider").closeJavRiderBrowser?.(), require("../av01").closeAv01Browser?.()]);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
