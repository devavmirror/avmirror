const cheerio = require("cheerio");
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const BASE_URL = (process.env.JAVRIDER_BASE_URL || "https://javrider.com").replace(/\/+$/, "");
const USER_AGENT = process.env.USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139 Safari/537.36";
const REQUEST_TIMEOUT_MS = Number(process.env.JAVRIDER_REQUEST_TIMEOUT_MS || 12000);
const PLAYER_TIMEOUT_MS = Number(process.env.JAVRIDER_PLAYER_TIMEOUT_MS || 15000);
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 900000);
const cache = new Map();
const pending = new Map();
let browserPromise = null;

const JAVRIDER_GENRES = ["Subtitle", "Censored", "FC2", "English"];
const AD_PATTERN = /(?:doubleclick|googlesyndication|googleadservices|popunder|popup|popads|adservice|tiktokcdn|ad-site|\.image(?:[/?#]|$))/i;
const MEDIA_PATTERN = /(?:\.m3u8(?:[?#]|$)|\.mp4(?:[?#]|$)|\.m4v(?:[?#]|$)|\.webm(?:[?#]|$)|\/cdn\/hls\/|\/m3\/|master\.txt|videoplayback|manifest|playlist|stream)/i;

const clean = value => String(value || "").replace(/\s+/g, " ").trim();
function absolute(value, base = BASE_URL) { try { return new URL(String(value || ""), base).href; } catch { return ""; } }
function cacheGet(key) { const item = cache.get(key); return item && item.expires > Date.now() ? item.value : null; }
function cacheSet(key, value) { cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS }); return value; }
function isItemUrl(value) { try { const url = new URL(value, BASE_URL); return url.origin === new URL(BASE_URL).origin && /^\/[a-z0-9]+(?:-[a-z0-9]+){2,}\/?$/i.test(url.pathname) && !/^\/(?:category|actor|tag|page|wp-|feed|search|author|about|contact|cn|ja|en)(?:\/|$)/i.test(url.pathname); } catch { return false; } }
function makeId(url) { return `javrider:${Buffer.from(url).toString("base64url")}`; }
function idToUrl(id) { try { const url = Buffer.from(String(id || "").replace(/^javrider:/, ""), "base64url").toString("utf8"); return /^javrider:/.test(id) && isItemUrl(url) ? url : ""; } catch { return ""; } }
function normalizePoster(value, base = BASE_URL) { const url = absolute(value, base); return url && /(?:wp-content\/uploads|javphotos\.com)/i.test(url) ? url : ""; }

async function get(url, referer = `${BASE_URL}/`) {
  const key = `http:${url}`, hit = cacheGet(key); if (hit) return hit;
  if (pending.has(key)) return pending.get(key);
  const request = (async () => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { "user-agent": USER_AGENT, referer, accept: "text/html,application/xhtml+xml" } });
      if (!response.ok) throw new Error(`JavRider HTTP ${response.status}`);
      return cacheSet(key, await response.text());
    } finally { clearTimeout(timer); pending.delete(key); }
  })();
  pending.set(key, request);
  return request;
}
async function getBrowser() { if (!browserPromise) { const configuredPath = process.env.PLAYWRIGHT_EXECUTABLE_PATH; const appDir = process.pkg ? path.dirname(process.execPath) : path.resolve(__dirname); const bundledCandidates = process.platform === "win32" ? fs.globSync(path.join(appDir, "chromium", "**", "chrome.exe")) : fs.globSync(path.join(appDir, "chromium", "**", "chrome")); const bundled = bundledCandidates[0]; const candidates = [configuredPath, bundled, "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/snap/bin/chromium", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", "C:\\Users\\Public\\Chrome\\chrome.exe"].filter(Boolean); const executablePath = candidates.find(fs.existsSync); if (configuredPath && !fs.existsSync(configuredPath)) console.warn(`PLAYWRIGHT_EXECUTABLE_PATH não existe; usando ${executablePath || "Chromium gerenciado pelo Playwright"}`); browserPromise = chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] }).catch(error => { browserPromise = null; throw error; }); } return browserPromise; }
async function capture(url, referer = `${BASE_URL}/`) {
  const browser = await getBrowser(), context = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
  const page = await context.newPage(), media = new Set();
  const collect = response => { const target = response.url(), type = String(response.headers()["content-type"] || ""); if (!AD_PATTERN.test(target) && (MEDIA_PATTERN.test(target) || /mpegurl|video\//i.test(type))) media.add(target); };
  page.on("response", collect); page.on("request", request => { if (!AD_PATTERN.test(request.url()) && MEDIA_PATTERN.test(request.url())) media.add(request.url()); });
  try {
    await page.goto(url, { referer, waitUntil: "domcontentloaded", timeout: PLAYER_TIMEOUT_MS });
    await page.waitForTimeout(800);
    for (const frame of page.frames()) {
      for (const selector of [".jw-display-icon-container", ".jw-icon-play", ".vjs-big-play-button", ".play-button", "button[aria-label*='play' i]", "[role=button][aria-label*='play' i]", "video"]) {
        const controls = frame.locator(selector), count = await controls.count().catch(() => 0);
        for (let i = 0; i < Math.min(count, 3); i++) await controls.nth(i).click({ force: true, timeout: 2500 }).catch(() => {});
      }
    }
    for (let attempt = 0; attempt < 12 && !media.size; attempt++) await page.waitForTimeout(500);
    const sources = await page.locator("video,video source,audio,audio source").evaluateAll(nodes => nodes.map(node => node.currentSrc || node.src || node.getAttribute("src")).filter(Boolean)).catch(() => []);
    const resources = await page.evaluate(() => performance.getEntriesByType("resource").map(entry => entry.name)).catch(() => []);
    for (const source of [...sources, ...resources]) if (!/^blob:/i.test(source) && !AD_PATTERN.test(source) && MEDIA_PATTERN.test(source)) media.add(absolute(source, page.url()));
    return [...media].filter(value => /^https?:/i.test(value) && !AD_PATTERN.test(value));
  } finally { await context.close().catch(() => {}); }
}

function parseCatalog(html, pageUrl) {
  const $ = cheerio.load(html), result = new Map();
  $("a[href]").each((_, anchor) => {
    const itemUrl = absolute($(anchor).attr("href"), pageUrl);
    if (!isItemUrl(itemUrl) || result.has(itemUrl)) return;
    const card = $(anchor).parents("article,.post,.item,.type-post,li").first();
    const root = card.length ? card : $(anchor).parent();
    const image = root.find("img").first();
    const title = clean($(anchor).attr("title") || $(anchor).text() || root.find("h1,h2,h3,h4,.entry-title,.title").first().text());
    if (!title) return;
    const poster = normalizePoster(image.attr("data-src") || image.attr("data-lazy-src") || image.attr("data-original") || image.attr("src") || image.attr("srcset")?.split(",")[0]?.trim()?.split(" ")[0], pageUrl);
    result.set(itemUrl, { id: makeId(itemUrl), type: "movie", name: title, poster: poster || undefined });
  });
  return [...result.values()].slice(0, 100);
}
function tagSlug(value) { return clean(value).toLowerCase().normalize("NFKD").replace(/[\\u0300-\\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function catalogUrl({ page = 1, search = "", genre = "", mode = "javrider" } = {}) {
  const number = Math.max(1, Number(page) || 1);
  if (search) return `${BASE_URL}/${number > 1 ? `page/${number}/` : ""}?s=${encodeURIComponent(search)}`;
  if (genre) {
    const category = { Subtitle: "subtitle", Censored: "censored", FC2: "fc2", English: "english" }[genre];
    const path = category ? `category/${category}` : `tag/${tagSlug(genre)}`;
    return `${BASE_URL}/${path}/${number > 1 ? `page/${number}/` : ""}`;
  }
  if (mode === "javrider-popular") return `${BASE_URL}/?orderby=popular${number > 1 ? `&paged=${number}` : ""}`;
  return number > 1 ? `${BASE_URL}/page/${number}/` : `${BASE_URL}/`;
}
async function scrapeJavRiderCatalog(options = {}) { const url = catalogUrl(options), key = `catalog:${url}`, hit = cacheGet(key); if (hit) return hit; try { const result = parseCatalog(await get(url), url); return cacheSet(key, result); } catch (error) { console.error("javrider catalog:", error.message); return []; } }
async function scrapeJavRiderMeta(id) { const url = idToUrl(id); if (!url) return null; const key = `meta:${url}`, hit = cacheGet(key); if (hit) return hit; try { const html = await get(url), $ = cheerio.load(html), title = clean($("h1.entry-title,h1.post-title,article h1,h1").first().text()), poster = normalizePoster($("meta[property='og:image']").attr("content") || $("article img,.post-content img").first().attr("src"), url), content = $(".entry-content,.post-content,article .content").first(), description = clean($("meta[property='og:description'],meta[name='description']").attr("content") || content.find("p").first().text()), body = clean(content.text() || $("body").text()), genre = $("a[href*='/category/'],a[href*='/tag/']").map((_, element) => clean($(element).text())).get().filter(Boolean), cast = $("a[href*='/actor/']").map((_, element) => clean($(element).text())).get().filter(Boolean), runtime = body.match(/Duration:\s*([0-9]+\s*(?:hours?|hrs?|minutes?|mins?)(?:\s*[0-9]+\s*(?:minutes?|mins?))?)/i)?.[1], releaseInfo = body.match(/(?:Release Date|Published):\s*([0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/i)?.[1] || clean($("time").first().text()); const meta = { id, type: "movie", name: title || id, poster: poster || undefined, description: description || undefined, releaseInfo: releaseInfo || undefined }; if (runtime) meta.runtime = runtime; if (genre.length) meta.genre = [...new Set(genre)].slice(0, 30); if (cast.length) meta.cast = [...new Set(cast)].slice(0, 30); return cacheSet(key, meta); } catch (error) { console.error("javrider meta:", error.message); return null; } }
async function scrapeJavRiderStreams(id) {
  const url = idToUrl(id); if (!url) return [];
  const key = `streams:${url}`, hit = cacheGet(key); if (hit) return hit;
  try {
    const html = await get(url), $ = cheerio.load(html), players = new Set();
    $("iframe[src],embed[src]").each((_, element) => players.add(absolute($(element).attr("src"), url)));
    for (const candidate of html.match(/https?:\/\/javplayers\.com\/video\/[a-z0-9]+[^"'<>\s]*/gi) || []) players.add(candidate.replace(/&amp;/g, "&"));
    const media = new Set();
    $("video[src],video source[src],audio[src],audio source[src]").each((_, element) => { const candidate = absolute($(element).attr("src"), url); if (MEDIA_PATTERN.test(candidate) && !AD_PATTERN.test(candidate)) media.add(candidate); });
    const hlsId = html.match(/(?:akmicdn\.com\/cdn\/down\/|javplayers\.com\/cdn\/hls\/)([a-f0-9]{32})\//i)?.[1];
    if (hlsId) media.add(`https://javplayers.com/cdn/hls/${hlsId}/master.txt`);
    if (!media.size) {
      const playersToResolve = [...players].slice(0, 3);
      const apiResults = await Promise.all(playersToResolve.map(async player => {
        const playerId = player.match(/\/video\/([a-z0-9]+)(?:[/?#]|$)/i)?.[1];
        if (!playerId) return "";
        const playerHtml = await get(`https://javplayers.com/player/index.php?data=${encodeURIComponent(playerId)}&do=getVideo`, player).catch(() => "");
        const playerHlsId = playerHtml.match(/(?:akmicdn\.com\/cdn\/down\/|javplayers\.com\/cdn\/hls\/)([a-f0-9]{32})\//i)?.[1];
        return playerHlsId ? `https://javplayers.com/cdn/hls/${playerHlsId}/master.txt` : "";
      }));
      for (const candidate of apiResults.filter(Boolean)) media.add(candidate);
    }
    if (!media.size) {
      for (const player of [...players].slice(0, 2)) {
        for (const candidate of await capture(player, url).catch(error => { console.error("javrider player:", error.message); return []; })) media.add(candidate);
        if (media.size) break;
      }
    }
    const streams = [...media].slice(0, 10).map((mediaUrl, index) => { const isHls = /\.m3u8|master\.txt|\/cdn\/hls\//i.test(mediaUrl); return { name: "AVMirror", title: `JavRider • ${isHls ? "HLS" : "MP4"}${index ? ` ${index + 1}` : ""}`, url: mediaUrl, behaviorHints: isHls ? { notWebReady: false, bingeGroup: "javrider" } : {} }; });
    return streams.length ? cacheSet(key, streams) : [];
  } catch (error) { console.error("javrider streams:", error.message); return []; }
}
async function closeJavRiderBrowser() { const browser = await browserPromise?.catch(() => null); browserPromise = null; if (browser) await browser.close().catch(() => {}); }
module.exports = { JAVRIDER_GENRES, scrapeJavRiderCatalog, scrapeJavRiderMeta, scrapeJavRiderStreams, closeJavRiderBrowser };
