const cheerio = require("cheerio");
const { UA, makeCache } = require("../lib/scraper-utils");

const BASE_URL = "https://www.subtitlecat.com";
const cache = makeCache(500, 15 * 60 * 1000);
const SUPPORTED_LANGUAGES = new Set(["en", "es", "pt", "pt-br", "fr", "de", "it", "ja", "ko", "zh", "ru", "nl", "pl", "tr"]);

function normalizeCode(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function normalizeLang(value) {
  const lang = String(value || "").toLowerCase().replace(/_/g, "-");
  return SUPPORTED_LANGUAGES.has(lang) ? lang : null;
}

async function getText(url) {
  const cached = cache.get(url);
  if (cached) return cached;
  const response = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml", "accept-language": "en-US,en;q=0.9" },
    redirect: "follow",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`SubtitleCat HTTP ${response.status}`);
  const html = await response.text();
  cache.set(url, html);
  return html;
}

function parseSearchResults(html, code) {
  const wanted = normalizeCode(code);
  const $ = cheerio.load(html);
  const found = new Set();
  $("a[href*='/subs/'], a[href^='subs/']").each((_, el) => {
    const href = $(el).attr("href") || "";
    const text = $(el).text();
    if (!normalizeCode(`${href} ${text}`).includes(wanted)) return;
    found.add(new URL(href, BASE_URL).href.split("#")[0]);
  });
  return [...found].slice(0, 12);
}

function parseDownloads(html) {
  const $ = cheerio.load(html);
  const refs = [];
  const seen = new Set();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const id = $(el).attr("id") || "";
    const match = id.match(/^download[_-]([a-z-]+)$/i) || href.match(/[-_.]([a-z]{2}(?:-[a-z]{2})?)(?:\.srt)(?:$|\?)/i);
    const lang = normalizeLang(match?.[1]);
    if (!lang || !/\.srt(?:$|\?)/i.test(href)) return;
    const url = new URL(href, BASE_URL).href.split("#")[0];
    if (!seen.has(lang) && /^https:\/\/(?:www\.)?subtitlecat\.com\//i.test(url)) {
      seen.add(lang);
      refs.push({ source: "subtitlecat", lang, url });
    }
  });
  return refs;
}

async function findSubtitleCat(code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!/^[A-Z0-9]+-\d{2,6}$/.test(normalized)) return [];
  const searchHtml = await getText(`${BASE_URL}/index.php?search=${encodeURIComponent(normalized)}`);
  const pages = parseSearchResults(searchHtml, normalized);
  const results = await Promise.all(pages.map(async page => {
    try { return parseDownloads(await getText(page)); } catch { return []; }
  }));
  const refs = [];
  for (const ref of results.flat()) {
    if (!refs.some(existing => existing.lang === ref.lang)) refs.push(ref);
  }
  return refs;
}

module.exports = { findSubtitleCat, parseSearchResults, parseDownloads, normalizeLang };
