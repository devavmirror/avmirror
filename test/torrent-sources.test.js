const test = require("node:test");
const assert = require("node:assert/strict");
const { scrapeCatalog: iCatalog, scrapeMeta: iMeta, scrapeStreams: iStreams } = require("../src/scrapers/ijavtorrent");

test("Watermelon resolves torrent streams for a real item", async () => {
  const matches = await iCatalog({ search: "SNOS-313" });
  assert.ok(matches.some(item => /SNOS-313/i.test(item.name)));
  const id = "ijavtorrent:https://ijavtorrent.com/movie/snos-313-233031";
  const meta = await iMeta(id);
  assert.match(meta.name, /SNOS-313/i);
  assert.match(meta.poster, /images\.ijavtorrent\.com/);
  const streams = await iStreams(id);
  assert.ok(streams.length >= 3);
  assert.ok(streams.every(stream => /^[a-f0-9]{40}$/.test(stream.infoHash)), "all streams should have a 40-char infoHash");
  assert.ok(streams.every(stream => Array.isArray(stream.sources) && stream.sources.length > 0), "all streams should have tracker sources");
});
