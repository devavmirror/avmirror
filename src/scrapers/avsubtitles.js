const cheerio = require("cheerio");
const { UA, makeCache } = require("../lib/scraper-utils");

const BASE_URL = "https://www.avsubtitles.com";
const cache = makeCache(500, 15 * 60 * 1000);
const SUPPORTED_LANGUAGES = new Set(["en", "es", "pt", "pt-br", "fr", "de", "it", "ja", "ko", "zh", "ru", "nl", "pl", "tr"]);

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeCode(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function normalizeLang(value) {
  const lang = String(value || "").toLowerCase().replace(/_/g, "-");
  return SUPPORTED_LANGUAGES.has(lang) ? lang : null;
}

async function getText(url, options = {}) {
  const cached = cache.get(url);
  if (cached) return cached;
  const response = await fetch(url, {
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml",
      "accept-language": "en-US,en;q=0.9",
      ...(options.referer ? { referer: options.referer } : {}),
    },
    redirect: "follow",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`AVSubtitles HTTP ${response.status}`);
  const html = await response.text();
  cache.set(url, html);
  return html;
}

function parseMovieResults(html, code) {
  const wanted = normalizeCode(code);
  const $ = cheerio.load(html);
  const found = new Map();
  $("a[href^=\"/movie\"]").each((_, el) => {
    const href = $(el).attr("href");
    const text = clean($(el).text());
    const haystack = normalizeCode(`${href} ${text}`);
    if (!href || !haystack.includes(wanted)) return;
    const absolute = new URL(href, BASE_URL).href.split("#")[0];
    found.set(absolute, text);
  });
  return [...found.keys()].slice(0, 8);
}

function parseSubtitleLinks(html, lang) {
  const $ = cheerio.load(html);
  const wanted = lang ? normalizeLang(lang) : null;
  const found = [];
  const seen = new Set();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const match = href.match(/\/subtitles\/([a-z-]+)\/(\d+)/i);
    if (!match) return;
    const currentLang = normalizeLang(match[1]);
    if (!currentLang || (wanted && currentLang !== wanted)) return;
    const absolute = new URL(href, BASE_URL).href.split("#")[0];
    if (!seen.has(absolute)) {
      seen.add(absolute);
      found.push({ lang: currentLang, subid: match[2], url: absolute });
    }
  });
  return found;
}

function parseRevision(html, ref) {
  const $ = cheerio.load(html);
  const form = $("form[action*=\"download_page.php\"]").first();
  const subid = form.find("input[name=\"subid\"]").attr("value") || ref.subid;
  const revid = form.find("input[name=\"revid\"]").attr("value");
  if (!/^\d+$/.test(subid) || !/^\d+$/.test(String(revid || ""))) return null;
  return { source: "avsubtitles", subid, revid, lang: ref.lang };
}

async function findSubtitles(code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!/^[A-Z0-9]+-\d{2,6}$/.test(normalized)) return [];
  const searchUrl = `${BASE_URL}/search_results.php?search=${encodeURIComponent(normalized)}`;
  const searchHtml = await getText(searchUrl);
  const movieUrls = parseMovieResults(searchHtml, normalized);
  if (!movieUrls.length) return [];

  const candidates = await Promise.all(movieUrls.map(async movieUrl => {
    try {
      const movieHtml = await getText(movieUrl);
      return parseSubtitleLinks(movieHtml).map(link => ({ movieUrl, link }));
    } catch (error) {
      console.error(`avsubtitles ${normalized}:`, error.message);
      return [];
    }
  }));
  const revisions = await Promise.all(candidates.flat().map(async candidate => {
    try {
      const detailHtml = await getText(candidate.link.url, { referer: candidate.movieUrl });
      return parseRevision(detailHtml, candidate.link);
    } catch (error) {
      console.error(`avsubtitles ${normalized}/${candidate.link.lang}:`, error.message);
      return null;
    }
  }));
  const refs = [];
  for (const revision of revisions) {
    if (revision && !refs.some(ref => ref.lang === revision.lang)) refs.push(revision);
  }
  return refs;
}

module.exports = { findSubtitles, parseMovieResults, parseSubtitleLinks, parseRevision, normalizeLang };
