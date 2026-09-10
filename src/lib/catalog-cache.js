const fs = require("node:fs");
const path = require("node:path");

const CACHE_ROOT = path.join(__dirname, "..", "..", "data", "catalog");
const FILES = {
  avmirror: "recentes.json",
  "avmirror-popular": "populares.json",
  "avmirror-uncensored": "sem-censura.json",
  "avmirror-censored": "censurado.json"
};
const MAX_CACHE_AGE_MS = Number(process.env.CATALOG_CACHE_MAX_AGE_MS || 36 * 60 * 60 * 1000);
const posterMemory = new Map();
const POSTER_MEMORY_MAX = 2000;

// In-memory catalog cache: { mode_page: { data, expiresAt } }
const catalogMemory = new Map();
const CATALOG_MEMORY_TTL_MS = 5 * 60 * 1000;
const CATALOG_MEMORY_MAX = 100;

// Reverse index: id → url built from all catalog cache files
let posterIndex = null;
let posterIndexBuiltAt = 0;
const POSTER_INDEX_TTL_MS = 10 * 60 * 1000;

function prunePosterMemory() {
  const now = Date.now();
  for (const [key, val] of posterMemory) {
    if (val.expiresAt <= now) posterMemory.delete(key);
  }
  while (posterMemory.size > POSTER_MEMORY_MAX) {
    posterMemory.delete(posterMemory.keys().next().value);
  }
}

function pruneCatalogMemory() {
  const now = Date.now();
  for (const [key, val] of catalogMemory) {
    if (val.expiresAt <= now) catalogMemory.delete(key);
  }
  while (catalogMemory.size > CATALOG_MEMORY_MAX) {
    catalogMemory.delete(catalogMemory.keys().next().value);
  }
}

function buildPosterIndex() {
  const index = new Map();
  for (const file of Object.values(FILES)) {
    try {
      const filename = path.join(CACHE_ROOT, file);
      const stat = fs.statSync(filename);
      if (Date.now() - stat.mtimeMs > MAX_CACHE_AGE_MS) continue;
      const payload = JSON.parse(fs.readFileSync(filename, "utf8"));
      if (payload.schema !== 1 || payload.source !== "avmirror" || !Array.isArray(payload.pages)) continue;
      for (const page of payload.pages) {
        for (const item of page.items || []) {
          if (item?.id && item.poster && !index.has(item.id)) {
            index.set(item.id, item.poster);
          }
        }
      }
    } catch {}
  }
  posterIndex = index;
  posterIndexBuiltAt = Date.now();
  return index;
}

function readCatalogCache(mode, page = 1) {
  const file = FILES[mode];
  if (!file) return null;

  pruneCatalogMemory();
  const memKey = `${mode}_${page}`;
  const memCached = catalogMemory.get(memKey);
  if (memCached && memCached.expiresAt > Date.now()) return memCached.data;

  try {
    const filename = path.join(CACHE_ROOT, file);
    const stat = fs.statSync(filename);
    if (Date.now() - stat.mtimeMs > MAX_CACHE_AGE_MS) return null;
    const payload = JSON.parse(fs.readFileSync(filename, "utf8"));
    if (payload.schema !== 1 || payload.source !== "avmirror" || !Array.isArray(payload.pages)) return null;
    const result = payload.pages.find(entry => Number(entry.page) === Number(page));
    const items = Array.isArray(result?.items) && result.items.length ? result.items : null;
    if (items) {
      catalogMemory.set(memKey, { data: items, expiresAt: Date.now() + CATALOG_MEMORY_TTL_MS });
    }
    return items;
  } catch {
    return null;
  }
}

function readPosterCache(id) {
  const wanted = String(id || "");
  if (!wanted) return null;

  prunePosterMemory();

  const cached = posterMemory.get(wanted);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  if (!posterIndex || Date.now() - posterIndexBuiltAt > POSTER_INDEX_TTL_MS) {
    buildPosterIndex();
  }

  const poster = posterIndex.get(wanted);
  if (poster) {
    posterMemory.set(wanted, { url: poster, expiresAt: Date.now() + 10 * 60 * 1000 });
    return poster;
  }

  return null;
}

module.exports = { readCatalogCache, readPosterCache, storePosterFromCatalog };

function storePosterFromCatalog(items) {
  if (!Array.isArray(items)) return;
  prunePosterMemory();
  const now = Date.now();
  for (const item of items) {
    if (item?.id && item.poster && !posterMemory.has(item.id)) {
      posterMemory.set(item.id, { url: item.poster, expiresAt: now + 30 * 60 * 1000 });
      if (posterIndex) posterIndex.set(item.id, item.poster);
    }
  }
}
