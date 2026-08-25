// Vercel Cron → APNs push sender for Jumo.
//
// Detects events for the Korean players (match start, goal/assist/card by a
// Korean player, final result) from the same sources the app uses —
// API-Football for soccer (covers friendlies & cups that ESPN league
// scoreboards miss; exact player-ID event attribution), MLB StatsAPI for
// baseball — de-duplicates them against a Supabase `push_log` table, and
// delivers an APNs alert to every device whose followed players are involved.
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
  { id: 6,  name: '황희찬', nameEn: 'Hwang Hee-chan', sport: 'soccer', team: 'Wolves',      afTeamId: 39,   afPlayerId: 24888, espnLeague: 'eng.2', espnTeamId: 380 },
  { id: 7,  name: '황인범', nameEn: 'Hwang In-beom', sport: 'soccer', team: 'Porto',       afTeamId: 212,  afPlayerId: 2901, espnLeague: 'por.1', espnTeamId: 437 },
  { id: 8,  name: '조규성', nameEn: 'Cho Gue-sung', sport: 'soccer', team: 'Midtjylland', afTeamId: 397,  afPlayerId: 34211, espnLeague: 'den.1', espnTeamId: 572 },
  { id: 25, name: '이한범', nameEn: 'Lee Han-Beom', sport: 'soccer', team: 'Club Brugge', afTeamId: 569,  afPlayerId: 237218, espnLeague: 'bel.1', espnTeamId: 570 },
  { id: 19, name: '오현규', nameEn: 'Oh Hyeon-gyu', sport: 'soccer', team: 'Besiktas',    afTeamId: 549,  afPlayerId: 34710, espnLeague: 'tur.1', espnTeamId: 1895 },
  { id: 20, name: '양현준', nameEn: 'Yang Hyun-jun', sport: 'soccer', team: 'Celtic',      afTeamId: 247,  afPlayerId: 304958, espnLeague: 'sco.1', espnTeamId: 256 },
  { id: 21, name: '백승호', nameEn: 'Paik Seung-ho', sport: 'soccer', team: 'Birmingham',  afTeamId: 54,   afPlayerId: 2909, espnLeague: 'eng.2', espnTeamId: 392 },
  { id: 22, name: '배준호', nameEn: 'Bae Jun-ho', sport: 'soccer', team: 'Stoke',       afTeamId: 75,   afPlayerId: 357286, espnLeague: 'eng.2', espnTeamId: 336 },
  { id: 23, name: '엄지성', nameEn: 'Eom Ji-sung', sport: 'soccer', team: 'Swansea',     afTeamId: 76,   afPlayerId: 237050, espnLeague: 'eng.2', espnTeamId: 318 },
  { id: 24, name: '설영우', nameEn: 'Seol Young-woo', sport: 'soccer', team: 'Crvena',      afTeamId: 598,  afPlayerId: 197985, espnLeague: 'srb.1', espnTeamId: 2290 },
  { id: 26, name: '이재성', nameEn: 'Lee Jae-sung', sport: 'soccer', team: 'Mainz',        afTeamId: 164,  afPlayerId: 2906, espnLeague: 'ger.1', espnTeamId: 2950 },
  { id: 27, name: '홍현석', nameEn: 'Hong Hyun-seok', sport: 'soccer', team: 'Mainz',        afTeamId: 164,  afPlayerId: 26519, espnLeague: 'ger.1', espnTeamId: 2950 },
  { id: 28, name: '정우영', nameEn: 'Jeong Woo-yeong', sport: 'soccer', team: 'Union Berlin', afTeamId: 182,  afPlayerId: 512, espnLeague: 'ger.1', espnTeamId: 598 },
  { id: 29, name: '카스트로프', nameEn: 'Jens Castrop', sport: 'soccer', team: 'Gladbach',   afTeamId: 163,  afPlayerId: 280358, espnLeague: 'ger.1', espnTeamId: 268 },
  { id: 30, name: '박승수', nameEn: 'Park Seung-soo', sport: 'soccer', team: 'Newcastle',    afTeamId: 34,   afPlayerId: 423714, espnLeague: 'eng.1', espnTeamId: 361 },
  { id: 31, name: '김지수', nameEn: 'Kim Ji-soo', sport: 'soccer', team: 'Brentford',    afTeamId: 55,   afPlayerId: 356237, espnLeague: 'eng.1', espnTeamId: 337 },
  { id: 32, name: '양민혁', nameEn: 'Yang Min-hyeok', sport: 'soccer', team: 'Westerlo',     afTeamId: 261,  afPlayerId: 423708, espnLeague: 'bel.1', espnTeamId: 606 },
  { id: 33, name: '이태석', nameEn: 'Lee Tae-seok', sport: 'soccer', team: 'Austria Wien', afTeamId: 601,  afPlayerId: 237220, espnLeague: 'aut.1', espnTeamId: 1382 },
  { id: 9,  name: '김하성', en: 'kim',       sport: 'baseball', team: 'Braves',      mlbTeam: 'Atlanta Braves', mlbId: 673490 },
  { id: 17, name: '이정후', en: 'lee',       sport: 'baseball', team: 'Giants',      mlbTeam: 'San Francisco Giants', mlbId: 808982 },
  { id: 18, name: '김혜성', en: 'kim',       sport: 'baseball', team: 'Dodgers',     mlbTeam: 'Los Angeles Dodgers', mlbId: 808975 },
  { id: 34, name: '송성문', en: 'song',      sport: 'baseball', team: 'Padres',      mlbTeam: 'San Diego Padres', mlbId: 823550 },
  { id: 35, name: '김민수', nameEn: 'Kim Min-su', sport: 'soccer', team: 'Girona', afTeamId: 547, afPlayerId: 397941, espnLeague: 'esp.2', espnTeamId: 9812 },
];

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
async function sbInsertLog(eventKey) {
  // Returns true if newly inserted (not a duplicate). Relies on a UNIQUE
  // constraint on event_key + Prefer: resolution=ignore-duplicates.
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/push_log`, {
    method: 'POST',
    headers: { ...sbHeaders(), Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ event_key: eventKey }),
  });
  if (!r.ok) return false;
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
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
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
}

async function alreadyLogged(eventKey) {
  const rows = await sbSelect('push_log', `event_key=eq.${encodeURIComponent(eventKey)}&select=event_key`);
  return Array.isArray(rows) && rows.length > 0;
}

// 날짜별 경기 목록: Supabase sf_cache 를 먼저 보고, 낡았을 때만 AF 를 부른다.
// 크론은 2분마다 도는데 이 목록은 그렇게 자주 바뀌지 않는다.
async function fixturesForDate(date) {
  const FRESH_MS = 3 * 60 * 1000;
  try {
    const rows = await sbSelect('sf_cache', `date=eq.${date}&select=events,updated_at`);
    const row = Array.isArray(rows) && rows[0];
    if (row && Array.isArray(row.events) && row.events.length &&
        Date.now() - new Date(row.updated_at).getTime() < FRESH_MS) {
      return { response: row.events };
    }
  } catch (e) { /* 캐시 불가 → 그냥 AF 로 */ }
  const data = await afGet(`/fixtures?date=${date}`);
  if (Array.isArray(data?.response) && data.response.length) {
    try {
      await fetch(`${process.env.SUPABASE_URL}/rest/v1/sf_cache`, {
        method: 'POST',
        headers: { ...sbHeaders(), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ date, events: data.response, updated_at: new Date().toISOString() }),
      });
    } catch (e) { /* 저장 실패는 무시 */ }
  }
  return data;
}

async function collectSoccer(events) {
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

  const soccer = PLAYERS.filter((p) => p.sport === 'soccer');
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
      const involved = soccer.filter((p) => fx.teams?.home?.id === p.afTeamId || fx.teams?.away?.id === p.afTeamId);
      if (!involved.length) continue;
      seenFixtures.add(fid);

      const st = fx.fixture.status?.short;
      const isLive = AF_LIVE.has(st), isFinal = AF_FINAL.has(st);

      const home = fx.teams.home.name, away = fx.teams.away.name;
      const vs = `${home} vs ${away}`;
      const names = involved.map((p) => p.name);

      // ── 라인업 발표 알림: 킥오프 80분 전부터 감시, 발표 즉시 선발/벤치/제외 푸시 ──
      // (리그마다 60~75분 전 발표. 발표 전엔 빈 응답 → 다음 실행에서 재시도,
      //  처리 완료되면 af-lineup-done 마커로 이후 lineups 호출 자체를 중단.)
      if (!isLive && !isFinal) {
        const til = new Date(fx.fixture.date).getTime() - Date.now();
        const inWindow = (st === 'NS' || st === 'TBD') && til > 0 && til <= 80 * 60 * 1000;
        if (inWindow && !(await alreadyLogged(`af-lineup-done-${fid}`))) {
          const lu = await afGet(`/fixtures/lineups?fixture=${fid}`);
          let teams = lu?.response || [];
          // AF 가 아직 안 냈으면 ESPN 을 본다. ESPN 응답을 AF 형태로 맞춰
          // 아래 매칭 코드를 그대로 쓴다(선수 id 는 다르므로 이름으로 붙는다).
          if (!teams.some((t) => (t.startXI || []).length)) {
            const rosters = await espnLineup(involved[0], new Date(fx.fixture.date).getTime());
            if (rosters) {
              const conv = (a) => ({ player: { id: null, name: a.athlete?.displayName || '' } });
              teams = rosters.map((t) => ({
                team: { name: t.team?.displayName || '' },
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
            const clean = (s) => (s || '').toLowerCase().replace(/[.\-\s]/g, '');
            for (const p of involved) {
              let inXI = false, onBench = false;
              for (const t of teams) {
                const hit = (e) => e?.player && (e.player.id === p.afPlayerId ||
                  (clean(e.player.name).length >= 6 && clean(e.player.name) === clean(p.nameEn || '')));
                if ((t.startXI || []).some(hit)) inXI = true;
                else if ((t.substitutes || []).some(hit)) onBench = true;
              }
              const j = josa(p.name, '이', '가');
              const body = inXI ? `${vs} — ${p.name}${j} 선발로 나섭니다.`
                : onBench ? `${vs} — ${p.name}${j} 벤치에서 출발합니다.`
                : `${vs} — ${p.name}${j} 이번 경기 명단에 포함되지 않았습니다.`;
              events.push({ key: `af-lineup-${fid}-${p.id}`, players: [p.id], matchId: String(fid),
                title: '⚽ 라인업 발표', body });
            }
            events.push({ key: `af-lineup-done-${fid}`, players: [] }); // 감시 종료 마커(무발송)
          }
        }
        continue;
      }

      // Finished & fully processed on an earlier run → skip (saves the events call).
      if (isFinal && await alreadyLogged(`af-done-${fid}`)) continue;

      // 야구와 같은 이유 — 팀 경기라고 다 뛰는 게 아니다. 라인업으로 실제 출전을
      // 확인한 뒤 대상을 좁힌다. 라인업이 아직/끝내 없으면 사실을 단정하지 않고 건너뛴다.
      let starters = null, squad = null;
      // 라이브 중에는 명단이 바뀌지 않는다(교체는 events 로 들어온다).
      // 시작 알림을 이미 보낸 경기는 다시 조회하지 않는다 — 경기당 2분마다
      // 1콜씩 90분이면 45콜이 그냥 나간다.
      const lineupSettled = isLive && await alreadyLogged(`af-start-${fid}`);
      if ((isLive || isFinal) && !lineupSettled) {
        const lu = await afGet(`/fixtures/lineups?fixture=${fid}`);
        const teams = lu?.response || [];
        if (teams.length && teams.some((t) => (t.startXI || []).length)) {
          const inList = (list, p) => (list || []).some((e) => e.player?.id === p.afPlayerId);
          starters = involved.filter((p) => teams.some((t) => inList(t.startXI, p)));
          squad = involved.filter((p) => teams.some((t) => inList(t.startXI, p) || inList(t.substitutes, p)));
        }
      }

      if (isLive && starters && starters.length) {
        const sNames = starters.map((p) => p.name);
        events.push({ key: `af-start-${fid}`, players: starters.map((p) => p.id), matchId: String(fid),
          title: `⚽ ${vs}`, body: `${namesWithJosa(sNames)} 출전하는 경기가 시작됐습니다.` });
      }
      if (isFinal && squad && squad.length) {
        events.push({ key: `af-result-${fid}`, players: squad.map((p) => p.id), matchId: String(fid),
          title: '⚽ 경기 종료', body: `${home} ${fx.goals?.home ?? 0} : ${fx.goals?.away ?? 0} ${away}, 경기가 종료됐습니다.` });
      }

      // Per-play events — matched by API-Football player id (exact, no name fuzz).
      const evd = await afGet(`/fixtures/events?fixture=${fid}`);
      (evd?.response || []).forEach((ev, i) => {
        const min = ev.time?.elapsed != null ? `${ev.time.elapsed}'` : '';
        involved.forEach((p) => {
          const isPlayer = ev.player?.id === p.afPlayerId;
          const isAssist = ev.assist?.id === p.afPlayerId;
          if (ev.type === 'Goal' && ev.detail !== 'Missed Penalty') {
            if (isPlayer && ev.detail !== 'Own Goal') {
              const pen = ev.detail === 'Penalty' ? '페널티킥으로 ' : '';
              events.push({ key: `af-goal-${fid}-${p.id}-${i}`, players: [p.id], matchId: String(fid),
                title: `⚽ ${p.name} 골!`, body: `${vs} 경기 ${min}, ${p.name}${josa(p.name, '이', '가')} ${pen}골을 터뜨렸습니다!` });
            } else if (isAssist) {
              events.push({ key: `af-assist-${fid}-${p.id}-${i}`, players: [p.id], matchId: String(fid),
                title: `⚽ ${p.name} 도움!`, body: `${vs} 경기 ${min}, ${p.name}${josa(p.name, '이', '가')} 도움을 기록했습니다!` });
            }
          } else if (ev.type === 'Card' && isPlayer) {
            if (ev.detail === 'Red Card') {
              events.push({ key: `af-red-${fid}-${p.id}-${i}`, players: [p.id], matchId: String(fid),
                title: `⚽ ${p.name} 퇴장`, body: `${vs} 경기 ${min}, ${p.name}${josa(p.name, '이', '가')} 퇴장당했습니다.` });
            } else if (ev.detail === 'Yellow Card') {
              events.push({ key: `af-yellow-${fid}-${p.id}-${i}`, players: [p.id], matchId: String(fid),
                title: `⚽ ${p.name} 경고`, body: `${vs} 경기 ${min}, ${p.name}${josa(p.name, '이', '가')} 경고를 받았습니다.` });
            }
          }
        });
      });

      // Mark finished fixtures as fully processed AFTER their events were parsed.
      if (isFinal) events.push({ key: `af-done-${fid}`, players: [], silent: true });
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
          events.push({ key: `mlb-start-${g.gamePk}`, players: starters.map((p) => p.id), matchId: String(g.gamePk),
            title: `⚾ ${vs}`, body: `${namesWithJosa(names)} 출전하는 경기가 시작됐습니다.` });
        }
      }

      // Batting box → home-run moments (live) + a performance line on the result.
      {
        // Home runs: one push per HR, keyed by cumulative count so a 2-HR game fires twice.
        for (const p of involved) {
          const bat = batOf(p);
          const hr = parseInt(bat?.homeRuns ?? 0) || 0;
          for (let n = 1; n <= hr; n++) {
            events.push({ key: `mlb-hr-${g.gamePk}-${p.id}-${n}`, players: [p.id], matchId: String(g.gamePk),
              title: `⚾ ${p.name} 홈런!`, body: `${vs} 경기, ${p.name}${josa(p.name, '이', '가')} 홈런을 쳤습니다!` });
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
            title: '⚾ 경기 종료', body: `${away} ${as} : ${hs} ${home}, 경기가 종료됐습니다.${perf}` });
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
  try { await collectSoccer(events); } catch (e) { console.warn('soccer', e?.message); }
  try { await collectBaseball(events); } catch (e) { console.warn('mlb', e?.message); }

  // De-dup: keep only events not already in push_log.
  const fresh = [];
  for (const ev of events) { if (await sbInsertLog(ev.key)) fresh.push(ev); }
  if (!fresh.length) return res.status(200).json({ checked: events.length, sent: 0 });

  // Load all device tokens once.
  const tokens = await sbSelect('device_tokens', 'select=token,player_ids');
  const jwt = apnsJWT();
  const client = http2.connect(`https://${process.env.APNS_HOST || 'api.push.apple.com'}`);
  let sent = 0, failed = 0;
  try {
    for (const ev of fresh) {
      const targets = tokens.filter((t) => Array.isArray(t.player_ids) && ev.players.some((pid) => t.player_ids.includes(pid)));
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

  return res.status(200).json({ checked: events.length, fresh: fresh.length, sent, failed });
};
