/* AVMirror Nuvio provider: uses the unified addon stream endpoint first. */
var UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";
var ADDON_BASE = "https://avmirror-3843.onbelmo.uk";

function request(url, options) {
  options = options || {};
  var headers = options.headers || {};
  headers["User-Agent"] = UA;
  headers["Accept"] = headers["Accept"] || "*/*";
  return fetch(url, { method: options.method || "GET", headers: headers, body: options.body })
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); });
}

function encodedUrl(id, prefix) {
  if (typeof id !== "string" || id.indexOf(prefix) !== 0) return null;
  try { return decodeURIComponent(escape(atob(id.slice(prefix.length)))); } catch (_) { return null; }
}

function extractDirectStreams(html, pageUrl, label) {
  var found = [];
  var seen = {};
  var pattern = /https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>]*)?/gi;
  var match;
  while ((match = pattern.exec(html || ""))) {
    var url = match[0].replace(/\\/g, "");
    if (!seen[url]) { seen[url] = true; found.push({ name: "AVMirror / " + label, title: "Stream direto", url: url, quality: "Auto", headers: { Referer: pageUrl, "User-Agent": UA } }); }
  }
  return found.slice(0, 10);
}

function genericStreams(id, prefix, label) {
  var pageUrl = encodedUrl(id, prefix);
  if (!pageUrl || !/^https?:\/\//i.test(pageUrl)) return Promise.resolve([]);
  return request(pageUrl, { headers: { Referer: pageUrl } }).then(function (html) {
    return extractDirectStreams(html, pageUrl, label);
  }).catch(function (error) { console.log("AVMirror " + label + ": " + error.message); return []; });
}

function getStreams(id, mediaType, season, episode) {
  if (mediaType && mediaType !== "movie") return Promise.resolve([]);
  if (typeof id !== "string" || id.indexOf("avmirror:") !== 0) return Promise.resolve([]);
  var endpoint = ADDON_BASE + "/stream/movie/" + encodeURIComponent(id) + ".json";
  return request(endpoint, { headers: { Referer: ADDON_BASE + "/" } })
    .then(function (body) {
      var payload = JSON.parse(body);
      return Array.isArray(payload.streams) ? payload.streams : [];
    })
    .catch(function () { return []; });
}

module.exports = { getStreams: getStreams };
