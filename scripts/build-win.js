const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const os = require("node:os");
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist", "win-x64");
const exeName = "avmirror-windows_26.1.0.exe";
const chromiumDir = path.join(dist, "chromium");
const chromiumExe = path.join(chromiumDir, "chrome-win", "chrome.exe");
const appDir = path.join(dist, "app");
const nodeDir = path.join(dist, "node-runtime");

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
cp.execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["@yao-pkg/pkg", "scripts/auto-update.js", "--targets", "node22-win-x64", "--output", path.join(dist, exeName)], { cwd: root, stdio: "inherit" });
fs.mkdirSync(appDir, { recursive: true });
for (const entry of fs.readdirSync(root)) {
  if (["dist", ".git", "node_modules"].includes(entry)) continue;
  const source = path.join(root, entry);
  const target = path.join(appDir, entry);
  fs.cpSync(source, target, { recursive: true });
}
if (fs.existsSync(path.join(root, "node_modules"))) fs.cpSync(path.join(root, "node_modules"), path.join(appDir, "node_modules"), { recursive: true });
const nodeArchive = path.join(os.tmpdir(), "avmirror-node-win-x64.zip");
if (!fs.existsSync(path.join(nodeDir, "node.exe"))) {
  const nodeUrl = "https://nodejs.org/dist/v22.19.0/node-v22.19.0-win-x64.zip";
  cp.execFileSync(process.platform === "win32" ? "powershell.exe" : "wget", process.platform === "win32" ? ["-NoProfile", "-Command", `Invoke-WebRequest -Uri '${nodeUrl}' -OutFile '${nodeArchive}'`] : ["-q", "-O", nodeArchive, nodeUrl], { stdio: "inherit" });
  fs.mkdirSync(nodeDir, { recursive: true });
  cp.execFileSync(process.platform === "win32" ? "powershell.exe" : "unzip", process.platform === "win32" ? ["-NoProfile", "-Command", `Expand-Archive -Force '${nodeArchive}' '${nodeDir}'`] : ["-q", nodeArchive, "-d", nodeDir], { stdio: "inherit" });
  if (!fs.existsSync(path.join(nodeDir, "node.exe"))) { const nested = fs.readdirSync(nodeDir).find(name => name.startsWith("node-v")); if (nested) fs.cpSync(path.join(nodeDir, nested), nodeDir, { recursive: true }); }
}
if (!fs.existsSync(chromiumExe)) {
  const archive = path.join(os.tmpdir(), "avmirror-chromium-win64.zip");
  const url = "https://cdn.playwright.dev/dbazure/download/playwright/builds/chromium/1193/chromium-win64.zip";
  cp.execFileSync(process.platform === "win32" ? "powershell.exe" : "wget", process.platform === "win32" ? ["-NoProfile", "-Command", `Invoke-WebRequest -Uri '${url}' -OutFile '${archive}'`] : ["-q", "-O", archive, url], { stdio: "inherit" });
  fs.mkdirSync(chromiumDir, { recursive: true });
  if (process.platform === "win32") cp.execFileSync("powershell.exe", ["-NoProfile", "-Command", `Expand-Archive -Force '${archive}' '${chromiumDir}'`], { stdio: "inherit" });
  else cp.execFileSync("unzip", ["-q", archive, "-d", chromiumDir], { stdio: "inherit" });
}
fs.copyFileSync(path.join(root, "scripts", "windows", "install.ps1"), path.join(dist, "install.ps1"));
console.log(`Windows bundle written to ${dist}`);
