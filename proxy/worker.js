/**
 * AVMirror Proxy Worker (Cloudflare Worker Free)
 *
 * Proxy only — hides Belmo's IP when scraping sites.
 * Catalogs/manifest/streams are served directly by Belmo.
 *
 * Deploy:
 *   cd proxy && npx wrangler deploy -c wrangler.toml
 */

const ALLOWED_HOSTS = [
  "jav.guru", "javquick.com", "hohoj.tv", "ggjav.com", "javmenu.com",
  "goodav17.com", "avjoy.me", "ijavtorrent.com", "projectjav.com",
  "ffjav.com", "missav123.com", "javdb.com",
  "cdn-centaurus.com", "premilkyway.com",
  "tokyo-tosho.net", "16mag.net", "yourbittorrent.com",
  "avsubtitles.com", "subtitlecat.com",
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function isAllowed(host) {
  return ALLOWED_HOSTS.some(h => host === h || host.endsWith("." + h));
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get("url");

    if (!target) {
      return new Response(JSON.stringify({ error: "missing url" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    let parsed;
    try { parsed = new URL(target); } catch {
      return new Response(JSON.stringify({ error: "invalid url" }), { status: 400 });
    }
    if (parsed.protocol !== "https:") {
      return new Response(JSON.stringify({ error: "https only" }), { status: 403 });
    }
    if (!isAllowed(parsed.hostname)) {
      return new Response(JSON.stringify({ error: "host not allowed: " + parsed.hostname }), { status: 403 });
    }

    const path = parsed.pathname.toLowerCase();
    const isImage = /\.(jpg|jpeg|png|gif|webp|avif|svg|ico)($|\?)/.test(path);

    const headers = {
      "User-Agent": UA,
      "Accept": isImage
        ? "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
        : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Referer": `https://${parsed.hostname}/`,
      "Sec-Ch-Ua": '"Chromium";v="131", "Not_A Brand";v="24"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Cache-Control": "no-cache",
    };

    const cacheTtl = isImage ? 604800 : 0;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 25000);
    let resp;
    try {
      resp = await fetch(target, {
        headers,
        redirect: "follow",
        signal: ac.signal,
        cf: { cacheTtl, scrapeShield: false, cacheEverything: false },
      });
    } catch (e) {
      clearTimeout(timer);
      return new Response(JSON.stringify({ error: "fetch failed: " + e.message?.slice(0, 80) }), {
        status: 504, headers: { "Content-Type": "application/json" },
      });
    }
    clearTimeout(timer);

    const ct = (resp.headers.get("content-type") || (isImage ? "image/jpeg" : "text/html")).split(";")[0].trim();
    const body = await resp.arrayBuffer();

    return new Response(body, {
      status: resp.status,
      headers: {
        "Content-Type": ct,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": isImage
          ? "public, max-age=604800, stale-while-revalidate=86400"
          : "public, max-age=300, stale-while-revalidate=60",
      },
    });
  },
};
