const { spawn } = require("node:child_process");
const { platform } = require("node:process");
const path = require("node:path");

const port = process.env.PORT || "7000";
const child = spawn(process.execPath, ["src/server.js"], {
  cwd: path.resolve(__dirname, ".."),
  env: { ...process.env, LOCAL_MODE: "true", BIND_HOST: process.env.BIND_HOST || "0.0.0.0", PORT: port },
  stdio: "inherit"
});

const url = `http://localhost:${port}/`;
const openCommand = platform === "win32" ? "start" : platform === "darwin" ? "open" : "xdg-open";
setTimeout(() => {
  const opener = spawn(openCommand, [url], {
    stdio: "ignore",
    shell: platform === "win32",
    detached: true
  });
  opener.unref();
}, 1200);

child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
