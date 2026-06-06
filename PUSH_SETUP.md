# Jumo 앱 푸시 알림(APNs) 설정 가이드

코드는 모두 구현되어 있습니다. 아래 **외부 설정 5단계**만 마치면 실기기에서
경기 시작 / 골 / 결과 알림이 푸시로 전달됩니다.

구성 요약
- 클라이언트(`index.html`): 실기기에서 APNs 등록 → 토큰 + 팔로우 선수 id를
  Supabase `device_tokens`에 저장. (`@capacitor/push-notifications`)
- iOS 네이티브: `App.entitlements`(aps-environment), `AppDelegate` 토큰 전달,
  Push Notifications capability.
- 백엔드(`api/push-cron.js`): 2분마다 ESPN/StatsAPI에서 한국 선수 이벤트 감지
  → `push_log`로 중복 방지 → 해당 선수 팔로워 토큰으로 APNs 발송. (Vercel Cron)

---

## 1) APNs 인증 키(.p8) 생성  ← 직접 하셔야 합니다
Apple Developer → **Certificates, IDs & Profiles → Keys → +**
- 이름 입력, **Apple Push Notifications service (APNs)** 체크 → Continue → Register
- **AuthKey_XXXXXXXXXX.p8** 다운로드(한 번만 가능) + **Key ID**(10자) 기록
- **Team ID**: `P7ZN2XXS75`

## 2) App ID에 Push 권한 활성화
Identifiers → `com.realkose.jumo` → **Push Notifications** 체크 → Save
(아카이브 시 `-allowProvisioningUpdates`로 자동 추가될 수도 있지만, 수동 확인 권장)

## 3) Supabase 테이블 생성
Supabase → SQL Editor에서 `db/push.sql` 실행 (device_tokens, push_log).

## 4) Vercel 환경변수 (Project → Settings → Environment Variables)
| 변수 | 값 |
|---|---|
| `APNS_KEY` | .p8 파일 **내용 전체** (BEGIN/END 포함, 줄바꿈 그대로 또는 `\n`) |
| `APNS_KEY_ID` | 1단계 Key ID |
| `APNS_TEAM_ID` | `P7ZN2XXS75` |
| `APNS_BUNDLE_ID` | `com.realkose.jumo` |
| `APNS_HOST` | `api.push.apple.com` (TestFlight/배포). 샌드박스 테스트 시 `api.sandbox.push.apple.com` |
| `SUPABASE_URL` | `https://pxchmolcruhxbmvomsyy.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase **service_role** 키 (서버 전용, 노출 금지) |
| `PUSH_CRON_SECRET` | (선택) 수동 호출 보호용 임의 문자열 |

> **Cron 주기**: `vercel.json`에 `*/2 * * * *`(2분) 설정. 잦은 실행은 **Vercel Pro**
> 플랜이 필요해요(Hobby는 하루 1회 제한). Pro가 아니면 골 알림은 지연될 수 있어,
> 그 경우 외부 크론(GitHub Actions/cron-job.org)으로 `/api/push-cron?secret=...`를
> 호출하는 방식으로 대체 가능합니다.

## 5) 배포 + 빌드 업로드 + 테스트
- `git push` → Vercel 자동 배포(크론 등록).
- 다음 TestFlight 빌드(푸시 entitlement 포함)를 업로드 → 실기기 설치.
- 앱 첫 실행 시 **알림 권한 요청** 수락 → Supabase `device_tokens`에 토큰 row 생성 확인.
- 한국 선수 경기가 진행될 때(또는 수동으로 `/api/push-cron?secret=...` 호출) 푸시 도착 확인.

---

### 참고 / 한계
- 푸시는 **실기기에서만** 동작(시뮬레이터 불가).
- `aps-environment`는 **production**(TestFlight/배포 기준). Xcode 디버그 빌드로
  기기 테스트하려면 entitlement를 `development` + `APNS_HOST`를 sandbox로.
- 현재 크론이 감지하는 이벤트: 축구(경기 시작/골/결과), 야구(경기 시작/결과).
  세분화(도움·교체·라인업 등)는 `api/push-cron.js`의 `collectSoccer/collectBaseball`에
  추가하면 됩니다.
- 만료/무효 토큰(APNs 410)은 추후 `push_log`/`device_tokens` 정리 로직으로 보강 가능.
