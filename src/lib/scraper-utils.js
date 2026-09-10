const { UA, maskError } = require("./ua");

function stripTags(h) { return String(h || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }

function decodeHtmlEntities(s) {
  return String(s || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, c) => String.fromCharCode(parseInt(c, 16)))
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'");
}

function cleanText(h) { return decodeHtmlEntities(stripTags(h)); }

function parseCodeOf(value) {
  const m = String(value || "").match(/\b([A-Z][A-Z0-9]*?)-?(\d{2,6})\b/i);
  return m ? `${m[1].toUpperCase()}-${m[2]}` : null;
}

function parseMagnetTrackers(magnet) {
  return [...magnet.matchAll(/tr=([^&]+)/gi)].map(m => `tracker:${decodeURIComponent(m[1])}`);
}

function parseInfoHash(magnet) {
  return (magnet.match(/btih:([a-fA-F0-9]{40})/i) || [])[1]?.toLowerCase() || null;
}

function parseSizeBytes(text) {
  const m = String(text).match(/([\d.]+)\s*(GiB|MiB|KiB|GB|MB|KB|TB)/i);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  if (unit.startsWith("t")) return Math.round(n * 1024 * 1024 * 1024 * 1024);
  if (unit.startsWith("g")) return Math.round(n * 1024 * 1024 * 1024);
  if (unit.startsWith("m")) return Math.round(n * 1024 * 1024);
  if (unit.startsWith("k")) return Math.round(n * 1024);
  return undefined;
}

function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function makeCache(maxSize = 500, ttlMs = 5 * 60 * 1000) {
  const cache = new Map();
  function get(url) {
    const hit = cache.get(url);
    if (hit && hit.expiresAt > Date.now()) return hit.html;
    return null;
  }
  function set(url, html) {
    cache.set(url, { html, expiresAt: Date.now() + ttlMs });
    while (cache.size > maxSize) cache.delete(cache.keys().next().value);
  }
  return { get, set };
}

function browserHeaders(referer) {
  return {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    "Sec-Ch-Ua": '"Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    ...(referer ? { "Referer": referer } : {}),
  };
}

async function browserFetch(url, opts = {}) {
  const referer = opts.referer || new URL(url).origin + "/";
  return fetch(url, {
    ...opts,
    headers: { ...browserHeaders(referer), ...(opts.headers || {}) },
  });
}

module.exports = { UA, maskError, stripTags, decodeHtmlEntities, cleanText, parseCodeOf, parseMagnetTrackers, parseInfoHash, parseSizeBytes, formatSize, makeCache, browserHeaders, browserFetch };
