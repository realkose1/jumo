// /api/cheer-feed 점검: 응답 모양 + 두 번 호출 사이 점수·골·상태 단조 + 기록 재생.
//
//   node scripts/cheer-feed-check.mjs            # 실데이터 두 번 호출 + 기록 재생
//   node scripts/cheer-feed-check.mjs --live     # 실데이터만
//   node scripts/cheer-feed-check.mjs --replay   # 기록 재생만
//   (--live 에는 '조작된 고수위 행' 점검도 들어 있다 — 행은 실제로 쓰지 않고 읽기 응답에 끼워 넣는다)
//
// 읽기 전용: fetch 를 감싸 GET/HEAD 말고는 아무 요청도 내보내지 않는다(고수위 행 쓰기는 막고 센다).
// SUPABASE_URL·SUPABASE_SERVICE_KEY 가 없으면 index.html 의 공개(anon) 키로 읽는다 — 키는 출력하지 않는다.
// 기록 재생: 실제 지난 경기 — 2026-09-24 대한민국 3:0 에콰도르(A매치, 오현규·손흥민 골, 김민재 도움),
// 2026-10-26 베식타시 2:0 바샥셰히르(오현규 골), 2026-09-19 MLB 자이언츠@다저스(이정후 홈런, 코리안 더비)
// — 를 sf_cache 날짜 행·af-detail 이벤트·statsapi 에서 받아 분 단위 패치로 다시 만들고, 낡은 행 섞임과
// VAR 취소를 끼워 buildFeed 에 흘린다.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const args = new Set(process.argv.slice(2));
const runLive = !args.has('--replay'), runReplay = !args.has('--live');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  process.env.SUPABASE_URL = /const SB_URL = '([^']+)'/.exec(html)[1];
  process.env.SUPABASE_SERVICE_KEY = /const SB_ANON = '([^']+)'/.exec(html)[1];
}

// ── 읽기 전용 fetch ──
const realFetch = globalThis.fetch;
const blocked = [];
globalThis.fetch = (url, opts = {}) => {
  const method = (opts.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    let key = '';
    try { key = JSON.parse(opts.body || '{}').date || ''; } catch {}
    blocked.push(`${method} ${String(url).split('?')[0]} ${key}`);
    return Promise.resolve(new Response(null, { status: 201 }));
  }
  // 조작된 고수위 행 점검: 피드가 읽는 sf_cache 응답에서 'cheer-feed-hw' 를 갈아 끼운다(DB 는 그대로).
  if (injectHw !== undefined && /date=in\./.test(String(url)) && String(url).includes('cheer-feed-hw')) {
    return realFetch(url, opts).then(async (r) => {
      const rows = (await r.json()).filter((x) => x.date !== 'cheer-feed-hw');
      if (injectHw !== null) rows.push({ date: 'cheer-feed-hw', events: injectHw, updated_at: new Date().toISOString() });
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
    });
  }
  return realFetch(url, opts);
};
let injectHw;   // undefined = 끼우지 않음

const handler = require(path.join(ROOT, 'api/cheer-feed.js'));
const { buildFeed, fetchMlbGame, DROP_CONFIRM_MS } = handler;

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.log('  ✗', msg); } return cond; };
const RANK = { pre: 0, live: 1, final: 2 };

// ── 모양 ──
function checkMatch(m, where) {
  const t = `${where} ${m?.id}`;
  ok(m && typeof m.id === 'string' && m.id.length > 0, `${t}: id`);
  ok(m.sport === 'soccer' || m.sport === 'baseball', `${t}: sport`);
  ok(typeof m.comp === 'string', `${t}: comp`);
  for (const s of ['home', 'away']) {
    ok(m[s] && typeof m[s].name === 'string' && m[s].name.length > 0, `${t}: ${s}.name`);
    ok(m[s].score === null || Number.isInteger(m[s].score), `${t}: ${s}.score`);
    ok((m.state === 'pre') === (m[s].score === null), `${t}: ${s}.score null iff pre`);
  }
  ok(m.side === null || ['home', 'away', 'both'].includes(m.side), `${t}: side`);
  ok(m.state in RANK, `${t}: state`);
  ok(typeof m.clock === 'string' && m.clock.length > 0, `${t}: clock`);
  ok(Number.isFinite(m.ko) && m.ko > 1.5e12, `${t}: ko ms`);
  ok(Array.isArray(m.players), `${t}: players`);
  for (const p of m.players || []) {
    ok(typeof p.name === 'string' && ['home', 'away'].includes(p.side) && Number.isInteger(p.g) && p.g >= 0, `${t}: player ${p.name}`);
    ok(p.a === undefined || (Number.isInteger(p.a) && p.a >= 0), `${t}: player.a ${p.name}`);
  }
}
function checkFeed(f, where) {
  ok(f && f.v === 1, `${where}: v`);
  ok(Number.isFinite(f.now), `${where}: now`);
  ok(Array.isArray(f.matches), `${where}: matches`);
  ok(f.next === null || typeof f.next === 'object', `${where}: next`);
  for (const m of f.matches || []) checkMatch(m, where);
  if (f.next) { checkMatch(f.next, `${where} next`); ok(f.next.state === 'pre' && f.next.ko - f.now > 60 * 60e3, `${where}: next is outside window`); }
  ok(new Set((f.matches || []).map((m) => m.id)).size === (f.matches || []).length, `${where}: unique ids`);
}
// 단조: 같은 id 는 상태·점수·선수 골/도움이 줄지 않는다.
function checkMonotonic(a, b, where) {
  const prev = new Map((a.matches || []).map((m) => [m.id, m]));
  for (const m of b.matches || []) {
    const p = prev.get(m.id);
    if (!p) continue;
    ok(RANK[m.state] >= RANK[p.state], `${where} ${m.id}: state ${p.state} → ${m.state}`);
    for (const s of ['home', 'away']) {
      if (p[s].score != null) ok(m[s].score != null && m[s].score >= p[s].score, `${where} ${m.id}: ${s} ${p[s].score} → ${m[s].score}`);
    }
    for (const pp of p.players) {
      const q = m.players.find((x) => x.name === pp.name);
      ok(q && q.g >= pp.g && (pp.a == null || q.a >= pp.a), `${where} ${m.id}: ${pp.name} g/a went back`);
    }
  }
}

function callHandler() {
  return new Promise((resolve) => {
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader(k, v) { headers[k.toLowerCase()] = v; },
      status(c) { this.statusCode = c; return this; },
      json(body) { resolve({ status: this.statusCode, headers, body }); },
      end() { resolve({ status: this.statusCode, headers, body: null }); },
    };
    handler({ method: 'GET', query: {}, headers: {} }, res);
  });
}

const kst = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') + ' KST';
const brief = (m) => m && `${m.state.padEnd(5)} ${m.clock.padEnd(16)} ${m.comp.padEnd(5)} ${m.home.name} ${m.home.score ?? '-'}:${m.away.score ?? '-'} ${m.away.name}`
  + `  [${m.side}] ${m.players.map((p) => `${p.name}${p.side === 'home' ? 'H' : 'A'} g${p.g}${p.a != null ? ' a' + p.a : ''}`).join(', ')}  (id ${m.id})`;

// ── 1) 실데이터 ──
async function live() {
  console.log('\n[실데이터] /api/cheer-feed 두 번 호출(읽기 전용)');
  const r1 = await callHandler();
  await new Promise((r) => setTimeout(r, 3000));
  const r2 = await callHandler();
  ok(r1.status === 200 && r2.status === 200, 'status 200');
  ok(r1.headers['access-control-allow-origin'] === '*', 'CORS *');
  console.log('  cache-control:', r1.headers['cache-control']);
  checkFeed(r1.body, 'call#1');
  checkFeed(r2.body, 'call#2');
  checkMonotonic(r1.body, r2.body, 'call#1→#2');
  const f = r2.body;
  console.log(`  now ${kst(f.now)} · matches ${f.matches.length}`);
  for (const m of f.matches) console.log('   ', brief(m));
  console.log('  next:', f.next ? `${brief(f.next)} · ko ${kst(f.next.ko)}` : null);
  console.log('  응답(앞부분):', JSON.stringify(f).slice(0, 700));

  // 실패하면 500 이 아니라 직전 성공 피드(200, 짧은 캐시)
  const url = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = 'https://invalid.invalid';
  const r3 = await callHandler();
  process.env.SUPABASE_URL = url;
  ok(r3.status === 200 && JSON.stringify(r3.body.matches) === JSON.stringify(f.matches)
    && JSON.stringify(r3.body.next) === JSON.stringify(f.next) && /s-maxage=2/.test(r3.headers['cache-control']), 'upstream 실패 → 직전 피드 200');
  console.log('  upstream 실패 시:', r3.status, r3.headers['cache-control'], `matches ${r3.body.matches.length}, next ${r3.body.next?.id ?? null}`);
}

// ── 1b) 조작된 고수위 행(anon 키로 sf_cache 를 쓸 수 있다) ──
async function malicious() {
  console.log('\n[조작된 고수위 행] 서명 없음·다른 키 서명·모양 깨짐 — 전부 무시돼야 한다');
  const crypto = await import('crypto');
  injectHw = null;
  const base = await callHandler();
  const target = base.body.next || base.body.matches[0];
  if (!ok(target, '조작 대상 경기(next) 있음')) { injectHw = undefined; return; }
  const now = Date.now();
  const evil = { [target.id]: { ko: target.ko, st: 2, fin: now, v: { h: 9, a: 0, 'g:백승호': 5, 'g:<img src=x onerror=alert(1)>': 3 },
    low: {}, ps: { '<img src=x onerror=alert(1)>': 'home', 해커: 'away' } } };
  const body = JSON.stringify(evil);
  const sigWith = (key, at, b) => crypto.createHmac('sha256', crypto.createHash('sha256').update(`cheer-feed-hw:${key}`).digest()).update(`${at}|${b}`).digest('base64url');
  const same = (r) => JSON.stringify({ m: r.body.matches, n: r.body.next }) === JSON.stringify({ m: base.body.matches, n: base.body.next });
  const cases = [
    ['예전 모양(서명 없음, 미래 at, 9:0·종료·가짜 이름)', { v: 1, at: now + 1e10, m: evil }],
    ['다른 키로 서명', { v: 2, at: now + 1e10, body, sig: sigWith('attacker-guess', now + 1e10, body) }],
    ['서명 문자열만 그럴듯', { v: 2, at: now, body, sig: 'A'.repeat(43) }],
    ['events 가 문자열', 'garbage'],
    ['events 가 배열', [1, 2, 3]],
    ['기록에 .v 없음(예전 크래시)', { v: 1, at: now + 1e10, m: { [target.id]: { ko: target.ko, st: 1 } } }],
  ];
  for (const [name, row] of cases) {
    injectHw = row;
    const r = await callHandler();
    ok(r.status === 200 && same(r), `${name} → 무시(200, 피드 그대로)`);
    console.log(`  ${r.status === 200 && same(r) ? '✓' : '✗'} ${name}`);
  }
  // 올바른 키로 서명된 행이라도 모양이 틀린 기록은 버린다(서버 비밀이 새도 피드는 안 깨진다).
  const key = process.env.SUPABASE_SERVICE_KEY;
  const signed = (m, at) => { const b = JSON.stringify(m); return { v: 2, at, body: b, sig: sigWith(key, at, b) }; };
  const badShapes = {
    [target.id]: { ko: target.ko, st: 2, v: { h: 999, a: 0 }, low: {}, ps: {} },                     // 점수 범위 밖
  };
  for (const [name, row] of [
    ['서명 OK·.v 없음', signed({ [target.id]: { ko: target.ko, st: 2 } }, now)],
    ['서명 OK·점수 999', signed(badShapes, now + 1e10)],
    ['서명 OK·가짜 이름 키', signed({ [target.id]: { ko: target.ko, st: 1, v: { 'g:해커': 3 }, low: {}, ps: {} } }, now)],
    ['서명 OK·이상한 id', signed({ '../../x': { ko: target.ko, st: 2, v: {}, low: {}, ps: {} } }, now)],
  ]) {
    injectHw = row;
    const r = await callHandler();
    ok(r.status === 200 && same(r), `${name} → 기록 버림(200, 피드 그대로)`);
    console.log(`  ${r.status === 200 && same(r) ? '✓' : '✗'} ${name}`);
  }
  const { unpackHw } = handler;
  const u = unpackHw(signed({ [target.id]: { ko: target.ko, st: 1, v: { h: 1, a: 0 }, low: { h: now + 1e9 }, ps: { 백승호: 'away', 해커: 'home' } } }, now + 1e10), now);
  ok(u && u.at === now && !('해커' in u.m[target.id].ps) && !('h' in u.m[target.id].low), '서명 OK 행: at·low 는 지금 이하로, PLAYERS 밖 이름은 버림');
  console.log(`  ${u && u.at === now ? '✓' : '✗'} 서명 OK 행 정리: at ${u?.at === now ? '= now' : u?.at}, ps ${JSON.stringify(u?.m?.[target.id]?.ps)}, low ${JSON.stringify(u?.m?.[target.id]?.low)}`);
  // 대조군: 서버 키로 서명한 정상 행은 쓰인다(위 '무시'가 행을 아예 안 읽어서 통과한 게 아님을 확인).
  injectHw = signed({ [target.id]: { ko: target.ko, st: 1, v: { h: 1, a: 0 }, low: {}, ps: {} } }, Date.now());
  const pc = await callHandler();
  const pm = pc.body.matches.find((m) => m.id === target.id);
  ok(pm && pm.state === 'live' && pm.home.score === 1 && pm.players.every((p) => p.name !== '해커'), '대조군: 서명된 정상 행은 읽힌다');
  console.log(`  ${pm?.state === 'live' ? '✓' : '✗'} 대조군(서명된 정상 행) → ${pm ? brief(pm) : '없음'}`);
  // 메모리에 들어간 대조군 값은 다음 점검에 섞이지 않게 비운다 — 이 프로세스에서만 쓰는 값이다.
  injectHw = undefined;
}

// ── 2) 기록 재생 ──
const sbGet = async (key) => {
  const r = await realFetch(`${process.env.SUPABASE_URL}/rest/v1/sf_cache?select=events,updated_at&date=eq.${encodeURIComponent(key)}`,
    { headers: { apikey: process.env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } });
  const rows = r.ok ? await r.json() : [];
  return rows[0] || null;
};
const pushCron = require(path.join(ROOT, 'api/push-cron.js'));
const OUR_AF = new Set(pushCron.PLAYERS.filter((p) => p.sport === 'soccer' && p.afPlayerId).map((p) => p.afPlayerId));

// 킥오프 뒤 벽시계 w분 → AF 상태·분(전반 47분까지 1H, 하프타임 15분, 후반, 110분 이후 FT).
function clockAt(w0) {
  const w = Math.floor(w0);   // AF 분은 정수
  if (w0 < 0) return { s: 'NS', el: null, extra: null };
  if (w < 47) return { s: '1H', el: Math.min(w, 45), extra: w > 45 ? w - 45 : null };
  if (w < 62) return { s: 'HT', el: 45, extra: null };
  if (w < 110) { const el = 45 + (w - 62); return { s: '2H', el: Math.min(el, 90), extra: el > 90 ? el - 90 : null }; }
  return { s: 'FT', el: 90, extra: null };
}
// 실제 이벤트로 그 분의 패치 fixtures[id] 를 만든다(크론 규칙: 자책골·실축 PK 제외, 대표팀은 기록 있는 선수만).
function fixtureAt(fx, events, w, { pLagMin = 0, involvedIds = [] } = {}) {
  const c = clockAt(w);
  const upto = (lag) => events.filter((e) => c.s !== 'NS' && (e.time?.elapsed ?? 0) <= (c.el ?? 0) - lag);
  const goals = { home: 0, away: 0 };
  for (const e of upto(0)) {
    if (e.type !== 'Goal' || e.detail === 'Missed Penalty') continue;
    const forHome = e.detail === 'Own Goal' ? e.team.id !== fx.teams.home.id : e.team.id === fx.teams.home.id;
    goals[forHome ? 'home' : 'away']++;
  }
  let p = null;
  if (c.s !== 'NS') {
    p = {};
    for (const id of involvedIds) p[id] = { g: 0, a: 0 };
    for (const e of upto(pLagMin)) {
      if (e.type !== 'Goal' || e.detail === 'Missed Penalty') continue;
      const bump = (id, k) => { if (!OUR_AF.has(id)) return; (p[id] = p[id] || { g: 0, a: 0 })[k]++; };
      if (e.detail !== 'Own Goal') bump(e.player?.id, 'g');
      if (e.assist?.id) bump(e.assist.id, 'a');
    }
  }
  const status = { short: c.s, elapsed: c.el, extra: c.extra, long: '' };
  return {
    s: c.s, el: c.el, h: c.s === 'NS' ? null : goals.home, a: c.s === 'NS' ? null : goals.away, ko: fx.fixture.date, p,
    fx: { ...fx, fixture: { ...fx.fixture, status }, goals: c.s === 'NS' ? { home: null, away: null } : goals },
  };
}

async function loadRecorded(date, id) {
  const [row, det] = await Promise.all([sbGet(date), sbGet(`af-detail-${id}`)]);
  const fx = (row?.events || []).find((x) => String(x.fixture?.id) === String(id));
  if (!fx || !Array.isArray(det?.events?.events)) throw new Error(`recorded ${id} not in cache`);
  return { fx, events: det.events.events };
}

// 한 경기를 15초 간격으로 흘린다. script(w) 가 그 순간의 fixture(또는 덮어쓸 값)·fat 을 준다.
// allowDrop: 단조 검사 대신 내려간 순간을 모은다(VAR 시나리오 — 8분 규칙으로 한 번만 내려가야 한다).
function replaySoccer(name, rec, { from, to, step = 0.25, script, involvedIds = [], onFeed, allowDrop = false }) {
  const ko = Date.parse(rec.fx.fixture.date);
  const st = { hw: { v: 1, at: 0, m: {} }, clocks: new Map(), recent: new Map() };
  let prev = null;
  const seen = [];
  for (let w = from; w <= to + 1e-9; w += step) {
    const nowMs = ko + Math.round(w * 60e3);
    const { f, fatMs } = script(w, nowMs, (ww, o) => fixtureAt(rec.fx, rec.events, ww, { involvedIds, ...o }));
    const patch = { at: new Date(nowMs).toISOString(), fat: new Date(fatMs).toISOString(), gat: null, fixtures: f ? { [rec.fx.fixture.id]: f } : {}, games: {} };
    const feed = buildFeed({ nowMs, patch, far: null, mlbLive: new Map(), hw: st.hw, clocks: st.clocks, recent: st.recent });
    checkFeed(feed, `${name} w=${w.toFixed(2)}`);
    if (prev && !allowDrop) checkMonotonic(prev, feed, `${name} w=${w.toFixed(2)}`);
    const m = feed.matches.find((x) => x.id === String(rec.fx.fixture.id)) || null;
    // 분이 바뀐 것만으로는 적지 않는다 — 상태·점수·선수 기록이 바뀐 순간만.
    const line = m ? brief(m) : '(창 밖)';
    const key = m ? brief({ ...m, clock: '' }) : line;
    if (!seen.length || seen[seen.length - 1].key !== key) seen.push({ w, line, key, m });
    else seen[seen.length - 1].m = m;
    onFeed && onFeed(w, m, feed);
    prev = feed;
  }
  console.log(`\n[재생] ${name}`);
  for (const s of seen) console.log(`  +${s.w.toFixed(2).padStart(7)}분  ${s.line}`);
  return seen;
}

async function replay() {
  // (a) A매치 대한민국 3:0 에콰도르 — 54' 오현규(김민재 도움), 58' 손흥민, 86' 이동경(추적 밖).
  //     선수 골(p)은 점수보다 2분 늦게 오고, 55~56분엔 '크론이 낡은 목록으로 덮은' 0:0 행이 섞인다.
  const kor = await loadRecorded('2026-09-24', 1628994);
  const korSeen = replaySoccer('A매치 KOR–ECU(1628994): p 2분 지연 + 낡은 행 섞임', kor, {
    from: -75, to: 150, step: 0.25,
    script: (w, nowMs, at) => {
      // 오현규 골(후반 54' = 벽시계 71분) 직후 30초 동안 49'·0:0 짜리 낡은 행(3분 전 fat)이 끼어든다.
      if (w >= 71.25 && w < 71.75) return { f: at(66), fatMs: nowMs - 180e3 };
      return { f: at(w, { pLagMin: 2 }), fatMs: nowMs - 20e3 };
    },
  });
  const korEnd = korSeen.filter((s) => s.m && s.m.state === 'final').pop()?.m;
  ok(korEnd && korEnd.home.name === '대한민국' && korEnd.away.name === '에콰도르', 'KOR: 팀명 한글(대한민국·에콰도르)');
  ok(korEnd && korEnd.comp === 'A매치' && korEnd.side === 'home', 'KOR: comp A매치, side home');
  ok(korEnd && korEnd.home.score === 3 && korEnd.away.score === 0, 'KOR: 최종 3:0');
  const pl = (m, n) => m?.players.find((p) => p.name === n);
  ok(pl(korEnd, '오현규')?.g === 1 && pl(korEnd, '손흥민')?.g === 1 && pl(korEnd, '김민재')?.a === 1, 'KOR: 오현규 g1·손흥민 g1·김민재 a1');
  ok(korSeen.some((s) => s.m?.state === 'pre' && /시작$/.test(s.m.clock)) && korSeen[0].line === '(창 밖)', 'KOR: 60분 전부터 창에 들어온다');
  ok(korSeen[korSeen.length - 1].line === '(창 밖)', 'KOR: 끝나고 30분 뒤 창에서 빠진다');

  // (b) VAR 취소: 같은 경기 골격, 58' 손흥민 골이 72'에 취소돼 그 뒤 행은 줄곧 1:0.
  //     8분 동안은 2:0 을 유지하고(깜빡임 없음), 그 뒤 1:0·손흥민 g0 으로 한 번만 내려간다.
  const cancelAt = 62 + (72 - 45);   // 벽시계 분
  const varEvents = kor.events.filter((e) => !(e.type === 'Goal' && e.player?.id === 186));
  const changes = [];   // 2:0 이 된 뒤 점수·손흥민 골이 바뀐 순간
  let last = null;
  replaySoccer('VAR 취소 시나리오(1628994 골격)', kor, {
    from: 60, to: 105, step: 0.25, allowDrop: true,
    script: (w, nowMs, at) => (w < cancelAt
      ? { f: at(w), fatMs: nowMs - 20e3 }
      : { f: fixtureAt(kor.fx, varEvents, w), fatMs: nowMs - 20e3 }),
    onFeed: (w, m) => {
      const cur = m && `${m.home.score}:${m.away.score} son=${m.players.find((p) => p.name === '손흥민')?.g ?? '-'}`;
      if (last && cur !== last && last.startsWith('2:0 son=1')) changes.push({ w, from: last, to: cur });
      last = cur;
    },
  });
  const d0 = changes[0];
  ok(changes.length === 1 && d0.to === '1:0 son=0', `VAR: 2:0 → 1:0(손흥민 g0) 한 번만(바뀐 기록 ${JSON.stringify(changes)})`);
  ok(d0 && Math.abs((d0.w - cancelAt) * 60e3 - DROP_CONFIRM_MS) <= 15e3, `VAR: 취소 ${DROP_CONFIRM_MS / 60e3}분 뒤에 내려감(실제 ${d0 ? (d0.w - cancelAt).toFixed(2) : '-'}분 뒤)`);

  // (c) 소속팀: 베식타시 2:0 바샥셰히르, 76' 오현규.
  const bjk = await loadRecorded('2026-10-26', 1584440);
  const bjkSeen = replaySoccer('쉬페르리그 BJK–IBFK(1584440)', bjk, {
    from: 85, to: 135, step: 0.25, involvedIds: [34710],
    script: (w, nowMs, at) => ({ f: at(w, { pLagMin: 1 }), fatMs: nowMs - 30e3 }),
  });
  const bjkEnd = bjkSeen.filter((s) => s.m && s.m.state === 'final').pop()?.m;
  ok(bjkEnd && bjkEnd.comp === 'TUR' && bjkEnd.side === 'home' && bjkEnd.home.name === 'Beşiktaş', 'BJK: comp TUR, side home, 앱처럼 AF 원래 팀명');
  ok(bjkEnd && pl(bjkEnd, '오현규')?.g === 1 && bjkEnd.home.score === 2, 'BJK: 2:0, 오현규 g1');

  // (d) MLB 자이언츠@다저스(823898): 패치는 '진행 중 5회초 1:3' 인데 직접 조회(실제 statsapi)는 종료 8:2.
  //     더 진행된 상태(종료)를 쓰고, 그 뒤 직접 조회가 실패해 낡은 패치만 남아도 되돌아가지 않는다.
  const pk = '823898';
  const d = await fetchMlbGame(pk, Date.parse('2026-09-19T04:45:00Z'));
  const ko = d.ko;
  const g = { s: 'Live', h: 3, a: 1, inn: 'Top 5', ko: new Date(ko).toISOString(), hn: d.hn, an: d.an };
  const st = { hw: { v: 1, at: 0, m: {} }, clocks: new Map(), recent: new Map() };
  const at = (nowMs, live) => buildFeed({ nowMs, patch: { at: new Date(nowMs).toISOString(), fat: null, gat: new Date(nowMs - 90e3).toISOString(), fixtures: {}, games: { [pk]: g } },
    far: null, mlbLive: live ? new Map([[pk, { ...d, at: nowMs }]]) : new Map(), ...st });
  const t1 = ko + 150 * 60e3;
  const f1 = at(t1, true), f2 = at(t1 + 15e3, false);
  checkFeed(f1, 'MLB#1'); checkFeed(f2, 'MLB#2'); checkMonotonic(f1, f2, 'MLB#1→#2');
  const m1 = f1.matches.find((m) => m.id === `mlbpatch-${pk}`), m2 = f2.matches.find((m) => m.id === `mlbpatch-${pk}`);
  console.log(`\n[재생] MLB ${pk} (직접 조회 = 실제 statsapi)`);
  console.log('  #1 직접+패치  ', brief(m1));
  console.log('  #2 패치만(낡음)', brief(m2));
  ok(m1 && m1.state === 'final' && m1.home.score === d.h && m1.away.score === d.a, 'MLB: 직접 조회 종료 점수');
  ok(m1 && m1.side === 'both' && pl(m1, '이정후')?.side === 'away' && pl(m1, '이정후')?.g === 1 && pl(m1, '김혜성')?.side === 'home', 'MLB: 코리안 더비, 이정후 홈런 1');
  ok(m2 && m2.state === 'final' && m2.home.score === d.h && pl(m2, '이정후')?.g === 1, 'MLB: 낡은 패치(진행 중 3:1)로 되돌아가지 않음');
  // 직접 조회가 10분 내내 실패해 낡은 '진행 중' 패치만 와도 8분 규칙으로 내려가지 않는다(덜 진행된 관측은 내릴 근거가 아니다).
  let fk = f2;
  for (let i = 2; i <= 41; i++) { const fn = at(t1 + i * 15e3, false); checkMonotonic(fk, fn, `MLB stale#${i}`); fk = fn; }
  const mk = fk.matches.find((m) => m.id === `mlbpatch-${pk}`);
  ok(mk && mk.home.score === d.h && mk.away.score === d.a && pl(mk, '이정후')?.g === 1, 'MLB: 낡은 패치 10분 뒤에도 8:2·홈런 1 유지');
  // 진행 중 이닝 표시(패치만, 직접 조회 없음)
  const f3 = buildFeed({ nowMs: ko + 60 * 60e3, patch: { at: '', fat: null, gat: new Date(ko + 59 * 60e3).toISOString(), fixtures: {}, games: { [pk]: g } }, far: null, mlbLive: new Map(), hw: { v: 1, at: 0, m: {} }, clocks: new Map(), recent: new Map() });
  console.log('  진행 중(패치) ', brief(f3.matches[0]));
  ok(f3.matches[0]?.clock === '5회초' && f3.matches[0]?.state === 'live', 'MLB: 이닝 표시 5회초');
}

try {
  if (runLive) { await live(); await malicious(); }
  if (runReplay) await replay();
} catch (e) {
  failures++;
  console.log('  ✗ 예외:', e?.stack || e);
}
console.log(`\n막은 쓰기 ${blocked.length}건${blocked.length ? ': ' + [...new Set(blocked)].join(' | ') : ''}`);
console.log(failures ? `실패 ${failures}건` : '모두 통과');
process.exit(failures ? 1 : 0);
