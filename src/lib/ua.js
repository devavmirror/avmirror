const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

function maskDomain(url) {
  try {
    return new URL(url).hostname.replace(/[a-z]{3,}/g, "***");
  } catch { return "***"; }
}

function maskError(msg) {
  return String(msg || "").replace(/https?:\/\/[^\s"']+/g, (u) => {
    try { const h = new URL(u).hostname; return h.replace(/[a-z]{4,}/g, "***"); } catch { return "***"; }
  });
}

module.exports = { UA, maskDomain, maskError };
