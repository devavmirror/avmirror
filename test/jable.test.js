const test = require("node:test");
const assert = require("node:assert/strict");
const {
  catalogUrl,
  makeJableId,
  idToJableUrl,
  isJableVideoUrl,
  collectJableCatalog,
  parseJableMeta,
  extractJableStreamUrls
} = require("../jable");

test("Jable IDs round-trip only video pages from jable.tv", () => {
  const url = "https://jable.tv/videos/waaa-685/";
  const id = makeJableId(url);
  assert.match(id, /^jable:/);
  assert.equal(idToJableUrl(id), url);
  assert.equal(idToJableUrl(makeJableId("https://example.com/videos/waaa-685/")), null);
  assert.equal(isJableVideoUrl(url), true);
  assert.equal(isJableVideoUrl("https://jable.tv/latest-updates/"), false);
});

test("catalogUrl uses local Jable routes for new, popular, search and tags", () => {
  assert.equal(catalogUrl({ page: 1, mode: "jable" }), "https://jable.tv/latest-updates/");
  assert.equal(catalogUrl({ page: 2, mode: "jable" }), "https://jable.tv/latest-updates/2/");
  assert.equal(catalogUrl({ page: 1, mode: "jable-popular" }), "https://jable.tv/hot/");
  assert.equal(catalogUrl({ page: 3, mode: "jable-popular" }), "https://jable.tv/hot/3/");
  assert.equal(catalogUrl({ search: "waaa 685" }), "https://jable.tv/search/waaa%20685/");
  assert.equal(catalogUrl({ page: 2, search: "waaa 685" }), "https://jable.tv/search/waaa%20685/2/");
  assert.equal(catalogUrl({ genre: "Nurse" }), "https://jable.tv/tags/nurse/");
});

test("catalog parser extracts one movie per video URL with poster and runtime", () => {
  const html = `
    <div class="video-block">
      <div class="img-box cover-md">
        <a href="https://jable.tv/videos/waaa-685/">
          <img src="https://assets-cdn.jable.tv/contents/videos_screenshots/61000/61690/320x180/1.jpg" data-preview="https://assets-cdn.jable.tv/contents/videos_screenshots/61000/61690/61690_preview.mp4">
          <div class="absolute-bottom-right"><span class="label">2:10:20</span></div>
        </a>
      </div>
      <div class="detail"><h6 class="title"><a href="https://jable.tv/videos/waaa-685/">WAAA-685 Example title</a></h6></div>
    </div>`;
  const metas = collectJableCatalog(html);
  assert.equal(metas.length, 1);
  assert.equal(metas[0].name, "WAAA-685 Example title");
  assert.equal(metas[0].runtime, "2:10:20");
  assert.equal(metas[0].poster, "https://assets-cdn.jable.tv/contents/videos_screenshots/61000/61690/320x180/1.jpg");
  assert.match(metas[0].id, /^jable:/);
});

test("metadata parser extracts title, poster, cast, genres, runtime and date", () => {
  const html = `
    <html><head>
      <meta property="og:image" content="https://assets-cdn.jable.tv/contents/videos_screenshots/61000/61690/preview.jpg">
      <meta property="og:description" content="Example description">
    </head><body><main>
      <video poster="https://assets-cdn.jable.tv/contents/videos_screenshots/61000/61690/preview.jpg"></video>
      <h1>WAAA-685 Example title</h1><time datetime="2026-08-27"></time>
      <span>2:10:20</span><a href="/models/model-a/">Model A</a>
      <a href="/categories/uniform/">Uniform</a><a href="/tags/nurse/">Nurse</a>
    </main></body></html>`;
  const id = makeJableId("https://jable.tv/videos/waaa-685/");
  const meta = parseJableMeta(html, id, "https://jable.tv/videos/waaa-685/");
  assert.equal(meta.name, "WAAA-685 Example title");
  assert.equal(meta.runtime, "2:10:20");
  assert.equal(meta.releaseInfo, "2026-08-27");
  assert.deepEqual(meta.cast, ["Model A"]);
  assert.deepEqual(meta.genre, ["Uniform", "Nurse"]);
  assert.match(meta.poster, /preview\.jpg$/);
});

test("stream parser prefers Jable HLS and ignores preview MP4 and ad URLs", () => {
  const hls = "https://home-clone-clear.mushroomtrack.com/hls/token/1788385601/61000/61690/61690.m3u8";
  const html = `<video src="blob:https://jable.tv/example"></video><script>var hlsUrl = '${hls}'; var tagUrl = 'https://syndication.exosrv.com/splash.php?idzone=1';</script><img src="https://assets-cdn.jable.tv/contents/videos_screenshots/61000/61690/61690_preview.mp4">`;
  const segment = "https://home-clone-clear.mushroomtrack.com/hls/token/1788385601/61000/61690/616900.ts";
  const preview = "https://assets-cdn.jable.tv/contents/videos_screenshots/61000/61690/61690_preview.mp4";
  assert.deepEqual(extractJableStreamUrls(html, "https://jable.tv/videos/waaa-685/", [hls, segment, preview]), [hls]);
});
