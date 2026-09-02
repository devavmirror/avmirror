const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const cheerio = require("cheerio");

const JABLE_BASE_URL = "https://jable.tv";
const JABLE_ASSET_HOST = "assets-cdn.jable.tv";
const CACHE_TTL_MS = Number(process.env.JABLE_CACHE_TTL_MS || 300000);
const META_CACHE_TTL_MS = Number(process.env.JABLE_META_CACHE_TTL_MS || 3600000);
const STREAM_CACHE_TTL_MS = Number(process.env.JABLE_STREAM_CACHE_TTL_MS || 90000);
const REQUEST_TIMEOUT_MS = Number(process.env.JABLE_REQUEST_TIMEOUT_MS || 30000);
const PLAYER_WAIT_MS = Number(process.env.JABLE_PLAYER_WAIT_MS || 1800);
const HEADLESS = String(process.env.BROWSER_HEADLESS || "true").toLowerCase() !== "false";
const USER_AGENT = process.env.USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
const AD_HOSTS = /(^|\.)(?:doubleclick\.net|googlesyndication\.com|googleadservices\.com|adservice\.google\.com|popads\.net|popcash\.net|propellerads\.com|exoclick\.com|trafficjunky\.net|onclick\.com|adsterra\.com|juicyads\.com|hilltopads\.net|admaven\.com|mayzaent\.com|tapioni\.com|labadena\.com|mnaspm\.com|fluxtrck\.site)$/i;
const AD_PATH = /(?:\/ads?(?:[/?#]|$)|\/banner(?:s)?(?:[/?#]|$)|\/pop(?:under|up)?(?:[/?#]|$)|\/smartpop(?:[/?#]|$)|\/splash\.php(?:[/?#]|$))/i;

const JABLE_TAGS = [
  ["Black Pantyhose", "black-pantyhose"], ["Knee Socks", "knee-socks"], ["Sportswear", "sportswear"],
  ["Pantyhose", "pantyhose"], ["Glasses", "glasses"], ["Cosplay", "Cosplay"], ["Swimsuit", "swimsuit"],
  ["School Uniform", "school-uniform"], ["Maid", "maid"], ["Kimono", "kimono"], ["Stockings", "stockings"],
  ["Bunny Girl", "bunny-girl"], ["Mature Woman", "mature-woman"], ["Big Tits", "big-tits"],
  ["Beautiful Legs", "beautiful-leg"], ["Beautiful Butt", "beautiful-butt"], ["Tattoo", "tattoo"],
  ["Blowjob", "blowjob"], ["Deep Throat", "deep-throat"], ["Kiss", "kiss"], ["Creampie", "creampie"],
  ["Outdoor", "outdoor"], ["Bondage", "bondage"], ["Massage", "massage"], ["Group Sex", "groupsex"],
  ["3P", "3p"], ["NTR", "ntr"], ["Teacher", "teacher"], ["Nurse", "nurse"], ["Idol", "idol"],
  ["OL", "ol"], ["Couple", "couple"], ["Private Cam", "private-cam"], ["School", "school"]
];
const JABLE_GENRES = JABLE_TAGS.map(([name]) => name);

const cache = new Map();
let browserPromise = null;
let contextPromise = null;

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function abs(value, base = JABLE_BASE_URL) {
  if (!value) return null;
  try { return new URL(String(value).replace(/&amp;/gi, "&"), base).href; } catch { return null; }
}

function cacheGet(key, ttl = CACHE_TTL_MS) {
  const entry = cache.get(key);
  return entry && Date.now() - entry.time < ttl ? entry.value : null;
}

function cacheSet(key, value) {
  cache.set(key, { time: Date.now(), value });
  while (cache.size > 400) cache.delete(cache.keys().next().value);
  return value;
}

function makeJableId(url) {
  const canonical = abs(url);
  return canonical ? `jable:${Buffer.from(canonical, "utf8").toString("base64url")}` : null;
}

function idToJableUrl(id) {
  if (typeof id !== "string" || !id.startsWith("jable:")) return null;
  try {
    const url = new URL(Buffer.from(id.slice(6), "base64url").toString("utf8"));
    return url.origin === JABLE_BASE_URL && /^\/videos\/[^/?#]+\/?$/i.test(url.pathname) ? url.href : null;
  } catch { return null; }
}

function isJableVideoUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.origin === JABLE_BASE_URL && /^\/videos\/[^/?#]+\/?$/i.test(url.pathname);
  } catch { return false; }
}

function normalizePoster(value, base = JABLE_BASE_URL) {
  const url = abs(value, base);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!/^https?:$/i.test(parsed.protocol) || parsed.hostname !== JABLE_ASSET_HOST) return null;
    if (/\/assets\/images\/(?:placeholder-md|logo|avatar)\./i.test(parsed.pathname)) return parsed.href;
    return /\/contents\/videos_screenshots\/\d+\/\d+\/(?:320x180\/1|preview)\.(?:jpe?g|png|webp)$/i.test(parsed.pathname)
      ? parsed.href
      : null;
  } catch { return null; }
}

function isMediaUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || !/(^|\.)mushroomtrack\.com$/i.test(url.hostname) || AD_HOSTS.test(url.hostname) || AD_PATH.test(url.pathname + url.search)) return false;
    return /\.(?:m3u8|mp4|m4v|webm|m4s|ts)(?:[?#]|$)/i.test(url.pathname + url.search)
      || /\/(?:hls|stream|playlist|manifest)(?:[/?#]|$)/i.test(url.pathname);
  } catch { return false; }
}

function isHlsUrl(value) {
  return /\.m3u8(?:[?#]|$)/i.test(String(value || ""));
}

function isPlayableStreamUrl(value) {
  return isMediaUrl(value) && /\.(?:m3u8|mp4|m4v|webm)(?:[?#]|$)/i.test(String(value || ""));
}

function tagSlug(value) {
  const text = clean(value);
  const known = JABLE_TAGS.find(([name, slug]) => name.toLowerCase() === text.toLowerCase() || slug.toLowerCase() === text.toLowerCase());
  if (known) return known[1];
  return text.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
}

function catalogUrl({ page = 1, search = "", genre = "", mode = "jable" } = {}) {
  const number = Math.max(1, Math.floor(Number(page) || 1));
  const query = clean(search);
  if (query) return `${JABLE_BASE_URL}/search/${encodeURIComponent(query)}/${number > 1 ? `${number}/` : ""}`;
  if (genre) {
    const slug = tagSlug(genre);
    return `${JABLE_BASE_URL}/tags/${encodeURIComponent(slug)}/${number > 1 ? `${number}/` : ""}`;
  }
  const section = mode === "jable-popular" ? "hot" : "latest-updates";
  return `${JABLE_BASE_URL}/${section}/${number > 1 ? `${number}/` : ""}`;
}

function cardFor($, anchor) {
  const parents = $(anchor).parents().toArray();
  const withCardParts = parents.find(element => $(element).find('img, .detail, h6.title').length >= 2 && $(element).find('a[href*="/videos/"]').length >= 1);
  if (withCardParts) return $(withCardParts);
  return $(anchor).closest("article,.video-block,.video-item,.item,li").first();
}

function collectJableCatalog(html) {
  const $ = cheerio.load(String(html || ""));
  const result = new Map();
  $('a[href*="/videos/"]').each((_, anchor) => {
    const href = abs($(anchor).attr("href"));
    if (!isJableVideoUrl(href)) return;
    const card = cardFor($, anchor);
    const image = card.find("img").first();
    const title = clean(card.find("h6.title,h5.title,h4.title,.title").first().text()) || clean($(anchor).text());
    if (!title || /^\d{1,2}:\d{2}(?::\d{2})?$/.test(title)) return;
    const poster = normalizePoster(
      image.attr("data-src") || image.attr("data-lazy-src") || image.attr("data-original") || image.attr("src") || image.attr("srcset")?.split(",")[0]?.trim()?.split(/\s+/)[0]
    );
    const duration = clean(card.find(".absolute-bottom-right .label,.duration,.label").first().text()).match(/\d{1,2}:\d{2}(?::\d{2})?/i)?.[0];
    const item = result.get(href) || { id: makeJableId(href), type: "movie", name: title };
    if (title.length > item.name.length || /^\d/.test(item.name)) item.name = title;
    if (poster) item.poster = poster;
    if (duration) item.runtime = duration;
    result.set(href, item);
  });
  return [...result.values()].slice(0, 100);
}

function parseJableMeta(html, id, pageUrl) {
  const $ = cheerio.load(String(html || ""));
  const title = clean($("h1").first().text())
    || clean($("meta[property='og:title']").attr("content"))
    || id;
  const poster = [
    $("meta[property='og:image']").attr("content"),
    $("video[poster]").attr("poster"),
    $("img[src*='videos_screenshots']").first().attr("src"),
    $("img[data-src*='videos_screenshots']").first().attr("data-src")
  ].map(value => normalizePoster(value, pageUrl)).find(Boolean);
  const body = clean($("main").text() || $("body").text());
  const description = clean($("meta[property='og:description'],meta[name='description']").attr("content"))
    .replace(/\s*[-|]\s*Jable\.TV.*$/i, "");
  const models = [...new Set($("a[href*='/models/']").map((_, element) => clean($(element).text())).get().filter(Boolean))].slice(0, 30);
  const categories = [...new Set($("a[href*='/categories/'],a[href*='/tags/']").map((_, element) => clean($(element).text())).get().filter(Boolean))].slice(0, 30);
  const runtime = body.match(/\d{1,2}:\d{2}:\d{2}/)?.[0] || body.match(/\d{1,2}:\d{2}/)?.[0];
  const releaseInfo = $("time[datetime]").attr("datetime")?.slice(0, 10) || body.match(/\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/)?.[0]?.replace(/\//g, "-");
  const meta = { id, type: "movie", name: title };
  if (poster) meta.poster = poster;
  if (description && !/jable\.tv|免費高清|av在線看/i.test(description)) meta.description = description;
  if (models.length) meta.cast = models;
  if (categories.length) meta.genre = categories;
  if (runtime) meta.runtime = runtime;
  if (releaseInfo) meta.releaseInfo = releaseInfo;
  return meta;
}

function extractJableStreamUrls(html, pageUrl, networkMedia = []) {
  const source = String(html || "")
    .replace(/&amp;/gi, "&")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/");
  const found = [];
  const add = value => {
    const url = abs(String(value || "").replace(/[),;]+$/, ""), pageUrl);
    if (url && isPlayableStreamUrl(url) && !found.includes(url)) found.push(url);
  };
  for (const match of source.matchAll(/\bhlsUrl\s*=\s*['"]([^'"]+)['"]/gi)) add(match[1]);
  for (const match of source.matchAll(/https?:[^"'<>\s]+\.(?:m3u8|mp4|m4v|webm)(?:\?[^"'<>\s]*)?/gi)) add(match[0]);
  const $ = cheerio.load(source);
  $("video[src],video source[src],audio[src],audio source[src],video[data-src],source[data-src]").each((_, element) => add($(element).attr("src") || $(element).attr("data-src")));
  for (const media of networkMedia) add(media);
  return [...new Set(found)].sort((a, b) => Number(isHlsUrl(a)) > Number(isHlsUrl(b)) ? -1 : 1).slice(0, 10);
}

function challengePage(html) {
  const text = String(html || "").slice(0, 30000);
  return /<title>\s*(?:just a moment|attention required|cloudflare)/i.test(text)
    || /enable javascript and cookies to continue|performing security verification|verify you are human/i.test(text);
}

function isAdRequest(url) {
  try {
    const parsed = new URL(url);
    return AD_HOSTS.test(parsed.hostname) || AD_PATH.test(parsed.pathname + parsed.search);
  } catch { return false; }
}

async function getBrowser() {
  if (!browserPromise) {
    const configuredPath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
    const appDir = process.pkg ? path.dirname(process.execPath) : path.resolve(__dirname, "..");
    const bundledCandidates = process.platform === "win32"
      ? fs.globSync(path.join(appDir, "chromium", "**", "chrome.exe"))
      : [...fs.globSync(path.join(appDir, "chromium", "**", "headless_shell")), ...fs.globSync(path.join(appDir, "chromium", "**", "chrome"))];
    const candidates = [configuredPath, bundledCandidates[0], "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/snap/bin/chromium"].filter(Boolean);
    const executablePath = candidates.find(fs.existsSync);
    browserPromise = chromium.launch({
      ...(executablePath ? { executablePath } : {}),
      headless: HEADLESS,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
    }).catch(error => { browserPromise = null; throw error; });
  }
  return browserPromise;
}

async function getContext() {
  if (!contextPromise) {
    contextPromise = (async () => {
      const browser = await getBrowser();
      return browser.newContext({
        userAgent: USER_AGENT,
        viewport: { width: 1280, height: 900 },
        javaScriptEnabled: true,
        ignoreHTTPSErrors: true,
        locale: "en-US"
      });
    })().catch(error => { contextPromise = null; throw error; });
  }
  return contextPromise;
}

async function readJablePage(url, { captureMedia = false, waitMs = 900 } = {}) {
  const context = await getContext();
  const page = await context.newPage();
  const media = new Set();
  const addMedia = value => { if (isMediaUrl(value)) media.add(value); };
  if (captureMedia) {
    page.on("request", request => addMedia(request.url()));
    page.on("response", response => {
      addMedia(response.url());
      const type = String(response.headers()["content-type"] || "").toLowerCase();
      if (type.includes("mpegurl") || type.startsWith("video/")) media.add(response.url());
    });
  }
  await page.route("**/*", async route => {
    if (isAdRequest(route.request().url())) return route.abort();
    return route.continue();
  });
  let navigationError = null;
  try {
    await page.goto(url, { referer: `${JABLE_BASE_URL}/`, waitUntil: "domcontentloaded", timeout: REQUEST_TIMEOUT_MS });
  } catch (error) {
    navigationError = error;
  }
  await page.waitForLoadState("networkidle", { timeout: 7000 }).catch(() => {});
  if (waitMs > 0) await page.waitForTimeout(waitMs);
  const html = await page.content().catch(() => "");
  const finalUrl = page.url();
  await page.close().catch(() => {});
  if (!html || challengePage(html)) throw new Error("Jable.TV bloqueou a sessão com um desafio Cloudflare");
  if (navigationError && !html.includes("/videos/") && !html.includes("latest-updates")) throw navigationError;
  return { html, url: finalUrl || url, media: [...media] };
}

async function scrapeJableCatalog({ page = 1, search = "", genre = "", mode = "jable" } = {}) {
  const url = catalogUrl({ page, search, genre, mode });
  const key = `catalog:${url}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  try {
    const document = await readJablePage(url, { waitMs: 700 });
    return cacheSet(key, collectJableCatalog(document.html));
  } catch (error) {
    console.error("Jable catalog:", error.message);
    return [];
  }
}

async function scrapeJableMeta(id) {
  const url = idToJableUrl(id);
  if (!url) return null;
  const key = `meta:${id}`;
  const cached = cacheGet(key, META_CACHE_TTL_MS);
  if (cached) return cached;
  try {
    const document = await readJablePage(url, { waitMs: 900 });
    return cacheSet(key, parseJableMeta(document.html, id, document.url));
  } catch (error) {
    console.error("Jable meta:", error.message);
    return null;
  }
}

function streamObject(url, pageUrl) {
  const headers = {
    Referer: pageUrl,
    Origin: JABLE_BASE_URL,
    "User-Agent": USER_AGENT
  };
  return {
    name: "Jable.TV",
    title: `Jable.TV • ${isHlsUrl(url) ? "HLS" : "MP4"}`,
    url,
    headers,
    behaviorHints: {
      notWebReady: false,
      bingeGroup: "jable",
      proxyHeaders: { request: headers }
    }
  };
}

async function scrapeJableStreams(id) {
  const pageUrl = idToJableUrl(id);
  if (!pageUrl) return [];
  const key = `streams:${id}`;
  const cached = cacheGet(key, STREAM_CACHE_TTL_MS);
  if (cached) return cached;
  try {
    const document = await readJablePage(pageUrl, { captureMedia: true, waitMs: PLAYER_WAIT_MS });
    const urls = extractJableStreamUrls(document.html, document.url || pageUrl, document.media);
    const streams = urls.map(url => streamObject(url, pageUrl));
    return cacheSet(key, streams);
  } catch (error) {
    console.error("Jable streams:", error.message);
    return [];
  }
}

async function closeJableBrowser() {
  const context = await (contextPromise || Promise.resolve(null)).catch(() => null);
  contextPromise = null;
  if (context) await context.close().catch(() => {});
  const browser = await (browserPromise || Promise.resolve(null)).catch(() => null);
  browserPromise = null;
  if (browser) await browser.close().catch(() => {});
}

module.exports = {
  JABLE_BASE_URL,
  JABLE_GENRES,
  catalogUrl,
  makeJableId,
  idToJableUrl,
  isJableVideoUrl,
  collectJableCatalog,
  parseJableMeta,
  extractJableStreamUrls,
  scrapeJableCatalog,
  scrapeJableMeta,
  scrapeJableStreams,
  closeJableBrowser
};
