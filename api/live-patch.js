// Vercel 함수: 라이브 패치(sf_cache 'live-patch') 공유 읽기 + 온디맨드 보강.
//
// push-cron 은 2분마다 패치를 쓴다(+ 실행 시간 → 앱에 닿기까지 2~4분). 이 함수는 앱이
// 30초마다 불러도 되도록 엣지 캐시(s-maxage=15)를 끼운 얇은 층이다:
//   · 패치에 '진행 중'이거나 '킥오프 직전·직후 NS' 경기가 있고 패치의 fat 이 40초보다
//     오래됐으면, API-Football /fixtures?live=all 을 한 번 불러 패치 경기의 상태·분·점수를
//     바로잡고(fat=at=지금) 행에 다시 쓴다 — 모든 기기가 같은 값을 공유한다.
//   · 아무 경기도 움직이지 않으면 AF 를 절대 부르지 않는다.
//   · 우리 선수 골·도움(p)과 MLB(games)는 건드리지 않는다 — 다음 크론 실행이 채운다.
//     (앱 lpSoccer 가 p 를 그대로 쓰므로 점수만 먼저 오르고 선수 골은 최대 2분 뒤 따라온다.)
// 응답은 패치 JSON(행의 events 모양 그대로). 어떤 오류든 보강 없이 행을 그대로 돌려준다.
//
// 환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY, APIFOOTBALL_KEY (push-cron 과 같다)
//
// AF 호출 상한: fat 이 40초 넘게 낡아야 부르므로 라이브 창에서 최대 ~1.5콜/분(+크론의
// live=all 0.5콜/분은 fat 을 갱신하므로 겹치면 오히려 줄어든다). 아래 보고 참고.

const AF_LIVE = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'INT', 'LIVE']);
const REFRESH_AFTER_MS = 30 * 1000;       // fat 이 이보다 오래됐을 때만 AF 호출
const CRON_ALIVE_MS = 10 * 60 * 1000;     // 크론이 이보다 오래 멈췄으면 보강하지 않는다(앱도 무시하는 패치)
const LIVE_MAX_SINCE_KO_MS = 4 * 3600e3;  // 킥오프 4시간 넘은 '진행 중'은 AF 가 멈춘 경기
const AF_TIMEOUT_MS = 6000;

// 같은 인스턴스 안에서 동시 호출이 AF 를 두 번 부르지 않게 하는 빗장.
let inflight = null;      // 진행 중인 보강 Promise
let lastRefreshMs = 0;    // 이 인스턴스가 마지막으로 AF 를 부른 시각

const sbHeaders = () => ({
  apikey: process.env.SUPABASE_SERVICE_KEY,
  authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
  'content-type': 'application/json',
});

async function readRow() {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/sf_cache?select=events,updated_at&date=eq.live-patch`,
    { headers: sbHeaders() });
  if (!r.ok) throw new Error('sb read ' + r.status);
  const rows = await r.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  return row && row.events && typeof row.events === 'object' ? row.events : null;
}

async function writeRow(patch) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/sf_cache`, {
    method: 'POST',
    headers: { ...sbHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ date: 'live-patch', events: patch, updated_at: patch.at }),
  });
  return r.ok;
}

// 보강이 필요한가: 움직이는(진행 중 / 킥오프 -3분~+30분 NS) 경기가 있고 fat 이 낡았는가.
function needsRefresh(patch, nowMs) {
  if (!patch || !patch.fixtures) return false;
  const fat = Date.parse(patch.fat) || 0;
  if (!fat || nowMs - fat < REFRESH_AFTER_MS) return false;
  // 크론 생존 판정 — cat(크론이 쓴 시각)은 첫 보강 때 at 에서 복사해 두고 이후 보강은 유지한다.
  const cat = Date.parse(patch.cat || patch.at) || 0;
  if (!cat || nowMs - cat > CRON_ALIVE_MS) return false;
  for (const f of Object.values(patch.fixtures)) {
    if (!f) continue;
    const ko = Date.parse(f.ko || f.fx?.fixture?.date) || 0;
    if (!ko) continue;
    const since = nowMs - ko;
    if (AF_LIVE.has(f.s) && since < LIVE_MAX_SINCE_KO_MS) return true;
    if (f.s === 'NS' && since > -3 * 60e3 && since < 30 * 60e3) return true;
  }
  return false;
}

// 순수 함수: live=all 응답(response 배열)을 패치에 얹은 새 패치를 돌려준다. 원본은 건드리지 않는다.
// 패치에 있는 경기만 고치고, live=all 에 없는 경기(방금 끝났거나 아직 시작 전)는 그대로 둔다.
function overlayPatch(patch, liveResponse, nowMs) {
  const out = { ...patch, fixtures: { ...patch.fixtures } };
  const iso = new Date(nowMs).toISOString();
  for (const l of liveResponse || []) {
    const id = l?.fixture?.id;
    const cur = id != null ? out.fixtures[id] : null;
    if (!cur) continue;
    const st = l.fixture.status || {};
    const n = { ...cur };
    if (st.short) n.s = st.short;
    n.el = st.elapsed != null ? st.elapsed : (cur.el ?? null);
    if (l.goals) { n.h = l.goals.home; n.a = l.goals.away; }
    if (cur.fx) {
      n.fx = { ...cur.fx, fixture: { ...cur.fx.fixture, status: l.fixture.status || cur.fx.fixture?.status } };
      if (l.goals) n.fx.goals = l.goals;
      if (l.score) n.fx.score = l.score;
    }
    out.fixtures[id] = n;
  }
  out.cat = patch.cat || patch.at;   // 크론이 쓴 시각 보존(보강이 at 을 올려도 크론 생존 판정은 유지)
  out.fat = iso;
  out.at = iso;
  return out;
}

async function afLive() {
  const key = process.env.APIFOOTBALL_KEY;
  if (!key) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), AF_TIMEOUT_MS);
  try {
    const r = await fetch('https://v3.football.api-sports.io/fixtures?live=all',
      { headers: { 'x-apisports-key': key }, signal: ctl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    const errs = j?.errors;
    const errN = Array.isArray(errs) ? errs.length : Object.keys(errs || {}).length;
    if (!Array.isArray(j?.response) || errN) return null;
    return j.response;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
    // 사용량 집계(프록시·크론과 같은 테이블). 실패는 무시한다.
    fetch(`${process.env.SUPABASE_URL}/rest/v1/af_usage`, {
      method: 'POST',
      headers: { ...sbHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({ path: 'fixtures', source: 'live-patch', ok: true, rate_limited: false }),
    }).catch(() => {});
  }
}

// 행을 읽어 필요하면 보강하고, 최종 패치를 돌려준다. 오류는 호출부가 잡는다.
// 골이 난 경기의 이벤트로 p(우리 선수 골·도움)를 다시 센다 — 크론 규칙과 같다(자책골·PK 실축 제외).
async function refreshScorers(prev, next) {
  const key = process.env.APIFOOTBALL_KEY;
  if (!key) return;
  const changed = Object.entries(next.fixtures || {}).filter(([id, f]) => {
    const o = prev.fixtures?.[id];
    return o && f.p && Object.keys(f.p).length && ((Number(f.h) || 0) + (Number(f.a) || 0)) > ((Number(o.h) || 0) + (Number(o.a) || 0));
  }).slice(0, 3);
  for (const [id, f] of changed) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), AF_TIMEOUT_MS);
    try {
      const r = await fetch(`https://v3.football.api-sports.io/fixtures/events?fixture=${id}`,
        { headers: { 'x-apisports-key': key }, signal: ctl.signal });
      const j = r.ok ? await r.json() : null;
      if (!Array.isArray(j?.response)) continue;
      const p = {};
      for (const pid of Object.keys(f.p)) p[pid] = { g: 0, a: 0 };
      for (const ev of j.response) {
        if (ev.type !== 'Goal' || ev.detail === 'Missed Penalty') continue;
        const sc = ev.player?.id != null ? String(ev.player.id) : null;
        const as = ev.assist?.id != null ? String(ev.assist.id) : null;
        if (sc && p[sc] && ev.detail !== 'Own Goal') p[sc].g++;
        if (as && p[as]) p[as].a++;
      }
      next.fixtures[id] = { ...f, p };
    } catch (e) { /* 다음 크론이 맞춘다 */ } finally { clearTimeout(timer); }
  }
}

async function loadPatch() {
  const patch = await readRow();
  if (!patch) return null;
  const now = Date.now();
  if (!needsRefresh(patch, now)) return patch;
  // 이 인스턴스가 방금 불렀거나(행 쓰기 지연 등) 진행 중이면 그 결과를 기다리거나 그대로 돌려준다.
  if (inflight) return inflight.then((p) => p || patch).catch(() => patch);
  if (now - lastRefreshMs < REFRESH_AFTER_MS / 2) return patch;
  lastRefreshMs = now;
  inflight = (async () => {
    const live = await afLive();
    if (!live) return null;
    const refreshed = overlayPatch(patch, live, Date.now());
    // 점수가 오른 경기만(=방금 골) 이벤트를 1회 받아 우리 선수 골·도움(p)도 즉시 맞춘다.
    // 골당 1콜이라 사용량은 미미하다. 대상 선수는 크론이 p 에 넣어 둔 id(소속팀 경기 참가자).
    await refreshScorers(patch, refreshed).catch(() => {});
    // 쓰기 직전에 다시 읽는다 — 그 사이 크론이 새로 썼다면(at 이 달라짐) 그 값을 존중하고 덮어쓰지 않는다.
    const latest = await readRow().catch(() => null);
    if (latest && latest.at !== patch.at) return latest;
    await writeRow(refreshed).catch(() => false);
    return refreshed;
  })().finally(() => { inflight = null; });
  return inflight.then((p) => p || patch).catch(() => patch);
}

async function handler(req, res) {
  // CORS: 네이티브 앱(capacitor://localhost)이 교차 출처로 부른다.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_KEY not configured' });
    return;
  }
  try {
    const patch = await loadPatch();
    if (!patch) { res.status(502).json({ error: 'no live-patch row' }); return; }
    res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=30');
    res.status(200).json(patch);
  } catch (e) {
    // 보강·쓰기 단계 오류는 loadPatch 안에서 삼켰다 — 여기는 행 읽기 실패.
    res.status(502).json({ error: String(e?.message || e) });
  }
}

module.exports = handler;
module.exports.overlayPatch = overlayPatch;
module.exports.needsRefresh = needsRefresh;
