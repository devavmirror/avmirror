const cheerio = require("cheerio");
const { UA, maskError, stripTags, decodeHtmlEntities } = require("../lib/scraper-utils");
const { resolveDirectMediaUrl, directBehaviorHints } = require("../lib/direct-stream");

const BASE = "https://goodav17.com";

function makeId(url) { return "goodav17:" + Buffer.from(String(url), "utf8").toString("base64url"); }
function idToUrl(id) {
  const raw = String(id || "").slice(9);
  try { return Buffer.from(raw, "base64url").toString("utf8"); } catch { return ""; }
}

async function fetchHtml(url, referer) {
  const headers = { "User-Agent": UA, accept: "text/html,*/*" };
  if (referer) headers.referer = referer;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 12000);
  try {
    const r = await fetch(url, { headers, redirect: "follow", signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

function parseCatalogItems(html) {
  const $ = cheerio.load(html);
  const items = [];
  const seen = new Set();
  $("div.movie").each((_, el) => {
    const link = $(el).find("a[href*='/html/']").first();
    const href = link.attr("href");
    if (!href) return;
    const fullUrl = href.startsWith("http") ? href : BASE + href;
    if (seen.has(fullUrl)) return;
    seen.add(fullUrl);
    const img = $(el).find("img").first();
    const poster = img.attr("src") || img.attr("large_image") || "";
    const titleLink = $(el).find("a[href*='/html/']").last();
    const title = decodeHtmlEntities(stripTags(titleLink.text()));
    items.push({ id: makeId(fullUrl), type: "movie", name: title || fullUrl, poster: poster || undefined });
  });
  return items;
}

async function scrapeGoodav17Catalog({ page = 1, search = "", genre = "", mode = "" } = {}) {
  try {
    let url;
    if (search) {
      url = `${BASE}/search/${encodeURIComponent(search)}/${page}/`;
    } else if (genre) {
      url = `${BASE}/search/${encodeURIComponent(genre)}/${page}/`;
    } else {
      url = `${BASE}/${page > 1 ? page + "/" : ""}`;
    }
    const html = await fetchHtml(url, `${BASE}/`);
    return parseCatalogItems(html);
  } catch (e) {
    console.error("catalog fetch error:", maskError(e.message));
    return [];
  }
}

async function scrapeGoodav17Meta(id) {
  const url = idToUrl(id);
  if (!url) return null;
  try {
    const html = await fetchHtml(url, `${BASE}/`);
    const $ = cheerio.load(html);

    const ogTitle = decodeHtmlEntities(stripTags($("meta[property='og:title']").attr("content") || ""));
    const ogDesc = decodeHtmlEntities(stripTags($("meta[property='og:description']").attr("content") || ""));
    const poster = $("meta[property='og:image']").attr("content") || "";
    const keywords = $("meta[property='video:tag']").attr("content") || $("meta[name='keywords']").attr("content") || "";
    const genre = keywords.split(",").map(g => decodeHtmlEntities(stripTags(g.trim()))).filter(Boolean);

    const actors = [];
    $("a[href*='actress'], a[href*='model']").each((_, el) => {
      const a = decodeHtmlEntities(stripTags($(el).text())).trim();
      if (a && !actors.includes(a)) actors.push(a);
    });

    const result = { id, type: "movie", name: ogTitle || url, poster: poster || undefined };
    if (ogDesc) result.description = ogDesc;
    if (genre.length) result.genre = genre.slice(0, 30);
    if (actors.length) result.cast = actors.slice(0, 30);
    return result;
  } catch (e) {
    console.error("meta fetch error:", maskError(e.message));
    return null;
  }
}

async function scrapeGoodav17Streams(id) {
  const url = idToUrl(id);
  if (!url) return [];
  try {
    const html = await fetchHtml(url, `${BASE}/`);
    const $ = cheerio.load(html);
    const iframeSrc = $("iframe#video_frame, iframe.video_frame, iframe[src*='embed'], iframe[src*='player']").first().attr("src");
    if (!iframeSrc) return [];

    const parsed = new URL(iframeSrc, url).href;
    const embedUrl = /^https?:\/\//i.test(iframeSrc) ? iframeSrc : parsed;
    const embedHtml = await fetchHtml(embedUrl, url).catch(() => "");

    const srcMatch = embedHtml.match(/(?:src|videoSrc|file)\s*=\s*["']([^"']+\.m3u8[^"']*)/i);
    const hlsUrl = resolveDirectMediaUrl(srcMatch?.[1], embedUrl);
    if (hlsUrl) {
      return [{
        name: "\u{1F34D} Pineapple",
        title: "GoodAV17 \u2022 HLS",
        url: hlsUrl,
        behaviorHints: directBehaviorHints(embedUrl, "goodav17"),
      }];
    }

    const mp4Match = embedHtml.match(/(?:src|videoSrc|file)\s*=\s*["']([^"']+\.mp4[^"']*)/i);
    const mp4Url = resolveDirectMediaUrl(mp4Match?.[1], embedUrl);
    if (mp4Url) {
      return [{
        name: "\u{1F34D} Pineapple",
        title: "GoodAV17 \u2022 MP4",
        url: mp4Url,
        behaviorHints: directBehaviorHints(embedUrl, "goodav17"),
      }];
    }

    const allM3u8 = [...embedHtml.matchAll(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi)].map(m => m[0]);
    if (allM3u8.length) {
      const mediaUrl = resolveDirectMediaUrl(allM3u8[0], embedUrl);
      if (mediaUrl) return [{
        name: "\u{1F34D} Pineapple",
        title: "GoodAV17 \u2022 HLS",
        url: mediaUrl,
        behaviorHints: directBehaviorHints(embedUrl, "goodav17"),
      }];
    }

    return [];
  } catch (e) {
    console.error("streams fetch error:", maskError(e.message));
    return [];
  }
}

module.exports = { scrapeGoodav17Catalog, scrapeGoodav17Meta, scrapeGoodav17Streams };
