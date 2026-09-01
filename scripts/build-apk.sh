#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS="$ROOT/android/app/src/main/assets/nodejs-project"
rm -rf "$ASSETS"
mkdir -p "$ASSETS"
cp -a "$ROOT"/*.js "$ROOT"/lib "$ROOT"/public "$ROOT"/package.json "$ROOT"/package-lock.json "$ROOT"/node_modules "$ASSETS/"
cd "$ROOT/android"
if [ -x ./gradlew ]; then ./gradlew assembleDebug; else gradle assembleDebug; fi
