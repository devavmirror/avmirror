const TRACKERS_URL = "https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_best.txt";
const TRACKER_COUNT = 25;
const REFRESH_MS = Number(process.env.TRACKERS_REFRESH_MS || 30 * 60 * 1000);
const FETCH_TIMEOUT_MS = Number(process.env.TRACKERS_FETCH_TIMEOUT_MS || 8000);

const FALLBACK_TRACKERS = [
  "http://tracker.opentrackr.org:1337/announce",
  "http://tracker.bt4g.com:2095/announce",
  "http://tracker.torrent.eu.org:451/announce",
  "http://tracker.openbittorrent.com:80/announce",
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.webtorrent.dev",
  "udp://zer0day.ch:1337/announce",
  "udp://tracker.therarbg.to:6969/announce",
  "udp://tracker.publictracker.xyz:6969/announce",
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.qu.ax:6969/announce",
  "udp://tracker.peerfect.org:6969/announce",
  "udp://tracker.opentrackr.com:6969/announce",
  "udp://tracker.ilibr.org:6969/announce",
  "udp://tracker.farted.net:6969/announce",
  "udp://tracker.dler.org:6969/announce",
  "udp://tracker.auctor.tv:6969/announce",
  "udp://tracker.004430.xyz:1337/announce",
  "udp://tracker-udp.gbitt.info:80/announce",
  "udp://retracker01-msk-virt.corbina.net:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://explodie.org:6969/announce",
];

let currentTrackers = FALLBACK_TRACKERS.slice(0, TRACKER_COUNT);
let refreshing;

function parseTrackerList(text) {
  const values = String(text || "")
    .split(/\s+/)
    .map(value => value.trim())
    .filter(value => /^(?:udp|https?|wss):\/\//i.test(value));
  return [...new Set(values)].slice(0, TRACKER_COUNT);
}

async function refreshTrackers() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const response = await fetch(TRACKERS_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`trackers HTTP ${response.status}`);
      const remote = parseTrackerList(await response.text());
      const next = [...new Set([...remote, ...FALLBACK_TRACKERS])].slice(0, TRACKER_COUNT);
      if (remote.length >= Math.min(10, TRACKER_COUNT)) {
        currentTrackers = next;
        console.error(`[trackers] loaded ${remote.length} dynamic trackers (${currentTrackers.length} total)`);
      } else {
        console.error(`[trackers] ignored short dynamic list (${next.length})`);
      }
    } catch (error) {
      console.error(`[trackers] using fallback: ${error.message}`);
    } finally {
      refreshing = null;
    }
    return currentTrackers;
  })();
  return refreshing;
}

function getTrackers() {
  return currentTrackers.slice(0, TRACKER_COUNT);
}

setImmediate(() => refreshTrackers().catch(() => {}));
setInterval(() => refreshTrackers().catch(() => {}), REFRESH_MS).unref();

module.exports = { TRACKERS_URL, TRACKER_COUNT, FALLBACK_TRACKERS, parseTrackerList, getTrackers, refreshTrackers };
