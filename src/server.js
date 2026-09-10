const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const crypto = require("node:crypto");
const dns = require("node:dns");
const net = require("node:net");
const { unzipSync } = require("fflate");
dns.setDefaultResultOrder("ipv4first");

const { unifiedCatalog, unifiedMeta, unifiedStreams, unifiedPopular, unifiedUncensored, unifiedCensored, SOURCES, getSourceMetrics, getSourceScores, torrentRegistry, cleanupRegistry, extractCode } = require("./lib/unified");
const { installProxyFetch, getProxyStats, testProxy } = require("./lib/proxy-fetch");
const { startBackground, getBackgroundStats } = require("./lib/background-scraper");
console.error(`[init] proxy=${process.env.PROXY_URL ? "on" : "off"}`);
installProxyFetch();
const { t, getLang } = require("./lib/i18n");
const express = require("express");
const path = require("path");
const { getLocalIPv4, getLocalBaseUrl } = require("./lib/network");
const { readPosterCache, storePosterFromCatalog } = require("./lib/catalog-cache");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ── Rate Limiter (in-memory, per-IP sliding window) ─────────────────────────
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_GLOBAL = 120;   // requests per window for catalog/meta/stream
const RATE_LIMIT_MAX_POSTER = 300;   // requests per window for /poster (images)
const RATE_LIMIT_MAX_HLS    = 600;   // requests per window for /hls (native players)
const RATE_LIMIT_MAX_SUBTITLE = 120;
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
  // Emergency prune if too many IPs (e.g. botnet attack)
  if (rateBuckets.size > 100000) rateBuckets.clear();
}, RATE_LIMIT_WINDOW_MS * 2).unref();

// Periodic cleanup of stale imagePending entries (stuck requests)
setInterval(() => {
  for (const [key, promise] of imagePending) {
    // If a pending entry exists but the controller already timed out, clean it
    // We detect staleness by checking if the imageCache already has this entry
    if (imageCache.has(key)) imagePending.delete(key);
  }
}, 120_000).unref();

const PORT = Number(process.env.PORT || 7000);
const LOCAL_MODE = process.env.LOCAL_MODE == null
  ? process.env.NODE_ENV !== "production" && !process.env.RENDER
  : process.env.LOCAL_MODE === "1" || process.env.LOCAL_MODE === "true";
// Proxy media by default. Native Stremio players and Nuvio do not all forward
// Referer/User-Agent headers consistently for direct URLs; keeping the media
// request server-side makes HLS, MP4 and segmented sources behave uniformly.
// Set HLS_PROXY=0 only for an explicitly direct-stream deployment.
const USE_LOCAL_HLS_PROXY = process.env.HLS_PROXY !== "0" && process.env.HLS_PROXY !== "false";
const BIND_HOST = process.env.BIND_HOST || "0.0.0.0";

// ── Public base URL (resolved from first request, cached) ────────────────────
let PUBLIC_BASE_URL = LOCAL_MODE
  ? getLocalBaseUrl(PORT)
  : (() => { const raw = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, ""); return raw && !raw.startsWith("http") ? `https://${raw}` : raw; })();
let publicBaseUrlResolved = !!PUBLIC_BASE_URL;
function resolvePublicBaseUrl(req) {
  if (publicBaseUrlResolved) return;
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.hostname;
  PUBLIC_BASE_URL = `${proto}://${host}`;
  publicBaseUrlResolved = true;
  console.error(`[init] base url configured`);
}
const _rawBaseUrl = String(process.env.BASE_URL || "https://jav.guru").trim();
const SOURCE_URL = new URL(_rawBaseUrl.startsWith("http") ? _rawBaseUrl : `https://${_rawBaseUrl}`);
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

  "fmtu.sl2025p.com",
  "goodav17.com",
  "avjoy.me",
  "javmenu.com",
  "javquick.com",

  "hohoj.tv",
  "ie2.javquick.com",

  "c0.jdbstatic.com",
  "tukaka.space",
  "2608.xbpi2608.top",
  "media-cdn2.avjoy.me",
  "images.projectjav.com",
  "v1.rdse.lol",

  // Additional CDN hosts from sources
  "cdn.javgg.com",
  "cdn.javcdn.cc",
  "img.javbangers.com",
  "img.cdnjav.com",
  "pics.javblob.com",
  "images.javhub.net",
  "thumbs.javlibrary.com",
  "pics.dmm.co.jp",
  "flvcdn.javguru.com",
  "cdnst.avmods.net",
  "img.avseudonima.com",
  "images.cdnjav.com",
  "pics.javmost.com",
  "cdn.statically.io",
  "images.weserv.nl",
]);
const IMAGE_TIMEOUT_MS = Number(process.env.IMAGE_TIMEOUT_MS || 12000);
const MEDIA_TIMEOUT_MS = Number(process.env.MEDIA_TIMEOUT_MS || 30000);
const UPSTREAM_RETRY_DELAYS_MS = [120, 350];
const UPSTREAM_RETRY_STATUSES = new Set([404, 408, 425, 429, 500, 502, 503, 504, 526]);
const MAX_STREAM_MBPS = Number(process.env.MAX_STREAM_MBPS || 8);
const IMAGE_MAX_BYTES = Number(process.env.IMAGE_MAX_BYTES || 4 * 1024 * 1024);
const IMAGE_CACHE_MAX_ENTRIES = Number(process.env.IMAGE_CACHE_MAX_ENTRIES || 500);
const IMAGE_CACHE_MAX_BYTES = Number(process.env.IMAGE_CACHE_MAX_BYTES || 96 * 1024 * 1024);
const imageCache = new Map();
const imagePending = new Map();
let imageCacheBytes = 0;
const mediaCookies = new Map();
const MEDIA_COOKIES_MAX = 100;
const throttleStates = new Map();
const metrics = { startedAt: Date.now(), mediaRequests: 0, mediaErrors: 0, activeMedia: 0, bytesProxied: 0 };
const MEDIA_HOSTS = /(^|\.)premilkyway\.com$|(^|\.)s1q2105\.com$|(^|\.)cdn-centaurus\.com$|(^|\.)solutiondocumentation\.site$|(^|\.)maxstream\.org$|(^|\.)97bf1\.com$|(^|\.)tnmr\.org$|(^|\.)voe\.sx$|(^|\.)vide0\.net$|(^|\.)lh3\.googleusercontent\.com$|(^|\.)bkcdn\.net$|(^|\.)1024cdn\.sx$|(^|\.)savedvids\.com$|(^|\.)mycloudz\.cc$|(^|\.)avgle\.com$|(^|\.)cloudwish\.xyz$|(^|\.)turbovid\.vip$|(^|\.)dooood\.com$|(^|\.)streambeast\.upn\.one$|(^|\.)acek-cdn\.com$|(^|\.)javplayers\.com$|(^|\.)akmicdn\.com$|(^|\.)streamsuperpro\.com$|(^|\.)professionalshirts\.shop$|(^|\.)platformresources\.site$|(^|\.)strategicplanning\.sbs$|(^|\.)mountainbrookstudios\.store$|(^|\.)auroralearningworld\.store$|(^|\.)blockchainecosystem\.space$|(^|\.)contentpublishing\.site$|(^|\.)trailheadartisancollect\.store$|(^|\.)harbortowncreativeworks\.cyou$|(^|\.)ggjav\.com$|(^|\.)avjoy\.me$|(^|\.)up-cdn\.net$|(^|\.)mediatailor\.us-east-2\.amazonaws\.com$|(^|\.)streamlock\.net$|(^|\.)goldorayanhoje\.shop$|(^|\.)jesuscristosalva\.xyz$|(^|\.)bolsonaromeupastor\.shop$|(^|\.)seraquevaiter\.xyz$|(^|\.)netlify-loveable-goolgeserver-com\.buzz$/i;
const JAV_GENRES = [
  "3P", "Amateur", "Back", "Beautiful Girl", "Big tits", "Blowjob", "Boobs fetish", "Cowgirl",
  "Creampie", "Cuckold", "Deep Throat", "Drama", "Drug", "Egg Vibrator", "Electric Massager",
  "Erotic Wear", "Fantasy", "Female teacher", "Handjob", "Hospital / Clinic", "Idol", "Image video",
  "Incest", "Kiss", "M-girl", "Married", "Massage", "Mature", "Mature Woman", "Mini",
  "Multiple Story", "Naked Apron", "Nasty", "OL", "Older sister", "Orgasm", "Orgy", "Other fetish",
  "POV", "Prostitutes", "School Uniform", "Schoolgirls", "Sex Conversion / Feminized", "Sexy", "Shaved",
  "Slender", "Slut", "Solowork", "Squirting", "Titty fuck", "Toy", "Voyeur", "Voyeurism", "Widow"
];
const JAV_TAGS = ["3P", "Amateur", "Big tits", "Blowjob", "Boobs", "Bondage", "Creampie", "Kiss", "Mature", "Married", "Older sister", "POV", "Schoolgirls", "Slut", "Solowork", "Squirting", "Swimsuit", "Teacher", "Threesome", "Voyeur"];
const catalogExtra = (filter, options) => [
  ...(filter === "search" ? [{ name: "search", isRequired: false }] : []),
  ...(filter === "genre" ? [{ name: "genre", options, isRequired: false }] : []),
  ...(filter === "tag" ? [{ name: "tag", options, isRequired: false }] : []),
  { name: "skip", isRequired: false }
];
const catalogBrowseExtra = [
  { name: "search", isRequired: false },
  { name: "genre", options: JAV_GENRES, isRequired: false },
  { name: "tag", options: JAV_TAGS, isRequired: false },
  { name: "skip", isRequired: false }
];
const manifest = {
  id: LOCAL_MODE ? "com.avmirror.addon.local" : "com.avmirror.addon",
  // Stremio SDK requires valid semver; the human release is 26.1.0.
  version: "26.1.0",
  name: LOCAL_MODE ? "AVMirror Local" : "AVMirror",
  logo: `/logo.png`,
  description: LOCAL_MODE
    ? "AVMirror Local — Jav • Quality • Content."
    : "AVMirror — Jav • Quality • Content.",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "tv"],
  idPrefixes: ["avmirror:", "ijavtorrent:", "projectjav:", "ffjav:", "sukebeinyaa:", "nyaa:", "btdig:", "tokyotosho:", "javdb:", "zeromagnet:", "yourbittorrent:"],
  catalogs: [
    {
      type: "movie",
      id: "avmirror",
      name: "🌐 Recentes",
      extra: catalogBrowseExtra
    },
    {
      type: "movie",
      id: "avmirror-popular",
      name: "🔥 Populares",
      extra: catalogBrowseExtra
    },
    {
      type: "movie",
      id: "avmirror-uncensored",
      name: "🟣 Sem Censura",
      extra: catalogBrowseExtra
    },
    { type: "movie", id: "avmirror-censored", name: "🔵 Censurado", extra: catalogBrowseExtra },
    { type: "movie", id: "avmirror-genres", name: "🏷️ Gêneros", extra: catalogExtra("genre", JAV_GENRES) },
    { type: "movie", id: "avmirror-tags", name: "🔖 Tags", extra: catalogExtra("tag", JAV_TAGS) },
    { type: "movie", id: "avmirror-actresses", name: "👩 Atrizes", extra: catalogExtra("search") },
  ],
  behaviorHints: { adult: true }
};

const builder = new addonBuilder(manifest);

function proxiedMeta(meta) {
  if (!meta) return meta;
  const displayName = String(meta.name || meta.title || "").trim();
  const normalizedMeta = displayName ? { ...meta, name: displayName, title: displayName } : { ...meta };
  const links = Array.isArray(meta.links) ? meta.links : [];
  const supportLink = { name: "🐱 Apoie o AVMirror", category: "other", url: `${PUBLIC_BASE_URL || ""}/install#apoie` };
  const result = { ...normalizedMeta, links: [supportLink, ...links.filter(link => link?.name !== supportLink.name && link?.name !== "Apoie o AVMirror")] };
  const ALLOWED_PREFIXES = ['avmirror', 'ijavtorrent', 'projectjav', 'ffjav', 'sukebeinyaa', 'btdig', 'tokyotosho', 'javdb', 'zeromagnet', 'yourbittorrent'];
  if (meta.id) {
    const match = meta.id.match(/^([^:]+):(.+)$/);
    if (match && ALLOWED_PREFIXES.includes(match[1])) {
      result.id = `${match[1]}:${match[2]}`;
    }
  }
  if (result.poster && result.id) {
    const sourcePrefix = result.id.split(":")[0];
    if (ALLOWED_PREFIXES.includes(sourcePrefix)) {
      result.poster = `${PUBLIC_BASE_URL}/poster/${encodeURIComponent(result.id)}.jpg`;
    }
  }
  if (result.background && result.id) {
    const sourcePrefix = result.id.split(":")[0];
    if (ALLOWED_PREFIXES.includes(sourcePrefix)) {
      result.background = `${PUBLIC_BASE_URL}/poster/${encodeURIComponent(result.id)}.jpg`;
    }
  }
  if (result.logo && result.id) {
    const sourcePrefix = result.id.split(":")[0];
    if (ALLOWED_PREFIXES.includes(sourcePrefix)) {
      result.logo = `${PUBLIC_BASE_URL}/poster/${encodeURIComponent(result.id)}.jpg`;
    }
  }
  return result;
}

function proxyMediaUrl(raw, referer, sessionId) {
  const params = new URLSearchParams({ url: String(raw) });
  if (referer) {
    try { params.set("ref", new URL(referer).href); } catch {}
  }
  if (sessionId) params.set("sid", String(sessionId));
  return `${PUBLIC_BASE_URL}/hls?${params.toString()}`;
}
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
function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const parts = address.split(".").map(Number);
    return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168);
  }
  if (net.isIPv6(address)) {
    if (address === "::1" || /^(?:fc|fd|fe80:)/i.test(address)) return true;
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return false;
}
async function assertSafeMediaUrl(raw) {
  const url = new URL(raw);
  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".internal")) throw new Error("private media host");
  if (net.isIP(url.hostname)) {
    if (isPrivateAddress(url.hostname)) throw new Error("private media address");
    return;
  }
  const addresses = await Promise.race([
    dns.promises.lookup(url.hostname, { all: true }),
    new Promise((_, rej) => setTimeout(() => rej(new Error("DNS lookup timeout")), 5000)),
  ]);
  if (addresses.some(entry => isPrivateAddress(entry.address))) throw new Error("media host resolves to private address");
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
    if (host.endsWith("up-cdn.net") || host.endsWith("streamlock.net") || host.endsWith("mediatailor.us-east-2.amazonaws.com") || host.endsWith("goldorayanhoje.shop") || host.endsWith("jesuscristosalva.xyz") || host.endsWith("bolsonaromeupastor.shop") || host.endsWith("seraquevaiter.xyz") || host.endsWith("netlify-loveable-goolgeserver-com.buzz")) return "https://v1.rdse.lol/";
    return "https://jav.guru/";
  } catch { return "https://jav.guru/"; }
}
async function fetchMediaWithRetry(url, options = {}) {
  let lastError;
  for (let attempt = 0; attempt <= UPSTREAM_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const response = await fetch(url, options);
      if (!UPSTREAM_RETRY_STATUSES.has(response.status) || attempt === UPSTREAM_RETRY_DELAYS_MS.length) return response;
      try { response.body?.cancel?.(); } catch {}
      await new Promise(resolve => setTimeout(resolve, UPSTREAM_RETRY_DELAYS_MS[attempt]));
    } catch (error) {
      lastError = error;
      if (attempt === UPSTREAM_RETRY_DELAYS_MS.length) throw error;
      await new Promise(resolve => setTimeout(resolve, UPSTREAM_RETRY_DELAYS_MS[attempt]));
    }
  }
  throw lastError || new Error("upstream request failed");
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
function throttleStream(stream, sessionId) {
  if (!(MAX_STREAM_MBPS > 0) || !sessionId || !stream) return stream;
  const { Transform } = require("stream");
  // MAX_STREAM_MBPS is megabits/s; the transform operates on bytes.
  const bytesPerSecond = (MAX_STREAM_MBPS * 1_000_000) / 8;
  const throttle = new Transform({
    transform(chunk, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const now = Date.now();
      const state = throttleStates.get(sessionId) || { nextAt: now, lastSeen: now };
      const startAt = Math.max(now, state.nextAt);
      state.nextAt = startAt + (buffer.length / bytesPerSecond) * 1000;
      state.lastSeen = now;
      throttleStates.set(sessionId, state);
      setTimeout(() => callback(null, buffer), startAt - now);
    }
  });
  return stream.pipe(throttle);
}
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [id, state] of throttleStates) if (state.lastSeen < cutoff) throttleStates.delete(id);
}, 60 * 1000).unref();
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
      const referer = stream.behaviorHints?.proxyHeaders?.request?.Referer;
      return { ...stream, url: proxyMediaUrl(stream.url, referer), behaviorHints: { ...stream.behaviorHints, bingeGroup: stream.name || "avmirror" } };
    });
}
function supportStream() {
  return {
    name: "🐱 Apoie o AVMirror",
    title: "Ajude a manter o addon",
    externalUrl: `${PUBLIC_BASE_URL || ""}/configure`
  };
}
function rewritePlaylist(text, sourceUrl, referer, sessionId) {
  const lines = String(text).split(/\r?\n/);
  const output = [];
  let pendingVariantTags = [];
  const rewriteUri = value => {
    try {
      const absoluteUrl = new URL(value, sourceUrl).href;
      // A master playlist may move variants/segments to a second CDN host.
      // It is trusted only because it was emitted by an already trusted
      // stream source and remains restricted to HTTPS by isAllowedMediaUrl.
      trustMediaHost(absoluteUrl);
      return isAllowedMediaUrl(absoluteUrl) ? proxyMediaUrl(absoluteUrl, referer, sessionId) : "";
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

function isImageHostAllowed(hostname) {
  if (IMAGE_HOSTS.has(hostname)) return true;
  for (const h of IMAGE_HOSTS) {
    if (hostname.endsWith("." + h)) return true;
  }
  return false;
}
function isAllowedImageUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !isImageHostAllowed(url.hostname)) return false;
    const h = url.hostname;
    // Primary source (jav.guru) — allow wp-content uploads and image paths
    if (h === SOURCE_URL.hostname || h.endsWith(".jav.guru")) return true;
    if (h.endsWith("1024cdn.sx")) return /\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname) || /\/wp-content\//i.test(url.pathname);
    if (h.endsWith("dmm.co.jp")) return /\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname);
    if (h.endsWith("javmiku.com") || h.endsWith("javsts.com") || h.endsWith("javnorth.com")) return true;
    if (h.endsWith("javphotos.com")) return /\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname) || /\/wp-content\//i.test(url.pathname);
    if (h.endsWith("ggjav.com") || h.endsWith("javgg.com")) return true;
    if (h.endsWith("sl2025p.com")) return /\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname) || /\/wp-content\//i.test(url.pathname);
    if (h.endsWith("goodav17.com")) return true;
    if (h.endsWith("avjoy.me")) return /\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname) || /\/wp-content\//i.test(url.pathname);
    if (h.endsWith("javmenu.com")) return /\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname) || /\/wp-content\//i.test(url.pathname);
    if (h.endsWith("javquick.com")) return true;
    if (h.endsWith("hohoj.tv")) return true;
    if (h.endsWith("jdbstatic.com") || h.endsWith("tukaka.space") || h.endsWith("xbpi2608.top")) return true;
    if (h.endsWith("rdse.lol")) return /\.(?:png|jpg|jpeg|webp)$/i.test(url.pathname);
    // Generic: allow any image-like path for known CDN hosts
    if (isImageHostAllowed(h)) return /\.(?:jpg|jpeg|png|webp|gif)(?:[?#]|$)/i.test(url.pathname + url.search) || /\/wp-content\/uploads\//i.test(url.pathname);
    return false;
  } catch { return false; }
}

function imageCandidates(rawUrl) {
  return [rawUrl];
}
const TRANSPARENT_GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const IMAGE_CONCURRENCY = Number(process.env.IMAGE_CONCURRENCY || 5);
let imageInflight = 0;
const imageWaitQueue = [];
function imageAcquire() {
  if (imageInflight < IMAGE_CONCURRENCY) { imageInflight++; return Promise.resolve(); }
  return new Promise(resolve => imageWaitQueue.push(resolve));
}
function imageRelease() {
  imageInflight--;
  if (imageWaitQueue.length) { imageInflight++; imageWaitQueue.shift()(); }
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
async function fetchImageWithRetry(rawUrl) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await fetchImageCandidate(rawUrl); }
    catch (e) { lastErr = e; if (attempt < 1) await new Promise(r => setTimeout(r, 150)); }
  }
  throw lastErr;
}
async function fetchImage(rawUrl) {
  if (!isAllowedImageUrl(rawUrl)) {
    return { body: TRANSPARENT_GIF, type: "image/gif", expiresAt: Date.now() + 30 * 1000 };
  }
  const cached = imageCache.get(rawUrl);
  if (cached && cached.expiresAt > Date.now()) return cached;
  if (imagePending.has(rawUrl)) return imagePending.get(rawUrl);
  const request = (async () => {
    await imageAcquire();
    try {
      const value = await Promise.any(imageCandidates(rawUrl).map(fetchImageWithRetry));
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
    } catch {
      const placeholder = { body: TRANSPARENT_GIF, type: "image/gif", expiresAt: Date.now() + 30 * 1000 };
      imageCache.set(rawUrl, placeholder);
      imageCacheBytes += placeholder.body.length;
      return placeholder;
    } finally { imagePending.delete(rawUrl); imageRelease(); }
  })();
  imagePending.set(rawUrl, request);
  return request;
}

builder.defineCatalogHandler(async ({ id, extra }) => {
  try {
    const page = Math.floor(Number(extra?.skip || 0) / 20) + 1;
    const sourceId = String(id || "");
    const genre = extra?.genre || "";
    const tag = extra?.tag || "";
    const search = extra?.search || "";

    // Detect text search (not a JAV code) — redirect to actresses catalog
    // This fixes the mobile issue where searching from Recentes/Populares tabs
    // doesn't open the actress filmography
    const isTextSearch = search && !extractCode(search) && /^[a-zA-ZÀ-ÿ\s'-]{2,}$/.test(search.trim());

    let metas;
    try {
      if (sourceId === "avmirror-popular") {
        if (isTextSearch) {
          metas = await unifiedCatalog({ page, search, genre, tag, mode: "avmirror-actors" });
        } else {
          metas = search ? await unifiedCatalog({ page, search, genre, tag, mode: "" }) : await unifiedPopular({ page, search, genre, tag });
        }
      } else if (sourceId === "avmirror-uncensored") {
        if (isTextSearch) {
          metas = await unifiedCatalog({ page, search, genre, tag, mode: "avmirror-actors" });
        } else {
          metas = search ? await unifiedCatalog({ page, search, genre, tag, mode: "" }) : await unifiedUncensored({ page, search, genre, tag });
        }
      } else if (sourceId === "avmirror-censored") {
        if (isTextSearch) {
          metas = await unifiedCatalog({ page, search, genre, tag, mode: "avmirror-actors" });
        } else {
          metas = await unifiedCensored({ page, search, genre, tag });
        }
      } else if (sourceId === "avmirror-actresses") {
        metas = search ? await unifiedCatalog({ page, search, genre, tag, mode: "avmirror-actors" }) : await unifiedCatalog({ page, search, genre, tag, mode: "" });
      } else if (sourceId === "avmirror-genres") {
        metas = await unifiedCatalog({ page, search, genre, tag, mode: "avmirror" });
      } else if (sourceId === "avmirror-tags") {
        metas = await unifiedCatalog({ page, search, genre, tag, mode: "avmirror" });
      } else {
        // avmirror (Recentes) — redirect text searches to actresses
        if (isTextSearch) {
          metas = await unifiedCatalog({ page, search, genre, tag, mode: "avmirror-actors" });
        } else {
          const isSearch = !!search;
          const mode = isSearch || sourceId === "avmirror" ? "" : sourceId;
          metas = await unifiedCatalog({ page, search, genre, tag, mode });
        }
      }
    } catch { metas = []; }

    if (metas?.length) storePosterFromCatalog(metas);

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
    let meta;
    try {
      meta = await unifiedMeta(id);
    } catch { meta = null; }

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
  if (type !== "movie" && type !== "tv") return { streams: [] };
  try {
    const raw = (await unifiedStreams(id)).map(stream => {
      const refs = Array.isArray(stream?.subtitleRefs) ? stream.subtitleRefs : [];
      const { subtitleRefs: _subtitleRefs, ...cleanStream } = stream || {};
      if (!refs.length) return cleanStream;
      const subtitles = refs.filter(ref => ref.source === "subtitlecat" || (/^\d+$/.test(String(ref.subid)) && /^\d+$/.test(String(ref.revid))))
        .map(ref => ref.source === "subtitlecat"
          ? (() => { const encoded = Buffer.from(ref.url).toString("base64url"); return { id: `subtitlecat-${encoded}`, lang: subtitleLanguage(ref.lang), url: `${PUBLIC_BASE_URL}/subtitle/subtitlecat/${encoded}` }; })()
          : ({ id: `avsubtitles-${ref.subid}-${ref.lang}`, lang: subtitleLanguage(ref.lang), url: `${PUBLIC_BASE_URL}/subtitle/avsubtitles/${ref.subid}/${ref.revid}` }));
      return subtitles.length ? { ...cleanStream, subtitles } : cleanStream;
    });
    // Sources rotate CDN hostnames. Trust only hosts actually returned by a
    // scraper before exposing them to the allow-list enforced by /hls.
    raw.forEach(stream => { if (stream?.url && /^https?:\/\//i.test(stream.url)) trustMediaHost(stream.url); });
    const candidates = raw.filter(s => s && (s.url || s.externalUrl) && !s.infoHash).map(s => {
      if (!s.url || s.externalUrl) return s;
      const existingProxyHeaders = s.behaviorHints?.proxyHeaders || {};
      const existingRequestHeaders = existingProxyHeaders.request || existingProxyHeaders.headers || {};
      const referer = existingRequestHeaders.Referer || sourceReferer(s.url);
      const sessionId = crypto.createHash("sha1").update(`${s.url}|${referer}`).digest("hex").slice(0, 24);
      const finalUrl = USE_LOCAL_HLS_PROXY ? proxyMediaUrl(s.url, referer, sessionId) : s.url;
      return {
        ...s,
        url: finalUrl,
        behaviorHints: {
          ...s.behaviorHints,
          notWebReady: false,
          bingeGroup: s.behaviorHints?.bingeGroup || "avmirror",
          ...(!USE_LOCAL_HLS_PROXY ? {
            proxyHeaders: {
              ...existingProxyHeaders,
              request: {
                ...existingRequestHeaders,
                "User-Agent": existingRequestHeaders["User-Agent"] || UA,
                Referer: referer,
                Origin: existingRequestHeaders.Origin || new URL(referer).origin
              }
            }
          } : {})
        }
      };
    });

    // Torrent streams are direct P2P: Stremio's built-in torrent engine
    // connects to peers. Never turn them into an HTTP/server URL.
    const torrentCandidates = raw.filter(s => s && s.infoHash && !s.url && !s.externalUrl).map(s => {
      const { trackers: _legacyTrackers, ...directTorrent } = s;
      // Stremio's stream protocol requires the `tracker:` prefix. It tells
      // the client to add the value as a magnet `tr=` parameter; it is not
      // part of the tracker URL itself. Normalize raw and prefixed values so
      // every torrent source reaches the client in the accepted shape.
      const cleanSources = Array.isArray(directTorrent.sources)
        ? directTorrent.sources
          .map(src => String(src || "").replace(/^tracker:/i, ""))
          .filter(src => /^dht:[a-f0-9]{40}$/i.test(src) || /^(?:udp|http|https|wss):\/\//i.test(src))
          .map(src => /^dht:/i.test(src) ? src.toLowerCase() : `tracker:${src}`)
        : directTorrent.sources;
      return {
        ...directTorrent,
        sources: cleanSources,
        // Some Stremio clients (older desktop/Linux builds) look for the
        // `trackers` field instead of `sources` to init the P2P engine.
        // Include both to ensure universal compatibility.
        trackers: cleanSources,
        name: "⚡ Torrent",
        title: s.title || "Torrent • Auto",
        // Do not guess a file index: many torrents contain only one video,
        // while others put NFO/TXT files in different positions. An incorrect
        // hard-coded index makes Stremio connect to peers but download 0 MB.
        ...(Number.isInteger(s.fileIdx) ? { fileIdx: s.fileIdx } : {}),
        behaviorHints: {
          ...s.behaviorHints,
          // `notWebReady` only describes HTTP URLs. A torrent stream is
          // resolved by Stremio's native P2P engine from infoHash + sources;
          // leaving this flag true makes some clients hide or refuse Play.
          notWebReady: false,
          bingeGroup: s.behaviorHints?.bingeGroup || "avmirror-torrent",
        }
      };
    });

    const allCandidates = [...candidates, ...torrentCandidates];

    return {
      streams: [...allCandidates, supportStream()],
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
app.set("trust proxy", true);

// Resolve PUBLIC_BASE_URL from the first incoming request (Render proxy headers)
app.use((req, _res, next) => { resolvePublicBaseUrl(req); next(); });

// Health and installation UI must be registered before the Stremio router.
app.get("/health", (req, res) => {
  resolvePublicBaseUrl(req);
  res.status(200).json({
    ok: true,
    name: "AVMirror",
    version: manifest.version,
    release: "26.1.0",
    uptimeSeconds: Math.floor((Date.now() - metrics.startedAt) / 1000),
    activeMedia: metrics.activeMedia,
    mediaRequests: metrics.mediaRequests,
    mediaErrors: metrics.mediaErrors,
    bytesProxied: metrics.bytesProxied,
    maxStreamMbps: MAX_STREAM_MBPS,
    hlsProxy: USE_LOCAL_HLS_PROXY,
    scrapers: getSourceMetrics(),
    sourceScores: getSourceScores(),
    background: getBackgroundStats(),
    torrent: { mode: "direct-p2p", serverDownload: false },
    proxy: getProxyStats(),
  });
});

const subtitleCache = new Map();
const STREMIO_LANGUAGES = {
  en: "eng", es: "spa", pt: "por", "pt-br": "por", fr: "fra", de: "deu", it: "ita",
  ja: "jpn", ko: "kor", zh: "zho", ru: "rus", nl: "nld", pl: "pol", tr: "tur"
};
function subtitleLanguage(value) {
  const normalized = String(value || "").toLowerCase().replace(/_/g, "-");
  return STREMIO_LANGUAGES[normalized] || normalized.slice(0, 3) || "und";
}
function srtToVtt(text) {
  const value = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (/^\s*WEBVTT\b/i.test(value)) return value;
  return `WEBVTT\n\n${value.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")}`;
}
async function fetchAvSubtitle(subid, revid) {
  const key = `${subid}:${revid}`;
  const cached = subtitleCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.body;
  const gateUrl = `https://www.avsubtitles.com/download_page.php?subid=${subid}&revid=${revid}`;
  const downloadUrl = `https://www.avsubtitles.com/download_sub.php?subid=${subid}&revid=${revid}`;
  let body;
  let lastError;
  for (let attempt = 0; attempt < 2 && !body; attempt++) {
    try {
      const gate = await fetch(gateUrl, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" }, signal: AbortSignal.timeout(10000) });
      if (!gate.ok) throw new Error(`subtitle gate HTTP ${gate.status}`);
      const cookies = gate.headers.getSetCookie?.() || [gate.headers.get("set-cookie") || ""];
      const cookie = cookies.map(value => value.split(";", 1)[0]).filter(Boolean).join("; ");
      await gate.text();
      const response = await fetch(downloadUrl, {
        headers: { "user-agent": UA, accept: "application/zip,application/octet-stream,*/*", referer: gateUrl, ...(cookie ? { cookie } : {}) },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`subtitle download HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      if (contentType.includes("zip") || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
        const files = unzipSync(bytes);
        const name = Object.keys(files).find(file => /\.(?:srt|vtt)$/i.test(file));
        if (!name) throw new Error("subtitle archive has no SRT/VTT file");
        body = Buffer.from(srtToVtt(Buffer.from(files[name]).toString("utf8")), "utf8");
      } else {
        const text = Buffer.from(bytes).toString("utf8");
        if (!/^\s*(?:WEBVTT|\d+\s*\r?\n\s*\d{2}:\d{2}:\d{2}[,.]\d{3})/i.test(text)) throw new Error("subtitle response is not SRT/VTT");
        body = Buffer.from(srtToVtt(text), "utf8");
      }
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  if (!body) throw lastError || new Error("subtitle unavailable");
  const value = { body, expiresAt: Date.now() + 6 * 60 * 60 * 1000 };
  subtitleCache.set(key, value);
  while (subtitleCache.size > 200) subtitleCache.delete(subtitleCache.keys().next().value);
  return body;
}
app.get("/subtitle/avsubtitles/:subid/:revid", rateLimit(RATE_LIMIT_MAX_SUBTITLE), async (req, res) => {
  const { subid, revid } = req.params;
  if (!/^\d+$/.test(subid) || !/^\d+$/.test(revid)) return res.status(400).send("invalid subtitle reference");
  try {
    const body = await fetchAvSubtitle(subid, revid);
    res.set({ "Content-Type": "text/vtt; charset=utf-8", "Content-Disposition": "inline", "Cache-Control": "public, max-age=21600", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS", "X-Content-Type-Options": "nosniff" });
    return res.send(body);
  } catch (error) {
    console.error("subtitle:", error.message);
    return res.status(502).send("subtitle unavailable");
  }
});
app.get("/subtitle/subtitlecat/:encoded", rateLimit(RATE_LIMIT_MAX_SUBTITLE), async (req, res) => {
  try {
    const url = Buffer.from(String(req.params.encoded), "base64url").toString("utf8");
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !/(?:^|\.)subtitlecat\.com$/i.test(parsed.hostname) || !/\.srt$/i.test(parsed.pathname)) {
      return res.status(400).send("invalid SubtitleCat reference");
    }
    const cacheKey = `subtitlecat:${url}`;
    const cached = subtitleCache.get(cacheKey);
    let body = cached?.expiresAt > Date.now() ? cached.body : null;
    if (!body) {
      const response = await fetch(url, { headers: { "user-agent": UA, accept: "text/plain,text/srt,*/*", referer: "https://www.subtitlecat.com/" }, signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error(`SubtitleCat download HTTP ${response.status}`);
      body = Buffer.from(srtToVtt(await response.text()), "utf8");
      subtitleCache.set(cacheKey, { body, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
    }
    res.set({ "Content-Type": "text/vtt; charset=utf-8", "Content-Disposition": "inline", "Cache-Control": "public, max-age=21600", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS", "X-Content-Type-Options": "nosniff" });
    return res.send(body);
  } catch (error) {
    console.error("subtitlecat:", error.message);
    return res.status(502).send("subtitle unavailable");
  }
});
app.get("/api/local-info", (req, res) => {
  const isLocal = LOCAL_MODE && (!req.hostname || req.hostname === "localhost" || req.hostname === "127.0.0.1");
  const host = isLocal ? getLocalIPv4() : req.hostname;
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const externalPort = req.headers["x-forwarded-port"] || PORT;
  const isStandardPort = (proto === "https" && externalPort == 443) || (proto === "http" && externalPort == 80);
  const base = `${proto}://${host}${isStandardPort ? "" : ":" + externalPort}`;
  res.json({ host, port: PORT, baseUrl: base, manifestUrl: `${base}/manifest.json`, stremioUrl: `stremio://${host}${isStandardPort ? "" : ":" + externalPort}/manifest.json`, localMode: LOCAL_MODE, directStreams: !USE_LOCAL_HLS_PROXY, hlsProxy: USE_LOCAL_HLS_PROXY });
});
app.get("/api/proxy-test", async (_req, res) => {
  const result = await testProxy();
  res.json({ ...result, proxy: getProxyStats() });
});
app.get("/install", (_req, res) => res.sendFile(path.join(__dirname, "public", "install.html")));
const staticAssetOptions = { maxAge: "7d", immutable: true };
app.get("/stremio-addons-installed.webp", (_req, res) => res.sendFile(path.join(__dirname, "public", "stremio-addons-installed.webp"), staticAssetOptions));
app.get("/stremio-avmirror-catalog.webp", (_req, res) => res.sendFile(path.join(__dirname, "public", "stremio-avmirror-catalog.webp"), staticAssetOptions));
app.get("/logo.png", (_req, res) => {
  res.set("Cache-Control", "public, max-age=86400");
  res.sendFile(path.join(__dirname, "public", "logo.png"));
});
function escapeSvgText(value) {
  return String(value || "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char]));
}
app.get("/title-logo/:id.svg", rateLimit(RATE_LIMIT_MAX_POSTER), async (req, res) => {
  try {
    const id = decodeURIComponent(String(req.params.id || ""));
    const meta = await unifiedMeta(id);
    const title = String(meta?.name || "AVMirror").replace(/^\[[^\]]+\]\s*/, "").trim();
    const code = title.match(/\b[A-Z]{2,8}[-_ ]?\d{2,6}\b/i)?.[0] || "AVMirror";
    const shortTitle = title.length > 58 ? `${title.slice(0, 55)}…` : title;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="420" viewBox="0 0 1200 420"><defs><linearGradient id="bg" x1="0" x2="1"><stop stop-color="#171329"/><stop offset="1" stop-color="#4b1d61"/></linearGradient></defs><rect width="1200" height="420" rx="28" fill="url(#bg)"/><circle cx="1030" cy="90" r="180" fill="#ff4d9d" opacity=".18"/><text x="70" y="145" fill="#ff8bc5" font-family="Arial,sans-serif" font-size="42" font-weight="700">${escapeSvgText(code)}</text><text x="70" y="235" fill="white" font-family="Arial,sans-serif" font-size="38" font-weight="700">${escapeSvgText(shortTitle)}</text><text x="70" y="330" fill="#d8b9e8" font-family="Arial,sans-serif" font-size="24">AVMirror</text></svg>`;
    res.set("Content-Type", "image/svg+xml; charset=utf-8");
    res.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    res.set("X-Content-Type-Options", "nosniff");
    return res.send(svg);
  } catch (e) {
    console.error("title logo:", e.message);
    return res.status(404).send("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1\" height=\"1\"></svg>");
  }
});
app.get("/poster/:id.jpg", rateLimit(RATE_LIMIT_MAX_POSTER), async (req, res) => {
  try {
    const id = decodeURIComponent(String(req.params.id || ""));
    const cachedPoster = readPosterCache(id);
    let poster = cachedPoster;
    if (!poster) {
      const prefix = String(id || "").split(":")[0];
      const source = SOURCES.find(s => s.prefix === prefix);
      // Run source.meta and unifiedMeta in parallel for faster resolution
      const [sourcePoster, unifiedPoster] = await Promise.all([
        (async () => {
          if (!source) return null;
          try {
            const meta = await Promise.race([source.meta(id), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 10000))]);
            return meta?.poster || null;
          } catch { return null; }
        })(),
        (async () => {
          try {
            const meta = await Promise.race([unifiedMeta(id), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 10000))]);
            return meta?.poster || null;
          } catch { return null; }
        })(),
      ]);
      poster = sourcePoster || unifiedPoster;
      // Last resort: try extracting poster from the source catalog
      if (!poster && source) {
        try {
          const catalogItems = await source.catalog({ search: "", page: 1 });
          const match = catalogItems.find(item => item.id === id && item.poster);
          if (match?.poster) poster = match.poster;
        } catch {}
      }
    }
    const image = poster ? await fetchImage(poster) : { body: TRANSPARENT_GIF, type: "image/gif" };
    res.set("Content-Type", image.type);
    res.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    res.set("Access-Control-Allow-Origin", "*");
    res.set("X-Content-Type-Options", "nosniff");
    return res.send(image.body);
  } catch (e) {
    console.error("poster proxy:", e.message);
    return res.status(404).send(TRANSPARENT_GIF);
  }
});
app.options("/image", (_req, res) => res.status(204)
  .set("Access-Control-Allow-Origin", "*")
  .set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
  .set("Access-Control-Allow-Headers", "Range, Content-Type")
  .end());
app.get("/image", rateLimit(RATE_LIMIT_MAX_POSTER), async (req, res) => {
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
// HLS proxy is available in both local and remote modes.
app.options("/hls", (_req, res) => res.status(204)
  .set("Access-Control-Allow-Origin", "*")
  .set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
  .set("Access-Control-Allow-Headers", "Range, Content-Type")
  .set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges")
  .end());
app.all("/hls", rateLimit(RATE_LIMIT_MAX_HLS), async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).set("Allow", "GET, HEAD, OPTIONS").end();
  let rawUrl = String(req.query.url || "");
  metrics.mediaRequests++;
  metrics.activeMedia++;
  let mediaReleased = false;
  const releaseMedia = () => {
    if (mediaReleased) return;
    mediaReleased = true;
    metrics.activeMedia = Math.max(0, metrics.activeMedia - 1);
  };
  res.once("close", releaseMedia);
  res.once("finish", releaseMedia);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MEDIA_TIMEOUT_MS);
  try {
    if (!isAllowedMediaUrl(rawUrl)) {
      let rejectedHost = "invalid-url";
      try { rejectedHost = new URL(rawUrl).hostname; } catch {}
      throw new Error(`media host is not allowed: ${rejectedHost}`);
    }
    await assertSafeMediaUrl(rawUrl);
    const host = new URL(rawUrl).hostname.toLowerCase();
    const luluCode = host.endsWith("tnmr.org") ? rawUrl.match(/\/([^/]+)_h\/master\.m3u8/i)?.[1] : null;
    const sessionId = String(req.query.sid || "").replace(/[^a-f0-9]/gi, "").slice(0, 64);
    let referer = sourceReferer(rawUrl);
    try {
      const requestedReferer = new URL(String(req.query.ref || ""));
      if (requestedReferer.protocol === "http:" || requestedReferer.protocol === "https:") referer = requestedReferer.href;
    } catch {}
    const requestHeaders = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36", referer, origin: new URL(referer).origin, accept: "*/*" };
    if (req.headers.range) requestHeaders.range = req.headers.range;
    if (mediaCookies.get(host)) requestHeaders.cookie = mediaCookies.get(host);
    let response = await fetchMediaWithRetry(rawUrl, { headers: requestHeaders, signal: controller.signal });
    rememberMediaCookies(response, host);
    // LuluStream may require a short-lived cookie from the embed page.
    if (!response.ok && host.endsWith("tnmr.org") && luluCode) {
      clearTimeout(timer);
      const embed = await fetchMediaWithRetry(`https://streamhihi.com/e/${luluCode}`, { headers: { "user-agent": requestHeaders["user-agent"], referer: "https://jav.guru/", accept: "text/html,*/*" } });
      const cookies = typeof embed.headers.getSetCookie === "function" ? embed.headers.getSetCookie() : [];
      if (cookies.length) {
        requestHeaders.cookie = cookies.map(x => x.split(";", 1)[0]).join("; ");
        const controller2 = new AbortController();
        const timer2 = setTimeout(() => controller2.abort(), MEDIA_TIMEOUT_MS);
        try {
          response = await fetchMediaWithRetry(rawUrl, { headers: requestHeaders, signal: controller2.signal });
        } finally { clearTimeout(timer2); }
      }
    }
    if (!response.ok) throw new Error(`media HTTP ${response.status}`);
    // Protect connection establishment without aborting long MP4 downloads.
    clearTimeout(timer);
    const type = String(response.headers.get("content-type") || "").toLowerCase();
    if (/\.m3u8(?:[?#]|$)|master\.txt(?:[?#]|$)|__index\.txt(?:[?#]|$)|\/cdn\/hls\//i.test(rawUrl) || type.includes("mpegurl") || (type.includes("text/plain") && /\/m3\//i.test(rawUrl))) {
      const playlist = await response.text();
      if (!/^\s*#EXTM3U/m.test(playlist)) throw new Error("invalid HLS playlist");
      if (/(?:tiktokcdn\.com|ad-site|\.image(?:[/?#]|$))/i.test(playlist)) throw new Error("advertising HLS playlist");
      res.set("Content-Type", "application/vnd.apple.mpegurl");
      res.set("Cache-Control", "no-store");
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Access-Control-Allow-Headers", "Range, Content-Type");
      res.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
      if (req.method === "HEAD") return res.end();
      return res.send(rewritePlaylist(playlist, rawUrl, referer, sessionId));
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
    if (response.body && typeof response.body.pipe === "function") {
      const length = Number(response.headers.get("content-length") || 0);
      if (length > 0) metrics.bytesProxied += length;
      return throttleStream(response.body, sessionId).pipe(res);
    }
    const { Readable } = require("stream");
    if (response.body && typeof response.body.getReader === "function") {
      return throttleStream(Readable.fromWeb(response.body), sessionId).pipe(res);
    }
    return res.send(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    metrics.mediaErrors++;
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
  const labels = l === 'en' ? {
    "avmirror": "🌐 Recent", "avmirror-popular": "🔥 Popular", "avmirror-uncensored": "🟣 Uncensored",
    "avmirror-censored": "🔵 Censored", "avmirror-genres": "🏷️ Genres", "avmirror-tags": "🔖 Tags", "avmirror-actresses": "👩 Actresses"
  } : {
    "avmirror": "🌐 Recentes", "avmirror-popular": "🔥 Populares", "avmirror-uncensored": "🟣 Sem Censura",
    "avmirror-censored": "🔵 Censurado", "avmirror-genres": "🏷️ Gêneros", "avmirror-tags": "🔖 Tags", "avmirror-actresses": "👩 Atrizes"
  };
  return {
    ...manifest,
    logo: `${PUBLIC_BASE_URL || ""}/logo.png?v=${encodeURIComponent(manifest.version)}`,
    name: LOCAL_MODE ? t(l, 'addon.name') : t(l, 'addon.namePublic'),
    description: LOCAL_MODE ? t(l, 'addon.descriptionLocal') : t(l, 'addon.descriptionPublic'),
    catalogs: manifest.catalogs.map(catalog => ({ ...catalog, name: labels[catalog.id] || catalog.name }))
  };
}

// Override /manifest.json with dynamic language support
app.get('/manifest.json', (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  const lang = getLang(req);
  res.json(buildManifest(lang));
});

app.get("/configure", (_req, res) => res.sendFile(path.join(__dirname, "public", "configure.html")));

// Official SDK exposes the addon protocol as an Express-compatible router.
// This makes /catalog/... /meta/... and /stream/... available.
app.use("/", rateLimit(RATE_LIMIT_MAX_GLOBAL), getRouter(builder.getInterface()));

const server = app.listen(PORT, BIND_HOST, () => {
  console.log(`[init] listening on :${PORT}`);
  startBackground();
  setInterval(() => { try { cleanupRegistry(); } catch {} }, 60_000).unref();
});

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("unhandledRejection", (reason) => console.error("unhandled rejection:", reason));
process.on("uncaughtException", (err) => { console.error("uncaught exception:", err); process.exit(1); });
