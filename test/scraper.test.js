const test = require("node:test");
const assert = require("node:assert/strict");

const {
  makeId,
  idToUrl,
  isItemUrl,
  isUsefulPlayerUrl,
  collectCatalogFromHtml,
  collectFallbackStreams
} = require("../src/scrapers/avmirror");

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

test("stream fallback extracts media and encoded player URLs", () => {
  const player = "https://cdn.example/player?id=123";
  const encodedPlayer = Buffer.from(player).toString("base64url");
  const html = `<video src="https://cdn.example/video/master.m3u8"></video><script>{"iframe_url":"${encodedPlayer}"}</script>`;
  const fallback = collectFallbackStreams(html, "https://jav.guru/123/item/");
  assert.equal(fallback.found.has("https://cdn.example/video/master.m3u8"), true);
  assert.equal(fallback.players.has(player), true);
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
