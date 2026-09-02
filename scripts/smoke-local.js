const base = process.env.SMOKE_BASE_URL || "http://127.0.0.1:7000";

async function check(path, expected = 200) {
  const response = await fetch(`${base}${path}`);
  const text = await response.text();
  if (response.status !== expected) throw new Error(`${path}: esperado ${expected}, recebido ${response.status}: ${text.slice(0, 200)}`);
  console.log(`${response.status} ${path} ${text.length} bytes`);
  return text;
}

(async () => {
  await check("/health");
  const manifest = await check("/manifest.json");
  const parsed = JSON.parse(manifest);
  if (parsed.id !== "com.avmirror.addon.local") throw new Error("manifesto local inesperado");
  if (JSON.stringify(parsed.idPrefixes) !== JSON.stringify(["jable:"])) throw new Error("prefixos de fonte inesperados");
  await check("/catalog/movie/jable.json");
  await check("/catalog/movie/jable-popular.json");
  console.log("smoke local Jable: OK");
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
