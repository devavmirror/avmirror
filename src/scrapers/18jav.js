const cheerio = require("cheerio");

const BASE_URL = "https://18jav.tv";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 15000);

async function get(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,*/*", referer: `${BASE_URL}/` }, signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

function absolute(value, base = BASE_URL) { try { return new URL(String(value || ""), base).href; } catch { return ""; } }
function clean(text) { return String(text || "").replace(/\s+/g, " ").trim(); }
function allowedPage(value) { try { const u = new URL(value); return u.protocol === "https:" && /^18jav\.tv$/i.test(u.hostname); } catch { return false; } }
function makeId(url) { return `18jav:${Buffer.from(url).toString("base64url")}`; }
function idToUrl(id) { try { const url = Buffer.from(String(id || "").slice(6), "base64url").toString("utf8"); return allowedPage(url) && /^\/videos\/[^/?#]+\/?$/i.test(new URL(url).pathname) ? url : ""; } catch { return ""; } }

function parseCatalog(html) {
  const $ = cheerio.load(html);
  return $(".video-img-box").map((_, el) => {
    const a = $(el).find("a").first();
    const href = a.attr("href");
    const url = absolute(href);
    if (!url || !allowedPage(url)) return null;
    const img = $(el).find("img").first();
    const dataSrc = img.attr("data-src") || img.attr("src") || "";
    const poster = /placeholder/i.test(dataSrc) ? "" : absolute(dataSrc);
    const title = clean($(el).find(".title").text()) || clean(a.text());
    const duration = clean($(el).find(".label").text());
    const id = makeId(url);
    const meta = { id, type: "movie", name: title || id };
    if (poster) meta.poster = poster;
    if (duration) meta.runtime = duration;
    return meta;
  }).get().filter(Boolean);
}

function catalogUrl({ page = 1, search = "", genre = "", category = "", mode = "" } = {}) {
  if (search) return `${BASE_URL}/search/${encodeURIComponent(search)}/`;
  if (genre) return `${BASE_URL}/tags/${encodeURIComponent(genre)}/`;
  if (category) return `${BASE_URL}/categories/${category}/`;
  if (mode === "18jav-hot") return `${BASE_URL}/hot/`;
  if (mode === "18jav-latest") return `${BASE_URL}/latest-updates/`;
  return `${BASE_URL}/latest-updates/`;
}

async function scrape18JavCatalog(options = {}) {
  const url = catalogUrl(options);
  const page = options.page || 1;
  const pagedUrl = page > 1 ? url.replace(/\/?$/, `/page/${page}/`) : url;
  return parseCatalog(await get(pagedUrl));
}

async function scrape18JavMeta(id) {
  const url = idToUrl(id);
  if (!url) return null;
  const html = await get(url);
  const $ = cheerio.load(html);
  const title = clean($("h4").first().text()) || clean($("title").text());
  const poster = $("meta[property='og:image']").attr("content") || "";
  const description = $("meta[property='og:description']").attr("content") || "";
  const tags = $(".tags .cat").map((_, el) => clean($(el).text())).get().filter(Boolean);
  const actors = $(".model span").map((_, el) => clean($(el).attr("title") || $(el).text())).get().filter(Boolean);
  const runtime = clean($(".video-info .info-header span.mr-3").first().next().text());
  const releaseInfo = $(".video-info .info-header .mr-3").first().text();
  const meta = { id, type: "movie", name: title || id };
  if (poster) meta.poster = poster;
  if (description) meta.description = description;
  if (tags.length) meta.genre = [...new Set(tags)].slice(0, 30);
  if (actors.length) meta.cast = [...new Set(actors)].slice(0, 30);
  if (releaseInfo) meta.releaseInfo = releaseInfo;
  return meta;
}

async function scrape18JavStreams(id) {
  const url = idToUrl(id);
  if (!url) return [];
  const html = await get(url);
  const match = html.match(/var\s+hlsUrl\s*=\s*["']([^"']+)["']/);
  if (!match) return [];
  return [{
    name: "🔥 Ember",
    title: "18Jav • HLS",
    url: match[1],
    behaviorHints: { notWebReady: false, bingeGroup: "18jav", proxyHeaders: { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://18jav.tv/" } } }
  }];
}

module.exports = { scrape18JavCatalog, scrape18JavMeta, scrape18JavStreams };
