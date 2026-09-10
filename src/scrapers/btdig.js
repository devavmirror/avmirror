const cheerio = require("cheerio");
const { UA, parseCodeOf, parseMagnetTrackers, parseInfoHash, parseSizeBytes, formatSize, makeCache } = require("../lib/scraper-utils");
const BASE_URL = "https://btdig.com";
const cache = makeCache(500, 5 * 60 * 1000);
const clean = value => String(value || "").replace(/\s+/g, " ").trim();

async function getText(url, retries = 3) {
  const hit = cache.get(url); if (hit) return hit;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/115.0", "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "accept-language": "en-US,en;q=0.5" }, signal: AbortSignal.timeout(12000), redirect: "follow" });
      if (r.status === 429) {
        if (attempt < retries) { await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); continue; }
        throw new Error(`BTDig HTTP ${r.status} (rate limited)`);
      }
      if (!r.ok) throw new Error(`BTDig HTTP ${r.status}`);
      const html = await r.text(); cache.set(url, html); return html;
    } catch(e) {
      if (attempt < retries) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
      throw e;
    }
  }
}

function parseResults(html) {
  const $ = cheerio.load(html), out = [], seen = new Set();
  const results = $(".one_result");
  results.each((_, el) => {
    const $el = $(el);
    const nameEl = $el.find("div.torrent_name a").first();
    const name = clean(nameEl.text());
    const magnetEl = $el.find("a[href^='magnet:']").first();
    const magnet = String(magnetEl.attr("href") || "").replace(/&amp;/g, "&");
    const infoHash = (magnet.match(/btih:([a-fA-F0-9]{40})/i) || [])[1];
    if (!infoHash || seen.has(infoHash)) return;
    seen.add(infoHash);
    const trackers = [...magnet.matchAll(/tr=([^&]+)/gi)].map(m => `tracker:${decodeURIComponent(m[1])}`);
    const sizeEl = $el.find("span.torrent_size");
    const totalSize = clean(sizeEl.text()) || undefined;
    out.push({ id: `btdig:${infoHash}`, type: "movie", name, magnet, infoHash: infoHash.toLowerCase(), trackers, sizeText: totalSize });
  });
  return out;
}

async function scrapeCatalog({ page = 1, search = "" } = {}) {
  const query = String(search || "").trim();
  if (!query) return [];
  const url = `${BASE_URL}/search?q=${encodeURIComponent(`"${query}"`)}`;
  const items = parseResults(await getText(url));
  const wanted = parseCodeOf(query);
  return items.filter(item => item.name.toLowerCase().includes(query.toLowerCase()) || (wanted && parseCodeOf(item.name) === wanted));
}

async function scrapeMeta(id) {
  const hash = String(id || "").replace(/^btdig:/, "");
  const items = parseResults(await getText(`${BASE_URL}/search?q=${hash}`));
  const match = items.find(i => i.infoHash === hash.toLowerCase());
  if (!match) return { id, type: "movie", name: hash.slice(0, 12) };
  return { id, type: "movie", name: match.name, poster: undefined };
}

async function scrapeStreams(id) {
  const hash = String(id || "").replace(/^btdig:/, "").toLowerCase();
  try {
    const items = parseResults(await getText(`${BASE_URL}/search?q=${hash}`));
    const match = items.find(i => i.infoHash === hash);
    if (match) {
      return [{
        name: "\u{1F353} Guava",
        title: "Guava \u2022 Torrent 1",
        infoHash: match.infoHash,
        ...(match.trackers.length ? { sources: match.trackers } : {}),
        behaviorHints: { bingeGroup: "btdig", notWebReady: false }
      }];
    }
    const html = await getText(`${BASE_URL}/search?q=${hash}`);
    const $ = cheerio.load(html);
    const magnetEl = $("a[href^='magnet:']").first();
    const magnet = String(magnetEl.attr("href") || "").replace(/&amp;/g, "&");
    const infoHash = (magnet.match(/btih:([a-fA-F0-9]{40})/i) || [])[1];
    if (infoHash && infoHash.toLowerCase() === hash) {
      const trackers = [...magnet.matchAll(/tr=([^&]+)/gi)].map(m => `tracker:${decodeURIComponent(m[1])}`);
      return [{
        name: "\u{1F353} Guava",
        title: "Guava \u2022 Torrent 1",
        infoHash: infoHash.toLowerCase(),
        ...(trackers.length ? { sources: trackers } : {}),
        behaviorHints: { bingeGroup: "btdig", notWebReady: false }
      }];
    }
  } catch(e) { /* ignore */ }
  return [];
}

module.exports = { scrapeCatalog, scrapeMeta, scrapeStreams };
