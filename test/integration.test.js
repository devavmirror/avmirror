const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");

let child;
let base;

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return response.json();
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("server did not become healthy");
}

test.before(async () => {
  const port = 7800 + Math.floor(Math.random() * 100);
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

test("health exposes release and media metrics", async () => {
  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.version, "26.1.0");
  assert.equal(body.release, "26.1.0");
  assert.equal(body.hlsProxy, true);
  assert.equal(typeof body.activeMedia, "number");
  assert.equal(typeof body.maxStreamMbps, "number");
});

test("manifest includes movie+tv types and keeps AVMirror catalog IDs", async () => {
  const response = await fetch(`${base}/manifest.json`);
  const manifest = await response.json();
  assert.equal(manifest.version, "26.1.0");
  assert.deepEqual(manifest.types, ["movie", "tv"]);
  assert.deepEqual(manifest.catalogs.map(c => c.id), ["avmirror", "avmirror-popular", "avmirror-uncensored", "avmirror-censored", "avmirror-genres", "avmirror-tags", "avmirror-actresses"]);
  assert.deepEqual(manifest.idPrefixes, ["avmirror:", "ijavtorrent:", "projectjav:", "ffjav:", "sukebeinyaa:", "nyaa:", "btdig:", "tokyotosho:", "javdb:", "zeromagnet:", "yourbittorrent:"]);
  assert.deepEqual(manifest.catalogs.map(c => c.name), ["🌐 Recentes", "🔥 Populares", "🟣 Sem Censura", "🔵 Censurado", "🏷️ Gêneros", "🔖 Tags", "👩 Atrizes"]);
});

test("proxy rejects private upstream addresses", async () => {
  const response = await fetch(`${base}/hls?url=${encodeURIComponent("https://127.0.0.1/video.mp4")}`);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "media unavailable" });
});

test("torrent bytes are never retransmitted by the addon server", async () => {
  const response = await fetch(`${base}/torrent/not-a-hash.mp4`);
  assert.equal(response.status, 404);
});
