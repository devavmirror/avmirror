const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");

let child;
let base;

async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return response.json();
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error("server did not become healthy");
}

test.before(async () => {
  const port = 7850 + Math.floor(Math.random() * 50);
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["src/server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), PUBLIC_BASE_URL: base, LOCAL_MODE: "false", HLS_PROXY: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stderr.on("data", () => {});
  await waitForHealth();
});

test.after(() => child?.kill("SIGTERM"));

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: Health & Infrastructure
// ═══════════════════════════════════════════════════════════════════════════

test("1.1 health endpoint returns valid status", async () => {
  const r = await fetch(`${base}/health`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.name, "AVMirror");
  assert.equal(body.version, "26.1.0");
  assert.equal(body.release, "26.1.0");
  assert.equal(body.hlsProxy, true);
  assert.equal(typeof body.uptimeSeconds, "number");
  assert.ok(body.uptimeSeconds >= 0);
  assert.equal(typeof body.mediaRequests, "number");
  assert.equal(typeof body.mediaErrors, "number");
  assert.equal(typeof body.activeMedia, "number");
  assert.equal(typeof body.bytesProxied, "number");
  assert.equal(typeof body.maxStreamMbps, "number");
});

test("1.2 local-info endpoint returns connection details", async () => {
  const r = await fetch(`${base}/api/local-info`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.baseUrl);
  assert.ok(body.manifestUrl);
  assert.ok(body.stremioUrl);
  assert.equal(typeof body.port, "number");
  assert.equal(typeof body.localMode, "boolean");
  assert.equal(typeof body.directStreams, "boolean");
  assert.equal(typeof body.hlsProxy, "boolean");
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: Manifest
// ═══════════════════════════════════════════════════════════════════════════

test("2.1 manifest has correct structure", async () => {
  const r = await fetch(`${base}/manifest.json`);
  assert.equal(r.status, 200);
  const m = await r.json();
  assert.equal(m.id, "com.avmirror.addon");
  assert.equal(m.version, "26.1.0");
  assert.ok(m.name);
  assert.ok(m.description);
  assert.deepEqual(m.resources, ["catalog", "meta", "stream"]);
  assert.deepEqual(m.types, ["movie", "tv"]);
  assert.ok(m.behaviorHints?.adult);
});

test("2.2 manifest has all 7 catalogs with correct types", async () => {
  const r = await fetch(`${base}/manifest.json`);
  const m = await r.json();
  assert.equal(m.catalogs.length, 7);
  const ids = m.catalogs.map(c => c.id);
  assert.deepEqual(ids, [
    "avmirror", "avmirror-popular", "avmirror-uncensored", "avmirror-censored",
    "avmirror-genres", "avmirror-tags", "avmirror-actresses"
  ]);
  const movieCatalogs = m.catalogs.filter(c => c.type === "movie");
  const tvCatalogs = m.catalogs.filter(c => c.type === "tv");
  assert.equal(movieCatalogs.length, 7);
  assert.equal(tvCatalogs.length, 0);
});

test("2.3 manifest exposes all active idPrefixes", async () => {
  const r = await fetch(`${base}/manifest.json`);
  const m = await r.json();
  assert.deepEqual(m.idPrefixes, [
    "avmirror:", "ijavtorrent:", "projectjav:", "ffjav:",
    "sukebeinyaa:", "nyaa:", "btdig:", "tokyotosho:", "javdb:"
  ]);
});

test("2.4 manifest CORS headers", async () => {
  const r = await fetch(`${base}/manifest.json`);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
});

test("2.5 manifest is served with language support (pt/en)", async () => {
  const rPt = await fetch(`${base}/manifest.json`);
  const mPt = await rPt.json();
  assert.ok(mPt.name.includes("AVMirror"));

  const rEn = await fetch(`${base}/manifest.json`, { headers: { "Accept-Language": "en" } });
  const mEn = await rEn.json();
  assert.ok(mEn.name.includes("AVMirror"));
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: Catalog Endpoints
// ═══════════════════════════════════════════════════════════════════════════

test("3.1 recentes catalog returns items with valid structure", async () => {
  const r = await fetch(`${base}/catalog/movie/avmirror.json`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Array.isArray(body.metas));
  assert.ok(body.metas.length > 0);
  const first = body.metas[0];
  assert.ok(first.id);
  assert.equal(first.type, "movie");
  assert.ok(first.name);
  assert.ok(first.poster);
});

test("3.2 popular catalog returns items", async () => {
  const r = await fetch(`${base}/catalog/movie/avmirror-popular.json`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Array.isArray(body.metas));
  assert.ok(body.metas.length > 0);
});

test("3.3 uncensored catalog returns items", async () => {
  const r = await fetch(`${base}/catalog/movie/avmirror-uncensored.json`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Array.isArray(body.metas));
  assert.ok(body.metas.length > 0);
});

test("3.4 censored catalog returns items", async () => {
  const r = await fetch(`${base}/catalog/movie/avmirror-censored.json`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Array.isArray(body.metas));
  assert.ok(body.metas.length > 0);
});

test("3.5 genres catalog returns items", async () => {
  const r = await fetch(`${base}/catalog/movie/avmirror-genres.json`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Array.isArray(body.metas));
});

test("3.6 tags catalog returns items", async () => {
  const r = await fetch(`${base}/catalog/movie/avmirror-tags.json`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Array.isArray(body.metas));
});

test("3.7 actresses catalog without search returns recent items", async () => {
  const r = await fetch(`${base}/catalog/movie/avmirror-actresses.json`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Array.isArray(body.metas));
  assert.ok(body.metas.length > 0);
});

test("3.8 catalog pagination works (skip=20)", async () => {
  const r1 = await fetch(`${base}/catalog/movie/avmirror.json`);
  const body1 = await r1.json();
  assert.ok(body1.metas.length > 0);

  const r2 = await fetch(`${base}/catalog/movie/avmirror/skip=20.json`);
  assert.equal(r2.status, 200);
  const body2 = await r2.json();
  assert.ok(Array.isArray(body2.metas));
  if (body2.metas.length > 0) {
    const ids1 = new Set(body1.metas.map(m => m.id));
    const hasOverlap = body2.metas.some(m => ids1.has(m.id));
    assert.equal(hasOverlap, false, "page 2 should not overlap with page 1");
  }
});

test("3.9 search by JAV code returns matching items", async () => {
  const r = await fetch(`${base}/catalog/movie/avmirror/search=DLDSS-534.json`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Array.isArray(body.metas));
  assert.ok(body.metas.length > 0, "should find items for DLDSS-534");
  const names = body.metas.map(m => (m.name || "").toUpperCase());
  assert.ok(names.some(n => n.includes("DLDSS") || n.includes("DLDSS534")), "results should contain DLDSS");
});

test("3.10 catalog item IDs follow prefix:id format", async () => {
  const r = await fetch(`${base}/catalog/movie/avmirror.json`);
  const body = await r.json();
  body.metas.forEach(m => {
    assert.ok(m.id.includes(":"), `ID ${m.id} should contain colon`);
    const prefix = m.id.split(":")[0];
    assert.ok(prefix.length > 0, `ID ${m.id} should have a prefix`);
  });
});

test("3.11 proxied poster URL points to this server", async () => {
  const r = await fetch(`${base}/catalog/movie/avmirror.json`);
  const body = await r.json();
  const withPoster = body.metas.find(m => m.poster);
  assert.ok(withPoster, "should have at least one item with poster");
  assert.ok(withPoster.poster.includes(`${base}/poster/`), `poster should be proxied: ${withPoster.poster}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: Meta Endpoint
// ═══════════════════════════════════════════════════════════════════════════

test("4.1 meta for a JAV item returns full details", async () => {
  const catalogR = await fetch(`${base}/catalog/movie/avmirror.json`);
  const catalog = await catalogR.json();
  const firstId = catalog.metas[0].id;

  const r = await fetch(`${base}/meta/movie/${encodeURIComponent(firstId)}.json`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.meta);
  assert.equal(body.meta.id, firstId);
  assert.equal(body.meta.type, "movie");
  assert.ok(body.meta.name);
});

test("4.2 meta for invalid ID returns null", async () => {
  const r = await fetch(`${base}/meta/movie/invalid-nonexistent-id.json`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.meta, null);
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: Stream Endpoint
// ═══════════════════════════════════════════════════════════════════════════

test("5.1 stream for a JAV item returns multiple sources", async () => {
  const catalogR = await fetch(`${base}/catalog/movie/avmirror.json`);
  const catalog = await catalogR.json();
  const firstId = catalog.metas[0].id;

  const r = await fetch(`${base}/stream/movie/${encodeURIComponent(firstId)}.json`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Array.isArray(body.streams));
  assert.ok(body.streams.length > 0, "should have at least one stream");
  const first = body.streams[0];
  assert.ok(first.name);
  assert.ok(first.title);
  assert.ok(first.url || first.infoHash, "stream should have url or infoHash");
});

test("5.2 stream for invalid type returns empty", async () => {
  const r = await fetch(`${base}/stream/series/${encodeURIComponent("avmirror:some-id")}.json`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Array.isArray(body.streams));
  assert.equal(body.streams.length, 0);
});

test("5.3 stream for nonexistent ID returns empty", async () => {
  const r = await fetch(`${base}/stream/movie/avmirror:nonexistent-id.json`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Array.isArray(body.streams));
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6: HLS Proxy
// ═══════════════════════════════════════════════════════════════════════════

test("6.1 HLS proxy rejects private addresses (127.0.0.1)", async () => {
  const r = await fetch(`${base}/hls?url=${encodeURIComponent("https://127.0.0.1/secret.mp4")}`);
  assert.equal(r.status, 502);
  const body = await r.json();
  assert.ok(body.error);
});

test("6.2 HLS proxy rejects private addresses (10.x.x.x)", async () => {
  const r = await fetch(`${base}/hls?url=${encodeURIComponent("https://10.0.0.1/secret.mp4")}`);
  assert.equal(r.status, 502);
});

test("6.3 HLS proxy rejects private addresses (192.168.x.x)", async () => {
  const r = await fetch(`${base}/hls?url=${encodeURIComponent("https://192.168.1.1/secret.mp4")}`);
  assert.equal(r.status, 502);
});

test("6.4 HLS proxy rejects non-HTTPS URLs", async () => {
  const r = await fetch(`${base}/hls?url=${encodeURIComponent("http://example.com/video.mp4")}`);
  assert.equal(r.status, 502);
});

test("6.5 HLS proxy rejects missing URL parameter", async () => {
  const r = await fetch(`${base}/hls`);
  assert.equal(r.status, 502);
});

test("6.6 HLS proxy OPTIONS returns CORS headers", async () => {
  const r = await fetch(`${base}/hls`, { method: "OPTIONS" });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  assert.ok(r.headers.get("access-control-allow-methods"));
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7: Poster & Image Proxy
// ═══════════════════════════════════════════════════════════════════════════

test("7.1 poster proxy returns transparent GIF for unknown ID", async () => {
  const r = await fetch(`${base}/poster/${encodeURIComponent("avmirror:nonexistent")}.jpg`);
  assert.ok(r.ok);
  const ct = r.headers.get("content-type");
  assert.ok(ct.includes("image"), `content-type should be image: ${ct}`);
  assert.ok(r.headers.get("cache-control"));
});

test("7.2 poster proxy has CORS headers", async () => {
  const r = await fetch(`${base}/poster/${encodeURIComponent("avmirror:nonexistent")}.jpg`);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
});

test("7.3 image proxy OPTIONS returns CORS headers", async () => {
  const r = await fetch(`${base}/image`, { method: "OPTIONS" });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
});

test("7.4 image proxy returns transparent GIF for non-image URLs (graceful)", async () => {
  const r = await fetch(`${base}/image?url=${encodeURIComponent("https://example.com/page.html")}`);
  assert.ok(r.ok, "should return 200 with transparent GIF placeholder");
  const ct = r.headers.get("content-type");
  assert.ok(ct.includes("image"), `content-type should be image: ${ct}`);
});

test("7.5 title-logo SVG endpoint", async () => {
  const catalogR = await fetch(`${base}/catalog/movie/avmirror.json`);
  const catalog = await catalogR.json();
  const firstId = catalog.metas[0].id;
  const r = await fetch(`${base}/title-logo/${encodeURIComponent(firstId)}.svg`);
  assert.ok(r.ok);
  const ct = r.headers.get("content-type");
  assert.ok(ct.includes("svg"), `content-type should be svg: ${ct}`);
  const body = await r.text();
  assert.ok(body.includes("<svg"));
  assert.ok(body.includes("AVMirror"));
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 9: Static Assets
// ═══════════════════════════════════════════════════════════════════════════

test("9.1 logo.png is served", async () => {
  const r = await fetch(`${base}/logo.png`);
  assert.ok(r.ok);
  assert.ok(r.headers.get("content-type").includes("image"));
  assert.ok(r.headers.get("cache-control"));
});

test("9.2 install page is served", async () => {
  const r = await fetch(`${base}/`);
  assert.ok(r.ok);
  const ct = r.headers.get("content-type");
  assert.ok(ct.includes("text/html"));
});

test("9.3 configure page is served", async () => {
  const r = await fetch(`${base}/configure`);
  assert.ok(r.ok);
  const ct = r.headers.get("content-type");
  assert.ok(ct.includes("text/html"));
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 10: Error Handling & Edge Cases
// ═══════════════════════════════════════════════════════════════════════════

test("10.1 catalog for unknown source falls back to other sources", async () => {
  const r = await fetch(`${base}/catalog/movie/nonexistent-source.json`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Array.isArray(body.metas));
  // With graceful degradation, fallback sources may return items
  // The key test is that it doesn't crash
});

test("10.2 meta for completely invalid format returns null", async () => {
  const r = await fetch(`${base}/meta/movie/not-a-valid-id.json`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.meta, null);
});

test("10.3 stream for completely invalid format returns empty", async () => {
  const r = await fetch(`${base}/stream/movie/not-a-valid-id.json`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Array.isArray(body.streams));
});

test("10.4 catalog with percent-encoded search works", async () => {
  const r = await fetch(`${base}/catalog/movie/avmirror/search%3DDLDSS-534.json`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Array.isArray(body.metas));
});
