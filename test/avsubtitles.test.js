const test = require("node:test");
const assert = require("node:assert/strict");
const { findSubtitles, parseMovieResults, parseSubtitleLinks, parseRevision } = require("../src/scrapers/avsubtitles");

const originalFetch = global.fetch;
function response(body, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/html" } });
}

test("AVSubtitles finds English and Spanish subtitle revisions by JAV code", async () => {
  const searchUrl = "https://www.avsubtitles.com/search_results.php?search=TEST-123";
  const movieUrl = "https://www.avsubtitles.com/movie1/test-123--title";
  const enUrl = `${movieUrl}/subtitles/en/11`;
  const esUrl = `${movieUrl}/subtitles/es/12`;
  global.fetch = async input => {
    const url = String(input);
    if (url === searchUrl) return response('<a href="/movie1/test-123--title">[TEST-123] Title</a>');
    if (url === movieUrl) return response(`<a href="${enUrl}">English</a><a href="${esUrl}">Spanish</a>`);
    if (url === enUrl) return response('<form action="/download_page.php"><input name="subid" value="11"><input name="revid" value="20260101010101"></form>');
    if (url === esUrl) return response('<form action="/download_page.php"><input name="subid" value="12"><input name="revid" value="20260102020202"></form>');
    throw new Error(`Unexpected fixture request: ${url}`);
  };
  try {
    assert.deepEqual(await findSubtitles("TEST-123"), [
      { source: "avsubtitles", subid: "11", revid: "20260101010101", lang: "en" },
      { source: "avsubtitles", subid: "12", revid: "20260102020202", lang: "es" },
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("AVSubtitles parsers reject nonmatching or incomplete records", () => {
  assert.deepEqual(parseMovieResults('<a href="/movie1/other-999">OTHER-999</a>', "TEST-123"), []);
  assert.deepEqual(parseSubtitleLinks('<a href="/movie1/test-123/subtitles/fr/3">French</a>', "en"), []);
  assert.equal(parseRevision('<form action="/download_page.php"><input name="subid" value="1"></form>', { subid: "1" }), null);
});

test("AVSubtitles accepts supported languages beyond English and Spanish", () => {
  assert.deepEqual(parseSubtitleLinks('<a href="/movie/test/subtitles/pt-br/7">Portuguese</a><a href="/movie/test/subtitles/xx/8">Unknown</a>'), [
    { lang: "pt-br", subid: "7", url: "https://www.avsubtitles.com/movie/test/subtitles/pt-br/7" },
  ]);
});
