const cheerio = require("cheerio");
const { UA, maskError, stripTags, decodeHtmlEntities } = require("../lib/scraper-utils");
const { resolveDirectMediaUrl, directBehaviorHints } = require("../lib/direct-stream");

const BASE = "https://javmenu.com";

function makeId(code) { return `javmenu:${code}`; }
function extractCode(id) { return String(id || "").replace(/^javmenu:/, "").toUpperCase(); }

async function fetchHtml(url, referer) {
  const headers = { "User-Agent": UA, accept: "text/html,*/*" };
  if (referer) headers.referer = referer;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 12000);
  try {
    const r = await fetch(url, { headers, redirect: "follow", signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

function parseCatalogItems(html) {
  const $ = cheerio.load(html);
  const items = [];
  $("div.video-list-item").each((_, el) => {
    const $el = $(el);
    const link = $el.find("a[href*='/en/']").first().attr("href") || "";
    const m = link.match(/\/en\/([A-Z][A-Z0-9]+-\d+)/i);
    if (!m) return;
    const code = m[1].toUpperCase();
    if (items.some(i => i.code === code)) return;
    const title = decodeHtmlEntities(stripTags($el.find("h5.card-title").first().text() || $el.find("p.card-text").first().text() || ""));
    let poster = "";
    $el.find("img").each((_, img) => {
      const ds = $(img).attr("data-src") || "";
      if (ds && !ds.includes("button_logo") && !ds.includes("loading.gif") && !ds.includes("no_preview")) {
        if (!poster) poster = ds;
      }
    });
    items.push({ id: makeId(code), type: "movie", name: title || code, poster: poster || undefined, code });
  });
  if (!items.length) {
    $("a[href*='/en/']").each((_, el) => {
      const href = $(el).attr("href") || "";
      const match = href.match(/\/en\/([A-Z][A-Z0-9]+-\d+)/i);
      if (!match) return;
      const code = match[1].toUpperCase();
      if (items.some(i => i.code === code)) return;
      const card = $(el).closest(".card, .video-list-item");
      const title = decodeHtmlEntities(stripTags(card.find("p.card-text, h5.card-title").first().text() || code));
      const poster = card.find("img").first().attr("data-src") || card.find("img").first().attr("src") || "";
      items.push({ id: makeId(code), type: "movie", name: title || code, poster: poster || undefined, code });
    });
  }
  return items;
}

async function scrapeCatalog({ page = 1, search = "", genre = "", mode = "javmenu" } = {}) {
  try {
    let url;
    if (search) {
      url = `${BASE}/en/search?wd=${encodeURIComponent(search)}`;
    } else if (genre) {
      url = `${BASE}/en/censored/genre/${encodeURIComponent(genre)}?page=${page}`;
    } else if (page <= 1) {
      url = `${BASE}/en/censored/online`;
    } else {
      return [];
    }
    const html = await fetchHtml(url, `${BASE}/en`);
    return parseCatalogItems(html);
  } catch (e) {
    console.error("catalog fetch error:", maskError(e.message));
    return [];
  }
}

async function scrapeMeta(id) {
  const code = extractCode(id);
  if (!code) return null;
  try {
    const url = `${BASE}/en/${code}`;
    const html = await fetchHtml(url, `${BASE}/en`);
    const $ = cheerio.load(html);

    const h1 = decodeHtmlEntities(stripTags($("h1 strong").first().text() || ""));
    const name = h1.replace(/^[\w]+-\d+\s*/i, "").trim() || code;
    const poster = $("video").first().attr("poster") || $("meta[property='og:image']").attr("content") || "";
    const description = decodeHtmlEntities(stripTags($("meta[name='description']").attr("content") || ""));
    const duration = decodeHtmlEntities(stripTags($("span:contains('Duration')").next("span").text() || ""));
    const published = decodeHtmlEntities(stripTags($("span:contains('Published At')").next("span").text() || ""));

    const genres = [];
    $("a.genre").each((_, el) => {
      const g = decodeHtmlEntities(stripTags($(el).text()));
      if (g && !genres.includes(g)) genres.push(g);
    });

    const actors = [];
    $("a[href*='/actor/']").each((_, el) => {
      const a = decodeHtmlEntities(stripTags($(el).text()));
      if (a && !actors.includes(a)) actors.push(a);
    });

    const series = decodeHtmlEntities(stripTags($(".series a span").text() || ""));

    return {
      id, type: "movie", name: h1 || code,
      poster: poster || undefined,
      description: description || undefined,
      genre: genres.slice(0, 30),
      cast: actors.slice(0, 30),
      releaseInfo: published || undefined,
      runtime: duration ? parseInt(duration) || undefined : undefined,
      series: series || undefined,
    };
  } catch (e) {
    console.error("meta fetch error:", maskError(e.message));
    return null;
  }
}

async function scrapeStreams(id) {
  const code = extractCode(id);
  if (!code) return [];
  try {
    const url = `${BASE}/en/${code}`;
    const html = await fetchHtml(url, `${BASE}/en`);
    const $ = cheerio.load(html);

    const streams = [];
    $("[data-m3u8]").each((_, el) => {
      const m3u8 = $(el).attr("data-m3u8");
      if (m3u8 && m3u8.includes(".m3u8") && !streams.includes(m3u8)) streams.push(m3u8);
    });

    if (!streams.length) {
      const re = /data-m3u8=["']([^"']+\.m3u8[^"']*)/gi;
      let m;
      while ((m = re.exec(html)) !== null) {
        if (!streams.includes(m[1])) streams.push(m[1]);
      }
    }

    if (!streams.length) {
      const contentUrl = html.match(/"contentUrl"\s*:\s*"([^"]+\.m3u8[^"]*)"/i);
      if (contentUrl) streams.push(contentUrl[1]);
    }

    if (!streams.length) {
      const hlsRe = /(?:https?:)?\/\/[^\s"']+\.m3u8[^\s"']*/gi;
      let m;
      while ((m = hlsRe.exec(html)) !== null) {
        const u = m[0];
        if (!u.includes("cloudflare") && !u.includes("google") && !streams.includes(u)) streams.push(u);
      }
    }

    return streams.map((rawUrl) => {
      const mediaUrl = resolveDirectMediaUrl(rawUrl, url);
      if (!mediaUrl) return null;
      return {
        name: "\u{1F352} Cherry", title: "\u{1F352} Cherry \u2022 Auto",
        url: mediaUrl,
        behaviorHints: directBehaviorHints(url, "javmenu"),
      };
    }).filter(Boolean);
  } catch (e) {
    console.error("streams fetch error:", maskError(e.message));
    return [];
  }
}

module.exports = { scrapeCatalog, scrapeMeta, scrapeStreams };
