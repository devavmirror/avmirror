const BASE = "https://hohoj.tv";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

function makeId(videoId) { return `hohoj:${videoId}`; }
function extractVideoId(id) { return String(id || "").replace(/^hohoj:/, ""); }
function stripTags(h) { return String(h || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }
function decodeHtmlEntities(s) { return String(s || "").replace(/&#x([0-9a-f]+);/gi, (_, c) => String.fromCharCode(parseInt(c, 16))).replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c)).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'"); }

async function fetchHtml(url, referer) {
  const headers = { "User-Agent": UA, accept: "text/html,*/*" };
  if (referer) headers.referer = referer;
  const r = await fetch(url, { headers, redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

function parseCatalogItems(html) {
  const items = [];
  const seen = new Set();
  const re = /video\?id=(\d+)[\s\S]*?src="(https:\/\/cdn[^"]+)"[\s\S]*?video-item-title[^>]*>([^<]+)/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const videoId = m[1];
    if (seen.has(videoId)) continue;
    seen.add(videoId);
    const poster = m[2] || "";
    const name = decodeHtmlEntities(stripTags(m[3]));
    items.push({ id: makeId(videoId), type: "movie", name: name || videoId, poster });
  }
  return items;
}

async function scrapeHohojCatalog({ page = 1, search = "", genre = "", mode = "" } = {}) {
  try {
    let url;
    if (search) {
      url = `${BASE}/lang_en/search?text=${encodeURIComponent(search)}&p=${page}`;
    } else if (genre) {
      url = `${BASE}/lang_en/search?text=${encodeURIComponent(genre)}&p=${page}`;
    } else if (mode === "hohoj-popular") {
      url = `${BASE}/lang_en/search?type=censored&order=popular&p=${page}`;
    } else {
      url = `${BASE}/lang_en/search?type=censored&order=latest&p=${page}`;
    }
    const html = await fetchHtml(url, `${BASE}/lang_en/`);
    return parseCatalogItems(html);
  } catch (e) {
    console.error("hohoj catalog error:", e.message || e);
    return [];
  }
}

async function scrapeHohojMeta(id) {
  const videoId = extractVideoId(id);
  if (!videoId) return null;
  try {
    const html = await fetchHtml(`${BASE}/lang_en/video?id=${videoId}`, `${BASE}/lang_en/`);

    let name = "";
    const titleMatch = html.match(/<h5[^>]*>([^<]+)/i);
    if (titleMatch) name = decodeHtmlEntities(stripTags(titleMatch[1]));

    let poster = "";
    const ogImage = html.match(/og:image[^>]*content="([^"]+)"/i);
    if (ogImage) poster = ogImage[1];

    let description = "";
    const descMatch = html.match(/meta name="description" content="([^"]+)"/i)
      || html.match(/og:description[^>]*content="([^"]+)"/i);
    if (descMatch) description = decodeHtmlEntities(stripTags(descMatch[1]));

    const actors = [];
    const actorRe = /\/lang_en\/model\?id=\d+&name=([^"&]+)/gi;
    let am;
    while ((am = actorRe.exec(html)) !== null) {
      const a = decodeHtmlEntities(decodeURIComponent(am[1])).trim();
      if (a && !actors.includes(a)) actors.push(a);
    }

    const genres = [];
    const genreRe = /\/lang_en\/(?:main_ctg|ctg)\?id=\d+&name=([^"&]+)/gi;
    let gm;
    while ((gm = genreRe.exec(html)) !== null) {
      const g = decodeHtmlEntities(decodeURIComponent(gm[1])).trim();
      if (g && !genres.includes(g)) genres.push(g);
    }

    const meta = { id, type: "movie", name: name || videoId };
    if (poster) meta.poster = poster;
    if (description) meta.description = description;
    if (genres.length) meta.genre = genres;
    if (actors.length) meta.cast = actors;
    return meta;
  } catch (e) {
    console.error("hohoj meta error:", e.message || e);
    return null;
  }
}

async function scrapeHohojStreams(id) {
  const videoId = extractVideoId(id);
  if (!videoId) return [];
  try {
    const html = await fetchHtml(`${BASE}/embed?id=${videoId}`, `${BASE}/lang_en/video?id=${videoId}`);
    const m3u8Match = html.match(/https?:\/\/video-\d+\.ggjav\.com[^"'\s]+\.m3u8/i);
    if (!m3u8Match) return [];
    return [{
      name: "🎯 Apex",
      title: "HohoJ • HLS",
      url: m3u8Match[0],
      behaviorHints: {
        notWebReady: false,
        bingeGroup: "hohoj",
        proxyHeaders: { headers: { "User-Agent": UA, "Referer": `${BASE}/` } }
      }
    }];
  } catch (e) {
    console.error("hohoj streams error:", e.message || e);
    return [];
  }
}

module.exports = {
  scrapeHohojCatalog,
  scrapeHohojMeta,
  scrapeHohojStreams
};
