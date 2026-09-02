const test = require("node:test");
const assert = require("node:assert/strict");
const { collectFallbackStreams, formatStreams, isDirectMediaUrl } = require("../scraper");

test("accepts direct HLS/MP4 URLs from provider CDNs", () => {
  const urls = [
    "https://javplayers.com/cdn/hls/abc/master.txt",
    "https://cdn.example.net/video/master.m3u8?token=ok",
    "https://media.example.net/files/title.mp4"
  ];
  for (const url of urls) assert.equal(isDirectMediaUrl(url), true, url);
});

test("rejects Render and addon HLS URLs as video streams", () => {
  const urls = [
    "https://avmirror.onrender.com/hls?url=https%3A%2F%2Fcdn.example%2Fmaster.m3u8",
    "https://example.onrender.com/video/master.m3u8",
    "https://avmirror.example/hls/master.m3u8"
  ];
  for (const url of urls) assert.equal(isDirectMediaUrl(url), false, url);
});

test("formats direct streams from generic source HTML without an intermediary", () => {
  const pageUrl = "https://jav.guru/123/title/";
  const html = `
    <video src="https://cdn.example.net/title/master.m3u8"></video>
    <video src="https://avmirror.onrender.com/hls?url=https%3A%2F%2Fcdn.example.net%2Ftitle%2Fmaster.m3u8"></video>
  `;
  const fallback = collectFallbackStreams(html, pageUrl);
  const streams = formatStreams(fallback.found, fallback.players, pageUrl);
  assert.deepEqual(streams.map(stream => stream.url), ["https://cdn.example.net/title/master.m3u8"]);
  assert.equal(streams.some(stream => /render|\/hls/i.test(stream.url)), false);
});
