const AV01_BASE_URL = (process.env.AV01_BASE_URL || "https://www.av01.media").replace(/\/+$/, "");
const AV01_API_URL = `${AV01_BASE_URL}/api/v1`;
const AV01_GEO_URL = process.env.AV01_GEO_URL || "https://files.iw01.xyz/edge/geo.js?json";
const AV01_TIMEOUT_MS = Number(process.env.AV01_REQUEST_TIMEOUT_MS || 20000);
const AV01_IMAGE_TIMEOUT_MS = Number(process.env.AV01_IMAGE_TIMEOUT_MS || 8000);
const AV01_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 900000);
const USER_AGENT = process.env.USER_AGENT || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
const AV01_TAGS = [
  [314590, "Hi-Def"], [1, "Creampie"], [314849, "Exclusive Distribution"], [5, "Featured Actress"],
  [2, "Big Tits"], [424, "Amateur"], [3, "Married Woman"], [527309, "4K"], [314685, "Gonzo"],
  [166, "Blowjob"], [94, "Beautiful Girl"], [599, "Mature Woman"], [59, "Slender"], [60, "Beautiful Tits"],
  [26, "Slut"], [280, "POV"], [6, "Cheating Wife"], [1453138, "One-to-one shooting"], [4, "Threesome / Foursome"],
  [127, "Squirting"], [314727, "Over 4 Hours"], [179, "Nymphomaniac"], [13, "Titty Fuck"], [106, "Cowgirl"],
  [137, "School Girl"], [309, "Drama"], [107, "Big Asses"], [353, "Facial"], [104, "Ass Lover"],
  [663, "Cosplay"], [1928, "Adultery"], [559, "Uniform"], [315523, "Digital Mosaic"], [71, "Older Sister"],
  [2140, "Picking Up Girls"], [61, "Documentary"], [287, "College Girl"], [214, "Deep Throat"], [313783, "Orgasm"],
  [423, "Masturbation"], [560, "Office Lady"], [653, "Kiss Kiss"], [157, "Gal"], [147, "Handjob"],
  [421, "Voyeur"], [115, "Stepfamily"], [93, "Shame"], [314812, "Debut"], [73, "Orgy"],
  [314726, "Compilation"], [315074, "Other Fetishes"], [177, "Lotion"], [96, "Variety"], [625, "Sex Toys"],
  [375, "Anal Play"], [213, "Embarrassment"], [72, "Cum Swallowing"], [515, "Foot Fetish"], [1488, "Small Tits"],
  [313199, "Doggy style"], [50, "Ropes & Ties"], [235, "Dirty Talk"], [615, "Massage Parlor"], [1521, "Cunnilingus"],
  [259, "Idol & Celebrity"], [391, "Bukkake"], [616, "Massage"], [311, "Big Vibrator"], [138, "School Uniform"],
  [314765, "Idol Video"], [703, "Pantyhose"], [15, "Sister"], [2439, "Lesbian"], [1590, "Anal Sex"], [1150, "Chubby"]
];
const AV01_GENRES = AV01_TAGS.map(([, name]) => name);
const cache = new Map();

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cacheGet(key) {
  const entry = cache.get(key);
  return entry && Date.now() - entry.time < entry.ttl ? entry.value : null;
}

function cacheSet(key, value, ttl = CACHE_TTL_MS) {
  cache.set(key, { time: Date.now(), ttl, value });
  while (cache.size > 300) cache.delete(cache.keys().next().value);
  return value;
}

async function fetchText(url, { timeoutMs = AV01_TIMEOUT_MS, accept = "*/*", method = "GET", body, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      body,
      signal: controller.signal,
      headers: {
        "user-agent": USER_AGENT,
        referer: `${AV01_BASE_URL}/`,
        accept,
        ...headers
      }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`AV01 HTTP ${response.status}`);
    return { response, text };
  } finally {
    clearTimeout(timer);
  }
}

async function requestJson(path, options = {}) {
  const { text } = await fetchText(`${AV01_API_URL}/${String(path).replace(/^\/+/, "")}`, {
    ...options,
    accept: "application/json"
  });
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("AV01 returned invalid JSON");
  }
}

async function getGeo() {
  const cached = cacheGet("geo");
  if (cached) return cached;
  const { text } = await fetchText(AV01_GEO_URL, { accept: "application/json" });
  let geo;
  try {
    geo = JSON.parse(text);
  } catch {
    throw new Error("AV01 geo response is invalid");
  }
  if (!geo?.access_token) throw new Error("AV01 geo response has no access token");
  const ttl = Math.max(60000, Math.min(CACHE_TTL_MS, (Number(geo.ttl) || 600) * 1000 - 30000));
  return cacheSet("geo", geo, ttl);
}

function makeAv01Id(videoId) {
  return `av01:${String(videoId)}`;
}

function av01IdToNumber(id) {
  if (typeof id !== "string" || !/^av01:\d+$/.test(id)) return null;
  const value = Number(id.slice(5));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function translation(translations, fallback = "") {
  if (!translations || typeof translations !== "object") return clean(fallback);
  return clean(translations.en || translations.pt || translations.jp || fallback);
}

function videoTitle(video) {
  return translation(video?.title_translations, video?.title) || clean(video?.dvd_id) || `AV01 ${video?.id || "video"}`;
}

function durationToRuntime(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const minutes = Math.round(value / 60);
  return minutes > 0 ? `${minutes} min` : "1 min";
}

function av01PosterUrl(videoId, geo) {
  if (!geo?.access_token) return null;
  const value = Number(videoId);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  const eu = String(geo.continent || "").toUpperCase() === "EU";
  const host = eu ? "static2.av01.tv" : "static.av01.tv";
  return `https://${host}/media/videos/tmb/${value}/1.jpg/format=jpeg/wlv=480?access_token=${encodeURIComponent(geo.access_token)}`;
}

function mapCatalogVideo(video, geo = null) {
  if (!video?.id) return null;
  const meta = {
    id: makeAv01Id(video.id),
    type: "movie",
    name: videoTitle(video)
  };
  const poster = av01PosterUrl(video.id, geo);
  if (poster) meta.poster = poster;
  const runtime = durationToRuntime(video.duration);
  if (runtime) meta.runtime = runtime;
  return meta;
}

function mapMetaVideo(video) {
  const meta = mapCatalogVideo(video);
  if (!meta) return null;
  const description = translation(video.description_translations, video.description);
  const genres = (Array.isArray(video.tags) ? video.tags : [])
    .map(tag => translation(tag.name_translations, tag.name))
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 30);
  const cast = (Array.isArray(video.actresses) ? video.actresses : [])
    .map(actress => translation(actress.name_translations, actress.name))
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 30);
  if (description) meta.description = description;
  if (genres.length) meta.genre = genres;
  if (cast.length) meta.cast = cast;
  if (video.maker || video.maker_translations) {
    const maker = translation(video.maker_translations, video.maker);
    if (maker) meta.director = maker;
  }
  const published = video.published_time || video.uploaded_time;
  if (published) meta.releaseInfo = String(published).slice(0, 10);
  return meta;
}

function extractVideos(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.videos)) return body.videos;
  if (Array.isArray(body?.data?.videos)) return body.data.videos;
  return [];
}

function av01TagId(genre) {
  const value = clean(genre).toLowerCase();
  const match = AV01_TAGS.find(([, name]) => name.toLowerCase() === value);
  return match ? match[0] : null;
}

async function scrapeAv01Catalog({ page = 1, search = "", genre = "", mode = "av01" } = {}) {
  const currentPage = Math.max(1, Math.floor(Number(page) || 1));
  const query = clean(search);
  const geo = await getGeo().catch(() => null);
  let body;
  if (query) {
    body = await requestJson("videos/search?lang=en", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: query.slice(0, 80), pagination: { page: currentPage, limit: 20 } })
    });
  } else {
    const tagId = av01TagId(genre);
    if (tagId) body = await requestJson(`videos/tag/${tagId}?page=${currentPage}&limit=20`);
    else {
      const kind = mode === "av01-popular" ? "hottest" : "latest";
      body = await requestJson(`videos/types/${kind}?page=${currentPage}&limit=20`);
    }
  }
  return extractVideos(body).map(video => mapCatalogVideo(video, geo)).filter(Boolean).slice(0, 100);
}

async function scrapeAv01Meta(id) {
  const videoId = av01IdToNumber(id);
  if (!videoId) return null;
  const cacheKey = `meta:${videoId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const video = await requestJson(`videos/${videoId}`);
  const meta = mapMetaVideo(video);
  const geo = await getGeo().catch(() => null);
  if (meta) {
    const poster = av01PosterUrl(videoId, geo);
    if (poster) meta.poster = poster;
  }
  return cacheSet(cacheKey, meta);
}

async function getAv01CdnAccess(videoId) {
  const geo = await getGeo();
  const params = new URLSearchParams({
    token_v2: geo.token_v2,
    expires: geo.expires,
    ip: geo.ip
  });
  const access = await requestJson(`videos/${videoId}/cdn-access?${params.toString()}`);
  return access?.access_token || null;
}

async function scrapeAv01Streams(id) {
  const videoId = av01IdToNumber(id);
  if (!videoId) return [];
  const cacheKey = `streams:${videoId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  let accessToken = null;
  try {
    accessToken = await getAv01CdnAccess(videoId);
  } catch (error) {
    console.error("AV01 CDN access:", error.message);
  }
  const query = accessToken ? `?access_token=${encodeURIComponent(accessToken)}` : "";
  const url = `${AV01_BASE_URL}/api/v1/videos/${videoId}/manifest/master.m3u8${query}`;
  return cacheSet(cacheKey, [{
    name: "AVMirror",
    title: "AV01 • Auto",
    url,
    behaviorHints: { notWebReady: false, bingeGroup: "av01" }
  }], 120000);
}

async function fetchAv01Poster(videoId) {
  const value = Number(videoId);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("invalid AV01 video id");
  const geo = await getGeo();
  const token = encodeURIComponent(geo.access_token);
  const euHosts = ["static2.av01.tv", "static.av01.tv", "img1.iw01.xyz"];
  const otherHosts = ["static.av01.tv", "static2.av01.tv", "img1.iw01.xyz"];
  const hosts = String(geo.continent || "").toUpperCase() === "EU" ? euHosts : otherHosts;
  let lastError = null;
  for (const host of hosts) {
    const url = `https://${host}/media/videos/tmb/${value}/1.jpg/format=jpeg/wlv=480?access_token=${token}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AV01_IMAGE_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "user-agent": USER_AGENT, referer: `${AV01_BASE_URL}/`, accept: "image/avif,image/webp,image/jpeg,image/*;q=0.8" }
      });
      const type = String(response.headers.get("content-type") || "").split(";", 1)[0].toLowerCase();
      if (!response.ok || !type.startsWith("image/")) throw new Error(`AV01 image HTTP ${response.status}`);
      const length = Number(response.headers.get("content-length") || 0);
      if (length > AV01_IMAGE_MAX_BYTES) throw new Error("AV01 image is too large");
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > AV01_IMAGE_MAX_BYTES) throw new Error("AV01 image is too large");
      return { body, type };
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("AV01 image unavailable");
}

module.exports = {
  AV01_BASE_URL,
  makeAv01Id,
  av01IdToNumber,
  scrapeAv01Catalog,
  scrapeAv01Meta,
  AV01_GENRES,
  scrapeAv01Streams,
  fetchAv01Poster
};
