// Vercel Cron → APNs push sender for Jumo.
//
// Detects events for the Korean players (match start, goal/assist by a Korean
// player, final result) from the same public feeds the app uses (ESPN for
// soccer, MLB StatsAPI for baseball), de-duplicates them against a Supabase
// `push_log` table, and delivers an APNs alert to every device whose followed
// players are involved.
//
// Required env vars (Vercel → Project → Settings → Environment Variables):
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
const PLAYERS = [
  { id: 1,  name: '손흥민', en: 'son',       sport: 'soccer', team: 'LAFC',          league: 'usa.1' },
  { id: 2,  name: '이강인', en: 'lee kang',  sport: 'soccer', team: 'PSG',           league: 'fra.1' },
  { id: 3,  name: '김민재', en: 'kim min',   sport: 'soccer', team: 'Bayern',        league: 'ger.1' },
  { id: 6,  name: '황희찬', en: 'hwang hee', sport: 'soccer', team: 'Wolves',        league: 'eng.1' },
  { id: 7,  name: '황인범', en: 'hwang in',  sport: 'soccer', team: 'Feyenoord',     league: 'ned.1' },
  { id: 8,  name: '조규성', en: 'cho gue',   sport: 'soccer', team: 'Midtjylland',   league: 'den.1' },
  { id: 19, name: '오현규', en: 'oh hyeon',  sport: 'soccer', team: 'Besiktas',      league: 'tur.1' },
  { id: 20, name: '양현준', en: 'yang hyun', sport: 'soccer', team: 'Celtic',        league: 'sco.1' },
  { id: 21, name: '백승호', en: 'paik',      sport: 'soccer', team: 'Birmingham',    league: 'eng.2' },
  { id: 22, name: '배준호', en: 'bae jun',   sport: 'soccer', team: 'Stoke',         league: 'eng.2' },
  { id: 23, name: '엄지성', en: 'eom',       sport: 'soccer', team: 'Swansea',       league: 'eng.2' },
  { id: 24, name: '설영우', en: 'seol',      sport: 'soccer', team: 'Crvena',        league: 'srb.1' },
  { id: 9,  name: '김하성', en: 'kim',       sport: 'baseball', team: 'Pirates',     mlbTeam: 'Pittsburgh Pirates', mlbId: 673490 },
  { id: 17, name: '이정후', en: 'lee',       sport: 'baseball', team: 'Giants',      mlbTeam: 'San Francisco Giants', mlbId: 808982 },
  { id: 18, name: '김혜성', en: 'kim',       sport: 'baseball', team: 'Dodgers',     mlbTeam: 'Los Angeles Dodgers', mlbId: 808975 },
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

async function collectSoccer(events) {
  const leagues = [...new Set(PLAYERS.filter((p) => p.sport === 'soccer').map((p) => p.league))];
  for (const lg of leagues) {
    const sb = await J(`https://site.api.espn.com/apis/site/v2/sports/soccer/${lg}/scoreboard`);
    for (const ev of sb?.events || []) {
      const comp = ev.competitions?.[0]; if (!comp) continue;
      const state = ev.status?.type?.state; // pre | in | post
      const homeC = (comp.competitors || []).find((c) => c.homeAway === 'home') || comp.competitors?.[0];
      const awayC = (comp.competitors || []).find((c) => c.homeAway === 'away') || comp.competitors?.[1];
      const homeTeam = homeC?.team?.displayName || homeC?.team?.name || '';
      const awayTeam = awayC?.team?.displayName || awayC?.team?.name || '';
      const teams = [homeTeam, awayTeam];
      const involved = PLAYERS.filter((p) => p.sport === 'soccer' && p.league === lg && teams.some((t) => teamMatches(t, p.team)));
      if (!involved.length) continue;
      const vs = `${homeTeam} vs ${awayTeam}`;
      const names = involved.map((p) => p.name);
      if (state === 'in') {
        events.push({ key: `start-${ev.id}`, players: involved.map((p) => p.id),
          title: `⚽ ${vs}`, body: `${namesWithJosa(names)} 출전하는 경기가 시작됐습니다.` });
      }
      if (state === 'post') {
        events.push({ key: `result-${ev.id}`, players: involved.map((p) => p.id),
          title: '⚽ 경기 종료', body: `${homeTeam} ${homeC?.score ?? 0} : ${awayC?.score ?? 0} ${awayTeam}, 경기가 종료됐습니다.` });
      }
      // Per-play events by a Korean player (goal / assist / yellow / red).
      // ESPN lists athletesInvolved in order: [0] = primary actor (scorer / carded
      // player), [1] (on goals) = assist provider. We only credit an assist when the
      // Korean is NOT the scorer, so no double-fire and no false goals.
      const nameHit = (athlete, p) => {
        const n = norm(athlete?.displayName || '');
        return !!n && (n.includes(norm(p.en)) || norm(p.en).split(' ').some((x) => x && n.includes(x)));
      };
      (comp.details || []).forEach((d, i) => {
        const txt = (d.type?.text || '').toLowerCase();
        const clock = d.clock?.displayValue || '';
        const ath = d.athletesInvolved || [];
        const isGoal = /goal/.test(txt) && !/own goal/.test(txt) && !d.ownGoal;
        const isRed = /red card/.test(txt);                       // includes 2nd-yellow "Yellow Red Card"
        const isYellow = /yellow card/.test(txt) && !/red/.test(txt);
        involved.forEach((p) => {
          if (isGoal) {
            if (nameHit(ath[0], p)) {
              const pen = d.penaltyKick ? '페널티킥으로 ' : '';
              events.push({ key: `goal-${ev.id}-${p.id}-${i}`, players: [p.id],
                title: `⚽ ${p.name} 골!`, body: `${vs} 경기 ${clock}, ${p.name}${josa(p.name, '이', '가')} ${pen}골을 터뜨렸습니다!` });
            } else if (ath[1] && nameHit(ath[1], p)) {
              events.push({ key: `assist-${ev.id}-${p.id}-${i}`, players: [p.id],
                title: `⚽ ${p.name} 도움!`, body: `${vs} 경기 ${clock}, ${p.name}${josa(p.name, '이', '가')} 도움을 기록했습니다!` });
            }
          } else if (isRed && ath.some((a) => nameHit(a, p))) {
            events.push({ key: `red-${ev.id}-${p.id}-${i}`, players: [p.id],
              title: `⚽ ${p.name} 퇴장`, body: `${vs} 경기 ${clock}, ${p.name}${josa(p.name, '이', '가')} 퇴장당했습니다.` });
          } else if (isYellow && ath.some((a) => nameHit(a, p))) {
            events.push({ key: `yellow-${ev.id}-${p.id}-${i}`, players: [p.id],
              title: `⚽ ${p.name} 경고`, body: `${vs} 경기 ${clock}, ${p.name}${josa(p.name, '이', '가')} 경고를 받았습니다.` });
          }
        });
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

      if (st === 'Live') {
        const names = involved.map((p) => p.name);
        events.push({ key: `mlb-start-${g.gamePk}`, players: involved.map((p) => p.id),
          title: `⚾ ${vs}`, body: `${namesWithJosa(names)} 출전하는 경기가 시작됐습니다.` });
      }

      // Batting box → home-run moments (live) + a performance line on the result.
      if (st === 'Live' || st === 'Final') {
        const box = await J(`https://statsapi.mlb.com/api/v1/game/${g.gamePk}/boxscore`);
        const batOf = (p) => {
          for (const side of ['home', 'away']) {
            const pl = box?.teams?.[side]?.players?.[`ID${p.mlbId}`];
            if (pl) return pl.stats?.batting || null;
          }
          return null;
        };
        // Home runs: one push per HR, keyed by cumulative count so a 2-HR game fires twice.
        for (const p of involved) {
          const bat = batOf(p);
          const hr = parseInt(bat?.homeRuns ?? 0) || 0;
          for (let n = 1; n <= hr; n++) {
            events.push({ key: `mlb-hr-${g.gamePk}-${p.id}-${n}`, players: [p.id],
              title: `⚾ ${p.name} 홈런!`, body: `${vs} 경기, ${p.name}${josa(p.name, '이', '가')} 홈런을 쳤습니다!` });
          }
        }
        if (st === 'Final') {
          const hs = g.teams?.home?.score, as = g.teams?.away?.score;
          const lines = involved.map((p) => {
            const bat = batOf(p);
            if (!bat) return null;
            const ab = parseInt(bat.atBats ?? 0) || 0, h = parseInt(bat.hits ?? 0) || 0;
            const hr = parseInt(bat.homeRuns ?? 0) || 0, rbi = parseInt(bat.rbi ?? 0) || 0;
            const parts = [`${ab}타수 ${h}안타`]; if (hr) parts.push(`${hr}홈런`); if (rbi) parts.push(`${rbi}타점`);
            return `${p.name} ${parts.join(' ')}`;
          }).filter(Boolean);
          const perf = lines.length ? ` · ${lines.join(', ')}` : '';
          events.push({ key: `mlb-result-${g.gamePk}`, players: involved.map((p) => p.id),
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
      const payload = { aps: { alert: { title: ev.title, body: ev.body }, sound: 'default' }, data: { key: ev.key } };
      for (const t of targets) {
        const r = await sendOne(client, t.token, payload, jwt);
        if (r.status === 200) sent++; else failed++;
      }
    }
  } finally { client.close(); }

  return res.status(200).json({ checked: events.length, fresh: fresh.length, sent, failed });
};
