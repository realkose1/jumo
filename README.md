# Jumo - 한국 선수 스포츠 앱

실시간 한국 선수 경기 정보를 제공하는 웹 애플리케이션

## 🚀 배포 방법

### 방법 1: Netlify (추천 - 가장 간단)

1. [Netlify](https://app.netlify.com/drop) 접속
2. `jumo` 폴더를 드래그 앤 드롭
3. 즉시 배포 완료! (https://your-site.netlify.app)

**장점:**
- 무료 (월 100GB 대역폭)
- HTTPS 자동 적용
- 커스텀 도메인 연결 가능
- 자동 배포 가능

### 방법 2: Vercel

1. [Vercel](https://vercel.com) 가입
2. `New Project` 클릭
3. `jumo` 폴더 업로드
4. 배포 완료

### 방법 3: GitHub Pages

1. GitHub 저장소 생성
2. 파일 업로드
3. Settings → Pages → Branch 선택
4. https://username.github.io/jumo 에서 접속

### 방법 4: Cloudflare Pages

1. [Cloudflare Pages](https://pages.cloudflare.com) 접속
2. `Create a project` 클릭
3. 파일 업로드
4. 배포 완료

## 📁 배포 파일 구조

```
jumo/
├── Jumo App.html       # 메인 애플리케이션
├── ios-frame.jsx       # iOS 프레임 컴포넌트
├── api-proxy.js        # API 프록시 (선택사항)
├── index.html          # 리다이렉트 파일
├── _redirects          # Netlify 리다이렉트 설정
└── image/              # 선수 프로필 이미지
    ├── heungmin.png
    ├── kangin.png
    ├── minjae.png
    ├── hyungyu.png
    ├── hyunjun.png
    └── ...
```

## 🔧 환경 변수 (필요시)

ESPN API는 직접 호출하므로 별도 API 키가 필요 없습니다.

## 🌐 커스텀 도메인 연결

Netlify/Vercel에서:
1. Domain settings 접속
2. 도메인 추가
3. DNS 설정 (CNAME 레코드)
4. SSL 자동 적용

## 📱 PWA 설치 가능하게 만들기

`manifest.json` 추가:

```json
{
  "name": "Jumo",
  "short_name": "Jumo",
  "description": "한국 선수 스포츠 앱",
  "start_url": "/",
  "display": "standalone",
  "theme_color": "#e03030",
  "background_color": "#0b0b0d",
  "icons": [
    {
      "src": "icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

## 🔄 업데이트 방법

### Netlify:
- 새 버전 드래그 앤 드롭하면 자동 교체

### GitHub Pages:
- 파일 커밋 & 푸시하면 자동 배포

## 💡 팁

- **성능 최적화**: 이미지를 WebP로 변환하면 로딩 속도 향상
- **캐싱**: Netlify/Vercel이 자동으로 처리
- **모니터링**: Netlify Analytics로 트래픽 확인 가능
