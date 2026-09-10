const dns = require("node:dns");
dns.setDefaultResultOrder("ipv4first");

const { scrapeCatalog: scrapeAvmirror, scrapeMeta: metaAvmirror, scrapeStreams: streamsAvmirror } = require("../scrapers/avmirror");
const { scrapeJavquickCatalog, scrapeJavquickMeta, scrapeJavquickStreams } = require("../scrapers/javquick");
const { scrapeHohojCatalog, scrapeHohojMeta, scrapeHohojStreams } = require("../scrapers/hohoj");
const { scrapeCatalog: scrapeGGJav, scrapeMeta: metaGGJav, scrapeStreams: streamsGGJav } = require("../scrapers/ggjav");
const { scrapeCatalog: scrapeJavmenu, scrapeMeta: metaJavmenu, scrapeStreams: streamsJavmenu } = require("../scrapers/javmenu");
const { scrapeGoodav17Catalog, scrapeGoodav17Meta, scrapeGoodav17Streams } = require("../scrapers/goodav17");
const { scrapeAvjoyCatalog, scrapeAvjoyMeta, scrapeAvjoyStreams } = require("../scrapers/avjoy");
const { scrapeCatalog: scrapeIJavCatalog, scrapeMeta: scrapeIJavMeta, scrapeStreams: scrapeIJavStreams } = require("../scrapers/ijavtorrent");
const { scrapeCatalog: scrapeProjectjav, scrapeMeta: metaProjectjav, scrapeStreams: streamsProjectjav } = require("../scrapers/projectjav");
const { scrapeCatalog: scrapeFfjav, scrapeMeta: metaFfjav, scrapeStreams: streamsFfjav } = require("../scrapers/ffjav");
	const { scrapeCatalog: scrapeSukebeiNyaa, scrapeMeta: metaSukebeiNyaa, scrapeStreams: streamsSukebeiNyaa } = require("../scrapers/sukebeinyaa");
	const { scrapeCatalog: scrapeNyaa, scrapeMeta: metaNyaa, scrapeStreams: streamsNyaa } = require("../scrapers/nyaa");
const { scrapeCatalog: scrapeBtdig, scrapeMeta: metaBtdig, scrapeStreams: streamsBtdig } = require("../scrapers/btdig");
const { scrapeCatalog: scrapeTokyoToshokan, scrapeMeta: metaTokyoToshokan, scrapeStreams: streamsTokyoToshokan } = require("../scrapers/tokyo-tosho");
const { scrapeCatalog: scrapeMissav, scrapeMeta: metaMissav, scrapeStreams: streamsMissav } = require("../scrapers/missav");
const { scrapeCatalog: scrapeJavdb, searchCode: searchJavdb } = require("../scrapers/javdb");
const { findSubtitles } = require("../scrapers/avsubtitles");
const { findSubtitleCat } = require("../scrapers/subtitlecat");
const { scrapeCatalog: scrapeZeroMagnet, scrapeMeta: metaZeroMagnet, scrapeStreams: streamsZeroMagnet } = require("../scrapers/zeromagnet");
const { scrapeCatalog: scrapeYB, metaYB, streamsYB } = require("../scrapers/yourbittorrent");
const { rankTorrents } = require("./peer-probe");
const { readCatalogCache } = require("./catalog-cache");
const { resolveTorrentFile } = require("./torrent-metadata");
const { getTrackers } = require("./tracker-list");

// fetch-retry.js does not export getSourceMetrics; the one in module.exports below is local

const CROSS_SOURCE_TIMEOUT_MS = 25000;
const STREAM_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — reduces CF Worker requests
const CODE_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes — cache torrent results by JAV code
const PRIMARY_STREAM_TIMEOUT_MS = Number(process.env.PRIMARY_STREAM_TIMEOUT_MS || 10000);
const STREAM_RETRY_PREFIXES = new Set(["zeromagnet", "projectjav", "ffjav", "sukebeinyaa", "btdig", "javdb", "tokyotosho"]);
const STREAM_RETRY_DELAYS_MS = [180, 500];
// These trackers are sent to the Stremio client as direct P2P sources. The
// list is refreshed from the same public best-trackers feed used by Torrentio;
// tracker-list.js keeps a local fallback so a temporary fetch failure never
// removes torrent playback.
const DIRECT_P2P_TRACKERS = getTrackers;
const streamCache = new Map();
const streamPending = new Map();
const codeCache = new Map(); // code → { streams, expiresAt }
const sourceMetrics = new Map();

// Top 5 most reliable torrent sources (reduce CF Worker usage)
const CROSS_SOURCE_TORRENT = ["yourbittorrent", "sukebeinyaa", "nyaa", "zeromagnet", "ijavtorrent", "ffjav", "projectjav", "btdig", "tokyotosho", "javdb"];

// Dynamic source scoring — tracks success rate and avg seeders per source
const sourceScores = {};
function getOrCreateScore(prefix) {
  if (!sourceScores[prefix]) sourceScores[prefix] = { hits: 0, misses: 0, totalSeeders: 0, queries: 0 };
  return sourceScores[prefix];
}
function recordSourceResult(prefix, success, seeders = 0) {
  const s = getOrCreateScore(prefix);
  s.queries++;
  if (success) { s.hits++; s.totalSeeders += seeders; } else { s.misses++; }
}
function getSourceScore(prefix) {
  const s = sourceScores[prefix];
  if (!s || s.queries === 0) return 50; // default score for untested sources
  const successRate = s.hits / s.queries;
  const avgSeeders = s.totalSeeders / Math.max(1, s.hits);
  return Math.round(successRate * 60 + Math.min(avgSeeders, 20) * 2);
}
function sortSourcesByScore(sources) {
  return [...sources].sort((a, b) => getSourceScore(b.prefix) - getSourceScore(a.prefix));
}

// Periodic cleanup of stale cache entries
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of streamCache) {
    if (entry.expiresAt <= now) streamCache.delete(key);
  }
  for (const [key, entry] of codeCache) {
    if (entry.expiresAt <= now) codeCache.delete(key);
  }
}, 60_000).unref();
const torrentRegistry = new Map(); // hash → { alternatives: [{hash, trackers}], expiresAt: number }
const REGISTRY_TTL_MS = 10 * 60 * 1000; // 10 minutes
const maskedNames = { avmirror: "🍎 Apple", javquick: "🍊 Orange", hohoj: "🍇 Grape", ggjav: "🍓 Strawberry", javmenu: "🍒 Cherry", goodav17: "🍍 Pineapple", avjoy: "🥭 Mango", ijavtorrent: "🍉 Watermelon", projectjav: "🫐 Blueberry", ffjav: "🥝 Kiwi", sukebeinyaa: "🍣 Sashimi", nyaa: "🗾 Nyaa", btdig: "🧃 Guava", missav: "🍋 Lemon", javdb: "🫒 Olive", tokyotosho: "🗾 Tokyo", zeromagnet: "🍑 Peach" };
function withTimeout(promise, ms = CROSS_SOURCE_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("cross-source timeout")), ms); })
  ]);
}
function streamUrlKey(stream) {
  return String(stream?.url || stream?.externalUrl || (stream?.infoHash ? `torrent:${stream.infoHash}` : "")).trim();
}
function normalizeTorrentStream(stream) {
  if (!stream?.infoHash) return stream;
  const infoHash = String(stream.infoHash).trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(infoHash)) return null;
  const supplied = Array.isArray(stream.sources) ? stream.sources : (Array.isArray(stream.trackers) ? stream.trackers : []);
  const sources = [];
  const seen = new Set();
  function isValidTracker(url) {
    if (!/^(?:udp|http|https|wss):\/\//i.test(url)) return false;
    if (url.includes("shittyurl")) return false;
    if (/\/forums\/tracker:/i.test(url)) return false;
    if (/tracker\.[a-z]+\.[a-z]+:\d+$/i.test(url) && !url.includes("/announce") && !url.includes("wss://")) return false;
    return true;
  }
  for (const raw of [...DIRECT_P2P_TRACKERS(), ...supplied]) {
    const value = String(raw || "").trim().replace(/^tracker:/i, "");
    if (!isValidTracker(value)) continue;
    const source = `tracker:${value}`;
    if (!seen.has(source.toLowerCase())) { seen.add(source.toLowerCase()); sources.push(source); }
  }
  sources.push(`dht:${infoHash}`);
  return { ...stream, infoHash, sources };
}
async function resolveSourceStreams(source, id, timeoutMs) {
  const attempts = STREAM_RETRY_PREFIXES.has(source.prefix) ? STREAM_RETRY_DELAYS_MS.length + 1 : 1;
  const merged = [];
  const seen = new Set();
  let lastError;
  const start = Date.now();
  let success = false;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const result = await withTimeout(source.streams(id), timeoutMs);
      for (const originalStream of Array.isArray(result) ? result : []) {
        const stream = normalizeTorrentStream(originalStream);
        if (!stream) continue;
        const key = streamUrlKey(stream);
        if (key && !seen.has(key)) { seen.add(key); merged.push(stream); }
      }
      success = true;
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts - 1) await new Promise(resolve => setTimeout(resolve, STREAM_RETRY_DELAYS_MS[attempt]));
  }
  const elapsed = Date.now() - start;
  const m = sourceMetrics.get(source.prefix) || { calls: 0, errors: 0, totalMs: 0, last10: [] };
  m.calls++;
  if (!success) m.errors++;
  m.totalMs += elapsed;
  m.last10.push(elapsed);
  if (m.last10.length > 10) m.last10.shift();
  sourceMetrics.set(source.prefix, m);
  if (merged.length) return merged;
  if (lastError) throw lastError;
  return [];
}

const GENRE_MAP = {
  // English
  "ol": "Office Lady", "office lady": "Office Lady",
  "drama": "Drama", "solowork": "Solo Work",
  "creampie": "Creampie", "big tits": "Big Tits",
  "blowjob": "Blowjob", "handjob": "Handjob",
  "cowgirl": "Cowgirl", "mature": "Mature",
  "amateur": "Amateur", "slender": "Slender",
  "squirting": "Squirting", "voyeur": "Voyeur",
  "massage": "Massage", "schoolgirl": "Schoolgirl",
  "uniform": "Uniform", "cosplay": "Cosplay",
  // Japanese → English
  "制服誘惑": "Uniform", "無碼流出": "Uncensored",
  "高畫質": "HD", "單體作品": "Solo Work",
  "角色劇情": "Drama", "出軌": "Cuckold",
  "強姦凌辱": "Rape", "人妻": "Married Woman",
  "業餘": "Amateur", "口交": "Blowjob",
  "羞恥": "Embarrassment", "中出": "Creampie",
  "群交": "Orgy", "輪姦": "Gangbang",
  "內射受孕": "Creampie", "巨乳": "Big Tits",
  "淫語": "Dirty Talk", "凌辱": "Rape",
  "痴漢": "Groper", "風俗": "Massage",
  "女教師": "Teacher", "actly": "Anal",
  "企劃": "Fantasy", "ハメ撮り": "POV",
  "1080p": "HD", "hd": "HD",
  "jav": "JAV", "uncensored": "Uncensored",
  "chinese sub": "Chinese Sub",
};

function normalizeGenre(g) {
  const lower = (g || "").trim().toLowerCase();
  return GENRE_MAP[lower] || GENRE_MAP[g] || g;
}

function extractCode(title) {
  const value = String(title || "");
  const m = value.match(/\b([A-Z][A-Z0-9]*?)-?(\d{2,6})(?!\d)/i);
  if (!m) return null;
  return `${m[1].toUpperCase()}-${m[2]}`;
}

function normalizeCode(code) {
  return String(code || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function codeMatches(a, b) {
  if (!a || !b) return false;
  return normalizeCode(a) === normalizeCode(b);
}

const { stripTags: _stripTags } = require("./scraper-utils");

function stripTags(h) { return _stripTags(h); }

const ALL_SOURCES = [
  {
    name: "Apple",
    prefix: "avmirror",
    catalog: (opts) => scrapeAvmirror(opts),
    meta: metaAvmirror,
    streams: streamsAvmirror,
    posterQuality: 2,
    streamName: "Apple • HTTP",
  },
  {
    name: "Orange",
    prefix: "javquick",
    catalog: (opts) => scrapeJavquickCatalog(opts),
    meta: scrapeJavquickMeta,
    streams: scrapeJavquickStreams,
    posterQuality: 1,
    streamName: "Orange • MP4",
  },
  {
    name: "Grape",
    prefix: "hohoj",
    catalog: (opts) => scrapeHohojCatalog(opts),
    meta: scrapeHohojMeta,
    streams: scrapeHohojStreams,
    posterQuality: 3,
    streamName: "Grape • HTTP",
  },
  {
    name: "Strawberry",
    prefix: "ggjav",
    catalog: (opts) => scrapeGGJav(opts),
    meta: metaGGJav,
    streams: streamsGGJav,
    posterQuality: 3,
    streamName: "Strawberry • HTTP",
  },
  {
    name: "Cherry",
    prefix: "javmenu",
    catalog: (opts) => scrapeJavmenu(opts),
    meta: metaJavmenu,
    streams: streamsJavmenu,
    posterQuality: 2,
    streamName: "Cherry • HTTP",
  },
  {
    name: "Pineapple",
    prefix: "goodav17",
    catalog: (opts) => scrapeGoodav17Catalog(opts),
    meta: scrapeGoodav17Meta,
    streams: scrapeGoodav17Streams,
    posterQuality: 2,
    streamName: "Pineapple • HTTP",
  },
  {
    name: "Mango",
    prefix: "avjoy",
    catalog: (opts) => scrapeAvjoyCatalog(opts),
    meta: scrapeAvjoyMeta,
    streams: scrapeAvjoyStreams,
    posterQuality: 2,
    streamName: "Mango • MP4",
  },
  {
    name: "Watermelon",
    prefix: "ijavtorrent",
    catalog: (opts) => scrapeIJavCatalog(opts),
    meta: scrapeIJavMeta,
    streams: scrapeIJavStreams,
    posterQuality: 2,
    streamName: "Watermelon • Torrent",
  },
  {
    name: "Blueberry",
    prefix: "projectjav",
    catalog: (opts) => scrapeProjectjav(opts),
    meta: metaProjectjav,
    streams: streamsProjectjav,
    posterQuality: 2,
    streamName: "Blueberry • Torrent",
  },
  {
    name: "Kiwi",
    prefix: "ffjav",
    catalog: (opts) => scrapeFfjav(opts),
    meta: metaFfjav,
    streams: streamsFfjav,
    posterQuality: 2,
    streamName: "Kiwi • Torrent",
  },
	{
	  name: "Sashimi",
    prefix: "sukebeinyaa",
    catalog: (opts) => scrapeSukebeiNyaa(opts),
    meta: metaSukebeiNyaa,
    streams: streamsSukebeiNyaa,
    posterQuality: 1,
	  streamName: "Sashimi • Torrent",
	},
	{
	  name: "Nyaa",
	  prefix: "nyaa",
	  catalog: (opts) => scrapeNyaa(opts),
	  meta: metaNyaa,
	  streams: streamsNyaa,
	  posterQuality: 1,
	  streamName: "Nyaa • Torrent",
	},
  {
    name: "Guava",
    prefix: "btdig",
    catalog: (opts) => scrapeBtdig(opts),
    meta: metaBtdig,
    streams: streamsBtdig,
    posterQuality: 1,
    streamName: "Guava \u2022 Torrent",
  },
  {
    name: "Tokyo",
    prefix: "tokyotosho",
    catalog: (opts) => scrapeTokyoToshokan(opts),
    meta: metaTokyoToshokan,
    streams: streamsTokyoToshokan,
    posterQuality: 1,
    streamName: "Tokyo \u2022 Torrent",
  },
  {
    name: "Lemon",
    prefix: "missav",
    catalog: (opts) => scrapeMissav(opts),
    meta: metaMissav,
    streams: streamsMissav,
    posterQuality: 2,
    streamName: "Lemon • HTTP",
  },
  {
    name: "Olive",
    prefix: "javdb",
    catalog: (opts) => scrapeJavdb(opts),
    meta: async (id) => null,
    streams: async (id) => {
      // Extract code from id and search for magnets
      const code = extractCode(id);
      if (!code) return [];
      try {
        const items = await searchJavdb(code);
        return items.map(m => ({
          infoHash: m.infoHash,
          name: m.name,
          title: m.name,
          sources: (m.trackers && m.trackers.length) ? m.trackers : getTrackers().map(t => `tracker:${t}`),
        }));
      } catch { return []; }
    },
    posterQuality: 2,
    streamName: "Olive • Torrent",
  },
  {
    name: "Peach",
    prefix: "zeromagnet",
    catalog: (opts) => scrapeZeroMagnet(opts),
    meta: metaZeroMagnet,
    streams: streamsZeroMagnet,
    posterQuality: 1,
    streamName: "Peach • Torrent",
  },
  {
    name: "Mango",
    prefix: "yourbittorrent",
    catalog: (opts) => scrapeYB(opts),
    meta: metaYB,
    streams: streamsYB,
    posterQuality: 1,
    streamName: "Mango • Torrent",
  },
];
// Deliberately keep the production resolver focused: Jav.guru is the only
// HTTP source; every other active source must be a torrent indexer.
const ACTIVE_SOURCE_PREFIXES = new Set([
	  "avmirror", "yourbittorrent", "ijavtorrent", "projectjav", "ffjav", "sukebeinyaa", "nyaa",
  "btdig", "tokyotosho", "javdb", "zeromagnet",
]);
const SOURCES = ALL_SOURCES.filter(source => ACTIVE_SOURCE_PREFIXES.has(source.prefix));

async function unifiedCatalog({ page = 1, search = "", genre = "", tag = "", mode = "" } = {}) {
  const isSearch = !!search;
  const searchCode = isSearch ? extractCode(search) : null;
  const isTextSearch = isSearch && !searchCode;

  // If mode specifies a source prefix, use that source directly
  const requestedSource = SOURCES.find(s => s.prefix === mode);
  if (requestedSource) {
    try { return await requestedSource.catalog({ page, search, genre, tag, mode }); } catch { return []; }
  }
  const cacheMode = mode || "avmirror";
  if (!search && !genre && !tag && ["avmirror", "avmirror-popular", "avmirror-uncensored", "avmirror-censored"].includes(cacheMode)) {
    const cached = readCatalogCache(cacheMode, page);
    if (cached) return cached;
  }

  try {
    // The public catalog is intentionally owned by AVMirror/Nova only. The
    // other sources are resolved later by unifiedStreams for the selected item.
    if (isSearch && isTextSearch) {
      return await SOURCES[0].catalog({ page, search, genre, tag, mode: "avmirror-actors" });
    }
    return await SOURCES[0].catalog({ page, search, genre, tag, mode: mode || "avmirror" });
  } catch (primaryError) {
    // Graceful degradation: if the primary source fails, try other sources
    if (isSearch || genre || tag) return [];
    for (const fallbackSource of SOURCES.slice(1, 4)) {
      try {
        const result = await withTimeout(fallbackSource.catalog({ page, search, genre, tag, mode: mode || "avmirror" }), 10000);
        if (result && result.length) return result;
      } catch {}
    }
    return [];
  }
}

async function unifiedMeta(id) {
  const prefix = String(id || "").split(":")[0];

  let primaryMeta = null;

  // Try to get meta from the source that owns this ID
  const source = SOURCES.find(s => s.prefix === prefix);
  if (source) {
    try { primaryMeta = await source.meta(id); } catch {}
  }

  if (!primaryMeta) return null;

  const titleCode = extractCode(primaryMeta.name);
  if (!titleCode) {
    const displayName = String(primaryMeta.name || primaryMeta.title || "").trim();
    return { ...primaryMeta, name: displayName, title: displayName, links: primaryMeta.links || [] };
  }

  // Some source detail pages omit og:image even though their catalog card has
  // a valid poster. Keep library/history covers available by recovering that
  // poster from the owning source catalog.
  if (!primaryMeta.poster) {
    try {
      const catalogItems = await source.catalog({ search: titleCode, page: 1 });
      const catalogMatch = (catalogItems || []).find(item => item.id === id && item.poster)
        || (catalogItems || []).find(item => codeMatches(extractCode(item.name), titleCode) && item.poster);
      if (catalogMatch?.poster) primaryMeta = { ...primaryMeta, poster: catalogMatch.poster };
    } catch {}
  }

  // Search other sources for the same code (exact match)
  const otherSources = SOURCES.filter(s => s.prefix !== prefix);
  const extraMetas = await Promise.all(
    otherSources.map(async (src) => {
      try {
        const items = await src.catalog({ search: titleCode, page: 1 });
        const match = items.find(i => codeMatches(extractCode(i.name), titleCode));
        if (match) return await src.meta(match.id);
      } catch {}
      return null;
    })
  );

  const allMetas = [primaryMeta, ...extraMetas.filter(Boolean)];

  // Merge genres (normalize and filter non-English)
  const genreSet = new Set();
  for (const m of allMetas) {
    if (m.genre) m.genre.forEach(g => {
      const norm = normalizeGenre(g);
      if (norm && !/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(norm)) genreSet.add(norm);
    });
  }

  // Merge cast (prefer English, deduplicate)
  const castEnglish = [];
  const castJapanese = [];
  const CAST_DIRTY_RE = /ranking|more movies|>>|movies from|actress list|actor list|popular|featured|best of|top \d/i;
  for (const m of allMetas) {
    if (!m.cast) continue;
    for (const a of m.cast) {
      if (!a || a.length > 80 || CAST_DIRTY_RE.test(a)) continue;
      if (/[a-zA-Z]{3,}/.test(a)) {
        if (!castEnglish.includes(a)) castEnglish.push(a);
      } else {
        if (!castJapanese.includes(a)) castJapanese.push(a);
      }
    }
  }
  // If we have English names, drop Japanese ones (they're duplicates in different scripts)
  // Also deduplicate by normalized name (e.g. "mia kamiki" and "mia kamiki mia kamiki")
  const finalCast = castEnglish.length > 0 ? castEnglish : castJapanese;
  const normalizedCast = [];
  const seenNorms = new Set();
  for (const name of finalCast) {
    const norm = name.toLowerCase().replace(/\s+/g, " ").trim();
    // Skip if a shorter name is already a prefix (e.g. "mia kamiki" covers "mia kamiki mia kamiki")
    let isDupe = false;
    for (const sn of seenNorms) {
      if (norm.startsWith(sn) || sn.startsWith(norm)) { isDupe = true; break; }
    }
    if (!isDupe) { normalizedCast.push(name); seenNorms.add(norm); }
  }

  // Pick best poster (prefer primary, then highest quality)
  let bestPoster = primaryMeta.poster;
  for (const m of extraMetas) {
    if (m?.poster && !m.poster.includes("favicon")) {
      if (!bestPoster || bestPoster.includes("favicon")) bestPoster = m.poster;
    }
  }

  // Merge descriptions (prefer English, deduplicated)
  const englishDescs = [];
  const otherDescs = [];
  const seenDescs = new Set();
  for (const m of allMetas) {
    const d = stripTags(m.description);
    if (!d || seenDescs.has(d)) continue;
    seenDescs.add(d);
    const hasEnglish = /[a-zA-Z]{3,}/.test(d) && !/[\u4e00-\u9fff]/.test(d);
    if (hasEnglish) englishDescs.push(d); else otherDescs.push(d);
  }
  const finalDesc = englishDescs.length > 0 ? englishDescs.join("\n\n") : otherDescs.join("\n\n");

  const displayName = String(primaryMeta.name || primaryMeta.title || titleCode).trim();
  return {
    id,
    type: "movie",
    name: displayName,
    title: displayName,
    poster: bestPoster,
    description: finalDesc,
    genre: [...genreSet],
    cast: normalizedCast,
    releaseInfo: primaryMeta.releaseInfo,
    runtime: primaryMeta.runtime,
  };
}

function mergeStreams(allStreams, subtitleRefs = []) {
  const httpStreams = [];
  const torrentStreams = [];
  const withSubtitles = stream => subtitleRefs.length ? { ...stream, subtitleRefs } : stream;
  for (const s of allStreams) {
    if (s.infoHash) { torrentStreams.push(s); continue; }
    if (s.url) httpStreams.push(s);
  }
  const result = [];
  if (httpStreams.length > 0) {
    result.push(withSubtitles({ ...httpStreams[0], name: "\uD83C\uDF10 HTTP", title: "HTTP \u2022 Auto" }));
  }
  // Prefer a live probe. Some hosting networks block tracker announces, so
  // when every probe is inconclusive retain all torrent candidates for ranking
  // by indexed seeders; a torrent with 3 or even 0 indexed seeds can still be
  // downloadable through DHT, cached peers, or later announces.
  const liveTorrentStreams = torrentStreams.filter(stream => stream.peerProbeLive === true);
  const availableTorrentStreams = liveTorrentStreams.length
    ? liveTorrentStreams
    : torrentStreams.length
      ? torrentStreams
      : [];
  if (availableTorrentStreams.length > 0) {
    function getSeeders(s) { return s.rankingSeeders ?? s.seeders ?? s.behaviorHints?.seeders ?? 0; }
    function getTorrentPriority(s) {
      const group = String(s.behaviorHints?.bingeGroup || "");
      // Dynamic scoring: higher score = higher priority (lower index = higher priority)
      const score = getSourceScore(group);
      return -score; // negative so higher score = lower sort value = higher priority
    }
    const uniqueByHash = new Map();
    for (const s of availableTorrentStreams) {
      const h = s.infoHash.toLowerCase();
      const existing = uniqueByHash.get(h);
      if (!existing || getSeeders(s) > getSeeders(existing)) uniqueByHash.set(h, s);
    }
    const sorted = [...uniqueByHash.values()].sort((a, b) => {
      const bySeeders = getSeeders(b) - getSeeders(a);
      return bySeeders || getTorrentPriority(a) - getTorrentPriority(b);
    });
    // Expose exactly one torrent player. All other valid hashes remain in the
    // internal registry as alternatives, while the client receives the best
    // known swarm instead of multiple torrent buttons.
    const selected = sorted[0];
    const seederCount = getSeeders(selected);
    const livePeerCount = Number(selected.livePeers || 0);
    const trackerCount = Array.isArray(selected.sources) ? selected.sources.length : 0;
    const availabilityInfo = selected.peerProbeLive && livePeerCount
      ? ` \u2022 ${livePeerCount} peers reais`
      : (seederCount ? ` \u2022 ${seederCount} seeds (indexados)` : "")
        + (trackerCount ? ` \u2022 ${trackerCount} trackers` : "");
    const torrentStream = {
      ...selected,
      name: "\u26A1 Torrent",
      title: `Torrent \u2022 Auto${availabilityInfo}`,
      sources: selected.sources || getTrackers().map(t => `tracker:${t}`),
      behaviorHints: { ...(selected.behaviorHints || {}), notWebReady: false, bingeGroup: "avmirror-torrent" },
    };
    result.push(withSubtitles(torrentStream));
  }
  return result;
}

async function resolveUnifiedStreams(id) {
  const prefix = String(id || "").split(":")[0];
  const source = SOURCES.find(s => s.prefix === prefix);
  if (!source) return [];

  let primaryStreams = [];
  try { primaryStreams = await resolveSourceStreams(source, id, PRIMARY_STREAM_TIMEOUT_MS); } catch (e) { console.error(`stream error [${maskedNames[prefix] || prefix}]:`, e.message?.substring(0, 80)); }

  // Extract the code from the encoded source URL first. Metadata is a slow,
  // optional enrichment and must not block the player resolution path.
  let code = null;
  let castName = null;
  try {
    const encoded = String(id || "").split(":").slice(1).join(":");
    if (encoded) code = extractCode(Buffer.from(encoded, "base64url").toString());
  } catch {}
  if (!code) {
    try {
      const meta = await withTimeout(source.meta(id), 4000);
      if (meta) {
        code = extractCode(meta.name);
        if (meta.cast && meta.cast.length) castName = meta.cast.find(n => n && n.length >= 3) || null;
      }
    } catch {}
  }

  if (!code) { console.error(`no code for ${prefix} id=${id}`); return primaryStreams; }

  // Start subtitle enrichment in parallel; it must never delay stream sources.
  const subtitlePromise = withTimeout(Promise.all([
    findSubtitles(code).catch(e => { console.error(`subtitle source [AVSubtitles]:`, e.message?.substring(0, 80)); return []; }),
    findSubtitleCat(code).catch(e => { console.error(`subtitle source [SubtitleCat]:`, e.message?.substring(0, 80)); return []; }),
  ]), 20000)
    .then(groups => groups.flat().sort((a, b) => Number(a.source !== "avsubtitles") - Number(b.source !== "avsubtitles")))
    .catch(() => []);

  // Check code cache first (30min TTL — reduces CF Worker requests)
  const cachedCode = codeCache.get(code);
  if (cachedCode && cachedCode.expiresAt > Date.now()) {
    const merged = mergeStreams([...primaryStreams, ...cachedCode.streams], await subtitlePromise);
    return merged;
  }

  const otherSources = sortSourcesByScore(SOURCES.filter(s => s.prefix !== prefix));
  console.error(`[xs] sources: ${otherSources.map(s => s.prefix).join(", ")} | code: ${code}`);
  const extraStreamsPromises = otherSources.map(async (src) => {
    try {
      let items = await withTimeout(src.catalog({ search: code, page: 1 }), CROSS_SOURCE_TIMEOUT_MS);
      let matches = items.filter(i => codeMatches(extractCode(i.name), code));
      console.error(`[xs] ${src.prefix}: ${items.length} items, ${matches.length} match`);
      if (!matches.length && castName) {
        try {
          const castItems = await withTimeout(src.catalog({ search: castName, page: 1 }), 15000);
          matches = castItems.filter(i => codeMatches(extractCode(i.name), code));
        } catch {}
      }
      if (!matches.length) { recordSourceResult(src.prefix, false, 0); return []; }
      if (CROSS_SOURCE_TORRENT.includes(src.prefix)) {
        const torrents = [];
        const label = maskedNames[src.prefix] || src.prefix.toUpperCase();
        for (const m of matches) {
          if (m.infoHash) {
            const torrent = normalizeTorrentStream(m);
            if (!torrent) continue;
            if (!torrent.sources && torrent.trackers) torrent.sources = torrent.trackers;
            const seederCount = torrent.seeders || torrent.behaviorHints?.seeders || 0;
            const seederInfo = seederCount ? ` \u2022 ${seederCount} seeds` : "";
            torrent.name = label;
            torrent.title = `${label} \u2022 Torrent${seederInfo}`;
            torrent.behaviorHints = { ...(torrent.behaviorHints || {}), notWebReady: false, bingeGroup: src.prefix };
            torrents.push(torrent);
          }
        }
        if (torrents.length) {
          const bestSeeders = Math.max(0, ...torrents.map(t => t.seeders || 0));
          recordSourceResult(src.prefix, true, bestSeeders);
          return torrents;
        }
        recordSourceResult(src.prefix, false, 0);
        return await resolveSourceStreams(src, matches[0].id, 12000);
      }
      const streams = await resolveSourceStreams(src, matches[0].id, 12000);
      recordSourceResult(src.prefix, streams.length > 0, 0);
      return streams;
    } catch (e) { console.error(`cross-source [${maskedNames[src.prefix] || src.prefix}]:`, e.message?.substring(0, 80)); recordSourceResult(src.prefix, false, 0); }
    return [];
  });

  const extraResults = await Promise.allSettled(extraStreamsPromises);

  const seen = new Set();
  const seenHashes = new Set();
  const allStreams = [];
  const allTorrents = [];

  function streamKey(s, sourcePrefix) {
    const base = s.url || s.externalUrl || (s.infoHash ? `torrent:${s.infoHash}` : "");
    return base ? `${sourcePrefix}:${base}` : "";
  }

  for (const s of primaryStreams) {
    const key = streamKey(s, prefix);
    if (!key || seen.has(key)) continue;
    if (s.infoHash) {
      const h = s.infoHash.toLowerCase();
      if (seenHashes.has(h)) continue;
      seenHashes.add(h);
    }
    seen.add(key);
    const label = maskedNames[prefix] || prefix.toUpperCase();
    const suffix = s.infoHash ? "Torrent" : "Auto";
    const seederCount = s.seeders || s.behaviorHints?.seeders || 0;
    const seederInfo = seederCount ? ` \u2022 ${seederCount} seeds` : "";
    allStreams.push({ ...s, name: label, title: `${label} • ${suffix}${seederInfo}` });
    if (s.infoHash) allTorrents.push(s);
  }

  for (let i = 0; i < otherSources.length; i++) {
    const src = otherSources[i];
    const settled = extraResults[i];
    const results = settled?.status === "fulfilled" ? (settled.value || []) : [];
    const label = maskedNames[src.prefix] || src.prefix.toUpperCase();
    for (const s of results) {
      const key = streamKey(s, src.prefix);
      if (!key || seen.has(key)) continue;
      if (s.infoHash) {
        const h = s.infoHash.toLowerCase();
        if (seenHashes.has(h)) continue;
        seenHashes.add(h);
      }
      seen.add(key);
      const suffix = s.infoHash ? "Torrent" : "Auto";
      const seederCount = s.seeders || s.behaviorHints?.seeders || 0;
      const seederInfo = seederCount ? ` \u2022 ${seederCount} seeds` : "";
      allStreams.push({ ...s, name: label, title: `${label} • ${suffix}${seederInfo}` });
      if (s.infoHash) allTorrents.push(s);
    }
  }

  // Ask trackers for current swarm counts before selecting the single torrent
  // player. If trackers do not answer, rankTorrents falls back to indexer data.
  const rankedTorrents = await rankTorrents(allTorrents);
  if (rankedTorrents.length) {
    const byHash = new Map(rankedTorrents.map(stream => [stream.infoHash.toLowerCase(), stream]));
    for (let i = 0; i < allStreams.length; i++) {
      const stream = allStreams[i];
      if (stream.infoHash) allStreams[i] = byHash.get(stream.infoHash.toLowerCase()) || stream;
    }
    allTorrents.splice(0, allTorrents.length, ...rankedTorrents);
  }

  // Register all torrent hashes for this content so the endpoint can try fallbacks
  if (allTorrents.length > 1) {
    const uniqueTorrents = [];
    const seenHashesUnique = new Set();
    for (const t of allTorrents) {
      const h = t.infoHash.toLowerCase();
      if (seenHashesUnique.has(h)) continue;
      seenHashesUnique.add(h);
      uniqueTorrents.push(t);
    }
    for (const t of uniqueTorrents) {
      const h = t.infoHash.toLowerCase();
      const others = uniqueTorrents
        .filter(x => x.infoHash.toLowerCase() !== h)
        .map(x => ({ hash: x.infoHash.toLowerCase(), trackers: (x.sources || []).map(s => s.replace(/^tracker:/, "")) }));
      const existing = (torrentRegistry.get(h) || {}).alternatives || [];
      const deduped = [...existing];
      const seen = new Set(deduped.map(a => a.hash));
      for (const o of others) {
        if (!seen.has(o.hash)) { deduped.push(o); seen.add(o.hash); }
      }
      torrentRegistry.set(h, { alternatives: deduped, expiresAt: Date.now() + REGISTRY_TTL_MS });
    }
  }

  // Resolve only the torrent that will be exposed to the client. This asks
  // the swarm for metadata (file names/sizes) and never downloads media bytes.
  // Stremio needs fileIdx when a JAV torrent contains multiple video files.
  if (allTorrents.length) {
    const selectedTorrent = allTorrents[0];
    const enrichedTorrent = await resolveTorrentFile(selectedTorrent);
    const selectedHash = selectedTorrent.infoHash.toLowerCase();
    for (let i = 0; i < allStreams.length; i++) {
      if (allStreams[i].infoHash?.toLowerCase() === selectedHash) allStreams[i] = enrichedTorrent;
    }
  }

  const result = mergeStreams(allStreams, await subtitlePromise);

  const httpCount = result.filter(s => s.url && !s.infoHash).length;
  const torrentStreams = result.filter(s => s.infoHash);
  console.error(`[xs] FINAL: ${result.length} streams (${httpCount} http, ${torrentStreams.length} torrent) | code: ${code}`);
  for (const t of torrentStreams) {
    console.error(`[xs] torrent: hash=${t.infoHash} seeders=${t.seeders||0} trackers=${t.sources?.length||0} name=${(t.title||'').slice(0,60)}`);
  }

  // Store cross-source results in code cache (30min TTL)
  if (code && result.length > 0) {
    codeCache.set(code, { streams: allStreams, expiresAt: Date.now() + CODE_CACHE_TTL_MS });
  }

  return result;
}
async function unifiedStreams(id) {
  const key = String(id || "");
  const cached = streamCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (streamPending.has(key)) return streamPending.get(key);
  const request = resolveUnifiedStreams(id).then(value => {
    if (value?.length) streamCache.set(key, { value, expiresAt: Date.now() + STREAM_CACHE_TTL_MS });
    streamPending.delete(key);
    return value;
  }).catch(error => {
    streamPending.delete(key);
    throw error;
  });
  streamPending.set(key, request);
  return request;
}

async function unifiedPopular({ page = 1, search = "", genre = "", tag = "" } = {}) {
  if (!search && !genre && !tag) {
    const cached = readCatalogCache("avmirror-popular", page);
    if (cached) return cached;
  }
  try { return await SOURCES[0].catalog({ page, search, genre, tag, mode: "avmirror-popular" }); } catch { return []; }
}
async function unifiedUncensored({ page = 1, search = "", genre = "", tag = "" } = {}) {
  if (!search && !genre && !tag) {
    const cached = readCatalogCache("avmirror-uncensored", page);
    if (cached) return cached;
  }
  try { return await SOURCES[0].catalog({ page, search, genre, tag, mode: "avmirror-uncensored" }); } catch { return []; }
}
async function unifiedCensored({ page = 1, search = "", genre = "", tag = "" } = {}) {
  if (!search && !genre && !tag) {
    const cached = readCatalogCache("avmirror-censored", page);
    if (cached) return cached;
  }
  try { return await SOURCES[0].catalog({ page, search, genre, tag, mode: "avmirror-censored" }); } catch { return []; }
}

function cleanupRegistry() {
  const now = Date.now();
  for (const [hash, entry] of torrentRegistry) {
    if (entry.expiresAt <= now) torrentRegistry.delete(hash);
  }
}

module.exports = { unifiedCatalog, unifiedMeta, unifiedStreams, unifiedPopular, unifiedUncensored, unifiedCensored, SOURCES, torrentRegistry, cleanupRegistry, extractCode, normalizeTorrentStream, mergeStreams, getSourceMetrics: () => {
  const result = {};
  for (const [source, m] of sourceMetrics) {
    result[source] = {
      calls: m.calls,
      errors: m.errors,
      errorRate: m.calls > 0 ? (m.errors / m.calls * 100).toFixed(1) + "%" : "0%",
      avgMs: m.calls > 0 ? Math.round(m.totalMs / m.calls) : 0,
      p50Ms: m.last10.length > 0 ? [...m.last10].sort((a, b) => a - b)[Math.floor(m.last10.length / 2)] : 0,
    };
  }
  return result;
}, getSourceScores: () => {
  const result = {};
  for (const [prefix, s] of Object.entries(sourceScores)) {
    result[prefix] = {
      score: getSourceScore(prefix),
      hits: s.hits,
      misses: s.misses,
      queries: s.queries,
      successRate: s.queries > 0 ? (s.hits / s.queries * 100).toFixed(0) + "%" : "n/a",
      avgSeeders: s.hits > 0 ? (s.totalSeeders / s.hits).toFixed(1) : "n/a",
    };
  }
  return result;
}};
