const { UA, maskError, stripTags, decodeHtmlEntities } = require("../lib/scraper-utils");
const BASE = "https://hohoj.tv";
const { resolveDirectMediaUrl, directBehaviorHints } = require("../lib/direct-stream");

function makeId(videoId) { return `hohoj:${videoId}`; }
function extractVideoId(id) { return String(id || "").replace(/^hohoj:/, ""); }

async function fetchHtml(url, referer) {
  const headers = { "User-Agent": UA, accept: "text/html,*/*" };
  if (referer) headers.referer = referer;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 12000);
  try {
    const r = await fetch(url, { headers, redirect: "follow", signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

function parseCatalogItems(html) {
  const items = [];
  const seen = new Set();
  const re = /video\?id=(\d+)[\s\S]*?src="(https:\/\/cdn[^"]+)"[\s\S]*?video-item-title[^>]*>([^<]+)/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const videoId = m[1];
    if (seen.has(videoId)) continue;
    seen.add(videoId);
    const poster = m[2] || "";
    const name = decodeHtmlEntities(stripTags(m[3]));
    items.push({ id: makeId(videoId), type: "movie", name: name || videoId, poster });
  }
  return items;
}

async function scrapeHohojCatalog({ page = 1, search = "", genre = "", mode = "" } = {}) {
  try {
    let url;
    if (search) {
      url = `${BASE}/lang_en/search?text=${encodeURIComponent(search)}&p=${page}`;
    } else if (genre) {
      url = `${BASE}/lang_en/search?text=${encodeURIComponent(genre)}&p=${page}`;
    } else if (mode === "hohoj-popular") {
      url = `${BASE}/lang_en/search?type=censored&order=popular&p=${page}`;
    } else {
      url = `${BASE}/lang_en/search?type=censored&order=latest&p=${page}`;
    }
    const html = await fetchHtml(url, `${BASE}/lang_en/`);
    return parseCatalogItems(html);
  } catch (e) {
    console.error("catalog fetch error:", maskError(e.message));
    return [];
  }
}

async function scrapeHohojMeta(id) {
  const videoId = extractVideoId(id);
  if (!videoId) return null;
  try {
    const html = await fetchHtml(`${BASE}/lang_en/video?id=${videoId}`, `${BASE}/lang_en/`);

    let name = "";
    const titleMatch = html.match(/<h5[^>]*>([^<]+)/i);
    if (titleMatch) name = decodeHtmlEntities(stripTags(titleMatch[1]));

    let poster = "";
    const ogImage = html.match(/og:image[^>]*content="([^"]+)"/i);
    if (ogImage) poster = ogImage[1];

    let description = "";
    const descMatch = html.match(/meta name="description" content="([^"]+)"/i)
      || html.match(/og:description[^>]*content="([^"]+)"/i);
    if (descMatch) description = decodeHtmlEntities(stripTags(descMatch[1]));

    const actors = [];
    const actorRe = /\/lang_en\/model\?id=\d+&name=([^"&]+)/gi;
    let am;
    while ((am = actorRe.exec(html)) !== null) {
      const a = decodeHtmlEntities(decodeURIComponent(am[1])).trim();
      if (a && !actors.includes(a)) actors.push(a);
    }

    const genres = [];
    const genreRe = /\/lang_en\/(?:main_ctg|ctg)\?id=\d+&name=([^"&]+)/gi;
    let gm;
    while ((gm = genreRe.exec(html)) !== null) {
      const g = decodeHtmlEntities(decodeURIComponent(gm[1])).trim();
      if (g && !genres.includes(g)) genres.push(g);
    }

    const meta = { id, type: "movie", name: name || videoId };
    if (poster) meta.poster = poster;
    if (description) meta.description = description;
    if (genres.length) meta.genre = genres;
    if (actors.length) meta.cast = actors;
    return meta;
  } catch (e) {
    console.error("meta fetch error:", maskError(e.message));
    return null;
  }
}

async function scrapeHohojStreams(id) {
  const videoId = extractVideoId(id);
  if (!videoId) return [];
  try {
    const embedUrl = `${BASE}/embed?id=${videoId}`;
    const html = await fetchHtml(embedUrl, `${BASE}/lang_en/video?id=${videoId}`);
    let m3u8 = null;

    const allM3u8 = [...html.matchAll(/(?:https?:)?\/\/[^\s"'<>]+\.m3u8(?:\?[^\s"'<>]*)?/gi)].map(m => m[0]);
    const cdnM3u8 = allM3u8.filter(u => !u.includes("google") && !u.includes("cloudflare"));
    if (cdnM3u8.length) m3u8 = cdnM3u8[0];

    if (!m3u8) {
      const srcMatch = html.match(/(?:src|videoSrc|file)\s*=\s*["']([^"']+\.m3u8[^"']*)/i);
      if (srcMatch) m3u8 = srcMatch[1];
    }

    if (!m3u8) {
      const jsonUrl = html.match(/"url"\s*:\s*"([^"]+\.m3u8[^"]*)"/i);
      if (jsonUrl) m3u8 = jsonUrl[1];
    }

    const mediaUrl = resolveDirectMediaUrl(m3u8, embedUrl);
    if (!mediaUrl) return [];
    return [{
      name: "\u{1F347} Grape",
      title: "HohoJ \u2022 HLS",
      url: mediaUrl,
      behaviorHints: directBehaviorHints(embedUrl, "hohoj")
    }];
  } catch (e) {
    console.error("streams fetch error:", maskError(e.message));
    return [];
  }
}

module.exports = {
  scrapeHohojCatalog,
  scrapeHohojMeta,
  scrapeHohojStreams
};
