const test = require("node:test");
const assert = require("node:assert/strict");
const { cleanTrackers } = require("../src/lib/peer-probe");

test("peer probe accepts direct tracker sources and removes prefixes/duplicates", () => {
  const trackers = cleanTrackers({ sources: [
    "tracker:udp://tracker.example:1337/announce",
    "udp://tracker.example:1337/announce",
    "tracker:http://tracker.example/announce",
    "https://tracker.example/scrape",
    "ftp://invalid.example/announce",
  ] });
  assert.deepEqual(trackers, [
    "http://tracker.example/announce",
    "https://tracker.example/scrape",
    "udp://tracker.example:1337/announce",
  ]);
});

test("peer probe rejects malformed hashes without network access", async () => {
  const { probeTorrent } = require("../src/lib/peer-probe");
  assert.deepEqual(await probeTorrent({ infoHash: "invalid" }), { complete: 0, incomplete: 0, peers: 0, live: false });
});
