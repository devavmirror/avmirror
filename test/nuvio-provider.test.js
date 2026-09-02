const test = require("node:test");
const assert = require("node:assert/strict");
const provider = require("../nuvio/providers/avmirror");
const originalFetch = global.fetch;
const id = (prefix, url) => prefix + btoa(unescape(encodeURIComponent(url))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

test("Nuvio provider follows player iframe and returns direct HLS URL", async () => {
  const page = "https://jav.guru/123/title/";
  const player = "https://stream.example/player/abc";
  const media = "https://cdn.example.net/hls/master.m3u8?token=ok";
  global.fetch = async url => {
    url = String(url);
    if (url === page) return new Response(`<iframe src="${player}"></iframe>`);
    if (url === player) return new Response(`<script>var file = "${media}";</script>`);
    throw new Error(`unexpected ${url}`);
  };
  try {
    const streams = await provider.getStreams(id("avmirror:", page), "movie");
    assert.equal(streams[0].url, media);
    assert.equal(streams[0].headers.Referer, player);
  } finally { global.fetch = originalFetch; }
});

test("Nuvio provider extracts JavRider master.txt directly", async () => {
  const page = "https://javrider.com/title-example/";
  const media = "https://javplayers.com/cdn/hls/abc/master.txt";
  global.fetch = async url => String(url) === page ? new Response(`<video src="${media}"></video>`) : new Response("");
  try {
    const streams = await provider.getStreams(id("javrider:", page), "movie");
    assert.equal(streams[0].url, media);
  } finally { global.fetch = originalFetch; }
});
