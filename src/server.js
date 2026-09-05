const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const { unifiedCatalog, unifiedMeta, unifiedStreams, unifiedPopular, unifiedUncensored } = require("./lib/unified");
const { readDiskCache, writeDiskCache, catalogPath: diskCatalogPath, metaPath: diskMetaPath } = require("./cache");
const { startWorker } = require("./cache-worker");
const { t, getLang } = require("./lib/i18n");
const express = require("express");
const path = require("path");
const { getLocalIPv4, getLocalBaseUrl } = require("./lib/network");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ── Rate Limiter (in-memory, per-IP sliding window) ─────────────────────────
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_GLOBAL = 120;   // requests per window for catalog/meta/stream
const RATE_LIMIT_MAX_PROXY  = 30;    // requests per window for /image + /hls
const rateBuckets = new Map();
function rateLimit(max) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || "unknown";
    const now = Date.now();
    let bucket = rateBuckets.get(ip);
    if (!bucket) { bucket = []; rateBuckets.set(ip, bucket); }
    // prune old entries
    while (bucket.length && bucket[0] <= now - RATE_LIMIT_WINDOW_MS) bucket.shift();
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - bucket.length)));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil((RATE_LIMIT_WINDOW_MS - (now - (bucket[0] || now))) / 1000)));
    if (bucket.length >= max) {
      res.setHeader("Retry-After", Math.ceil((bucket[0] + RATE_LIMIT_WINDOW_MS - now) / 1000));
      return res.status(429).json({ error: "rate limit exceeded" });
    }
    bucket.push(now);
    next();
  };
}
// Periodically prune stale IP buckets to prevent unbounded growth
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [ip, bucket] of rateBuckets) {
    while (bucket.length && bucket[0] <= cutoff) bucket.shift();
    if (!bucket.length) rateBuckets.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS * 2);

const PORT = Number(process.env.PORT || 7000);
const LOCAL_MODE = process.env.LOCAL_MODE == null
  ? true
  : process.env.LOCAL_MODE === "1" || process.env.LOCAL_MODE === "true";
const USE_LOCAL_HLS_PROXY = process.env.USE_LOCAL_HLS_PROXY == null
  ? LOCAL_MODE
  : process.env.USE_LOCAL_HLS_PROXY === "1" || process.env.USE_LOCAL_HLS_PROXY === "true";
const BIND_HOST = process.env.BIND_HOST || "0.0.0.0";
// AVMirror is intentionally local-first. PUBLIC_BASE_URL is the local server
// URL derived from the LAN address; there is no remote/Render fallback so all
// catalog, meta and media traffic stays on the user's own machine or LAN.
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || getLocalBaseUrl(PORT)).replace(/\/+$/, "");
// Cache mirror (GitHub/raw) is only consulted for remote deployments. In local
// mode every request resolves through the local scraper, so keep it empty.
const CACHE_MIRROR_URL = LOCAL_MODE ? "" : String(process.env.CACHE_MIRROR_URL || "https://raw.githubusercontent.com/devavmirror/avmirror/main/cache").replace(/\/+$/, "");
const CACHE_MIRROR_TIMEOUT_MS = Number(process.env.CACHE_MIRROR_TIMEOUT_MS || 4000);
const SOURCE_URL = new URL(process.env.BASE_URL || "https://jav.guru");
const IMAGE_HOSTS = new Set([
  SOURCE_URL.hostname,
  "cdn.javmiku.com",
  "cdn.javsts.com",
  "cdn.javnorth.com",
  "n1.1024cdn.sx",
  "n19s.1024cdn.sx",
  "pics.dmm.co.jp",
  "javphotos.com",
  "cdn-1.ggjav.com",
  "ggjav.com",
  "cdn-1.porn87.com",
  "cdn-2.porn87.com",
  "cdn-3.porn87.com",
  "porn87.com",
  "fmtu.sl2025p.com",
  "goodav17.com",
  "avjoy.me",
  "javmenu.com",
  "javquick.com",
  "18jav.tv",
  "hohoj.tv",
]);
const IMAGE_TIMEOUT_MS = Number(process.env.IMAGE_TIMEOUT_MS || 12000);
const MEDIA_TIMEOUT_MS = Number(process.env.MEDIA_TIMEOUT_MS || 30000);
const IMAGE_MAX_BYTES = Number(process.env.IMAGE_MAX_BYTES || 4 * 1024 * 1024);
const IMAGE_CACHE_MAX_ENTRIES = Number(process.env.IMAGE_CACHE_MAX_ENTRIES || 120);
const IMAGE_CACHE_MAX_BYTES = Number(process.env.IMAGE_CACHE_MAX_BYTES || 48 * 1024 * 1024);
const imageCache = new Map();
const imagePending = new Map();
let imageCacheBytes = 0;
const mediaCookies = new Map();
const MEDIA_COOKIES_MAX = 100;
const MEDIA_HOSTS = /(^|\.)premilkyway\.com$|(^|\.)s1q2105\.com$|(^|\.)cdn-centaurus\.com$|(^|\.)solutiondocumentation\.site$|(^|\.)maxstream\.org$|(^|\.)97bf1\.com$|(^|\.)tnmr\.org$|(^|\.)voe\.sx$|(^|\.)vide0\.net$|(^|\.)lh3\.googleusercontent\.com$|(^|\.)bkcdn\.net$|(^|\.)1024cdn\.sx$|(^|\.)savedvids\.com$|(^|\.)mycloudz\.cc$|(^|\.)avgle\.com$|(^|\.)cloudwish\.xyz$|(^|\.)turbovid\.vip$|(^|\.)dooood\.com$|(^|\.)streambeast\.upn\.one$|(^|\.)acek-cdn\.com$|(^|\.)javplayers\.com$|(^|\.)akmicdn\.com$|(^|\.)streamsuperpro\.com$|(^|\.)professionalshirts\.shop$|(^|\.)platformresources\.site$|(^|\.)strategicplanning\.sbs$|(^|\.)mountainbrookstudios\.store$|(^|\.)auroralearningworld\.store$|(^|\.)blockchainecosystem\.space$|(^|\.)contentpublishing\.site$|(^|\.)trailheadartisancollect\.store$|(^|\.)harbortowncreativeworks\.cyou$|(^|\.)ggjav\.com$|(^|\.)ggjav\.com$|(^|\.)avjoy\.me$/i;
const JAV_GENRES = [
  "3P", "Amateur", "Back", "Beautiful Girl", "Big tits", "Blowjob", "Boobs fetish", "Cowgirl",
  "Creampie", "Cuckold", "Deep Throat", "Drama", "Drug", "Egg Vibrator", "Electric Massager",
  "Erotic Wear", "Fantasy", "Female teacher", "Handjob", "Hospital / Clinic", "Idol", "Image video",
  "Incest", "Kiss", "M-girl", "Married", "Massage", "Mature", "Mature Woman", "Mini",
  "Multiple Story", "Naked Apron", "Nasty", "OL", "Older sister", "Orgasm", "Orgy", "Other fetish",
  "POV", "Prostitutes", "School Uniform", "Schoolgirls", "Sex Conversion / Feminized", "Sexy", "Shaved",
  "Slender", "Slut", "Solowork", "Squirting", "Titty fuck", "Toy", "Voyeur", "Voyeurism", "Widow"
];
const manifest = {
  id: LOCAL_MODE ? "com.avmirror.addon.local" : "com.avmirror.addon",
  version: "26.2.0",
  name: LOCAL_MODE ? "AVMirror Local" : "AVMirror",
  logo: `${PUBLIC_BASE_URL}/logo.png`,
  description: LOCAL_MODE
    ? "AVMirror Local — Jav • Quality • Content."
    : "AVMirror — Jav • Quality • Content.",
  resources: ["catalog", "meta", "stream"],
  types: ["movie"],
  idPrefixes: ["avmirror:", "javquick:", "18jav:", "hohoj:", "ggjav:", "porn87:", "javmenu:", "goodav17:", "avjoy:"],
  catalogs: [
    {
      type: "movie",
      id: "avmirror",
      name: "🌐 Recentes",
      extra: [
        { name: "search", isRequired: false },
        { name: "genre", options: JAV_GENRES, isRequired: false },
        { name: "skip", isRequired: false }
      ]
    },
    {
      type: "movie",
      id: "avmirror-popular",
      name: "🔥 Populares",
      extra: [
        { name: "search", isRequired: false },
        { name: "genre", options: JAV_GENRES, isRequired: false },
        { name: "skip", isRequired: false }
      ]
    },
    {
      type: "movie",
      id: "avmirror-uncensored",
      name: "🟣 Sem Censura",
      extra: [
        { name: "search", isRequired: false },
        { name: "genre", options: JAV_GENRES, isRequired: false },
        { name: "skip", isRequired: false }
      ]
    },
  ],
  behaviorHints: { adult: true }
};

const builder = new addonBuilder(manifest);

function proxiedMeta(meta) {
  if (!meta) return meta;
  const links = Array.isArray(meta.links) ? meta.links : [];
  const supportLink = { name: "Apoie o AVMirror", category: "other", url: `${PUBLIC_BASE_URL || ""}/install#apoie` };
  const result = { ...meta, links: [...links.filter(link => link?.name !== supportLink.name), supportLink] };
  if (meta.id) {
    const match = meta.id.match(/^([^:]+):(.+)$/);
    if (match && ['avmirror', 'javquick', '18jav', 'hohoj', 'ggjav', 'porn87', 'javmenu', 'goodav17', 'avjoy'].includes(match[1])) {
      result.id = `${match[1]}:${match[2]}`;
    }
  }
  if (result.poster && result.id) {
    const sourcePrefix = result.id.split(":")[0];
    if (['avmirror', 'javquick', '18jav', 'hohoj', 'ggjav', 'porn87', 'javmenu', 'goodav17', 'avjoy'].includes(sourcePrefix)) {
      result.poster = `${PUBLIC_BASE_URL}/image?url=${encodeURIComponent(result.poster)}`;
    }
  }
  return result;
}

async function readCacheMirror(relativePath) {
  if (!relativePath || !CACHE_MIRROR_URL) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CACHE_MIRROR_TIMEOUT_MS);
  try {
    const response = await fetch(`${CACHE_MIRROR_URL}/${relativePath.replace(/^\/+/, "")}`, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!response.ok) return null;
    const value = await response.json();
    return value && typeof value === "object" ? value : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

function cacheCatalogPath(sourceId, page, extra) {
  if (extra?.search || extra?.genre) return null;
  return `catalog/${encodeURIComponent(sourceId)}/${page}.json`;
}

function cacheMetaPath(id) { return `meta/${encodeURIComponent(String(id || ""))}.json`; }

function proxyMediaUrl(raw) { return `${PUBLIC_BASE_URL}/hls?url=${encodeURIComponent(raw)}`; }
const dynamicMediaHosts = new Set();
const DYNAMIC_MEDIA_HOSTS_MAX = 200;
function trustMediaHost(raw) {
  if (!raw) return;
  try {
    const host = new URL(raw).hostname;
    if (!dynamicMediaHosts.has(host)) {
      if (dynamicMediaHosts.size >= DYNAMIC_MEDIA_HOSTS_MAX) {
        const first = dynamicMediaHosts.values().next().value;
        dynamicMediaHosts.delete(first);
      }
      dynamicMediaHosts.add(host);
    }
  } catch {} }
function isAllowedMediaUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || (!MEDIA_HOSTS.test(u.hostname) && !dynamicMediaHosts.has(u.hostname))) return false;
    if (u.hostname === "javplayers.com") {
      return /^\/(?:cdn\/hls|m3|hls)\//i.test(u.pathname);
    }
    if (u.hostname.endsWith(".akmicdn.com")) {
      return /^\/cdn\/down\//i.test(u.pathname) || /\.(?:m3u8|mp4|m4v|webm|m4s|ts)(?:[?#]|$)/i.test(u.pathname + u.search);
    }
    if (/(?:^|\.)(?:bkcdn\.net|1024cdn\.sx|savedvids\.com|mycloudz\.cc|avgle\.com|cloudwish\.xyz|turbovid\.vip|dooood\.com|streambeast\.upn\.one|acek-cdn\.com)$/i.test(u.hostname)) return /\.(?:mp4|m3u8)(?:[?#]|$)/i.test(u.pathname + u.search);
    return true;
  } catch { return false; }
}
const DIRECT_STREAM_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36";
function sourceReferer(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    if (host.endsWith("javquick.com") || host.endsWith("javquick.cfd")) return "https://javquick.com/";
    if (host.endsWith("javplayers.com") || host.endsWith("akmicdn.com")) return "https://javplayers.com/";
    if (host.endsWith("premilkyway.com") || host.endsWith("s1q2105.com") || host.endsWith("cdn-centaurus.com")) return "https://jav.guru/";
    if (host.endsWith("97bf1.com")) return "https://vidara.to/";
    if (host.endsWith("tnmr.org")) return "https://streamhihi.com/";
    if (host.endsWith("1024cdn.sx")) return "https://jav.guru/";
    if (host.endsWith("bkcdn.net") || host.endsWith("savedvids.com") || host.endsWith("mycloudz.cc") || host.endsWith("avgle.com") || host.endsWith("cloudwish.xyz") || host.endsWith("turbovid.vip") || host.endsWith("dooood.com") || host.endsWith("upn.one") || host.endsWith("acek-cdn.com") || host.endsWith("contentpublishing.site") || host.endsWith("trailheadartisancollect.store") || host.endsWith("harbortowncreativeworks.cyou") || host.endsWith("ggjav.com")) return "https://hohoj.tv/";
    return "https://jav.guru/";
  } catch { return "https://jav.guru/"; }
}
function rememberMediaCookies(response, host) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  if (!values.length) return;
  const current = new Map((mediaCookies.get(host) || "").split(/;\s*/).filter(Boolean).map(value => value.split("=", 1)[0]).map(name => [name, (mediaCookies.get(host) || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))?.[1] || ""]));
  for (const value of values) { const pair = value.split(";", 1)[0]; const index = pair.indexOf("="); if (index > 0) current.set(pair.slice(0, index), pair.slice(index + 1)); }
  if (!mediaCookies.has(host) && mediaCookies.size >= MEDIA_COOKIES_MAX) {
    mediaCookies.delete(mediaCookies.keys().next().value);
  }
  mediaCookies.set(host, [...current].map(([name, value]) => `${name}=${value}`).join("; "));
}
function directBehaviorHints(rawUrl, behaviorHints = {}) {
  const referer = sourceReferer(rawUrl);
  return {
    ...behaviorHints,
    // These headers are sent by the Stremio client to the source, not by Render.
    proxyHeaders: {
      ...(behaviorHints.proxyHeaders || {}),
      request: {
        ...(behaviorHints.proxyHeaders?.request || {}),
        "User-Agent": DIRECT_STREAM_USER_AGENT,
        Referer: referer,
        Origin: new URL(referer).origin
      }
    }
  };
}
function proxiedStreams(streams) {
  streams.forEach(stream => { if (stream && stream.url) trustMediaHost(stream.url); });
  return streams
    .filter(stream => stream && (stream.url || stream.externalUrl))
    .map(stream => {
      if (!stream.url || stream.externalUrl) return stream;
      return { ...stream, url: proxyMediaUrl(stream.url), behaviorHints: { ...stream.behaviorHints, bingeGroup: stream.name || "avmirror" } };
    });
}
function supportStream() {
  return {
    name: "Apoie o AVMirror",
    title: "Ajude a manter o addon",
    externalUrl: `${PUBLIC_BASE_URL || ""}/configure`
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
    if (url.protocol !== "https:" || !IMAGE_HOSTS.has(url.hostname)) return false;
    if (url.hostname.endsWith("1024cdn.sx")) return /\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname);
    if (url.hostname === "pics.dmm.co.jp") return /\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname);
    if (url.hostname.endsWith("javmiku.com") || url.hostname.endsWith("javsts.com") || url.hostname.endsWith("javnorth.com")) return true;
    if (url.hostname === "javphotos.com") return /\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname);
    if (url.hostname === "cdn-1.ggjav.com" || url.hostname === "ggjav.com") return /\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname) || /\/media\//i.test(url.pathname);
    if (url.hostname.endsWith("porn87.com")) return true;
    if (url.hostname === "fmtu.sl2025p.com") return /\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname);
    if (url.hostname === "goodav17.com") return /\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname) || /\/wp-content\/uploads\//i.test(url.pathname);
    if (url.hostname === "avjoy.me") return /\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname);
    if (url.hostname === "javmenu.com") return /\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname);
    if (url.hostname === "javquick.com") return true;
    if (url.hostname === "18jav.tv") return /\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname);
    if (url.hostname === "hohoj.tv" || url.hostname.endsWith(".hohoj.tv")) return true;
    return false;
  } catch { return false; }
}

function imageCandidates(rawUrl) {
  return [rawUrl];
}
async function fetchImageCandidate(rawUrl) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), IMAGE_TIMEOUT_MS);
  try {
    const response = await fetch(rawUrl, {
      signal: ac.signal,
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0",
        accept: "image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8",
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
    const sourceId = String(id || "");
    const genre = extra?.genre || "";
    const search = extra?.search || "";

    // 1. Try GitHub cache mirror (remote deployment)
    const cached = await readCacheMirror(cacheCatalogPath(sourceId, page, extra));
    if (cached && Array.isArray(cached.metas) && cached.metas.length) return { ...cached, metas: cached.metas.map(proxiedMeta), cacheMaxAge: 900, staleRevalidate: 3600, staleError: 21600 };

    // 2. Try live scraping
    let metas;
    try {
      if (sourceId === "avmirror-popular") {
        metas = await unifiedPopular({ page, genre });
      } else if (sourceId === "avmirror-uncensored") {
        metas = await unifiedUncensored({ page, genre });
      } else {
        const isSearch = !!search;
        metas = await unifiedCatalog({ page, search, genre, mode: isSearch ? "" : sourceId || "avmirror" });
      }
    } catch { metas = []; }

    // 3. Fallback to disk cache if live scraping returned empty (no search/genre)
    if ((!metas || !metas.length) && !search && !genre) {
      try {
        const disk = await readDiskCache(diskCatalogPath(sourceId, page));
        if (disk && Array.isArray(disk.metas) && disk.metas.length) {
          metas = disk.metas;
          console.log(`[catalog] disk cache fallback: ${sourceId} page ${page}`);
        }
      } catch {}
    }

    // 4. Save successful live result to disk cache
    if (metas && metas.length && !search && !genre) {
      try { await writeDiskCache(diskCatalogPath(sourceId, page), { metas, updatedAt: new Date().toISOString() }); } catch {}
    }

    return {
      metas: (metas || []).map(proxiedMeta),
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
    const value = String(id || "");
    const cached = await readCacheMirror(cacheMetaPath(value));
    if (cached && cached.meta) return { ...cached, meta: proxiedMeta(cached.meta), cacheMaxAge: 3600, staleRevalidate: 7200, staleError: 21600 };

    let meta;
    try { meta = await unifiedMeta(id); } catch { meta = null; }

    if (!meta) {
      try {
        const disk = await readDiskCache(diskMetaPath(value));
        if (disk && disk.meta) {
          meta = disk.meta;
          console.log(`[meta] disk cache fallback: ${value.substring(0, 40)}`);
        }
      } catch {}
    }

    if (meta) {
      try { await writeDiskCache(diskMetaPath(value), { meta, updatedAt: new Date().toISOString() }); } catch {}
    }

    return {
      meta: proxiedMeta(meta),
      cacheMaxAge: 3600,
      staleRevalidate: 7200,
      staleError: 21600
    };
  } catch (e) {
    console.error("meta:", e);
    return { meta: null };
  }
});

builder.defineStreamHandler(async ({ type, id }) => {
  if (type !== "movie") return { streams: [] };
  try {
    return {
      streams: [supportStream(), ...await (async () => {
        const raw = await unifiedStreams(id);
        return raw.filter(s => s && (s.url || s.externalUrl)).map(s => {
          if (!s.url || s.externalUrl) return s;
          const existingHeaders = s.behaviorHints?.proxyHeaders?.headers || {};
          const referer = existingHeaders.Referer || sourceReferer(s.url);
          return { ...s, behaviorHints: { ...s.behaviorHints, bingeGroup: s.behaviorHints?.bingeGroup || "avmirror", proxyHeaders: { headers: { "User-Agent": UA, "Referer": referer, "Origin": new URL(referer).origin, ...existingHeaders } } } };
        });
      })()],
      cacheMaxAge: 120,
      staleRevalidate: 300,
      staleError: 600
    };
  } catch (e) {
    console.error("stream:", e);
    return { streams: [] };
  }
});

const app = express();
app.disable("x-powered-by");

// Health and installation UI must be registered before the Stremio router.
app.get("/health", (_req, res) => res.status(200).json({ ok: true, name: "AVMirror", version: manifest.version }));
app.get("/api/local-info", (req, res) => {
  const host = req.hostname && req.hostname !== "localhost" && req.hostname !== "127.0.0.1" ? req.hostname : getLocalIPv4();
  const base = `http://${host}:${PORT}`;
  res.json({ host, port: PORT, baseUrl: base, manifestUrl: `${base}/manifest.json`, stremioUrl: `stremio://${host}:${PORT}/manifest.json`, localMode: LOCAL_MODE, directStreams: !(LOCAL_MODE && USE_LOCAL_HLS_PROXY), hlsProxy: LOCAL_MODE && USE_LOCAL_HLS_PROXY });
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
app.get("/image", rateLimit(RATE_LIMIT_MAX_PROXY), async (req, res) => {
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
app.all("/hls", rateLimit(RATE_LIMIT_MAX_PROXY), async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).set("Allow", "GET, HEAD, OPTIONS").end();
  let rawUrl = String(req.query.url || "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MEDIA_TIMEOUT_MS);
  try {
    if (!isAllowedMediaUrl(rawUrl)) {
      let rejectedHost = "invalid-url";
      try { rejectedHost = new URL(rawUrl).hostname; } catch {}
      throw new Error(`media host is not allowed: ${rejectedHost}`);
    }
    const host = new URL(rawUrl).hostname.toLowerCase();
    const luluCode = host.endsWith("tnmr.org") ? rawUrl.match(/\/([^/]+)_h\/master\.m3u8/i)?.[1] : null;
    const referer = host.endsWith("javplayers.com") || host.endsWith("akmicdn.com") ? rawUrl : host.endsWith("premilkyway.com") || host.endsWith("s1q2105.com") || host.endsWith("cdn-centaurus.com") ? "https://jav.guru/" : host.endsWith("97bf1.com") ? "https://vidara.to/" : host.endsWith("tnmr.org") ? `https://streamhihi.com/e/${luluCode || ""}` : host.endsWith("ggjav.com") ? "https://hohoj.tv/" : host.endsWith("bkcdn.net") || host.endsWith("1024cdn.sx") || host.endsWith("savedvids.com") || host.endsWith("mycloudz.cc") || host.endsWith("avgle.com") || host.endsWith("cloudwish.xyz") || host.endsWith("turbovid.vip") || host.endsWith("dooood.com") || host.endsWith("upn.one") || host.endsWith("acek-cdn.com") || host.endsWith("contentpublishing.site") || host.endsWith("trailheadartisancollect.store") || host.endsWith("harbortowncreativeworks.cyou") ? "https://jav.guru/" : "https://jav.guru/";
    const requestHeaders = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36", referer, origin: new URL(referer).origin, accept: "*/*" };
    if (req.headers.range) requestHeaders.range = req.headers.range;
    if (mediaCookies.get(host)) requestHeaders.cookie = mediaCookies.get(host);
    let response = await fetch(rawUrl, { headers: requestHeaders, signal: controller.signal });
    rememberMediaCookies(response, host);
    // LuluStream may require a short-lived cookie from the embed page.
    if (!response.ok && host.endsWith("tnmr.org") && luluCode) {
      const embed = await fetch(`https://streamhihi.com/e/${luluCode}`, { headers: { "user-agent": requestHeaders["user-agent"], referer: "https://jav.guru/", accept: "text/html,*/*" } });
      const cookies = typeof embed.headers.getSetCookie === "function" ? embed.headers.getSetCookie() : [];
      if (cookies.length) {
        requestHeaders.cookie = cookies.map(x => x.split(";", 1)[0]).join("; ");
        response = await fetch(rawUrl, { headers: requestHeaders, signal: controller.signal });
      }
    }
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
    const isJavPlayersSegment = /(?:javplayers\.com|akmicdn\.com)$/i.test(host) && /\/(?:m3|cdn\/down)\//i.test(new URL(rawUrl).pathname);
    for (const header of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const value = response.headers.get(header);
      if (value && !(isJavPlayersSegment && header === "content-type")) res.set(header, value);
    }
    if (isJavPlayersSegment) res.set("Content-Type", "video/mp2t");
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
});
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "install.html")));

// Rewrite query params to path-based extras so the SDK router can parse them.
// e.g. /catalog/movie/avmirror.json?search=foo  →  /catalog/movie/avmirror/search=foo.json
// Also fix percent-encoded path extras (search%3Dfoo → search=foo)
app.use((req, res, next) => {
  const qm = req.url.match(/^\/catalog\/([^/]+)\/([^/]+)\.json\?(.+)$/);
  if (qm && qm[3]) {
    const extra = decodeURIComponent(qm[3].replace(/\+/g, " "));
    req.url = `/catalog/${qm[1]}/${qm[2]}/${extra}.json`;
  } else {
    const pm = req.url.match(/^\/catalog\/([^/]+)\/([^/]+)\/(.+)\.json$/);
    if (pm && pm[3] && /%[0-9A-Fa-f]{2}/.test(pm[3])) {
      req.url = `/catalog/${pm[1]}/${pm[2]}/${decodeURIComponent(pm[3])}.json`;
    }
  }
  next();
});

// ── Dynamic manifest with language support ──────────────────────────────────
function buildManifest(lang) {
  const l = lang || 'pt';
  return {
    ...manifest,
    name: LOCAL_MODE ? t(l, 'addon.name') : t(l, 'addon.namePublic'),
    description: LOCAL_MODE ? t(l, 'addon.descriptionLocal') : t(l, 'addon.descriptionPublic'),
    catalogs: [
      { ...manifest.catalogs[0], name: t(l, 'catalogNames.recentes') },
      { ...manifest.catalogs[1], name: t(l, 'catalogNames.populares') },
      { ...manifest.catalogs[2], name: t(l, 'catalogNames.semCensura') }
    ]
  };
}

// Override /manifest.json with dynamic language support
app.get('/manifest.json', (req, res) => {
  const lang = getLang(req);
  res.json(buildManifest(lang));
});

app.get("/configure", (_req, res) => res.sendFile(path.join(__dirname, "public", "configure.html")));

// Official SDK exposes the addon protocol as an Express-compatible router.
// This makes /catalog/... /meta/... and /stream/... available.
app.use("/", rateLimit(RATE_LIMIT_MAX_GLOBAL), getRouter(builder.getInterface()));

const cacheWorker = startWorker();

const server = app.listen(PORT, BIND_HOST, () => {
  console.log(`AVMirror listening on ${BIND_HOST}:${PORT} (${LOCAL_MODE ? "local proxy" : "remote direct streams"})`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("unhandledRejection", (reason) => console.error("unhandled rejection:", reason));
process.on("uncaughtException", (err) => { console.error("uncaught exception:", err); });
