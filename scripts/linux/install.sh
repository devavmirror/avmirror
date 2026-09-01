#!/usr/bin/env bash
set -euo pipefail
ARTIFACT_URL="${AVMIRROR_LINUX_URL:-${1:-}}"
if [ -z "$ARTIFACT_URL" ]; then
  echo 'Uso: AVMIRROR_LINUX_URL=https://.../avmirror-linux_26.1.0_amd64.deb bash install.sh' >&2
  exit 2
fi
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi
TMP="$(mktemp --suffix=.deb)"
trap 'rm -f "$TMP"' EXIT
curl --fail --location --silent --show-error "$ARTIFACT_URL" --output "$TMP"
[ -s "$TMP" ] || { echo 'Download vazio.' >&2; exit 1; }
$SUDO dpkg -i "$TMP" || $SUDO apt-get install -f -y
$SUDO systemctl daemon-reload
$SUDO systemctl enable --now avmirror.service
if command -v ufw >/dev/null 2>&1; then $SUDO ufw allow 7000/tcp || true; fi
IP="$(hostname -I 2>/dev/null | tr ' ' '\n' | awk '/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/{print; exit}')"
IP="${IP:-localhost}"
echo "AVMirror ativo: http://localhost:7000/"
echo "Acesso na rede: http://${IP}:7000/"
