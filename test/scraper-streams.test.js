const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveSearchoPlayer, formatStreams } = require("../src/scrapers/avmirror");

const originalFetch = global.fetch;

function response(body, status = 200, headers = { "content-type": "text/html" }) {
  return new Response(body, { status, headers });
}

function searchoFixture(id, file) {
  const searchoUrl = `https://jav.guru/searcho/?fixture=${id}`;
  const realUrl = "https://jav.guru/searcho/?xr=cba";
  const searchoHtml = `<div id="fixture-${id}" data-a="abc"></div><script>var cid: 'fixture-${id}', base: 'https://jav.guru/searcho/', rtype: 'x', keys: ['data-a'];</script>`;
  const playerHtml = `<video src="${file}"></video>`;
  return { searchoUrl, realUrl, searchoHtml, playerHtml };
}

test("resolveSearchoPlayer rejects TurboViPlay placeholder image segments", async () => {
  const fixture = searchoFixture("tv-regression", "https://cdn2.turboviplay.com/data3/tv/master.m3u8");
  global.fetch = async input => {
    const url = String(input);
    if (url === fixture.searchoUrl) return response(fixture.searchoHtml);
    if (url === fixture.realUrl) return response(fixture.playerHtml);
    if (url === "https://cdn2.turboviplay.com/data3/tv/master.m3u8") {
      return response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\nhttps://gs01.turbosplayer.com/file/tv/master.m3u8", 200, { "content-type": "application/vnd.apple.mpegurl" });
    }
    if (url === "https://gs01.turbosplayer.com/file/tv/master.m3u8") {
      return response("#EXTM3U\n#EXTINF:5,\nhttps://lh3.googleusercontent.com/d/tv-segment=d", 200, { "content-type": "application/vnd.apple.mpegurl" });
    }
    if (url === "https://lh3.googleusercontent.com/d/tv-segment=d") {
      return response("not a video", 200, { "content-type": "image/png" });
    }
    throw new Error(`Unexpected fixture request: ${url}`);
  };

  try {
    assert.equal(await resolveSearchoPlayer(fixture.searchoUrl), null);
  } finally {
    global.fetch = originalFetch;
  }
});

test("formatStreams preserves Nova direct URL and player headers", () => {
  const sourceUrl = "https://media.example.test/master.m3u8?token=direct";
  const playerUrl = "https://player.example.test/embed/abc123";
  const found = new Map([[sourceUrl, {
    url: sourceUrl,
    source: "VO",
    playerUrl
  }]]);

  const [stream] = formatStreams(found, new Set(), "https://jav.guru/123/item");
  assert.equal(stream.url, sourceUrl);
  assert.equal(stream.behaviorHints.notWebReady, false);
  assert.deepEqual(stream.behaviorHints.proxyHeaders.request, {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
    Referer: playerUrl,
    Origin: "https://player.example.test"
  });
  assert.equal(stream.url.includes("onrender.com"), false);
  assert.equal(stream.url.includes("/hls?"), false);
});

test("resolveSearchoPlayer skips a failed HLS mirror and keeps the working variant", async () => {
  const badUrl = "https://cdn.example.test/hls3/master.m3u8";
  const goodUrl = "https://cdn.example.test/hls2/master.m3u8";
  const fixture = searchoFixture("hls-fallback", badUrl);
  fixture.playerHtml = `<script>var links = {"hls3":"${badUrl}","hls2":"${goodUrl}"};</script>`;
  global.fetch = async input => {
    const url = String(input);
    if (url === fixture.searchoUrl) return response(fixture.searchoHtml);
    if (url === fixture.realUrl) return response(fixture.playerHtml);
    if (url === badUrl) return response("blocked", 403);
    if (url === goodUrl) return response("#EXTM3U\n#EXT-X-TARGETDURATION:6", 200, { "content-type": "application/vnd.apple.mpegurl" });
    throw new Error(`Unexpected fixture request: ${url}`);
  };
  try {
    const player = await resolveSearchoPlayer(fixture.searchoUrl);
    assert.equal(player.file, goodUrl);
  } finally {
    global.fetch = originalFetch;
  }
});

test("resolveSearchoPlayer accepts a direct MP4 from the player document", async () => {
  const file = "https://cdn.example.test/video/fixture.mp4?token=ok";
  const fixture = searchoFixture("mp4", file);
  global.fetch = async input => {
    const url = String(input);
    if (url === fixture.searchoUrl) return response(fixture.searchoHtml);
    if (url === fixture.realUrl) return response(fixture.playerHtml);
    throw new Error(`Unexpected fixture request: ${url}`);
  };
  try {
    const player = await resolveSearchoPlayer(fixture.searchoUrl);
    assert.equal(player.file, file);
  } finally {
    global.fetch = originalFetch;
  }
});

test("resolveSearchoPlayer rejects JavaScript player libraries as media", async () => {
  const file = "https://oppainet.net/assets/players/jwplayer/provider.hlsjs.js?cb=123";
  const fixture = searchoFixture("javascript-media", file);
  global.fetch = async input => {
    const url = String(input);
    if (url === fixture.searchoUrl) return response(fixture.searchoHtml);
    if (url === fixture.realUrl) return response(fixture.playerHtml);
    throw new Error(`Unexpected fixture request: ${url}`);
  };
  try {
    assert.equal(await resolveSearchoPlayer(fixture.searchoUrl), null);
  } finally {
    global.fetch = originalFetch;
  }
});
