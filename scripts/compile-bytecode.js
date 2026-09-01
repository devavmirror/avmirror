const fs = require("node:fs");
const path = require("node:path");
const bytenode = require("bytenode");
const root = path.resolve(__dirname, "..");
const out = path.join(root, "dist", "bytecode");
const files = ["server.js", "scraper.js", "av01.js", "javrider.js"];
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const relative of files) {
  const source = path.join(root, relative);
  const target = path.join(out, relative.replace(/\.js$/, ".jsc"));
  bytenode.compileFile({ filename: source, output: target });
}
console.log(`Compiled ${files.length} files to V8 bytecode in ${out}`);
