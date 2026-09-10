const cheerio = require("cheerio");
const { parseCodeOf, parseMagnetTrackers, parseInfoHash, parseSizeBytes, browserFetch, makeCache } = require("../lib/scraper-utils");

const BASE_URL = "https://nyaa.si";
const cache = makeCache(300, 5 * 60 * 1000);
const clean = value => String(value || "").replace(/\s+/g, " ").trim();

async function getText(url) {
  const hit = cache.get(url);
  if (hit) return hit;
  const response = await browserFetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Nyaa HTTP ${response.status}`);
  const html = await response.text();
  cache.set(url, html);
  return html;
}

function parseRows(html) {
  const $ = cheerio.load(html);
  const out = [];
  const seen = new Set();
  $("table.torrent-list tbody tr").each((_, row) => {
    const $row = $(row);
    const titleEl = $row.find("td:nth-child(2) a:not(.comments)").first();
    const title = clean(titleEl.text());
    const href = titleEl.attr("href");
    const magnet = String($row.find("a[href^='magnet:']").first().attr("href") || "").replace(/&amp;/g, "&");
    const hash = parseInfoHash(magnet);
    if (!title || !href || !hash || seen.has(hash)) return;
    seen.add(hash);
    const size = parseSizeBytes($row.find("td:nth-child(4)").text());
    const seeders = parseInt($row.find("td:nth-child(6)").text(), 10) || 0;
    const trackers = parseMagnetTrackers(magnet);
    out.push({ id: `nyaa:${href}`, type: "movie", name: title, infoHash: hash, seeders, ...(size ? { size } : {}), sources: trackers, trackers });
  });
  return out;
}

async function scrapeCatalog({ page = 1, search = "" } = {}) {
  const query = String(search || "").trim();
  if (!query) return [];
  const html = await getText(`${BASE_URL}/?f=0&c=0_0&q=${encodeURIComponent(query)}&s=seeders&o=desc&p=${page}`);
  const wanted = parseCodeOf(query);
  return parseRows(html).filter(item => item.name.toLowerCase().includes(query.toLowerCase()) || (wanted && parseCodeOf(item.name) === wanted));
}

async function scrapeMeta(id) {
  const href = String(id || "").replace(/^nyaa:/, "");
  const html = await getText(`${BASE_URL}${href}`);
  const $ = cheerio.load(html);
  return { id, type: "movie", name: clean($("h3.panel-title").text()) || clean($("title").text()).replace(/ - Nyaa.*$/i, "") };
}

async function scrapeStreams(id) {
  const href = String(id || "").replace(/^nyaa:/, "");
  const html = await getText(`${BASE_URL}${href}`);
  const $ = cheerio.load(html);
  const out = [];
  $("a[href^='magnet:']").each((_, el) => {
    const magnet = String($(el).attr("href") || "").replace(/&amp;/g, "&");
    const infoHash = parseInfoHash(magnet);
    if (!infoHash || out.some(item => item.infoHash === infoHash)) return;
    const trackers = parseMagnetTrackers(magnet);
    out.push({ name: "🗾 Nyaa", title: "Nyaa • Torrent", infoHash, sources: trackers, behaviorHints: { bingeGroup: "nyaa", notWebReady: false } });
  });
  return out;
}

module.exports = { scrapeCatalog, scrapeMeta, scrapeStreams };
