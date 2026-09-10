const fs = require("node:fs/promises");
const path = require("node:path");

const sources = [
  { prefix: "avmirror", label: "Nova", catalog: require("../src/scrapers/avmirror").scrapeCatalog, meta: require("../src/scrapers/avmirror").scrapeMeta, streams: require("../src/scrapers/avmirror").scrapeStreams, options: { page: 1, mode: "avmirror" } },
  { prefix: "javquick", label: "Pulse", catalog: require("../src/scrapers/javquick").scrapeJavquickCatalog, meta: require("../src/scrapers/javquick").scrapeJavquickMeta, streams: require("../src/scrapers/javquick").scrapeJavquickStreams, options: { page: 1 } },
  { prefix: "hohoj", label: "Apex", catalog: require("../src/scrapers/hohoj").scrapeHohojCatalog, meta: require("../src/scrapers/hohoj").scrapeHohojMeta, streams: require("../src/scrapers/hohoj").scrapeHohojStreams, options: { page: 1 } },
  { prefix: "ggjav", label: "Luna", catalog: require("../src/scrapers/ggjav").scrapeCatalog, meta: require("../src/scrapers/ggjav").scrapeMeta, streams: require("../src/scrapers/ggjav").scrapeStreams, options: { page: 1, mode: "ggjav" } },
  { prefix: "javmenu", label: "Crimson", catalog: require("../src/scrapers/javmenu").scrapeCatalog, meta: require("../src/scrapers/javmenu").scrapeMeta, streams: require("../src/scrapers/javmenu").scrapeStreams, options: { page: 1, mode: "javmenu" } },
  { prefix: "goodav17", label: "Azure", catalog: require("../src/scrapers/goodav17").scrapeGoodav17Catalog, meta: require("../src/scrapers/goodav17").scrapeGoodav17Meta, streams: require("../src/scrapers/goodav17").scrapeGoodav17Streams, options: { page: 1 } },
  { prefix: "avjoy", label: "Solar", catalog: require("../src/scrapers/avjoy").scrapeAvjoyCatalog, meta: require("../src/scrapers/avjoy").scrapeAvjoyMeta, streams: require("../src/scrapers/avjoy").scrapeAvjoyStreams, options: { page: 1 } },
  { prefix: "ijavtorrent", label: "Watermelon", catalog: require("../src/scrapers/ijavtorrent").scrapeCatalog, meta: require("../src/scrapers/ijavtorrent").scrapeMeta, streams: require("../src/scrapers/ijavtorrent").scrapeStreams, options: { page: 1 } },
  { prefix: "projectjav", label: "Blueberry", catalog: require("../src/scrapers/projectjav").scrapeCatalog, meta: require("../src/scrapers/projectjav").scrapeMeta, streams: require("../src/scrapers/projectjav").scrapeStreams, options: { page: 1 } },
  { prefix: "ffjav", label: "Kiwi", catalog: require("../src/scrapers/ffjav").scrapeCatalog, meta: require("../src/scrapers/ffjav").scrapeMeta, streams: require("../src/scrapers/ffjav").scrapeStreams, options: { page: 1 } },
  { prefix: "sukebeinyaa", label: "Sashimi", catalog: require("../src/scrapers/sukebeinyaa").scrapeCatalog, meta: require("../src/scrapers/sukebeinyaa").scrapeMeta, streams: require("../src/scrapers/sukebeinyaa").scrapeStreams, options: { page: 1 } },
  { prefix: "missav", label: "Lemon", catalog: require("../src/scrapers/missav").scrapeCatalog, meta: require("../src/scrapers/missav").scrapeMeta, streams: require("../src/scrapers/missav").scrapeStreams, options: { page: 1 } },
];

const timeoutMs = Number(process.env.DIAG_TIMEOUT_MS || 20000);
const maxItems = Number(process.env.DIAG_ITEMS || 1);
const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36";

async function withTimeout(promise, ms = timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms); }),
    ]);
  } finally { clearTimeout(timer); }
}

function extractCode(value) {
  const match = String(value || "").toUpperCase().match(/\b([A-Z]{2,8}[-_ ]?\d{2,6})\b/);
  return match ? match[1].replace(/[ _]/g, "-") : null;
}
function statusOk(status) { return status >= 200 && status < 300; }
function headerValue(headers, name) { return headers?.get?.(name) || ""; }
function streamHeaders(stream) {
  const request = stream?.behaviorHints?.proxyHeaders?.request || stream?.behaviorHints?.proxyHeaders?.headers || {};
  return { "User-Agent": request["User-Agent"] || request["user-agent"] || ua, Referer: request.Referer || request.referer || undefined, Origin: request.Origin || request.origin || undefined, Accept: "*/*" };
}
function firstMediaLine(text) {
  return String(text).split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith("#")) || null;
}
function looksLikePlaylist(response, body) {
  const type = headerValue(response.headers, "content-type").toLowerCase();
  return /^\s*#EXTM3U/m.test(body) || /mpegurl|m3u8/i.test(type);
}
function looksLikeVideo(type) {
  return /video\//i.test(type) || /mpeg|octet-stream/i.test(type);
}

async function fetchBytes(url, headers = {}, range = "bytes=0-2047") {
  const response = await withTimeout(fetch(url, { redirect: "follow", headers: { ...headers, Range: range } }));
  const body = Buffer.from(await withTimeout(response.arrayBuffer()));
  return { url: response.url || url, status: response.status, type: headerValue(response.headers, "content-type"), bytes: body.length, body, response };
}

async function probeStream(stream) {
  if (stream?.infoHash) {
    const infoHash = String(stream.infoHash).toLowerCase();
    const sources = Array.isArray(stream.sources) ? stream.sources : [];
    return {
      kind: "p2p",
      infoHash,
      sources: sources.length,
      ok: /^[a-f0-9]{40}$/.test(infoHash) && sources.length > 0,
      error: /^[a-f0-9]{40}$/.test(infoHash) && sources.length > 0 ? undefined : "invalid P2P stream metadata",
    };
  }
  const url = stream?.url;
  if (!url) return { kind: stream?.externalUrl ? "external-page" : "missing-url", ok: false, externalUrl: stream?.externalUrl || null };
  const headers = streamHeaders(stream);
  try {
    const first = await fetchBytes(url, headers);
    const result = { kind: "media", url, finalUrl: first.url, status: first.status, type: first.type, bytes: first.bytes, playlist: false, segment: null, ok: statusOk(first.status) && first.bytes > 0 && !/text\/html|image\//i.test(first.type) };
    if (looksLikePlaylist(first.response, first.body)) {
      result.playlist = true;
      if (!/^\s*#EXTM3U/m.test(first.body.toString())) {
        result.ok = false;
        result.error = "response looks like HLS by content-type but has no EXT-M3U";
        return result;
      }
      const child = firstMediaLine(first.body);
      if (child) {
        const childUrl = new URL(child, first.url).href;
        const segment = await fetchBytes(childUrl, headers);
        result.child = { url: childUrl, status: segment.status, type: segment.type, bytes: segment.bytes, playlist: looksLikePlaylist(segment.response, segment.body) };
        if (result.child.playlist) {
          const segmentLine = firstMediaLine(segment.body);
          if (segmentLine) {
            const segmentUrl = new URL(segmentLine, segment.url).href;
            const media = await fetchBytes(segmentUrl, headers);
            result.segment = { url: segmentUrl, status: media.status, type: media.type, bytes: media.bytes };
            result.ok = result.ok && statusOk(media.status) && media.bytes > 0 && looksLikeVideo(media.type);
          } else {
            result.ok = false;
            result.error = "child playlist has no media URI";
          }
        } else {
          result.segment = result.child;
          result.ok = result.ok && statusOk(segment.status) && segment.bytes > 0 && looksLikeVideo(segment.type);
        }
      } else {
        result.ok = false;
        result.error = "playlist has no URI";
      }
    }
    return result;
  } catch (error) {
    return { kind: "media", url, ok: false, error: error.message };
  }
}

async function getCatalog(source, options = {}) {
  return withTimeout(source.catalog(options));
}
async function exactMatches(code, excludePrefix) {
  if (!code) return [];
  const matches = [];
  await Promise.all(sources.map(async source => {
    if (source.prefix === excludePrefix) return;
    try {
      const items = await getCatalog(source, { page: 1, search: code, mode: "" });
      const found = (items || []).filter(item => extractCode(item.name) === code).slice(0, 3);
      if (found.length) matches.push({ source: source.prefix, count: found.length, items: found.map(item => ({ id: item.id, name: item.name })) });
    } catch (error) {
      matches.push({ source: source.prefix, error: error.message });
    }
  }));
  return matches.sort((a, b) => a.source.localeCompare(b.source));
}

async function diagnoseSource(source) {
  const report = { source: source.prefix, label: source.label, catalog: { ok: false, count: 0 }, items: [], errors: [] };
  try {
    const items = await getCatalog(source, source.options);
    report.catalog = { ok: Array.isArray(items) && items.length > 0, count: Array.isArray(items) ? items.length : 0 };
    if (!Array.isArray(items) || !items.length) return report;
    for (const item of items.slice(0, maxItems)) {
      const itemReport = { id: item.id, name: item.name, idPrefix: String(item.id || "").split(":")[0], meta: null, code: null, matches: [], streams: null };
      try {
        const meta = await withTimeout(source.meta(item.id));
        itemReport.meta = { ok: !!meta, name: meta?.name || null };
        itemReport.code = extractCode(meta?.name || item.name);
        itemReport.matches = await exactMatches(itemReport.code, source.prefix);
        const streams = await withTimeout(source.streams(item.id));
        itemReport.streams = { count: Array.isArray(streams) ? streams.length : 0, entries: [] };
        for (const stream of (streams || []).slice(0, 3)) {
          itemReport.streams.entries.push({ title: stream.title || stream.name || null, ...await probeStream(stream) });
        }
      } catch (error) {
        itemReport.error = error.message;
      }
      report.items.push(itemReport);
    }
  } catch (error) {
    report.errors.push(error.message);
  }
  return report;
}

(async () => {
  const startedAt = new Date().toISOString();
  const reports = [];
  for (const source of sources) {
    const report = await diagnoseSource(source);
    reports.push(report);
    console.log(JSON.stringify(report));
  }
  const result = { startedAt, timeoutMs, maxItems, sources: reports };
  const output = path.resolve(process.env.DIAG_OUTPUT || "dist/source-diagnosis.json");
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(result, null, 2) + "\n");
  const summary = reports.map(report => {
    const item = report.items[0];
    const media = item?.streams?.entries || [];
    return `${report.source}: catalog=${report.catalog.ok ? "ok" : "FAIL"}(${report.catalog.count}) meta=${item?.meta?.ok ? "ok" : "FAIL"} code=${item?.code || "-"} matches=${item?.matches?.filter(x => !x.error).length || 0} media=${media.filter(x => x.ok).length}/${media.length}`;
  });
  console.log(summary.join("\n"));
  const failed = reports.some(report => !report.catalog.ok || report.items.some(item => !item.meta?.ok || !item.streams?.entries?.some(stream => stream.ok)));
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
