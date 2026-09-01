#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist/deb"
PKG="$OUT/avmirror-local"
VERSION="${VERSION:-26.1.0}"
rm -rf "$OUT"
mkdir -p "$PKG/opt/avmirror" "$PKG/usr/bin" "$PKG/etc/systemd/system" "$PKG/DEBIAN"
cp -a "$ROOT"/*.js "$ROOT"/package.json "$ROOT"/package-lock.json "$PKG/opt/avmirror/"
cp -a "$ROOT"/node_modules "$PKG/opt/avmirror/"
cat > "$PKG/usr/bin/avmirror-local" <<'EOF'
#!/bin/sh
exec /usr/bin/node /opt/avmirror/scripts/start-local.js
EOF
chmod 0755 "$PKG/usr/bin/avmirror-local"
cat > "$PKG/etc/systemd/system/avmirror-local.service" <<'EOF'
[Unit]
Description=AVMirror local Stremio addon
After=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/node /opt/avmirror/scripts/start-local.js
WorkingDirectory=/opt/avmirror
Restart=on-failure
Environment=LOCAL_MODE=true
Environment=BIND_HOST=127.0.0.1
Environment=PORT=7000

[Install]
WantedBy=default.target
EOF
cat > "$PKG/DEBIAN/control" <<EOF
Package: avmirror-local
Version: $VERSION
Section: net
Priority: optional
Architecture: amd64
Depends: nodejs (>= 20)
Maintainer: AVMirror
Description: Local AVMirror Stremio addon with device-local HLS proxy
EOF
mkdir -p "$ROOT/dist"
dpkg-deb --build "$PKG" "$ROOT/dist/avmirror-local_${VERSION}_amd64.deb"
printf '%s\n' "$ROOT/dist/avmirror-local_${VERSION}_amd64.deb"

