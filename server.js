const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const { scrapeCatalog, scrapeMeta, scrapeStreams, closeBrowser } = require("./scraper");
const { scrapeJavRiderCatalog, scrapeJavRiderMeta, scrapeJavRiderStreams, closeJavRiderBrowser, JAVRIDER_GENRES } = require("./javrider");
const { scrapeAv01Catalog, scrapeAv01Meta, scrapeAv01Streams, AV01_GENRES } = require("./av01");
const express = require("express");
const path = require("path");

const PORT = Number(process.env.PORT || 7000);
const RENDER_HOST = process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : "";
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || RENDER_HOST || "https://avmirror.onrender.com").replace(/\/+$/, "");
const SOURCE_URL = new URL(process.env.BASE_URL || "https://jav.guru");
const IMAGE_HOSTS = new Set([
  SOURCE_URL.hostname,
  "cdn.javmiku.com",
  "cdn.javsts.com",
  "cdn.javnorth.com",
  "static.av01.tv",
  "static2.av01.tv",
  "img1.iw01.xyz",
  "pics.pornfhd.com",
  "javrider.com"
]);
const IMAGE_TIMEOUT_MS = Number(process.env.IMAGE_TIMEOUT_MS || 12000);
const IMAGE_MAX_BYTES = Number(process.env.IMAGE_MAX_BYTES || 4 * 1024 * 1024);
const IMAGE_CACHE_MAX_ENTRIES = Number(process.env.IMAGE_CACHE_MAX_ENTRIES || 120);
const IMAGE_CACHE_MAX_BYTES = Number(process.env.IMAGE_CACHE_MAX_BYTES || 48 * 1024 * 1024);
const imageCache = new Map();
const imagePending = new Map();
let imageCacheBytes = 0;
const MEDIA_HOSTS = /(^|\.)premilkyway\.com$|(^|\.)solutiondocumentation\.site$|(^|\.)maxstream\.org$|(^|\.)turboviplay\.com$|(^|\.)turbosplayer\.com$|(^|\.)97bf1\.com$|(^|\.)tnmr\.org$|(^|\.)voe\.sx$|(^|\.)vide0\.net$|(^|\.)lh3\.googleusercontent\.com$|(^|\.)www\.av01\.media$|(^|\.)customers\.iw01\.xyz$|(^|\.)bkcdn\.net$|(^|\.)1024cdn\.sx$|(^|\.)savedvids\.com$|(^|\.)mycloudz\.cc$|(^|\.)avgle\.com$|(^|\.)cloudwish\.xyz$|(^|\.)turbovid\.vip$|(^|\.)dooood\.com$|(^|\.)streambeast\.upn\.one$|(^|\.)acek-cdn\.com$|(^|\.)javplayers\.com$|(^|\.)akmicdn\.com$/i;
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
  id: "com.avmirror.addon",
  version: "26.1.0",
  name: "AVMirror",
  logo: `${PUBLIC_BASE_URL}/logo.png`,
  description: "Assistir JAV no Stremio e Nuvio — catálogo e reprodução de conteúdo autorizado.",
  resources: ["catalog", "meta", "stream"],
  types: ["movie"],
  idPrefixes: ["avmirror:", "av01:", "javrider:"],
  catalogs: [
    ["avmirror", "AVMirror — Jav.guru — Novos"],
    ["avmirror-popular", "AVMirror — Jav.guru — Populares"],
    ["avmirror-actors", "AVMirror — Jav.guru — Por atriz"],
    ["av01", "AVMirror — AV01 — Novos"],
    ["av01-popular", "AVMirror — AV01 — Populares"],
    ["javrider", "AVMirror — JavRider — Novos"],
    ["javrider-popular", "AVMirror — JavRider — Populares"]
  ].map(([id, name]) => ({
    type: "movie",
    id,
    name,
    extra: [
      { name: "search", isRequired: false },
      ...(id.startsWith("avmirror") ? [{ name: "genre", options: JAV_GENRES, isRequired: false }] : []),
      ...(id.startsWith("av01") ? [{ name: "genre", options: AV01_GENRES, isRequired: false }] : []),
      ...(id.startsWith("javrider") ? [{ name: "genre", options: JAVRIDER_GENRES, isRequired: false }] : []),
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

function proxyMediaUrl(raw) { return `${PUBLIC_BASE_URL}/hls?url=${encodeURIComponent(raw)}`; }
function isAllowedMediaUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || !MEDIA_HOSTS.test(u.hostname)) return false;
    if (u.hostname === "www.av01.media") {
      return /^\/api\/v1\/videos\/\d+\/manifest\//i.test(u.pathname) && u.searchParams.has("access_token");
    }
    if (u.hostname === "customers.iw01.xyz") {
      return /^\/fmp4\//i.test(u.pathname) && u.searchParams.has("access_token");
    }
    if (u.hostname === "javplayers.com") {
      return /^\/(?:cdn\/hls|m3)\//i.test(u.pathname);
    }
    if (u.hostname.endsWith(".akmicdn.com")) {
      return /^\/cdn\/down\//i.test(u.pathname) || /\.(?:m3u8|mp4|m4v|webm|m4s|ts)(?:[?#]|$)/i.test(u.pathname + u.search);
    }
    if (/(?:^|\.)(?:bkcdn\.net|1024cdn\.sx|savedvids\.com|mycloudz\.cc|avgle\.com|stream\.javhdz\.today|cloudwish\.xyz|turbovid\.vip|dooood\.com|streambeast\.upn\.one|acek-cdn\.com)$/i.test(u.hostname)) return /\.(?:mp4|m3u8)(?:[?#]|$)/i.test(u.pathname + u.search);
    return true;
  } catch { return false; }
}
async function refreshAv01Manifest(raw) {
  try {
    const target = new URL(raw);
    const videoId = target.pathname.match(/\/api\/v1\/videos\/(\d+)\/manifest\//i)?.[1];
    if (!videoId || target.hostname !== "www.av01.media") return null;
    const geoResponse = await fetch("https://files.iw01.xyz/edge/geo.js?json", { headers: { "user-agent": "Mozilla/5.0", accept: "application/json" } });
    if (!geoResponse.ok) return null;
    const geo = await geoResponse.json();
    const params = new URLSearchParams({ token_v2: geo.token_v2, expires: geo.expires, ip: geo.ip });
    const accessResponse = await fetch(`https://www.av01.media/api/v1/videos/${videoId}/cdn-access?${params}`, { headers: { "user-agent": "Mozilla/5.0", referer: "https://www.av01.media/", accept: "application/json" } });
    if (!accessResponse.ok) return null;
    const access = await accessResponse.json();
    if (!access?.access_token) return null;
    target.searchParams.set("access_token", access.access_token);
    return target.href;
  } catch { return null; }
}
function withAv01AccessToken(raw, sourceUrl) {
  try {
    const target = new URL(raw);
    const source = new URL(sourceUrl);
    const token = source.hostname === "www.av01.media" ? source.searchParams.get("access_token") : null;
    if (token && (target.hostname === "www.av01.media" || target.hostname === "customers.iw01.xyz")) {
      target.searchParams.set("access_token", token);
    }
    return target.href;
  } catch { return raw; }
}
function proxiedStreams(streams) {
  return streams
    .filter(stream => stream && (stream.url || stream.externalUrl))
    .map(stream => stream.url && !stream.externalUrl
      ? { ...stream, url: isAllowedMediaUrl(stream.url) ? proxyMediaUrl(stream.url) : stream.url }
      : stream);
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
      const absoluteUrl = withAv01AccessToken(new URL(value, sourceUrl).href, sourceUrl);
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
    const wordpressImage = /\/wp-content\/uploads\//i.test(url.pathname);
    const av01Image = /^(?:static2?\.av01\.tv|img1\.iw01\.xyz)$/i.test(url.hostname)
      && /^\/media\/videos\/tmb\/\d+\/1\.jpg\/format=(?:jpeg|webp)\/wlv=(?:320|480|800)$/i.test(url.pathname)
      && url.searchParams.has("access_token");
    const bestJavImage = url.hostname === "pics.pornfhd.com" && /\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname);
    return url.protocol === "https:" && IMAGE_HOSTS.has(url.hostname) && (wordpressImage || av01Image || bestJavImage);
  } catch { return false; }
}

function imageCandidates(rawUrl) {
  const parsed = new URL(rawUrl);
  if (!/(?:static2?\.av01\.tv|img1\.iw01\.xyz)$/i.test(parsed.hostname)) return [rawUrl];
  return ["static.av01.tv", "static2.av01.tv", "img1.iw01.xyz"].map(host => {
    const copy = new URL(parsed.href);
    copy.hostname = host;
    return copy.href;
  });
}
async function fetchImageCandidate(rawUrl) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), IMAGE_TIMEOUT_MS);
  try {
    const imageHost = new URL(rawUrl).hostname;
    const response = await fetch(rawUrl, {
      signal: ac.signal,
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0",
        accept: "image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8",
        ...(/(?:\.av01\.tv|\.iw01\.xyz)$/i.test(imageHost) ? { referer: "https://www.av01.media/" } : {}),
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
    const isAv01 = sourceId.startsWith("av01");
    const isJavRider = sourceId.startsWith("javrider");
    const metas = isAv01
      ? await scrapeAv01Catalog({ page, search: extra?.search || "", genre: extra?.genre || "", mode: sourceId || "av01" })
      : isJavRider
          ? await scrapeJavRiderCatalog({ page, search: extra?.search || "", genre: extra?.genre || "", mode: sourceId || "javrider" })
          : await scrapeCatalog({ page, search: extra?.search || "", genre: extra?.genre || "", mode: sourceId || "avmirror" });
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
    const value = String(id || "");
    const meta = value.startsWith("av01:") ? await scrapeAv01Meta(id) : value.startsWith("javrider:") ? await scrapeJavRiderMeta(id) : await scrapeMeta(id);
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
      streams: [supportStream(), ...proxiedStreams(String(id || "").startsWith("av01:") ? await scrapeAv01Streams(id) : String(id || "").startsWith("javrider:") ? await scrapeJavRiderStreams(id) : await scrapeStreams(id))],
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
app.options("/hls", (_req, res) => res.status(204)
  .set("Access-Control-Allow-Origin", "*")
  .set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
  .set("Access-Control-Allow-Headers", "Range, Content-Type")
  .set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges")
  .end());
app.get("/hls", async (req, res) => {
  const rawUrl = String(req.query.url || "");
  try {
    if (!isAllowedMediaUrl(rawUrl)) throw new Error("media host is not allowed");
    const host = new URL(rawUrl).hostname.toLowerCase();
    const luluCode = host.endsWith("tnmr.org") ? rawUrl.match(/\/([^/]+)_h\/master\.m3u8/i)?.[1] : null;
    const referer = host.endsWith("javplayers.com") || host.endsWith("akmicdn.com") ? "https://javplayers.com/" : host.endsWith("turboviplay.com") ? "https://turbovidhls.com/" : host.endsWith("97bf1.com") ? "https://vidara.to/" : host.endsWith("tnmr.org") ? `https://streamhihi.com/e/${luluCode || ""}` : host.endsWith("av01.media") || host.endsWith("iw01.xyz") ? "https://www.av01.media/" : host.endsWith("bkcdn.net") || host.endsWith("1024cdn.sx") || host.endsWith("savedvids.com") || host.endsWith("mycloudz.cc") || host.endsWith("avgle.com") || host.endsWith("javhdz.today") || host.endsWith("cloudwish.xyz") || host.endsWith("turbovid.vip") || host.endsWith("dooood.com") || host.endsWith("upn.one") || host.endsWith("acek-cdn.com") ? "https://javhd.name/" : "https://javclan.com/";
    const requestHeaders = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36", referer, origin: new URL(referer).origin, accept: "*/*" };
    if (req.headers.range) requestHeaders.range = req.headers.range;
    let response = await fetch(rawUrl, { headers: requestHeaders });
    if (response.status === 403 && /(?:www\.av01\.media|customers\.iw01\.xyz)$/i.test(host)) {
      const refreshed = await refreshAv01Manifest(rawUrl);
      if (refreshed) {
        rawUrl = refreshed;
        response = await fetch(rawUrl, { headers: requestHeaders });
      }
    }
    // LuluStream may require a short-lived cookie from the embed page.
    if (!response.ok && host.endsWith("tnmr.org") && luluCode) {
      const embed = await fetch(`https://streamhihi.com/e/${luluCode}`, { headers: { "user-agent": requestHeaders["user-agent"], referer: "https://jav.guru/", accept: "text/html,*/*" } });
      const cookies = typeof embed.headers.getSetCookie === "function" ? embed.headers.getSetCookie() : [];
      if (cookies.length) {
        requestHeaders.cookie = cookies.map(x => x.split(";", 1)[0]).join("; ");
        response = await fetch(rawUrl, { headers: requestHeaders });
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
    return res.send(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    console.error("hls proxy:", e.message);
    return res.status(502).json({ error: "media unavailable" });
  }
});
app.get("/", (_req, res) => res.redirect("/install"));

// Official SDK exposes the addon protocol as an Express-compatible router.
// This makes /manifest.json, /catalog/..., /meta/... and /stream/... available.
app.use("/", getRouter(builder.getInterface()));

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`AVMirror listening on 0.0.0.0:${PORT}`);
});

const shutdown = async () => {
  try { await closeBrowser(); }
  finally {
    await closeJavRiderBrowser();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  }
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
