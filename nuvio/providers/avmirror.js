/* AVMirror Nuvio provider: direct device-side resolution, no Render/Cloudflare proxy. */
var UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";
var AV01 = "https://www.av01.media";

function request(url, options) {
  options = options || {};
  var headers = options.headers || {};
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
      var params = new URLSearchParams({ token_v2: geo.token_v2, expires: geo.expires, ip: geo.ip });
      return request(AV01 + "/api/v1/videos/" + videoId + "/cdn-access?" + params.toString(), { headers: { Accept: "application/json", Referer: AV01 + "/" } });
    })
    .then(function (accessText) {
      var access = JSON.parse(accessText);
      var token = access && access.access_token ? "?access_token=" + encodeURIComponent(access.access_token) : "";
      return [{ name: "AVMirror / AV01", title: "AV01 • direto", url: AV01 + "/api/v1/videos/" + videoId + "/manifest/master.m3u8" + token, quality: "Auto", headers: { Referer: AV01 + "/", "User-Agent": UA } }];
    })
    .catch(function (error) { console.log("AVMirror AV01: " + error.message); return []; });
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
  return av01Id(id)
    ? av01Streams(id)
    : genericStreams(id, "avmirror:", "AVMirror")
      .then(function (streams) { return streams.length ? streams : genericStreams(id, "javrider:", "JavRider"); });
}

module.exports = { getStreams: getStreams };
