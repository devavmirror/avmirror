const test = require("node:test");
const assert = require("node:assert/strict");
const { scrapeCatalog: fCatalog, scrapeMeta: fMeta, scrapeStreams: fStreams } = require("../src/scrapers/ffjav");

test("Kiwi resolves torrent streams from .torrent file", async () => {
  const matches = await fCatalog({ page: 1 });
  assert.ok(matches.length > 0, "should have catalog items");
  const first = matches[0];
  assert.ok(first.id, "first item should have an id");
  const meta = await fMeta(first.id);
  assert.ok(meta.name, "should have a name");
  const streams = await fStreams(first.id);
  assert.ok(streams.length >= 1, "should have at least 1 stream");
  assert.ok(streams.every(s => /^[a-f0-9]{40}$/.test(s.infoHash)), "all streams should have 40-char infoHash");
  assert.ok(streams.every(s => Array.isArray(s.sources) && s.sources.length > 0), "all streams should have tracker sources");
});
