const test = require("node:test");
const assert = require("node:assert/strict");

const {
  makeId,
  idToUrl,
  isItemUrl,
  isUsefulPlayerUrl,
  collectCatalogFromHtml,
  collectFallbackStreams,
  scrapeCatalog
} = require("../src/scrapers/avmirror");

const originalFetch = global.fetch;

test("makeId and idToUrl round-trip an item URL", () => {
  const url = "https://jav.guru/1046008/example-title/";
  const id = makeId(url);
  assert.equal(idToUrl(id), url);
});

test("idToUrl rejects malformed and foreign-domain IDs", () => {
  assert.equal(idToUrl("not-an-avmirror-id"), null);
  assert.equal(idToUrl(makeId("https://example.com/1/item/")), null);
});

test("isItemUrl only accepts item paths on the configured source", () => {
  assert.equal(isItemUrl("https://jav.guru/123/item/"), true);
  assert.equal(isItemUrl("https://jav.guru/page/2/"), false);
  assert.equal(isItemUrl("https://example.com/123/item/"), false);
});

test("isUsefulPlayerUrl accepts external players without a source-domain allowlist", () => {
  assert.equal(isUsefulPlayerUrl("https://cdn.example/player/123"), true);
  assert.equal(isUsefulPlayerUrl("https://jav.guru/searcho/?xd=abc"), true);
  assert.equal(isUsefulPlayerUrl("https://jav.guru/123/item/"), false);
});

test("catalog fallback extracts cards and posters from HTML", () => {
  const html = `
    <article class="post">
      <a href="/123/example-title/"><img src="/poster.jpg"><h2>Example title</h2></a>
    </article>
    <article class="post">
      <a href="https://jav.guru/456/another-title/">Another title</a>
    </article>`;
  const metas = collectCatalogFromHtml(html);
  assert.equal(metas.length, 2);
  assert.equal(metas[0].name, "Example title");
  assert.equal(metas[0].poster, "https://jav.guru/poster.jpg");
  assert.match(metas[0].id, /^avmirror:/);
});

test("actor search resolves only the matching actress filmography", { concurrency: false }, async () => {
  const actressIndex = "https://jav.guru/jav-actress-list/?taxonomy_search=Hitomi%20Tanaka";
  const actressPage = "https://jav.guru/actress/hitomi-tanaka/";
  global.fetch = async input => {
    const url = String(input);
    if (url === actressIndex) return new Response(`<a href="/actress/other/">Other</a><a href="${actressPage}">Hitomi Tanaka</a>`);
    if (url === actressPage) return new Response(`<article><a href="/100/hitomi-title/"><h2>Hitomi title</h2></a></article>`);
    throw new Error(`Unexpected fixture request: ${url}`);
  };
  try {
    const results = await scrapeCatalog({ page: 1, search: "Hitomi Tanaka", mode: "avmirror-actors" });
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "Hitomi title");
  } finally {
    global.fetch = originalFetch;
  }
});

test("actor search matches a full query to the source first-name alias", { concurrency: false }, async () => {
  const actressIndex = "https://jav.guru/jav-actress-list/?taxonomy_search=Hitomi%20Tanaka%20Alias";
  const actressPage = "https://jav.guru/actress/hitomi-alias/";
  global.fetch = async input => {
    const url = String(input);
    if (url === actressIndex) return new Response(`<a href="${actressPage}"><span class="actrees-name">Hitomi</span><span>182 videos</span></a>`);
    if (url === actressPage) return new Response(`<article><a href="/100/hitomi-title/"><h2>Hitomi title</h2></a></article>`);
    throw new Error(`Unexpected fixture request: ${url}`);
  };
  try {
    const results = await scrapeCatalog({ page: 1, search: "Hitomi Tanaka Alias", mode: "avmirror-actors" });
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "Hitomi title");
  } finally {
    global.fetch = originalFetch;
  }
});

test("catalog modes use distinct AVMirror category and tag URLs", { concurrency: false }, async () => {
  const requests = [];
  global.fetch = async input => {
    requests.push(String(input));
    return new Response("<html></html>");
  };
  try {
    await scrapeCatalog({ page: 1, mode: "avmirror-censored" });
    await scrapeCatalog({ page: 1, mode: "avmirror-uncensored" });
    await scrapeCatalog({ page: 1, tag: "Bondage", mode: "avmirror-tags" });
    assert.equal(requests[0], "https://jav.guru/category/jav/");
    assert.equal(requests[1], "https://jav.guru/category/decensored/");
    assert.equal(requests[2], "https://jav.guru/tag/bondage/?category_name=jav");
  } finally {
    global.fetch = originalFetch;
  }
});

test("actor search plus tag keeps only matching film cards", { concurrency: false }, async () => {
  const actressIndex = "https://jav.guru/jav-actress-list/?taxonomy_search=Hitomi%20Tanaka%20Filter";
  const actressPage = "https://jav.guru/actress/hitomi-filter/";
  global.fetch = async input => {
    const url = String(input);
    if (url === actressIndex) return new Response(`<a href="${actressPage}"><span class="actrees-name">Hitomi</span></a>`);
    if (url === actressPage) return new Response(`
      <div class="inside-article"><h2><a href="/100/one/">Hitomi One</a></h2><p class="tags"><a rel="tag" href="/tag/big-tits/">Big tits</a></p></div>
      <div class="inside-article"><h2><a href="/101/two/">Hitomi Two</a></h2><p class="tags"><a rel="tag" href="/tag/teacher/">Teacher</a></p></div>`);
    throw new Error(`Unexpected fixture request: ${url}`);
  };
  try {
    const results = await scrapeCatalog({ page: 1, search: "Hitomi Tanaka Filter", tag: "Big tits", mode: "avmirror-actors" });
    assert.deepEqual(results.map(item => item.name), ["Hitomi One"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("stream fallback extracts media and encoded player URLs", () => {
  const player = "https://cdn.example/player?id=123";
  const encodedPlayer = Buffer.from(player).toString("base64url");
  const html = `<video src="https://cdn.example/video/master.m3u8"></video><script>{"iframe_url":"${encodedPlayer}"}</script>`;
  const fallback = collectFallbackStreams(html, "https://jav.guru/123/item/");
  assert.equal(fallback.found.has("https://cdn.example/video/master.m3u8"), true);
  assert.equal(fallback.players.has(player), true);
});

test("stream fallback extracts relative media from player configuration", () => {
  const html = `
    <div data-hls="/media/master.m3u8?token=fixture"></div>
    <script>window.player = { file: '/media/backup.m3u8?token=fixture' };</script>`;
  const fallback = collectFallbackStreams(html, "https://jav.guru/123/item/");
  assert.equal(fallback.found.has("https://jav.guru/media/master.m3u8?token=fixture"), true);
  assert.equal(fallback.found.has("https://jav.guru/media/backup.m3u8?token=fixture"), true);
});

test("stream fallback rejects known advertising media and frames", () => {
  const html = `<video src="https://media-hls.growcdnssedge.com/hls/ad/master.m3u8"></video><iframe src="https://go.mayzaent.com/player/ad"></iframe>`;
  const fallback = collectFallbackStreams(html, "https://jav.guru/123/item/");
  assert.equal(fallback.found.size, 0);
  assert.equal(fallback.players.size, 0);
});

test("stream fallback rejects common ad networks and ad paths", () => {
  const html = `<video src="https://doubleclick.net/ads/master.m3u8"></video><iframe src="https://cdn.example/ads/banner-player"></iframe><video src="https://cdn.example/video/master.m3u8"></video>`;
  const fallback = collectFallbackStreams(html, "https://jav.guru/123/item/");
  assert.equal(fallback.found.size, 1);
  assert.equal(fallback.players.size, 0);
});

test("stream fallback rejects TikTok image playlists used as video advertising", () => {
  const html = `<video src="https://cdn3.turboviplay.com/data1/video.m3u8"></video><video src="https://cdn.example/video/master.m3u8"></video>`;
  const fallback = collectFallbackStreams(html, "https://jav.guru/123/item/");
  assert.equal(fallback.found.has("https://cdn3.turboviplay.com/data1/video.m3u8"), false);
  assert.equal(fallback.found.has("https://cdn.example/video/master.m3u8"), true);
});
