const test = require("node:test");
const assert = require("node:assert/strict");
const { parseMagnet, parseSearchResults } = require("../src/scrapers/zeromagnet");

const magnet = "magnet:?xt=urn:btih:69b9105f08ddbcb8a4c73c734b2d44675bcd3aee&dn=DLDSS-005&xl=1277270851&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce";

test("Peach parses a public JAV magnet", () => {
  const parsed = parseMagnet(magnet);
  assert.equal(parsed.infoHash, "69b9105f08ddbcb8a4c73c734b2d44675bcd3aee");
  assert.equal(parsed.size, 1277270851);
  assert.deepEqual(parsed.trackers, ["tracker:udp://tracker.opentrackr.org:1337/announce"]);
});

test("Peach search parser keeps JAV code result links", () => {
  const html = '<a href="/!abc1">DLDSS-005</a><a href="/!abc2">Other title</a>';
  const results = parseSearchResults(html, "DLDSS-005");
  assert.equal(results.length, 1);
  assert.equal(results[0].id, "zeromagnet:https://16mag.net/!abc1");
  assert.equal(results[0].code, "DLDSS-005");
});
