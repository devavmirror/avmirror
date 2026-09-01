const fs = require('node:fs');
const path = require('node:path');
const JavaScriptObfuscator = require('javascript-obfuscator');
const bytenode = require('bytenode');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist', 'protected');
const files = ['server.js', 'scraper.js', 'av01.js', 'javrider.js', 'scripts/start-local.js'];
fs.rmSync(out, { recursive: true, force: true });
for (const relative of files) {
  const source = path.join(root, relative);
  const protectedFile = path.join(out, relative);
  fs.mkdirSync(path.dirname(protectedFile), { recursive: true });
  const code = JavaScriptObfuscator.obfuscate(fs.readFileSync(source, 'utf8'), { compact: true, simplify: true, stringArray: true, stringArrayEncoding: ['base64'], stringArrayThreshold: 0.75 }).getObfuscatedCode();
  fs.writeFileSync(protectedFile, `${code}\n`);
  bytenode.compileFile({ filename: protectedFile, output: protectedFile.replace(/\.js$/, '.jsc') });
}
console.log(`Protected ${files.length} files in ${out}`);
