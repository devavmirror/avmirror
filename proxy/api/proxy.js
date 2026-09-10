export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  const target = req.query.url;
  if (!target) return res.status(400).json({ error: "missing url" });

  let parsed;
  try { parsed = new URL(target); } catch { return res.status(400).json({ error: "invalid url" }); }
  if (parsed.protocol !== "https:") return res.status(403).json({ error: "https only" });

  const host = parsed.hostname;
  const allowed = ["v1.rdse.lol", "javmenu.com", "javdb.com", "123av.com", "ijavtorrent.com", "projectjav.com"];
  if (!allowed.some(h => host === h || host.endsWith("." + h))) {
    return res.status(403).json({ error: "host not allowed: " + host });
  }

  try {
    const resp = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Referer": "https://" + host + "/",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
        "Sec-Ch-Ua": '"Chromium";v="131"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Upgrade-Insecure-Requests": "1",
      },
      redirect: "follow",
    });
    const body = await resp.text();
    const ct = resp.headers.get("content-type") || "text/html";
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(resp.status).send(body);
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
