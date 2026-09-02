const cheerio = require("cheerio");
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const BASE_URL = (process.env.BASE_URL || "https://jav.guru").replace(/\/+$/, "");
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 900000);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 12000);
const PLAYER_TIMEOUT_MS = Number(process.env.PLAYER_TIMEOUT_MS || 10000);
const CACHE_MAX_ENTRIES = Number(process.env.CACHE_MAX_ENTRIES || 500);
const HEADLESS = String(process.env.BROWSER_HEADLESS || "true") !== "false";
const ENABLE_BROWSER_STREAMS = String(process.env.ENABLE_BROWSER_STREAMS || "true").toLowerCase() === "true";
const USER_AGENT = process.env.USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
const BLOCKED_HOSTS = /(^|\.)(?:mayzaent\.com|ruddy-pass\.com|godkc\.com|growcdnssedge\.com)$/i;
const AD_HOSTS = /(^|\.)(?:doubleclick\.net|googlesyndication\.com|googleadservices\.com|adservice\.google\.com|popads\.net|popcash\.net|propellerads\.com|exoclick\.com|trafficjunky\.net|onclick\.com|adsterra\.com|juicyads\.com|hilltopads\.net|admaven\.com)$/i;
const AD_URL_PARTS = /(?:\/ads?(?:[/?#]|$)|\/banner(?:s)?(?:[/?#]|$)|\/pop(?:under|up)?(?:[/?#]|$)|\/prebid(?:[/?#]|$)|\b(?:adserver|advert|advertisement|doubleclick|googlesyndication|tracking|tracker)\b)/i;

const cache = new Map();
const pending = new Map();
let browserPromise = null;
const clean = s => String(s || "").replace(/\s+/g, " ").trim();
function abs(u, b = BASE_URL) { if (!u) return null; try { return new URL(u, b).href; } catch { return null; } }
function normalizePoster(u, b = BASE_URL) {
  u = abs(u, b); if (!u) return null;
  try {
    const image = new URL(u);
    if (/(?:logo|logofinal|favicon|avatar|gravatar)/i.test(image.pathname + image.search)) return null;
    if (!/\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(image.pathname + image.search) && !/wp-content\/uploads/i.test(image.pathname)) return null;
    return image.href;
  } catch { return null; }
}
function cg(k) { const x = cache.get(k); return x && Date.now() - x.time < CACHE_TTL_MS ? x.value : null; }
function cs(k, v) {
  cache.set(k, { time: Date.now(), value: v });
  while (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
  return v;
}

async function get(url, referer = `${BASE_URL}/`, timeoutMs = REQUEST_TIMEOUT_MS) {
  const key = "http:" + url, c = cg(key); if (c) return c;
  if (pending.has(key)) return pending.get(key);
  const request = (async () => {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ac.signal, headers: { "user-agent": USER_AGENT, referer, "accept": "text/html,application/xhtml+xml" } });
      if (!r.ok) throw Error(`HTTP ${r.status}`);
      return cs(key, await r.text());
    } finally { clearTimeout(t); pending.delete(key); }
  })();
  pending.set(key, request);
  return request;
}
async function getFinal(url, referer, timeoutMs = REQUEST_TIMEOUT_MS) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { "user-agent": USER_AGENT, referer, "accept": "text/html,application/xhtml+xml" } });
    if (!r.ok) throw Error(`HTTP ${r.status}`);
    return { html: await r.text(), url: r.url };
  } finally { clearTimeout(t); }
}
async function getFinalInBrowser(url, referer = `${BASE_URL}/`, timeoutMs = PLAYER_TIMEOUT_MS) {
  const ctx = await newContext();
  try {
    const page = await ctx.newPage();
    const media = new Set();
    page.__avmirrorMedia = media;
    page.on("request", request => { if (isMediaUrl(request.url())) media.add(request.url()); });
    page.on("response", response => {
      const type = String(response.headers()["content-type"] || "").toLowerCase();
      if (isMediaUrl(response.url()) || type.includes("mpegurl") || type.startsWith("video/")) media.add(response.url());
    });
    await page.route("**/*", async route => {
      try { const parsed = new URL(route.request().url()); if (AD_HOSTS.test(parsed.hostname) || AD_URL_PARTS.test(parsed.pathname + parsed.search)) return route.abort(); } catch {}
      return route.continue();
    });
    await page.goto(url, { referer, waitUntil: "domcontentloaded", timeout: timeoutMs });
    await activatePlayerFrames(page, 1);
    return { html: await page.content(), url: page.url(), media: [...media] };
  } finally { await ctx.close().catch(() => {}); }
}
const PLAY_SELECTORS = "#overlay_layer, .playbutton, .play-button, .outer, .jw-display-icon-container, .jw-icon-play, .vjs-big-play-button, .plyr__control--overlaid, [aria-label*='Play' i], video";
async function activatePlayerFrames(page, rounds = 2) {
  for (let round = 0; round < rounds; round++) {
    for (const frame of page.frames()) {
      const controls = frame.locator(PLAY_SELECTORS);
      const count = await controls.count().catch(() => 0);
      for (let i = 0; i < Math.min(count, 3); i++) {
        const control = controls.nth(i);
        if (await control.isVisible().catch(() => false)) await control.click({ force: true, timeout: 2500 }).catch(() => {});
      }
    }
    await page.waitForTimeout(900);
  }
  for (const frame of page.frames()) {
    const sources = await frame.locator("video,video source,audio,audio source").evaluateAll(nodes => nodes.map(n => n.currentSrc || n.src || n.getAttribute("src")).filter(Boolean)).catch(() => []);
    for (const source of sources) if (/^https?:/i.test(source)) page.__avmirrorMedia?.add(source);
  }
}

async function getBrowser() {
  if (!browserPromise) {
    const configuredPath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
    const appDir = process.pkg ? path.dirname(process.execPath) : path.resolve(__dirname, "..");
    const bundledCandidates = process.platform === "win32" ? fs.globSync(path.join(appDir, "chromium", "**", "chrome.exe")) : [...fs.globSync(path.join(appDir, "chromium", "**", "headless_shell")), ...fs.globSync(path.join(appDir, "chromium", "**", "chrome"))];
    const bundled = bundledCandidates[0];
    const candidates = [configuredPath, bundled, "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/snap/bin/chromium", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", "C:\\Users\\Public\\Chrome\\chrome.exe"].filter(Boolean);
    const executablePath = candidates.find(fs.existsSync);
    if (configuredPath && !fs.existsSync(configuredPath)) console.warn(`PLAYWRIGHT_EXECUTABLE_PATH não existe; usando ${executablePath || "Chromium gerenciado pelo Playwright"}`);
    browserPromise = chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: HEADLESS, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] }).catch(e => { browserPromise = null; throw e; });
  }
  return browserPromise;
}
async function newContext() {
  return (await getBrowser()).newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 900 },
    javaScriptEnabled: true,
    ignoreHTTPSErrors: true,
    locale: "en-US"
  });
}
async function closeBrowser() { if (browserPromise) { const b = await browserPromise.catch(() => null); browserPromise = null; if (b) await b.close(); } }

function makeId(u) { return `avmirror:${Buffer.from(u).toString("base64url")}`; }
function idToUrl(id) {
  if (!id?.startsWith("avmirror:")) return null;
  try {
    const u = Buffer.from(id.slice(9), "base64url").toString("utf8");
    const parsed = new URL(u);
    if (parsed.origin !== new URL(BASE_URL).origin) return null;
    return u;
  } catch { return null; }
}
function isItemUrl(u) {
  try {
    const x = new URL(u);
    if (x.origin !== new URL(BASE_URL).origin) return false;
    return /^\/\d+\/[^/?#]+\/?$/i.test(x.pathname);
  } catch { return false; }
}

function parseCard($, el) {
  const links = $(el).find("a[href]").toArray();
  let link = null;
  for (const a of links) { const h = abs($(a).attr("href")); if (isItemUrl(h)) { link = a; break; } }
  if (!link) return null;
  const href = abs($(link).attr("href"));
  const title = clean($(link).text()) || clean($(el).find("h1,h2,h3,h4,.entry-title,.post-title,.title").first().text());
  if (!href || !title) return null;
  const img = $(el).find("img").first();
  const srcset = img.attr("srcset") || img.attr("data-srcset") || "";
  const poster = normalizePoster(img.attr("data-lazy-src") || img.attr("data-src") || img.attr("data-original") || img.attr("src") || srcset.split(",")[0]?.trim()?.split(" ")[0]);
  return { id: makeId(href), type: "movie", name: title, poster: poster || undefined };
}

function collectCatalogFromHtml(html) {
  const $ = cheerio.load(html), out = [], seen = new Set();
  for (const sel of ["article", ".inside-article", ".column", ".post", ".type-post", ".item", ".thumb-block", ".video-block", ".entry", "li"]) {
    $(sel).each((_, el) => {
      const x = parseCard($, el);
      if (x && !seen.has(x.id)) { seen.add(x.id); out.push(x); }
    });
    if (out.length >= 20) break;
  }
  if (out.length < 20) {
    $("a[href]").each((_, a) => {
      const href = abs($(a).attr("href"));
      if (!isItemUrl(href)) return;
      const title = clean($(a).text());
      if (!title || title.length < 2) return;
      const parent = $(a).parents().filter((_, el) => $(el).find("img").length > 0).first();
      const img = parent.find("img").first();
      const poster = normalizePoster(img.attr("data-lazy-src") || img.attr("data-src") || img.attr("src") || img.attr("srcset")?.split(",")[0]?.trim()?.split(" ")[0]);
      const x = { id: makeId(href), type: "movie", name: title, poster: poster || undefined };
      if (!seen.has(x.id)) { seen.add(x.id); out.push(x); }
    });
  }
  return out.slice(0, 100);
}

async function scrapeCatalog({ page = 1, search = "", genre = "", mode = "avmirror" }) {
  let url = search ? `${BASE_URL}/?s=${encodeURIComponent(search)}` : page <= 1 ? `${BASE_URL}/` : `${BASE_URL}/page/${page}/`;
  if (mode === "avmirror-popular") url = `${BASE_URL}/category/jav/?orderby=likes-today&order=DESC${page > 1 ? `&paged=${page}` : ""}`;
  if (genre) {
    const slug = String(genre).trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
    if (slug) url = `${BASE_URL}/tag/${encodeURIComponent(slug)}/${page > 1 ? `page/${page}/` : ""}?category_name=jav`;
  }
  if (mode === "avmirror-actors" && search) {
    try {
      const list = cheerio.load(await get(`${BASE_URL}/jav-actress-list/?taxonomy_search=${encodeURIComponent(search)}`));
      const actor = list('a[href*="/actress/"]').toArray().find(a => clean(list(a).text()).toLowerCase().includes(search.toLowerCase())) || list('a[href*="/actress/"]').first().get(0);
      const actorUrl = actor && abs(list(actor).attr("href"));
      if (actorUrl) url = `${actorUrl}${page > 1 ? `page/${page}/` : ""}`;
    } catch (e) { console.error("actor lookup:", e.message); }
  }
  const cacheKey = `catalog:${url}`;
  const cached = cg(cacheKey); if (cached) return cached;
  let result = [], ctx = null;
  try {
    result = collectCatalogFromHtml(await get(url));
    if (result.length) return cs(cacheKey, result);
  } catch (e) { console.error("catalog http:", e.message); }
  try {
    ctx = await newContext();
    const p = await ctx.newPage();
    await p.goto(url, { waitUntil: "domcontentloaded", timeout: REQUEST_TIMEOUT_MS });
    await p.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(1200);
    const itemOrigin = new URL(BASE_URL).origin;
    result = await p.locator("a[href]").evaluateAll((els, allowedOrigin) => els.map(a => {
      const href = a.href;
      let parsed;
      try { parsed = new URL(href, location.href); } catch { return null; }
      if (parsed.origin !== allowedOrigin || !/^\/\d+\/[^/?#]+\/?$/i.test(parsed.pathname)) return null;
      const root = a.closest("article,.post,.item,li,div") || a;
      const img = root.querySelector("img");
      const srcset = img?.getAttribute("srcset") || img?.getAttribute("data-srcset") || "";
      const poster = img?.getAttribute("data-lazy-src") || img?.getAttribute("data-src") || img?.getAttribute("data-original") || img?.getAttribute("src") || srcset.split(",")[0]?.trim()?.split(" ")[0] || null;
      const title = (a.innerText || root.querySelector("h1,h2,h3,h4,.entry-title,.post-title,.title")?.textContent || "").replace(/\s+/g," ").trim();
      return title ? { href: parsed.href, title, poster } : null;
    }).filter(Boolean).slice(0, 100), itemOrigin);
    result = result.map(x => ({ id: makeId(x.href), type: "movie", name: x.title, poster: normalizePoster(x.poster) || undefined }));
  } catch (e) {
    console.error("catalog browser:", e.message);
  } finally { if (ctx) await ctx.close(); }
  return cs(cacheKey, result);
}

async function scrapeMeta(id) {
  const url = idToUrl(id); if (!url) return null;
  const cached = cg("meta:" + id); if (cached) return cached;
  const $ = cheerio.load(await get(url));
  const article = $(".entry-content,.post-content,.single-content").first().length ? $(".entry-content,.post-content,.single-content").first() : $("main article,.single-post,article").first();
  const title = clean($("h1.entry-title,h1.post-title,article h1,h1").first().text());
  const generic = /(?:jav\.guru|trademarks and copyrights|18\+ only|watch online the best free jav|the best jav|this is a quality jav|all jav movies)/i;
  const ogDescription = clean($("meta[property='og:description'],meta[name='description']").attr("content"));
  const paragraphs = article.find("p").map((_, e) => clean($(e).text())).get().filter(text => text.length > 40 && !generic.test(text));
  const description = paragraphs[0] || (!generic.test(ogDescription) ? ogDescription : title);
  const metaImage = $("meta[property='og:image'],meta[property='og:image:url'],meta[name='twitter:image']").map((_, e) => $(e).attr("content")).get();
  const image = article.find("img").first();
  const imageValues = [image.attr("data-lazy-src"), image.attr("data-src"), image.attr("data-original"), image.attr("src"), ...(image.attr("srcset") || "").split(",").map(value => value.trim().split(/\s+/)[0])];
  let poster = [...metaImage, ...imageValues].map(value => normalizePoster(value, url)).find(Boolean) || null;
  if (!poster && ENABLE_BROWSER_STREAMS) {
    let ctx;
    try {
      ctx = await newContext();
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: REQUEST_TIMEOUT_MS });
      const browserImages = await page.locator("img").evaluateAll(nodes => nodes.flatMap(node => ["data-lazy-src", "data-src", "data-original", "src", "srcset"].map(name => node.getAttribute(name)).filter(Boolean)));
      poster = browserImages.map(value => normalizePoster(String(value).split(",")[0].trim().split(/\s+/)[0], url)).find(Boolean) || null;
    } catch (error) { console.error("meta poster browser:", error.message); }
    finally { if (ctx) await ctx.close().catch(() => {}); }
  }
  const info = $("h2").filter((_, e) => /^Movie Information:?$/i.test(clean($(e).text()))).first().closest("div");
  const scoped = info.length ? info : article;
  const uniqueLinks = selector => [...new Set(scoped.find(selector).map((_, e) => clean($(e).text()).replace(/\s*\([^)]*\)\s*$/, "")).get().filter(Boolean))];
  const genre = uniqueLinks("li.w1 a[rel='tag'],li.w1 a[href*='/tag/'],li:contains('Category:') a");
  const cast = uniqueLinks("li:contains('Actor:') a[href*='/actor/'],li:contains('Actress:') a[href*='/actress/']").filter(text => text.length < 80);
  const director = uniqueLinks("li:contains('Director:') a[href*='/director/']")[0];
  const studio = uniqueLinks("li:contains('Studio:') a[href*='/maker/']")[0];
  const body = clean(scoped.text() || article.text());
  const runtime = body.match(/(?:Duration|Runtime|Run Time)[:\s]+([0-9]+\s*(?:hours?|hrs?|minutes?|mins?)(?:\s*[0-9]+\s*(?:minutes?|mins?))?)/i)?.[1];
  let releaseInfo = body.match(/Release Date:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i)?.[1] || $("time[datetime]").attr("datetime") || clean($("time").first().text());
  $("script[type='application/ld+json']").each((_, script) => { try { const data = JSON.parse($(script).text()); const values = Array.isArray(data) ? data : [data, ...(data?.["@graph"] || [])]; const published = values.find(value => value?.datePublished)?.datePublished; if (published) releaseInfo = String(published).slice(0, 10); } catch {} });
  const meta = { id, type: "movie", name: title || id, poster: poster || undefined, description: description || undefined, releaseInfo: releaseInfo || undefined, genre: genre.slice(0, 30), cast: cast.slice(0, 30) };
  if (runtime) meta.runtime = runtime;
  if (director) meta.director = director;
  if (studio) meta.studio = studio;
  return cs("meta:" + id, meta);
}

function isMediaUrl(u) {
  if (!u || !/^https?:/i.test(u)) return false;
  try {
    const parsed = new URL(u);
    const target = parsed.pathname + parsed.search;
    if (BLOCKED_HOSTS.test(parsed.hostname) || AD_HOSTS.test(parsed.hostname) || AD_URL_PARTS.test(target)) return false;
    return /\.(m3u8|mp4|m4v|webm|mov|ts)(?:[?#].*)?$/i.test(target)
      || /(?:master\.(?:m3u|txt)|videoplayback|[/](?:manifest|playlist|stream|hls)(?:[/?.]|$))/i.test(target);
  } catch { return false; }
}
async function isPlayableHls(url, referer = `${BASE_URL}/`) {
  if (!/\.(?:m3u8|master\.txt)(?:[?#]|$)|\/cdn\/hls\//i.test(url)) return true;
  try {
    const playlistResponse = await fetch(url, { headers: { "user-agent": USER_AGENT, referer }, redirect: "follow" });
    if (!playlistResponse.ok) return false;
    const playlist = await playlistResponse.text();
    if (!/^\s*#EXTM3U/m.test(playlist)) return false;
    const child = playlist.split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith("#"));
    if (!child) return true;
    const childResponse = await fetch(new URL(child, url), { headers: { "user-agent": USER_AGENT, referer }, redirect: "follow" });
    if (!childResponse.ok) return false;
    const childPlaylist = await childResponse.text();
    if (!/^\s*#EXTM3U/m.test(childPlaylist)) return false;
    const segment = childPlaylist.split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith("#"));
    if (!segment) return true;
    const segmentResponse = await fetch(new URL(segment, new URL(child, url)), { headers: { "user-agent": USER_AGENT, referer }, redirect: "follow" });
    const type = String(segmentResponse.headers.get("content-type") || "").toLowerCase();
    return segmentResponse.ok && !/^(?:image\/|text\/|application\/json)/.test(type);
  } catch { return false; }
}
function isUsefulPlayerUrl(u) {
  if (!u || !/^https?:/i.test(u)) return false;
  try {
    const p = new URL(u);
    if (BLOCKED_HOSTS.test(p.hostname) || AD_HOSTS.test(p.hostname) || AD_URL_PARTS.test(p.pathname + p.search)) return false;
    if (p.origin === new URL(BASE_URL).origin && /^\/searcho\//i.test(p.pathname)) return true;
    return /(?:player|embed|video|stream|watch|iframe|play|media)/i.test(p.pathname + p.search) || p.origin !== new URL(BASE_URL).origin;
  } catch { return false; }
}

function decodeEmbeddedText(value) {
  return String(value || "")
    .replace(/\\u002f/gi, "/")
    .replace(/\\u003a/gi, ":")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\x2f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"');
}

function collectFallbackStreams(html, pageUrl) {
  const found = new Map();
  const players = new Set();
  const addMedia = (u, source) => {
    u = abs(String(u || "").replace(/[),;]+$/, ""), pageUrl);
    if (isMediaUrl(u)) found.set(u, { url: u, source, referer: pageUrl });
  };
  const addPlayer = u => {
    u = abs(u, pageUrl);
    if (isUsefulPlayerUrl(u)) players.add(u);
  };
  const decoded = decodeEmbeddedText(html);
  for (const u of decoded.match(/(?:https?:)?[/][/][^"'<>]+/g) || []) addMedia(u.trim(), "html");
  const $ = cheerio.load(decoded);
  $("iframe[src],embed[src],iframe[data-src],embed[data-src]").each((_, el) => {
    addPlayer($(el).attr("src") || $(el).attr("data-src"));
  });
  $("video[src],video source[src],audio[src],audio source[src],video[data-src],video source[data-src],audio[data-src],audio source[data-src]").each((_, el) => {
    addMedia($(el).attr("src") || $(el).attr("data-src"), "html");
  });
  $("[data-file],[data-hls],[data-video],[data-stream]").each((_, el) => {
    addMedia($(el).attr("data-file") || $(el).attr("data-hls") || $(el).attr("data-video") || $(el).attr("data-stream"), "html-data");
  });
  for (const match of decoded.matchAll(/(?:file|src|source|streaming_url|hls|m3u8|mp4)[ \t]*(?:[:=])[ \t]*["']([^"']+)["']/gi)) {
    addMedia(match[1], "html-script");
  }
  for (const match of decoded.matchAll(/"iframe_url"[ \t]*:[ \t]*"([^"]+)"/g)) {
    try { addPlayer(Buffer.from(match[1], "base64url").toString("utf8")); } catch {}
  }
  return { found, players };
}

function extractSearchoUrls(html, pageUrl) {
  const $ = cheerio.load(String(html || "")), out = new Set();
  const labels = new Map();
  const buttonLabels = $("a.wp-btn-iframe__shortcode").map((_, el) => clean($(el).text())).get();
  $("[data-localize]").each((_, el) => {
    const id = $(el).attr("data-localize");
    const text = clean($(el).text());
    if (id && text) labels.set(id, text);
  });
  const named = [];
  for (const match of String(html || "").matchAll(/var\s+([a-z0-9]+)\s*=\s*\{[\s\S]{0,5000}?"iframe_url"\s*:\s*"([^"]+)"/gi)) {
    try {
      const u = abs(Buffer.from(match[2], "base64url").toString("utf8"), pageUrl);
      if (u && new URL(u).pathname.toLowerCase().startsWith("/searcho/")) named.push({ url: u, label: buttonLabels[named.length] || labels.get(match[1]) || match[1].toUpperCase() });
    } catch {}
  }
  if (named.length) return named;
  $("iframe[src]").each((_, el) => {
    const u = abs($(el).attr("src"), pageUrl);
    try { if (u && new URL(u).pathname.toLowerCase().startsWith("/searcho/")) out.add(u); } catch {}
  });
  for (const match of String(html || "").matchAll(/"iframe_url"\s*:\s*"([^"]+)"/g)) {
    try {
      const u = abs(Buffer.from(match[1], "base64url").toString("utf8"), pageUrl);
      if (u && new URL(u).pathname.toLowerCase().startsWith("/searcho/")) out.add(u);
    } catch {}
  }
  return [...out].map(url => ({ url, label: "PlayerJS" }));
}

function unpackPlayerScript(html) {
  const source = String(html || "");
  const start = source.indexOf("eval(function(p,a,c,k,e,d)");
  if (start < 0) return "";
  const end = source.indexOf("</script>", start);
  if (end < 0) return "";
  let unpacked = "";
  try {
    vm.runInNewContext(source.slice(start, end), { eval: x => { unpacked = String(x); } }, { timeout: 5000 });
  } catch (e) { console.error("player unpack:", e.message); }
  return unpacked;
}

async function resolveSearchoPlayer(searchoUrl) {
  let html;
  let browserMedia = [];
  try {
    html = await get(searchoUrl, `${BASE_URL}/`, PLAYER_TIMEOUT_MS);
  } catch (e) {
    if (!/HTTP 403|HTTP 429|aborted|timeout/i.test(e.message)) throw e;
    // Do not launch Chromium for a blocked player when browser capture is
    // disabled; this keeps the normal HTTP path responsive.
    if (!ENABLE_BROWSER_STREAMS) return null;
    const browserPage = await getFinalInBrowser(searchoUrl, `${BASE_URL}/`, PLAYER_TIMEOUT_MS);
    html = browserPage.html;
    browserMedia = browserPage.media || [];
  }
  const $ = cheerio.load(html);
  const cid = html.match(/cid:\s*'([^']+)'/)?.[1];
  const base = html.match(/base:\s*'([^']+)'/)?.[1];
  const rtype = html.match(/rtype:\s*'([^']+)'/)?.[1];
  const keys = html.match(/keys:\s*\[([^\]]+)\]/)?.[1]?.match(/'([^']+)'/g)?.map(x => x.slice(1, -1));
  const box = cid ? $(`#${cid}`).first() : null;
  if (!cid || !base || !rtype || !box?.length || !keys?.length) return null;
  const token = keys.map(k => box.attr(k) || "").join("");
  if (!token || keys.some(k => !box.attr(k))) return null;
  const realUrl = `${base}?${rtype}r=${[...token].reverse().join("")}`;
  let finalPage;
  try {
    finalPage = await getFinal(realUrl, searchoUrl, PLAYER_TIMEOUT_MS);
  } catch (e) {
    if (!/HTTP 403|HTTP 429|aborted|timeout/i.test(e.message)) throw e;
    if (!ENABLE_BROWSER_STREAMS) return null;
    const browserPage = await getFinalInBrowser(realUrl, searchoUrl, PLAYER_TIMEOUT_MS);
    finalPage = browserPage;
    browserMedia = [...browserMedia, ...(browserPage.media || [])];
  }
  const playerHtml = decodeEmbeddedText(finalPage.html);
  const unpacked = decodeEmbeddedText(unpackPlayerScript(playerHtml));
  const directFile = unpacked.match(/\bfile:\s*["']([^"']+)["']/)?.[1];
  const hlsFiles = [...unpacked.matchAll(/["']hls\d+["']\s*:\s*["']([^"']+)["']/g)].map(x => x[1]);
  const inlineHls = [...playerHtml.matchAll(/https?:[^"'\s<>]+\.(?:m3u8|mp4|m4v|webm|master\.txt)(?:\?[^"'\s<>]*)?/gi)].map(x => x[0]);
  const embedded = collectFallbackStreams(`${unpacked}\n${playerHtml}`, realUrl).found;
  let file = browserMedia.find(isMediaUrl)
    || hlsFiles.find(x => /\.(?:m3u8|master\.txt)(?:[?#]|$)/i.test(x))
    || hlsFiles.find(isMediaUrl)
    || directFile
    || inlineHls.find(x => !/test-videos\.co\.uk/i.test(x))
    || [...embedded.keys()].find(isMediaUrl);
  if (!file) {
    try {
      const parsed = new URL(finalPage.url);
      const filecode = parsed?.pathname.split("/").filter(Boolean).pop();
      if (parsed && filecode && /\/e\//i.test(parsed.pathname)) {
        const api = await fetch(`${parsed.origin}/api/stream`, { method: "POST", headers: { "content-type": "application/json", "user-agent": USER_AGENT, referer: parsed.href }, body: JSON.stringify({ filecode, device: "android" }) });
        if (api.ok) file = (await api.json()).streaming_url;
      }
    } catch (e) { console.error("player API:", e.message); }
  }
  if (!file && finalPage?.url && ENABLE_BROWSER_STREAMS) {
    try {
      const browserPage = await getFinalInBrowser(finalPage.url, searchoUrl, Math.max(PLAYER_TIMEOUT_MS, 25000));
      file = (browserPage.media || []).find(isMediaUrl) || file;
    } catch (e) { console.error("player browser media:", e.message); }
  }
  const poster = unpacked.match(/\bposter:\s*["']([^"']+)["']/)?.[1];
  const resolvedFile = file && abs(file, realUrl);
  if (!resolvedFile || !isMediaUrl(resolvedFile)) return null;
  try { new URL(resolvedFile); } catch { return null; }
  try {
    const host = new URL(resolvedFile).hostname;
    // LuluStream issues short-lived, single-use playlist tokens; do not consume
    // them during probing. Other HLS providers must pass the playlist/segment
    // check so placeholder images are not exposed as playable video streams.
    if (/\.tnmr\.org$/i.test(host)) return { file: resolvedFile, poster: abs(poster, realUrl), playerUrl: realUrl };
    const playlist = await get(resolvedFile, finalPage.url, PLAYER_TIMEOUT_MS);
    if (!/^\s*#EXTM3U/m.test(playlist)) return null;
    const variant = playlist.split(/\r?\n/).find(x => x.trim() && !x.trim().startsWith("#"));
    if (variant) {
      const variantUrl = abs(variant, resolvedFile), variantText = await get(variantUrl, finalPage.url, PLAYER_TIMEOUT_MS);
      const segment = variantText.split(/\r?\n/).find(x => x.trim() && !x.trim().startsWith("#"));
      if (segment) {
        const segmentResponse = await fetch(abs(segment, variantUrl), { headers: { "user-agent": USER_AGENT, referer: finalPage.url } });
        const segmentType = String(segmentResponse.headers.get("content-type") || "").toLowerCase();
        if (!segmentResponse.ok || /^(image\/|text\/|application\/json)/.test(segmentType)) return null;
      }
    }
  } catch { return null; }
  return { file: resolvedFile, poster: abs(poster, realUrl), playerUrl: realUrl };
}

function streamQuality(stream) {
  const value = [stream.quality, stream.resolution, stream.title, stream.source, stream.url].filter(Boolean).join(" ");
  const match = value.match(/(?:^|[^0-9])(2160|1440|1080|720|576|540|480|360|240)\s*p?(?:[^0-9]|$)/i);
  return match ? `${match[1]}p` : "Auto";
}
function isDirectMediaUrl(raw) {
  try {
    const url = new URL(String(raw || ""));
    if (!/^https?:$/i.test(url.protocol)) return false;
    // Never publish a legacy Render/addon endpoint as the media URL. The
    // player must contact the provider CDN directly whenever possible.
    if (/^\/hls(?:\/|$)/i.test(url.pathname)) return false;
    if (/(?:^|\.)onrender\.com$/i.test(url.hostname) || /(?:^|\.)render\.com$/i.test(url.hostname)) return false;
    return isMediaUrl(url.href)
      || /\.(?:m3u8|mp4|m4v|webm|m4s|ts)(?:[?#]|$)/i.test(url.pathname + url.search)
      || /(?:master\.txt|\/manifest\/|\/playlist\/|\/stream\/)/i.test(url.pathname);
  } catch { return false; }
}
function formatStreams(found, players, pageUrl) {
  const direct = [...found.values()].filter(x => x.source && isDirectMediaUrl(x.url)).map(x => {
    const behaviorHints = /\.m3u8(?:[?#]|$)|master\.txt(?:[?#]|$)/i.test(x.url)
      ? { notWebReady: false, bingeGroup: "avmirror" }
      : {};
    const referer = x.referer || pageUrl;
    if (referer) {
      try {
        behaviorHints.proxyHeaders = {
          request: {
            Referer: referer,
            Origin: new URL(referer).origin
          }
        };
      } catch {}
    }
    return {
      name: "AVMirror",
      title: `${x.source} • ${streamQuality(x)}`,
      url: x.url,
      behaviorHints
    };
  }).slice(0, 20);
  // Direct mode never publishes an external player as a stream. Returning an
  // unresolved iframe here makes clients open an ad/redirect page and hides
  // the real source failure; callers can retry the resolver instead.
  return direct;
}
async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function scrapeStreams(id) {
  const pageUrl = idToUrl(id); if (!pageUrl) return [];
  const cached = cg("streams:" + id); if (cached) return cached;
  const httpFound = new Map(), httpPlayers = new Set();

  // The current source page exposes advertising/redirect iframes when its
  // stream buttons are clicked. Parse declared media/iframes first and avoid
  // the slow browser path unless explicitly enabled by the operator.
  try {
    const sourceHtml = await get(pageUrl);
    const fallback = collectFallbackStreams(sourceHtml, pageUrl);
    if (!fallback.found.size) {
      const candidates = extractSearchoUrls(sourceHtml, pageUrl).slice(0, 6);
      const resolvedPlayers = await mapWithConcurrency(candidates, 3, async source => {
        try {
          const player = await resolveSearchoPlayer(source.url);
          return player?.file ? { ...player, label: source.label } : null;
        } catch (e) {
          console.error(`searcho player ${source.label || "unknown"}:`, e.message);
          return null;
        }
      });
      for (const player of resolvedPlayers.filter(Boolean)) {
        fallback.found.set(`${player.file}#${player.label}`, { url: player.file, source: player.label, referer: player.playerUrl || source.url });
      }
    }
    for (const [key, value] of fallback.found) httpFound.set(key, value);
    for (const value of fallback.players) httpPlayers.add(value);
    const httpStreams = formatStreams(fallback.found, fallback.players, pageUrl);
    // If the source already yielded playable HTTP/HLS URLs, avoid the much
    // slower Playwright path. Browser capture remains a fallback for sources
    // that expose only a dynamic player.
    const hasDirectHttpStream = httpStreams.some(stream => stream?.url && isDirectMediaUrl(stream.url));
    if (hasDirectHttpStream || !ENABLE_BROWSER_STREAMS) {
      return hasDirectHttpStream ? cs("streams:" + id, httpStreams) : httpStreams;
    }
  } catch (e) { console.error("stream http:", e.message); }

  let ctx = null;
  let page = null;
    const found = new Map();
    const players = new Set();
    let activeLabel = null;
    const addMedia = (u, source, base = pageUrl) => { u = abs(u, base); if (isMediaUrl(u)) found.set(u, { url: u, source, referer: base }); };
  const addPlayer = (u, base = pageUrl) => { u = abs(u, base); if (isUsefulPlayerUrl(u)) players.add(u); };

  const attachFrameListeners = frame => {
    try { addPlayer(frame.url()); } catch {}
  };

  try {
    ctx = await newContext();
    page = await ctx.newPage();
    await page.route("**/*", async route => {
      const requestUrl = route.request().url();
      try {
        const parsed = new URL(requestUrl);
        if (AD_HOSTS.test(parsed.hostname) || AD_URL_PARTS.test(parsed.pathname + parsed.search)) return route.abort();
      } catch {}
      return route.continue();
    });
    page.on("request", r => {
      const frame = r.frame();
      const frameUrl = frame ? frame.url() : pageUrl;
      if (!frameUrl || !isUsefulPlayerUrl(frameUrl)) return;
      if (isMediaUrl(r.url())) addMedia(r.url(), activeLabel || "player-request", frameUrl);
    });
    page.on("response", r => {
      try {
        const frameUrl = r.frame()?.url() || pageUrl;
        if (!isUsefulPlayerUrl(frameUrl)) return;
        const type = String(r.headers()["content-type"] || "").toLowerCase();
        if (type.includes("video/") || type.includes("mpegurl") || isMediaUrl(r.url())) {
          addMedia(r.url(), activeLabel || "player-response", frameUrl);
        }
        if (type.includes("json") || type.includes("javascript") || type.includes("text/")) r.text().then(text => {
          for (const candidate of String(text).match(/https?:[^"'<> \t\r\n]+/g) || []) if (isMediaUrl(candidate)) addMedia(candidate, activeLabel || "player-response", frameUrl);
        }).catch(() => {});
      } catch {}
    });
    page.on("frameattached", attachFrameListeners);
    page.on("framenavigated", attachFrameListeners);
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: REQUEST_TIMEOUT_MS });
    await page.waitForTimeout(500);

    // Reproduce the site's real interaction: click each STREAM button, wait for
    // its iframe, click the player overlay/play control, then observe media.
    const buttons = page.locator("a.wp-btn-iframe__shortcode");
    const buttonCount = await buttons.count();
    for (let i = 0; i < Math.min(buttonCount, 3); i++) {
      activeLabel = clean(await buttons.nth(i).innerText().catch(() => "")) || `STREAM ${i + 1}`;
      await buttons.nth(i).click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
      await activatePlayerFrames(page, 1);
      activeLabel = null;
      if (found.size) break;
    }
    for (const f of page.frames()) attachFrameListeners(f);
    for (const f of page.frames()) {
      const frameUrl = f.url();
      if (!isUsefulPlayerUrl(frameUrl)) continue;
      const mediaEls = await f.locator("video,video source,audio,audio source").evaluateAll(ns => ns.map(n => n.currentSrc || n.src || n.getAttribute("src")).filter(Boolean)).catch(() => []);
      mediaEls.forEach(u => addMedia(u, "player-dom", frameUrl));
    }
    for (const [key, value] of httpFound) found.set(key, value);
    for (const value of httpPlayers) players.add(value);

  } catch (e) {
    console.error("stream browser:", e.message);
  } finally {
    if (ctx) await ctx.close().catch(e => console.error("stream browser close:", e.message));
  }

  // Prefer URLs captured by the browser, but keep the addon usable when the
  // production browser is temporarily unavailable or blocked by the source.
  if (found.size || players.size) {
    const streams = formatStreams(found, players, pageUrl);
    return streams.length ? cs("streams:" + id, streams) : streams;
  }

  try {
    const fallback = httpFound.size || httpPlayers.size ? { found: httpFound, players: httpPlayers } : collectFallbackStreams(await get(pageUrl), pageUrl);
    const streams = formatStreams(fallback.found, fallback.players, pageUrl);
    return streams.length ? cs("streams:" + id, streams) : streams;
  } catch (e) {
    console.error("stream http:", e.message);
    return cs("streams:" + id, formatStreams(found, players, pageUrl));
  }
}

module.exports = {
  scrapeCatalog,
  scrapeMeta,
  scrapeStreams,
  closeBrowser,
  makeId,
  idToUrl,
  isItemUrl,
  isUsefulPlayerUrl,
  isDirectMediaUrl,
  formatStreams,
  collectCatalogFromHtml,
  collectFallbackStreams,
  extractSearchoUrls,
  unpackPlayerScript,
  resolveSearchoPlayer
};
