const base = String(process.env.SMOKE_BASE_URL || "http://127.0.0.1:7000").replace(/\/+$/, "");

async function getJSON(path, expected = 200) {
  const response = await fetch(`${base}${path}`);
  const text = await response.text();
  if (response.status !== expected) throw new Error(`${path}: esperado ${expected}, recebido ${response.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { throw new Error(`${path}: resposta não é JSON`); }
}

(async () => {
  const health = await getJSON("/health");
  if (!health.ok || health.hlsProxy !== true) throw new Error("health/proxy inválido");

  const manifest = await getJSON("/manifest.json");
  if (!manifest.id?.startsWith("com.avmirror.addon")) throw new Error("manifesto inesperado");

  const catalog = await getJSON("/catalog/movie/avmirror.json");
  if (!Array.isArray(catalog.metas) || !catalog.metas.length) throw new Error("catálogo vazio");
  const item = catalog.metas[0];
  const streams = await getJSON(`/stream/movie/${encodeURIComponent(item.id)}.json`);
  const realStreams = (streams.streams || []).filter(stream => stream.url || stream.infoHash);
  if (!realStreams.length) throw new Error(`nenhum stream real para ${item.id}`);

  for (const stream of realStreams) {
    if (stream.infoHash) {
      if (!/^[a-f0-9]{40}$/i.test(stream.infoHash)) throw new Error("infoHash inválido");
      if (stream.url) throw new Error("torrent P2P não deve conter URL HTTP");
      if (!Array.isArray(stream.sources) || !stream.sources.length) throw new Error("torrent sem trackers");
      if (stream.behaviorHints?.notWebReady !== false) throw new Error("torrent marcado como não reproduzível");
    } else if (!/^https?:\/\//i.test(stream.url)) {
      throw new Error(`URL HTTP inválida: ${stream.url}`);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    base,
    item: item.name,
    streams: realStreams.map(stream => stream.infoHash ? { kind: "p2p", infoHash: stream.infoHash, trackers: stream.sources.length } : { kind: "http", url: stream.url }),
  }, null, 2));
})().catch(error => {
  console.error(`smoke: ${error.message}`);
  process.exitCode = 1;
});
