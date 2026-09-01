const os = require("node:os");

function getLocalIPv4() {
  if (process.env.LAN_HOST) return process.env.LAN_HOST;
  const interfaces = os.networkInterfaces();
  const candidates = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) candidates.push(entry.address);
    }
  }
  return candidates.find((ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(ip))
    || candidates.find((ip) => !/^169\.254\./.test(ip))
    || "127.0.0.1";
}

function getLocalBaseUrl(port = process.env.PORT || 7000) {
  return `http://${getLocalIPv4()}:${port}`;
}

module.exports = { getLocalIPv4, getLocalBaseUrl };
