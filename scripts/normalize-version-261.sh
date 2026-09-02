#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
files=(package.json package-lock.json server.js nuvio/manifest.json android/app/build.gradle scripts/build-win.js scripts/build-deb.sh scripts/build-apk.sh scripts/windows/install.ps1 scripts/linux/install.sh public/install.html README.md nuvio/README.md)
for file in "${files[@]}"; do
  sed -i -E 's/26\.1\.[0-9]+/26.1/g' "$file"
done
# The release tag is technical distribution metadata and remains v26.1.3.
# Restore release URLs changed by the broad documentation replacement.
sed -i 's#releases/download/v26.1/#releases/download/v26.1.3/#g' public/install.html
