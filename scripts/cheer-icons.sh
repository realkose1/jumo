#!/bin/bash
# 응원 주막 홈 화면 아이콘(PNG)을 cheer-src/web/public/icon.svg 에서 뽑는다. macOS sips 로 그린다.
#   bash scripts/cheer-icons.sh
# 아이콘 그림을 바꾼 뒤 한 번 돌리고, 바뀐 PNG 를 같이 커밋한다(빌드하면 cheer/ 로 복사된다).
set -euo pipefail
cd "$(dirname "$0")/../cheer-src/web/public"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
sips -s format png icon.svg --out "$tmp/icon-1024.png" >/dev/null
sips -Z 512 "$tmp/icon-1024.png" --out icon-512.png >/dev/null
sips -Z 192 "$tmp/icon-1024.png" --out icon-192.png >/dev/null
sips -Z 180 "$tmp/icon-1024.png" --out apple-touch-icon.png >/dev/null
sips -Z 32 "$tmp/icon-1024.png" --out favicon-32.png >/dev/null
ls -l icon-512.png icon-192.png apple-touch-icon.png favicon-32.png
