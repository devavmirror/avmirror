const fs = require("node:fs");
const path = require("node:path");

const CACHE_ROOT = path.join(__dirname, "..", "..", "data", "catalog");
const CATALOG_FILE = path.join(CACHE_ROOT, "avmirror-recentes.json");
const POPULAR_FILE = path.join(CACHE_ROOT, "avmirror-populares.json");
const UNCENSORED_FILE = path.join(CACHE_ROOT, "avmirror-sem-censura.json");
const CENSORED_FILE = path.join(CACHE_ROOT, "avmirror-censurado.json");

const CATALOG_INTERVAL_MS = Number(process.env.SCRAPER_INTERVAL_MS || 15 * 60 * 1000);

let backgroundTimer = null;
let running = false;
let lastRun = 0;
let stats = { catalogs: 0, errors: 0 };
let canWrite = true;

function ensureDir() {
  try { fs.mkdirSync(CACHE_ROOT, { recursive: true }); } catch {}
}

function saveCatalog(file, data) {
  if (!canWrite) return;
  try {
    ensureDir();
    const payload = { schema: 1, source: "avmirror", pages: data };
    fs.writeFileSync(file, JSON.stringify(payload), "utf8");
  } catch (e) {
    if (e.code === "EROFS" || e.code === "EACCES") {
      canWrite = false;
      console.error(`[bg] read-only filesystem → disk cache disabled`);
    } else {
      console.error(`[bg] save error:`, e.message);
    }
  }
}

async function scrapeCatalogPage(scraper, mode, page) {
  try {
    const items = await scraper({ page, search: "", mode });
    return { page, items: items || [] };
  } catch (e) {
    stats.errors++;
    return { page, items: [] };
  }
}

async function refreshCatalogs() {
  if (running) return;
  running = true;
  const start = Date.now();

  try {
    const { SOURCES } = require("./unified");
    const primary = SOURCES.find(s => s.prefix === "avmirror");
    if (!primary) return;

    const pages = [1, 2, 3, 4, 5];
    const modes = [
      { file: CATALOG_FILE, mode: "avmirror" },
      { file: POPULAR_FILE, mode: "avmirror-popular" },
      { file: UNCENSORED_FILE, mode: "avmirror-uncensored" },
      { file: CENSORED_FILE, mode: "avmirror-censored" },
    ];

    for (const m of modes) {
      const results = [];
      for (const page of pages) {
        const result = await scrapeCatalogPage(primary.catalog, m.mode, page);
        results.push(result);
        await new Promise(r => setTimeout(r, 2500));
      }
      if (results.some(r => r.items.length > 0)) {
        saveCatalog(m.file, results);
        const { storePosterFromCatalog } = require("./catalog-cache");
        for (const r of results) storePosterFromCatalog(r.items);
        stats.catalogs++;
      }
      await new Promise(r => setTimeout(r, 3000));
    }
  } catch (e) {
    stats.errors++;
  }

  lastRun = Date.now();
  running = false;
}

function startBackground() {
  console.error(`[bg] starting (interval: ${CATALOG_INTERVAL_MS / 1000}s)`);

  // Initial refresh after 30s
  setTimeout(() => refreshCatalogs(), 30 * 1000);

  backgroundTimer = setInterval(() => {
    refreshCatalogs();
  }, CATALOG_INTERVAL_MS);
}

function getBackgroundStats() {
  return { ...stats, lastRun, running, canWrite };
}

module.exports = { startBackground, refreshCatalogs, getBackgroundStats };
