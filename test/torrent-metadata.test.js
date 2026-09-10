const test = require("node:test");
const assert = require("node:assert/strict");
const { buildMagnet, chooseVideo } = require("../src/lib/torrent-metadata");

test("chooseVideo selects the largest main video and returns its torrent index", () => {
  const result = chooseVideo([
    { name: "links.url", length: 20 },
    { name: "movie.mp4", length: 8_000_000_000 },
    { name: "preview.mp4", length: 2_000_000 },
    { name: "extra.mkv", length: 70_000_000 },
  ]);
  assert.deepEqual(result, {
    fileIdx: 1,
    fileName: "movie.mp4",
    fileSize: 8_000_000_000,
    videoCount: 3,
  });
});

test("chooseVideo prefers a non-preview video even when the preview is larger", () => {
  const result = chooseVideo([
    { name: "trailer.mp4", length: 90_000_000 },
    { name: "full.mkv", length: 70_000_000 },
  ]);
  assert.equal(result.fileIdx, 1);
  assert.equal(result.fileName, "full.mkv");
});

test("buildMagnet converts Stremio tracker sources to magnet parameters", () => {
  const magnet = buildMagnet({
    infoHash: "A".repeat(40),
    sources: ["tracker:https://tracker.example/announce", "udp://tracker.example:80/announce"],
  });
  assert.match(magnet, /^magnet:\?xt=urn:btih:a{40}/);
  assert.match(magnet, /tr=https%3A%2F%2Ftracker.example%2Fannounce/);
  assert.match(magnet, /tr=udp%3A%2F%2Ftracker.example%3A80%2Fannounce/);
});
