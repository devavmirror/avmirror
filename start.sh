#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

VERSION="26.1.0"
PORT="${PORT:-7000}"

pkill -f "node src/server.js" 2>/dev/null || true
sleep 1
nohup env PORT="$PORT" LOCAL_MODE=false node src/server.js > /tmp/avmirror.log 2>&1 &
PID=$!
disown "$PID" 2>/dev/null || true

echo "AVMirror Linux ${VERSION} iniciado"
echo "PID: ${PID}"
sleep 2
curl --fail --silent "http://127.0.0.1:${PORT}/health"
printf '\n'
