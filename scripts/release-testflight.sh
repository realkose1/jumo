#!/bin/bash
# TestFlight 업로드 자동화 — Xcode GUI/computer-use 없이 CLI로 빌드·아카이브·업로드.
#
# 인증 (둘 중 하나):
#  1) App Store Connect API 키 — 권장. Xcode 로그인 상태와 무관하게 항상 동작한다.
#     Xcode 계정 세션은 주기적으로 만료돼 "Failed to Use Accounts"로 업로드가
#     막히는 일이 반복됐다(2026-07 세 차례).
#       ~/private_keys/AuthKey_XXXXXXXXXX.p8  파일을 두고
#       export ASC_KEY_ID=XXXXXXXXXX ASC_ISSUER_ID=<issuer-uuid>
#     App Store Connect → 사용자 및 액세스 → 통합 → App Store Connect API 에서 발급.
#  2) 위 값이 없으면 기존처럼 Xcode에 로그인된 계정 세션을 사용한다
#     (Xcode → Settings → Accounts 에 Apple ID가 등록돼 있어야 함).
#
# 사용:  bash scripts/release-testflight.sh
#        → 웹 빌드 → iOS 동기화 → 빌드 번호 +1 → 아카이브 → TestFlight 업로드
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
PBX="ios/App/App.xcodeproj/project.pbxproj"

# API 키가 준비돼 있으면 그 인증을 쓴다.
AUTH_ARGS=()
if [ -n "$ASC_KEY_ID" ] && [ -n "$ASC_ISSUER_ID" ]; then
  KEY_PATH=""
  for d in "$HOME/private_keys" "$HOME/.appstoreconnect/private_keys" "$HOME/.private_keys"; do
    [ -f "$d/AuthKey_${ASC_KEY_ID}.p8" ] && KEY_PATH="$d/AuthKey_${ASC_KEY_ID}.p8" && break
  done
  if [ -n "$KEY_PATH" ]; then
    AUTH_ARGS=(-authenticationKeyPath "$KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
    echo "🔑 App Store Connect API 키 인증 사용 ($KEY_PATH)"
  else
    echo "⚠️  ASC_KEY_ID는 설정됐지만 AuthKey_${ASC_KEY_ID}.p8 파일을 찾지 못했습니다 → Xcode 계정 세션으로 진행"
  fi
fi

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
  -exportOptionsPlist scripts/ExportOptions.plist -allowProvisioningUpdates \
  "${AUTH_ARGS[@]}"

echo ""
echo "✅ 빌드 $NEXT 업로드 완료 — App Store Connect 처리(5~15분) 후 TestFlight에 표시됩니다."
echo "   빌드 번호 커밋:  git commit -am \"빌드 번호 ${NEXT}로 (TestFlight 업로드)\""
