#!/bin/bash
# Build www/ for Capacitor iOS bundling (Apple 2.5.2 compliant).
# Precompiles the app at build time so the native bundle ships NO remote CDN code.
# Run before `npx cap sync ios`.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

node "$ROOT/scripts/build-www.mjs"

echo "✓ www/ rebuilt"
ls -la "$ROOT/www"
