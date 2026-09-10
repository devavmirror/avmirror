const dns = require("node:dns");
dns.setDefaultResultOrder("ipv4first");

const PROXY_URL = process.env.PROXY_URL || "";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const PROXYABLE_HOSTS = [
  "jav.guru", "javquick.com", "hohoj.tv", "ggjav.com", "javmenu.com",
  "goodav17.com", "avjoy.me", "ijavtorrent.com", "projectjav.com",
  "ffjav.com", "missav123.com", "javdb.com",
  "cdn-centaurus.com", "premilkyway.com",
  "tokyo-tosho.net", "16mag.net", "yourbittorrent.com",
  "avsubtitles.com", "subtitlecat.com",
];

const IMAGE_RE = /\.(jpg|jpeg|png|gif|webp|avif|svg|ico)($|\?)/i;

function isProxyable(url) {
  if (!PROXY_URL) return false;
  try {
    const h = new URL(url).hostname;
    return PROXYABLE_HOSTS.some(ph => h === ph || h.endsWith("." + ph));
  } catch { return false; }
}

function isImageRequest(url) {
  try {
    const u = new URL(url);
    return IMAGE_RE.test(u.pathname);
  } catch { return false; }
}

let proxyState = { disabledUntil: 0, ok: 0, fail: 0, lastError: "", lastOkAt: 0, lastFailAt: 0 };
const hostCooldown = new Map(); // host → expiresAt (403 banned sites)
const HOST_COOLDOWN_MS = 5 * 60 * 1000;

function getProxyStats() {
  const now = Date.now();
  return {
    enabled: !!PROXY_URL,
    url: PROXY_URL || null,
    disabled: now < proxyState.disabledUntil,
    disabledSecLeft: now < proxyState.disabledUntil ? Math.ceil((proxyState.disabledUntil - now) / 1000) : 0,
    ok: proxyState.ok,
    fail: proxyState.fail,
    lastError: proxyState.lastError,
    lastOkAt: proxyState.lastOkAt,
    lastFailAt: proxyState.lastFailAt,
  };
}

async function testProxy() {
  if (!PROXY_URL) return { ok: false, error: "no PROXY_URL set" };
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const resp = await fetch(`${PROXY_URL}?url=${encodeURIComponent("https://httpbin.org/get")}`, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA },
    });
    clearTimeout(timer);
    const ms = Date.now() - start;
    if (resp.ok) {
      const data = await resp.json();
      return { ok: true, ms, origin: data?.origin };
    }
    return { ok: false, ms, status: resp.status };
  } catch (e) {
    return { ok: false, ms: Date.now() - start, error: e.message?.slice(0, 120) };
  }
}

function installProxyFetch() {
  if (!PROXY_URL) {
    console.error("[net] direct mode (no proxy)");
    return;
  }
  if (globalThis.fetch.__proxyInstalled) return;
  const originalFetch = globalThis.fetch;
  let proxyDisabledUntil = 0;
  let stats = { image: 0, html: 0, proxyOk: 0, fallback: 0 };
  let lastLog = 0;

  globalThis.fetch = async function (url, options) {
    const targetUrl = typeof url === "string" ? url : url?.url || "";
    if (!isProxyable(targetUrl)) return originalFetch(url, options);
    if (Date.now() < proxyDisabledUntil) return originalFetch(url, options);

    let targetHost;
    try { targetHost = new URL(targetUrl).hostname; } catch {}
    if (targetHost) {
      const cooldownExpiry = hostCooldown.get(targetHost);
      if (cooldownExpiry && Date.now() < cooldownExpiry) {
        stats.fallback++;
        return originalFetch(url, options);
      }
    }

    const isImage = isImageRequest(targetUrl);
    const { signal: _, ...proxyOptions } = options || {};

    if (isImage) stats.image++; else stats.html++;

    // Try proxy first; if blocked or fails, fall back to direct fetch immediately
    const proxyUrl = `${PROXY_URL}?url=${encodeURIComponent(targetUrl)}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 25000);
    try {
      const resp = await originalFetch(proxyUrl, {
        ...proxyOptions,
        signal: ac.signal,
        headers: { "User-Agent": UA, ...(proxyOptions?.headers || {}) },
      });
      clearTimeout(timer);
      if (resp.ok) {
        stats.proxyOk++;
        proxyState.ok++;
        proxyState.lastOkAt = Date.now();
        proxyState.lastError = "";
        return resp;
      }
      const errMsg = `HTTP ${resp.status}`;
      console.error(`[net] proxy ${errMsg} for ${targetUrl.slice(0, 60)}`);
      proxyState.lastError = `${errMsg} → ${targetUrl.slice(0, 40)}`;
      proxyState.lastFailAt = Date.now();
      if (resp.status === 403 && targetHost) {
        hostCooldown.set(targetHost, Date.now() + HOST_COOLDOWN_MS);
        console.error(`[net] cooldown ${targetHost} for ${HOST_COOLDOWN_MS / 1000}s`);
      }
      if (resp.status === 429) {
        for (let r = 0; r < 2; r++) {
          const delay = 1500 * (r + 1);
          console.error(`[net] proxy 429 retry in ${delay}ms → ${targetUrl.slice(0, 60)}`);
          await new Promise(resolve => setTimeout(resolve, delay));
          const ac2 = new AbortController();
          const timer2 = setTimeout(() => ac2.abort(), 12000);
          try {
            const resp2 = await originalFetch(proxyUrl, {
              ...proxyOptions,
              signal: ac2.signal,
              headers: { "User-Agent": UA, ...(proxyOptions?.headers || {}) },
            });
            clearTimeout(timer2);
            if (resp2.ok) {
              stats.proxyOk++;
              proxyState.ok++;
              proxyState.lastOkAt = Date.now();
              return resp2;
            }
          } catch { clearTimeout(timer2); }
        }
      }
      // 403/5xx → fall through to direct fetch below
    } catch (e) {
      clearTimeout(timer);
      console.error(`[net] proxy err: ${e.message?.slice(0, 60)} → ${targetUrl.slice(0, 60)}`);
      proxyState.lastError = `${e.message?.slice(0, 60)} → ${targetUrl.slice(0, 40)}`;
      proxyState.lastFailAt = Date.now();
    }

    // Direct fallback: bypass proxy entirely
    stats.fallback++;
    proxyState.fail++;
    return originalFetch(url, options);
  };

  setInterval(() => {
    const now = Date.now();
    const total = stats.image + stats.html;
    if (total > 0 && now - lastLog > 60_000) {
      console.error(`[net] proxy ok=${stats.proxyOk} img=${stats.image} html=${stats.html} fallback=${stats.fallback}`);
      stats = { image: 0, html: 0, proxyOk: 0, fallback: 0 };
      lastLog = now;
    }
  }, 60 * 1000).unref();

  console.error(`[net] proxy enabled → ${PROXY_URL}`);
  globalThis.fetch.__proxyInstalled = true;
}

module.exports = { installProxyFetch, isProxyable, getProxyStats, testProxy };
