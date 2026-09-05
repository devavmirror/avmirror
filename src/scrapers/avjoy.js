const cheerio = require("cheerio");

const BASE = "https://avjoy.me";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

function makeId(url) { return "avjoy:" + Buffer.from(String(url), "utf8").toString("base64url"); }
function idToUrl(id) {
  const raw = String(id || "").slice(6);
  try { return Buffer.from(raw, "base64url").toString("utf8"); } catch { return ""; }
}
function decodeHtmlEntities(s) {
  return String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, c) => String.fromCharCode(parseInt(c, 16)))
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'");
}
function stripTags(h) { return String(h || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }

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
  $("a[href*='/video/']").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || !href.match(/\/video\/\d+\//)) return;
    const fullUrl = href.startsWith("http") ? href : BASE + href;
    if (seen.has(fullUrl)) return;
    seen.add(fullUrl);
    const img = $(el).find("img").first();
    const poster = img.attr("src") || "";
    const titleEl = $(el).find(".content-title").first();
    const title = decodeHtmlEntities(stripTags(titleEl.text() || img.attr("title") || img.attr("alt") || ""));
    items.push({ id: makeId(fullUrl), type: "movie", name: title || fullUrl, poster: poster || undefined });
  });
  return items;
}

async function scrapeAvjoyCatalog({ page = 1, search = "", genre = "", mode = "" } = {}) {
  try {
    let url;
    if (search) {
      url = `${BASE}/search/videos/${encodeURIComponent(search)}`;
    } else if (genre) {
      url = `${BASE}/search/videos/${encodeURIComponent(genre)}`;
    } else {
      url = `${BASE}/videos?o=mr&page=${page}`;
    }
    const html = await fetchHtml(url, `${BASE}/`);
    return parseCatalogItems(html);
  } catch (e) {
    console.error("avjoy catalog error:", e.message);
    return [];
  }
}

async function scrapeAvjoyMeta(id) {
  const url = idToUrl(id);
  if (!url) return null;
  try {
    const html = await fetchHtml(url, `${BASE}/`);
    const $ = cheerio.load(html);

    const ogTitle = decodeHtmlEntities(stripTags($("meta[property='og:title']").attr("content") || ""));
    const ogDesc = decodeHtmlEntities(stripTags($("meta[property='og:description']").attr("content") || ""));
    const poster = $("meta[property='og:image']").attr("content") || "";
    const tags = [];
    $("meta[property='video:tag']").each((_, el) => {
      const t = decodeHtmlEntities(stripTags($(el).attr("content") || ""));
      if (t && !tags.includes(t)) tags.push(t);
    });

    const result = { id, type: "movie", name: ogTitle || url, poster: poster || undefined };
    if (ogDesc) result.description = ogDesc;
    if (tags.length) result.genre = tags.slice(0, 30);
    return result;
  } catch (e) {
    console.error("avjoy meta error:", e.message);
    return null;
  }
}

async function scrapeAvjoyStreams(id) {
  const url = idToUrl(id);
  if (!url) return [];
  try {
    const html = await fetchHtml(url, `${BASE}/`);
    const mp4Matches = html.match(/https?:\/\/media-cdn\d+\.avjoy\.me\/video\/[^"'\s]+\.mp4[^"'\s]*/g);
    if (!mp4Matches || !mp4Matches.length) return [];

    const seen = new Set();
    const streams = [];
    for (const mp4Url of mp4Matches) {
      if (seen.has(mp4Url)) continue;
      seen.add(mp4Url);
      const qualityMatch = mp4Url.match(/(\d+)p\.mp4/);
      const quality = qualityMatch ? qualityMatch[1] + "p" : "SD";
      streams.push({
        name: "🟡 Solar",
        title: `AVJoy • ${quality}`,
        url: mp4Url,
        behaviorHints: { notWebReady: false, bingeGroup: "avjoy" },
      });
    }
    return streams;
  } catch (e) {
    console.error("avjoy streams error:", e.message);
    return [];
  }
}

module.exports = { scrapeAvjoyCatalog, scrapeAvjoyMeta, scrapeAvjoyStreams };
