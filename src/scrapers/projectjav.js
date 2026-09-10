const cheerio = require("cheerio");
const { UA, parseMagnetTrackers, parseInfoHash, parseSizeBytes, formatSize, makeCache, browserFetch } = require("../lib/scraper-utils");
const BASE_URL = "https://projectjav.com";
const cache = makeCache();
const clean = value => String(value || "").replace(/\s+/g, " ").trim();
async function get(url) {
  const hit = cache.get(url); if (hit) return hit;
  const r = await browserFetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`ProjectJav HTTP ${r.status}`);
  const html = await r.text(); cache.set(url, html); return html;
}
function parseCards(html) {
  const $ = cheerio.load(html), out = [], seen = new Set();
  $(".video-item").each((_, el) => {
    const $el = $(el);
    const nameEl = $el.find(".name a");
    const name = clean(nameEl.text());
    const href = nameEl.attr("href");
    if (!href || seen.has(href)) return;
    const img = $el.find(".img-area img");
    const poster = img.attr("data-src") || img.attr("src");
    seen.add(href);
    out.push({
      id: `projectjav:${href.startsWith("http") ? href : BASE_URL + href}`,
      type: "movie",
      name,
      poster: poster ? (poster.startsWith("http") ? poster : `https://images.projectjav.com${poster}`) : undefined,
    });
  });
  return out.slice(0, 100);
}
function parseMagnets(html) {
  const $ = cheerio.load(html), out = [], seen = new Set();
  $('a[href^="magnet:"]').each((_, el) => {
    const magnet = ($(el).attr("href") || "").replace(/&amp;/g, "&");
    if (!magnet) return;
    const infoHashMatch = magnet.match(/btih:([a-fA-F0-9]{40})/i);
    if (!infoHashMatch) return;
    const infoHash = infoHashMatch[1].toLowerCase();
    if (seen.has(infoHash)) return;
    seen.add(infoHash);
    const trackers = [];
    const trRegex = /tr=([^&]+)/g;
    let trMatch;
    while ((trMatch = trRegex.exec(magnet)) !== null) {
      trackers.push(`tracker:${decodeURIComponent(trMatch[1])}`);
    }
    const sizeMatch = magnet.match(/xl=(\d+)/i);
    const size = sizeMatch ? Number(sizeMatch[1]) : undefined;
    out.push({
      infoHash,
      sources: trackers,
      ...(size ? { size } : {}),
    });
  });
  return out;
}
async function scrapeCatalog({ page = 1, search = "" } = {}) {
  const query = String(search || "").trim();
  const url = query
    ? `${BASE_URL}/?searchTerm=${encodeURIComponent(query)}`
    : `${BASE_URL}/?page=${page}`;
  return parseCards(await get(url));
}
async function scrapeMeta(id) {
  const url = String(id || "").replace(/^projectjav:/, "");
  const html = await get(url);
  const $ = cheerio.load(html);
  const title = clean($("h1").first().text()) || clean($("title").text()).replace(/ - ProjectJav.*$/i, "");
  const posterImg = $(".movie-detail img.mw-100").first();
  const poster = posterImg.attr("src");
  const cast = [];
  $(".actress-item a").each((_, el) => { const n = clean($(el).text()); if (n) cast.push(n); });
  return { id, type: "movie", name: title, poster: poster ? (poster.startsWith("http") ? poster : `https://images.projectjav.com${poster}`) : undefined, cast: cast.length ? cast : undefined };
}
async function scrapeStreams(id) {
  const url = String(id || "").replace(/^projectjav:/, "");
  let html;
  try {
    html = await get(url);
  } catch {}
  const magnets = html ? parseMagnets(html) : [];
  if (magnets.length) {
    return magnets.map((m, i) => ({
      name: "🫐 Blueberry",
      title: `Blueberry • Torrent ${i + 1}`,
      infoHash: m.infoHash,
      ...(m.sources.length ? { sources: m.sources } : {}),
      behaviorHints: { bingeGroup: "projectjav", notWebReady: false, ...(m.size ? { videoSize: m.size } : {}) },
    }));
  }
  const { parseCodeOf } = require("../lib/scraper-utils");
  const title = html ? (cheerio.load(html)("h1").first().text() || cheerio.load(html)("title").text()) : "";
  const code = parseCodeOf(title) || parseCodeOf(id);
  if (code) {
    try {
      const searchHtml = await get(`${BASE_URL}/?searchTerm=${encodeURIComponent(code)}`);
      const allMagnets = parseMagnets(searchHtml);
      const filtered = allMagnets.filter(m => {
        const magnetStr = `btih:${m.infoHash}`;
        return true;
      }).slice(0, 5);
      if (filtered.length) {
        return filtered.map((m, i) => ({
          name: "🫐 Blueberry",
          title: `Blueberry • Torrent ${i + 1}`,
          infoHash: m.infoHash,
          ...(m.sources.length ? { sources: m.sources } : {}),
          behaviorHints: { bingeGroup: "projectjav", notWebReady: false, ...(m.size ? { videoSize: m.size } : {}) },
        }));
      }
    } catch {}
  }
  return [];
}
module.exports = { scrapeCatalog, scrapeMeta, scrapeStreams };
