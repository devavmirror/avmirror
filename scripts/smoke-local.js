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
  if (!parsed.id?.startsWith("com.avmirror.addon")) throw new Error("manifesto inesperado");
  await check("/catalog/movie/18jav.json");
  console.log("smoke local: OK");
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
