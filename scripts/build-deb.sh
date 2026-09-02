#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist/deb"
PKG="$OUT/avmirror-local"
VERSION="${VERSION:-26.1.2}"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
rm -rf "$OUT"
mkdir -p "$PKG/opt/avmirror/app" "$PKG/opt/avmirror/node" "$PKG/opt/avmirror/chromium" "$PKG/usr/bin" "$PKG/usr/share/applications" "$PKG/etc/systemd/system" "$PKG/DEBIAN"
cp -a "$ROOT"/*.js "$ROOT"/lib "$ROOT"/public "$ROOT"/scripts "$ROOT"/package.json "$ROOT"/package-lock.json "$PKG/opt/avmirror/app/"
[ -d "$ROOT/node_modules" ] && cp -a "$ROOT/node_modules" "$PKG/opt/avmirror/app/"
cp -L "$NODE_BIN" "$PKG/opt/avmirror/node/node"
if [ ! -x "$HOME/.cache/ms-playwright/chromium_headless_shell-1193/chrome-linux/headless_shell" ]; then
  PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright" npx playwright install chromium
fi
mkdir -p "$PKG/opt/avmirror/chromium/chrome-linux"
cp -a "$HOME/.cache/ms-playwright/chromium_headless_shell-1193/chrome-linux/." "$PKG/opt/avmirror/chromium/chrome-linux/"
cat > "$PKG/usr/bin/avmirror-local" <<'EOF'
#!/bin/sh
export AVMIRROR_ROOT=/opt/avmirror
exec /opt/avmirror/node/node /opt/avmirror/app/scripts/auto-update.js
EOF
chmod 0755 "$PKG/usr/bin/avmirror-local"
cp "$ROOT/packaging/systemd/avmirror.service" "$PKG/etc/systemd/system/avmirror.service"
cp "$ROOT/packaging/avmirror.desktop" "$PKG/usr/share/applications/avmirror.desktop"
cp "$ROOT/packaging/avmirror-local-open" "$PKG/usr/bin/avmirror-local-open"
chmod 0755 "$PKG/usr/bin/avmirror-local-open"
cat > "$PKG/DEBIAN/control" <<EOF
Package: avmirror-local
Version: $VERSION
Section: net
Priority: optional
Architecture: amd64
Depends: libc6 (>= 2.35)
Maintainer: AVMirror
Description: Local AVMirror Stremio addon with LAN HLS proxy
EOF
cat > "$PKG/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
systemctl daemon-reload || true
systemctl enable avmirror.service || true
systemctl start avmirror.service || systemctl restart avmirror.service || true
EOF
chmod 0755 "$PKG/DEBIAN/postinst"
mkdir -p "$ROOT/dist"
dpkg-deb --build "$PKG" "$ROOT/dist/avmirror-linux_${VERSION}_amd64.deb"
printf '%s\n' "$ROOT/dist/avmirror-linux_${VERSION}_amd64.deb"
