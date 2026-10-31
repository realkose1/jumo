// Vercel 함수: 주막 응원방 TV 피드(/api/cheer-feed).
//
// 응원방 서버(Cloudflare Durable Object)가 사람이 있는 동안 ~15초마다 부른다. 우리 선수 경기를
// 방 안 TV 에 띄우고, 연속한 두 응답을 비교해 킥오프·우리 골·우리 선수 골·실점·종료 '순간'을
// 방 전체에 쏜다. 그래서 싸야 하고, id 가 안정적이어야 하고, 점수·골이 거꾸로 가면 안 된다.
// 응답 모양은 cheer-src/shared/cheer.ts 의 CheerFeed(v:1).
//
// 데이터 — 새 API-Football 호출은 없다:
//   · 축구: sf_cache 'live-patch' 행(push-cron 이 2분마다 쓰고, 앱이 부르는 /api/live-patch 가
//     라이브 중 30초 단위로 보강하는 그 행)을 읽기만 한다. 행엔 크론이 본 '오늘(UTC)' 목록만
//     들어 있어 자정 직후 킥오프·며칠 뒤 '다음 경기'는 sf_cache 날짜 행(YYYY-MM-DD, 앱·크론이
//     채우는 AF 슬림 목록)의 시작 전 경기로 채운다(인스턴스당 15분 재사용).
//   · 야구: 패치 games 중 지금 창 근처(킥오프 8시간 전후~70분 후) 경기만 statsapi(키 없음)
//     feed/live 를 필드만 골라 직접 받는다(경기당 ~20KB, 진행 중 8초 재사용). 상태·점수·이닝과
//     우리 선수 홈런(g)을 준다 — 패치엔 홈런이 없다. 실패하면 패치 값으로 버틴다.
//   · 선수 표·대표팀·차출 명단·팀명 한글화는 push-cron 것을 그대로 쓴다(복제 금지).
//
// id: 축구 = AF fixture id(앱 경기 id 와 같다). 야구 = 'mlbpatch-<gamePk>' — 앱 본 카드는 ESPN
// id 라 서버에서 맞출 수 없고, 이 꼴은 앱이 패치로 만드는 임시 카드 id 와 같다(lpFindGame 이 안다).
//
// 소스 고르기 + 단조 보장:
//   1) 같은 경기를 여러 소스가 주면 '더 진행된 상태'(종료 > 진행 > 예정)를, 같으면 데이터 시각이
//      더 새로운 쪽을 쓴다(축구 패치 = fat, 날짜 행 = updated_at, 야구 직접 = 받은 시각, 패치 = gat).
//      상태는 시간이 갈수록 앞으로만 가므로 '더 진행된 쪽'은 낡은 소스일 수 없다.
//   2) 그 위에 경기별 고수위(sf_cache 'cheer-feed-hw', 인스턴스끼리 공유)를 얹는다. 상태는 절대
//      뒤로 안 간다. 점수·선수 골(g)·도움(a)은 오르면 바로 올리고, 내려간 값은 이미 낸 상태만큼
//      진행된 관측이 8분 내내 그대로 보고할 때만 받아들인다(VAR 취소·기록 정정 — 덜 진행된 관측은
//      낡은 것이라 내릴 근거가 아니다). 크론이 live-patch 의 더 새 보강을 낡은
//      목록으로 덮는 경합, 방금 끝난 경기의 낡은 목록(최대 ~5분)은 이 창 안에서 끝나므로
//      1→0→1 같은 깜빡임이 방에 나가지 않는다. 선수 골은 팀 점수보다 늦게 올 수 있다(패치 p 는
//      골 이벤트를 받은 회차에만 채워진다).
//
// 창: matches = 진행 중 + 60분 안 시작 + 끝난 지 30분 안. 끝난 시각은 진행 중으로 본 뒤 종료를
// 처음 본 시각(고수위에 남김), 처음부터 종료로 봤으면 킥오프+경기 길이 어림. next = 창 밖에서 가장
// 가까운 예정 경기.
//
// 캐시: s-maxage=5, stale-while-revalidate=5. 방은 15초마다 부르므로 둘을 더해 15초보다 짧아야
// 방이 '자기 직전 호출 때 만든 응답'을 받지 않는다(SWR 이 길면 매번 한 주기 늦은 값을 받는다).
// 그 안에 여러 방·기기가 부르면 한 번만 계산한다. 아래 데이터가 30초~2분 단위로 바뀌니 5초면 충분.
//
// 실패: 어떤 오류든 500 을 내지 않는다 — 직전 성공 피드(15분 안, now 만 지금)나 빈 피드를 200 으로.
//
// 환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY (push-cron·live-patch 와 같다)

const {
  PLAYERS, NATIONAL_TEAMS, MANUAL_OUT, natNameFor, countryKo, teamMatches,
} = require('./push-cron.js');
// 응원 주막에는 영어를 쓰지 않는다: 팀·대회 이름을 한글로(api/team-ko.js)
const { teamKo, compKo } = require('./team-ko.js');

const WINDOW_PRE_MS = 60 * 60e3;        // 시작 60분 전부터 창에 넣는다
const WINDOW_FINAL_MS = 30 * 60e3;      // 끝나고 30분까지
const DROP_CONFIRM_MS = 8 * 60e3;       // 내려간 값은 이만큼 내내 보고돼야 인정
const SOCCER_TIMEOUT_MS = 160 * 60e3;   // 앱 transformApiFootballFixture 와 같은 규칙(진행 중 160분 = 끝)
const STALE_PRE_MS = 3 * 3600e3;        // 킥오프 3시간이 지나도 '예정'이면 버린다(연기·미갱신)
const HW_KEEP_MS = 12 * 3600e3;         // 고수위는 킥오프 12시간 뒤 버린다
const FAR_TTL_MS = 15 * 60e3;           // 날짜 행·MLB 일정 재사용
const FAR_DAYS = 6;
const LAST_GOOD_MAX_MS = 15 * 60e3;     // 이보다 오래된 직전 피드로는 버티지 않는다
const FETCH_TIMEOUT_MS = 4000;
const HW_KEY = 'cheer-feed-hw';
const KST_MS = 9 * 3600e3;

const SOCCER = PLAYERS.filter((p) => p.sport === 'soccer' && p.afTeamId);
const BASEBALL = PLAYERS.filter((p) => p.sport === 'baseball');
const BY_AF_ID = new Map(PLAYERS.filter((p) => p.afPlayerId).map((p) => [String(p.afPlayerId), p]));
const TRACKED_TEAM_IDS = new Set([...SOCCER.map((p) => p.afTeamId), ...Object.keys(NATIONAL_TEAMS).map(Number)]);
const ORDER_OF = new Map(PLAYERS.map((p, i) => [p.name, i]));   // 선수 순서 고정(소스가 바뀌어도 같은 순서)

// ── 공통 ────────────────────────────────────────────────────────────────
const sbHeaders = () => ({
  apikey: process.env.SUPABASE_SERVICE_KEY,
  authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
  'content-type': 'application/json',
});

async function getJson(url, opts = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    if (!r.ok) throw new Error(`${r.status} ${url.split('?')[0]}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

// sf_cache 여러 행을 한 번에. { [date]: { events, updated_at } }
async function sbRows(keys) {
  const list = keys.map((k) => `"${k}"`).join(',');
  const rows = await getJson(`${process.env.SUPABASE_URL}/rest/v1/sf_cache?select=date,events,updated_at&date=in.(${encodeURIComponent(list)})`,
    { headers: sbHeaders() });
  const out = {};
  for (const r of Array.isArray(rows) ? rows : []) out[r.date] = r;
  return out;
}

async function sbWriteHw(hw, nowMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 1500);
  try {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/sf_cache`, {
      method: 'POST', signal: ctl.signal,
      headers: { ...sbHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ date: HW_KEY, events: packHw(hw.m, hw.at), updated_at: new Date(nowMs).toISOString() }),
    });
  } finally { clearTimeout(timer); }
}

// ── 고수위 행은 믿지 않는다 ─────────────────────────────────────────────
// sf_cache 는 공개(anon) 키로도 쓸 수 있다(앱이 anon 으로 upsert 한다 — RLS 정의가 저장소에 없다).
// 그래서 행은 서버 비밀(SUPABASE_SERVICE_KEY)에서 뽑은 키로 HMAC 서명해 쓰고, 읽을 때 서명이 안
// 맞으면 통째로 버린다(이 인스턴스 기억으로). 서명이 맞는 값 = 이 함수가 실제 소스에서 본 값이라,
// 행은 낡은 소스에 맞서 값을 '붙잡을' 수만 있고 새 값을 '들여올' 수는 없다. 그래도 한 겹 더:
// 모양·범위를 검사해 틀린 기록은 버리고, at·low·fin 은 지금 이하로 자르고, 선수 이름은 PLAYERS
// 표에 있는 것만, 개수는 상한까지. 행은 경기를 만들지도 못한다(피드엔 이번에 관측된 경기만 나간다).
// jsonb 는 키 순서를 바꾸므로 본문은 문자열로 넣어 그 문자열 그대로 서명한다.
const crypto = require('crypto');
const PLAYER_NAMES = new Set(PLAYERS.map((p) => p.name));
const SOCCER_NAMES = new Set(PLAYERS.filter((p) => p.sport === 'soccer').map((p) => p.name));
const HW_MAX_RECS = 120, HW_MAX_KEYS = 64, HW_MAX_PS = 30;
const hwSecret = () => crypto.createHash('sha256').update(`cheer-feed-hw:${process.env.SUPABASE_SERVICE_KEY || ''}`).digest();
const hwSig = (at, body) => crypto.createHmac('sha256', hwSecret()).update(`${at}|${body}`).digest('base64url');
function packHw(m, at) {
  const body = JSON.stringify(m);
  return { v: 2, at, body, sig: hwSig(at, body) };
}
const intIn = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
const timeIn = (x, lo, hi) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
const hwKeyOk = (k) => k === 'h' || k === 'a' || (/^[ga]:/.test(k) && PLAYER_NAMES.has(k.slice(2)));
// 기록 하나를 검사해 깨끗한 사본으로. 틀리면 null(그 경기만 고수위 없이 간다).
function sanitizeRec(id, r, nowMs) {
  if (!/^(\d{1,10}|mlbpatch-\d{1,10})$/.test(id) || !r || typeof r !== 'object') return null;
  if (!timeIn(r.ko, nowMs - 2 * 86400e3, nowMs + 2 * 86400e3) || !intIn(r.st, 0, 2)) return null;
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  if (!isObj(r.v) || !isObj(r.low) || !isObj(r.ps)) return null;   // 이 함수가 쓰는 모양이 아니면 버린다
  const out = { ko: r.ko, st: r.st, v: {}, low: {}, ps: {} };
  if (r.fin != null) { if (!timeIn(r.fin, r.ko - 3600e3, nowMs)) return null; out.fin = r.fin; }
  for (const [k, x] of Object.entries(r.v && typeof r.v === 'object' ? r.v : {}).slice(0, HW_MAX_KEYS)) {
    if (!hwKeyOk(k) || !intIn(x, 0, (k === 'h' || k === 'a') ? 50 : 20)) return null;
    out.v[k] = x;
  }
  for (const [k, x] of Object.entries(r.low && typeof r.low === 'object' ? r.low : {}).slice(0, HW_MAX_KEYS)) {
    if (hwKeyOk(k) && timeIn(x, nowMs - 86400e3, nowMs)) out.low[k] = x;
  }
  for (const [n, s] of Object.entries(r.ps && typeof r.ps === 'object' ? r.ps : {}).slice(0, HW_MAX_PS)) {
    if (PLAYER_NAMES.has(n) && (s === 'home' || s === 'away')) out.ps[n] = s;
  }
  return out;
}
// 행(또는 기억) → { at, m } | null. 서명이 없거나 틀리면 null.
function unpackHw(raw, nowMs, { verify = true } = {}) {
  try {
    if (!raw || typeof raw !== 'object') return null;
    let m;
    if (verify) {
      if (typeof raw.body !== 'string' || typeof raw.sig !== 'string' || raw.body.length > 200e3) return null;
      const want = Buffer.from(hwSig(raw.at, raw.body)), got = Buffer.from(raw.sig);
      if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
      m = JSON.parse(raw.body);
    } else m = raw.m;
    if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
    const out = {};
    for (const [id, r] of Object.entries(m).slice(0, HW_MAX_RECS)) {
      const c = sanitizeRec(id, r, nowMs);
      if (c) out[id] = c;
    }
    const at = Math.min(Number.isFinite(Number(raw.at)) ? Number(raw.at) : 0, nowMs);
    return { v: 1, at, m: out };
  } catch (e) { return null; }
}

// sf_cache 의 live-patch·날짜 행도 같은 이유로 anon 이 쓸 수 있다 — 화면 글자는 길이를 자르고 제어문자를
// 빼며, 숫자는 상식 범위로 자른다(앱도 같은 행을 그대로 보여 주므로 근본 대책은 sf_cache 쓰기 권한이다).
const clean = (s, n = 40) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').slice(0, n);
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
const goalsNum = (v, hi = 50) => { const x = num(v); return x == null ? null : Math.max(0, Math.min(hi, Math.floor(x))); };
const kstDay = (ms) => new Date(ms + KST_MS).toISOString().slice(0, 10);
const RANK = { pre: 0, live: 1, final: 2 };
const STATES = ['pre', 'live', 'final'];

// '19:30 시작' / '내일 00:15 시작' / '11/3(화) 04:00 시작' (KST)
function startLabel(koMs, nowMs) {
  const k = new Date(koMs + KST_MS);
  const hm = `${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`;
  const day = kstDay(koMs);
  if (day === kstDay(nowMs)) return `${hm} 시작`;
  if (day === kstDay(nowMs + 86400e3)) return `내일 ${hm} 시작`;
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()}(${'일월화수목금토'[k.getUTCDay()]}) ${hm} 시작`;
}

// ── 축구(AF 모양) ────────────────────────────────────────────────────────
const AF_PRE = new Set(['NS', 'TBD']);
const AF_LIVE = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'INT', 'LIVE', 'SUSP']);
const AF_FINAL = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO', 'ABD']);
// PST·CANC(연기·취소)는 피드에서 뺀다.
const PHASE = { '1H': 1, HT: 2, '2H': 3, BT: 4, ET: 5, P: 6 };

const isManualOut = (p, koMs) => {
  const d = kstDay(koMs);
  return MANUAL_OUT.some((m) => m.ids.includes(p.id) && d >= m.from && d <= m.to);
};

// ── 명단 제외 확정 ──────────────────────────────────────────────────────
// 라인업이 나왔는데 우리 선수가 선발·벤치 어디에도 없으면 그 경기엔 안 나온다 — TV 에서 그 선수를
// 빼고, 남는 우리 선수가 없으면 경기째 뺀다(제보: 명단에 없는 백승호의 링컨전이 방에 걸렸다).
// 재료(새 AF 호출 없음): 앱이 경기 상세를 열 때 공유하는 sf_cache 'af-detail-<id>' 의 lineups(AF 원본,
// 팀별)와 패치 u(진행 중·종료 경기의 우리 선수 출전 정보, r:'x' = 명단 제외).
// AF 는 명단을 조각으로 낸다(실측: 킥오프 25분 전 선발 7명·벤치 0명) — 그 선수 자기 팀의 선발 11명과
// 벤치(5명 이상)가 다 찼을 때만 판정하고, 상대 팀 데이터는 보지 않는다(크론 라인업 알림과 같은 원칙).
// 행은 anon 도 쓸 수 있지만, 잘못된 행이 할 수 있는 건 TV 에서 경기를 빼는 것뿐이다.
const LINEUP_PRE_MS = 90 * 60e3;        // 킥오프 90분 전부터
const LINEUP_POST_MS = 4 * 3600e3;      // 킥오프 4시간 뒤까지 본다
function lineupTeams(lu) {
  const out = {};
  const ids = (list) => new Set((Array.isArray(list) ? list : []).map((e) => e?.player?.id).filter((x) => x != null));
  for (const t of Array.isArray(lu) ? lu : []) {
    const id = t?.team?.id;
    const xi = ids(t?.startXI), subs = ids(t?.substitutes);
    if (id != null && xi.size >= 11 && subs.size >= 5) out[id] = { xi, subs };
  }
  return out;
}
// info: { teams: { [afTeamId]: { xi, subs } }, out: Set(afPlayerId) } | null
const lineupOut = (p, info) => {
  if (!info) return false;
  if (info.out && info.out.has(String(p.afPlayerId))) return true;
  const t = info.teams && info.teams[p.afTeamId];
  return !!t && !t.xi.has(p.afPlayerId) && !t.subs.has(p.afPlayerId);
};

// ── 출전 정보 ───────────────────────────────────────────────────────────
// 명단에 든 우리 선수가 지금 그라운드에 있는지: 'start' 선발 · 'bench' 벤치 · 'in' 교체 투입 · 'off' 교체 아웃.
// 모르면 undefined(방 TV 는 예전처럼 적는다). 벤치 선수도 TV 에 '출전 중'으로 걸렸다(제보: 벤치 대기인 배준호).
// 재료(새 AF 호출 없음): 패치 u(크론이 라인업과 교체 이벤트로 판정 — 진행 중·종료 경기), 없으면 af-detail 명단.
const ROLE_RANK = { start: 1, bench: 1, in: 2, off: 3 };
function playerRole(p, u, lineup) {
  const v = u && typeof u === 'object' ? u[p.afPlayerId] : null;
  if (v && (v.r === 's' || v.r === 'b')) {
    if (v.o !== undefined) return 'off';
    if (v.r === 'b') return v.i !== undefined ? 'in' : 'bench';
    return 'start';
  }
  const t = lineup && lineup.teams && lineup.teams[p.afTeamId];
  if (t) return t.xi.has(p.afPlayerId) ? 'start' : t.subs.has(p.afPlayerId) ? 'bench' : undefined;
  return undefined;
}

// 패치 fixtures[id] 모양 { s, el, h, a, ko, p, u, fx } → 관측(obs). 우리 경기가 아니면 null.
// 우리 팀은 AF 팀 id 로만 잡는다(이름 매칭이 아니라 앱의 유스·여자팀 거르기가 필요 없다 —
// 그래서 박승수의 Newcastle U21 경기도 들어온다). lineup = 이 경기의 명단 판정(loadLineups, 없으면 null).
function soccerObs(id, f, stamp, nowMs, lineup = null) {
  const fx = f && f.fx;
  const H = fx?.teams?.home, A = fx?.teams?.away;
  if (!H || !A) return null;
  const s = f.s || fx.fixture?.status?.short || 'NS';
  if (!AF_PRE.has(s) && !AF_LIVE.has(s) && !AF_FINAL.has(s)) return null;
  const ko = Date.parse(f.ko || fx.fixture?.date) || 0;
  if (!ko) return null;
  const lg = fx.league || {};
  const natH = !!NATIONAL_TEAMS[H.id], natA = !!NATIONAL_TEAMS[A.id];
  const isNat = natH || natA;
  const pp = f.p && typeof f.p === 'object' ? f.p : null;   // 골 이벤트를 받은 회차에만 온다
  let pl;
  if (isNat) {
    // 대표팀 경기: 앱처럼 개인 명단은 모른다. 크론이 p 에 실은 우리 선수 기록(골·도움 있는 선수)만.
    const side = natH ? 'home' : 'away';
    pl = Object.entries(pp || {})
      .filter(([pid, v]) => BY_AF_ID.has(pid) && BY_AF_ID.get(pid).sport === 'soccer' && ((v?.g || 0) + (v?.a || 0)) > 0)
      .map(([pid, v]) => ({ name: BY_AF_ID.get(pid).name, side, g: goalsNum(v.g, 20) || 0, a: goalsNum(v.a, 20) || 0 }));
  } else {
    // 소속팀 경기: 그 팀 우리 선수 전원. 차출 기간 선수(앱 캐러셀과 같다)와 라인업에서 명단 제외가
    // 확정된 선수는 뺀다 — 주막은 같이 볼 경기를 거는 곳이라 안 나오는 게 정해진 경기는 걸지 않는다.
    // p 가 왔으면 그 회차는 이벤트를 다 본 것(크론은 소속팀 선수를 0 으로 채운다) — 없는 선수는 0.
    pl = SOCCER.filter((p) => (p.afTeamId === H.id || p.afTeamId === A.id) && !isManualOut(p, ko) && !lineupOut(p, lineup))
      .map((p) => {
        const v = pp ? pp[p.afPlayerId] : undefined;
        const out = { name: p.name, side: p.afTeamId === H.id ? 'home' : 'away', g: pp ? (goalsNum(v?.g, 20) || 0) : null, a: pp ? (goalsNum(v?.a, 20) || 0) : null };
        const role = playerRole(p, f.u, lineup);
        if (role) out.role = role;
        return out;
      });
    if (!pl.length) return null;
  }
  const timedOut = AF_LIVE.has(s) && nowMs - ko > SOCCER_TIMEOUT_MS;
  const st = (AF_FINAL.has(s) || timedOut) ? 'final' : AF_LIVE.has(s) ? 'live' : 'pre';

  // 대회 약칭·팀명 — 앱과 같은 규칙(올림픽 대표팀 친선은 'A매치'가 아니라 '친선', 대표팀 경기면 상대국 한글).
  const oly = natNameFor(H.id, lg.id) === '올림픽 대표팀' || natNameFor(A.id, lg.id) === '올림픽 대표팀';
  const tn = lg.name || '';
  // 대회는 한글 이름으로(앱의 TOURNEY_ABBR 약칭 EPL·GER 같은 영어 대신). 같은 이름을 쓰는 나라(오스트리아 분데스리가)는 나라로 가른다
  const comp = clean(oly ? '친선' : compKo(tn, lg.country), 16);
  const teamName = (t) => clean((NATIONAL_TEAMS[t.id] ? natNameFor(t.id, lg.id) : null)
    || (isNat ? countryKo(t.name || '', oly) : (t.name || ''))) || '?';

  // 진행 중 표시: 67' · 45+2' · HT …  prog 는 '분이 거꾸로 가지 않게' 비교용(구간·분·추가시간).
  const fst = fx.fixture?.status || {};
  const el = goalsNum(f.el ?? fst.elapsed, 150);
  const extra = (el === 45 || el === 90 || el === 105 || el === 120) ? (goalsNum(fst.extra, 30) || 0) : 0;
  const liveClock = s === 'HT' ? 'HT' : s === 'BT' ? '연장 전 휴식' : s === 'P' ? '승부차기'
    : (s === 'INT' || s === 'SUSP') ? '중단' : el == null ? '진행 중' : extra ? `${el}+${extra}'` : `${el}'`;
  const prog = PHASE[s] ? PHASE[s] * 10000 + (el || 0) * 100 + extra : null;
  const pen = fx.score?.penalty;
  const finClock = s === 'PEN' ? (goalsNum(pen?.home) != null ? `종료(승부차기 ${goalsNum(pen.home)}:${goalsNum(pen.away) ?? 0})` : '종료(승부차기)')
    : s === 'AET' ? '종료(연장)' : s === 'ABD' ? '종료(중단)' : (s === 'AWD' || s === 'WO') ? '종료(몰수)' : '종료';
  const sides = new Set(pl.map((p) => p.side));
  const side = isNat ? ((natH && natA) ? 'both' : natH ? 'home' : 'away')
    : sides.size > 1 ? 'both' : [...sides][0];
  return {
    id: String(id), sport: 'soccer', comp, ko, st, stamp,
    home: teamName(H), away: teamName(A),
    h: st === 'pre' ? null : goalsNum(f.h ?? fx.goals?.home), a: st === 'pre' ? null : goalsNum(f.a ?? fx.goals?.away),
    side, pl, nat: isNat, pAll: !!pp, liveClock, prog, finClock,
    dur: (s === 'AET' || s === 'PEN') ? 150 * 60e3 : 115 * 60e3,
  };
}

// ── 야구(statsapi) ──────────────────────────────────────────────────────
// feed/live 에서 필요한 필드만(전체 ~790KB → ~20KB): 상태·시각·팀·이닝·점수·박스스코어 홈런.
const MLB_FIELDS = 'gameData,datetime,dateTime,status,abstractGameState,detailedState,teams,home,away,name,id,'
  + 'liveData,linescore,currentInning,inningState,runs,boxscore,players,stats,batting,homeRuns';

async function fetchMlbGame(pk, nowMs = Date.now()) {
  const j = await getJson(`https://statsapi.mlb.com/api/v1.1/game/${pk}/feed/live?fields=${MLB_FIELDS}`);
  const gd = j?.gameData, ld = j?.liveData;
  if (!gd?.status || !gd?.teams) throw new Error('mlb shape');
  const ls = ld?.linescore || {};
  // 우리 선수 홈런 — 박스스코어에 없으면(현역 명단 밖) 0.
  const hr = {};
  for (const side of ['home', 'away']) {
    const pls = ld?.boxscore?.teams?.[side]?.players || {};
    for (const p of BASEBALL) {
      const e = pls[`ID${p.mlbId}`];
      if (e) hr[p.mlbId] = goalsNum(e.stats?.batting?.homeRuns, 20) || 0;
    }
  }
  return {
    pk: String(pk), abs: gd.status.abstractGameState || '', det: gd.status.detailedState || '',
    ko: Date.parse(gd.datetime?.dateTime) || 0, hn: gd.teams.home?.name || '', an: gd.teams.away?.name || '',
    h: num(ls.teams?.home?.runs), a: num(ls.teams?.away?.runs),
    inn: ls.currentInning ? `${ls.inningState || ''} ${ls.currentInning}`.trim() : '',
    hr, at: nowMs,
  };
}

// 직접 받은 값 / 패치 games[pk] → 공통 입력
function fromMlbDirect(d) {
  if (!d || /Postponed|Cancel/i.test(d.det)) return null;
  const st = d.abs === 'Final' ? 'final'
    : (d.abs === 'Live' && !/^(Warmup|Pre-Game)$/i.test(d.det)) ? 'live' : 'pre';
  return { pk: d.pk, st, ko: d.ko, hn: d.hn, an: d.an, h: d.h, a: d.a, inn: d.inn, det: d.det, hr: d.hr, stamp: d.at };
}
function fromMlbPatch(pk, g, stamp) {
  if (!g) return null;
  // 크론은 진행 중일 때만 inn 을 채운다 — 'Live' 인데 이닝이 없으면 워밍업(아직 시작 전)으로 본다.
  const st = g.s === 'Final' ? 'final' : (g.s === 'Live' && g.inn) ? 'live' : 'pre';
  return { pk: String(pk), st, ko: Date.parse(g.ko) || 0, hn: g.hn, an: g.an, h: g.h, a: g.a, inn: g.inn || '', det: '', hr: null, stamp };
}

const HALF = { Top: 0, Middle: 1, Bottom: 2, End: 3 };
const HALF_KO = { Top: '초', Middle: '중간', Bottom: '말', End: '종료' };   // 앱 lpInning 과 같은 말

function mlbObs(x) {
  if (!x || !x.hn || !x.an || !x.ko) return null;
  const isHome = (p) => teamMatches(x.hn, p.mlbTeam);
  // 우리 선수 = 그 팀 선수 전원(push-cron 과 같은 팀명 매칭). g = 홈런, 모르면 null.
  const pl = BASEBALL.filter((p) => isHome(p) || teamMatches(x.an, p.mlbTeam))
    .map((p) => ({ name: p.name, side: isHome(p) ? 'home' : 'away', g: x.hr ? (x.hr[p.mlbId] || 0) : null }));
  if (!pl.length) return null;
  const sides = new Set(pl.map((p) => p.side));
  const m = /^([A-Za-z]+)\s+(\d+)$/.exec(x.inn || '');
  const inning = m ? `${m[2]}회${HALF_KO[m[1]] || ''}` : '';
  return {
    id: `mlbpatch-${x.pk}`, sport: 'baseball', comp: '메이저리그', ko: x.ko, st: x.st, stamp: x.stamp || 0,
    home: clean(x.hn), away: clean(x.an),
    h: x.st === 'pre' ? null : goalsNum(x.h), a: x.st === 'pre' ? null : goalsNum(x.a),
    side: sides.size > 1 ? 'both' : [...sides][0], pl,
    liveClock: (inning || '진행 중') + (/Delayed|Suspended/i.test(x.det || '') ? ' 중단' : ''),
    prog: m && HALF[m[1]] != null ? Number(m[2]) * 4 + HALF[m[1]] : null,
    finClock: '종료', dur: 190 * 60e3,
  };
}

// ── 피드 만들기(순수 함수 — 시각·입력을 넣어 재현할 수 있다) ───────────────
// 같은 경기 관측 둘 중 하나: 더 진행된 상태, 같으면 더 새 데이터 시각.
function pickObs(a, b) {
  if (RANK[b.st] !== RANK[a.st]) return RANK[b.st] > RANK[a.st] ? b : a;
  return (b.stamp || 0) >= (a.stamp || 0) ? b : a;
}

// 고수위 한 칸: 오르면 바로, 내려가면 DROP_CONFIRM_MS 내내 낮을 때만. 모르면(null) 그대로.
// canDrop=false: 이미 낸 상태보다 덜 진행된(= 낡은) 관측 — 내리는 근거로 쓰지 않는다.
function settle(rec, key, val, nowMs, canDrop = true) {
  const cur = rec.v[key];
  if (val == null) return cur ?? null;
  if (cur == null || val >= cur) { rec.v[key] = val; delete rec.low[key]; return val; }
  if (!canDrop) return cur;
  const since = rec.low[key] ?? (rec.low[key] = nowMs);
  if (nowMs - since >= DROP_CONFIRM_MS) { rec.v[key] = val; delete rec.low[key]; return val; }
  return cur;
}

// input: { nowMs, patch, far: {soccer:[{id,f,stamp}], mlb:[{pk,g,stamp}]}, mlbLive: Map(pk → fetchMlbGame 결과),
//          hw: {v:1, at, m:{}}(제자리에서 고친다), clocks: Map(경기 id → 직전 진행 표시),
//          recent: Map(경기 id → 직전에 낸 진행 중·종료 경기),
//          lineups: Map(경기 id → 명단 판정, loadLineups) | null,
//          roles: Map(경기 id → { 선수 이름: 직전에 낸 출전 정보 }) }
const ORDER = { live: 0, pre: 1, final: 2 };
const RECENT_KEEP_MS = 5 * 60e3;
function buildFeed({ nowMs, patch, far, mlbLive, hw, clocks = new Map(), recent = new Map(), lineups = null, roles = new Map() }) {
  const obs = new Map();
  // 입력 행은 anon 도 쓸 수 있다 — 한 경기의 이상한 값이 피드 전체를 깨지 않게 경기마다 따로 잡는다.
  const put = (make) => {
    let o = null;
    try { o = make(); } catch (e) { o = null; }
    if (!o) return;
    const cur = obs.get(o.id); obs.set(o.id, cur ? pickObs(cur, o) : o);
  };
  const fat = Date.parse(patch?.fat) || 0, gat = Date.parse(patch?.gat) || 0;
  const entries = (x) => (x && typeof x === 'object' ? Object.entries(x) : []);
  const idOk = (x) => /^\d{1,10}$/.test(String(x));   // 행의 키가 그대로 id·statsapi 경로가 된다
  const lineupOf = (id) => (lineups && lineups.get(String(id))) || null;
  for (const [id, f] of entries(patch?.fixtures)) if (idOk(id)) put(() => soccerObs(id, f, fat, nowMs, lineupOf(id)));
  for (const c of far?.soccer || []) put(() => soccerObs(c.id, c.f, c.stamp, nowMs, lineupOf(c.id)));
  for (const [pk, g] of entries(patch?.games)) if (idOk(pk)) put(() => mlbObs(fromMlbPatch(pk, g, gat)));
  for (const d of (mlbLive || new Map()).values()) put(() => mlbObs(fromMlbDirect(d)));
  for (const c of far?.mlb || []) put(() => mlbObs(fromMlbPatch(c.pk, c.g, c.stamp)));

  const inWin = [], later = [];
  for (const o of obs.values()) {
   try {
    let rec = hw.m[o.id];
    if (rec && (typeof rec !== 'object' || !rec.v || !rec.low || !rec.ps || !intIn(rec.st, 0, 2))) { delete hw.m[o.id]; rec = undefined; }
    // 창 밖의 예정 경기는 지킬 값이 없다 — 고수위에 올리지 않는다(행을 작게).
    if (!rec && o.st === 'pre' && o.ko - nowMs > WINDOW_PRE_MS) { later.push(toMatch(o, null, nowMs, clocks, roles)); continue; }
    if (!rec && o.st === 'pre' && nowMs - o.ko > STALE_PRE_MS) continue;
    // 처음 보는데 이미 창 밖으로 끝난 경기(어제 경기 등)도 지킬 게 없다.
    if (!rec && o.st === 'final' && nowMs - Math.min(nowMs, o.ko + o.dur) > WINDOW_FINAL_MS) continue;
    if (!rec) rec = hw.m[o.id] = { ko: o.ko, st: 0, v: {}, low: {}, ps: {} };
    rec.ko = o.ko;
    const r = RANK[o.st];
    if (r > rec.st) {
      // 끝난 시각: 진행 중으로 본 경기면 지금(종료를 처음 본 때), 아니면 킥오프 + 경기 길이 어림.
      if (r === 2) rec.fin = (rec.st === 1 && nowMs - o.ko < 2 * o.dur) ? nowMs : Math.min(nowMs, o.ko + o.dur);
      rec.st = r;
    }
    if (rec.st === 2 && !rec.fin) rec.fin = Math.min(nowMs, o.ko + o.dur);
    const m = toMatch(o, rec, nowMs, clocks, roles);
    if (m.state === 'pre' && nowMs - o.ko > STALE_PRE_MS) continue;
    if (m.state === 'live') inWin.push(m);
    else if (m.state === 'pre') (o.ko - nowMs <= WINDOW_PRE_MS ? inWin : later).push(m);
    else if (nowMs - rec.fin <= WINDOW_FINAL_MS) inWin.push(m);
   } catch (e) { delete hw.m[o.id]; }   // 이 경기만 빠진다
  }
  // 이번 관측에서 빠진 진행 중·막 끝난 경기(크론 한 회차가 목록을 못 받은 경우 등)는 5분 동안 직전
  // 모습 그대로 둔다 — id 가 사라졌다 다시 나타나면 방이 킥오프를 두 번 쏠 수 있다. 예정 경기는
  // 연기·취소일 수 있어 붙잡지 않는다.
  for (const [id, r] of recent) {
    if (obs.has(id)) continue;
    const rec = hw.m[id];
    if (nowMs - r.at > RECENT_KEEP_MS || !rec) { recent.delete(id); continue; }
    if (r.m.state === 'live' || (r.m.state === 'final' && nowMs - rec.fin <= WINDOW_FINAL_MS)) inWin.push(r.m);
  }
  for (const m of inWin) if (m.state !== 'pre' && obs.has(m.id)) recent.set(m.id, { m, at: nowMs });
  // 오래된 고수위·표시 기억 정리
  for (const [id, rec] of Object.entries(hw.m)) {
    if (!rec || !(rec.ko > nowMs - HW_KEEP_MS)) delete hw.m[id];
  }
  for (const id of [...clocks.keys()]) if (!obs.has(id) && !recent.has(id)) clocks.delete(id);
  for (const id of [...roles.keys()]) if (!obs.has(id) && !recent.has(id)) roles.delete(id);

  inWin.sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.ko - b.ko);
  later.sort((a, b) => a.ko - b.ko);
  return { v: 1, now: nowMs, matches: inWin, next: later.find((m) => m.state === 'pre') || null };
}

// 관측 + 고수위 → CheerMatch. rec 가 없으면(창 밖 예정 경기) 관측 그대로.
function toMatch(o, rec, nowMs, clocks, roles) {
  const st = rec ? STATES[rec.st] : o.st;
  const canDrop = !rec || RANK[o.st] >= rec.st;
  let h = null, a = null;
  if (rec) { h = settle(rec, 'h', o.h, nowMs, canDrop); a = settle(rec, 'a', o.a, nowMs, canDrop); }
  // 선수: 이번 관측 + 이 경기에서 한 번이라도 본 선수(대표팀 득점자가 낡은 행에서 빠져도 남게).
  const names = [], sideOf = {};
  for (const p of o.pl) { if (!(p.name in sideOf)) names.push(p.name); sideOf[p.name] = p.side; }
  if (rec) {
    for (const p of o.pl) {
      rec.ps[p.name] = p.side;
      settle(rec, `g:${p.name}`, p.g, nowMs, canDrop);
      if (o.sport === 'soccer') settle(rec, `a:${p.name}`, p.a, nowMs, canDrop);
    }
    // 지난 관측에서 본 선수를 되살리는 건 대표팀 경기(득점자만 실림)뿐이다. 소속팀·MLB 는 이번 관측의
    // 명단(PLAYERS 의 그 팀 선수)이 전부 — 저장된 이름이 명단을 늘리지 못한다.
    for (const [n, s] of o.nat ? Object.entries(rec.ps) : []) {
      if (n in sideOf || !SOCCER_NAMES.has(n) || (s !== 'home' && s !== 'away') || names.length >= HW_MAX_PS) continue;
      names.push(n); sideOf[n] = s;
      // 대표팀 p 는 기록 있는 선수만 싣는다 — p 가 왔는데 빠졌으면 이번 관측은 0(VAR 취소 등, 8분 규칙을 탄다).
      if (o.pAll) { settle(rec, `g:${n}`, 0, nowMs, canDrop); settle(rec, `a:${n}`, 0, nowMs, canDrop); }
    }
  }
  // 출전 정보는 앞으로만 간다(벤치 → 투입 → 아웃, 선발 → 아웃). 크론이 이벤트를 못 받은 회차엔 패치 u 가
  // 빠지고 명단(선발·벤치)만 남으니, 이 인스턴스가 이미 낸 투입·아웃을 벤치로 되돌리지 않는다.
  const seen = (roles && roles.get(o.id)) || {};
  const roleOf = {};
  for (const p of o.pl) {
    const r = p.role && (ROLE_RANK[seen[p.name]] || 0) > ROLE_RANK[p.role] ? seen[p.name] : (p.role || seen[p.name]);
    if (r) roleOf[p.name] = r;
  }
  if (roles && Object.keys(roleOf).length) roles.set(o.id, roleOf);
  const players = names.map((n) => {
    const p = { name: n, side: sideOf[n], g: rec ? (rec.v[`g:${n}`] ?? 0) : 0 };
    if (o.sport === 'soccer') p.a = rec ? (rec.v[`a:${n}`] ?? 0) : 0;
    if (roleOf[n]) p.role = roleOf[n];
    return p;
  }).sort((x, y) => (x.side === y.side ? (ORDER_OF.get(x.name) ?? 99) - (ORDER_OF.get(y.name) ?? 99) : x.side === 'home' ? -1 : 1));

  // 표시: 진행 중 분·이닝도 거꾸로 가지 않게(같은 경기에서 더 진행된 표시를 이미 냈으면 그걸 유지).
  let clock;
  if (st === 'pre') clock = startLabel(o.ko, nowMs);
  else if (st === 'final') clock = o.st === 'final' ? o.finClock : '종료';
  else {
    const prev = clocks.get(o.id);
    if (o.st !== 'live') clock = prev?.clock || '진행 중';
    else if (prev && o.prog != null && prev.prog != null && o.prog < prev.prog) clock = prev.clock;
    else { clock = o.liveClock; clocks.set(o.id, { clock, prog: o.prog }); }
  }

  const sides = new Set(players.map((p) => p.side));
  const side = o.side || (sides.size > 1 ? 'both' : sides.size ? [...sides][0] : null);
  return {
    id: o.id, sport: o.sport, comp: o.comp,
    home: { name: koTeam(o.home), score: st === 'pre' ? null : (h ?? 0) },
    away: { name: koTeam(o.away), score: st === 'pre' ? null : (a ?? 0) },
    side, state: st, clock, ko: o.ko, players,
  };
}

// 팀 이름을 한글로. 표에 없는 이름은 영어로 내보내지 않고 '상대 팀'으로
function koTeam(name) {
  const ko = teamKo(name);
  return /[A-Za-z]/.test(ko) ? '상대 팀' : ko;
}

// ── 입출력 ──────────────────────────────────────────────────────────────
// 인스턴스 기억: 직전 성공 피드(실패 시), 고수위(공유 행을 못 읽었을 때·쓰기 실패 대비), 진행 표시,
// 야구 직접 조회, 먼 일정.
let lastGood = null;
let hwMemo = { v: 1, at: 0, m: {} };
const clocks = new Map();
const roles = new Map();       // 경기 id → { 선수 이름: 직전에 낸 출전 정보 }
const recent = new Map();
const mlbMemo = new Map();      // pk → { at, data }
let farMemo = { at: -Infinity, soccer: [], mlb: [] };
// 경기 id → { ko, teams, out } — 명단은 안 바뀌므로 한 번 본 판정은 붙잡는다(행 읽기에 실패하거나
// 패치에 u 가 빠진 회차에 경기가 TV 에 다시 나타났다 사라지며 킥오프를 두 번 쏘지 않게).
const lineupMemo = new Map();

// 킥오프 90분 전 ~ 4시간 뒤의 소속팀 경기만 명단을 본다. 행에서 lineups 만 잘라 읽는다(수 KB).
async function loadLineups(patch, nowMs) {
  const ids = [];
  for (const [id, f] of Object.entries(patch?.fixtures || {})) {
    if (!/^\d{1,10}$/.test(id) || !f || typeof f !== 'object') continue;
    const H = f.fx?.teams?.home?.id, A = f.fx?.teams?.away?.id;
    if (NATIONAL_TEAMS[H] || NATIONAL_TEAMS[A]) continue;
    if (!SOCCER.some((p) => p.afTeamId === H || p.afTeamId === A)) continue;
    const ko = Date.parse(f.ko || f.fx?.fixture?.date) || 0;
    if (!ko || ko - nowMs > LINEUP_PRE_MS || nowMs - ko > LINEUP_POST_MS) continue;
    ids.push(id);
    const m = lineupMemo.get(id) || { ko, teams: {}, out: new Set() };
    m.ko = ko;
    lineupMemo.set(id, m);
    // 패치 u 의 명단 제외(r:'x') — 크론이 라인업으로 판정한 값
    for (const [pid, v] of Object.entries(f.u && typeof f.u === 'object' ? f.u : {})) {
      if (v && v.r === 'x' && BY_AF_ID.has(pid)) m.out.add(pid);
    }
  }
  const list = ids.slice(0, 20);
  if (list.length) {
    try {
      const keys = list.map((id) => `"af-detail-${id}"`).join(',');
      const rows = await getJson(`${process.env.SUPABASE_URL}/rest/v1/sf_cache?select=date,lu:events->lineups&date=in.(${encodeURIComponent(keys)})`,
        { headers: sbHeaders() });
      for (const r of Array.isArray(rows) ? rows : []) {
        const m = lineupMemo.get(String(r?.date || '').replace('af-detail-', ''));
        if (m) Object.assign(m.teams, lineupTeams(r.lu));   // 한 번 다 찬 팀 명단은 그대로 둔다
      }
    } catch (e) { /* 읽기 실패 — 기억한 판정으로 간다 */ }
  }
  for (const [id, m] of lineupMemo) if (nowMs - m.ko > LINEUP_POST_MS + 3600e3) lineupMemo.delete(id);
  return lineupMemo;
}

// 패치 games 중 지금 창 근처 경기만 statsapi 로 직접 확인한다.
async function mlbDirect(patch, nowMs) {
  const games = patch?.games || {};
  const pks = Object.keys(games).filter((pk) => {
    if (!/^\d{1,10}$/.test(pk)) return false;
    const ko = Date.parse(games[pk]?.ko) || 0;
    return ko && ko > nowMs - 8 * 3600e3 && ko - nowMs < WINDOW_PRE_MS + 10 * 60e3;
  });
  const out = new Map();
  await Promise.all(pks.map(async (pk) => {
    const memo = mlbMemo.get(pk);
    const ko = Date.parse(games[pk]?.ko) || 0;
    // 재사용: 끝난 경기는 계속, 진행 중·10분 안 시작은 8초, 그 밖의 예정은 1분.
    const ttl = !memo ? 0 : memo.data.abs === 'Final' ? Infinity
      : (memo.data.abs === 'Live' || ko - nowMs < 10 * 60e3) ? 8e3 : 60e3;
    if (memo && nowMs - memo.at < ttl) { out.set(pk, memo.data); return; }
    try {
      const d = await fetchMlbGame(pk, nowMs);
      mlbMemo.set(pk, { at: nowMs, data: d });
      out.set(pk, d);
    } catch (e) {
      if (memo) out.set(pk, memo.data);   // 실패하면 직전 값(없으면 패치 값만)
    }
  }));
  for (const [pk, m] of mlbMemo) if (nowMs - m.at > 86400e3) mlbMemo.delete(pk);
  return out;
}

// 패치(오늘 UTC 목록·24시간)에 없는 예정 경기: 날짜 행 FAR_DAYS 일 + MLB 일정. 15분 재사용.
// 시작 전 경기만 쓴다 — 상태·점수는 늘 패치·직접 조회가 더 새롭다.
async function farCandidates(nowMs) {
  if (nowMs - farMemo.at < FAR_TTL_MS && nowMs >= farMemo.at) return farMemo;
  const days = Array.from({ length: FAR_DAYS }, (_, i) => new Date(nowMs + i * 86400e3).toISOString().slice(0, 10));
  const [rows, sched] = await Promise.all([
    sbRows(days).catch(() => null),
    getJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${days[0]}&endDate=${days[days.length - 1]}`
      + '&fields=dates,games,gamePk,gameDate,status,abstractGameState,detailedState,teams,home,away,team,name').catch(() => null),
  ]);
  const soccer = rows ? [] : farMemo.soccer;
  for (const d of rows ? days : []) {
    const r = rows[d];
    const stamp = Date.parse(r?.updated_at) || 0;
    for (const fx of Array.isArray(r?.events) ? r.events : []) {
      const s = fx?.fixture?.status?.short;
      if (!/^\d{1,10}$/.test(String(fx?.fixture?.id ?? '')) || !AF_PRE.has(s)) continue;
      if (!TRACKED_TEAM_IDS.has(fx.teams?.home?.id) && !TRACKED_TEAM_IDS.has(fx.teams?.away?.id)) continue;
      soccer.push({ id: String(fx.fixture.id), f: { s, el: null, h: null, a: null, ko: fx.fixture.date, fx }, stamp });
    }
  }
  const mlb = sched ? [] : farMemo.mlb;
  for (const day of sched?.dates || []) {
    for (const g of day.games || []) {
      if (g.status?.abstractGameState !== 'Preview' || /Postponed|Cancel/i.test(g.status?.detailedState || '')) continue;
      const hn = g.teams?.home?.team?.name, an = g.teams?.away?.team?.name;
      if (!BASEBALL.some((p) => teamMatches(hn, p.mlbTeam) || teamMatches(an, p.mlbTeam))) continue;
      mlb.push({ pk: String(g.gamePk), g: { s: 'Preview', ko: g.gameDate, hn, an, h: null, a: null, inn: '' }, stamp: 0 });
    }
  }
  farMemo = { at: (rows || sched) ? nowMs : farMemo.at, soccer, mlb };
  return farMemo;
}


async function loadFeed(nowMs = Date.now()) {
  // 패치와 공유 고수위를 한 요청으로.
  const rows = await sbRows(['live-patch', HW_KEY]);
  const patch = rows['live-patch']?.events;
  if (!patch || typeof patch !== 'object') throw new Error('no live-patch row');
  // 고수위: 공유 행과 이 인스턴스 기억 중 더 최근에 바뀐 쪽(쓰기에 실패한 우리 값도 잃지 않게).
  const shared = unpackHw(rows[HW_KEY]?.events, nowMs);   // 서명·모양 검사, 실패하면 null
  const base = (shared && (shared.at || 0) >= (hwMemo.at || 0)) ? shared : hwMemo;
  const before = JSON.stringify(base.m);
  const hw = { v: 1, at: base.at || 0, m: JSON.parse(before) };

  const [far, mlbLive, lineups] = await Promise.all([
    farCandidates(nowMs).catch(() => farMemo),
    mlbDirect(patch, nowMs).catch(() => new Map()),
    loadLineups(patch, nowMs).catch(() => lineupMemo),
  ]);
  const feed = buildFeed({ nowMs, patch, far, mlbLive, hw, clocks, recent, lineups, roles });
  if (JSON.stringify(hw.m) !== before) {
    hw.at = nowMs;
    hwMemo = hw;
    await sbWriteHw(hw, nowMs).catch(() => {});
  } else if (base !== hwMemo) hwMemo = hw;
  lastGood = { feed, at: nowMs };
  return feed;
}

async function handler(req, res) {
  // CORS: 응원방 서버(Cloudflare)·웹·앱이 교차 출처로 부른다.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.status(405).json({ error: 'GET only' }); return; }
  const now = Date.now();
  let feed;
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE env missing');
    feed = await loadFeed(now);
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=5, stale-while-revalidate=5');
  } catch (e) {
    // 어떤 오류든 방이 받을 수 있는 200 으로 — 직전 성공 피드(15분 안), 없으면 빈 피드.
    console.warn('cheer-feed', e?.message || e);
    feed = (lastGood && now - lastGood.at < LAST_GOOD_MAX_MS)
      ? { ...lastGood.feed, now }
      : { v: 1, now, matches: [], next: null };
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=2');
  }
  res.status(200).json(feed);
}

module.exports = handler;
module.exports.buildFeed = buildFeed;
module.exports.soccerObs = soccerObs;
module.exports.fetchMlbGame = fetchMlbGame;
module.exports.loadFeed = loadFeed;
module.exports.farCandidates = farCandidates;
module.exports.loadLineups = loadLineups;
module.exports.lineupTeams = lineupTeams;
module.exports.packHw = packHw;
module.exports.unpackHw = unpackHw;
module.exports.DROP_CONFIRM_MS = DROP_CONFIRM_MS;
