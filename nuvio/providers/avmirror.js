var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36";
var AV01 = "https://www.av01.media";
function playbackHeaders(referer) {
  var headers = { Referer: referer, "User-Agent": UA };
  try { headers.Origin = new URL(referer).origin; } catch (_) {}
  return headers;
}
var MEDIA_PATTERN = /(?:[.]m3u8(?:[?#]|$)|[.]mp4(?:[?#]|$)|[.]m4v(?:[?#]|$)|[.]webm(?:[?#]|$)|[.]m4s(?:[?#]|$)|[.]ts(?:[?#]|$)|master[.]txt(?:[?#]|$)|[/](?:cdn[/]hls|m3)[/]|videoplayback|[/](?:manifest|playlist|stream|hls)(?:[/?.]|$))/i;

function request(url, options) {
  options = options || {};
  var headers = Object.assign({}, options.headers || {});
  headers["User-Agent"] = UA;
  headers["Accept"] = headers["Accept"] || "*/*";
  return fetch(url, { method: options.method || "GET", headers: headers, body: options.body })
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); });
}

function av01Id(id) {
  var match = String(id || "").match(/^av01:(\d+)$/);
  return match ? match[1] : null;
}

function av01Streams(id) {
  var videoId = av01Id(id);
  if (!videoId) return Promise.resolve([]);
  return request("https://files.iw01.xyz/edge/geo.js?json", { headers: { Accept: "application/json", Referer: AV01 + "/" } })
    .then(function (geoText) {
      var geo = JSON.parse(geoText);
      if (!geo || !geo.token_v2 || !geo.expires || !geo.ip) throw new Error("geo incompleto");
      var params = new URLSearchParams({ token_v2: geo.token_v2, expires: geo.expires, ip: geo.ip });
      return request(AV01 + "/api/v1/videos/" + videoId + "/cdn-access?" + params.toString(), { headers: { Accept: "application/json", Referer: AV01 + "/" } });
    })
    .then(function (accessText) {
      var access = JSON.parse(accessText);
      if (!access || !access.access_token) return [];
      var token = "?access_token=" + encodeURIComponent(access.access_token);
      var headers = playbackHeaders(AV01 + "/");
      return [{ name: "AVMirror / AV01", title: "AV01 • direto", url: AV01 + "/api/v1/videos/" + videoId + "/manifest/master.m3u8" + token, quality: "Auto", behaviorHints: { notWebReady: false, bingeGroup: "av01", proxyHeaders: { request: headers } }, headers: headers }];
    })
    .catch(function (error) { console.log("AVMirror AV01: " + error.message); return []; });
}

function encodedUrl(id, prefix) {
  if (typeof id !== "string" || id.indexOf(prefix) !== 0) return null;
  try {
    var value = id.slice(prefix.length).replace(/-/g, "+").replace(/_/g, "/");
    while (value.length % 4) value += "=";
    return decodeURIComponent(escape(atob(value)));
  } catch (_) { return null; }
}

function decodeEmbeddedText(value) {
  return String(value || "")
    .replace(/\\u002f/gi, "/")
    .replace(/\\u003a/gi, ":")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"');
}

function normalizeUrl(value, pageUrl) {
  try {
    var url = new URL(String(value || "").trim(), pageUrl);
    if (!/^https?:$/i.test(url.protocol)) return null;
    return url.href.replace(/[),;]+$/, "");
  } catch (_) { return null; }
}

function isMediaUrl(url) {
  try {
    var parsed = new URL(String(url || ""));
    return MEDIA_PATTERN.test(parsed.pathname + parsed.search);
  } catch (_) { return false; }
}

function extractDirectStreams(html, pageUrl, label) {
  var decoded = decodeEmbeddedText(html), found = [], seen = {};
  var add = function (value) {
    var url = normalizeUrl(value, pageUrl);
    if (!url || !isMediaUrl(url) || seen[url]) return;
    seen[url] = true;
    var headers = playbackHeaders(pageUrl);
    found.push({ name: "AVMirror / " + label, title: "Stream direto", url: url, quality: "Auto", headers: headers, behaviorHints: { notWebReady: false, proxyHeaders: { request: headers } } });
  };
  var match;
  var urlPattern = /(?:https?:)?[/][/][^"'<> \t\r\n]+/g;
  while ((match = urlPattern.exec(decoded))) add(match[0]);
  var tagPattern = /<(?:video|source|audio)[^>]+(?:src|data-src|data-url)=["']([^"']+)["']/gi;
  while ((match = tagPattern.exec(decoded))) add(match[1]);
  var dataPattern = /data-(?:file|hls|video|stream|source)=["']([^"']+)["']/gi;
  while ((match = dataPattern.exec(decoded))) add(match[1]);
  var scriptPattern = /(?:file|src|source|streaming_url|hls|m3u8|mp4|master[.]txt)[ \t]*(?:[:=])[ \t]*["']([^"']+)["']/gi;
  while ((match = scriptPattern.exec(decoded))) add(match[1]);
  return found.slice(0, 10);
}

function extractPlayers(html, pageUrl) {
  var decoded = decodeEmbeddedText(html), found = [], seen = {};
  var add = function (value) {
    var url = normalizeUrl(value, pageUrl);
    if (!url || isMediaUrl(url) || /doubleclick|googlesyndication|popunder|popup|popads|adservice|tiktokcdn|ad-site|[.]image(?:[/ ?#]|$)/i.test(url) || seen[url]) return;
    seen[url] = true;
    found.push(url);
  };
  var match;
  var tagPattern = /<(?:iframe|embed)[^>]+(?:src|data-src|data-url)=["']([^"']+)["']/gi;
  while ((match = tagPattern.exec(decoded))) add(match[1]);
  var dataPattern = /(?:iframe_url|player_url|embed_url)[ \t]*:[ \t]*["']([^"']+)["']/gi;
  while ((match = dataPattern.exec(decoded))) add(match[1]);
  return found.slice(0, 6);
}

function genericStreams(id, prefix, label) {
  var pageUrl = encodedUrl(id, prefix);
  if (!pageUrl || !/^https?:[/][/]/i.test(pageUrl)) return Promise.resolve([]);
  var visited = {};
  function resolve(url, depth) {
    if (visited[url] || depth > 3) return Promise.resolve([]);
    visited[url] = true;
    return request(url, { headers: { Referer: pageUrl } }).then(function (html) {
      var direct = extractDirectStreams(html, url, label);
      if (direct.length) return direct;
      var players = extractPlayers(html, url);
      return Promise.all(players.map(function (player) { return resolve(player, depth + 1); }))
        .then(function (results) {
          var streams = [].concat.apply([], results), seen = {};
          return streams.filter(function (stream) { if (seen[stream.url]) return false; seen[stream.url] = true; return true; }).slice(0, 10);
        });
    }).catch(function (error) { console.log("AVMirror " + label + ": " + error.message); return []; });
  }
  return resolve(pageUrl, 0);
}

function getStreams(id, mediaType, season, episode) {
  if (mediaType && mediaType !== "movie") return Promise.resolve([]);
  return av01Id(id)
    ? av01Streams(id)
    : genericStreams(id, "avmirror:", "AVMirror")
      .then(function (streams) { return streams.length ? streams : genericStreams(id, "javrider:", "JavRider"); });
}

module.exports = { getStreams: getStreams };
