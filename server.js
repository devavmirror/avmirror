const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const { scrapeJableCatalog, scrapeJableMeta, scrapeJableStreams, closeJableBrowser, JABLE_GENRES } = require("./jable");
const express = require("express");
const path = require("path");
const { getLocalIPv4, getLocalBaseUrl } = require("./lib/network");

const PORT = Number(process.env.PORT || 7000);
// AVMirror is intentionally decentralized: every installation owns its local server.
// LOCAL_MODE remains configurable for compatibility, but local execution is the default.
const LOCAL_MODE = process.env.LOCAL_MODE == null
  ? true
  : process.env.LOCAL_MODE === "1" || process.env.LOCAL_MODE === "true";
// Local Stremio uses the HLS proxy by default so Android clients can play
// signed manifests and segments. Remote deployments never proxy video.
const USE_LOCAL_HLS_PROXY = process.env.USE_LOCAL_HLS_PROXY == null
  ? LOCAL_MODE
  : process.env.USE_LOCAL_HLS_PROXY === "1" || process.env.USE_LOCAL_HLS_PROXY === "true";
const BIND_HOST = process.env.BIND_HOST || "0.0.0.0";
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || getLocalBaseUrl(PORT)).replace(/\/+$/, "");
const IMAGE_HOSTS = new Set(["assets-cdn.jable.tv"]);
const IMAGE_TIMEOUT_MS = Number(process.env.IMAGE_TIMEOUT_MS || 12000);
const MEDIA_TIMEOUT_MS = Number(process.env.MEDIA_TIMEOUT_MS || 30000);
const IMAGE_MAX_BYTES = Number(process.env.IMAGE_MAX_BYTES || 4 * 1024 * 1024);
const IMAGE_CACHE_MAX_ENTRIES = Number(process.env.IMAGE_CACHE_MAX_ENTRIES || 120);
const IMAGE_CACHE_MAX_BYTES = Number(process.env.IMAGE_CACHE_MAX_BYTES || 48 * 1024 * 1024);
const imageCache = new Map();
const imagePending = new Map();
let imageCacheBytes = 0;
const mediaCookies = new Map();
const MEDIA_HOSTS = /(^|\.)mushroomtrack\.com$/i;
const manifest = {
  id: LOCAL_MODE ? "com.avmirror.addon.local" : "com.avmirror.addon",
  // Stremio exige SemVer completo internamente; a versão pública do produto é 26.1.
  version: "26.1.1",
  name: LOCAL_MODE ? "AVMirror Local" : "AVMirror",
  logo: `${PUBLIC_BASE_URL}/logo.png`,
  description: LOCAL_MODE
    ? "AVMirror Local — catálogo e reprodução pelo servidor pessoal do usuário."
    : "AVMirror — catálogo e reprodução de conteúdo autorizado.",
  resources: ["catalog", "meta", "stream"],
  types: ["movie"],
  idPrefixes: ["jable:"],
  catalogs: [
    ["jable", "AVMirror — Jable.TV — Novos"],
    ["jable-popular", "AVMirror — Jable.TV — Populares"]
  ].map(([id, name]) => ({
    type: "movie",
    id,
    name,
    extra: [
      { name: "search", isRequired: false },
      { name: "genre", options: JABLE_GENRES, isRequired: false },
      { name: "skip", isRequired: false }
    ]
  })),
  behaviorHints: { adult: true }
};

const builder = new addonBuilder(manifest);

function proxiedMeta(meta) {
  if (!meta) return meta;
  const links = Array.isArray(meta.links) ? meta.links : [];
  const supportLink = { name: "Apoie o AVMirror", category: "other", url: `${PUBLIC_BASE_URL || ""}/install#apoie` };
  const result = { ...meta, links: [...links.filter(link => link?.name !== supportLink.name), supportLink] };
  if (!PUBLIC_BASE_URL || !meta.poster) return result;
  // Always proxy posters. Stremio Desktop and some mobile networks reject the
  // source hosts because of hotlink, TLS, or restrictive CDN policies.
  return { ...result, poster: `${PUBLIC_BASE_URL}/image?url=${encodeURIComponent(meta.poster)}` };
}

// Path-based media URLs keep the real file extension (.m3u8/.ts/.mp4) in the
// pathname. Extracting the media behind the proxy this way is required by
// strict HLS players (ffmpeg/libav, used by the Stremio desktop client), which
// reject playlist/segment URLs whose pathname lacks a known extension (the old
// query-based "/hls?url=" form) and stall forever on a blank screen.
const MEDIA_EXT = /\.(m3u8|m4s|ts|mp4|m4v|webm|aac|mp3|m3u|txt)(?:[?#]|$)/i;
function mediaProxyId(raw) {
  const hostExt = String(raw.split("?")[0].match(MEDIA_EXT)?.[1] || "ts");
  return `${Buffer.from(raw, "utf8").toString("base64url")}.${hostExt}`;
}
function decodeMediaProxyId(file) {
  const ext = String(file || "").match(/\.(m3u8|m4s|ts|mp4|m4v|webm|aac|mp3|m3u|txt)$/i)?.[1] || "";
  const b64 = String(file || "").replace(/\.[a-z0-9]+$/i, "");
  if (!b64) return null;
  try {
    const decoded = Buffer.from(b64, "base64url").toString("utf8");
    return /^https?:/i.test(decoded) ? decoded : null;
  } catch { return null; }
}
function proxyMediaUrl(raw) {
  return `${PUBLIC_BASE_URL}/hls/${encodeURIComponent(mediaProxyId(raw))}`;
}
function isAllowedMediaUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || !MEDIA_HOSTS.test(u.hostname)) return false;
    return /\.(?:m3u8|m4s|ts|mp4|m4v|webm)(?:[?#]|$)/i.test(u.pathname + u.search)
      || /\/hls\//i.test(u.pathname);
  } catch { return false; }
}
const DIRECT_STREAM_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36";
function sourceReferer() { return "https://jable.tv/"; }
function rememberMediaCookies(response, host) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  if (!values.length) return;
  const current = new Map((mediaCookies.get(host) || "").split(/;\s*/).filter(Boolean).map(value => value.split("=", 1)[0]).map(name => [name, (mediaCookies.get(host) || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))?.[1] || ""]));
  for (const value of values) { const pair = value.split(";", 1)[0]; const index = pair.indexOf("="); if (index > 0) current.set(pair.slice(0, index), pair.slice(index + 1)); }
  mediaCookies.set(host, [...current].map(([name, value]) => `${name}=${value}`).join("; "));
}
function directBehaviorHints(rawUrl, behaviorHints = {}) {
  const requestHeaders = behaviorHints.proxyHeaders?.request || {};
  const canonicalReferer = sourceReferer(rawUrl);
  let host = "";
  try { host = new URL(rawUrl).hostname.toLowerCase(); } catch {}
  const referer = requestHeaders.Referer || canonicalReferer;
  let origin = requestHeaders.Origin;
  try { origin ||= new URL(referer).origin; } catch { origin = undefined; }
  return {
    ...behaviorHints,
    // These headers are sent by the Stremio client to the source, not by Render.
    proxyHeaders: {
      ...(behaviorHints.proxyHeaders || {}),
      request: {
        ...requestHeaders,
        "User-Agent": requestHeaders["User-Agent"] || DIRECT_STREAM_USER_AGENT,
        Referer: referer,
        ...(origin ? { Origin: origin } : {})
      }
    }
  };
}
function isInternalVideoProxyUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ""));
    const publicHost = PUBLIC_BASE_URL ? new URL(PUBLIC_BASE_URL).hostname : "";
    return /^\/hls(?:\/|$)/i.test(url.pathname)
      || Boolean(publicHost && url.hostname === publicHost && /^\/hls(?:\/|$)/i.test(url.pathname));
  } catch { return false; }
}
function proxiedStreams(streams, forceLocalProxy) {
  return streams
    .filter(stream => stream && (stream.url || stream.externalUrl) && (!stream.url || LOCAL_MODE || !isInternalVideoProxyUrl(stream.url)))
    .map(stream => {
      if (!stream.url || stream.externalUrl) return stream;
      // Per-device: proxy delivery is only used for clients that ignore the
      // proxyHeaders contract (Android/TV). Clients that repass headers get the
      // source URL directly so each device resolves playback independently.
      const useProxy = LOCAL_MODE && USE_LOCAL_HLS_PROXY && forceLocalProxy;
      if (useProxy) {
        return { ...stream, url: proxyMediaUrl(stream.url), behaviorHints: stream.behaviorHints || {} };
      }
      // Render never retransmits video; remote deployments deliver the source URL.
      // Keep both representations because mobile clients differ in how they
      // apply Stremio's proxyHeaders contract to direct playback.
      const behaviorHints = directBehaviorHints(stream.url, stream.behaviorHints);
      const requestHeaders = behaviorHints.proxyHeaders?.request || {};
      return { ...stream, headers: { ...(stream.headers || {}), ...requestHeaders }, behaviorHints };
    });
}
function supportStream() {
  return {
    name: "Apoie o AVMirror",
    title: "Ajude a manter o addon",
    externalUrl: `${PUBLIC_BASE_URL || ""}/install#apoie`
  };
}
function rewritePlaylist(text, sourceUrl) {
  const lines = String(text).split(/\r?\n/);
  const output = [];
  let pendingVariantTags = [];
  const rewriteUri = value => {
    try {
      const absoluteUrl = new URL(value, sourceUrl).href;
      return isAllowedMediaUrl(absoluteUrl) ? proxyMediaUrl(absoluteUrl) : "";
    } catch { return ""; }
  };
  for (const line of lines) {
    if (/^\s*#EXT-X-STREAM-INF:/i.test(line)) {
      pendingVariantTags.push(line);
      continue;
    }
    if (pendingVariantTags.length && line.trim() && !/^\s*#/.test(line)) {
      const rewritten = rewriteUri(line.trim());
      if (rewritten) output.push(...pendingVariantTags, rewritten);
      pendingVariantTags = [];
      continue;
    }
    if (pendingVariantTags.length && /^\s*#/.test(line)) {
      output.push(...pendingVariantTags);
      pendingVariantTags = [];
    }
    if (/^\s*#/.test(line)) {
      output.push(line.replace(/URI="([^"]+)"/g, (_, value) => {
        const rewritten = rewriteUri(value);
        return rewritten ? `URI="${rewritten}"` : `URI="${value}"`;
      }));
      continue;
    }
    const value = line.trim();
    if (!value) { output.push(line); continue; }
    const rewritten = rewriteUri(value);
    if (rewritten) output.push(rewritten);
  }
  if (pendingVariantTags.length) output.push(...pendingVariantTags);
  return output.join("\n");
}

function isAllowedImageUrl(raw) {
  try {
    const url = new URL(raw);
    const jableImage = url.hostname === "assets-cdn.jable.tv" && (
      /^\/contents\/videos_screenshots\/\d+\/\d+\/(?:320x180\/1|[^/]+)\.(?:jpe?g|png|webp)$/i.test(url.pathname)
      || /^\/assets\/images\/(?:placeholder-md|logo|avatar)\.(?:jpe?g|png|svg)$/i.test(url.pathname)
    );
    return url.protocol === "https:" && IMAGE_HOSTS.has(url.hostname) && jableImage;
  } catch { return false; }
}

function imageCandidates(rawUrl) { return [rawUrl]; }
async function fetchImageCandidate(rawUrl) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), IMAGE_TIMEOUT_MS);
  try {
    const response = await fetch(rawUrl, {
      signal: ac.signal,
      redirect: "follow",
      headers: {
        "user-agent": DIRECT_STREAM_USER_AGENT,
        accept: "image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8",
        referer: "https://jable.tv/"
      }
    });
    if (!response.ok || !isAllowedImageUrl(response.url)) throw new Error(`image HTTP ${response.status}`);
    const type = String(response.headers.get("content-type") || "").split(";", 1)[0].toLowerCase();
    if (!type.startsWith("image/")) throw new Error("upstream is not an image");
    const length = Number(response.headers.get("content-length") || 0);
    if (length > IMAGE_MAX_BYTES) throw new Error("image is too large");
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > IMAGE_MAX_BYTES) throw new Error("image is too large");
    return { body, type };
  } finally { clearTimeout(timer); }
}
async function fetchImage(rawUrl) {
  if (!isAllowedImageUrl(rawUrl)) throw new Error("image host is not allowed");
  const cached = imageCache.get(rawUrl);
  if (cached && cached.expiresAt > Date.now()) return cached;
  if (imagePending.has(rawUrl)) return imagePending.get(rawUrl);
  const request = (async () => {
    try {
      const value = await Promise.any(imageCandidates(rawUrl).map(fetchImageCandidate));
      const cachedValue = { ...value, expiresAt: Date.now() + 6 * 60 * 60 * 1000 };
      const previous = imageCache.get(rawUrl);
      if (previous) imageCacheBytes -= previous.body.length;
      imageCache.set(rawUrl, cachedValue);
      imageCacheBytes += cachedValue.body.length;
      while (imageCache.size > IMAGE_CACHE_MAX_ENTRIES || imageCacheBytes > IMAGE_CACHE_MAX_BYTES) {
        const first = imageCache.entries().next().value;
        if (!first) break;
        imageCache.delete(first[0]);
        imageCacheBytes -= first[1].body.length;
      }
      return cachedValue;
    } finally { imagePending.delete(rawUrl); }
  })();
  imagePending.set(rawUrl, request);
  return request;
}

builder.defineCatalogHandler(async ({ id, extra }) => {
  try {
    const page = Math.floor(Number(extra?.skip || 0) / 20) + 1;
    const metas = await scrapeJableCatalog({
      page,
      search: extra?.search || "",
      genre: extra?.genre || "",
      mode: String(id || "jable")
    });
    return {
      metas: metas.map(proxiedMeta),
      cacheMaxAge: 300,
      staleRevalidate: 900,
      staleError: 1800
    };
  } catch (e) {
    console.error("catalog:", e);
    return { metas: [] };
  }
});

builder.defineMetaHandler(async ({ id }) => {
  try {
    return {
      meta: proxiedMeta(await scrapeJableMeta(id)),
      cacheMaxAge: 3600,
      staleRevalidate: 7200,
      staleError: 21600
    };
  } catch (e) {
    console.error("meta:", e);
    return { meta: null };
  }
});

async function resolveStreams(id) {
  return scrapeJableStreams(id);
}

// Which Stremio clients re-enforce the proxyHeaders contract on direct playback.
// Desktop and iOS repass Referer/Origin/User-Agent; Android and TV boxes tend to
// ignore them, so they must fall back to the local HLS proxy to keep working.
function deviceNeedsProxy(userAgent) {
  if (!userAgent) return true;
  const ua = String(userAgent).toLowerCase();
  if (/android|tv|glass|smarthub/i.test(ua)) return true;
  if (/iphone|ipad|ipod|mac os|windows|linux|x11|darwin/i.test(ua)) return false;
  return true;
}

const app = express();
app.disable("x-powered-by");

// Health and installation UI must be registered before the Stremio router.
app.get("/health", (_req, res) => res.status(200).json({ ok: true, name: "AVMirror", version: manifest.version }));
app.get("/api/local-info", (req, res) => {
  if (!LOCAL_MODE) {
    const onlineHost = new URL(PUBLIC_BASE_URL).host;
    res.json({ host: onlineHost, port: new URL(PUBLIC_BASE_URL).port || 443, baseUrl: PUBLIC_BASE_URL, manifestUrl: `${PUBLIC_BASE_URL}/manifest.json`, stremioUrl: `stremio://${onlineHost}/manifest.json`, localMode: false, directStreams: true, hlsProxy: false });
    return;
  }
  const host = req.hostname && req.hostname !== "localhost" && req.hostname !== "127.0.0.1" ? req.hostname : getLocalIPv4();
  const base = `http://${host}:${PORT}`;
  res.json({ host, port: PORT, baseUrl: base, manifestUrl: `${base}/manifest.json`, stremioUrl: `stremio://${host}:${PORT}/manifest.json`, localMode: true, directStreams: !USE_LOCAL_HLS_PROXY, hlsProxy: USE_LOCAL_HLS_PROXY });
});
app.get("/install", (_req, res) => res.sendFile(path.join(__dirname, "public", "install.html")));
const staticAssetOptions = { maxAge: "7d", immutable: true };
app.get("/stremio-addons-installed.webp", (_req, res) => res.sendFile(path.join(__dirname, "public", "stremio-addons-installed.webp"), staticAssetOptions));
app.get("/stremio-avmirror-catalog.webp", (_req, res) => res.sendFile(path.join(__dirname, "public", "stremio-avmirror-catalog.webp"), staticAssetOptions));
app.get("/logo.png", (_req, res) => {
  res.set("Cache-Control", "public, max-age=86400");
  res.sendFile(path.join(__dirname, "public", "logo.png"));
});
app.options("/image", (_req, res) => res.status(204)
  .set("Access-Control-Allow-Origin", "*")
  .set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
  .set("Access-Control-Allow-Headers", "Range, Content-Type")
  .end());
app.get("/image", async (req, res) => {
  try {
    const image = await fetchImage(String(req.query.url || ""));
    res.set("Content-Type", image.type);
    res.set("Cache-Control", "public, max-age=21600, stale-while-revalidate=86400");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Access-Control-Allow-Origin", "*");
    res.send(image.body);
  } catch (e) {
    console.error("image proxy:", e.message);
    res.status(404).json({ error: "image unavailable" });
  }
});
// In local mode the device may proxy HLS for its own Stremio instance.
// In Render mode this route is hard-disabled so it cannot carry video traffic.
if (!LOCAL_MODE) app.all("/hls", (_req, res) => res.status(410).json({ error: "video proxy disabled on remote deployment" }));
app.options("/hls", (_req, res) => res.status(204)
  .set("Access-Control-Allow-Origin", "*")
  .set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
  .set("Access-Control-Allow-Headers", "Range, Content-Type")
  .set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges")
  .end());
async function handleMediaRequest(req, res, rawUrl) {
  if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).set("Allow", "GET, HEAD, OPTIONS").end();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MEDIA_TIMEOUT_MS);
  try {
    if (!isAllowedMediaUrl(rawUrl)) {
      let rejectedHost = "invalid-url";
      try { rejectedHost = new URL(rawUrl).hostname; } catch {}
      throw new Error(`media host is not allowed: ${rejectedHost}`);
    }
    const host = new URL(rawUrl).hostname.toLowerCase();
    const referer = "https://jable.tv/";
    const requestHeaders = { "user-agent": DIRECT_STREAM_USER_AGENT, referer, origin: new URL(referer).origin, accept: "*/*" };
    if (req.headers.range) requestHeaders.range = req.headers.range;
    if (mediaCookies.get(host)) requestHeaders.cookie = mediaCookies.get(host);
    let response = await fetch(rawUrl, { headers: requestHeaders, signal: controller.signal });
    rememberMediaCookies(response, host);
    if (!response.ok) throw new Error(`media HTTP ${response.status}`);
    const type = String(response.headers.get("content-type") || "").toLowerCase();
    if (/\.m3u8(?:[?#]|$)|master\.txt(?:[?#]|$)|\/cdn\/hls\//i.test(rawUrl) || type.includes("mpegurl") || (type.includes("text/plain") && /\/m3\//i.test(rawUrl))) {
      const playlist = await response.text();
      if (!/^\s*#EXTM3U/m.test(playlist)) throw new Error("invalid HLS playlist");
      if (/(?:tiktokcdn\.com|ad-site|\.image(?:[/?#]|$))/i.test(playlist)) throw new Error("advertising HLS playlist");
      res.set("Content-Type", "application/vnd.apple.mpegurl");
      res.set("Cache-Control", "no-store");
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Access-Control-Allow-Headers", "Range, Content-Type");
      res.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
      if (req.method === "HEAD") return res.end();
      return res.send(rewritePlaylist(playlist, rawUrl));
    }
    res.status(response.status);
    for (const header of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const value = response.headers.get(header);
      if (value) res.set(header, value);
    }
    res.set("Cache-Control", "no-store");
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Range, Content-Type");
    res.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
    if (req.method === "HEAD") return res.end();
    return res.send(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    console.error("hls proxy:", e.message);
    return res.status(502).json({ error: "media unavailable" });
  } finally {
    clearTimeout(timer);
  }
}
// Legacy query-based proxy (kept for backward compatibility).
app.all("/hls", (req, res) => handleMediaRequest(req, res, String(req.query.url || "")));
// Path-based proxy. The :file segment carries the base64url media URL plus the
// real extension (e.g. "...base64.m3u8") so strict HLS players recognize it.
app.get("/hls/:file", (req, res) => {
  const rawUrl = decodeMediaProxyId(req.params.file);
  return rawUrl ? handleMediaRequest(req, res, rawUrl) : res.status(400).json({ error: "invalid media id" });
});
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "install.html")));

// Stream resource served manually (before the SDK router) so we can inspect
// the requesting client's User-Agent and choose direct vs. local-proxy delivery
// per device. The SDK router never exposes request headers to its handlers.
app.get("/stream/movie/:id.json", async (req, res) => {
  try {
    const needsProxy = deviceNeedsProxy(req.headers["user-agent"]);
    const streams = await resolveStreams(req.params.id);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "max-age=120, stale-while-revalidate=300, stale-if-error=600, public");
    res.json({ streams: [supportStream(), ...proxiedStreams(streams, needsProxy)] });
  } catch (e) {
    console.error("stream:", e);
    res.json({ streams: [] });
  }
});
// Fallback for any other stream resource shape the manual route above misses.
builder.defineStreamHandler(async ({ id }) => {
  try {
    return { streams: [supportStream(), ...proxiedStreams(await resolveStreams(id), !LOCAL_MODE)] };
  } catch (e) {
    console.error("stream:", e);
    return { streams: [] };
  }
});

// Official SDK exposes the addon protocol as an Express-compatible router.
// This makes /manifest.json, /catalog/..., /meta/... and /stream/... available.
app.use("/", getRouter(builder.getInterface()));

const server = app.listen(PORT, BIND_HOST, () => {
  console.log(`AVMirror listening on ${BIND_HOST}:${PORT} (${LOCAL_MODE ? "local proxy" : "remote direct streams"})`);
});

const shutdown = async () => {
  try { await closeJableBrowser(); }
  finally {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  }
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
