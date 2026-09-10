const test = require("node:test");
const assert = require("node:assert/strict");
const { scrapeCatalog: pCatalog, scrapeMeta: pMeta, scrapeStreams: pStreams } = require("../src/scrapers/projectjav");

test("Blueberry resolves torrent streams for a real item", async () => {
  const matches = await pCatalog({ search: "SNIS-896" });
  assert.ok(matches.some(item => /SNIS-896/i.test(item.name)), "should find SNIS-896 in catalog");
  const item = matches.find(item => /SNIS-896/i.test(item.name));
  assert.ok(item.id, "should have an id");
  const meta = await pMeta(item.id);
  assert.match(meta.name, /SNIS-896/i);
  assert.ok(meta.poster, "should have a poster");
  const streams = await pStreams(item.id);
  assert.ok(streams.length >= 1, "should have at least 1 stream");
  assert.ok(streams.every(s => /^[a-f0-9]{40}$/.test(s.infoHash)), "all streams should have 40-char infoHash");
  assert.ok(streams.every(s => Array.isArray(s.sources) && s.sources.length > 0), "all streams should have tracker sources");
});
