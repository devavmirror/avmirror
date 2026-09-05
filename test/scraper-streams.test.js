const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveSearchoPlayer } = require("../src/scrapers/avmirror");

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
