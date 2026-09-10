const test = require("node:test");
const assert = require("node:assert/strict");
const { scrapeHohojStreams } = require("../src/scrapers/hohoj");
const { scrapeStreams: scrapeGGJavStreams } = require("../src/scrapers/ggjav");
const { scrapeCatalog: scrapeJavmenuCatalog, scrapeStreams: scrapeJavmenuStreams } = require("../src/scrapers/javmenu");
const { scrapeGoodav17Streams } = require("../src/scrapers/goodav17");
const { scrapeAvjoyStreams } = require("../src/scrapers/avjoy");

const originalFetch = global.fetch;

function response(body, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/html" } });
}

function encodedId(prefix, url) {
  return `${prefix}:${Buffer.from(url).toString("base64url")}`;
}

function obfuscateJson(value) {
  const source = JSON.stringify(value);
  return Buffer.from([...source].map(char => String.fromCharCode(char.charCodeAt(0) + 88)).join(""), "binary").toString("base64");
}

async function withFixtures(fixtures, fn) {
  global.fetch = async input => {
    const url = String(input);
    if (!(url in fixtures)) throw new Error(`Unexpected fixture request: ${url}`);
    return response(fixtures[url]);
  };
  try {
    return await fn();
  } finally {
    global.fetch = originalFetch;
  }
}

function assertDirect(stream, expectedUrl, expectedReferer) {
  assert.ok(stream, "a stream must be returned");
  assert.equal(stream.url, expectedUrl);
  assert.equal(stream.externalUrl, undefined);
  assert.equal(stream.url.startsWith("http"), true);
  assert.equal(stream.url.includes("/hls"), false);
  assert.equal(stream.url.includes("onrender.com"), false);
  assert.equal(stream.behaviorHints.notWebReady, false);
  assert.equal(stream.behaviorHints.proxyHeaders.request.Referer, expectedReferer);
  assert.equal(stream.behaviorHints.proxyHeaders.request.Origin, new URL(expectedReferer).origin);
}

test("Apex normalizes HLS and uses the embed endpoint as direct referer", async () => {
  const embedUrl = "https://hohoj.tv/embed?id=123";
  await withFixtures({ [embedUrl]: `<video src="https://video-1.ggjav.com/media/master.m3u8?token=apex">` }, async () => {
    const [stream] = await scrapeHohojStreams("hohoj:123");
    assertDirect(stream, "https://video-1.ggjav.com/media/master.m3u8?token=apex", embedUrl);
  });
});

test("Luna normalizes relative HLS from each server embed", async () => {
  const pageUrl = "https://ggjav.com/en/main/video?id=123";
  const serverUrl = "https://server.example.test/player/123";
  await withFixtures({
    [pageUrl]: `var l = "${obfuscateJson({ primary: [serverUrl] })}";`,
    [serverUrl]: `<script>var videoSrc = "/media/master.m3u8?token=luna";</script>`,
  }, async () => {
    const [stream] = await scrapeGGJavStreams("ggjav:123");
    assertDirect(stream, "https://server.example.test/media/master.m3u8?token=luna", serverUrl);
  });
});

test("Crimson catalog parses current absolute JavMenu cards", async () => {
  const catalogUrl = "https://javmenu.com/en/censored/online";
  await withFixtures({
    [catalogUrl]: `<div class="video-list-item"><div class="card"><a href="https://javmenu.com/en/HMN-242"><img data-src="https://javmenu.com/poster.jpg"><p class="card-text">HMN-242 Current card</p></a></div></div>`,
  }, async () => {
    const [item] = await scrapeJavmenuCatalog({ page: 1 });
    assert.equal(item.id, "javmenu:HMN-242");
    assert.equal(item.poster, "https://javmenu.com/poster.jpg");
  });
});

test("Crimson normalizes HLS from the JavMenu page", async () => {
  const pageUrl = "https://javmenu.com/en/ABCD-123";
  await withFixtures({ [pageUrl]: `<video data-m3u8="/media/master.m3u8?token=crimson">` }, async () => {
    const [stream] = await scrapeJavmenuStreams("javmenu:ABCD-123");
    assertDirect(stream, "https://javmenu.com/media/master.m3u8?token=crimson", pageUrl);
  });
});

test("Azure resolves a relative HLS from the external embed", async () => {
  const pageUrl = "https://goodav17.com/html/123";
  const embedUrl = "https://ggjav.com/embed/player123";
  await withFixtures({
    [pageUrl]: `<iframe class="video_frame" src="${embedUrl}"></iframe>`,
    [embedUrl]: `<video src="/media/master.m3u8?token=azure">`,
  }, async () => {
    const [stream] = await scrapeGoodav17Streams(encodedId("goodav17", pageUrl));
    assertDirect(stream, "https://ggjav.com/media/master.m3u8?token=azure", embedUrl);
  });
});

test("Solar keeps direct MP4 and adds source headers", async () => {
  const pageUrl = "https://avjoy.me/video/123";
  const mediaUrl = "https://media-cdn1.avjoy.me/video/123/720p.mp4?token=solar";
  await withFixtures({ [pageUrl]: mediaUrl }, async () => {
    const [stream] = await scrapeAvjoyStreams(encodedId("avjoy", pageUrl));
    assertDirect(stream, mediaUrl, pageUrl);
  });
});
