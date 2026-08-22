// Vercel 배포 시 실행 — 앱이 받아갈 OTA 번들을 ota/ 로 낸다.
//
//   ota/app.js        트랜스파일된 앱 코드 (앱 번들의 app.js 와 동일한 산출물)
//   ota/version.json  { v, shell } — 앱 로더가 갱신 여부를 판단하는 기준
//
// node_modules 없이 돌아간다(빌트인 + 커밋된 scripts/vendor/babel.min.js).
// 그래서 vercel.json 의 installCommand 를 그대로 no-op 으로 둘 수 있다.

import path from 'path';
import fs from 'fs';
import { ROOT, otaParts } from './ota-parts.mjs';

const { appJs, version } = otaParts();
const OUT = path.join(ROOT, 'ota');

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'app.js'), appJs);
fs.writeFileSync(path.join(OUT, 'version.json'), JSON.stringify(version));

console.log(`✓ ota/ built — v=${version.v} shell=${version.shell} (${(appJs.length / 1024).toFixed(0)}KB)`);
