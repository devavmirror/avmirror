const { scrapeJableCatalog, scrapeJableMeta, scrapeJableStreams, closeJableBrowser } = require("../jable");
const fs = require("node:fs/promises");

async function main() {
  const result = { label: "Jable.TV", catalog: { ok: false }, meta: { ok: false }, streams: { ok: false } };
  try {
    const items = await scrapeJableCatalog({ page: 1, mode: "jable" });
    result.catalog = { ok: Array.isArray(items) && items.length > 0, count: Array.isArray(items) ? items.length : 0 };
    const item = items?.[0];
    if (!item?.id) throw new Error("catalog returned no usable item");
    const metadata = await scrapeJableMeta(item.id);
    result.meta = { ok: !!metadata, id: item.id, name: metadata?.name || null };
    const found = await scrapeJableStreams(item.id);
    result.streams = {
      ok: Array.isArray(found) && found.some(stream => /\.m3u8(?:[?#]|$)/i.test(stream?.url || "")),
      count: Array.isArray(found) ? found.length : 0,
      urls: (found || []).slice(0, 3).map(stream => stream.url).filter(Boolean)
    };
  } catch (error) { result.error = error.message; }
  console.log(JSON.stringify(result));
  await fs.writeFile("/tmp/avmirror-jable-live-results.json", JSON.stringify(result, null, 2) + "\n");
  await closeJableBrowser();
  if (!(result.catalog.ok && result.meta.ok && result.streams.ok)) process.exitCode = 1;
}

main().catch(async error => { console.error(error); await closeJableBrowser(); process.exitCode = 1; });
