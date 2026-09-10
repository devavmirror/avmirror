const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeTorrentStream } = require("../src/lib/unified");

test("torrent streams keep direct P2P shape and receive fallback trackers", () => {
  const stream = normalizeTorrentStream({
    infoHash: "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
    trackers: ["udp://tracker.example.test:1337/announce"],
  });
  assert.equal(stream.infoHash, "abcdef0123456789abcdef0123456789abcdef01");
  assert.equal(stream.url, undefined, "direct P2P must not be converted to an HTTP proxy URL");
  assert.ok(stream.sources.includes("tracker:udp://tracker.example.test:1337/announce"));
  assert.ok(stream.sources.some(source => source.includes("tracker.opentrackr.org")));
});

test("invalid torrent hashes are rejected", () => {
  assert.equal(normalizeTorrentStream({ infoHash: "not-a-hash" }), null);
});

test("multi-file JAV torrent convention selects the video entry", () => {
  const stream = normalizeTorrentStream({
    infoHash: "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
  });
  assert.equal(stream.infoHash, "abcdef0123456789abcdef0123456789abcdef01");
  assert.equal(stream.url, undefined);
});
