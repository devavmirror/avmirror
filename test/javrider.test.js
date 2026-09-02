const test = require("node:test");
const assert = require("node:assert/strict");
const {
  scrapeJavRiderCatalog,
  scrapeJavRiderMeta,
  scrapeJavRiderStreams,
  closeJavRiderBrowser
} = require("../javrider");

const originalFetch = global.fetch;
function response(body, status = 200, type = "text/html") {
  return new Response(body, { status, headers: { "content-type": type } });
}

test("JavRider catalog maps WordPress cards and posters", async () => {
  global.fetch = async url => response(`<article><a href="https://javrider.com/sone-005-title/"><img src="https://javrider.com/wp-content/uploads/2026/03/sone00005pl-360x203.jpg"><h2>SONE-005 English Subtitle</h2></a></article>`);
  try {
    const catalog = await scrapeJavRiderCatalog({ page: 1 });
    assert.equal(catalog.length, 1);
    assert.equal(catalog[0].id.startsWith("javrider:"), true);
    assert.match(catalog[0].poster, /javrider\.com\/wp-content\/uploads/);
  } finally { global.fetch = originalFetch; }
});

test("JavRider metadata maps title and poster", async () => {
  global.fetch = async url => response(`<html><head><meta property="og:image" content="https://javrider.com/wp-content/uploads/2026/03/sone00005pl.jpg"></head><body><h1>SONE-005 Title</h1><div class="entry-content"><p>English subtitle video.</p></div></body></html>`);
  const id = `javrider:${Buffer.from("https://javrider.com/sone-005-title/").toString("base64url")}`;
  try {
    const meta = await scrapeJavRiderMeta(id);
    assert.equal(meta.name, "SONE-005 Title");
    assert.match(meta.poster, /sone00005pl\.jpg/);
  } finally { global.fetch = originalFetch; }
});

test("JavRider metadata includes synopsis, tags, cast, runtime and release date", async () => {
  const article = "https://javrider.com/sone-005-rich-metadata/";
  const id = `javrider:${Buffer.from(article).toString("base64url")}`;
  global.fetch = async url => response(`<html><head><meta property="og:title" content="SONE-005"><meta property="og:image" content="https://javrider.com/wp-content/uploads/2026/03/sone00005pl.jpg"><meta property="og:description" content="Official synopsis"></head><body><div class="entry-content"><p>Article synopsis</p><a href="/category/subtitle/">Subtitle</a><a href="/tag/sone/">SONE</a><a href="/actor/miyu-aizawa/">Miyu Aizawa</a><p>Duration: 151 mins</p><p>Release Date: 05 Jan 2024</p></div></body></html>`);
  try {
    const meta = await scrapeJavRiderMeta(id);
    assert.equal(meta.description, "Official synopsis");
    assert.deepEqual(meta.genre, ["Subtitle", "SONE"]);
    assert.deepEqual(meta.cast, ["Miyu Aizawa"]);
    assert.equal(meta.runtime, "151 mins");
    assert.equal(meta.releaseInfo, "05 Jan 2024");
  } finally { global.fetch = originalFetch; }
});

test("JavRider search supports page two for the Stremio Ver mais action", async () => {
  global.fetch = async url => {
    assert.equal(String(url), "https://javrider.com/page/2/?s=SONE-005");
    return response(`<article><a href="https://javrider.com/sone-027-title/"><img src="https://javrider.com/wp-content/uploads/2026/03/sone00027pl.jpg"><h2>SONE-027</h2></a></article>`);
  };
  try {
    const result = await scrapeJavRiderCatalog({ page: 2, search: "SONE-005" });
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "SONE-027");
  } finally { global.fetch = originalFetch; }
});

test("JavRider tags map to clickable paginated tag routes", async () => {
  global.fetch = async url => {
    assert.equal(String(url), "https://javrider.com/tag/blowjob/page/2/");
    return response(`<article><a href="https://javrider.com/blowjob-example-title/"><img src="https://javrider.com/wp-content/uploads/2026/03/example.jpg"><h2>Blowjob example</h2></a></article>`);
  };
  try {
    const result = await scrapeJavRiderCatalog({ page: 2, genre: "Blowjob" });
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "Blowjob example");
  } finally { global.fetch = originalFetch; }
});

test("JavRider streams build the HLS master from subtitle CDN hash", async () => {
  const article = "https://javrider.com/sone-005-hls-title/";
  const id = `javrider:${Buffer.from(article).toString("base64url")}`;
  const master = "https://javplayers.com/cdn/hls/68fc6bc32023b787bb75692a78549a93/master.txt";
  const child = "https://javplayers.com/m3/valid";
  const segment = "https://javplayers.com/m3/segment.ts";
  global.fetch = async url => {
    url = String(url);
    if (url === article) return response('<script>var playerjsSubtitle = "[EN]https://trk6tu.akmicdn.com/cdn/down/68fc6bc32023b787bb75692a78549a93/Subtitle/test.srt";</script>');
    if (url === master) return response(`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\n${child}`);
    if (url === child) return response(`#EXTM3U\n#EXTINF:6,\n${segment}`);
    if (url === segment) return response("video", 200, { "content-type": "video/mp2t" });
    return response("<html></html>");
  };
  try {
    const streams = await scrapeJavRiderStreams(id);
    assert.equal(streams.length, 1);
    assert.equal(streams[0].url, "https://javplayers.com/cdn/hls/68fc6bc32023b787bb75692a78549a93/master.txt");
    assert.equal(streams[0].headers.Referer, article);
    assert.equal(streams[0].headers.Origin, "https://javrider.com");
    assert.equal(streams[0].headers["User-Agent"], process.env.USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139 Safari/537.36");
    assert.match(streams[0].title, /HLS/);
  } finally { global.fetch = originalFetch; }
});

test("JavRider streams accept a direct HTML5 MP4 source", async () => {
  const article = "https://javrider.com/sone-005-stream-title/";
  const media = "https://javplayers.com/media/sone-005.mp4";
  global.fetch = async url => url === article ? response(`<video src="${media}"></video>`) : response("<html></html>");
  const id = `javrider:${Buffer.from(article).toString("base64url")}`;
  try {
    const streams = await scrapeJavRiderStreams(id);
    assert.equal(streams.length, 1);
    assert.equal(streams[0].url, media);
    assert.equal(streams[0].headers.Referer, article);
    assert.equal(streams[0].headers.Origin, "https://javrider.com");
  } finally { global.fetch = originalFetch; await closeJavRiderBrowser(); }
});

test("JavRider resolves nested generic players before browser capture", async () => {
  const article = "https://javrider.com/sone-005-nested-player/";
  const player = "https://embed.example/one";
  const nested = "https://cdn.example/player-two";
  const media = "https://cdn.example.net/sone-005/master.txt?token=ok";
  global.fetch = async url => {
    url = String(url);
    if (url === article) return response(`<iframe src="${player}"></iframe>`);
    if (url === player) return response(`<iframe src="${nested}"></iframe>`);
    if (url === nested) return response(`<script>var source = "${media}";</script>`);
    return response("<html></html>");
  };
  const id = `javrider:${Buffer.from(article).toString("base64url")}`;
  try {
    const streams = await scrapeJavRiderStreams(id);
    assert.equal(streams.length, 1);
    assert.equal(streams[0].url, media);
    assert.equal(streams[0].behaviorHints.proxyHeaders.request.Referer, article);
  } finally { global.fetch = originalFetch; await closeJavRiderBrowser(); }
});
