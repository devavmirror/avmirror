const path = require("node:path");

const CACHE_TTL_MS = 30 * 60 * 1000;
const METADATA_TIMEOUT_MS = Number(process.env.TORRENT_METADATA_TIMEOUT_MS || 8000);
const cache = new Map();
const pending = new Map();
let WebTorrentPromise;

function buildMagnet(stream) {
  const hash = String(stream?.infoHash || "").trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(hash)) return null;
  const trackers = Array.isArray(stream.sources) ? stream.sources : [];
  const params = trackers
    .map(value => String(value || "").replace(/^tracker:/i, "").trim())
    .filter(value => /^(?:udp|https?|wss):\/\//i.test(value))
    .map(value => `&tr=${encodeURIComponent(value)}`)
    .join("");
  return `magnet:?xt=urn:btih:${hash}${params}`;
}

function isVideo(name) {
  return /\.(?:mp4|mkv|avi|mov|webm|m4v|ts)$/i.test(String(name || ""));
}

function chooseVideo(files) {
  const videos = files
    .map((file, index) => ({ file, index }))
    .filter(({ file }) => isVideo(file.name));
  if (!videos.length) return null;
  // Prefer the main/full-length file. Small extras, previews and samples are
  // normally much shorter than the primary movie in JAV multi-file torrents.
  const ranked = videos.sort((a, b) => {
    const aExtra = /sample|preview|trailer|短|サンプル/i.test(a.file.name) ? 1 : 0;
    const bExtra = /sample|preview|trailer|短|サンプル/i.test(b.file.name) ? 1 : 0;
    return aExtra - bExtra || b.file.length - a.file.length;
  });
  const selected = ranked[0];
  return { fileIdx: selected.index, fileName: selected.file.name, fileSize: selected.file.length, videoCount: videos.length };
}

async function getWebTorrent() {
  if (!WebTorrentPromise) {
    WebTorrentPromise = import("webtorrent").then(mod => mod.default || mod);
  }
  return WebTorrentPromise;
}

async function resolveTorrentFile(stream) {
  const hash = String(stream?.infoHash || "").toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(hash)) return stream;
  const cached = cache.get(hash);
  if (cached && cached.expiresAt > Date.now()) return { ...stream, ...cached.value };
  if (pending.has(hash)) return { ...stream, ...(await pending.get(hash)) };
  const magnet = buildMagnet(stream);
  if (!magnet) return stream;
  const request = (async () => {
    let client;
    try {
      const WebTorrent = await getWebTorrent();
      client = new WebTorrent({ dht: true, tracker: true });
      const metadata = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("torrent metadata timeout")), METADATA_TIMEOUT_MS);
        const torrent = client.add(magnet, { path: path.join("/tmp", "avmirror-torrent-metadata") });
        torrent.once("metadata", () => {
          clearTimeout(timer);
          resolve(chooseVideo(torrent.files));
        });
        torrent.once("error", error => {
          clearTimeout(timer);
          reject(error);
        });
      });
      if (!metadata) return {};
      cache.set(hash, { value: metadata, expiresAt: Date.now() + CACHE_TTL_MS });
      return metadata;
    } catch (error) {
      console.error(`[torrent-meta] ${hash.slice(0, 8)}: ${error.message}`);
      return {};
    } finally {
      if (client) await Promise.race([
        new Promise(resolve => client.destroy(() => resolve())),
        new Promise(resolve => setTimeout(resolve, 1500)),
      ]);
    }
  })();
  pending.set(hash, request);
  try {
    return { ...stream, ...(await request) };
  } finally {
    pending.delete(hash);
  }
}

module.exports = { buildMagnet, chooseVideo, resolveTorrentFile };
