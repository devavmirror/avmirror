#!/bin/bash
cd "$(dirname "$0")"
pkill -f "node src/server.js" 2>/dev/null
sleep 1
nohup node src/server.js > /tmp/avmirror.log 2>&1 &
disown
echo "AVMirror PID: $!"
sleep 2
curl -s http://localhost:7000/health
