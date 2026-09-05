const cheerio = require("cheerio");

const BASE = "https://goodav17.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

function makeId(url) { return "goodav17:" + Buffer.from(String(url), "utf8").toString("base64url"); }
function idToUrl(id) {
  const raw = String(id || "").slice(9);
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
    console.error("goodav17 catalog error:", e.message);
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
    console.error("goodav17 meta error:", e.message);
    return null;
  }
}

async function scrapeGoodav17Streams(id) {
  const url = idToUrl(id);
  if (!url) return [];
  try {
    const html = await fetchHtml(url, `${BASE}/`);
    const $ = cheerio.load(html);
    const iframeSrc = $("iframe#video_frame, iframe.video_frame").first().attr("src");
    if (!iframeSrc) return [];

    const embedUrl = iframeSrc.startsWith("http") ? iframeSrc : `https://ggjav.com${iframeSrc}`;
    const embedHtml = await fetchHtml(embedUrl, url).catch(() => "");

    const srcMatch = embedHtml.match(/src\s*=\s*["']([^"']+\.m3u8[^"']*)/i);
    if (srcMatch) {
      return [{
        name: "🔵 Azure",
        title: "GoodAV17 • HLS",
        url: srcMatch[1],
        behaviorHints: { notWebReady: false, bingeGroup: "goodav17" },
      }];
    }

    const mp4Match = embedHtml.match(/src\s*=\s*["']([^"']+\.mp4[^"']*)/i);
    if (mp4Match) {
      return [{
        name: "🔵 Azure",
        title: "GoodAV17 • MP4",
        url: mp4Match[1],
        behaviorHints: { notWebReady: false, bingeGroup: "goodav17" },
      }];
    }

    return [];
  } catch (e) {
    console.error("goodav17 streams error:", e.message);
    return [];
  }
}

module.exports = { scrapeGoodav17Catalog, scrapeGoodav17Meta, scrapeGoodav17Streams };
