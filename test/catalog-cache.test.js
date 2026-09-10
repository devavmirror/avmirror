const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readCatalogCache, readPosterCache } = require("../src/lib/catalog-cache");

test("catalog cache files have the expected schema and AVMirror source", () => {
  for (const file of ["recentes.json", "populares.json", "sem-censura.json", "censurado.json"]) {
    const filename = path.join(__dirname, "..", "data", "catalog", file);
    assert.equal(fs.existsSync(filename), true, `${file} must exist`);
    const payload = JSON.parse(fs.readFileSync(filename, "utf8"));
    assert.equal(payload.schema, 1);
    assert.equal(payload.source, "avmirror");
    assert.ok(payload.generatedAt);
    assert.ok(payload.pages.some(page => page.items.length > 0));
  }
});

test("catalog cache reader returns only the requested page", () => {
  const items = readCatalogCache("avmirror", 1);
  assert.ok(Array.isArray(items));
  assert.ok(items.length > 0);
  assert.match(items[0].id, /^avmirror:/);
});

test("catalog cache resolves a poster without fetching item metadata", () => {
  const items = readCatalogCache("avmirror", 1);
  const poster = readPosterCache(items[0].id);
  assert.match(poster, /^https?:\/\//);
});
