var JABLE = "https://jable.tv";
var UA = "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/139.0.0.0 Mobile Safari/537.36";

function headers(referer) {
  return { Referer: referer, Origin: JABLE, "User-Agent": UA };
}

function request(url, referer) {
  return fetch(url, {
    headers: Object.assign({ Accept: "text/html,application/xhtml+xml" }, headers(referer || JABLE + "/"))
  }).then(function (response) {
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.text();
  });
}

function encodedUrl(id) {
  if (typeof id !== "string" || id.indexOf("jable:") !== 0) return null;
  try {
    var value = id.slice(6).replace(/-/g, "+").replace(/_/g, "/");
    while (value.length % 4) value += "=";
    var url = decodeURIComponent(escape(atob(value)));
    var parsed = new URL(url);
    return parsed.origin === JABLE && /^\/videos\/[^/?#]+\/?$/i.test(parsed.pathname) ? parsed.href : null;
  } catch (_) { return null; }
}

function mediaUrl(html, pageUrl) {
  var decoded = String(html || "")
    .replace(/&amp;/gi, "&")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/");
  var matches = [];
  var match = /\bhlsUrl\s*=\s*['"]([^'"]+\.m3u8[^'"]*)['"]/i.exec(decoded);
  if (match) matches.push(match[1]);
  var generic = /https?:[^"'<>\s]+\.(?:m3u8|mp4|m4v|webm)(?:\?[^"'<>\s]*)?/gi;
  while ((match = generic.exec(decoded))) matches.push(match[0]);
  for (var i = 0; i < matches.length; i++) {
    try {
      var url = new URL(matches[i], pageUrl).href;
      if (/^https:\/\//i.test(url) && /\.(?:m3u8|mp4|m4v|webm)(?:[?#]|$)/i.test(url)) return url;
    } catch (_) {}
  }
  return null;
}

function getStreams(id, mediaType) {
  if (mediaType && mediaType !== "movie") return Promise.resolve([]);
  var pageUrl = encodedUrl(id);
  if (!pageUrl) return Promise.resolve([]);
  return request(pageUrl, JABLE + "/").then(function (html) {
    var url = mediaUrl(html, pageUrl);
    if (!url) return [];
    var requestHeaders = headers(pageUrl);
    return [{
      name: "Jable.TV",
      title: "Jable.TV • HLS",
      url: url,
      quality: "Auto",
      headers: requestHeaders,
      behaviorHints: {
        notWebReady: false,
        bingeGroup: "jable",
        proxyHeaders: { request: requestHeaders }
      }
    }];
  }).catch(function (error) {
    console.log("AVMirror Jable.TV: " + error.message);
    return [];
  });
}

module.exports = { getStreams: getStreams };
