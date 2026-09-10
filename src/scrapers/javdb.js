const cheerio = require("cheerio");
const { UA, parseCodeOf, parseMagnetTrackers, parseInfoHash, parseSizeBytes, formatSize, makeCache, browserFetch } = require("../lib/scraper-utils");
const BASE_URL = "https://javdb.com";
const cache = makeCache(500, 5 * 60 * 1000);
const clean = v => String(v || "").replace(/\s+/g, " ").trim();

async function getText(url) {
  const hit = cache.get(url);
  if (hit) return hit;
  const r = await browserFetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`JavDB HTTP ${r.status}`);
  const html = await r.text();
  cache.set(url, html);
  return html;
}

function parseSearchResults(html) {
  const $ = cheerio.load(html);
  const results = [];
  $("div.item").each((_, el) => {
    const $el = $(el);
    const link = $el.find("a.box").attr("href");
    const titleEl = $el.find(".video-title strong");
    const title = clean(titleEl.text());
    if (link && title) results.push({ href: link, title });
  });
  return results;
}

function parseMagnetLinks(html) {
  const $ = cheerio.load(html);
  const magnets = [];
  const seen = new Set();

  $('a[href^="magnet:"]').each((_, el) => {
    let magnet = $(el).attr("href") || "";
    magnet = magnet.replace(/&amp;/g, "&");
    const hashMatch = magnet.match(/btih:([a-fA-F0-9]{40})/i);
    if (!hashMatch) return;
    const hash = hashMatch[1].toLowerCase();
    if (seen.has(hash)) return;
    seen.add(hash);

    const info = $(el).closest("tr,div,.column,.level");
    let name = clean(info.find(".name,.column-name,.title,.ellipsis").first().text()) || null;
    if (!name) name = clean($(el).text()) || null;
    if (!name || name.length < 3) {
      const dnMatch = magnet.match(/dn=([^&]+)/);
      name = dnMatch ? decodeURIComponent(dnMatch[1]) : null;
    }

    let sizeText = null;
    const allText = info.text() || "";
    const sizeMatch = allText.match(/([\d.]+)\s*(GiB|MiB|KiB|GB|MB|KB|TB)/i);
    if (sizeMatch) sizeText = sizeMatch[0];

    const seedersMatch = allText.match(/(\d+)\s*(?:seed|seeder)/i);
    const seeders = seedersMatch ? parseInt(seedersMatch[1], 10) : 0;

    const trackers = [...magnet.matchAll(/tr=([^&]+)/gi)].map(m => `tracker:${decodeURIComponent(m[1])}`);

    magnets.push({
      id: `javdb:${hash}`,
      type: "movie",
      name,
      infoHash: hash,
      sizeText,
      seeders,
      trackers,
    });
  });

  return magnets;
}

async function scrapeDetailPage(href) {
  const url = href.startsWith("http") ? href : `${BASE_URL}${href}`;
  const html = await getText(url);
  return parseMagnetLinks(html);
}

async function scrapeCatalog({ page = 1, search = "" } = {}) {
  const query = String(search || "").trim();
  if (!query) return [];

  const url = `${BASE_URL}/search?q=${encodeURIComponent(query)}&locale=en`;
  let html;
  try {
    html = await getText(url);
  } catch (e) {
    console.error(`[javdb] search error: ${e.message}`);
    return [];
  }

  const results = parseSearchResults(html);
  if (!results.length) return [];

  // Fetch detail pages for the top results (max 3 to avoid hammering)
  const out = [];
  const seen = new Set();
  for (const r of results.slice(0, 3)) {
    try {
      const magnets = await scrapeDetailPage(r.href);
      for (const m of magnets) {
        if (!seen.has(m.infoHash)) {
          seen.add(m.infoHash);
          out.push(m);
        }
      }
    } catch (e) {
      console.error(`[javdb] detail ${r.href}: ${e.message}`);
    }
  }

  return out;
}

async function searchCode(code) {
  return scrapeCatalog({ search: code });
}

module.exports = { scrapeCatalog, searchCode, SOURCE_ID: "javdb", SOURCE_NAME: "JavDB" };
