// index.html 한 파일에서 OTA 산출물을 뽑아내는 공통 로직.
//
// www 빌드(scripts/build-www.mjs)와 Vercel OTA 빌드(scripts/build-ota.mjs)가
// **같은 함수**를 쓰게 해서, 앱에 박히는 번들 버전과 원격 버전이 같은 규칙으로
// 계산되도록 한다. 둘이 갈라지면 앱이 자기 자신을 계속 업데이트하려 든다.

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

// 빌드 타임 전용 트랜스파일러 (www/ 에도 ota/ 에도 실려나가지 않는다)
const Babel = require('./vendor/babel.min.js');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);

export function otaParts() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  const OPEN = '<script type="text/babel">';
  const openIdx = html.indexOf(OPEN);
  if (openIdx === -1) throw new Error('inline <script type="text/babel"> block not found');
  const contentStart = openIdx + OPEN.length;
  const closeIdx = html.indexOf('</script>', contentStart);
  if (closeIdx === -1) throw new Error('closing </script> for inline app block not found');
  const appCode = html.slice(contentStart, closeIdx);
  const blockEnd = closeIdx + '</script>'.length;

  const appJs = Babel.transform(appCode, { presets: ['react'], filename: 'app.jsx' }).code;

  // 셸 = 앱 코드를 걷어낸 나머지 HTML(스타일·메타·vendor 스크립트 태그…).
  // OTA 로는 app.js 만 나른다 — 셸이 바뀌면 원격 번들이 맞지 않으므로 적용하지
  // 않고 네이티브 빌드를 기다린다. 이 해시가 그 판단 기준이다.
  const shell = sha(html.slice(0, openIdx) + html.slice(blockEnd));

  return { html, openIdx, blockEnd, appJs, version: { v: sha(appJs), shell } };
}

// 앱에 박히는 OTA 로더. www/index.html 에서 `<script src="app.js">` 자리를 대신한다.
// 저장소 루트 index.html(웹/Vercel 용)에는 절대 들어가지 않는다.
export function otaLoader(remote, bundled) {
  return `<script>/* jumo OTA loader */
(function () {
  var REMOTE = ${JSON.stringify(remote)};
  var B = ${JSON.stringify(bundled)};
  var LS; try { LS = window.localStorage; } catch (e) { LS = null; }
  var K = { v:'jumo.ota.v', code:'jumo.ota.code', shell:'jumo.ota.shell', boot:'jumo.ota.boot' };
  function get(k) { try { return LS && LS.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { LS && LS.setItem(k, v); } catch (e) {} }
  function del(k) { try { LS && LS.removeItem(k); } catch (e) {} }
  function drop() { del(K.v); del(K.code); del(K.shell); del(K.boot); }

  // 지난 실행이 OTA 번들로 시작했는데 화면을 끝내 못 그렸다면 부팅 표식이 남는다.
  // 그 번들은 깨진 것으로 보고 버린다 → 다음 실행은 번들 사본으로 자동 복구.
  if (get(K.boot) === '1') drop();

  var code = null;
  if (get(K.v) && get(K.v) !== B.v && get(K.shell) === B.shell) code = get(K.code);

  function runBundled() {
    var s = document.createElement('script');
    s.src = 'app.js';
    document.body.appendChild(s);
  }
  function runOta(src) {
    set(K.boot, '1');
    var s = document.createElement('script');
    s.textContent = src;
    document.body.appendChild(s);
    setTimeout(function () {
      var r = document.getElementById('root');
      if (r && r.childElementCount > 0) del(K.boot);   // 정상 렌더 확인 → 표식 해제
    }, 6000);
  }

  function fetchLatest() {
    if (!LS) return;
    fetch(REMOTE + '/ota/version.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) {
        if (!m || !m.v) return;
        if (m.shell !== B.shell) { drop(); return; }  // 셸이 달라짐 → 네이티브 빌드 필요
        if (m.v === B.v) { drop(); return; }          // 번들이 이미 최신 (빌드가 따라잡음)
        if (m.v === get(K.v)) return;                 // 이미 받아둠
        return fetch(REMOTE + '/ota/app.js?v=' + m.v)
          .then(function (r) { return r.ok ? r.text() : null; })
          .then(function (src) {
            if (!src || src.length < 100000) return;  // 잘린/에러 응답 방어
            set(K.code, src); set(K.v, m.v); set(K.shell, m.shell);
          });
      })
      .catch(function () {});
  }

  function boot() {
    if (code) runOta(code); else runBundled();
    // 최신 번들은 배경에서 받아 '다음 실행'에 쓴다. 이번 부팅은 기다리지 않으므로
    // 콜드 스타트가 느려지지 않고, 오프라인이어도 그대로 뜬다.
    setTimeout(fetchLatest, 3000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
</script>`;
}
