const cheerio = require("cheerio");
const { exec } = require("child_process");
const { promisify } = require("util");
const { UA, maskError, stripTags, decodeHtmlEntities } = require("../lib/scraper-utils");
const { directBehaviorHints } = require("../lib/direct-stream");

const BASE = "https://missav123.com";
const execAsync = promisify(exec);

function makeId(videoId) { return `missav:${videoId}`; }
function extractVideoId(id) { return String(id || "").replace(/^missav:/, ""); }

function shellEscape(s) {
  return String(s).replace(/[^a-zA-Z0-9._~:@!$&'()*+,;=/-]/g, "\\$&");
}

async function curlFetch(url) {
  try {
    const safeUrl = shellEscape(url);
    const safeBase = shellEscape(BASE);
    await execAsync(
      `curl -s -L --max-time 12 -c /tmp/missav123_cookies.txt -b /tmp/missav123_cookies.txt -H 'User-Agent: ${shellEscape(UA)}' -H 'Accept: text/html,*/*' -H 'Accept-Language: en-US,en;q=0.9' '${safeBase}/en/'`,
      { timeout: 15000, maxBuffer: 5 * 1024 * 1024 }
    );
    const { stdout } = await execAsync(
      `curl -s -L --max-time 12 -c /tmp/missav123_cookies.txt -b /tmp/missav123_cookies.txt -H 'User-Agent: ${shellEscape(UA)}' -H 'Accept: text/html,*/*' -H 'Accept-Language: en-US,en;q=0.9' -H 'Referer: ${safeBase}/en/' '${safeUrl}'`,
      { timeout: 15000, maxBuffer: 5 * 1024 * 1024 }
    );
    return stdout || "";
  } catch { return ""; }
}

function unpack(p, a, c, k) {
  const d = {};
  for (let i = c - 1; i >= 0; i--) {
    if (k[i]) d[i.toString(a)] = k[i] || i.toString(a);
  }
  const regex = new RegExp("\\b(" + Object.keys(d).join("|") + ")\\b", "g");
  return p.replace(regex, (match) => d[match] || match);
}

function parseEvalPayload(scriptContent) {
  const match = scriptContent.match(/return p\}\('(.+)',(\d+),(\d+),'([^']+)'/);
  if (!match) return null;
  const p = match[1].replace(/\\'/g, "'");
  return { p, a: parseInt(match[2], 10), c: parseInt(match[3], 10), k: match[4].split("|") };
}

function decodeEval(scriptContent) {
  const payload = parseEvalPayload(scriptContent);
  if (!payload) return null;
  try { return unpack(payload.p, payload.a, payload.c, payload.k); }
  catch { return null; }
}

function extractHlsUrls(decoded) {
  if (!decoded) return [];
  const urls = [];
  const re = /https?:\/\/[^\s"']+\.m3u8[^\s"']*/gi;
  let m;
  while ((m = re.exec(decoded)) !== null) {
    let url = m[0].replace(/\\+$/, "");
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

function parseCatalogItems(html) {
  const $ = cheerio.load(html);
  const candidates = new Map();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const m = href.match(/missav123\.com\/(?:dm\d+\/)?en\/([a-z][a-z0-9_-]+)/i);
    if (!m) return;
    const videoId = m[1];
    if (!/[a-z]+-?\d{3,}/.test(videoId)) return;
    const title = decodeHtmlEntities(stripTags($(el).text()));
    const existing = candidates.get(videoId);
    if (!existing || (title && title.length > existing.length)) {
      candidates.set(videoId, title);
    }
  });
  const items = [];
  for (const [videoId, title] of candidates) {
    if (!title || title.length < 3) continue;
    items.push({
      id: makeId(videoId),
      type: "movie",
      name: title || videoId.toUpperCase(),
      poster: `https://fourhoi.com/${videoId}/cover-n.jpg`,
    });
  }
  return items;
}

async function scrapeCatalog({ page = 1, search = "" } = {}) {
  try {
    if (!search) return [];
    const url = `${BASE}/en/search/${encodeURIComponent(search)}?page=${page}`;
    const html = await curlFetch(url);
    if (!html) return [];
    return parseCatalogItems(html);
  } catch (e) {
    console.error("catalog fetch error:", maskError(e.message));
    return [];
  }
}

async function scrapeMeta(id) {
  const videoId = extractVideoId(id);
  if (!videoId) return null;
  try {
    const url = `${BASE}/en/${videoId}`;
    const html = await curlFetch(url);
    if (!html) return null;
    const $ = cheerio.load(html);

    const ogTitle = decodeHtmlEntities(stripTags($("meta[property='og:title']").attr("content") || ""));
    const title = decodeHtmlEntities(stripTags($("h1").first().text()));
    const name = title || ogTitle || videoId.toUpperCase();

    const poster = $("meta[property='og:image']").attr("content") || "";
    const description = decodeHtmlEntities(stripTags(
      $("meta[property='og:description']").attr("content") ||
      $("meta[name='description']").attr("content") || ""
    ));

    const actors = [];
    $("a[href*='/actresses/'], a[href*='/actress/']").each((_, el) => {
      const a = decodeHtmlEntities(stripTags($(el).text())).trim();
      if (a && !actors.includes(a)) actors.push(a);
    });

    const genres = [];
    $("a[href*='/genres/'], a[href*='/genre/']").each((_, el) => {
      const g = decodeHtmlEntities(stripTags($(el).text())).trim();
      if (g && !genres.includes(g)) genres.push(g);
    });

    return {
      id, type: "movie", name,
      poster: poster || `https://fourhoi.com/${videoId}/cover-n.jpg`,
      description: description || undefined,
      genre: genres.slice(0, 30),
      cast: actors.slice(0, 30),
    };
  } catch (e) {
    console.error("meta fetch error:", maskError(e.message));
    return null;
  }
}

async function scrapeStreams(id) {
  const videoId = extractVideoId(id);
  if (!videoId) return [];
  try {
    const url = `${BASE}/en/${videoId}`;
    const html = await curlFetch(url);
    if (!html) return [];

    const allUrls = [];
    const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let sm;
    while ((sm = scriptRe.exec(html)) !== null) {
      const scriptContent = sm[1];
      if (!scriptContent.includes("eval(function")) continue;
      const decoded = decodeEval(scriptContent);
      if (!decoded) continue;
      const urls = extractHlsUrls(decoded);
      for (const u of urls) {
        if (!allUrls.includes(u)) allUrls.push(u);
      }
    }

    return allUrls.map((u, i) => ({
      name: "Lemon",
      title: `Lemon • HTTP ${allUrls.length > 1 ? `${i + 1}` : ""}`,
      url: u,
      behaviorHints: directBehaviorHints(`${BASE}/en/${videoId}`, "missav"),
    }));
  } catch (e) {
    console.error("streams fetch error:", maskError(e.message));
    return [];
  }
}

module.exports = { scrapeCatalog, scrapeMeta, scrapeStreams };
