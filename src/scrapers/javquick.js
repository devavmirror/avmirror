const BASE = "https://javquick.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

function safeDecodeBase64Url(s) { try { return Buffer.from(String(s || ""), "base64url").toString("utf8"); } catch { return ""; } }
function safeEncodeBase64Url(s) { return Buffer.from(String(s), "utf8").toString("base64url"); }
function stripTags(h) { return String(h || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }
function decodeHtmlEntities(s) { return String(s || "").replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c)).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#039;/g, "'"); }
function urlToId(url) { return "javquick:" + safeEncodeBase64Url(String(url || "")); }
function idToUrl(id) { const raw = String(id || "").slice(9); const url = safeDecodeBase64Url(raw); return url && url.startsWith("http") ? url : ""; }

async function fetchHtml(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}

function parseCatalogItems(html) {
  const items = [];
  const seen = new Set();
  const articleRe = /<article[\s\S]*?<\/article>/gi;
  let article;
  while ((article = articleRe.exec(html)) !== null) {
    const block = article[0];
    const hrefMatch = block.match(/href="(\/movie\/[A-Za-z0-9]+\/[^"]+)"/);
    const imgMatch = block.match(/data-srcset="([^"]+)"/);
    const titleMatch = block.match(/title="([^"]+)"/);
    if (!hrefMatch || !titleMatch) continue;
    const fullHref = hrefMatch[1];
    const id = fullHref.split("/")[2];
    if (seen.has(id)) continue;
    seen.add(id);
    const poster = imgMatch ? imgMatch[1].trim() : "";
    const name = decodeHtmlEntities(stripTags(titleMatch[1]));
    items.push({
      id: urlToId(`${BASE}${fullHref}`),
      type: "movie",
      name,
      poster: poster || `${BASE}/favicon.ico`
    });
  }
  return items;
}

async function scrapeJavquickCatalog({ page = 1, search = "", genre = "" } = {}) {
  try {
    let url;
    if (search) {
      url = `${BASE}/search?q=${encodeURIComponent(search)}&page=${page}`;
    } else if (genre) {
      url = `${BASE}/search?q=${encodeURIComponent(genre)}&page=${page}`;
    } else {
      url = `${BASE}/release?page=${page}`;
    }
    const html = await fetchHtml(url);
    return parseCatalogItems(html);
  } catch (e) {
    console.error("javquick catalog error:", e.message || e);
    return [];
  }
}

async function scrapeJavquickMeta(id) {
  try {
    const url = idToUrl(id);
    if (!url) return null;
    const html = await fetchHtml(url);

    let name = "";
    const titleMatch = html.match(/<title[^>]*>\s*([^<|]+)/i);
    if (titleMatch) name = decodeHtmlEntities(stripTags(titleMatch[1])).trim();

    let poster = "";
    const imgMatch = html.match(/<img[^>]*data-srcset="([^"]+)"/i);
    if (imgMatch) poster = imgMatch[1].trim();

    let description = "";
    const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
    if (descMatch) description = decodeHtmlEntities(stripTags(descMatch[1])).trim();

    const genres = [];
    const genreRe = /href="\/genres\/[^"]*"[^>]*>([^<]+)<\/a>/gi;
    let gm;
    while ((gm = genreRe.exec(html)) !== null) {
      const g = decodeHtmlEntities(stripTags(gm[1])).trim();
      if (g && !genres.includes(g)) genres.push(g);
    }

    const actors = [];
    const actorRe = /href="\/stars\/[^"]*"[^>]*>([^<]+)<\/a>/gi;
    let am;
    while ((am = actorRe.exec(html)) !== null) {
      const a = decodeHtmlEntities(stripTags(am[1])).trim();
      if (a && !actors.includes(a)) actors.push(a);
    }

    return {
      id,
      type: "movie",
      name: name || "Unknown",
      poster: poster || `${BASE}/favicon.ico`,
      description,
      genre: genres,
      links: actors.map(a => ({ title: a, category: "actor", url: "" }))
    };
  } catch (e) {
    console.error("javquick meta error:", e.message || e);
    return null;
  }
}

async function scrapeJavquickStreams(id) {
  try {
    const url = idToUrl(id);
    if (!url) return [];
    const html = await fetchHtml(url);

    const dataIdMatch = html.match(/data-id="([^"]+)"/);
    if (!dataIdMatch) return [];

    const tokenId = dataIdMatch[1];
    const watchUrl = `${BASE}/watch?token=${encodeURIComponent(tokenId)}`;
    const r = await fetch(watchUrl, {
      headers: { "User-Agent": UA, "Referer": url },
      redirect: "follow"
    });
    if (!r.ok) return [];

    const body = (await r.text()).trim();
    if (!body) return [];

    if (body.startsWith("http://") || body.startsWith("https://")) {
      return [{ url: body, name: "JavQuick MP4", behaviorHints: { notWebReady: false } }];
    }

    let decoded;
    try { decoded = atob(body); } catch { decoded = body; }
    if (decoded.includes("|")) {
      const urls = decoded.split("|").map(p => p.trim()).filter(p => p.startsWith("http://") || p.startsWith("https://"));
      if (urls.length > 0) return urls.map(u => ({ url: u, name: "JavQuick MP4", behaviorHints: { notWebReady: false } }));
    }

    const pipeUrls = body.split("|").map(p => p.trim()).filter(p => p.startsWith("http://") || p.startsWith("https://"));
    if (pipeUrls.length > 0) return pipeUrls.map(u => ({ url: u, name: "JavQuick MP4", behaviorHints: { notWebReady: false } }));

    return [];
  } catch (e) {
    console.error("javquick streams error:", e.message || e);
    return [];
  }
}

module.exports = {
  scrapeJavquickCatalog,
  scrapeJavquickMeta,
  scrapeJavquickStreams
};
