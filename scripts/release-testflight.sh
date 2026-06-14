#!/bin/bash
# TestFlight 업로드 자동화 — Xcode GUI/computer-use 없이 CLI로 빌드·아카이브·업로드.
#
# 인증: Xcode에 로그인된 App Store Connect 계정 세션을 그대로 사용한다
#       (별도 App Store Connect API 키 불필요). Xcode → Settings → Accounts 에
#       Apple ID가 로그인돼 있어야 한다.
#
# 사용:  bash scripts/release-testflight.sh
#        → 웹 빌드 → iOS 동기화 → 빌드 번호 +1 → 아카이브 → TestFlight 업로드
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
PBX="ios/App/App.xcodeproj/project.pbxproj"

echo "▶ 1/4 웹 자산 빌드 (index.html → www/)"
npm run build >/dev/null

echo "▶ 2/4 iOS 동기화 + 빌드 번호 증가"
npx cap copy ios >/dev/null
CUR=$(grep -m1 'CURRENT_PROJECT_VERSION = ' "$PBX" | grep -o '[0-9]\+')
NEXT=$((CUR + 1))
sed -i '' "s/CURRENT_PROJECT_VERSION = $CUR;/CURRENT_PROJECT_VERSION = $NEXT;/g" "$PBX"
echo "   빌드 번호 $CUR → $NEXT"

echo "▶ 3/4 아카이브 (Release, 자동 서명)"
xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/App.xcarchive \
  -allowProvisioningUpdates clean archive >/dev/null
echo "   아카이브 완료"

echo "▶ 4/4 TestFlight 업로드"
xcodebuild -exportArchive -archivePath build/App.xcarchive \
  -exportOptionsPlist scripts/ExportOptions.plist -allowProvisioningUpdates

echo ""
echo "✅ 빌드 $NEXT 업로드 완료 — App Store Connect 처리(5~15분) 후 TestFlight에 표시됩니다."
echo "   빌드 번호 커밋:  git commit -am \"빌드 번호 ${NEXT}로 (TestFlight 업로드)\""
