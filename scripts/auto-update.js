const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const cp = require("node:child_process");
const { URL } = require("node:url");

const REPO = process.env.AVMIRROR_REPO || "devavmirror/avmirror";
const BRANCH = process.env.AVMIRROR_BRANCH || "main";
const root = process.env.AVMIRROR_ROOT || (process.pkg ? path.dirname(process.execPath) : path.resolve(__dirname, ".."));
const appDir = path.join(root, "app");
const stateFile = path.join(root, ".avmirror-update.json");
const updateEnabled = String(process.env.AVMIRROR_AUTO_UPDATE ?? "true").toLowerCase() !== "false";
const timeoutMs = Number(process.env.AVMIRROR_UPDATE_TIMEOUT_MS || 20000);

function run(command, args, options = {}) { return cp.spawnSync(command, args, { stdio: "inherit", ...options }); }
async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { const r = await fetch(url, { signal: controller.signal, headers: { "user-agent": "AVMirror-updater", accept: "application/vnd.github+json" } }); if (!r.ok) throw Error(`HTTP ${r.status}`); return r.text(); }
  finally { clearTimeout(timer); }
}
async function download(url, target) { const data = await fetch(url, { headers: { "user-agent": "AVMirror-updater" } }); if (!data.ok) throw Error(`download HTTP ${data.status}`); await fsp.writeFile(target, Buffer.from(await data.arrayBuffer())); }
async function readState() { try { return JSON.parse(await fsp.readFile(stateFile, "utf8")); } catch { return {}; } }
async function update() {
  if (!updateEnabled) return;
  const commit = JSON.parse(await fetchText(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`)).sha;
  const state = await readState();
  if (state.commit === commit && fs.existsSync(path.join(appDir, "server.js"))) return;
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "avmirror-update-"));
  const archive = path.join(tmp, "source.tar.gz");
  const extracted = path.join(tmp, "source");
  try {
    await download(`https://codeload.github.com/${REPO}/tar.gz/${commit}`, archive);
    await fsp.mkdir(extracted);
    const result = run("tar", ["-xzf", archive, "--strip-components=1", "-C", extracted]);
    if (result.status !== 0 || !fs.existsSync(path.join(extracted, "server.js"))) throw Error("arquivo server.js ausente no pacote atualizado");
    const next = path.join(root, "app-next");
    fs.rmSync(next, { recursive: true, force: true });
    fs.cpSync(extracted, next, { recursive: true });
    for (const preserved of ["node_modules", "chromium"]) {
      const current = path.join(appDir, preserved);
      if (fs.existsSync(current)) fs.cpSync(current, path.join(next, preserved), { recursive: true });
    }
    const old = path.join(root, "app-previous");
    fs.rmSync(old, { recursive: true, force: true });
    if (fs.existsSync(appDir)) fs.renameSync(appDir, old);
    fs.renameSync(next, appDir);
    fs.rmSync(old, { recursive: true, force: true });
    await fsp.writeFile(stateFile, JSON.stringify({ commit, updatedAt: new Date().toISOString() }, null, 2) + "\n");
    console.log(`AVMirror atualizado para ${commit.slice(0, 12)}`);
  } catch (error) { console.warn(`Atualização ignorada: ${error.message}`); }
  finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
function start() {
  const runtime = process.env.AVMIRROR_NODE || process.execPath;
  const child = cp.spawn(runtime, [path.join(appDir, "server.js")], { cwd: appDir, env: { ...process.env, LOCAL_MODE: "true", BIND_HOST: process.env.BIND_HOST || "0.0.0.0", PORT: process.env.PORT || "7000", JABLE_LANGUAGE: process.env.JABLE_LANGUAGE || "en", USE_LOCAL_HLS_PROXY: process.env.USE_LOCAL_HLS_PROXY || "true" }, stdio: "inherit" });
  child.on("exit", code => process.exit(code ?? 0));
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}
(async () => { try { await update(); } catch (error) { console.warn(`Verificação de atualização ignorada: ${error.message}`); } if (!fs.existsSync(path.join(appDir, "server.js"))) { console.error("AVMirror: aplicação local ausente e atualização indisponível."); process.exit(1); } start(); })();
