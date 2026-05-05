#!/bin/bash
# Copy web assets into www/ for Capacitor bundling.
# Run before `npx cap sync ios`.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WWW="$ROOT/www"

rm -rf "$WWW"
mkdir -p "$WWW"

cp "$ROOT/index.html"   "$WWW/"
cp "$ROOT/ios-frame.jsx" "$WWW/"
cp -R "$ROOT/image"     "$WWW/"

echo "✓ www/ rebuilt"
ls -la "$WWW"
