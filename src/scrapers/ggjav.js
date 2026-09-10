const cheerio = require("cheerio");
const { UA, maskError, stripTags, decodeHtmlEntities } = require("../lib/scraper-utils");
const { resolveDirectMediaUrl, directBehaviorHints } = require("../lib/direct-stream");

const BASE = "https://ggjav.com";

function makeId(videoId) { return `ggjav:${videoId}`; }
function extractVideoId(id) { return String(id || "").replace(/^ggjav:/, ""); }

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
  $("div.item, div.columns.item").each((_, el) => {
    const link = $(el).find("a[href*='video?id=']").first();
    const href = link.attr("href");
    if (!href) return;
    const m = href.match(/id=(\d+)/);
    if (!m) return;
    const videoId = m[1];
    if (seen.has(videoId)) return;
    seen.add(videoId);
    const title = decodeHtmlEntities(stripTags($(el).find(".item_title a, .item_title").first().text()));
    const poster = $(el).find("img.item_image, img[src*='ggjav.com/media']").first().attr("src") || "";
    items.push({ id: makeId(videoId), type: "movie", name: title || videoId, poster: poster || undefined });
  });
  return items;
}

async function scrapeCatalog({ page = 1, search = "", genre = "", mode = "ggjav" } = {}) {
  try {
    let url;
    if (search) {
      url = `${BASE}/en/main/search?string=${encodeURIComponent(search)}`;
    } else if (genre) {
      url = `${BASE}/en/main/ctg?ctgs=${encodeURIComponent(genre)}&page=${page}`;
    } else if (mode === "ggjav-uncensored") {
      url = `${BASE}/en/main/uncensored?order=recommended&page=${page}`;
    } else if (mode === "ggjav-popular") {
      url = `${BASE}/en/main/censored?order=views&page=${page}`;
    } else {
      url = `${BASE}/en/main/censored?order=recommended&page=${page}`;
    }
    const html = await fetchHtml(url, `${BASE}/en/`);
    return parseCatalogItems(html);
  } catch (e) {
    console.error("catalog fetch error:", maskError(e.message));
    return [];
  }
}

async function scrapeMeta(id) {
  const videoId = extractVideoId(id);
  if (!videoId) return null;
  try {
    const url = `${BASE}/en/main/video?id=${videoId}`;
    const html = await fetchHtml(url, `${BASE}/en/`);
    const $ = cheerio.load(html);

    const title = decodeHtmlEntities(stripTags($("div.title_text").first().text()));
    const ogTitle = decodeHtmlEntities(stripTags($("meta[property='og:title']").attr("content") || ""));
    const name = title || ogTitle || videoId;

    const poster = $("meta[property='og:image']").attr("content") || "";
    const description = decodeHtmlEntities(stripTags($("meta[property='og:description']").attr("content") || ""));
    const keywords = $("meta[property='video:tag']").attr("content") || $("meta[name='keywords']").attr("content") || "";
    const genre = keywords.split(",").map(g => decodeHtmlEntities(stripTags(g.trim()))).filter(Boolean);

    const actors = [];
    $("a[href*='/model?name=']").each((_, el) => {
      const a = decodeHtmlEntities(decodeURIComponent(($(el).attr("href") || "").match(/name=([^&]+)/)?.[1] || "")).trim();
      if (a && !actors.includes(a)) actors.push(a);
    });

    return {
      id, type: "movie", name,
      poster: poster || undefined,
      description: description || undefined,
      genre: genre.slice(0, 30),
      cast: actors.slice(0, 30),
    };
  } catch (e) {
    console.error("meta fetch error:", maskError(e.message));
    return null;
  }
}

function decodeObfuscatedJson(html) {
  const match = html.match(/var\s+l\s*=\s*"([^"]+)"/);
  if (!match) return null;
  const base64 = match[1];
  const binary = Buffer.from(base64, "base64").toString("binary");
  let decoded = "";
  for (let i = 0; i < binary.length; i++) {
    decoded += String.fromCharCode(binary.charCodeAt(i) - 88);
  }
  try { return JSON.parse(decoded); } catch { return null; }
}

async function scrapeStreams(id) {
  const videoId = extractVideoId(id);
  if (!videoId) return [];
  try {
    const url = `${BASE}/en/main/video?id=${videoId}`;
    const html = await fetchHtml(url, `${BASE}/en/`);
    const serverMap = decodeObfuscatedJson(html);
    if (!serverMap) {
      const fallbackM3u8 = [...html.matchAll(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi)].map(m => m[0]);
      if (fallbackM3u8.length) {
        const mediaUrl = resolveDirectMediaUrl(fallbackM3u8[0], url);
        if (mediaUrl) return [{
          name: "\u{1F353} Strawberry", title: "\u{1F353} Strawberry \u2022 Auto",
          url: mediaUrl,
          behaviorHints: directBehaviorHints(url, "ggjav"),
        }];
      }
      return [];
    }

    const streams = [];
    for (const [serverName, urls] of Object.entries(serverMap)) {
      if (!Array.isArray(urls) || !urls.length) continue;
      for (const rawServerUrl of urls) {
        const serverUrl = resolveDirectMediaUrl(rawServerUrl, url);
        if (!serverUrl) continue;
        const embedHtml = await fetchHtml(serverUrl, url).catch(() => "");
        const hlsMatch = embedHtml.match(/(?:videoSrc|src|file)\s*=\s*["']([^"']+\.m3u8[^"']*)/i);
        const mediaUrl = resolveDirectMediaUrl(hlsMatch?.[1], serverUrl);
        if (mediaUrl) {
          streams.push({
            name: "\u{1F353} Strawberry", title: "\u{1F353} Strawberry \u2022 Auto",
            url: mediaUrl,
            behaviorHints: directBehaviorHints(serverUrl, "ggjav"),
          });
          break;
        }
      }
      if (streams.length) break;
    }
    return streams;
  } catch (e) {
    console.error("streams fetch error:", maskError(e.message));
    return [];
  }
}

module.exports = { scrapeCatalog, scrapeMeta, scrapeStreams };
