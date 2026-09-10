const probeCache = new Map();
const pending = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
const NO_RESPONSE_TTL_MS = 45 * 1000;
const PROBE_TIMEOUT_MS = Number(process.env.TORRENT_PROBE_TIMEOUT_MS || 5000);
const MAX_TRACKERS = Number(process.env.TORRENT_PROBE_MAX_TRACKERS || 6);
const MAX_PROBES = Number(process.env.TORRENT_PROBE_MAX_CANDIDATES || 5);
const MAX_CONCURRENCY = Number(process.env.TORRENT_PROBE_CONCURRENCY || 3);
let ClientPromise;

function cleanTrackers(stream) {
  const all = [...new Set((Array.isArray(stream?.sources) ? stream.sources : [])
    .map(value => String(value || "").replace(/^tracker:/i, "").trim())
    .filter(value => /^(?:udp|https?|wss?):\/\//i.test(value)))];
  const http = all.filter(v => /^https?:\/\//i.test(v));
  const wss = all.filter(v => /^wss:\/\//i.test(v));
  const udp = all.filter(v => /^udp:\/\//i.test(v));
  return [...http, ...wss, ...udp].slice(0, MAX_TRACKERS);
}

async function getClient() {
  if (!ClientPromise) ClientPromise = import("bittorrent-tracker").then(mod => mod.default);
  return ClientPromise;
}

async function probeTorrent(stream) {
  const infoHash = String(stream?.infoHash || "").toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(infoHash)) return { complete: 0, incomplete: 0, peers: 0, live: false };
  const cached = probeCache.get(infoHash);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (pending.has(infoHash)) return pending.get(infoHash);
  const request = (async () => {
    const announce = cleanTrackers(stream);
    if (!announce.length) return { complete: 0, incomplete: 0, peers: 0, live: false };
    try {
      const Client = await getClient();
      const result = await new Promise((resolve, reject) => {
        let settled = false;
        let peers = 0;
        let completed = 0;
        let announcedPeers = 0;
        let responded = false;
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          if (error) reject(error); else resolve(value);
        };
        const timer = setTimeout(() => finish(new Error("torrent probe timeout")), PROBE_TIMEOUT_MS);
        try {
          const client = new Client({
            infoHash,
            announce,
            peerId: "-AM2600-PEERPROBE001",
            port: 6881,
          });
          client.on("peer", () => { peers++; });
          client.on("update", data => {
            responded = true;
            completed = Math.max(completed, Number(data?.complete || 0));
            announcedPeers = Math.max(announcedPeers, Number(data?.incomplete || 0));
          });
          client.on("warning", () => {});
          client.on("error", () => {});
          client.start({ left: 1, numwant: 50 });
          setTimeout(() => {
            clearTimeout(timer);
            try { client.stop(); client.destroy(); } catch {}
            finish(null, { peers: Math.max(peers, announcedPeers), complete: completed, responded });
          }, Math.max(500, PROBE_TIMEOUT_MS - 100));
        } catch (error) {
          clearTimeout(timer);
          finish(error);
        }
      });
      const value = {
        complete: Number(result?.complete || 0),
        incomplete: Number(result?.peers || 0),
        peers: Number(result?.peers || 0),
        peerProbeResponded: Boolean(result?.responded),
        live: Number(result?.peers || 0) > 0 || Number(result?.complete || 0) > 0,
      };
      if (value.peerProbeResponded) {
        console.error(`[probe] ${infoHash.slice(0, 8)} ok: complete=${value.complete} peers=${value.peers}`);
      } else {
        console.error(`[probe] ${infoHash.slice(0, 8)} no response (${announce.length} trackers)`);
      }
      probeCache.set(infoHash, { value, expiresAt: Date.now() + (value.peerProbeResponded ? CACHE_TTL_MS : NO_RESPONSE_TTL_MS) });
      return value;
    } catch {
      const value = { complete: 0, incomplete: 0, peers: 0, peerProbeResponded: false, live: false };
      probeCache.set(infoHash, { value, expiresAt: Date.now() + NO_RESPONSE_TTL_MS });
      return value;
    } finally { pending.delete(infoHash); }
  })();
  pending.set(infoHash, request);
  return request;
}

async function rankTorrents(streams) {
  const list = Array.isArray(streams) ? streams : [];
  const candidates = [...list]
    .sort((a, b) => Number(b.seeders || b.behaviorHints?.seeders || 0) - Number(a.seeders || a.behaviorHints?.seeders || 0))
    .slice(0, MAX_PROBES);
  const probes = new Map();
  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      const stream = candidates[cursor++];
      probes.set(stream.infoHash.toLowerCase(), await probeTorrent(stream));
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, candidates.length) }, worker));
  return list.map((stream, index) => {
    const probe = probes.get(String(stream.infoHash || "").toLowerCase()) || { complete: 0, incomplete: 0, peers: 0, peerProbeResponded: false, live: false };
    const indexedSeeders = Number(stream.seeders || stream.behaviorHints?.seeders || 0);
    const probeResponded = probe.peerProbeResponded;
    return {
      ...stream,
      // Only include live peer data when the tracker actually answered.
      // On cloud servers UDP is often blocked; returning 0 fools the client
      // into thinking the torrent is dead when it is not.
      ...(probeResponded ? {
        liveSeeders: probe.complete,
        livePeers: probe.peers,
        peerProbeResponded: true,
        peerProbeLive: probe.live,
      } : {}),
      // Live tracker data outranks stale indexer counts. Keep the indexed count
      // only as a tie-breaker when trackers did not answer.
      rankingSeeders: probeResponded ? Math.max(probe.complete, probe.peers) : indexedSeeders,
      rankingScore: probeResponded
        ? (Number(probe.complete) * 5 + Number(probe.peers) * 3)
        : indexedSeeders,
    };
  }).sort((a, b) => {
    const liveOrder = Number(b.peerProbeLive || 0) - Number(a.peerProbeLive || 0);
    return liveOrder || b.rankingScore - a.rankingScore || b.rankingSeeders - a.rankingSeeders || Number(b.livePeers || 0) - Number(a.livePeers || 0);
  });
}

module.exports = { probeTorrent, rankTorrents, cleanTrackers };
