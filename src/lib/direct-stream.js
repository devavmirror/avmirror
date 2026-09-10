const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

function resolveDirectMediaUrl(rawUrl, baseUrl) {
  if (!rawUrl) return null;
  const value = String(rawUrl)
    .trim()
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

function directBehaviorHints(refererUrl, bingeGroup, userAgent = DEFAULT_USER_AGENT) {
  try {
    const referer = new URL(refererUrl).href;
    return {
      notWebReady: false,
      ...(bingeGroup ? { bingeGroup } : {}),
      // Stremio calls this field proxyHeaders, but these headers are consumed
      // by the client for the original direct media request. No AVMirror URL
      // is inserted and no media bytes pass through this addon.
      proxyHeaders: {
        request: {
          "User-Agent": userAgent,
          Referer: referer,
          Origin: new URL(referer).origin,
        },
      },
    };
  } catch {
    return {
      notWebReady: false,
      ...(bingeGroup ? { bingeGroup } : {}),
    };
  }
}

module.exports = { resolveDirectMediaUrl, directBehaviorHints, DEFAULT_USER_AGENT };
