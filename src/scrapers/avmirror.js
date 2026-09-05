const cheerio = require("cheerio");
const vm = require("node:vm");

const BASE_URL = (process.env.BASE_URL || "https://jav.guru").replace(/\/+$/, "");
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 900000);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 12000);
const PLAYER_TIMEOUT_MS = Number(process.env.PLAYER_TIMEOUT_MS || 25000);
const CACHE_MAX_ENTRIES = Number(process.env.CACHE_MAX_ENTRIES || 500);
const USER_AGENT = process.env.USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
const BLOCKED_HOSTS = /(^|\.)(?:mayzaent\.com|ruddy-pass\.com|godkc\.com|growcdnssedge\.com)$/i;
const AD_HOSTS = /(^|\.)(?:doubleclick\.net|googlesyndication\.com|googleadservices\.com|adservice\.google\.com|popads\.net|popcash\.net|propellerads\.com|exoclick\.com|trafficjunky\.net|onclick\.com|adsterra\.com|juicyads\.com|hilltopads\.net|admaven\.com)$/i;
const AD_URL_PARTS = /(?:\/ads?(?:[/?#]|$)|\/banner(?:s)?(?:[/?#]|$)|\/pop(?:under|up)?(?:[/?#]|$)|\/prebid(?:[/?#]|$)|\b(?:adserver|advert|advertisement|doubleclick|googlesyndication|tracking|tracker)\b)/i;

const cache = new Map();
const pending = new Map();
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
  for (let attempt = 0; attempt < 2; attempt++) {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ac.signal, headers: { "user-agent": USER_AGENT, referer, "accept": "text/html,application/xhtml+xml" } });
      clearTimeout(t);
      if (!r.ok) throw Error(`HTTP ${r.status}`);
      return { html: await r.text(), url: r.url };
    } catch (e) {
      clearTimeout(t);
      if (attempt < 1) await new Promise(r => setTimeout(r, 1500));
      else throw e;
    }
  }
}

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
  let bestTitle = "";
  for (const a of links) {
    const h = abs($(a).attr("href"));
    if (!isItemUrl(h)) continue;
    const t = clean($(a).text());
    if (!t || t.length < 5) continue;
    if (/^(?:Decensored|Sub|Censored|HD|_uncensored|leaked)$/i.test(t)) continue;
    if (t.length > bestTitle.length) { bestTitle = t; link = a; }
  }
  if (!link) return null;
  const href = abs($(link).attr("href"));
  const title = bestTitle || clean($(el).find("h1,h2,h3,h4,.entry-title,.post-title,.title").first().text());
  if (!href || !title || title.length < 5) return null;
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
  let result = [];
  try {
    result = collectCatalogFromHtml(await get(url));
  } catch (e) { console.error("catalog http:", e.message); }
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
  try { const parsed = new URL(u); if (BLOCKED_HOSTS.test(parsed.hostname) || AD_HOSTS.test(parsed.hostname) || AD_URL_PARTS.test(parsed.pathname + parsed.search)) return false; } catch { return false; }
  return /\.(m3u8|mp4|m4v|webm|mov|ts)(?:[?#].*)?$/i.test(u) || /(?:m3u8|mp4|manifest|playlist|videoplayback|master\.m3u|hls)/i.test(u);
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

function collectFallbackStreams(html, pageUrl) {
  const found = new Map();
  const players = new Set();
  const addMedia = (u, source) => {
    u = abs(u, pageUrl);
    if (isMediaUrl(u)) found.set(u, { url: u, source });
  };
  const addPlayer = u => {
    u = abs(u, pageUrl);
    if (isUsefulPlayerUrl(u)) players.add(u);
  };
  const decoded = String(html || "")
    .replace(/\\\//g, "/")
    .replace(/\\u0026/g, "&")
    .replace(/\\u003d/g, "=");
  for (const u of decoded.match(/https?:[^"'<>\s]+/g) || []) addMedia(u, "html");
  const $ = cheerio.load(decoded);
  $("iframe[src],embed[src],video[src],video source[src],audio[src],audio source[src]").each((_, el) => {
    const u = $(el).attr("src");
    if (/^(iframe|embed)$/i.test(el.tagName)) addPlayer(u, pageUrl);
    else addMedia(u, "html", pageUrl);
  });
  for (const match of decoded.matchAll(/"iframe_url"\s*:\s*"([^"]+)"/g)) {
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
  try {
    html = await get(searchoUrl, `${BASE_URL}/`, PLAYER_TIMEOUT_MS);
  } catch (e) {
    if (!/HTTP 403|HTTP 429|aborted|timeout/i.test(e.message)) throw e;
    return null;
  }
  const $ = cheerio.load(html);
  const cid = html.match(/cid:\s*'([^']+)'/)?.[1];
  const base = html.match(/base:\s*'([^']+)'/)?.[1];
  const rtype = html.match(/rtype:\s*'([^']+)'/)?.[1];
  const keys = html.match(/keys:\s*\[([^\]]+)\]/)?.[1]?.match(/'([^']+)'/g)?.map(x => x.slice(1, -1));
  const box = cid ? $(`#${cid}`).first() : null;
  if (!cid || !base || !rtype || !box?.length || !keys?.length) {
    const directInline = [...html.matchAll(/https?:[^"'\\s<>]+\.m3u8(?:\?[^"'\\s<>]*)?/gi)].map(x => x[0]);
    const eMatch = html.match(/(?:MIRROR|embed_src)\s*=\s*['"]?(https?:\/\/[^'"\s<>]+\/e\/[^'"\s<>]+)/i)?.[1];
    const directFile = directInline.find(x => !/test-videos\.co\.uk/i.test(x));
    if (directFile) return { file: directFile, playerUrl: searchoUrl };
    if (eMatch) {
      try {
        const parsed = new URL(eMatch);
        const filecode = parsed.pathname.split("/").filter(Boolean).pop();
        const api = await fetch(`${parsed.origin}/api/stream`, { method: "POST", headers: { "content-type": "application/json", "user-agent": USER_AGENT, "accept": "application/json", referer: eMatch }, body: JSON.stringify({ filecode, device: "android" }), signal: AbortSignal.timeout(PLAYER_TIMEOUT_MS) });
        if (api.ok) { const url = (await api.json()).streaming_url; if (url) return { file: url, playerUrl: eMatch }; }
      } catch {}
    }
    return null;
  }
  const token = keys.map(k => box.attr(k) || "").join("");
  if (!token || keys.some(k => !box.attr(k))) return null;
  const realUrl = `${base}?${rtype}r=${[...token].reverse().join("")}`;
  let finalPage;
  try {
    finalPage = await getFinal(realUrl, searchoUrl, PLAYER_TIMEOUT_MS);
  } catch (e) {
    if (!/HTTP 403|HTTP 429|aborted|timeout/i.test(e.message)) throw e;
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), PLAYER_TIMEOUT_MS);
      const r = await fetch(realUrl, { signal: ac.signal, headers: { "user-agent": USER_AGENT, referer: searchoUrl, "accept": "text/html,application/xhtml+xml" } });
      clearTimeout(t);
      if (r.ok) {
        const realHtml = await r.text();
        const realInline = [...realHtml.matchAll(/https?:[^"'\\s<>]+\.m3u8(?:\?[^"'\\s<>]*)?/gi)].map(x => x[0]);
        const realFile = realInline.find(x => !/test-videos\.co\.uk/i.test(x));
        if (realFile) return { file: realFile, playerUrl: realUrl };
        const eUrl = realHtml.match(/(?:MIRROR|embed_src)\s*=\s*['"]?(https?:\/\/[^'"\s<>]+\/e\/[^'"\s<>]+)/i)?.[1];
        if (eUrl) {
          try {
            const parsed = new URL(eUrl);
            const filecode = parsed.pathname.split("/").filter(Boolean).pop();
            const api = await fetch(`${parsed.origin}/api/stream`, { method: "POST", headers: { "content-type": "application/json", "user-agent": USER_AGENT, "accept": "application/json", referer: eUrl }, body: JSON.stringify({ filecode, device: "android" }), signal: AbortSignal.timeout(PLAYER_TIMEOUT_MS) });
            if (api.ok) { const url = (await api.json()).streaming_url; if (url) return { file: url, playerUrl: eUrl }; }
          } catch {}
        }
      }
    } catch {}
    return null;
  }
  const playerHtml = finalPage.html;
  const unpacked = unpackPlayerScript(playerHtml);
  const directFile = unpacked.match(/\bfile:\s*["']([^"']+)["']/)?.[1];
  const hlsFiles = [...unpacked.matchAll(/["']hls\d+["']\s*:\s*["']([^"']+)["']/g)].map(x => x[1]);
  const inlineHls = [...playerHtml.matchAll(/https?:[^"'\\s<>]+\.m3u8(?:\?[^"'\\s<>]*)?/gi)].map(x => x[0]);
  let file = hlsFiles.find(x => /\.m3u8(?:[?#]|$)/i.test(x)) || hlsFiles.find(isMediaUrl) || directFile || inlineHls.find(x => !/test-videos\.co\.uk/i.test(x));
  if (!file) {
    try {
      const parsed = new URL(finalPage.url);
      const filecode = parsed?.pathname.split("/").filter(Boolean).pop();
      if (parsed && filecode && /\/e\//i.test(parsed.pathname)) {
        const api = await fetch(`${parsed.origin}/api/stream`, { method: "POST", headers: { "content-type": "application/json", "user-agent": USER_AGENT, "accept": "application/json", referer: parsed.href }, body: JSON.stringify({ filecode, device: "android" }), signal: AbortSignal.timeout(PLAYER_TIMEOUT_MS) });
        if (api.ok) file = (await api.json()).streaming_url;
      }
    } catch (e) { console.error("player API:", e.message); }
  }
  const poster = unpacked.match(/\bposter:\s*["']([^"']+)["']/)?.[1];
  const resolvedFile = file && abs(file, realUrl);
  if (!resolvedFile || !isMediaUrl(resolvedFile)) return null;
  try { new URL(resolvedFile); } catch { return null; }
  try {
    const host = new URL(resolvedFile).hostname;
    if (/\.tnmr\.org$/i.test(host)) return { file: resolvedFile, poster: abs(poster, realUrl), playerUrl: realUrl };
    const playlist = await get(resolvedFile, finalPage.url, PLAYER_TIMEOUT_MS);
    if (!/^\s*#EXTM3U/m.test(playlist)) return null;
    const variant = playlist.split(/\r?\n/).find(x => x.trim() && !x.trim().startsWith("#"));
    if (variant) {
      const variantUrl = abs(variant, resolvedFile), variantText = await get(variantUrl, finalPage.url, PLAYER_TIMEOUT_MS);
      const segment = variantText.split(/\r?\n/).find(x => x.trim() && !x.trim().startsWith("#"));
      if (segment) {
        const ac2 = new AbortController(), t2 = setTimeout(() => ac2.abort(), PLAYER_TIMEOUT_MS);
        const segmentResponse = await fetch(abs(segment, variantUrl), { headers: { "user-agent": USER_AGENT, referer: finalPage.url }, signal: ac2.signal }); clearTimeout(t2);
        if (!segmentResponse.ok) return null;
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
function formatStreams(found, players, pageUrl) {
  const direct = [...found.values()].filter(x => x.source && !/^player-(?:response|dom)$/i.test(x.source)).map(x => ({
    name: "🌐 Nova",
    title: `🌐 Nova • Auto`,
    url: x.url,
    behaviorHints: /\.m3u8(?:[?#]|$)/i.test(x.url) ? { notWebReady: false, bingeGroup: "avmirror" } : {}
  })).slice(0, 20);
  if (direct.length || !players?.size) return direct;
  return [...players].slice(0, 4).map((url, index) => ({
    name: "🌐 Nova",
    title: `🌐 Nova • Player externo${index ? ` ${index + 1}` : ""}`,
    externalUrl: url,
    behaviorHints: { notWebReady: true }
  }));
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

  try {
    const sourceHtml = await get(pageUrl);
    const fallback = collectFallbackStreams(sourceHtml, pageUrl);
    if (!fallback.found.size) {
      const SKIP_LABELS = /^(?:VO|VI|DD)$/i;
      const candidates = extractSearchoUrls(sourceHtml, pageUrl).filter(s => !SKIP_LABELS.test(s.label?.replace(/^stream\s*/i, ""))).slice(0, 6);
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
        fallback.found.set(`${player.file}#${player.label}`, { url: player.file, source: player.label });
      }
    }
    const streams = formatStreams(fallback.found, fallback.players, pageUrl);
    if (streams.length) return cs("streams:" + id, streams);
  } catch (e) { console.error("stream http:", e.message); }

  try {
    const fallback = collectFallbackStreams(await get(pageUrl), pageUrl);
    const streams = formatStreams(fallback.found, fallback.players, pageUrl);
    return cs("streams:" + id, streams);
  } catch (e) {
    console.error("stream http fallback:", e.message);
    return [];
  }
}

module.exports = {
  scrapeCatalog,
  scrapeMeta,
  scrapeStreams,
  makeId,
  idToUrl,
  isItemUrl,
  isUsefulPlayerUrl,
  collectCatalogFromHtml,
  collectFallbackStreams,
  resolveSearchoPlayer
};
