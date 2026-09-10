const cheerio = require("cheerio");
const { UA, parseCodeOf, parseMagnetTrackers, parseInfoHash, parseSizeBytes, formatSize, makeCache, browserFetch } = require("../lib/scraper-utils");
const BASE_URL = "https://sukebei.nyaa.si";
const cache = makeCache(500, 5 * 60 * 1000);
const clean = value => String(value || "").replace(/\s+/g, " ").trim();

async function getText(url) {
  const hit = cache.get(url); if (hit) return hit;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await browserFetch(url, { signal: AbortSignal.timeout(20000) });
      if (r.status === 522 || r.status === 429) {
        if (attempt < 2) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
      }
      if (!r.ok) throw new Error(`SukebeiNyaa HTTP ${r.status}`);
      const html = await r.text(); cache.set(url, html); return html;
    } catch (e) {
      if (attempt < 2) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
      throw e;
    }
  }
}

function parseRows(html) {
  const $ = cheerio.load(html), out = [], seen = new Set();
  $("table.torrent-list tbody tr").each((_, row) => {
    const $row = $(row);
    const titleEl = $row.find("td:nth-child(2) a:not(.comments)");
    const title = clean(titleEl.text());
    const href = titleEl.attr("href");
    if (!href || !title || seen.has(href)) return;

    const magnetEl = $row.find("td:nth-child(3) a[href^='magnet:']");
    const magnet = String(magnetEl.attr("href") || "").replace(/&amp;/g, "&");
    const infoHash = (magnet.match(/btih:([a-fA-F0-9]{40})/i) || [])[1];
    if (!infoHash) return;

    seen.add(href);
    const trackers = parseMagnetTrackers(magnet);
    const sizeMatch = $row.find("td:nth-child(4)").text().trim();
    const videoSize = parseSizeBytes(sizeMatch);
    const seeders = parseInt($row.find("td:nth-child(6)").text().trim(), 10) || 0;

    out.push({ id: `sukebeinyaa:${href}`, type: "movie", name: title, infoHash: infoHash.toLowerCase(), trackers, sources: trackers, seeders });
  });
  return out;
}

function sizeToBytes(text) {
  const m = String(text).match(/([\d.]+)\s*(GiB|MiB|KiB|GB|MB|KB)/i);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  if (unit.startsWith("g")) return Math.round(n * 1024 * 1024 * 1024);
  if (unit.startsWith("m")) return Math.round(n * 1024 * 1024);
  if (unit.startsWith("k")) return Math.round(n * 1024);
  return undefined;
}

async function scrapeCatalog({ page = 1, search = "" } = {}) {
  const query = String(search || "").trim();
  const url = query
    ? `${BASE_URL}/?f=0&c=0_0&q=${encodeURIComponent(query)}&s=seeders&o=desc`
    : `${BASE_URL}/?f=0&c=0_0&p=${page}`;
  const items = parseRows(await getText(url));
  if (!query) return items;
  const wanted = parseCodeOf(query);
  return items.filter(item => item.name.toLowerCase().includes(query.toLowerCase()) || (wanted && parseCodeOf(item.name) === wanted));
}

async function scrapeMeta(id) {
  const path = String(id || "").replace(/^sukebeinyaa:/, "");
  const html = await getText(`${BASE_URL}${path}`);
  const $ = cheerio.load(html);
  const title = clean($("h3.panel-title").text()) || clean($("title").text()).replace(/ - Sukebei.*$/i, "");
  const magnet = $("a[href^='magnet:']").attr("href") || "";
  const infoHash = (magnet.match(/btih:([a-fA-F0-9]{40})/i) || [])[1];
  const poster = $("div.row img").attr("src");
  return { id, type: "movie", name: title, poster: poster || undefined };
}

async function scrapeStreams(id) {
  const path = String(id || "").replace(/^sukebeinyaa:/, "");
  const html = await getText(`${BASE_URL}${path}`);
  const $ = cheerio.load(html);
  const out = [];
  const seedersText = $(".col-md-1").filter(function() { return $(this).text().trim() === "Seeders:"; }).next().find("span").first().text().trim()
    || $(".col-md-1").filter(function() { return $(this).text().trim() === "Seeders:"; }).next().text().trim();
  const seeders = parseInt(seedersText, 10) || 0;
  $("a[href^='magnet:']").each((_, a) => {
    const magnet = String($(a).attr("href") || "").replace(/&amp;/g, "&");
    const hash = parseInfoHash(magnet);
    if (!hash) return;
    const key = hash;
    if (out.some(s => s.infoHash === key)) return;
    const trackers = parseMagnetTrackers(magnet);
    const seedLabel = seeders > 0 ? ` \u2022 ${seeders} seeds` : "";
    out.push({
      name: "\u{1F363} Sashimi",
      title: `Sashimi \u2022 Torrent${seedLabel}`,
      infoHash: key,
      seeders,
      ...(trackers.length ? { sources: trackers } : {}),
      behaviorHints: { bingeGroup: "sukebeinyaa", notWebReady: false }
    });
  });
  return out;
}

module.exports = { scrapeCatalog, scrapeMeta, scrapeStreams };
