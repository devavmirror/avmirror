const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeStreams } = require("../src/lib/unified");

const hash = (digit) => digit.repeat(40);

test("mergeStreams keeps one HTTP player and selects one live torrent", () => {
  const streams = mergeStreams([
    { url: "https://media.example/video.m3u8", name: "source-http" },
    { infoHash: hash("a"), peerProbeResponded: true, peerProbeLive: false, seeders: 99 },
    { infoHash: hash("b"), peerProbeResponded: true, peerProbeLive: true, livePeers: 3, liveSeeders: 1 },
    { infoHash: hash("b"), peerProbeResponded: true, peerProbeLive: true, livePeers: 3, liveSeeders: 1 },
  ]);

  assert.equal(streams.length, 2);
  assert.equal(streams[0].url, "https://media.example/video.m3u8");
  assert.equal(streams[1].infoHash, hash("b"));
  assert.equal(streams[1].livePeers, 3);
});

test("mergeStreams uses indexed seeders as fallback when tracker reports zero peers", () => {
  const streams = mergeStreams([
    { infoHash: hash("c"), peerProbeResponded: true, peerProbeLive: false, seeders: 25 },
  ]);

  assert.equal(streams.length, 1);
  assert.equal(streams[0].infoHash, hash("c"));
  assert.match(streams[0].title, /indexados/);
});

test("mergeStreams uses an indexed fallback only when probes are inconclusive", () => {
  const streams = mergeStreams([
    { infoHash: hash("d"), peerProbeResponded: false, peerProbeLive: false, seeders: 6 },
    { infoHash: hash("e"), peerProbeResponded: false, peerProbeLive: false, seeders: 2 },
  ]);

  assert.equal(streams.length, 1);
  assert.equal(streams[0].infoHash, hash("d"));
  assert.match(streams[0].title, /indexados/);
});

test("mergeStreams always includes sources array on torrent streams", () => {
  const streams = mergeStreams([
    { infoHash: hash("f"), peerProbeResponded: false, peerProbeLive: false, seeders: 3 },
  ]);

  assert.equal(streams.length, 1);
  assert.ok(Array.isArray(streams[0].sources), "torrent stream must have sources array");
  assert.ok(streams[0].sources.length > 0, "sources must not be empty");
  assert.equal(streams[0].behaviorHints.notWebReady, false);
});
