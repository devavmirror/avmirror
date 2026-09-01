const fs = require("node:fs");
const path = require("node:path");
const JavaScriptObfuscator = require("javascript-obfuscator");

const root = path.resolve(__dirname, "..");
const out = path.join(root, "dist", "protected");
const files = ["server.js", "scraper.js", "av01.js", "javrider.js", "scripts/start-local.js"];
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const relative of files) {
  const source = path.join(root, relative);
  const target = path.join(out, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const code = fs.readFileSync(source, "utf8");
  const result = JavaScriptObfuscator.obfuscate(code, {
    compact: true,
    simplify: true,
    stringArray: true,
    stringArrayEncoding: ["base64"],
    stringArrayThreshold: 0.75,
    sourceMap: false
  }).getObfuscatedCode();
  fs.writeFileSync(target, `${result}\n`);
}
console.log(`Protected ${files.length} JavaScript entry files in ${out}`);
