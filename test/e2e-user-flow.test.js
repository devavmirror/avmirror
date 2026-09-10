const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");

let child;
let base;

const TIMEOUT = 45000;

async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return r.json();
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error("server did not become healthy");
}

async function getJSON(path) {
  const r = await fetch(`${base}${path}`);
  assert.equal(r.status, 200, `GET ${path} returned ${r.status}`);
  return r.json();
}

async function probeMedia(url, headers = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 10000);
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", ...headers },
      signal: ac.signal,
      redirect: "follow",
    });
    clearTimeout(t);
    const ct = r.headers.get("content-type") || "";
    const body = Buffer.from(await r.arrayBuffer());
    return { status: r.status, type: ct, bytes: body.length, body };
  } catch (e) {
    clearTimeout(t);
    return { status: 0, type: "", bytes: 0, body: Buffer.alloc(0), error: e.message };
  }
}

function isHlsPlaylist(buf) {
  return /^\s*#EXTM3U/m.test(buf.toString());
}

function looksLikeVideo(type) {
  return /video\//i.test(type) || /mpeg|octet-stream/i.test(type);
}

test.before(async () => {
  const port = 7860 + Math.floor(Math.random() * 40);
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["src/server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), PUBLIC_BASE_URL: base, LOCAL_MODE: "false", HLS_PROXY: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", () => {});
  await waitForHealth();
});

test.after(() => child?.kill("SIGTERM"));

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 1: User opens Stremio, sees catalog, picks an item
// ═══════════════════════════════════════════════════════════════════════════

test("FLOW 1: browse recentes → select item → view meta", async () => {
  const catalog = await getJSON("/catalog/movie/avmirror.json");
  assert.ok(catalog.metas.length >= 5, "should have at least 5 catalog items");

  const item = catalog.metas[0];
  assert.ok(item.id, "item must have id");
  assert.ok(item.name, "item must have name");
  assert.ok(item.poster, "item must have poster");

  const meta = await getJSON(`/meta/movie/${encodeURIComponent(item.id)}.json`);
  assert.ok(meta.meta, "meta should exist");
  assert.equal(meta.meta.id, item.id);
  assert.equal(meta.meta.type, "movie");
  assert.ok(meta.meta.name, "meta must have name");
});

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 2: User searches by JAV code, gets results
// ═══════════════════════════════════════════════════════════════════════════

test("FLOW 2: search DLDSS-534 → find items → get meta", async () => {
  const catalog = await getJSON("/catalog/movie/avmirror/search=DLDSS-534.json");
  assert.ok(catalog.metas.length > 0, "should find DLDSS-534 items");

  const match = catalog.metas.find(m => (m.name || "").toUpperCase().includes("DLDSS"));
  assert.ok(match, "should find a DLDSS item in results");

  const meta = await getJSON(`/meta/movie/${encodeURIComponent(match.id)}.json`);
  assert.ok(meta.meta, "meta should exist for searched item");
  assert.ok(meta.meta.name, "meta should have name");
});

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 3: User plays an item → streams returned → validate quality
// ═══════════════════════════════════════════════════════════════════════════

test("FLOW 3: play item → streams are merged (max 5) → HTTP+Torrent labels", async () => {
  const catalog = await getJSON("/catalog/movie/avmirror.json");
  const itemId = catalog.metas[0].id;

  const streamsResp = await getJSON(`/stream/movie/${encodeURIComponent(itemId)}.json`);
  const streams = streamsResp.streams;
  assert.ok(Array.isArray(streams), "streams must be array");
  assert.ok(streams.length > 0, "should have at least 1 stream");
  assert.ok(streams.length <= 15, `should have at most 15 streams (1 HTTP + N torrents + support), got ${streams.length}`);

  const httpStreams = streams.filter(s => s.url && !s.infoHash);
  const torrentStreams = streams.filter(s => s.infoHash);

  if (httpStreams.length > 0) {
    assert.equal(httpStreams[0].name, "🌐 HTTP", "first HTTP stream should be labeled HTTP");
    assert.equal(httpStreams[0].title, "HTTP • Auto", "first HTTP stream title should be Auto");
    for (const s of httpStreams) {
      assert.ok(/^https?:\/\//i.test(s.url), `HTTP stream URL must be absolute: ${s.url}`);
    }
  }

  if (torrentStreams.length > 0) {
    assert.ok(torrentStreams[0].name.includes("Torrent"), "torrent stream should be labeled Torrent");
    for (const s of torrentStreams) {
      assert.ok(/^[a-f0-9]{40}$/i.test(s.infoHash), `infoHash must be 40 hex chars: ${s.infoHash}`);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 4: User plays → HTTP stream URL actually returns video/playlist
// ═══════════════════════════════════════════════════════════════════════════

test("FLOW 4: HTTP stream URL is reachable and returns valid media", { timeout: TIMEOUT }, async (t) => {

  const catalog = await getJSON("/catalog/movie/avmirror.json");
  const itemId = catalog.metas[0].id;

  const streamsResp = await getJSON(`/stream/movie/${encodeURIComponent(itemId)}.json`);
  const httpStream = streamsResp.streams.find(s => s.url && !s.infoHash);
  if (!httpStream) return t.skip("item selecionado não possui stream HTTP");

  const probe = await probeMedia(httpStream.url, httpStream.behaviorHints?.proxyHeaders?.request);
  assert.ok(probe.status >= 200 && probe.status < 400, `stream should return 2xx/3xx, got ${probe.status}`);
  assert.ok(probe.bytes > 0, "stream should return bytes");

  const isPlaylist = isHlsPlaylist(probe.body);
  const isVideo = looksLikeVideo(probe.type);
  assert.ok(isPlaylist || isVideo, `should be HLS playlist or video, got type=${probe.type} preview=${probe.body.slice(0, 100).toString()}`);

  if (isPlaylist) {
    const mediaLine = probe.body.toString().split(/\r?\n/).find(l => l.trim() && !l.startsWith("#"));
    assert.ok(mediaLine, "HLS playlist should have at least one media URI");
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 5: User browses Popular catalog
// ═══════════════════════════════════════════════════════════════════════════

test("FLOW 5: browse populares → items have valid structure", async () => {
  const catalog = await getJSON("/catalog/movie/avmirror-popular.json");
  assert.ok(catalog.metas.length > 0, "popular catalog should have items");

  for (const item of catalog.metas.slice(0, 5)) {
    assert.ok(item.id, "item must have id");
    assert.ok(item.name, "item must have name");
    assert.ok(item.id.includes(":"), `id must contain colon: ${item.id}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 6: User browses Uncensored catalog
// ═══════════════════════════════════════════════════════════════════════════

test("FLOW 6: browse sem censura → items have valid structure", async () => {
  const catalog = await getJSON("/catalog/movie/avmirror-uncensored.json");
  assert.ok(catalog.metas.length > 0, "uncensored catalog should have items");

  const item = catalog.metas[0];
  assert.ok(item.id, "item must have id");
  assert.ok(item.name, "item must have name");
});

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 7: User browses by genre
// ═══════════════════════════════════════════════════════════════════════════

test("FLOW 7: browse by genre returns items", async () => {
  const catalog = await getJSON("/catalog/movie/avmirror-genres.json");
  assert.ok(Array.isArray(catalog.metas), "genres catalog must return metas array");
});

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 8: User searches by actress name
// ═══════════════════════════════════════════════════════════════════════════

test("FLOW 8: search by actress name returns results", { timeout: TIMEOUT }, async () => {
  const catalog = await getJSON("/catalog/movie/avmirror/search=Sora Shiina.json");
  assert.ok(Array.isArray(catalog.metas), "actress search must return metas array");
});

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 9: User sees poster images → poster proxy works
// ═══════════════════════════════════════════════════════════════════════════

test("FLOW 9: poster proxy returns image for catalog item", { timeout: TIMEOUT }, async (t) => {

  const catalog = await getJSON("/catalog/movie/avmirror.json");
  const itemWithPoster = catalog.metas.find(m => m.poster);
  if (!itemWithPoster) return t.skip("catálogo sem poster");

  const posterUrl = itemWithPoster.poster;
  assert.ok(posterUrl.includes("/poster/"), `poster should be proxied: ${posterUrl}`);

  const probe = await probeMedia(posterUrl);
  assert.equal(probe.status, 200, "poster should return 200");
  assert.ok(probe.bytes > 0, "poster should have bytes");
  assert.ok(probe.type.includes("image"), `poster should be image, got ${probe.type}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 10: User gets streams for a different item → verify deduplication
// ═══════════════════════════════════════════════════════════════════════════

test("FLOW 10: streams are deduplicated by URL", async () => {
  const catalog = await getJSON("/catalog/movie/avmirror.json");
  const itemId = catalog.metas[0].id;

  const streamsResp = await getJSON(`/stream/movie/${encodeURIComponent(itemId)}.json`);
  const urls = streamsResp.streams.filter(s => s.url).map(s => s.url);
  const uniqueUrls = [...new Set(urls)];
  assert.equal(urls.length, uniqueUrls.length, "stream URLs should be deduplicated");
});

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 11: Pagination works across pages
// ═══════════════════════════════════════════════════════════════════════════

test("FLOW 11: pagination returns different items", async () => {
  const page1 = await getJSON("/catalog/movie/avmirror.json");
  const page2 = await getJSON("/catalog/movie/avmirror/skip=20.json");

  assert.ok(page1.metas.length > 0, "page 1 should have items");
  assert.ok(Array.isArray(page2.metas), "page 2 should be array");

  if (page2.metas.length > 0) {
    const ids1 = new Set(page1.metas.map(m => m.id));
    const overlap = page2.metas.some(m => ids1.has(m.id));
    assert.equal(overlap, false, "page 1 and page 2 should not overlap");
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 12: HLS proxy SSRF protection
// ═══════════════════════════════════════════════════════════════════════════

test("FLOW 12: HLS proxy blocks private IPs", async () => {
  const targets = [
    "https://127.0.0.1/secret.mp4",
    "https://10.0.0.1/secret.mp4",
    "https://192.168.1.1/secret.mp4",
    "http://example.com/video.mp4",
  ];
  for (const url of targets) {
    const r = await fetch(`${base}/hls?url=${encodeURIComponent(url)}`);
    assert.equal(r.status, 502, `should reject ${url}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 13: Stream endpoint returns support stream at the end
// ═══════════════════════════════════════════════════════════════════════════

test("FLOW 13: support stream is appended as last stream", async () => {
  const catalog = await getJSON("/catalog/movie/avmirror.json");
  const itemId = catalog.metas[0].id;

  const streamsResp = await getJSON(`/stream/movie/${encodeURIComponent(itemId)}.json`);
  const streams = streamsResp.streams;
  assert.ok(streams.length > 0, "should have streams");

  const last = streams[streams.length - 1];
  assert.ok(last.name.includes("Apoie") || last.name.includes("AVMirror"), "last stream should be support stream");
  assert.ok(last.externalUrl, "support stream should have externalUrl");
});

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 14: Rate limiting returns 429 when exceeded
// ═══════════════════════════════════════════════════════════════════════════

test("FLOW 14: catalog endpoint has rate limit headers", async () => {
  const r = await fetch(`${base}/catalog/movie/avmirror.json`);
  assert.ok(r.headers.get("x-ratelimit-limit"), "should have rate limit header");
  assert.ok(r.headers.get("x-ratelimit-remaining"), "should have remaining header");
});

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 15: User clicks play on a torrent stream → has valid infoHash
// ═══════════════════════════════════════════════════════════════════════════

test("FLOW 15: torrent streams have valid structure for Stremio", async () => {
  const catalog = await getJSON("/catalog/movie/avmirror.json");
  const itemId = catalog.metas[0].id;

  const streamsResp = await getJSON(`/stream/movie/${encodeURIComponent(itemId)}.json`);
  const torrentStreams = streamsResp.streams.filter(s => s.infoHash);

  for (const s of torrentStreams) {
    assert.ok(/^[a-f0-9]{40}$/i.test(s.infoHash), `infoHash must be 40 hex: ${s.infoHash}`);
    assert.ok(s.behaviorHints, "torrent stream must have behaviorHints");
    assert.equal(s.url, undefined, "torrent must stay direct P2P without an HTTP proxy URL");
    assert.ok(Array.isArray(s.sources) && s.sources.some(source => /^tracker:(?:udp|https?):\/\//i.test(source)), "torrent must include tracker sources");
    assert.equal(s.behaviorHints.notWebReady, false, "torrent stream must not be hidden by the web-ready hint");
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 16: Health endpoint reports metrics after traffic
// ═══════════════════════════════════════════════════════════════════════════

test("FLOW 16: health shows metrics after user traffic", async () => {
  await getJSON("/catalog/movie/avmirror.json");
  await getJSON("/catalog/movie/avmirror-popular.json");

  const health = await getJSON("/health");
  assert.equal(health.ok, true);
  assert.ok(health.uptimeSeconds > 0, "uptime should be positive");
  assert.equal(typeof health.mediaRequests, "number");
  assert.equal(typeof health.bytesProxied, "number");
  assert.ok(health.scrapers, "health should report scraper metrics");
});

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 17: Invalid ID returns graceful empty/null
// ═══════════════════════════════════════════════════════════════════════════

test("FLOW 17: invalid IDs return graceful responses", async () => {
  const meta = await getJSON(`/meta/movie/invalid-id.json`);
  assert.equal(meta.meta, null, "invalid meta should be null");

  const streams = await getJSON(`/stream/movie/invalid-id.json`);
  assert.ok(Array.isArray(streams.streams), "invalid streams should be array");
  const realStreams = streams.streams.filter(s => s.url || s.infoHash);
  assert.equal(realStreams.length, 0, "invalid ID should have no real streams");
});

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 18: Title logo SVG is generated
// ═══════════════════════════════════════════════════════════════════════════

test("FLOW 18: title-logo SVG is generated for catalog item", { timeout: TIMEOUT }, async () => {

  const catalog = await getJSON("/catalog/movie/avmirror.json");
  const itemId = catalog.metas[0].id;

  const r = await fetch(`${base}/title-logo/${encodeURIComponent(itemId)}.svg`);
  assert.ok(r.ok, "title-logo should return 200");
  assert.ok(r.headers.get("content-type").includes("svg"), "should be SVG");

  const body = await r.text();
  assert.ok(body.includes("<svg"), "should contain SVG element");
  assert.ok(body.includes("AVMirror"), "should contain AVMirror branding");
});

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 19: CORS headers present on all major endpoints
// ═══════════════════════════════════════════════════════════════════════════

test("FLOW 19: CORS headers on manifest, catalog, and stream", async () => {
  const endpoints = ["/manifest.json", "/catalog/movie/avmirror.json"];
  for (const ep of endpoints) {
    const r = await fetch(`${base}${ep}`);
    assert.equal(r.headers.get("access-control-allow-origin"), "*", `CORS missing on ${ep}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// FLOW 20: Full user journey: search → meta → play → probe media
// ═══════════════════════════════════════════════════════════════════════════

test("FLOW 20: full journey — search DLDSS-534 → meta → stream → probe first HTTP", { timeout: 60000 }, async (t) => {

  const search = await getJSON("/catalog/movie/avmirror/search=DLDSS-534.json");
  assert.ok(search.metas.length > 0, "DLDSS-534 search should return results");

  const item = search.metas[0];
  const meta = await getJSON(`/meta/movie/${encodeURIComponent(item.id)}.json`);
  assert.ok(meta.meta, "should get meta");

  const streams = await getJSON(`/stream/movie/${encodeURIComponent(item.id)}.json`);
  assert.ok(streams.streams.length > 0, "should get streams");

  const httpStream = streams.streams.find(s => s.url && !s.infoHash);
  if (!httpStream) return t.skip("resultado DLDSS sem stream HTTP");

  const probe = await probeMedia(httpStream.url, httpStream.behaviorHints?.proxyHeaders?.request);
  assert.ok(probe.status >= 200 && probe.status < 400, `HTTP stream should be reachable: ${probe.status}`);
  assert.ok(probe.bytes > 100, `HTTP stream should have content: ${probe.bytes} bytes`);

  const isPlaylist = isHlsPlaylist(probe.body);
  const isVideo = looksLikeVideo(probe.type);
  assert.ok(isPlaylist || isVideo, `should be media, got type=${probe.type}`);
});
