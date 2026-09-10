const fs = require("node:fs/promises");
const path = require("node:path");
const { scrapeCatalog } = require("../src/scrapers/avmirror");

const ROOT = path.join(__dirname, "..", "data", "catalog");
const PAGES = Math.max(1, Number(process.env.CACHE_PAGES || 3));
const modes = [
  ["recentes", "avmirror"],
  ["populares", "avmirror-popular"],
  ["sem-censura", "avmirror-uncensored"],
  ["censurado", "avmirror-censored"]
];

async function updateOne(name, mode) {
  const pages = [];
  let previous = null;
  try { previous = JSON.parse(await fs.readFile(path.join(ROOT, `${name}.json`), "utf8")); } catch {}
  for (let page = 1; page <= PAGES; page++) {
    try {
      const items = await scrapeCatalog({ page, mode });
      const fresh = Array.isArray(items) ? items : [];
      const old = previous?.pages?.find(entry => Number(entry.page) === page)?.items || [];
      pages.push({ page, items: fresh.length ? fresh : old });
      console.log(`[cache] ${name} page=${page} items=${fresh.length}${fresh.length ? "" : ` (kept ${old.length})`}`);
    } catch (error) {
      console.error(`[cache] ${name} page=${page} failed: ${error.message}`);
      pages.push({ page, items: previous?.pages?.find(entry => Number(entry.page) === page)?.items || [] });
    }
  }
  if (!pages.some(page => page.items.length > 0)) throw new Error(`${name} produced no items`);
  return { schema: 1, source: "avmirror", mode, generatedAt: new Date().toISOString(), pages };
}

(async () => {
  await fs.mkdir(ROOT, { recursive: true });
  for (const [name, mode] of modes) {
    const output = await updateOne(name, mode);
    await fs.writeFile(path.join(ROOT, `${name}.json`), `${JSON.stringify(output, null, 2)}\n`);
  }
})().catch(error => {
  console.error(`[cache] fatal: ${error.stack || error.message}`);
  process.exitCode = 1;
});
