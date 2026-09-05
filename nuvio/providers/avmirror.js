/* AVMirror Nuvio provider: direct device-side resolution, no Render/Cloudflare proxy. */
var UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";

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
  return genericStreams(id, "avmirror:", "AVMirror")
    .then(function (streams) { return streams.length ? streams : genericStreams(id, "18jav:", "18Jav"); })
    .then(function (streams) { return streams.length ? streams : genericStreams(id, "goodav17:", "GoodAV17"); })
    .then(function (streams) { return streams.length ? streams : genericStreams(id, "avjoy:", "AVJoy"); });
}

module.exports = { getStreams: getStreams };
