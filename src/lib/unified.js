const { scrapeCatalog: scrapeAvmirror, scrapeMeta: metaAvmirror, scrapeStreams: streamsAvmirror } = require("../scrapers/avmirror");
const { scrapeJavquickCatalog, scrapeJavquickMeta, scrapeJavquickStreams } = require("../scrapers/javquick");
const { scrape18JavCatalog, scrape18JavMeta, scrape18JavStreams } = require("../scrapers/18jav");
const { scrapeHohojCatalog, scrapeHohojMeta, scrapeHohojStreams } = require("../scrapers/hohoj");
const { scrapeCatalog: scrapeGGJav, scrapeMeta: metaGGJav, scrapeStreams: streamsGGJav } = require("../scrapers/ggjav");
const { scrapeCatalog: scrapePorn87, scrapeMeta: metaPorn87, scrapeStreams: streamsPorn87 } = require("../scrapers/porn87");
const { scrapeCatalog: scrapeJavmenu, scrapeMeta: metaJavmenu, scrapeStreams: streamsJavmenu } = require("../scrapers/javmenu");
const { scrapeGoodav17Catalog, scrapeGoodav17Meta, scrapeGoodav17Streams } = require("../scrapers/goodav17");
const { scrapeAvjoyCatalog, scrapeAvjoyMeta, scrapeAvjoyStreams } = require("../scrapers/avjoy");

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
  const m = String(title || "").match(/([A-Z][A-Z0-9]+-\d+)/i);
  return m ? m[1].toUpperCase() : null;
}

function stripTags(h) { return String(h || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }

const SOURCES = [
  {
    name: "Nova",
    prefix: "avmirror",
    catalog: (opts) => scrapeAvmirror(opts),
    meta: metaAvmirror,
    streams: streamsAvmirror,
    posterQuality: 2,
    streamName: "Nova • Auto",
  },
  {
    name: "Pulse",
    prefix: "javquick",
    catalog: (opts) => scrapeJavquickCatalog(opts),
    meta: scrapeJavquickMeta,
    streams: scrapeJavquickStreams,
    posterQuality: 1,
    streamName: "Pulse • Auto",
  },
  {
    name: "Ember",
    prefix: "18jav",
    catalog: (opts) => scrape18JavCatalog(opts),
    meta: scrape18JavMeta,
    streams: scrape18JavStreams,
    posterQuality: 1,
    streamName: "Ember • Auto",
  },
  {
    name: "Apex",
    prefix: "hohoj",
    catalog: (opts) => scrapeHohojCatalog(opts),
    meta: scrapeHohojMeta,
    streams: scrapeHohojStreams,
    posterQuality: 3,
    streamName: "Apex • Auto",
  },
  {
    name: "Luna",
    prefix: "ggjav",
    catalog: (opts) => scrapeGGJav(opts),
    meta: metaGGJav,
    streams: streamsGGJav,
    posterQuality: 3,
    streamName: "Luna • Auto",
  },
  {
    name: "Jade",
    prefix: "porn87",
    catalog: (opts) => scrapePorn87(opts),
    meta: metaPorn87,
    streams: streamsPorn87,
    posterQuality: 2,
    streamName: "Jade • Auto",
  },
  {
    name: "Crimson",
    prefix: "javmenu",
    catalog: (opts) => scrapeJavmenu(opts),
    meta: metaJavmenu,
    streams: streamsJavmenu,
    posterQuality: 2,
    streamName: "Crimson • Auto",
  },
  {
    name: "Azure",
    prefix: "goodav17",
    catalog: (opts) => scrapeGoodav17Catalog(opts),
    meta: scrapeGoodav17Meta,
    streams: scrapeGoodav17Streams,
    posterQuality: 2,
    streamName: "Azure • Auto",
  },
  {
    name: "Solar",
    prefix: "avjoy",
    catalog: (opts) => scrapeAvjoyCatalog(opts),
    meta: scrapeAvjoyMeta,
    streams: scrapeAvjoyStreams,
    posterQuality: 2,
    streamName: "Solar • Auto",
  },
];

async function unifiedCatalog({ page = 1, search = "", genre = "", mode = "" } = {}) {
  const isSearch = !!search;
  const searchCode = isSearch ? extractCode(search) : null;
  const isTextSearch = isSearch && !searchCode;

  // If mode specifies a source prefix, use that source directly
  const requestedSource = SOURCES.find(s => s.prefix === mode);
  if (requestedSource) {
    try { return await requestedSource.catalog({ page, search, genre }); } catch { return []; }
  }

  try {
    if (isSearch) {
      if (isTextSearch) {
        // Actress/text search: search avmirror with actress mode + all other sources
        const [avmirrorResults, ...otherResults] = await Promise.all([
          SOURCES[0].catalog({ page, search, mode: "avmirror-actors" }),
          ...SOURCES.slice(1).map(async (src) => {
            try { return await src.catalog({ page, search }); } catch { return []; }
          })
        ]);
        return [...avmirrorResults, ...otherResults.flat()];
      }
      // Code search: search all sources
      const results = await Promise.all(
        SOURCES.map(async (src) => {
          try { return await src.catalog({ page, search }); } catch { return []; }
        })
      );
      return results.flat();
    }
    if (genre) {
      // Search genre as text across all sources
      const allResults = await Promise.all(
        SOURCES.map(async (src) => {
          try { return await src.catalog({ page, genre }); } catch { return []; }
        })
      );
      return allResults.flat();
    }
    // Merge all sources into a single catalog
    const allResults = await Promise.all(
      SOURCES.map(async (src) => {
        try { return await src.catalog({ page }); } catch { return []; }
      })
    );
    return allResults.flat();
  } catch { return []; }
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
  if (!titleCode) return { ...primaryMeta, links: primaryMeta.links || [] };

  // Search other sources for the same code (exact match)
  const otherSources = SOURCES.filter(s => s.prefix !== prefix);
  const extraMetas = await Promise.all(
    otherSources.map(async (src) => {
      try {
        const items = await src.catalog({ search: titleCode, page: 1 });
        const match = items.find(i => extractCode(i.name) === titleCode);
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
  for (const m of allMetas) {
    if (!m.cast) continue;
    for (const a of m.cast) {
      if (/[a-zA-Z]{3,}/.test(a)) {
        if (!castEnglish.includes(a)) castEnglish.push(a);
      } else {
        if (!castJapanese.includes(a)) castJapanese.push(a);
      }
    }
  }
  // If we have English names, drop Japanese ones (they're duplicates in different scripts)
  const finalCast = castEnglish.length > 0 ? castEnglish : castJapanese;

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

  return {
    id,
    type: "movie",
    name: primaryMeta.name,
    poster: bestPoster,
    description: finalDesc,
    genre: [...genreSet],
    cast: finalCast,
    releaseInfo: primaryMeta.releaseInfo,
    runtime: primaryMeta.runtime,
  };
}

async function unifiedStreams(id) {
  const prefix = String(id || "").split(":")[0];
  const source = SOURCES.find(s => s.prefix === prefix);
  if (!source) return [];

  // Get streams from the owning source directly
  let primaryStreams = [];
  try { primaryStreams = await source.streams(id); } catch {}

  // Get the JAV code to search other sources
  let code = null;
  try {
    const meta = await source.meta(id);
    if (meta) code = extractCode(meta.name);
  } catch {}

  if (!code) return primaryStreams;

  // Search other sources for streams by code
  const otherSources = SOURCES.filter(s => s.prefix !== prefix);
  const extraStreamsPromises = otherSources.map(async (src) => {
    try {
      const items = await src.catalog({ search: code, page: 1 });
      const match = items.find(i => extractCode(i.name) === code);
      if (match) return await src.streams(match.id);
    } catch {}
    return [];
  });

  const extraResults = await Promise.all(extraStreamsPromises);

  const seen = new Set();
  const allStreams = [];

  const maskedNames = { avmirror: "🌐 Nova", javquick: "⚡ Pulse", "18jav": "🔥 Ember", hohoj: "🎯 Apex", ggjav: "🟣 Luna", porn87: "🟢 Jade", javmenu: "🔴 Crimson", goodav17: "🔵 Azure", avjoy: "🟡 Solar" };

  for (const s of primaryStreams) {
    const url = s.url || s.externalUrl;
    if (!url) continue;
    const key = url.replace(/https?:\/\//, "").split("?")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    const label = maskedNames[prefix] || prefix.toUpperCase();
    allStreams.push({ ...s, name: label, title: `${label} • Auto` });
  }

  for (let i = 0; i < otherSources.length; i++) {
    const src = otherSources[i];
    const results = extraResults[i] || [];
    const label = maskedNames[src.prefix] || src.prefix.toUpperCase();
    for (const s of results) {
      const url = s.url || s.externalUrl;
      if (!url) continue;
      const key = url.replace(/https?:\/\//, "").split("?")[0];
      if (seen.has(key)) continue;
      seen.add(key);
      allStreams.push({ ...s, name: label, title: `${label} • Auto` });
    }
  }

  return allStreams;
}

async function unifiedPopular({ page = 1, genre = "" } = {}) {
  const popularModes = [
    { src: SOURCES[0], mode: "avmirror-popular" },
    { src: SOURCES[2], mode: "18jav-hot" },
    { src: SOURCES[3], mode: "hohoj-popular" },
    { src: SOURCES[4], mode: "ggjav-popular" },
  ];
  const fallback = SOURCES.filter(s => !popularModes.some(p => p.src === s));

  const [modeResults, fallbackResults] = await Promise.all([
    Promise.all(popularModes.map(async ({ src, mode }) => {
      try { return await src.catalog({ page, genre, mode }); } catch { return []; }
    })),
    Promise.all(fallback.map(async (src) => {
      try { return await src.catalog({ page, genre }); } catch { return []; }
    })),
  ]);
  return [...modeResults.flat(), ...fallbackResults.flat()];
}

async function unifiedUncensored({ page = 1, genre = "" } = {}) {
  const uncensoredModes = [
    { src: SOURCES[4], mode: "ggjav-uncensored" },
  ];
  const fallback = SOURCES.filter(s => !uncensoredModes.some(p => p.src === s));

  const [modeResults, fallbackResults] = await Promise.all([
    Promise.all(uncensoredModes.map(async ({ src, mode }) => {
      try { return await src.catalog({ page, genre, mode }); } catch { return []; }
    })),
    Promise.all(fallback.map(async (src) => {
      try { return await src.catalog({ page, genre }); } catch { return []; }
    })),
  ]);
  return [...modeResults.flat(), ...fallbackResults.flat()];
}

module.exports = { unifiedCatalog, unifiedMeta, unifiedStreams, unifiedPopular, unifiedUncensored };
