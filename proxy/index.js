const ALLOWED_HOSTS = [
  "v1.rdse.lol",
  "javmenu.com",
  "javdb.com",
  "123av.com",
  "ijavtorrent.com",
  "projectjav.com",
];

module.exports = (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const target = req.query.url;
  if (!target) return res.status(400).json({ error: "missing url parameter" });

  let parsed;
  try { parsed = new URL(target); } catch { return res.status(400).json({ error: "invalid url" }); }
  if (parsed.protocol !== "https:") return res.status(403).json({ error: "only https allowed" });

  const host = parsed.hostname;
  const allowed = ALLOWED_HOSTS.some(h => host === h || host.endsWith("." + h));
  if (!allowed) return res.status(403).json({ error: `host ${host} not allowed` });

  fetch(target, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": `https://${host}/`,
    },
    redirect: "follow",
  }).then(async (r) => {
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("text") || ct.includes("html") || ct.includes("javascript") || ct.includes("json")) {
      const body = await r.text();
      res.setHeader("Content-Type", ct);
      res.status(r.status).send(body);
    } else {
      const buf = Buffer.from(await r.arrayBuffer());
      res.setHeader("Content-Type", ct || "application/octet-stream");
      res.status(r.status).send(buf);
    }
  }).catch(e => {
    res.status(502).json({ error: e.message });
  });
};
