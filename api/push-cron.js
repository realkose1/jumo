// Vercel Cron → APNs push sender for Jumo.
//
// Detects events for the Korean players (match start, goal/assist/card by a
// Korean player, final result) from the same sources the app uses —
// API-Football for soccer (covers friendlies & cups that ESPN league
// scoreboards miss; exact player-ID event attribution), MLB StatsAPI for
// baseball — de-duplicates them against a Supabase `push_log` table, and
// delivers an APNs alert to every device whose followed players are involved.
// Asian Games national-team matches (NATIONAL_TEAMS) are the exception: no
// per-player notifications go out for them — instead every Korea goal and the
// final result are broadcast to all devices (see nationalMatchEvents()).
//
// Required env vars (Vercel → Project → Settings → Environment Variables):
//   APIFOOTBALL_KEY same key the /api/apifootball proxy uses (soccer detection)
//   APNS_KEY        contents of the AuthKey_XXXX.p8 (with real newlines or \n)
//   APNS_KEY_ID     the 10-char Key ID of that key
//   APNS_TEAM_ID    your Apple Developer Team ID (P7ZN2XXS75)
//   APNS_BUNDLE_ID  com.realkose.jumo
//   APNS_HOST       api.push.apple.com  (sandbox: api.sandbox.push.apple.com)
//   SUPABASE_URL            https://pxchmolcruhxbmvomsyy.supabase.co
//   SUPABASE_SERVICE_KEY    Supabase service_role key (server-side only)
//   PUSH_CRON_SECRET        optional shared secret to gate manual calls
//
// Schedule it in vercel.json (see repo). Tables: see db/push.sql.

const http2 = require('http2');
const crypto = require('crypto');

// ── Korean player registry (mirror of the app's ALL_PLAYERS) ────────────────
// afTeamId / afPlayerId: API-Football team & player ids — fixtures are matched by
// team id and goals/cards by player id (exact; no fuzzy name matching).
const PLAYERS = [
  { id: 1,  name: '손흥민', nameEn: 'Son Heung-min', sport: 'soccer', team: 'LAFC',        afTeamId: 1616, afPlayerId: 186, espnLeague: 'usa.1', espnTeamId: 18966 },
  { id: 2,  name: '이강인', nameEn: 'Lee Kang-in', sport: 'soccer', team: 'Atletico',    afTeamId: 530,  afPlayerId: 927, espnLeague: 'esp.1', espnTeamId: 1068 },
  { id: 3,  name: '김민재', nameEn: 'Kim Min-jae', sport: 'soccer', team: 'Bayern',      afTeamId: 157,  afPlayerId: 2897, espnLeague: 'ger.1', espnTeamId: 132 },
  { id: 6,  name: '황희찬', nameEn: 'Hwang Hee-chan', sport: 'soccer', team: 'Schalke',     afTeamId: 174,  afPlayerId: 24888, espnLeague: 'ger.1', espnTeamId: 133 },
  { id: 7,  name: '황인범', nameEn: 'Hwang In-beom', sport: 'soccer', team: 'Porto',       afTeamId: 212,  afPlayerId: 2901, espnLeague: 'por.1', espnTeamId: 437 },
  { id: 8,  name: '조규성', nameEn: 'Cho Gue-sung', sport: 'soccer', team: 'Midtjylland', afTeamId: 397,  afPlayerId: 34211, espnLeague: 'den.1', espnTeamId: 572 },
  { id: 25, name: '이한범', nameEn: 'Lee Han-Beom', sport: 'soccer', team: 'Club Brugge', afTeamId: 569,  afPlayerId: 237218, espnLeague: 'bel.1', espnTeamId: 570 },
  { id: 19, name: '오현규', nameEn: 'Oh Hyeon-gyu', sport: 'soccer', team: 'Besiktas',    afTeamId: 549,  afPlayerId: 34710, espnLeague: 'tur.1', espnTeamId: 1895 },
  { id: 20, name: '양현준', nameEn: 'Yang Hyun-jun', sport: 'soccer', team: 'Celtic',      afTeamId: 247,  afPlayerId: 304958, espnLeague: 'sco.1', espnTeamId: 256 },
  { id: 21, name: '백승호', nameEn: 'Paik Seung-ho', sport: 'soccer', team: 'Birmingham',  afTeamId: 54,   afPlayerId: 2909, espnLeague: 'eng.2', espnTeamId: 392 },
  { id: 22, name: '배준호', nameEn: 'Bae Jun-ho', sport: 'soccer', team: 'Stoke',       afTeamId: 75,   afPlayerId: 357286, espnLeague: 'eng.2', espnTeamId: 336 },
  { id: 23, name: '엄지성', nameEn: 'Eom Ji-sung', sport: 'soccer', team: 'Swansea',     afTeamId: 76,   afPlayerId: 237050, espnLeague: 'eng.2', espnTeamId: 318 },
  { id: 24, name: '설영우', nameEn: 'Seol Young-woo', sport: 'soccer', team: 'Augsburg',    afTeamId: 170,  afPlayerId: 197985, espnLeague: 'ger.1', espnTeamId: 3841 },
  { id: 26, name: '이재성', nameEn: 'Lee Jae-sung', sport: 'soccer', team: 'Mainz',        afTeamId: 164,  afPlayerId: 2906, espnLeague: 'ger.1', espnTeamId: 2950 },
  { id: 27, name: '홍현석', nameEn: 'Hong Hyun-seok', sport: 'soccer', team: 'Midtjylland',  afTeamId: 397,  afPlayerId: 26519, espnLeague: 'den.1', espnTeamId: 572 },
  { id: 28, name: '정우영', nameEn: 'Jeong Woo-yeong', sport: 'soccer', team: 'Union Berlin', afTeamId: 182,  afPlayerId: 512, espnLeague: 'ger.1', espnTeamId: 598 },
  { id: 29, name: '카스트로프', nameEn: 'Jens Castrop', sport: 'soccer', team: 'Gladbach',   afTeamId: 163,  afPlayerId: 280358, espnLeague: 'ger.1', espnTeamId: 268 },
  { id: 30, name: '박승수', nameEn: 'Park Seung-soo', sport: 'soccer', team: 'Newcastle U21', afTeamId: 7199, afPlayerId: 423714, espnLeague: null, espnTeamId: null },
  { id: 31, name: '김지수', nameEn: 'Kim Ji-soo', sport: 'soccer', team: 'Brentford',    afTeamId: 55,   afPlayerId: 356237, espnLeague: 'eng.1', espnTeamId: 337 },
  { id: 32, name: '양민혁', nameEn: 'Yang Min-hyeok', sport: 'soccer', team: 'Westerlo',     afTeamId: 261,  afPlayerId: 423708, espnLeague: 'bel.1', espnTeamId: 606 },
  { id: 33, name: '이태석', nameEn: 'Lee Tae-seok', sport: 'soccer', team: 'Austria Wien', afTeamId: 601,  afPlayerId: 237220, espnLeague: 'aut.1', espnTeamId: 1382 },
  { id: 9,  name: '김하성', en: 'kim',       sport: 'baseball', team: 'Braves',      mlbTeam: 'Atlanta Braves', mlbId: 673490 },
  { id: 17, name: '이정후', en: 'lee',       sport: 'baseball', team: 'Giants',      mlbTeam: 'San Francisco Giants', mlbId: 808982 },
  { id: 18, name: '김혜성', en: 'kim',       sport: 'baseball', team: 'Dodgers',     mlbTeam: 'Los Angeles Dodgers', mlbId: 808975 },
  { id: 34, name: '송성문', en: 'song',      sport: 'baseball', team: 'Padres',      mlbTeam: 'San Diego Padres', mlbId: 823550 },
  { id: 35, name: '김민수', nameEn: 'Kim Min-su', sport: 'soccer', team: 'Rangers', afTeamId: 257, afPlayerId: 397941, espnLeague: 'sco.1', espnTeamId: 257 },
];

// 아시안게임 U23 대표팀(리그 803, 팀 10177 'Korea Republic U23'). 이 경기는 개인
// 라인업이 아니라 대표팀 소집 자체이고, 알림도 개인(출전/골/도움/카드)이 아니라
// 대한민국의 골·경기 결과를 팀 단위로 전원에게 방송한다(팔로우 여부 무관, 설정
// 'national' 로만 끔) — 그래서 더 이상 소집 선수 명단(playerIds)을 들고 있지
// 않는다. 방송 이벤트 생성은 아래 nationalMatchEvents() 참고.
const NATIONAL_TEAMS = { 10177: { name: '대한민국 U-23' } };
// 대표팀 경기의 vs 문구는 소속팀명이 아니라 대표팀명을 쓴다(예: 'Qatar U23 vs 대한민국 U-23').
const teamLabel = (team) => NATIONAL_TEAMS[team?.id]?.name || team?.name || '';

// 아시안게임 U23 대표팀 명단(KFA 등번호 발표 2026-09-14, id 는 API-Football 클럽
// 스쿼드 기준 2026-09-15). 김민승은 K3 소속이라 AF 에 색인이 안 돼 afId 가 없다 —
// 이런 선수는 agPlayerName() 이 정규화한 영문명으로만 매칭한다.
const AG_SQUAD = [
  { afId: 237229, name: '김준홍', nameEn: 'Kim Joon-Hong', number: 1, pos: 'GK' },
  { afId: null,   name: '김민승', nameEn: 'Kim Min-Seung', number: 12, pos: 'GK' },
  { afId: 237228, name: '이승환', nameEn: 'Lee Seung-Hwan', number: 21, pos: 'GK' },
  { afId: 472263, name: '강민준', nameEn: 'Kang Min-Jun', number: 2, pos: 'DF' },
  { afId: 403340, name: '최우진', nameEn: 'Choi Woo-Jin', number: 3, pos: 'DF' },
  { afId: 356197, name: '박성훈', nameEn: 'Park Seong-Hun', number: 4, pos: 'DF' },
  { afId: 356237, name: '김지수', nameEn: 'Kim Ji-Soo', number: 5, pos: 'DF' },
  { afId: 409426, name: '최석현', nameEn: 'Choi Seok-Hyun', number: 16, pos: 'DF' },
  { afId: 510885, name: '박경섭', nameEn: 'Park Kyung-Sub', number: 20, pos: 'DF' },
  { afId: 453266, name: '배현서', nameEn: 'Bae Hyun-Seo', number: 22, pos: 'DF' },
  { afId: 453969, name: '신민하', nameEn: 'Shin Min-Ha', number: 23, pos: 'DF' },
  { afId: 304951, name: '이기혁', nameEn: 'Lee Gi-Hyuk', number: 6, pos: 'MF' },
  { afId: 237050, name: '엄지성', nameEn: 'Eom Ji-Sung', number: 7, pos: 'MF' },
  { afId: 403349, name: '이승원', nameEn: 'Lee Seung-Won', number: 8, pos: 'MF' },
  { afId: 357286, name: '배준호', nameEn: 'Bae Jun-Ho', number: 10, pos: 'MF' },
  { afId: 304958, name: '양현준', nameEn: 'Yang Hyun-Jun', number: 11, pos: 'MF' },
  { afId: 363021, name: '강상윤', nameEn: 'Kang Sang-Yoon', number: 13, pos: 'MF' },
  { afId: 355171, name: '이현주', nameEn: 'Lee Hyun-Ju', number: 14, pos: 'MF' },
  { afId: 403353, name: '황도윤', nameEn: 'Hwang Do-Yoon', number: 15, pos: 'MF' },
  { afId: 423708, name: '양민혁', nameEn: 'Yang Min-Hyeok', number: 17, pos: 'MF' },
  { afId: 423714, name: '박승수', nameEn: 'Park Seung-Soo', number: 19, pos: 'MF' },
  { afId: 308648, name: '이영준', nameEn: 'Lee Young-Jun', number: 9, pos: 'FW' },
  { afId: 423711, name: '김명준', nameEn: 'M. Kim', number: 18, pos: 'FW' },
];
const normEnName = (s) => (s || '').toLowerCase().replace(/[^a-z]/g, '');
// AF 이벤트/라인업 선수 객체 → 아시안게임 명단 한글 이름. id 우선, 없으면(김민승처럼
// AF 색인이 안 된 선수) 정규화한 영문명으로, 그것도 안 맞으면 AF 원본 이름 그대로.
function agPlayerName(afPlayer) {
  const byId = AG_SQUAD.find((p) => p.afId != null && p.afId === afPlayer?.id);
  if (byId) return byId.name;
  const byName = AG_SQUAD.find((p) => normEnName(p.nameEn) === normEnName(afPlayer?.name));
  if (byName) return byName.name;
  return afPlayer?.name || '';
}

// 이벤트(골·도움·카드)가 낡았는지. 종료 경기 전체가 낡았거나(staleResult), 라이브
// 중인데 이벤트 시점이 현재 진행 시각보다 30분 넘게 과거거나(장애 복구 후 몰아보기),
// 킥오프+경기 분(후반은 하프타임 15분 가산)으로 어림한 이벤트 실제 시각이 지금보다
// 30분 넘게 과거면 낡았다. 마지막 조건은 배포·장애 직후 이미 끝난 경기의 골이
// 새 알림처럼 뒤늦게 나가는 것을 막는다(2026-09-15 대표팀 방송 배포 직후 사례).
function isStaleEvent(ev, { staleResult, isLive, elapsedNow, kickoffMs }) {
  if (staleResult) return true;
  const el = ev.time?.elapsed;
  if (el == null) return false;
  if (isLive && elapsedNow != null && elapsedNow - el > 30) return true;
  if (kickoffMs) {
    const evMs = kickoffMs + (el + (el > 45 ? 15 : 0)) * 60 * 1000;
    if (Date.now() - evMs > 30 * 60 * 1000) return true;
  }
  return false;
}

// 골/도움/카드/VAR취소 키를 이벤트 배열의 인덱스(i) 대신 (선수 또는 팀, 분)으로
// 만든다. API-Football 이 VAR로 취소된 골 이벤트를 배열에서 통째로 지우면 인덱스가
// 밀리면서 그 뒤 골들이 새 인덱스로 다시 '새 이벤트'처럼 잡혀 중복 알림이 나갔다 —
// 이제 인덱스에 의존하지 않는 안정 키를 쓴다. minuteKey() 는 분(추가시간 포함, 접미사
// 없음)만 돌려주고, stableKey() 가 같은 접두사가 이미 나온 횟수만큼 -2, -3 을 붙인다
// (같은 선수가 같은 분에 이벤트를 두 번 만드는 드문 경우 대비).
function minuteKey(ev) {
  return `${ev.time?.elapsed}${ev.time?.extra ? `+${ev.time.extra}` : ''}`;
}
function stableKey(prefix, counts) {
  const n = (counts.get(prefix) || 0) + 1;
  counts.set(prefix, n);
  return n === 1 ? prefix : `${prefix}-${n}`;
}
// API-Football 의 VAR 이벤트(type:'Var') 중 '골 취소'만 판정한다. 'Goal cancelled' /
// 'Goal Disallowed' 류만 잡고, 'Goal confirmed'/'Penalty confirmed'/'Penalty
// cancelled' 등은 취소된 골이 아니므로(또는 애초에 골이 아니므로) 제외한다.
function isVarGoalCancelled(detail) {
  return /goal (cancelled|disallowed)/i.test(detail || '');
}

// 대표팀 경기의 골·최종결과 방송 이벤트를 만든다. 순수 함수로 분리해 테스트하기
// 쉽게 한다 — 실제 발송 여부(silent)·대상(broadcast)은 호출부/센더가 결정한다.
function nationalMatchEvents({ fx, fid, evd, home, away, isLive, isFinal, elapsedNow, staleResult, kickoffMs }) {
  const out = [];
  const homeId = fx.teams?.home?.id, awayId = fx.teams?.away?.id;
  const tally = {}; // teamId → 누적 득점 (자책골 포함). VAR 로 취소돼도 여기서는 빼지
  // 않는다(4번: 근사치로 둔다 — 취소 반영은 fx.goals 로 오는 최종 스코어가 이미
  // 정확하므로 경기 종료 알림엔 영향 없고, 골 알림 본문의 중간 스코어만 아주 잠깐
  // 어긋날 수 있다).
  const keyCounts = new Map(); // 같은 접두사 중복 시 -2, -3 을 붙이기 위한 카운터
  (evd?.response || []).forEach((ev) => {
    if (ev.type === 'Var') {
      if (!isVarGoalCancelled(ev.detail)) return;
      const tid = ev.team?.id;
      if (!NATIONAL_TEAMS[tid]) return; // 상대팀 골 취소는 방송하지 않는다
      const min = minuteKey(ev);
      const scorer = ev.player?.id
        ? `${agPlayerName(ev.player) || PLAYERS.find((p) => p.afPlayerId === ev.player?.id)?.name || ev.player?.name || ''} `
        : '';
      const h = tally[homeId] || 0, a = tally[awayId] || 0;
      const staleEv = isStaleEvent(ev, { staleResult, isLive, elapsedNow, kickoffMs });
      out.push({
        key: stableKey(`af-nat-goalcancel-${fid}-${min}`, keyCounts), players: [],
        kind: 'national', broadcast: true, matchId: String(fid),
        title: '🇰🇷 대한민국 U-23 골 취소',
        body: `${min}' ${scorer}골이 VAR 판정으로 취소됐습니다. ${home} ${h} : ${a} ${away}`,
        silent: staleEv,
      });
      return;
    }
    if (ev.type !== 'Goal' || ev.detail === 'Missed Penalty') return;
    // API-Football 은 정상 골·자책골 모두 ev.team 을 '득점이 반영되는 팀'으로
    // 기록한다 — 자책골도 ev.team.id 를 그대로 득점 팀 삼아 누적하면 된다.
    const tid = ev.team?.id;
    if (tid != null) tally[tid] = (tally[tid] || 0) + 1;
    if (!NATIONAL_TEAMS[tid]) return; // 상대팀 득점은 방송하지 않는다
    const min = minuteKey(ev);
    const scorer = ev.detail === 'Own Goal'
      ? '상대 자책골 '
      : `${agPlayerName(ev.player) || PLAYERS.find((p) => p.afPlayerId === ev.player?.id)?.name || ev.player?.name || ''} `;
    const pen = ev.detail === 'Penalty' ? '페널티킥 ' : '';
    const h = tally[homeId] || 0, a = tally[awayId] || 0;
    const staleEv = isStaleEvent(ev, { staleResult, isLive, elapsedNow, kickoffMs });
    out.push({
      key: stableKey(`af-nat-goal-${fid}-${tid}-${min}`, keyCounts), players: [],
      kind: 'national', broadcast: true, matchId: String(fid),
      title: '🇰🇷 대한민국 U-23 골!',
      body: `${min}' ${scorer}${pen}골! ${home} ${h} : ${a} ${away}`,
      silent: staleEv,
    });
  });

  if (isFinal) {
    const gh = fx.goals?.home ?? 0, ga = fx.goals?.away ?? 0;
    const koreaHome = !!NATIONAL_TEAMS[homeId];
    const shootout = fx.score?.penalty?.home != null;
    let title, body = `${home} ${gh} : ${ga} ${away} · 아시안게임 경기가 끝났습니다.`;
    if (shootout) {
      const ph = fx.score.penalty.home ?? 0, pa = fx.score.penalty.away ?? 0;
      const koreaWon = koreaHome ? ph > pa : pa > ph;
      title = koreaWon ? '🇰🇷 대한민국 U-23 승리!' : '🇰🇷 대한민국 U-23 패배';
      body += ` (승부차기 ${ph} : ${pa})`;
    } else {
      const diff = koreaHome ? gh - ga : ga - gh;
      title = diff > 0 ? '🇰🇷 대한민국 U-23 승리!' : diff < 0 ? '🇰🇷 대한민국 U-23 패배' : '🇰🇷 대한민국 U-23 무승부';
    }
    out.push({
      key: `af-result-${fid}`, players: [],
      kind: 'national', broadcast: true, matchId: String(fid),
      title, body, silent: staleResult,
    });
  }
  return out;
}

const norm = (s) => (s || '').toLowerCase().replace(/[.\s-]/g, '');
const teamMatches = (compName, playerTeam) => {
  const a = norm(compName), b = norm(playerTeam);
  return a && b && (a.includes(b) || b.includes(a));
};

// ── Korean grammar: pick 이/가, 을/를 by whether the name ends in a batchim ──
function hasBatchim(str) {
  const ch = (str || '').trim().slice(-1).charCodeAt(0);
  if (ch < 0xAC00 || ch > 0xD7A3) return false; // not a Hangul syllable
  return (ch - 0xAC00) % 28 !== 0;
}
const josa = (str, withBatchim, withoutBatchim) => (hasBatchim(str) ? withBatchim : withoutBatchim);
// e.g. "손흥민, 황희찬가" / "이강인이" — attaches 이/가 after the last listed name.
const namesWithJosa = (names) => {
  const joined = names.join(', ');
  return joined + josa(names[names.length - 1], '이', '가');
};

// ── APNs (token-based, ES256 JWT over HTTP/2) ───────────────────────────────
function apnsJWT() {
  const key = (process.env.APNS_KEY || '').replace(/\\n/g, '\n');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'ES256', kid: process.env.APNS_KEY_ID });
  const body = b64({ iss: process.env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) });
  const sig = crypto.sign('SHA256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${sig.toString('base64url')}`;
}

function sendOne(client, token, payload, jwt) {
  return new Promise((resolve) => {
    const req = client.request({
      ':method': 'POST', ':path': `/3/device/${token}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': process.env.APNS_BUNDLE_ID,
      'apns-push-type': 'alert', 'apns-priority': '10',
    });
    let status = 0, data = '';
    req.setEncoding('utf8');
    req.on('response', (h) => { status = h[':status']; });
    req.on('data', (d) => { data += d; });
    req.on('end', () => resolve({ status, data }));
    req.on('error', () => resolve({ status: 0, data: 'error' }));
    req.end(JSON.stringify(payload));
  });
}

// 라이브 액티비티 갱신 전송. 일반 알림과 헤더가 다르다:
//  - apns-topic 에 '.push-type.liveactivity' 를 붙여야 한다
//  - apns-push-type 은 'liveactivity'
// content-state 의 키 이름은 위젯의 ContentState 프로퍼티명과 정확히 같아야
// 한다(다르면 조용히 무시된다).
function sendLiveActivity(client, token, jwt, contentState, { end = false } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const aps = {
    timestamp: now,
    event: end ? 'end' : 'update',
    'content-state': contentState,
    'stale-date': now + 3 * 3600,
  };
  if (end) aps['dismissal-date'] = now + 60 * 30;   // 종료 후 30분 뒤 사라짐
  return new Promise((resolve) => {
    const req = client.request({
      ':method': 'POST', ':path': `/3/device/${token}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': `${process.env.APNS_BUNDLE_ID}.push-type.liveactivity`,
      'apns-push-type': 'liveactivity',
      'apns-priority': '10',
    });
    let status = 0, data = '';
    req.setEncoding('utf8');
    req.on('response', (h) => { status = h[':status']; });
    req.on('data', (d) => { data += d; });
    req.on('end', () => resolve({ status, data }));
    req.on('error', () => resolve({ status: 0, data: 'error' }));
    req.end(JSON.stringify({ aps }));
  });
}

// ── Supabase REST helpers (service role) ────────────────────────────────────
const sbHeaders = () => ({
  apikey: process.env.SUPABASE_SERVICE_KEY,
  authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
  'content-type': 'application/json',
});
async function sbSelect(table, query) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders() });
  return r.ok ? r.json() : [];
}
// 이벤트 키를 한 번에 넣고, '새로 들어간 것'만 돌려준다(= 아직 안 보낸 알림).
// event_key UNIQUE + resolution=ignore-duplicates 라 중복은 조용히 무시된다.
//
// 예전엔 이벤트마다 POST 를 한 번씩, 그것도 순차로 보냈다. 경기가 많은 날은
// 수십~수백 왕복이 되고, Supabase 가 느려지면 한 실행이 크론 주기(2분)를 넘겨
// 다음 실행과 겹쳤다 — 겹칠수록 DB 부하가 늘어 더 느려지는 악순환이었다
// (실측: 모든 테이블 응답이 6~80초까지 늘어짐).
async function sbInsertLogBulk(keys) {
  if (!keys.length) return new Set();
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/push_log`, {
    method: 'POST',
    headers: { ...sbHeaders(), Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify(keys.map((event_key) => ({ event_key }))),
  });
  if (!r.ok) return new Set();   // 실패하면 이번 실행은 보내지 않는다(중복 발송 방지)
  const rows = await r.json().catch(() => []);
  return new Set(Array.isArray(rows) ? rows.map((x) => x.event_key) : []);
}

// ── Event collection ────────────────────────────────────────────────────────
const J = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);

// ── Soccer via API-Football ─────────────────────────────────────────────────
// The app's own data source — unlike ESPN league scoreboards it includes
// friendlies and cup ties, and events carry player IDs for exact attribution.
// Cost per run: 2 fixtures calls (UTC yesterday+today, same boundary reason as
// baseball) + 1 events call per live Korean fixture. Finished fixtures get one
// events pass, then an `af-done-{id}` marker in push_log stops further calls.
const AF_LIVE = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'INT', 'LIVE']);
const AF_FINAL = new Set(['FT', 'AET', 'PEN']);

function afGet(path) {
  const key = process.env.APIFOOTBALL_KEY;
  return fetch(`https://v3.football.api-sports.io${path}`, { headers: { 'x-apisports-key': key } })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      // 사용량 집계(프록시와 같은 테이블). 실패는 무시한다.
      const errs = j && j.errors;
      const errKeys = Array.isArray(errs) ? errs : Object.keys(errs || {});
      fetch(`${process.env.SUPABASE_URL}/rest/v1/af_usage`, {
        method: 'POST',
        headers: { ...sbHeaders(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ path: path.replace(/^\//, '').split('?')[0], source: 'cron',
          ok: !!j && errKeys.length === 0, rate_limited: errKeys.includes('rateLimit') || errKeys.includes('requests') }),
      }).catch(() => {});
      return j;
    })
    .catch(() => null);
}

async function alreadyLogged(eventKey) {
  const rows = await sbSelect('push_log', `event_key=eq.${encodeURIComponent(eventKey)}&select=event_key`);
  return Array.isArray(rows) && rows.length > 0;
}

// ─── sf_cache 날짜 행 슬림(쓰기 시점) ──────────────────────────
// index.html 의 같은 이름 헬퍼와 짝이다(이쪽이 서버 사본). 두 쪽 모두 같은
// sf_cache 날짜 행을 쓰므로, 어느 쪽이 채웠든 앱이 읽는 내용이 같아야 한다.
// AF 일일 목록은 전 세계 경기 1,100~1,600건(1~1.6MB)인데 앱은 콜드 스타트마다
// 어제·오늘·내일 세 행을 읽는다 — 그대로 두면 3MB 가까이 내려받는다.
// 모양(AF 원본 객체)은 유지하고 행·필드만 줄인다. 읽는 쪽은 옛 전체 모양
// 행도 그대로 처리한다(전체 모양은 슬림 모양의 상위집합).
const AF_KEEP_LEAGUES = new Set([
  39, 40, 45, 46, 48, 702,  // 잉글랜드: EPL·챔피언십·FA컵·EFL 트로피·리그컵·PL2(박승수)
  140, 141,                 // 스페인: 라리가·세군다
  78, 81,                   // 독일: 분데스리가·DFB 포칼
  135, 61, 88, 94,          // 세리에 A·리그 앙·에레디비시·프리메이라리가
  144, 119, 179, 203,       // 벨기에·덴마크·스코틀랜드·튀르키예
  253, 218, 286,            // MLS·오스트리아 분데스리가·세르비아 수페르리가
  2, 3, 848, 531, 15,       // UCL·UEL·UECL·UEFA 슈퍼컵·클럽 월드컵
  803,                      // 아시안게임(대표팀)
  667, 10,                  // 친선(클럽·대표팀)
]);
// 서버 사본은 팀 id 로 잡는다(PLAYERS.afTeamId + 대표팀). 앱 사본은 팀 이름으로
// 잡으므로, 같은 행을 두 쪽이 번갈아 써도 우리 경기는 어느 쪽에서도 안 빠진다.
const AF_KEEP_TEAM_IDS = new Set([
  ...PLAYERS.map((p) => p.afTeamId).filter(Boolean),
  ...Object.keys(NATIONAL_TEAMS).map(Number),
]);

function slimAfFixtures(fixtures) {
  if (!Array.isArray(fixtures)) return fixtures;
  const out = [];
  for (const f of fixtures) {
    const tracked = AF_KEEP_TEAM_IDS.has(f?.teams?.home?.id) || AF_KEEP_TEAM_IDS.has(f?.teams?.away?.id);
    if (!tracked && !AF_KEEP_LEAGUES.has(f?.league?.id)) continue;
    const fx = f.fixture || {}, lg = f.league || {};
    // 아무도 안 읽는 필드는 버린다: fixture.periods/referee, league.flag/logo/standings.
    // fixture.venue 는 앱 경기 상세가 venue.city 를 쓰므로 남긴다.
    out.push({
      ...f,
      fixture: { id: fx.id, date: fx.date, timezone: fx.timezone, timestamp: fx.timestamp,
                 venue: fx.venue, status: fx.status },
      league: { id: lg.id, name: lg.name, country: lg.country, round: lg.round, season: lg.season },
    });
  }
  return out;
}

// 날짜별 경기 목록: Supabase sf_cache 를 먼저 보고, 낡았을 때만 AF 를 부른다.
// 크론은 2분마다 도는데 이 목록은 그렇게 자주 바뀌지 않는다.
async function fixturesForDate(date) {
  const FRESH_MS = 3 * 60 * 1000;
  try {
    const rows = await sbSelect('sf_cache', `date=eq.${date}&select=events,updated_at`);
    const row = Array.isArray(rows) && rows[0];
    // 슬림 이후로는 '경기 0건'도 정상 결과다(추적 팀·화이트리스트 리그가 하나도
    // 없는 날). length 를 요구하면 그런 날엔 2분마다 AF 를 다시 부른다.
    if (row && Array.isArray(row.events) &&
        Date.now() - new Date(row.updated_at).getTime() < FRESH_MS) {
      return { response: row.events };
    }
  } catch (e) { /* 캐시 불가 → 그냥 AF 로 */ }
  const data = await afGet(`/fixtures?date=${date}`);
  if (Array.isArray(data?.response) && data.response.length) {
    // 캐시에도, 이 실행의 처리 대상에도 슬림한 목록을 쓴다 — 캐시 적중 경로가
    // 돌려주는 것과 같은 내용이어야 실행마다 결과가 달라지지 않는다.
    const slim = slimAfFixtures(data.response);
    try {
      await fetch(`${process.env.SUPABASE_URL}/rest/v1/sf_cache`, {
        method: 'POST',
        headers: { ...sbHeaders(), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ date, events: slim, updated_at: new Date().toISOString() }),
      });
    } catch (e) { /* 저장 실패는 무시 */ }
    return { ...data, response: slim };
  }
  return data;
}

// 경기별 라인업: 한 번 받아 sf_cache 에 넣고 이후엔 거기서 읽는다.
// 라이브 액티비티는 '이 선수가 실제로 뛰는가'를 매 실행 알아야 하는데,
// 예전엔 시작 알림을 이미 보낸 경기의 라인업 조회를 건너뛰어(lineupSettled)
// squad 를 모른 채 involved[0] 로 폴백했다 — 그래서 명단에 없는 선수가
// 잠금화면에 '출전 중'으로 떴다(김지수·조규성 제보).
// 라인업은 경기 중 바뀌지 않으므로(교체는 events 로 들어온다) 캐시해도 안전하다.
// 이름 비교 키 — 성·이름 순서가 소스마다 달라('Oh Hyeon-Gyu'/'Hyeon-gyu Oh') 토큰을 정렬한다.
const nameKeyOf = (s) => (s || '').toLowerCase().replace(/[.\-]/g, ' ').split(/\s+/).filter(Boolean).sort().join('');

// espnFallback: AF 에 명단이 없을 때 ESPN 로스터를 돌려주는 함수(선택).
// 2026-09-11 베식타시-에르주룸은 종료 뒤에도 AF 에 라인업이 아예 없어서 시작·종료
// 알림이 하나도 안 나갔다(앱은 ESPN 폴백으로 '풀타임'을 표시). ESPN 로스터엔
// AF 선수 id 가 없으므로 우리 선수(involved)만 이름으로 붙여 id 목록을 만든다 —
// 호출부는 startXI/subs 에 우리 선수 id 가 있는지만 본다.
async function lineupSquad(fid, espnFallback = null, involved = []) {
  const key = `af-lineup-${fid}`;
  try {
    const rows = await sbSelect('sf_cache', `date=eq.${key}&select=events`);
    const row = Array.isArray(rows) && rows[0];
    if (row && row.events && Array.isArray(row.events.startXI)) return row.events;
  } catch (e) { /* 캐시 불가 → AF 로 */ }
  const lu = await afGet(`/fixtures/lineups?fixture=${fid}`);
  const teams = lu?.response || [];
  let out = null;
  // 발표 전에는 '팀 껍데기'(startXI 빈 배열)가 오므로 채워졌을 때만 인정한다.
  if (teams.length && teams.some((t) => (t.startXI || []).length)) {
    const ids = (list) => (list || []).map((e) => e.player?.id).filter((x) => x != null);
    out = {
      startXI: teams.flatMap((t) => ids(t.startXI)),
      subs: teams.flatMap((t) => ids(t.substitutes)),
    };
  } else if (espnFallback && involved.length) {
    const rosters = await espnFallback().catch(() => null);
    // 우리 선수 소속팀 로스터가 선발 11명까지 차 있을 때만 믿는다. 한쪽 팀만 온
    // 상태를 받아들이면 빈 목록이 '명단 제외'로 확정·캐시돼 영영 안 고쳐진다.
    const ownOk = rosters && involved.some((p) => rosters.some((t) =>
      String(t.team?.id) === String(p.espnTeamId) && (t.roster || []).filter((a) => a.starter).length >= 11));
    if (ownOk) {
      const match = (a) => involved.find((p) => nameKeyOf(p.nameEn).length >= 6 &&
        nameKeyOf(a.athlete?.displayName) === nameKeyOf(p.nameEn));
      const startXI = [], subs = [];
      rosters.forEach((t) => (t.roster || []).forEach((a) => {
        const p = match(a); if (!p) return;
        (a.starter ? startXI : subs).push(p.afPlayerId);
      }));
      // 우리 선수가 로스터에 한 명도 없으면 '명단에 없음'이 확정된 것이므로 빈 목록을
      // 그대로 돌려준다(null 과 구분 — null 은 '아직 모름').
      out = { startXI, subs, source: 'espn' };
    }
  }
  if (!out) return null;
  try {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/sf_cache`, {
      method: 'POST',
      headers: { ...sbHeaders(), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ date: key, events: out, updated_at: new Date().toISOString() }),
    });
  } catch (e) { /* 저장 실패는 무시 */ }
  return out;
}

async function collectSoccer(events, liveStates) {
  if (!process.env.APIFOOTBALL_KEY) { console.warn('soccer: APIFOOTBALL_KEY missing'); return; }
  // ── ESPN 라인업 폴백 ────────────────────────────────────────────────
  // AF 는 라인업을 킥오프 직전(실측 8~22분 전)에야 낸다. ESPN 은 같은 경기를
  // 30분 전에 냈다. AF 가 아직 안 냈을 때만 ESPN 을 본다.
  // (서버에서 부르므로 UA 차단 이슈가 없다 — 앱은 프록시 /api/espn 을 쓴다.)
  const espnEventIds = new Map();   // `${league}:${teamId}:${kickoffMs}` → eventId|null
  const espnGet = async (path, qs = '') => {
    try {
      const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}${qs}`);
      return r.ok ? await r.json() : null;
    } catch { return null; }
  };
  const espnLineup = async (p, kickoffMs) => {
    if (!p.espnLeague || !p.espnTeamId) return null;
    const key = `${p.espnLeague}:${p.espnTeamId}:${kickoffMs}`;
    let evId = espnEventIds.get(key);
    if (evId === undefined) {
      // 팀 일정 엔드포인트는 지난 경기만 준다 — 예정 경기는 날짜별 scoreboard.
      const ymd = (d) => new Date(d).toISOString().slice(0, 10).replace(/-/g, '');
      evId = null;
      for (const off of [0, -1, 1]) {
        const sb = await espnGet(`soccer/${p.espnLeague}/scoreboard`,
          `?dates=${ymd(kickoffMs + off * 86400000)}`);
        const hit = (sb?.events || []).find((e) =>
          Math.abs(new Date(e.date).getTime() - kickoffMs) < 6 * 3600 * 1000 &&
          (e.competitions?.[0]?.competitors || []).some((c) => String(c.team?.id) === String(p.espnTeamId)));
        if (hit) { evId = hit.id; break; }
      }
      espnEventIds.set(key, evId);
    }
    if (!evId) return null;
    const sum = await espnGet(`soccer/${p.espnLeague}/summary`, `?event=${evId}`);
    const rosters = sum?.rosters || [];
    if (!rosters.some((t) => (t.roster || []).some((a) => a.starter))) return null;
    return rosters;
  };

  // 대표팀 차출 등으로 소속팀 명단에서 빠져 있는 선수. 이 기간엔 소속팀 경기의
  // 개인 알림(라인업 '명단 제외'·출전·결과·골)을 아예 만들지 않는다 — 앱의
  // MANUAL_AVAILABILITY(index.html)와 같은 명단·기간을 유지할 것.
  // (2026-09-20 제보: 아시안게임 차출 선수에게 소속팀 '명단 포함되지 않았다' 알림이 갔다.)
  const MANUAL_OUT = [
    { ids: [20, 23, 22, 31, 32, 30], from: '2026-09-07', to: '2026-10-05', reason: '아시안게임 차출' },
  ];
  const today = new Date().toISOString().slice(0, 10);
  const manualOut = new Set(MANUAL_OUT.filter((m) => today >= m.from && today <= m.to).flatMap((m) => m.ids));
  const soccer = PLAYERS.filter((p) => p.sport === 'soccer' && !manualOut.has(p.id));
  const ymd = (off) => new Date(Date.now() + off * 86400000).toISOString().slice(0, 10);
  const seenFixtures = new Set(); // a fixture can appear in both date responses

  // 어제 날짜는 UTC 오전에만 본다. 늦게 끝난 경기의 결과 알림을 잡기 위한
  // 것이라 하루 종일 조회할 이유가 없다(2분마다 1콜 = 하루 720콜 낭비).
  const utcHour = new Date().getUTCHours();
  const dates = utcHour < 8 ? [ymd(-1), ymd(0)] : [ymd(0)];

  for (const date of dates) {
    // 날짜별 경기 목록은 앱도 sf_cache 에 채운다 — 같은 캐시를 읽어 중복 조회를
    // 없앤다. 오늘 목록은 3분이면 충분히 신선하다(상태 변화는 경기별 조회로 본다).
    const data = await fixturesForDate(date);
    for (const fx of data?.response || []) {
      const fid = fx.fixture?.id;
      if (!fid || seenFixtures.has(fid)) continue;
      let involved = soccer.filter((p) => fx.teams?.home?.id === p.afTeamId || fx.teams?.away?.id === p.afTeamId);
      // 대표팀(아시안게임) 경기 — 소속팀 id 로는 안 잡히니 NATIONAL_TEAMS 로 따로 확인한다.
      // 개인 알림(출전/골/도움/카드)은 대표팀 경기에 내지 않으므로 소집 선수를
      // involved 에 얹지 않는다 — involved 는 그대로 비워 둬서 아래 개인 알림
      // 코드(출전/결과/골/도움/카드)가 자연히 아무것도 만들지 않게 하고, 대신
      // nationalMatchEvents() 가 팀 단위로 방송한다.
      const homeNational = NATIONAL_TEAMS[fx.teams?.home?.id];
      const awayNational = NATIONAL_TEAMS[fx.teams?.away?.id];
      const isNationalMatch = !!(homeNational || awayNational);
      if (!involved.length && !isNationalMatch) continue;
      seenFixtures.add(fid);

      const st = fx.fixture.status?.short;
      const isLive = AF_LIVE.has(st), isFinal = AF_FINAL.has(st);
      const kickoffMs = new Date(fx.fixture?.date || 0).getTime();
      const elapsedNow = fx.fixture.status?.elapsed;
      // 2026-09-06 09:04 KST: AF 일일 한도가 새벽 1시경 소진돼 8시간 동안 크론이
      // 아무것도 못 봤고, 09시 리셋 때 한꺼번에 몰아서 4~7시간 전에 끝난 경기의
      // '경기 종료' 알림 4건이 동시에 나갔다. 장애 후 캐치업이라도 이미 지난
      // 소식을 새 알림처럼 보내면 안 된다 — 아래 stale 판정이 true 인 이벤트는
      // silent 로 표시해 push_log 에는 기록하되(재시도·중복 방지) 실제 발송은
      // 건너뛴다.
      const staleResult = isFinal && kickoffMs && Date.now() - kickoffMs > 3.5 * 60 * 60 * 1000; // 경기는 보통 2시간, 킥오프 3.5시간 후 종료 알림은 낡은 소식
      const staleStart = isLive && ((elapsedNow != null && elapsedNow > 30) || (kickoffMs && Date.now() - kickoffMs > 45 * 60 * 1000));

      const home = teamLabel(fx.teams.home), away = teamLabel(fx.teams.away);
      const vs = `${home} vs ${away}`;
      const names = involved.map((p) => p.name);

      // ── 라인업 발표 알림: 킥오프 80분 전부터 감시, 발표 즉시 선발/벤치/제외 푸시 ──
      // (리그마다 60~75분 전 발표. 발표 전엔 빈 응답 → 다음 실행에서 재시도,
      //  처리 완료되면 af-lineup-done 마커로 이후 lineups 호출 자체를 중단.)
      if (!isLive && !isFinal) {
        // 대표팀(아시안게임) 경기는 라인업 발표 감시를 하지 않는다 — 이 블록의 ESPN
        // 폴백은 소속팀 espnTeamId 로 조회하는데, 대표팀 경기에는 맞지 않는다.
        // (경기 시작 전이므로 어차피 알림은 없다 — 아래 continue 는 그대로 탄다.)
        if (isNationalMatch) continue;
        const til = new Date(fx.fixture.date).getTime() - Date.now();
        const inWindow = (st === 'NS' || st === 'TBD') && til > 0 && til <= 80 * 60 * 1000;
        if (inWindow && !(await alreadyLogged(`af-lineup-done-${fid}`))) {
          const lu = await afGet(`/fixtures/lineups?fixture=${fid}`);
          let teams = lu?.response || [];
          // AF 가 아직 안 냈으면 ESPN 을 본다. ESPN 응답을 AF 형태로 맞춰
          // 아래 매칭 코드를 그대로 쓴다(선수 id 는 다르므로 이름으로 붙는다).
          // '안 냈다'의 기준은 우리 선수 소속팀이다 — AF 는 한 팀만 먼저 내기도
          // 하는데(2026-09-06 RSL 만 있고 LAFC 는 빈 채로 옴), 그때 상대팀이
          // 있다고 ESPN 을 건너뛰면 우리 선수 판정이 다음 실행까지 밀린다.
          const ownXI = (p) => (teams.find((t) => t.team?.id === p.afTeamId)?.startXI || []).length;
          if (involved.some((p) => !ownXI(p))) {
            const rosters = await espnLineup(involved[0], new Date(fx.fixture.date).getTime());
            if (rosters) {
              const conv = (a) => ({ player: { id: null, name: a.athlete?.displayName || '' } });
              teams = rosters.map((t) => ({
                team: {
                  name: t.team?.displayName || '',
                  id: involved.find((q) => String(q.espnTeamId) === String(t.team?.id))?.afTeamId ?? null,
                },
                startXI: (t.roster || []).filter((a) => a.starter).map(conv),
                substitutes: (t.roster || []).filter((a) => !a.starter).map(conv),
              }));
            }
          }
          // API-Football 은 발표 전에도 '팀 껍데기'(startXI 가 빈 배열)를 돌려줄 때가
          // 있다. teams.length 만 보면 그걸 발표로 오인해 전원을 '명단 제외'로 잘못
          // 알리고, af-lineup-done 마커까지 남겨 진짜 발표를 영영 놓친다.
          // → 실제 선발 명단이 채워졌을 때만 발표로 본다.
          if (teams.some((t) => (t.startXI || []).length)) {
            // 이름 비교는 어순을 무시한다 — ESPN 은 'Kim Min-Jae'/'Min-jae Kim' 처럼
            // 소스마다 성·이름 순서가 뒤집힌다. 토큰을 정렬해 키로 만든다.
            const nameKey = (s) => (s || '').toLowerCase().replace(/[.\-]/g, ' ').split(/\s+/).filter(Boolean).sort().join('');
            // 벤치 명단이 아직 없는 팀(선발 11명만 나온 상태)에서는 '명단 제외'를 단정하지
            // 않는다. ESPN 은 선발을 먼저 내고 벤치를 나중에 채우는데, 그 사이에 확인하면
            // 벤치 선수를 '제외'로 잘못 알리고 af-lineup-done 까지 찍혀 정정 기회가 없다
            // (제보: 김민재가 명단에 있는데 '포함되지 않았다'고 옴).
            //
            // 또한 판정은 반드시 '그 선수 자신의 팀'만 봐야 한다. 2026-09-06 Real Salt
            // Lake vs LAFC 경기에서 AF 가 홈팀(RSL)만 먼저 발표하고 LAFC 항목은 비어
            // 있었는데, teams 배열에 RSL 이 있다는 이유만으로 '벤치를 안다'고 판단해
            // LAFC 소속 손흥민을 RSL 명단에서 못 찾고 '명단 제외'로 잘못 알렸다(그리고
            // af-lineup-done 마커까지 찍혀 정정되지 않았다). → 상대팀 데이터는 아예
            // 보지 않고, 선수 자신의 팀(own) 항목이 채워졌을 때만 판정한다.
            let allDecided = true;
            for (const p of involved) {
              const own = teams.find((t) => t.team?.id === p.afTeamId);
              if (!own || !(own.startXI || []).length) { allDecided = false; continue; } // 우리 팀 명단 아직 미발표
              const hit = (e) => e?.player && (e.player.id === p.afPlayerId ||
                (nameKey(e.player.name).length >= 6 && nameKey(e.player.name) === nameKey(p.nameEn || '')));
              const inXI = (own.startXI || []).some(hit);
              const onBench = (own.substitutes || []).some(hit);
              if (!inXI && !onBench && !(own.substitutes || []).length) { allDecided = false; continue; } // 벤치 명단 아직 미발표
              const j = josa(p.name, '이', '가');
              const body = inXI ? `${vs} — ${p.name}${j} 선발로 나섭니다.`
                : onBench ? `${vs} — ${p.name}${j} 벤치에서 출발합니다.`
                : `${vs} — ${p.name}${j} 이번 경기 명단에 포함되지 않았습니다.`;
              events.push({ key: `af-lineup-${fid}-${p.id}`, players: [p.id], matchId: String(fid),
                kind: 'lineup', title: '⚽ 라인업 발표', body });
            }
            // 전원 판정이 끝났을 때만 감시를 끝낸다. 보류된 선수는 다음 실행에서 다시 본다.
            if (allDecided) events.push({ key: `af-lineup-done-${fid}`, players: [] }); // 감시 종료 마커(무발송)
          }
        }
        continue;
      }

      // Finished & fully processed on an earlier run → skip (saves the events call).
      if (isFinal && await alreadyLogged(`af-done-${fid}`)) continue;

      let starters = null, squad = null;
      if (!isNationalMatch) {
        // 야구와 같은 이유 — 팀 경기라고 다 뛰는 게 아니다. 라인업으로 실제 출전을
        // 확인한 뒤 대상을 좁힌다. 라인업이 아직/끝내 없으면 사실을 단정하지 않고 건너뛴다.
        // 라인업은 캐시를 거치므로 매 실행 불러도 AF 호출이 늘지 않는다.
        // (예전엔 시작 알림 후 조회를 건너뛰어 출전 여부를 알 수 없었다.)
        if (isLive || isFinal) {
          const lu = await lineupSquad(fid, () => espnLineup(involved[0], new Date(fx.fixture.date).getTime()), involved);
          if (lu) {
            starters = involved.filter((p) => lu.startXI.includes(p.afPlayerId));
            squad = involved.filter((p) => lu.startXI.includes(p.afPlayerId) || lu.subs.includes(p.afPlayerId));
          }
        }

        if (isLive && starters && starters.length) {
          const sNames = starters.map((p) => p.name);
          events.push({ key: `af-start-${fid}`, players: starters.map((p) => p.id), matchId: String(fid),
            kind: 'start', title: `⚽ ${vs}`, body: `${namesWithJosa(sNames)} 출전하는 경기가 시작됐습니다.`, silent: staleStart });
        }
        if (isFinal && squad && squad.length) {
          events.push({ key: `af-result-${fid}`, players: squad.map((p) => p.id), matchId: String(fid),
            kind: 'result', title: '⚽ 경기 종료', body: `${home} ${fx.goals?.home ?? 0} : ${fx.goals?.away ?? 0} ${away}, 경기가 종료됐습니다.`, silent: staleResult });
        }
      }
      // (대표팀 경기는 위 개인 출전/결과 알림을 만들지 않는다 — 킥오프 알림도,
      // 라인업 확정(squad)도 없다. 골·최종결과는 evd 를 받은 뒤 아래에서
      // nationalMatchEvents() 로 팀 단위 방송을 만든다.)

      // Per-play events — matched by API-Football player id (exact, no name fuzz).
      const evd = await afGet(`/fixtures/events?fixture=${fid}`);

      if (isNationalMatch) {
        const natEvents = nationalMatchEvents({ fx, fid, evd, home, away, isLive, isFinal, elapsedNow, staleResult, kickoffMs });
        events.push(...natEvents);

        // ── 사라짐 폴백(대표팀) ──────────────────────────────────────────
        // AF 가 Var 이벤트 없이 골 이벤트 자체를 통째로 지우는 경우가 있다(취소
        // 확정 후 정리). 라이브 경기에 한해 이전에 기록한 af-nat-goal-* 키 중
        // 이번 회차엔 없는 것을 찾아 취소로 간주한다. 종료된 경기는 절대 하지
        // 않는다(AF 의 경기 후 정리 작업이 스팸을 낼 수 있다).
        if (isLive) {
          const currentNatGoalKeys = new Set(
            natEvents.filter((e) => e.key.startsWith('af-nat-goal-')).map((e) => e.key));
          const priorNat = await sbSelect('push_log', `event_key=like.af-nat-goal-${fid}-*&select=event_key`);
          for (const row of (priorNat || [])) {
            const k = row.event_key;
            if (!k || currentNatGoalKeys.has(k)) continue;
            const m = k.match(/^af-nat-goal-(\d+)-\d+-(.+)$/);
            if (!m) continue;
            const min = m[2];
            const elapsedGuess = parseInt(min, 10);
            const staleEv = isStaleEvent({ time: { elapsed: elapsedGuess } }, { staleResult, isLive, elapsedNow, kickoffMs });
            events.push({
              key: k.replace(/^af-nat-goal-(\d+)-\d+-/, 'af-nat-goalcancel-$1-'), players: [],
              kind: 'national', broadcast: true, matchId: String(fid),
              title: '🇰🇷 대한민국 U-23 골 취소',
              // 이벤트 자체가 사라져 득점자를 다시 알 수 없다 — VAR 문구 없이 취소만 알린다.
              body: `${min}' 골이 취소됐습니다. ${home} ${fx.goals?.home ?? 0} : ${fx.goals?.away ?? 0} ${away}`,
              silent: staleEv,
            });
          }
        }
      }

      // ── 라이브 액티비티 상태 (잠금화면·다이나믹 아일랜드) ──────────────
      // 알림과 달리 중복 제거를 타지 않는다 — 점수·분이 바뀔 때마다 갱신해야
      // 하므로 매 실행 만들어 두고, 아래에서 토큰이 있는 경기만 실제로 보낸다.
      // 대표팀 경기는 개인 출전을 모르니(squad 없음) 라이브 액티비티 자체를 건너뛴다.
      if (liveStates && (isLive || isFinal) && !isNationalMatch) {
        // squad 는 선발+벤치다. 라인업을 받아왔는데 그 안에 없으면 이 경기에
        // 나설 수 없는 선수라 잠금화면에 띄우지 않는다(=me 가 undefined).
        // squad 가 null 이면 라인업을 아직 모르는 것이라 단정하지 않는다.
        const me = squad ? squad[0] : involved[0];
        let g = 0, a = 0;
        for (const ev of (evd?.response || [])) {
          if (ev.type !== 'Goal' || ev.detail === 'Missed Penalty') continue;
          if (ev.player?.id === me?.afPlayerId && ev.detail !== 'Own Goal') g++;
          if (ev.assist?.id === me?.afPlayerId) a++;
        }
        const el = fx.fixture.status?.elapsed;
        if (squad && !squad.length) {
          // 라인업이 나왔는데 우리 선수가 없다 = 미출전. 앱이 '출전 예상' 단계에서
          // 이미 띄웠을 수 있으니 여기서 내려준다.
          liveStates.push({
            matchId: String(fid), ended: true,
            state: {
              homeScore: fx.goals?.home ?? 0, awayScore: fx.goals?.away ?? 0,
              minute: isFinal ? '종료' : (el != null ? `${el}'` : ''),
              status: isFinal ? 'final' : 'live',
              playerLine: '미출전', playerGoals: 0, playerAssists: 0,
            },
          });
        } else if (me) liveStates.push({
          matchId: String(fid),
          ended: isFinal,
          state: {
            homeScore: fx.goals?.home ?? 0,
            awayScore: fx.goals?.away ?? 0,
            minute: isFinal ? '종료' : st === 'HT' ? '하프타임' : (el != null ? `${el}'` : ''),
            status: isFinal ? 'final' : st === 'HT' ? 'halftime' : 'live',
            // 골·도움이 있으면 그게 핵심이라 위젯이 배지로 띄운다.
            // 경기가 끝났으면 상태 문구를 비운다 — '종료'인데 '출전 중'이라고
            // 적혀 나가는 문제가 있었다(제보). 배지는 이미 '종료'를 보여준다.
            playerLine: (g || a) ? ''
              : isFinal ? ''
              : (starters && starters.some((p) => p.id === me.id)) ? '선발 출전'
              : '출전 중',
            playerGoals: g,
            playerAssists: a,
          },
        });
      }
      // 골/도움/카드/VAR취소 키 중복 카운터 — 이 경기(fid) 안에서만 유효.
      const clubKeyCounts = new Map();
      const fixtureClubEvents = [];
      (evd?.response || []).forEach((ev) => {
        const min = minuteKey(ev);
        const minDisp = ev.time?.elapsed != null ? `${min}'` : '';
        const staleEv = isStaleEvent(ev, { staleResult, isLive, elapsedNow, kickoffMs });
        if (ev.type === 'Var' && isVarGoalCancelled(ev.detail)) {
          const p = involved.find((q) => q.afPlayerId === ev.player?.id);
          if (p) {
            fixtureClubEvents.push({
              key: stableKey(`af-goalcancel-${fid}-${p.id}-${min}`, clubKeyCounts), players: [p.id], matchId: String(fid),
              kind: 'goal', title: '⚽ 골 취소', body: `${vs} 경기 ${minDisp}, ${p.name}의 골이 VAR 판정으로 취소됐습니다.`, silent: staleEv,
            });
          }
          return;
        }
        involved.forEach((p) => {
          const isPlayer = ev.player?.id === p.afPlayerId;
          const isAssist = ev.assist?.id === p.afPlayerId;
          if (ev.type === 'Goal' && ev.detail !== 'Missed Penalty') {
            if (isPlayer && ev.detail !== 'Own Goal') {
              const pen = ev.detail === 'Penalty' ? '페널티킥으로 ' : '';
              fixtureClubEvents.push({ key: stableKey(`af-goal-${fid}-${p.id}-${min}`, clubKeyCounts), players: [p.id], matchId: String(fid),
                kind: 'goal', title: `⚽ ${p.name} 골!`, body: `${vs} 경기 ${minDisp}, ${p.name}${josa(p.name, '이', '가')} ${pen}골을 터뜨렸습니다!`, silent: staleEv });
            } else if (isAssist) {
              fixtureClubEvents.push({ key: stableKey(`af-assist-${fid}-${p.id}-${min}`, clubKeyCounts), players: [p.id], matchId: String(fid),
                kind: 'assist', title: `⚽ ${p.name} 도움!`, body: `${vs} 경기 ${minDisp}, ${p.name}${josa(p.name, '이', '가')} 도움을 기록했습니다!`, silent: staleEv });
            }
          } else if (ev.type === 'Card' && isPlayer) {
            if (ev.detail === 'Red Card') {
              fixtureClubEvents.push({ key: stableKey(`af-red-${fid}-${p.id}-${min}`, clubKeyCounts), players: [p.id], matchId: String(fid),
                kind: 'card', title: `⚽ ${p.name} 퇴장`, body: `${vs} 경기 ${minDisp}, ${p.name}${josa(p.name, '이', '가')} 퇴장당했습니다.`, silent: staleEv });
            } else if (ev.detail === 'Yellow Card') {
              fixtureClubEvents.push({ key: stableKey(`af-yellow-${fid}-${p.id}-${min}`, clubKeyCounts), players: [p.id], matchId: String(fid),
                kind: 'card', title: `⚽ ${p.name} 경고`, body: `${vs} 경기 ${minDisp}, ${p.name}${josa(p.name, '이', '가')} 경고를 받았습니다.`, silent: staleEv });
            }
          }
        });
      });
      events.push(...fixtureClubEvents);

      // ── 사라짐 폴백(클럽) ────────────────────────────────────────────────
      // AF 가 Var 이벤트 없이 골 이벤트 자체를 통째로 지우는 경우가 있다. 라이브
      // 경기에 한해(종료 경기는 AF 의 사후 정리가 스팸을 낼 수 있어 제외) 이전에
      // 기록한 af-goal-* 키 중 이번 회차엔 없는 것을 찾아 취소로 간주한다.
      if (isLive && involved.length) {
        const currentGoalKeys = new Set(
          fixtureClubEvents.filter((e) => e.key.startsWith(`af-goal-${fid}-`)).map((e) => e.key));
        const priorGoal = await sbSelect('push_log', `event_key=like.af-goal-${fid}-*&select=event_key`);
        for (const row of (priorGoal || [])) {
          const k = row.event_key;
          if (!k || currentGoalKeys.has(k)) continue;
          const m = k.match(/^af-goal-\d+-(\d+)-(.+)$/);
          if (!m) continue;
          const pid = Number(m[1]), min = m[2];
          const p = involved.find((q) => q.id === pid) || PLAYERS.find((q) => q.id === pid);
          if (!p) continue;
          const elapsedGuess = parseInt(min, 10);
          const staleEv = isStaleEvent({ time: { elapsed: elapsedGuess } }, { staleResult, isLive, elapsedNow, kickoffMs });
          events.push({
            key: k.replace(/^af-goal-/, 'af-goalcancel-'), players: [p.id], matchId: String(fid),
            kind: 'goal', title: '⚽ 골 취소',
            // 이벤트 자체가 사라져 VAR 여부를 알 수 없다 — VAR 문구 없이 취소만 알린다.
            body: `${vs} 경기 ${min}', ${p.name}의 골이 취소됐습니다.`,
            silent: staleEv,
          });
        }
      }

      // Mark finished fixtures as fully processed AFTER their events were parsed.
      // 단, 라인업을 못 받은 회차(한도 초과·AF 지연)에 찍으면 결과 알림이 영영
      // 나가지 않는다 — 명단을 확인했거나, 종료 후 2시간이 지나 더 기다릴 이유가
      // 없을 때만 마감한다. (명단 없는 경기는 2시간 동안 2분마다 1콜 = 60콜 상한)
      const longDone = kickoffMs && Date.now() - kickoffMs > (2 * 60 + 120) * 60 * 1000;
      if (isFinal && (isNationalMatch || squad !== null || longDone)) {
        events.push({ key: `af-done-${fid}`, players: [], silent: true });
      }
    }
  }
}

// ── 대표팀 다음 경기 확정 알림 ──────────────────────────────────────────
// 토너먼트는 조별리그가 끝나야 다음 경기(상대·일시)가 생긴다. 한 시간에 한 번
// 대표팀의 다음 경기 2개를 조회해 처음 보는 경기면 전원에게 방송한다
// (앱 홈·일정에는 날짜 캐시로 자동 반영되지만, 알림은 여기서만 나간다).
// 2분 크론이라 정각 직후 회차(분 < 2)에만 돈다 → AF 하루 24콜.
const ROUND_KO = [
  [/final/i, '결승'], [/semi/i, '준결승'], [/quarter/i, '8강'], [/round of 16|16/i, '16강'],
  [/3rd place|bronze/i, '3·4위전'], [/group/i, '조별리그'],
];
const roundKo = (round) => (ROUND_KO.find(([re]) => re.test(round || '')) || [])[1] || (round || '');
const kstLabel = (iso) => {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' }).formatToParts(d)
    .reduce((a, x) => (a[x.type] = x.value, a), {});
  return `${p.month}/${p.day}(${p.weekday}) ${p.hour}:${p.minute} KST`;
};
async function collectNationalSchedule(events) {
  if (new Date().getUTCMinutes() >= 2) return;
  for (const [teamId, nat] of Object.entries(NATIONAL_TEAMS)) {
    const j = await afGet(`/fixtures?team=${teamId}&next=2`);
    for (const fx of j?.response || []) {
      const fid = fx.fixture?.id;
      if (!fid || !fx.fixture?.date) continue;
      // 킥오프 3시간 이내면 이미 홈에 떠 있는 경기 — 새 소식이 아니다.
      if (new Date(fx.fixture.date).getTime() - Date.now() < 3 * 60 * 60 * 1000) continue;
      const home = teamLabel(fx.teams?.home), away = teamLabel(fx.teams?.away);
      const opp = fx.teams?.home?.id === Number(teamId) ? away : home;
      const round = roundKo(fx.league?.round);
      events.push({
        key: `af-nat-sched-${fid}`, players: [], kind: 'national', broadcast: true, matchId: String(fid),
        title: `🇰🇷 ${nat.name} 다음 경기 확정`,
        body: `${round ? round + ' · ' : ''}vs ${opp} · ${kstLabel(fx.fixture.date)}`,
      });
    }
  }
}

async function collectBaseball(events) {
  // MLB 경기는 미국 현지(주로 저녁) 기준 날짜로 등록돼 UTC 날짜와 어긋난다. UTC '오늘'만
  // 조회하면 미국 저녁(=UTC 다음날)에 진행 중인 경기를 통째로 놓친다(soccer는 ESPN
  // scoreboard를 날짜 없이 받아 무관). 어제~오늘(UTC) 범위로 조회해 진행/종료 경기를 모두
  // 포착한다. 같은 경기가 여러 번 잡혀도 gamePk 기반 push_log 중복 제거로 한 번만 발송된다.
  const ymd = (off) => new Date(Date.now() + off * 86400000).toISOString().slice(0, 10);
  const sched = await J(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${ymd(-1)}&endDate=${ymd(0)}&hydrate=team,linescore`);
  for (const day of sched?.dates || []) {
    for (const g of day.games || []) {
      const home = g.teams?.home?.team?.name || '', away = g.teams?.away?.team?.name || '';
      const involved = PLAYERS.filter((p) => p.sport === 'baseball' && (teamMatches(home, p.mlbTeam) || teamMatches(away, p.mlbTeam)));
      if (!involved.length) continue;
      const vs = `${away} vs ${home}`;
      const st = g.status?.abstractGameState; // Preview | Live | Final
      const gameMs = new Date(g.gameDate || 0).getTime();
      if (st !== 'Live' && st !== 'Final') continue;

      // 팀이 경기한다고 선수가 뛰는 건 아니다 — 박스스코어로 실제 출전을 확인한 뒤
      // 발송한다(엔트리 제외·부상·벤치인데 '출전' 알림이 가던 문제).
      const box = await J(`https://statsapi.mlb.com/api/v1/game/${g.gamePk}/boxscore`);
      const entryOf = (p) => {
        for (const side of ['home', 'away']) {
          const pl = box?.teams?.[side]?.players?.[`ID${p.mlbId}`];
          if (pl) return pl;
        }
        return null;
      };
      const batOf = (p) => entryOf(p)?.stats?.batting || null;
      const isStarter = (p) => !!entryOf(p)?.battingOrder;          // 선발 라인업
      const didPlay = (p) => {
        const e = entryOf(p);
        if (!e) return false;
        if (e.battingOrder) return true;
        const b = e.stats?.batting || {};
        const pit = e.stats?.pitching || {};
        return (parseInt(b.gamesPlayed ?? 0) || 0) > 0 || (parseInt(b.plateAppearances ?? 0) || 0) > 0
            || (parseInt(b.atBats ?? 0) || 0) > 0 || (parseInt(pit.gamesPlayed ?? 0) || 0) > 0;
      };

      if (st === 'Live') {
        const starters = involved.filter(isStarter);
        if (starters.length) {
          const names = starters.map((p) => p.name);
          // 경기 시작 후 1시간 넘게 지나서야 잡힌 경우('시작됐습니다'가 이제 와서
          // 나가면 이상하다) — 캐치업 상황이므로 조용히 기록만 하고 발송은 건너뛴다.
          const silentStart = !!(gameMs && Date.now() - gameMs > 60 * 60 * 1000);
          events.push({ key: `mlb-start-${g.gamePk}`, players: starters.map((p) => p.id), matchId: String(g.gamePk),
            kind: 'start', title: `⚾ ${vs}`, body: `${namesWithJosa(names)} 출전하는 경기가 시작됐습니다.`, silent: silentStart });
        }
      }

      // Batting box → home-run moments (live) + a performance line on the result.
      {
        // 종료 후 5시간이 지난 결과(경기당 최대 3~4시간 소요 감안)는 낡은 소식으로
        // 본다. Live 중엔 홈런 시점을 타임스탬프로 알 수 없어 그대로 보낸다.
        const staleFinal = !!(st === 'Final' && gameMs && Date.now() - gameMs > 5 * 60 * 60 * 1000);
        // Home runs: one push per HR, keyed by cumulative count so a 2-HR game fires twice.
        for (const p of involved) {
          const bat = batOf(p);
          const hr = parseInt(bat?.homeRuns ?? 0) || 0;
          for (let n = 1; n <= hr; n++) {
            events.push({ key: `mlb-hr-${g.gamePk}-${p.id}-${n}`, players: [p.id], matchId: String(g.gamePk),
              kind: 'goal', title: `⚾ ${p.name} 홈런!`, body: `${vs} 경기, ${p.name}${josa(p.name, '이', '가')} 홈런을 쳤습니다!`, silent: staleFinal });
          }
        }
        if (st === 'Final') {
          const played = involved.filter(didPlay);
          if (!played.length) continue;      // 아무도 안 뛴 경기는 알리지 않는다
          const hs = g.teams?.home?.score, as = g.teams?.away?.score;
          const lines = played.map((p) => {
            const bat = batOf(p);
            if (!bat) return null;
            const ab = parseInt(bat.atBats ?? 0) || 0, h = parseInt(bat.hits ?? 0) || 0;
            const hr = parseInt(bat.homeRuns ?? 0) || 0, rbi = parseInt(bat.rbi ?? 0) || 0;
            const parts = [`${ab}타수 ${h}안타`]; if (hr) parts.push(`${hr}홈런`); if (rbi) parts.push(`${rbi}타점`);
            return `${p.name} ${parts.join(' ')}`;
          }).filter(Boolean);
          const perf = lines.length ? ` · ${lines.join(', ')}` : '';
          events.push({ key: `mlb-result-${g.gamePk}`, players: played.map((p) => p.id), matchId: String(g.gamePk),
            kind: 'result', title: '⚾ 경기 종료', body: `${away} ${as} : ${hs} ${home}, 경기가 종료됐습니다.${perf}`, silent: staleFinal });
        }
      }
    }
  }
}

module.exports = async (req, res) => {
  // Optional gate for manual invocations.
  const secret = process.env.PUSH_CRON_SECRET;
  if (secret && req.query?.secret !== secret && req.headers['x-cron-secret'] !== secret) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!process.env.APNS_KEY || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'missing env (APNS_KEY / SUPABASE_SERVICE_KEY)' });
  }

  const events = [];
  const liveStates = [];
  try { await collectSoccer(events, liveStates); } catch (e) { console.warn('soccer', e?.message); }
  try { await collectBaseball(events); } catch (e) { console.warn('mlb', e?.message); }
  try { await collectNationalSchedule(events); } catch (e) { console.warn('nat-sched', e?.message); }

  // ── 라이브 액티비티 갱신 ────────────────────────────────────────────────
  // 알림 중복 제거(fresh)와 무관하게 먼저 처리한다 — 새 '알림'이 없어도
  // 점수·분은 계속 바뀌므로 잠금화면은 갱신돼야 한다.
  let liveSent = 0;
  if (liveStates.length) {
    try {
      const ids = liveStates.map((l) => l.matchId);
      const rows = await sbSelect('live_activity_tokens',
        `match_id=in.(${ids.map(encodeURIComponent).join(',')})&select=token,match_id`);
      if (Array.isArray(rows) && rows.length) {
        const jwtLA = apnsJWT();
        const cl = http2.connect(`https://${process.env.APNS_HOST || 'api.push.apple.com'}`);
        try {
          for (const l of liveStates) {
            for (const r of rows.filter((x) => String(x.match_id) === l.matchId)) {
              const res2 = await sendLiveActivity(cl, r.token, jwtLA, l.state, { end: l.ended });
              if (res2.status === 200) liveSent++;
            }
          }
        } finally { cl.close(); }
      }
    } catch (e) { console.warn('liveactivity', e?.message); }
  }

  // De-dup: keep only events not already in push_log. 한 번의 요청으로 끝낸다.
  const seenKey = new Set();
  const uniqueEvents = events.filter((ev) => ev.key && !seenKey.has(ev.key) && seenKey.add(ev.key));
  const inserted = await sbInsertLogBulk(uniqueEvents.map((ev) => ev.key));
  const fresh = uniqueEvents.filter((ev) => inserted.has(ev.key));
  if (!fresh.length) return res.status(200).json({ checked: events.length, sent: 0, liveSent });

  // Load all device tokens once.
  // notif_prefs 컬럼이 아직 없는 환경(마이그레이션 전/롤백)에서도 알림이 끊기지
  // 않게 한 번 더 시도한다. sbSelect 는 실패를 빈 배열로 돌려주므로, 컬럼이 없으면
  // 토큰 0개 = 아무에게도 안 보냄이 되어 푸시가 통째로 멈춘다(조용한 장애).
  // 폴백으로 받아오면 notif_prefs 가 undefined 라 allows() 가 전부 통과시킨다.
  let tokens = await sbSelect('device_tokens', 'select=token,player_ids,notif_prefs');
  if (!tokens.length) tokens = await sbSelect('device_tokens', 'select=token,player_ids');
  const jwt = apnsJWT();
  const client = http2.connect(`https://${process.env.APNS_HOST || 'api.push.apple.com'}`);
  let sent = 0, failed = 0, silenced = 0;
  // 알림 종류별 on/off. notif_prefs 가 없거나(구버전 앱) 해당 키가 없으면 보낸다 —
  // 설정을 모르는 기기의 알림을 조용히 끊는 것보다 낫다. 명시적으로 false 일 때만 막는다.
  const allows = (t, kind) => {
    if (!kind) return true;
    const p = t.notif_prefs;
    if (!p || typeof p !== 'object') return true;
    return p[kind] !== false;
  };
  try {
    for (const ev of fresh) {
      // silent 이벤트는 push_log 엔 이미 기록됐으니(처리 완료로 간주돼 재시도되지
      // 않는다) 여기서 실제 발송만 건너뛴다 — 뒤늦은 캐치업으로 낡은 알림이 나가는
      // 것을 막는다(af-done 처럼 원래 players:[] 라 자동으로 안 나가던 것과 달리,
      // 이제 진짜 알림에도 stale 판정이 붙으므로 이 체크가 필요하다).
      if (ev.silent) { silenced++; continue; }
      // 대표팀 경기는 팔로우와 무관하게 앱이 모두에게 보여주므로 알림도 전원에게
      // (설정 'national' 로만 끔) — player_ids 매칭을 건너뛴다.
      const targets = ev.broadcast
        ? tokens.filter((t) => allows(t, ev.kind))
        : tokens.filter((t) => Array.isArray(t.player_ids)
            && ev.players.some((pid) => t.player_ids.includes(pid))
            && allows(t, ev.kind));
      // matchId를 함께 보내면 앱이 알림 탭 시 해당 경기 상세로 바로 이동한다.
      // (축구=AF fixture id로 앱 경기 id와 일치. 야구는 gamePk라 앱 id와 달라
      //  앱이 제목·본문의 팀명으로 폴백 매칭한다.)
      const payload = { aps: { alert: { title: ev.title, body: ev.body }, sound: 'default' }, data: { key: ev.key, matchId: ev.matchId || null } };
      for (const t of targets) {
        const r = await sendOne(client, t.token, payload, jwt);
        if (r.status === 200) sent++; else failed++;
      }
    }
  } finally { client.close(); }

  return res.status(200).json({ checked: events.length, fresh: fresh.length, sent, failed, silenced, liveSent });
};

module.exports.nationalMatchEvents = nationalMatchEvents;
module.exports.isStaleEvent = isStaleEvent;
module.exports.minuteKey = minuteKey;
module.exports.stableKey = stableKey;
module.exports.isVarGoalCancelled = isVarGoalCancelled;
