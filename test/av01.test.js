const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  makeAv01Id,
  av01IdToNumber,
  scrapeAv01Catalog,
  scrapeAv01Meta,
  scrapeAv01Streams
} = require("../av01");

const originalFetch = global.fetch;

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => JSON.stringify(body)
  };
}

test("AV01 IDs are namespaced and validated", () => {
  assert.equal(makeAv01Id(218080), "av01:218080");
  assert.equal(av01IdToNumber("av01:218080"), 218080);
  assert.equal(av01IdToNumber("avmirror:218080"), null);
  assert.equal(av01IdToNumber("av01:0"), null);
  assert.equal(av01IdToNumber("av01:not-a-number"), null);
});

test("AV01 catalog maps latest videos and signed posters", async () => {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith("https://files.iw01.xyz/edge/geo.js")) {
      return jsonResponse({ access_token: "test-token", token_v2: "geo-token", expires: "1788358600", ip: "203.0.113.10", continent: "EU", ttl: 600 });
    }
    assert.equal(String(url), "https://www.av01.media/api/v1/videos/types/latest?page=1&limit=20");
    return jsonResponse({ videos: [{
      id: 123456,
      title: "Título original",
      title_translations: { en: "Translated title" },
      duration: 3660
    }] });
  };
  try {
    const result = await scrapeAv01Catalog({ page: 1, mode: "av01" });
    assert.equal(result.length, 1);
    assert.deepEqual(result[0], {
      id: "av01:123456",
      type: "movie",
      name: "Translated title",
      runtime: "61 min",
      poster: "https://static2.av01.tv/media/videos/tmb/123456/1.jpg/format=jpeg/wlv=480?access_token=test-token"
    });
    assert.equal(calls.length, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("AV01 metadata maps translated fields and uses the official poster CDN", async () => {
  global.fetch = async url => {
    const value = String(url);
    if (value.startsWith("https://files.iw01.xyz/edge/geo.js")) {
      return jsonResponse({ access_token: "meta-token", token_v2: "geo-token", expires: "1788358600", ip: "203.0.113.11", continent: "NA", ttl: 600 });
    }
    assert.equal(value, "https://www.av01.media/api/v1/videos/654321");
    return jsonResponse({
      id: 654321,
      title: "Original",
      title_translations: { en: "A title" },
      description: "Description",
      description_translations: { en: "Translated description" },
      duration: 120,
      published_time: "2026-08-31T00:00:00Z",
      maker: "Maker",
      maker_translations: { en: "Translated maker" },
      actresses: [{ name: "Actress", name_translations: { en: "Translated actress" } }],
      tags: [{ name: "Tag", name_translations: { en: "Translated tag" } }]
    });
  };
  try {
    const result = await scrapeAv01Meta("av01:654321");
    assert.equal(result.id, "av01:654321");
    assert.equal(result.name, "A title");
    assert.equal(result.description, "Translated description");
    assert.deepEqual(result.genre, ["Translated tag"]);
    assert.deepEqual(result.cast, ["Translated actress"]);
    assert.equal(result.director, "Translated maker");
    assert.equal(result.releaseInfo, "2026-08-31");
    assert.equal(result.poster, "https://static2.av01.tv/media/videos/tmb/654321/1.jpg/format=jpeg/wlv=480?access_token=test-token");
  } finally {
    global.fetch = originalFetch;
  }
});

test("AV01 streams expose the official master manifest with CDN access", async () => {
  global.fetch = async url => {
    assert.match(String(url), /https:\/\/www\.av01\.media\/api\/v1\/videos\/777777\/cdn-access\?/);
    return jsonResponse({ access_token: "stream-token" });
  };
  try {
    const result = await scrapeAv01Streams("av01:777777");
    assert.deepEqual(result, [{
      name: "AVMirror",
      title: "AV01 • Auto",
      url: "https://www.av01.media/api/v1/videos/777777/manifest/master.m3u8?access_token=stream-token",
      behaviorHints: { notWebReady: false, bingeGroup: "av01" }
    }]);
    assert.deepEqual(await scrapeAv01Streams("avmirror:777777"), []);
  } finally {
    global.fetch = originalFetch;
  }
});

test("AV01 does not publish an unsigned stream", async () => {
  global.fetch = async url => {
    if (String(url).startsWith("https://files.iw01.xyz/edge/geo.js")) return jsonResponse({ access_token: "token-only", continent: "EU", ttl: 600 });
    throw new Error("unexpected request");
  };
  try {
    assert.deepEqual(await scrapeAv01Streams("av01:888888"), []);
  } finally {
    global.fetch = originalFetch;
  }
});

test("AV01 genre maps to the official tag catalog endpoint", async () => {
  global.fetch = async url => {
    const value = String(url);
    if (value.startsWith("https://files.iw01.xyz/edge/geo.js")) {
      return jsonResponse({ access_token: "genre-token", token_v2: "geo-token", expires: "1788358600", ip: "203.0.113.12", continent: "EU", ttl: 600 });
    }
    assert.equal(value, "https://www.av01.media/api/v1/videos/tag/309?page=1&limit=20");
    return jsonResponse({ videos: [{ id: 111222, title: "Drama item" }] });
  };
  try {
    const result = await scrapeAv01Catalog({ page: 1, genre: "Drama" });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "av01:111222");
    assert.equal(result[0].name, "Drama item");
  } finally {
    global.fetch = originalFetch;
  }
});
