const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSearchResults, parseDownloads } = require("../src/scrapers/subtitlecat");

test("SubtitleCat parses exact JAV result pages", () => {
  const html = '<a href="/subs/1505/NSPS-539%20%5BWhisper%5D.html">NSPS-539 [Whisper]</a><a href="/subs/2/OTHER-1.html">OTHER-1</a>';
  assert.deepEqual(parseSearchResults(html, "NSPS-539"), ["https://www.subtitlecat.com/subs/1505/NSPS-539%20%5BWhisper%5D.html"]);
});

test("SubtitleCat parses English and Spanish SRT download links", () => {
  const html = '<a id="download_en" href="/subs/1515/NSPS-539-en.srt">Download</a><a id="download_es" href="/subs/1515/NSPS-539-es.srt">Download</a>';
  assert.deepEqual(parseDownloads(html), [
    { source: "subtitlecat", lang: "en", url: "https://www.subtitlecat.com/subs/1515/NSPS-539-en.srt" },
    { source: "subtitlecat", lang: "es", url: "https://www.subtitlecat.com/subs/1515/NSPS-539-es.srt" },
  ]);
});

test("SubtitleCat parses language links without download ids", () => {
  const html = '<a href="/subs/1515/NSPS-539-pt.srt">Português</a><a href="/subs/1515/NSPS-539-fr.srt">Français</a>';
  assert.deepEqual(parseDownloads(html), [
    { source: "subtitlecat", lang: "pt", url: "https://www.subtitlecat.com/subs/1515/NSPS-539-pt.srt" },
    { source: "subtitlecat", lang: "fr", url: "https://www.subtitlecat.com/subs/1515/NSPS-539-fr.srt" },
  ]);
});
