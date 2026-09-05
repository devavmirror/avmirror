const { unifiedCatalog, unifiedPopular, unifiedUncensored } = require("./lib/unified");
const { unifiedMeta } = require("./lib/unified");
const { writeDiskCache, catalogPath, metaPath } = require("./cache");

const INTERVAL_MS = Number(process.env.CACHE_UPDATE_INTERVAL_MS || 30 * 60 * 1000);
const CATALOG_PAGES = Number(process.env.CACHE_CATALOG_PAGES || 3);
const META_LIMIT = Number(process.env.CACHE_META_LIMIT || 30);

const CATALOGS = [
  { id: "avmirror", fetch: (page) => unifiedCatalog({ page }) },
  { id: "avmirror-popular", fetch: (page) => unifiedPopular({ page }) },
  { id: "avmirror-uncensored", fetch: (page) => unifiedUncensored({ page }) },
];

async function updateCatalogs() {
  for (const cat of CATALOGS) {
    for (let page = 1; page <= CATALOG_PAGES; page++) {
      try {
        const metas = await cat.fetch(page);
        const payload = { metas: Array.isArray(metas) ? metas : [], updatedAt: new Date().toISOString() };
        await writeDiskCache(catalogPath(cat.id, page), payload);
        console.log(`[cache] ${cat.id} page ${page}: ${payload.metas.length} items`);
      } catch (e) {
        console.error(`[cache] ${cat.id} page ${page} error:`, e.message);
      }
    }
  }
}

async function updateTopMeta() {
  try {
    const items = await unifiedCatalog({ page: 1 });
    if (!Array.isArray(items)) return;
    const toCache = items.slice(0, META_LIMIT);
    for (const item of toCache) {
      try {
        const meta = await unifiedMeta(item.id);
        if (meta) await writeDiskCache(metaPath(item.id), { meta, updatedAt: new Date().toISOString() });
      } catch {}
    }
    console.log(`[cache] meta: ${toCache.length} items cached`);
  } catch (e) {
    console.error("[cache] meta error:", e.message);
  }
}

async function runUpdate() {
  console.log("[cache] Starting update...");
  const start = Date.now();
  await updateCatalogs();
  await updateTopMeta();
  console.log(`[cache] Update done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

let timer = null;
function startWorker() {
  console.log(`[cache] Worker started (interval: ${INTERVAL_MS / 1000}s)`);
  runUpdate();
  timer = setInterval(runUpdate, INTERVAL_MS);
  return { stop: () => { clearInterval(timer); } };
}

if (require.main === module) {
  startWorker();
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
}

module.exports = { startWorker, runUpdate };
