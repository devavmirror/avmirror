const cheerio = require("cheerio");
const { UA, parseCodeOf, parseMagnetTrackers, parseInfoHash, parseSizeBytes, formatSize, makeCache, browserFetch } = require("../lib/scraper-utils");
const BASE_URL = "https://ijavtorrent.com";
const cache = makeCache();
const clean = value => String(value || "").replace(/\s+/g, " ").trim();
const abs = value => { try { return new URL(value, BASE_URL).href; } catch { return null; } };
async function get(url) {
  const hit = cache.get(url); if (hit) return hit;
  const r = await browserFetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`iJavTorrent HTTP ${r.status}`);
  const html = await r.text(); cache.set(url, html); return html;
}
function parseCards(html) {
  const $ = cheerio.load(html), out = [], seen = new Set();
  $('a[href^="/movie/"]').each((_, a) => {
    const href = abs($(a).attr("href")); if (!href || seen.has(href)) return;
    const title = clean($(a).find("span,[title]").first().text() || $(a).attr("title") || $(a).text());
    const img = $(a).attr("data-link") || $(a).find("img").attr("data-link") || $(a).find("img").attr("src");
    if (!title || title.length < 3) return;
    seen.add(href); out.push({ id: `ijavtorrent:${href}`, type: "movie", name: title, poster: abs(img) || undefined });
  });
  return out.slice(0, 100);
}
async function scrapeCatalog({ page = 1, search = "" } = {}) {
  // The site has a real WordPress-style search endpoint. Searching only the
  // first homepage would miss older works when unifiedStreams resolves a code.
  const query = String(search || "").trim();
  const url = query
    ? `${BASE_URL}/?searchTerm=${encodeURIComponent(query)}`
    : page > 1 ? `${BASE_URL}/?page=${page}` : `${BASE_URL}/`;
  const items = parseCards(await get(url));
  if (!query) return items;
  const wanted = parseCodeOf(query);
  return items.filter(item => item.name.toLowerCase().includes(query.toLowerCase()) || (wanted && parseCodeOf(item.name) === wanted));
}
async function scrapeMeta(id) {
  const url = String(id || "").replace(/^ijavtorrent:/, "");
  const html = await get(url), $ = cheerio.load(html);
  const title = clean($("h1,h2,.movie-title").first().text()) || clean($("title").text()).replace(/ - iJavTorrent.*$/i, "");
  const poster = abs($("img[src*='/covers/'],img[data-link*='/covers/']").first().attr("src") || $("img[data-link*='/covers/']").first().attr("data-link"));
  const cast = $("a[href^='/actress/'] h3,a[href^='/actress/']").toArray().map(a => clean($(a).text())).filter(Boolean);
  return { id, type: "movie", name: title, poster: poster || undefined, cast: [...new Set(cast)] };
}
async function scrapeStreams(id) {
  const url = String(id || "").replace(/^ijavtorrent:/, "");
  const html = await get(url), $ = cheerio.load(html), out = [], seen = new Set();
  
  let seeders = 0;
  $("td").each((_, el) => {
    const t = $(el).text().trim();
    const m = t.match(/^Seeds?\s+(\d+)/i);
    if (m) seeders = parseInt(m[1], 10);
  });
  
  $("a[href^='magnet:']").each((_, a) => {
    const magnet = String($(a).attr("href") || "").replace(/&amp;/g, "&");
    if (!magnet) return;
    const infoHash = magnet.match(/btih:([a-fA-F0-9]{40})/i)?.[1];
    if (!infoHash || seen.has(infoHash.toLowerCase())) return;
    seen.add(infoHash.toLowerCase());
    const trackers = [...magnet.matchAll(/tr=([^&]+)/gi)].map(m => `tracker:${decodeURIComponent(m[1])}`);
    const sizeMatch = magnet.match(/xl=(\d+)/i);
    const size = sizeMatch ? Number(sizeMatch[1]) : undefined;
    const seedLabel = seeders > 0 ? ` • ${seeders} seeds` : "";
    out.push({
      name: "🍉 Watermelon",
      title: `Watermelon • Torrent${seedLabel}`,
      infoHash: infoHash.toLowerCase(),
      seeders,
      ...(trackers.length ? { sources: trackers } : {}),
      behaviorHints: { bingeGroup: "ijavtorrent", notWebReady: false, ...(size ? { videoSize: size } : {}) }
    });
  });
  if (!out.length) {
    const downloadEl = $("a[href^='/download/']").first();
    const downloadHref = downloadEl.attr("href");
    if (downloadHref && downloadHref !== '/download/undefined') {
      const download = abs(downloadHref);
      if (download) out.push({ name: "🍉 Watermelon", title: "Watermelon • Torrent", externalUrl: download, behaviorHints: { notWebReady: false } });
    }
  }
  if (!out.length) {
    const title = clean($("h1,h2,.movie-title").first().text()) || clean($("title").text());
    const code = parseCodeOf(title);
    if (code) {
      try {
        const searchHtml = await get(`${BASE_URL}/?searchTerm=${encodeURIComponent(code)}`);
        const $s = cheerio.load(searchHtml);
        const magnetLinks = [];
        $s('a[href^="magnet:"]').each((_, a) => {
          const magnet = String($s(a).attr("href") || "").replace(/&amp;/g, "&");
          const dn = (magnet.match(/dn=([^&]+)/i)?.[1] || "").toLowerCase();
          if (dn.includes(code.toLowerCase().replace("-", "")) || dn.includes(code.toLowerCase())) {
            magnetLinks.push(magnet);
          }
        });
        for (const magnet of magnetLinks.slice(0, 5)) {
          const infoHash = magnet.match(/btih:([a-fA-F0-9]{40})/i)?.[1];
          if (!infoHash || seen.has(infoHash.toLowerCase())) continue;
          seen.add(infoHash.toLowerCase());
          const trackers = [...magnet.matchAll(/tr=([^&]+)/gi)].map(m => `tracker:${decodeURIComponent(m[1])}`);
          const sizeMatch = magnet.match(/xl=(\d+)/i);
          const size = sizeMatch ? Number(sizeMatch[1]) : undefined;
          out.push({
            name: "🍉 Watermelon",
            title: `Watermelon • Torrent`,
            infoHash: infoHash.toLowerCase(),
            ...(trackers.length ? { sources: trackers } : {}),
            behaviorHints: { bingeGroup: "ijavtorrent", notWebReady: false, ...(size ? { videoSize: size } : {}) }
          });
        }
      } catch {}
    }
  }
  return out;
}
module.exports = { scrapeCatalog, scrapeMeta, scrapeStreams, codeOf: parseCodeOf };
