const cheerio = require("cheerio");

const BASE = "https://porn87.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

function makeId(videoId) { return `porn87:${videoId}`; }
function extractVideoId(id) { return String(id || "").replace(/^porn87:/, ""); }
function stripTags(h) { return String(h || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }
function decodeHtmlEntities(s) {
  return String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, c) => String.fromCharCode(parseInt(c, 16)))
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'");
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
  $("a[href*='html?id=']").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const m = href.match(/[?&]id=(\d+)/);
    if (!m) return;
    const videoId = m[1];
    if (seen.has(videoId)) return;
    seen.add(videoId);
    const title = decodeHtmlEntities(stripTags(
      $(el).attr("title") || $(el).text() || ""
    )).replace(/^\d{2}:\d{2}(:\d{2})?\s*/, "").trim();
    const poster = $(el).find("img[src*='cdn']").first().attr("src") || "";
    const img = $(el).find("img").first().attr("src") || poster;
    items.push({ id: makeId(videoId), type: "movie", name: title || videoId, poster: img || undefined });
  });
  return items;
}

async function scrapeCatalog({ page = 1, search = "", genre = "", mode = "porn87" } = {}) {
  try {
    let url;
    if (search) {
      url = `${BASE}/main/search?name=${encodeURIComponent(search)}`;
    } else if (genre) {
      url = `${BASE}/main/tag?name=${encodeURIComponent(genre)}&lineup=create_time&page=${page}`;
    } else {
      url = `${BASE}/?page=${page}`;
    }
    const html = await fetchHtml(url, `${BASE}/`);
    return parseCatalogItems(html);
  } catch (e) {
    console.error("porn87 catalog error:", e.message);
    return [];
  }
}

async function scrapeMeta(id) {
  const videoId = extractVideoId(id);
  if (!videoId) return null;
  try {
    const url = `${BASE}/main/html?id=${videoId}`;
    const html = await fetchHtml(url, `${BASE}/`);
    const $ = cheerio.load(html);

    const ogTitle = decodeHtmlEntities(stripTags($("meta[property='og:title']").attr("content") || ""));
    const h4Title = decodeHtmlEntities(stripTags($("h4").first().text()));
    const name = h4Title || ogTitle || videoId;

    const poster = $("meta[property='og:image']").attr("content") || "";
    const description = decodeHtmlEntities(stripTags($("meta[property='og:description']").attr("content") || ""));
    const keywords = $("meta[property='video:tag']").attr("content") || "";
    const genre = keywords.split(/[,，]/).map(g => decodeHtmlEntities(stripTags(g.trim()))).filter(Boolean);

    const actors = [];
    $("a[href*='/model?name='], a[href*='/main/model?name=']").each((_, el) => {
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
    console.error("porn87 meta error:", e.message);
    return null;
  }
}

async function scrapeStreams(id) {
  const videoId = extractVideoId(id);
  if (!videoId) return [];
  try {
    const pageUrl = `${BASE}/main/html?id=${videoId}`;
    const html = await fetchHtml(pageUrl, `${BASE}/`);
    const $ = cheerio.load(html);

    let hlsUrl = "";

    const srcAttr = $("video#my-video, video").first().attr("src");
    if (srcAttr && /\.m3u8/i.test(srcAttr)) {
      hlsUrl = srcAttr;
    }

    if (!hlsUrl) {
      const embedUrl = `${BASE}/main/embed?id=${videoId}`;
      const embedHtml = await fetchHtml(embedUrl, pageUrl).catch(() => "");
      const embedMatch = embedHtml.match(/src\s*=\s*["']([^"']+\.m3u8[^"']*)/i)
        || embedHtml.match(/(?:videoSrc|source)\s*=\s*["']([^"']+\.m3u8[^"']*)/i);
      if (embedMatch) hlsUrl = embedMatch[1];
    }

    if (!hlsUrl) return [];

    return [{
      name: "🟢 Jade", title: "🟢 Jade • Auto",
      url: hlsUrl,
      behaviorHints: {
        notWebReady: false,
        bingeGroup: "porn87",
        proxyHeaders: { headers: { "User-Agent": UA, "Referer": `${BASE}/` } },
      },
    }];
  } catch (e) {
    console.error("porn87 streams error:", e.message);
    return [];
  }
}

module.exports = { scrapeCatalog, scrapeMeta, scrapeStreams };
