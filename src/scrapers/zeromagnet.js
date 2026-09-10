const cheerio = require("cheerio");
const {
  UA,
  cleanText,
  parseCodeOf,
  parseMagnetTrackers,
  parseInfoHash,
  parseSizeBytes,
  makeCache,
  browserFetch,
} = require("../lib/scraper-utils");

const BASE_URL = "https://16mag.net";
const cache = makeCache(300, 10 * 60 * 1000);
const clean = value => String(value || "").replace(/\s+/g, " ").trim();

function absolute(value) {
  try { return new URL(value, BASE_URL).href; } catch { return null; }
}

async function get(url) {
  const hit = cache.get(url);
  if (hit) return hit;
  const response = await browserFetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`0Magnet HTTP ${response.status}`);
  const html = await response.text();
  cache.set(url, html);
  return html;
}

function parseMagnet(value) {
  const magnet = cleanText(value).replace(/&amp;/g, "&");
  const infoHash = parseInfoHash(magnet);
  if (!magnet.startsWith("magnet:") || !infoHash) return null;
  const trackers = parseMagnetTrackers(magnet);
  const sizeMatch = magnet.match(/[?&]xl=(\d+)/i);
  const nameMatch = magnet.match(/[?&]dn=([^&]+)/i);
  let name = "Peach • Torrent";
  try { if (nameMatch) name = decodeURIComponent(nameMatch[1].replace(/\+/g, " ")); } catch {}
  return {
    infoHash,
    name,
    trackers,
    size: sizeMatch ? Number(sizeMatch[1]) : undefined,
  };
}

function parseSearchResults(html, query) {
  const $ = cheerio.load(html);
  const wanted = parseCodeOf(query);
  const out = [];
  const seen = new Set();
  $('a[href^="/!"]').each((_, anchor) => {
    const href = absolute($(anchor).attr("href"));
    const title = clean($(anchor).text());
    if (!href || !title || seen.has(href)) return;
    const code = parseCodeOf(title);
    if (wanted && code !== wanted) return;
    seen.add(href);
    out.push({
      id: `zeromagnet:${href}`,
      type: "movie",
      name: title,
      code,
    });
  });
  return out.slice(0, 20);
}

async function scrapeCatalog({ search = "" } = {}) {
  const query = clean(search);
  if (!query) return [];
  return parseSearchResults(await get(`${BASE_URL}/search?q=${encodeURIComponent(query)}`), query);
}

async function scrapeMeta(id) {
  const url = String(id || "").replace(/^zeromagnet:/, "");
  const $ = cheerio.load(await get(url));
  const title = clean($("h1,h2.magnet-title,title").first().text()) || clean($("title").text()).replace(/\s*ØMagnet.*$/i, "");
  return { id, type: "movie", name: title, title };
}

async function scrapeStreams(id) {
  const url = String(id || "").replace(/^zeromagnet:/, "");
  const $ = cheerio.load(await get(url));
  const magnets = [];
  $("input#input-magnet, a[href^='magnet:']").each((_, element) => {
    const value = $(element).attr("value") || $(element).attr("href");
    const parsed = parseMagnet(value);
    if (parsed && !magnets.some(item => item.infoHash === parsed.infoHash)) magnets.push(parsed);
  });
  return magnets.map(item => ({
    name: "🍑 Peach",
    title: `Peach • Torrent${item.seeders ? ` • ${item.seeders} seeds` : ""}`,
    infoHash: item.infoHash,
    ...(item.seeders ? { seeders: item.seeders } : {}),
    ...(item.trackers.length ? { sources: item.trackers } : {}),
    behaviorHints: {
      bingeGroup: "zeromagnet",
      notWebReady: false,
      ...(item.size ? { videoSize: item.size } : {}),
    },
  }));
}

module.exports = { scrapeCatalog, scrapeMeta, scrapeStreams, parseMagnet, parseSearchResults };
