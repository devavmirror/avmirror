const fs = require("node:fs/promises");
const path = require("node:path");

const CACHE_DIR = path.resolve(__dirname, "../cache");
const CACHE_TTL_MS = Number(process.env.DISK_CACHE_TTL_MS || 30 * 60 * 1000); // 30 min default

async function readDiskCache(relative) {
  try {
    const file = path.join(CACHE_DIR, relative);
    const raw = await fs.readFile(file, "utf8");
    const data = JSON.parse(raw);
    if (data && typeof data === "object") return data;
  } catch {}
  return null;
}

async function writeDiskCache(relative, data) {
  try {
    const file = path.join(CACHE_DIR, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(data));
    return true;
  } catch { return false; }
}

function catalogPath(sourceId, page) {
  return `catalog/${encodeURIComponent(sourceId)}/${page}.json`;
}

function metaPath(id) {
  return `meta/${encodeURIComponent(id)}.json`;
}

function isCacheFresh(data) {
  if (!data || !data.updatedAt) return false;
  return Date.now() - new Date(data.updatedAt).getTime() < CACHE_TTL_MS;
}

module.exports = { readDiskCache, writeDiskCache, catalogPath, metaPath, isCacheFresh, CACHE_DIR };
