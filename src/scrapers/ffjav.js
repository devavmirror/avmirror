const crypto = require("crypto");
const cheerio = require("cheerio");
const { UA, parseCodeOf, makeCache } = require("../lib/scraper-utils");
const BASE_URL = "https://ffjav.com";
const cache = makeCache(500, 10 * 60 * 1000);
const clean = value => String(value || "").replace(/\s+/g, " ").trim();
async function getText(url) {
  const hit = cache.get(url); if (hit) return hit;
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`FFJav HTTP ${r.status}`);
  const html = await r.text(); cache.set(url, html); return html;
}
async function getBuffer(url) {
  const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`FFJav torrent download HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
function bdecode(buf, start) {
  start = start || [0];
  const byte = buf[start[0]];
  if (byte === 0x69) { start[0]++; const end = buf.indexOf(0x65, start[0]); const num = parseInt(buf.subarray(start[0], end).toString(), 10); start[0] = end + 1; return num; }
  if (byte === 0x6c) { start[0]++; const list = []; while (buf[start[0]] !== 0x65) list.push(bdecode(buf, start)); start[0]++; return list; }
  if (byte === 0x64) { start[0]++; const dict = {}; while (buf[start[0]] !== 0x65) { const key = bdecode(buf, start); dict[key] = bdecode(buf, start); } start[0]++; return dict; }
  const colon = buf.indexOf(0x3a, start[0]);
  const len = parseInt(buf.subarray(start[0], colon).toString(), 10);
  start[0] = colon + 1;
  const str = buf.subarray(start[0], start[0] + len);
  start[0] += len;
  return str;
}
function bencodeValue(val) {
  if (Buffer.isBuffer(val)) return Buffer.concat([Buffer.from(`${val.length}:`), val]);
  if (typeof val === "number") return Buffer.from(`i${val}e`);
  if (typeof val === "string") return bencodeValue(Buffer.from(val));
  if (Array.isArray(val)) return Buffer.concat([Buffer.from("l"), ...val.map(bencodeValue), Buffer.from("e")]);
  if (typeof val === "object" && val !== null) {
    const keys = Object.keys(val).sort();
    return Buffer.concat([Buffer.from("d"), ...keys.flatMap(k => [bencodeValue(Buffer.from(k)), bencodeValue(val[k])]), Buffer.from("e")]);
  }
  throw new Error(`Unsupported bencode type: ${typeof val}`);
}
function extractInfoHash(torrentBuf) {
  const decoded = bdecode(torrentBuf, [0]);
  const infoKey = Buffer.from("info");
  const info = decoded[infoKey] || decoded.info;
  if (!info) return null;
  return crypto.createHash("sha1").update(bencodeValue(info)).digest("hex");
}
function extractTrackers(decoded) {
  const trackers = [];
  const announceKey = Buffer.from("announce");
  const announceListKey = Buffer.from("announce-list");
  const announce = decoded[announceKey] || decoded.announce;
  if (announce) trackers.push(`tracker:${announce.toString()}`);
  const announceList = decoded[announceListKey] || decoded["announce-list"];
  if (announceList) {
    for (const tier of announceList) {
      for (const t of tier) { const u = `tracker:${t.toString()}`; if (!trackers.includes(u)) trackers.push(u); }
    }
  }
  return trackers;
}
function parseCards(html) {
  const $ = cheerio.load(html), out = [], seen = new Set();
  $("div.card.mb-3").each((_, el) => {
    const $el = $(el);
    const titleEl = $el.find("h5.title.is-4.is-spaced a");
    const name = clean(titleEl.text());
    const href = titleEl.attr("href");
    if (!href || !name || seen.has(href)) return;
    const slug = href.replace(/^https?:\/\/ffjav\.com\/torrent\//, "").replace(/\/$/, "");
    const poster = $el.find("div.column:first-child img.image").attr("src");
    seen.add(href);
    out.push({ id: `ffjav:${slug}`, type: "movie", name, poster: poster || undefined });
  });
  return out.slice(0, 100);
}
async function scrapeCatalog({ page = 1, search = "" } = {}) {
  const query = String(search || "").trim();
  if (query) {
    try {
      const url = `${BASE_URL}/?s=${encodeURIComponent(query)}`;
      const items = parseCards(await getText(url));
      if (items.length) return items;
    } catch {}
    const wanted = parseCodeOf(query);
    if (!wanted) return [];
    for (let p = 1; p <= 5; p++) {
      try {
        const items = parseCards(await getText(`${BASE_URL}/javtorrent/page/${p}`));
        const matches = items.filter(i => parseCodeOf(i.name) === wanted);
        if (matches.length) return matches;
      } catch { break; }
    }
    return [];
  }
  return parseCards(await getText(`${BASE_URL}/javtorrent/page/${page}`));
}
async function scrapeMeta(id) {
  const slug = String(id || "").replace(/^ffjav:/, "");
  const html = await getText(`${BASE_URL}/torrent/${slug}`);
  const $ = cheerio.load(html);
  const title = clean($("h5.title.is-4.is-spaced a").text()) || clean($("title").text()).replace(/ - FFJav.*$/i, "");
  const poster = $("div.column:first-child img.image").attr("src");
  return { id, type: "movie", name: title, poster: poster || undefined };
}
async function scrapeStreams(id) {
  const slug = String(id || "").replace(/^ffjav:/, "");
  const html = await getText(`${BASE_URL}/torrent/${slug}`);
  const $ = cheerio.load(html);
  const torrentLink = $("a.button.is-primary").attr("href");
  if (!torrentLink || !torrentLink.includes(".torrent")) return [];
  const torrentUrl = torrentLink.startsWith("http") ? torrentLink : `${BASE_URL}${torrentLink}`;
  const torrentBuf = await getBuffer(torrentUrl);
  const decoded = bdecode(torrentBuf, [0]);
  const infoHash = extractInfoHash(torrentBuf);
  if (!infoHash) return [];
  const trackers = extractTrackers(decoded);
  const infoKey = Buffer.from("info");
  const nameKey = Buffer.from("name");
  const nameEntry = decoded[infoKey]?.[nameKey] || decoded.info?.name;
  const displayName = nameEntry ? nameEntry.toString() : slug;
  return [{
    name: "🥝 Kiwi",
    title: "Kiwi • Torrent 1",
    infoHash,
    sources: trackers,
    behaviorHints: { bingeGroup: "ffjav", notWebReady: false },
  }];
}
module.exports = { scrapeCatalog, scrapeMeta, scrapeStreams };
