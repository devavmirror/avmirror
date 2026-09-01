const cheerio = require("cheerio");
const { chromium } = require("playwright");

const BASE_URL = "https://javhd.today";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139 Safari/537.36";
const CACHE_TTL_MS = Number(process.env.JAVHD_CACHE_MS || 900000);
const cache = new Map();
let browserPromise = null;
let contextPromise = null;

const JAVHD_GENRES = ["Censored", "Uncensored", "English Subtitle", "Chinese Subtitle", "Reducing Mosaic", "Amateur"];
const CATEGORY_URLS = {
  "Censored": "/jav-censored/",
  "Uncensored": "/uncensored-jav/",
  "English Subtitle": "/eng-sub-jav/",
  "Chinese Subtitle": "/chinese-subtitle/",
  "Reducing Mosaic": "/reducing-mosaic/",
  "Amateur": "/amateur/"
};
const AD_PATTERN = /(?:whitetrafsa|bakestubborn|magsrv|doubleclick|googlesyndication|chaturbate|smartpop|popunder|popup|ad-provider|notifications\/utility|pornfhd\.com\/files)/i;

const clean = value => String(value || "").replace(/\s+/g, " ").trim();
function absolute(value, base = BASE_URL) { try { return new URL(String(value || ""), base).href; } catch { return ""; } }
function allowedPage(value) { try { const u = new URL(value); return u.protocol === "https:" && /^(?:www\.)?javhd\.today$/i.test(u.hostname); } catch { return false; } }
function makeId(url) { return `javhd:${Buffer.from(url).toString("base64url")}`; }
function idToUrl(id) { try { const url = Buffer.from(String(id || "").slice(6), "base64url").toString("utf8"); return allowedPage(url) && /^\/\d+\//.test(new URL(url).pathname) ? url : ""; } catch { return ""; } }
function cacheGet(key) { const item = cache.get(key); return item && item.expires > Date.now() ? item.value : null; }
function cacheSet(key, value) { cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS }); return value; }
async function get(url) {
  const hit = cacheGet(`http:${url}`); if (hit) return hit;
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" } });
  if (!response.ok) throw new Error(`JavHD HTTP ${response.status}`);
  return cacheSet(`http:${url}`, await response.text());
}
async function getBrowser() {
  if (!browserPromise) browserPromise = chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] }).catch(error => { browserPromise = null; throw error; });
  return browserPromise;
}
async function getContext() {
  if (!contextPromise) contextPromise = getBrowser().then(browser => browser.newContext({ userAgent: USER_AGENT, locale: "en-US", viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true })).catch(error => { contextPromise = null; throw error; });
  return contextPromise;
}
function parseCard($, element, pageUrl) {
  const href = absolute($(element).attr("href"), pageUrl);
  if (!/^https:\/\/(?:www\.)?javhd\.today\/\d+\//i.test(href)) return null;
  const root = $(element).closest("article,.thumb-block,.video-block,.post,li,div").first();
  const title = clean($(element).attr("title") || $(element).text() || root.find("h2,h3,.title").first().text());
  const image = root.find("img").first();
  const poster = absolute(image.attr("data-src") || image.attr("data-lazy-src") || image.attr("src") || image.attr("srcset")?.split(/[ ,]/)[0], pageUrl);
  return title ? { type: "movie", id: makeId(href), name: title, poster: poster || undefined } : null;
}
function parseCatalog(html, pageUrl) { const $ = cheerio.load(html), out = new Map(); $("a[href]").each((_, element) => { const item = parseCard($, element, pageUrl); if (item && !out.has(item.id)) out.set(item.id, item); }); return [...out.values()].slice(0, 100); }
function catalogUrl({ page = 1, search = "", genre = "", mode = "javhd" } = {}) {
  const pageNumber = Math.max(1, Number(page) || 1);
  if (search) return `${BASE_URL}/search/video/?s=${encodeURIComponent(search)}${pageNumber > 1 ? `&paged=${pageNumber}` : ""}`;
  const section = genre === "English Subtitle" ? "engsub" : genre === "Uncensored" ? "uncensored" : genre === "Reducing Mosaic" ? "mosaic" : genre === "Amateur" ? "amateur" : genre === "Chinese Subtitle" ? "chinese" : genre === "Censored" ? "recent" : mode === "javhd-popular" ? "topmostsearch" : "recent";
  if (pageNumber === 1) return `${BASE_URL}/?ajax=fp_section&s=${section}`;
  const path = genre && CATEGORY_URLS[genre] ? CATEGORY_URLS[genre] : mode === "javhd-popular" ? "/rated/today/" : "/recent/";
  return `${BASE_URL}${path}page/${pageNumber}/`;
}
function parseCatalogResponse(html, url) { try { const payload = JSON.parse(html); return parseCatalog(payload.html || "", url); } catch { return parseCatalog(html, url); } }
async function scrapeJavHdCatalog(options = {}) { const url = catalogUrl(options), key = `catalog:${url}`, hit = cacheGet(key); if (hit) return hit; try { const result = parseCatalogResponse(await get(url), url); return result.length ? cacheSet(key, result) : result; } catch (error) { console.error("javhd catalog:", error.message); return []; } }
function parseMeta(html, url) {
  const $ = cheerio.load(html), title = clean($("h1").first().text() || $("meta[property='og:title']").attr("content") || $("title").text()), poster = absolute($("meta[property='og:image']").attr("content") || $("img").first().attr("src"), url), body = clean($(".entry-content,article,body").first().text()), genre = $("a[href*='/tag/'],a[href*='/category/']").map((_, e) => clean($(e).text())).get().filter(Boolean);
  return { id: makeId(url), type: "movie", name: title, poster: poster || undefined, description: clean($("meta[property='og:description'],meta[name='description']").attr("content") || body).slice(0, 2000), releaseInfo: body.match(/Release Day:\s*([0-9-]+)/i)?.[1], genre: [...new Set(genre)].slice(0, 20) };
}
async function scrapeJavHdMeta(id) { const url = idToUrl(id); if (!url) return null; const key = `meta:${url}`, hit = cacheGet(key); if (hit) return hit; try { return cacheSet(key, parseMeta(await get(url), url)); } catch (error) { console.error("javhd meta:", error.message); return null; } }
function decodeBase64(value) { try { return Buffer.from(String(value || ""), "base64").toString("utf8"); } catch { return ""; } }
const TRUSTED_MEDIA_HOSTS = /(?:^|\.)stream\.javhdz\.today$|(?:^|\.)mycloudz\.cc$|(?:^|\.)cloudwish\.xyz$|(?:^|\.)turbovid\.vip$|(?:^|\.)dooood\.com$|(?:^|\.)streambeast\.upn\.one$|(?:^|\.)avgle\.com$|(?:^|\.)acek-cdn\.com$/i;
function isMediaUrl(value) { try { const url = new URL(value); return url.protocol === "https:" && TRUSTED_MEDIA_HOSTS.test(url.hostname) && !AD_PATTERN.test(url.hostname + url.pathname + url.search) && /\.(?:m3u8|mp4)(?:[?#]|$)/i.test(value); } catch { return false; } }
async function captureServer(serverUrl, pageUrl) {
  const context = await getContext(), page = await context.newPage(), media = new Set();
  await page.route("**/*", async route => { try { const u = new URL(route.request().url()); if (AD_PATTERN.test(u.hostname + u.pathname + u.search)) return route.abort(); } catch {} return route.continue(); });
  const collect = request => { const url = request.url(), type = String(request.headers?.()["content-type"] || "").toLowerCase(); if (isMediaUrl(url) || type.includes("mpegurl") || type.startsWith("video/")) media.add(url); };
  page.on("request", collect); page.on("response", collect);
  try {
    await page.goto(serverUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(5000);
    for (const selector of [".vjs-big-play-button", ".jw-icon-play", ".plyr__control--overlaid", ".play-button", "button[aria-label*='play' i]", "[role=button][aria-label*='play' i]", "video"]) { const controls = page.locator(selector), count = await controls.count().catch(() => 0); for (let index = 0; index < Math.min(count, 2); index++) await controls.nth(index).click({ force: true, timeout: 2500 }).catch(() => {}); }
    for (const mediaElement of await page.locator("video, source").all().catch(() => [])) { const candidate = await mediaElement.getAttribute("src").catch(() => ""); if (candidate && isMediaUrl(candidate)) media.add(absolute(candidate, serverUrl)); }
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      for (const selector of [".vjs-big-play-button", ".jw-icon-play", ".plyr__control--overlaid", ".play-button", "button[aria-label*='play' i]", "[role=button][aria-label*='play' i]"]) {
        const controls = frame.locator(selector), count = await controls.count().catch(() => 0);
        for (let index = 0; index < Math.min(count, 2); index++) await controls.nth(index).click({ force: true, timeout: 2500 }).catch(() => {});
      }
    }
    await page.waitForTimeout(12000);
    const resources = await page.evaluate(() => performance.getEntriesByType("resource").map(entry => entry.name)).catch(() => []);
    for (const resource of resources) if (isMediaUrl(resource)) media.add(resource);
    const sources = await page.locator("video, source").evaluateAll(nodes => nodes.map(node => node.currentSrc || node.src || node.getAttribute("src")).filter(Boolean)).catch(() => []);
    for (const source of sources) if (isMediaUrl(source)) media.add(source);
    return [...media].filter(isMediaUrl);
  } finally { await page.close().catch(() => {}); }
}
async function scrapeJavHdStreams(id) {
  const url = idToUrl(id); if (!url) return [];
  const key = `streams:${url}`, hit = cacheGet(key); if (hit) return hit;
  try {
    const html = await get(url), $ = cheerio.load(html), numericId = new URL(url).pathname.match(/^\/(\d+)\//)?.[1], embed = numericId ? `${BASE_URL}/embed/${numericId}/` : absolute($("iframe[src*='/embed/']").attr("src"), url); if (!embed) return [];
    const embedHtml = await get(embed), embed$ = cheerio.load(embedHtml), rawServers = embed$(".server-option[data-embed]").map((_, element) => ({ name: embed$(element).attr("data-name") || "", url: decodeBase64(embed$(element).attr("data-embed")) })).get().filter(server => /^https:\/\//i.test(server.url) && !/watch-full|download/i.test(server.url)), servers = [...rawServers.filter(server => /mycloudz|cloudwish|turbovid|avgle/i.test(server.name + server.url)), ...rawServers].filter((server, index, list) => list.findIndex(item => item.url === server.url) === index).map(server => server.url);
    const media = new Set();
    for (const server of servers.slice(0, 3)) for (const candidate of await captureServer(server, embed)) if (!AD_PATTERN.test(candidate) && isMediaUrl(candidate)) media.add(candidate);
    const streams = [...media].slice(0, 10).map((mediaUrl, index) => ({ name: "AVMirror", title: `JavHD • ${/\.m3u8/i.test(mediaUrl) ? "HLS" : "MP4"}${index ? ` ${index + 1}` : ""}`, url: mediaUrl, behaviorHints: /\.m3u8/i.test(mediaUrl) ? { notWebReady: false, bingeGroup: "javhd" } : {} }));
    return streams.length ? cacheSet(key, streams) : [];
  } catch (error) { console.error("javhd streams:", error.message); return []; }
}
async function closeJavHdBrowser() { const context = await contextPromise?.catch(() => null); contextPromise = null; if (context) await context.close().catch(() => {}); const browser = await browserPromise?.catch(() => null); browserPromise = null; if (browser) await browser.close().catch(() => {}); }
module.exports = { JAVHD_GENRES, scrapeJavHdCatalog, scrapeJavHdMeta, scrapeJavHdStreams, closeJavHdBrowser };
