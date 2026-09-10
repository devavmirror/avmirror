/**
 * AVMirror API Worker (Cloudflare Worker Free)
 *
 * Caches manifest and catalog responses from Belmo.
 * Streams go direct to Belmo (not cached here).
 *
 * Deploy:
 *   cd proxy && npx wrangler deploy -c wrangler-api.toml
 */

const CACHE_TTL = {
  manifest: 86400,   // 24h
  catalog:  300,     // 5 min
};

const ALLOWED_RE = /^\/(manifest\.json|catalog\/)/;

function cacheTtl(pathname) {
  if (pathname === "/manifest.json") return CACHE_TTL.manifest;
  if (pathname.startsWith("/catalog/")) return CACHE_TTL.catalog;
  return 60;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // /api/purge?secret=X — clear all caches
    if (url.pathname === "/api/purge" && url.searchParams.get("secret") === env.PURGE_SECRET) {
      const keys = await caches.default.keys();
      const results = [];
      for (const key of keys) {
        const ok = await caches.default.delete(key);
        results.push({ url: key.url, deleted: ok });
      }
      return new Response(JSON.stringify({ ok: true, purged: results.length }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // Only cache manifest and catalog — streams/meta go direct to Belmo
    if (!ALLOWED_RE.test(url.pathname)) {
      // Pass through to Belmo without caching
      const origin = env.ORIGIN_URL;
      if (!origin) return fetch(request);
      const originUrl = new URL(url.pathname + url.search, origin);
      try {
        return await fetch(originUrl.toString(), {
          headers: { "user-agent": "avmirror-cf/1.0", accept: "application/json" },
          redirect: "follow",
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: "origin unreachable" }), {
          status: 502, headers: { "Content-Type": "application/json" },
        });
      }
    }

    const origin = env.ORIGIN_URL;
    if (!origin) {
      return new Response(JSON.stringify({ error: "ORIGIN_URL not configured" }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }

    const ttl = cacheTtl(url.pathname);
    const cache = caches.default;
    const cacheReq = new Request(url.toString(), { method: "GET" });

    // Try cache
    let cached = await cache.match(cacheReq);
    if (cached) {
      const resp = new Response(cached.body, cached);
      resp.headers.set("X-Cache", "HIT");
      return resp;
    }

    // Cache miss → fetch from Belmo
    const originUrl = new URL(url.pathname + url.search, origin);
    let originResp;
    try {
      originResp = await fetch(originUrl.toString(), {
        headers: {
          "user-agent": "avmirror-cf/1.0",
          accept: "application/json",
          "cf-connecting-ip": request.cf?.connectingIp || "127.0.0.1",
        },
        redirect: "follow",
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: "origin unreachable", detail: e.message }), {
        status: 502, headers: { "Content-Type": "application/json" },
      });
    }

    // Build response
    const resp = new Response(originResp.body, {
      status: originResp.status,
      headers: {
        "Content-Type": originResp.headers.get("Content-Type") || "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": `public, max-age=${ttl}, stale-while-revalidate=${ttl * 2}`,
        "X-Cache": "MISS",
      },
    });

    // Cache successful responses
    if (originResp.ok) {
      ctx.waitUntil(cache.put(cacheReq, resp.clone()));
    }

    return resp;
  },
};
