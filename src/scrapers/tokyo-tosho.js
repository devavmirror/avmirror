const cheerio = require("cheerio");
const { UA, parseCodeOf, parseMagnetTrackers, parseInfoHash, makeCache, browserFetch } = require("../lib/scraper-utils");
const BASE_URL = "https://tokyo-tosho.net";
const JAV_CAT = 15;
const cache = makeCache(500, 5 * 60 * 1000);

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(input) {
  input = input.replace(/=+$/, "").toUpperCase();
  let bits = "";
  for (const c of input) {
    const val = BASE32_CHARS.indexOf(c);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return Buffer.from(bytes).toString("hex");
}

function extractInfoHash(magnet) {
  const hexMatch = magnet.match(/btih:([a-fA-F0-9]{40})/i);
  if (hexMatch) return hexMatch[1].toLowerCase();
  const b32Match = magnet.match(/btih:([A-Z2-7]{32})/i);
  if (b32Match) {
    try { return base32Decode(b32Match[1]); } catch {}
  }
  return null;
}

async function getText(url) {
  const hit = cache.get(url); if (hit) return hit;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 20000);
      const r = await browserFetch(url, { signal: ac.signal });
      clearTimeout(timer);
      if (r.status === 429 || r.status === 503) {
        if (attempt < 2) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
      }
      if (!r.ok) throw new Error(`TokyoToshokan HTTP ${r.status}`);
      const html = await r.text(); cache.set(url, html); return html;
    } catch (e) {
      if (attempt < 2) { await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); continue; }
      throw e;
    }
  }
}

function parseEntries(html) {
  const $ = cheerio.load(html), out = [], seen = new Set();
  const rows = $("tr").toArray();
  for (const row of rows) {
    const $row = $(row);
    const magnetEl = $row.find('a[href^="magnet:"]').first();
    if (!magnetEl.length) continue;
    const rawHref = magnetEl.attr("href") || "";
    const href = rawHref.includes("%3A") ? decodeURIComponent(rawHref) : rawHref;
    const infoHash = extractInfoHash(href);
    if (!infoHash || seen.has(infoHash)) continue;
    seen.add(infoHash);
    const titleLink = $row.find("a").not('[href^="magnet:"]').not('[href^="?"]').not('[href^="details"]').not('[href*="tracker"]').first();
    let name = titleLink.text().trim();
    if (!name || name.length < 3) {
      name = $row.text().replace(/\s+/g, " ").trim().substring(0, 80);
    }
    const statsText = $row.find(".stats").text() || $row.text();
    const sMatch = statsText.match(/S:\s*(\d+)/);
    const lMatch = statsText.match(/L:\s*(\d+)/);
    const seeders = sMatch ? parseInt(sMatch[1]) || 0 : 0;
    const leechers = lMatch ? parseInt(lMatch[1]) || 0 : 0;
    const trackers = parseMagnetTrackers(href);
    out.push({ id: `tokyotosho:${infoHash}`, type: "movie", name, infoHash, trackers, sources: trackers, seeders, leechers });
  }
  return out;
}

async function scrapeCatalog({ page = 1, search = "" } = {}) {
  const query = String(search || "").trim();
  let url;
  if (query) {
    url = `${BASE_URL}/index.php?cat=${JAV_CAT}&q=${encodeURIComponent(query)}`;
  } else {
    url = `${BASE_URL}/index.php?cat=${JAV_CAT}&page=${page}`;
  }
  const html = await getText(url);
  const items = parseEntries(html);
  if (!query) return items;
  const wanted = parseCodeOf(query);
  if (!wanted) return items;
  return items.filter(item => {
    const itemName = parseCodeOf(item.name);
    return itemName === wanted || item.name.toLowerCase().includes(query.toLowerCase());
  });
}

async function scrapeMeta(id) {
  const hash = String(id || "").replace(/^tokyotosho:/, "").toLowerCase();
  const html = await getText(`${BASE_URL}/index.php?cat=${JAV_CAT}&q=${hash}`);
  const items = parseEntries(html);
  const match = items.find(i => i.infoHash === hash);
  if (!match) return { id, type: "movie", name: hash.slice(0, 12) };
  return { id, type: "movie", name: match.name };
}

async function scrapeStreams(id) {
  const hash = String(id || "").replace(/^tokyotosho:/, "").toLowerCase();
  try {
    for (let page = 1; page <= 3; page++) {
      const html = await getText(`${BASE_URL}/index.php?cat=${JAV_CAT}&page=${page}`);
      const items = parseEntries(html);
      const match = items.find(i => i.infoHash === hash);
      if (match) {
        return [{
          name: "🗾 Tokyo",
          title: "Tokyo \u2022 Torrent",
          infoHash: match.infoHash,
          sources: (match.trackers && match.trackers.length) ? match.trackers : [
            "tracker:udp://tracker.opentrackr.org:1337/announce",
            "tracker:udp://open.stealth.si:80/announce",
            "tracker:udp://tracker.torrent.eu.org:451/announce",
          ],
          seeders: match.seeders || 0,
          behaviorHints: { bingeGroup: "tokyotosho", notWebReady: false }
        }];
      }
      if (!items.length) break;
    }
  } catch (e) { console.error("tokyotosho streams:", e.message); }
  return [];
}

module.exports = { scrapeCatalog, scrapeMeta, scrapeStreams };
