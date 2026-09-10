const { parseCodeOf, parseMagnetTrackers, parseInfoHash, parseSizeBytes, makeCache, browserFetch } = require("../lib/scraper-utils");
const BASE_URL = "https://yourbittorrent.com";
const cache = makeCache(500, 5 * 60 * 1000);
const clean = v => String(v || "").replace(/\s+/g, " ").trim();

async function searchAPI(query) {
  const url = `${BASE_URL}/api/search.json?q=${encodeURIComponent(query)}&category=7&limit=20`;
  const hit = cache.get(url);
  if (hit) return hit;
  const r = await browserFetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`YourBittorrent HTTP ${r.status}`);
  const data = await r.json();
  cache.set(url, data);
  return data;
}

function matchCode(items, code) {
  if (!code) return items;
  const lower = code.toLowerCase();
  return items.filter(item => {
    const name = (item.name || "").toLowerCase();
    return name.includes(lower);
  });
}

async function scrapeCatalog({ page = 1, search = "" } = {}) {
  const query = String(search || "").trim();
  if (!query) return [];
  const data = await searchAPI(query);
  const results = data.results || [];
  const code = parseCodeOf(query);
  const matched = matchCode(results, code);
  return matched.map(item => ({
    id: `yb:${item.infohash}`,
    type: "movie",
    name: item.name,
    infoHash: (item.infohash || "").toLowerCase(),
    magnet: item.magnet,
    sizeText: item.size,
    seeders: item.seeds,
    leechers: item.peers,
    trackers: parseMagnetTrackers(item.magnet),
  }));
}

async function metaYB(id) { return null; }

async function streamsYB(id) {
  const code = parseCodeOf(id);
  if (!code) return [];
  try {
    const data = await searchAPI(code);
    const results = data.results || [];
    const matched = matchCode(results, code);
    return matched.map(item => {
      const infoHash = (item.infohash || "").toLowerCase();
      const trackers = parseMagnetTrackers(item.magnet);
      const sources = trackers.length
        ? trackers
        : [
            "tracker:udp://tracker.opentrackr.org:1337/announce",
            "tracker:udp://open.stealth.si:80/announce",
            "tracker:udp://tracker.torrent.eu.org:451/announce",
            "tracker:udp://exodus.desync.com:6969/announce",
          ];
      return {
        name: item.name,
        title: `[YourBittorrent] ${item.name} (${item.size || "?"}) [${item.seeds || 0} seeds]`,
        infoHash,
        sources,
        seeders: item.seeds || 0,
        sizeText: item.size,
        behaviorHints: { bingeGroup: "yourbittorrent", notWebReady: false },
      };
    });
  } catch { return []; }
}

module.exports = { scrapeCatalog, metaYB, streamsYB };
