#!/usr/bin/env node
// 아시안게임(리그 803) 한국 U-23 대표팀 선발 라인업을 Supabase sf_cache 에
// 수동으로 기록/조회하는 CLI. API-Football 은 이 대회 라인업을 주지 않아서
// (킥오프 60~100분 전 한국 언론 보도를 사람이/자동으로 옮겨 적어) 대신한다.
//
// 서브커맨드: check | set | get | auto  (자세한 사용법은 각 함수 주석 참고)
// 의존성 없음(Node 20 기본 fetch만 사용).

import { fileURLToPath } from 'url';

const KOREA_TEAM_ID = 10177;
const LEAGUE_ID = 803;
const SEASON = 2026;

const AF_PROXY = 'https://jumo-git-main-realkose1s-projects.vercel.app/api/apifootball';
const NAVER_PROXY = 'https://jumo-git-main-realkose1s-projects.vercel.app/api/naver-news';

const SUPABASE_TABLE_URL = 'https://pxchmolcruhxbmvomsyy.supabase.co/rest/v1/sf_cache';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4Y2htb2xjcnVoeGJtdm9tc3l5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3NTk0ODgsImV4cCI6MjA5MzMzNTQ4OH0.WvxjnCkWD_LCgJTPdH3jtMc-maz0dSgS-A9SDHuy58U';

// ---------------------------------------------------------------------------
// 아시안게임 23인 명단. api/push-cron.js 의 AG_SQUAD 가 원본(source of truth) —
// 그쪽은 CJS + 부수효과(cron 트리거)가 있어 import 할 수 없으므로 여기 복사해
// 둔다. push-cron.js 쪽 명단이 바뀌면 이 배열도 같이 손으로 맞출 것.
// ---------------------------------------------------------------------------
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

// 뉴스 검색 쿼리용 상대팀 한글명. 없으면 AF 영문명(U23 등 접미사 제거)으로 폴백.
const OPPONENT_KR = {
  'Qatar': '카타르', 'Saudi Arabia': '사우디', 'Japan': '일본', 'China': '중국',
  'Iran': '이란', 'Uzbekistan': '우즈베키스탄', 'Indonesia': '인도네시아',
  'Thailand': '태국', 'Vietnam': '베트남', 'Australia': '호주', 'Iraq': '이라크',
  'Jordan': '요르단', 'Bahrain': '바레인', 'UAE': 'UAE', 'United Arab Emirates': 'UAE',
  'North Korea': '북한', 'Kyrgyzstan': '키르기스스탄', 'Malaysia': '말레이시아',
  'India': '인도',
};

// ---------------------------------------------------------------------------
// 공통 유틸
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

async function fetchJson(url, opts) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) throw new Error(`fetch ${url} → ${r.status}: ${text.slice(0, 300)}`);
  return data;
}

function findSquad(name) {
  return AG_SQUAD.find((p) => p.name === (name || '').trim());
}

function opponentKorean(afTeamName) {
  const clean = (afTeamName || '').replace(/\s*U-?23\s*$/i, '').trim();
  return OPPONENT_KR[clean] || clean || afTeamName;
}

function dateKeyFor(fixtureId) {
  return `manual-lineup-${fixtureId}`;
}

// ---------------------------------------------------------------------------
// Supabase sf_cache 접근
// ---------------------------------------------------------------------------

async function sbGetRow(dateKey) {
  const url = `${SUPABASE_TABLE_URL}?date=eq.${encodeURIComponent(dateKey)}&select=*`;
  const rows = await fetchJson(url, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function sbUpsertRow(row) {
  await fetchJson(SUPABASE_TABLE_URL, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify([row]),
  });
}

// ---------------------------------------------------------------------------
// API-Football: 다음 경기 조회
// ---------------------------------------------------------------------------

async function fetchNextFixture() {
  const url = `${AF_PROXY}?path=fixtures&team=${KOREA_TEAM_ID}&next=5`;
  const data = await fetchJson(url);
  const list = (data.response || [])
    .filter((fx) => fx.league?.id === LEAGUE_ID)
    .sort((a, b) => a.fixture.timestamp - b.fixture.timestamp);
  return list[0] || null;
}

function opponentOf(fx) {
  const home = fx.teams?.home, away = fx.teams?.away;
  return home?.id === KOREA_TEAM_ID ? away : home;
}

// ---------------------------------------------------------------------------
// 그리드(포메이션) 배치
// ---------------------------------------------------------------------------

// API-Football grid 관례: 1행 = GK('1:1'), 이후 포메이션 문자열의 각 숫자가
// 수비→공격 순서로 한 행씩(예: 4-2-3-1 → DF4, MF2, MF3, FW1). 포지션군을
// GK→DF→MF→FW 순서로 이어붙인 뒤(flatten) 행 크기대로 앞에서부터 잘라 채운다
// — 이렇게 하면 "행에 자리가 남으면 다음 그룹이 흘러들어오고, 그룹이 행보다
// 많으면 다음 행으로 넘친다"는 요구사항이 자연히 만족된다.
function buildGrid(xi, formation) {
  const parts = String(formation).split('-').map((n) => parseInt(n, 10)).filter((n) => !Number.isNaN(n));
  const warnings = [];

  const gk = xi.filter((p) => p.pos === 'GK');
  const df = xi.filter((p) => p.pos === 'DF');
  const mf = xi.filter((p) => p.pos === 'MF');
  const fw = xi.filter((p) => p.pos === 'FW');

  if (gk.length !== 1) warnings.push(`GK ${gk.length}명 (1명이어야 함)`);
  if (parts.length && df.length !== parts[0]) {
    warnings.push(`DF ${df.length}명, 포메이션(${formation}) 수비 줄은 ${parts[0]}명`);
  }
  if (parts.length && fw.length !== parts[parts.length - 1]) {
    warnings.push(`FW ${fw.length}명, 포메이션(${formation}) 공격 줄은 ${parts[parts.length - 1]}명`);
  }
  const outfieldSum = parts.reduce((a, b) => a + b, 0);
  if (parts.length && outfieldSum !== df.length + mf.length + fw.length) {
    warnings.push(`포메이션(${formation}) 필드 플레이어 합 ${outfieldSum}명 ≠ 실제 DF+MF+FW ${df.length + mf.length + fw.length}명`);
  }

  const outfield = [...df, ...mf, ...fw];
  const rows = [gk];
  let i = 0;
  for (const size of parts) {
    rows.push(outfield.slice(i, i + size));
    i += size;
  }
  if (i < outfield.length) {
    // 포메이션 숫자 합보다 필드 플레이어가 많으면 마지막 행에 몰아넣는다.
    if (rows.length === 1) rows.push([]);
    rows[rows.length - 1] = rows[rows.length - 1].concat(outfield.slice(i));
  }

  const gridByAfIdOrName = new Map();
  rows.forEach((rowPlayers, ri) => {
    rowPlayers.forEach((p, ci) => {
      gridByAfIdOrName.set(p.afId != null ? `id:${p.afId}` : `name:${p.name}`, `${ri + 1}:${ci + 1}`);
    });
  });
  return { gridByAfIdOrName, warnings };
}

function gridKeyOf(p) {
  return p.afId != null ? `id:${p.afId}` : `name:${p.name}`;
}

// ---------------------------------------------------------------------------
// 저장할 row(events) 조립 + upsert
// ---------------------------------------------------------------------------

function buildEvents({ fixtureId, formation, formationGuessed, xi, subs, source, by, parseStrategy }) {
  const { gridByAfIdOrName, warnings } = buildGrid(xi, formation);
  const events = {
    fixtureId: Number(fixtureId),
    teamId: KOREA_TEAM_ID,
    formation,
    formationGuessed: !!formationGuessed,
    parseStrategy: parseStrategy || null,
    source: source || null,
    by: by || 'agent',
    enteredAt: new Date().toISOString(),
    startXI: xi.map((p) => ({ afId: p.afId, name: p.name, nameEn: p.nameEn, number: p.number, pos: p.pos })),
    substitutes: subs.map((p) => ({ afId: p.afId, name: p.name, nameEn: p.nameEn, number: p.number, pos: p.pos })),
    lineups: [
      {
        team: { id: KOREA_TEAM_ID, name: 'Korea Republic U23' },
        formation,
        startXI: xi.map((p) => ({
          player: { id: p.afId, name: p.nameEn, number: p.number, pos: p.pos, grid: gridByAfIdOrName.get(gridKeyOf(p)) || null },
        })),
        substitutes: subs.map((p) => ({
          player: { id: p.afId, name: p.nameEn, number: p.number, pos: p.pos, grid: null },
        })),
      },
    ],
  };
  return { events, warnings };
}

async function upsertLineup({ fixtureId, formation, formationGuessed, xi, subs, source, by, parseStrategy }) {
  const { events, warnings } = buildEvents({ fixtureId, formation, formationGuessed, xi, subs, source, by, parseStrategy });
  await sbUpsertRow({ date: dateKeyFor(fixtureId), events, updated_at: new Date().toISOString() });
  return { events, warnings };
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

async function cmdCheck(args) {
  const fx = await fetchNextFixture();
  if (!fx) {
    console.log(JSON.stringify({ fixtureId: null, kickoff: null, opponent: null, minutesToKickoff: null, hasManual: false, status: null }, null, 2));
    if (args.within) process.exit(3);
    return;
  }
  const fixtureId = fx.fixture.id;
  const kickoff = fx.fixture.date;
  const opponent = opponentOf(fx)?.name || null;
  const minutesToKickoff = Math.round((new Date(kickoff).getTime() - Date.now()) / 60000);
  const status = fx.fixture.status?.short || null;
  const row = await sbGetRow(dateKeyFor(fixtureId)).catch(() => null);
  const hasManual = !!row;

  console.log(JSON.stringify({ fixtureId, kickoff, opponent, minutesToKickoff, hasManual, status }, null, 2));

  if (args.within) {
    const within = Number(args.within);
    if (minutesToKickoff > within) process.exit(3);
  }
}

// ---------------------------------------------------------------------------
// set
// ---------------------------------------------------------------------------

async function cmdSet(args) {
  const fixtureId = args.fixture;
  const formation = args.formation || '4-2-3-1';
  if (!fixtureId) { console.error('--fixture 필요'); process.exit(1); }
  const xiNames = (args.xi || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (xiNames.length !== 11) {
    console.error(`--xi 는 정확히 11명이어야 함 (받은 인원: ${xiNames.length})`);
    process.exit(1);
  }
  const benchNames = (args.bench || '').split(',').map((s) => s.trim()).filter(Boolean);

  const unknown = [];
  const xi = xiNames.map((n) => { const p = findSquad(n); if (!p) unknown.push(n); return p; });
  const subs = benchNames.map((n) => { const p = findSquad(n); if (!p) unknown.push(n); return p; }).filter(Boolean);
  if (unknown.length) {
    console.error(`AG_SQUAD 에 없는 이름: ${unknown.join(', ')}`);
    process.exit(1);
  }

  const source = (args['source-title'] || args['source-url'])
    ? { title: args['source-title'] || null, url: args['source-url'] || null, pubDate: null }
    : null;

  const { events, warnings } = await upsertLineup({
    fixtureId, formation, formationGuessed: false, xi, subs, source, by: args.by || 'agent',
  });
  warnings.forEach((w) => console.error(`[경고] ${w}`));
  console.log(JSON.stringify(events, null, 2));
}

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

async function cmdGet(args) {
  const fixtureId = args.fixture;
  if (!fixtureId) { console.error('--fixture 필요'); process.exit(1); }
  const row = await sbGetRow(dateKeyFor(fixtureId));
  if (!row) { console.log('none'); return; }
  console.log(JSON.stringify(row.events, null, 2));
}

// ---------------------------------------------------------------------------
// auto: 네이버 뉴스에서 선발 명단 기사를 찾아 자동으로 채운다.
// ---------------------------------------------------------------------------

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
}

// 전체 페이지 HTML에서 실제 기사 본문만 잘라낸다. 헤드라인(<title>/<h1>)에
// "선발"과 "벤치"가 나란히 들어가는 흔한 제목 패턴 때문에, 본문을 거르지
// 않고 페이지 전체를 텍스트로 바꾸면 컷 지점이 헤드라인 안에서 잘못
// 잡힌다(예: "…선발 공개... '양민혁 벤치'"). 알려진 본문 컨테이너를
// 순서대로 찾아 그 지점부터만 취하고, 못 찾으면 </h1> 이후, 그것도 없으면
// <title> 텍스트가 두 번째로 등장하는 지점(보통 메타 중복) 이후로 폴백한다.
function extractBodyHtml(html) {
  let h = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ');

  const markers = [
    /<article[^>]*>/i,
    /id=["']article-view-content-div["']/i,
    /id=["']articleBody["']/i,
    /class=["'][^"']*article_body[^"']*["']/i,
    /class=["'][^"']*article-body[^"']*["']/i,
    /class=["'][^"']*news_body[^"']*["']/i,
    /class=["'][^"']*articleView[^"']*["']/i,
    /itemprop=["']articleBody["']/i,
  ];
  for (const re of markers) {
    const m = h.match(re);
    if (m) return h.slice(m.index);
  }

  const h1Close = h.search(/<\/h1>/i);
  if (h1Close !== -1) return h.slice(h1Close + '</h1>'.length);

  const titleMatch = h.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    const titleText = titleMatch[1];
    const firstIdx = h.indexOf(titleText);
    const secondIdx = titleText ? h.indexOf(titleText, firstIdx + titleText.length) : -1;
    if (secondIdx !== -1) return h.slice(secondIdx + titleText.length);
  }
  return h;
}

function articleHtmlToText(html) {
  const bodyHtml = extractBodyHtml(html);
  let t = bodyHtml.replace(/<[^>]+>/g, ' ');
  t = decodeEntities(t);
  t = t.replace(/[ \t\r]+/g, ' ').replace(/\n+/g, '\n');
  return t;
}

// 텍스트에서 스쿼드 이름이 처음 등장하는 순서대로(중복 제거) 뽑는다.
// 이름이 전부 3음절 한글이라 서로 부분 문자열로 겹치지 않아 indexOf 로 충분하다.
function namesInOrder(text) {
  const found = [];
  for (const p of AG_SQUAD) {
    const idx = text.indexOf(p.name);
    if (idx !== -1) found.push({ idx, player: p });
  }
  found.sort((a, b) => a.idx - b.idx);
  return found.map((f) => f.player);
}

async function fetchArticleText(url, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    const html = await r.text();
    return articleHtmlToText(html);
  } finally {
    clearTimeout(t);
  }
}

async function naverSearch(query) {
  const url = `${NAVER_PROXY}?query=${encodeURIComponent(query)}&display=20&sort=date`;
  const data = await fetchJson(url);
  return data.items || [];
}

function decodeNaverSnippet(s) {
  return decodeEntities((s || '').replace(/<[^>]+>/g, ''));
}

const CUT_RE = /벤치|교체\s*명단|대기\s*명단|후보/;
const FORMATION_RE = /\b\d-\d(?:-\d){1,2}\b/;

// 숫자 포메이션(예: "4-2-3-1", "4-2-3-1 포메이션")을 우선 찾고, 없으면
// "포백"/"스리백|쓰리백" 같은 서술형 표현으로 유추한다. 포백은 구체적인
// 중원·공격 라인을 알 수 없어 결국 기본값(4-2-3-1)과 같으므로
// formationGuessed 를 켠다. 스리백은 실제 뽑힌 XI 의 DF/FW 수로 3-4-3 과
// 3-5-2 를 가른다.
function detectFormation(text, xi) {
  const numeric = text.match(FORMATION_RE);
  if (numeric) return { formation: numeric[0], formationGuessed: false };
  if (/포백/.test(text)) return { formation: '4-2-3-1', formationGuessed: true };
  if (/스리백|쓰리백/.test(text)) {
    const df = xi.filter((p) => p.pos === 'DF').length;
    const fw = xi.filter((p) => p.pos === 'FW').length;
    const formation = (df === 3 && fw === 3) ? '3-4-3' : '3-5-2';
    return { formation, formationGuessed: false };
  }
  return { formation: '4-2-3-1', formationGuessed: true };
}

// 1차: "선발" 다음 첫 컷 토큰(벤치/후보 등) 앞까지를 XI 로 본다.
function tryCutStrategy(text) {
  const selIdx = text.indexOf('선발');
  if (selIdx === -1) return { fail: true, candidateNames: [], count: 0, reason: "'선발' 문구 없음" };

  const rest = text.slice(selIdx);
  const cutMatch = rest.match(CUT_RE);
  const cutIdx = cutMatch ? selIdx + cutMatch.index : -1;

  const beforeCut = cutIdx === -1 ? text : text.slice(0, cutIdx);
  const afterCut = cutIdx === -1 ? '' : text.slice(cutIdx);

  const xiCandidates = namesInOrder(beforeCut);
  const benchCandidates = namesInOrder(afterCut).filter((p) => !xiCandidates.includes(p));

  if (xiCandidates.length !== 11) {
    return { fail: true, candidateNames: xiCandidates.map((p) => p.name), count: xiCandidates.length, reason: `beforeCut 구간 인원 ${xiCandidates.length}명 (11명 필요)` };
  }
  return { fail: false, xi: xiCandidates, bench: benchCandidates };
}

// 2차(폴백): 컷 지점이 잘못 잡혀 1차가 실패했을 때 — 본문 전체에서 처음
// 등장한 순서대로 이름을 모아, 11번째까지를 XI 후보로 삼는다. 다만 이게
// 진짜 XI 라는 근거가 있어야 채택한다: 12번째로 등장한 이름 전에 컷 토큰이
// 끼어 있거나, 11번째 이후 어딘가에 "벤치"라는 말이 나오면(즉 이 기사가
// 실제로 선발/벤치를 구분해 말하고 있다는 신호) 첫 11명을 그대로 쓴다.
function tryFirst11Strategy(text) {
  const ordered = namesInOrder(text);
  if (ordered.length < 11) {
    return { fail: true, candidateNames: ordered.map((p) => p.name), count: ordered.length, reason: `전체 인원 ${ordered.length}명 (11명 미만)` };
  }
  const eleventh = ordered[10];
  const idx11 = text.indexOf(eleventh.name);
  const twelfth = ordered[11] || null;

  let cutBeforeTwelfth = false;
  if (twelfth) {
    const idx12 = text.indexOf(twelfth.name);
    cutBeforeTwelfth = CUT_RE.test(text.slice(idx11, idx12));
  }
  const benchAfterEleventh = /벤치/.test(text.slice(idx11 + eleventh.name.length));

  if (!cutBeforeTwelfth && !benchAfterEleventh) {
    return { fail: true, candidateNames: ordered.slice(0, 11).map((p) => p.name), count: 11, reason: '12번째 선수 이전 컷 토큰도, 11번째 이후 벤치 언급도 없음(근거 부족)' };
  }
  return { fail: false, xi: ordered.slice(0, 11), bench: ordered.slice(11) };
}

// 기사 본문 하나를 파싱해 { xi, bench, formation, formationGuessed, parseStrategy }
// 또는 실패 시 { candidateNames, count, reason } 진단 정보를 반환한다.
function parseArticleText(text) {
  let result = tryCutStrategy(text);
  let parseStrategy = 'cut';
  if (result.fail) {
    const fallback = tryFirst11Strategy(text);
    if (!fallback.fail) { result = fallback; parseStrategy = 'first11'; }
    else {
      // 폴백도 실패 — 진단 정보는 둘 중 더 많이 뽑힌 쪽을 보여준다.
      return fallback.count >= result.count ? fallback : result;
    }
  }
  const { formation, formationGuessed } = detectFormation(text, result.xi);
  return { fail: false, xi: result.xi, bench: result.bench, formation, formationGuessed, parseStrategy };
}

async function cmdAuto(args) {
  const dryRun = !!args['dry-run'];
  const sinceHours = args['since-hours'] ? Number(args['since-hours']) : 6;

  let fixtureId = args.fixture;
  let opponentName = null;
  if (!fixtureId) {
    const fx = await fetchNextFixture();
    if (!fx) { console.log('다음 아시안게임 경기를 찾지 못함'); process.exit(2); }
    fixtureId = fx.fixture.id;
    opponentName = opponentOf(fx)?.name || null;
  } else {
    // --fixture 로 직접 지정된 경우에도 상대팀 이름이 필요하므로 다음 경기와
    // 같은지 확인해보고, 아니면 fixtures?id= 로 조회한다.
    try {
      const data = await fetchJson(`${AF_PROXY}?path=fixtures&id=${encodeURIComponent(fixtureId)}`);
      const fx = (data.response || [])[0];
      if (fx) opponentName = opponentOf(fx)?.name || null;
    } catch { /* 조회 실패해도 쿼리 일부만 못 만들 뿐 진행은 가능 */ }
  }

  const force = !!args.force;
  const existing = await sbGetRow(dateKeyFor(fixtureId)).catch(() => null);
  if (existing && existing.events?.by === 'agent' && !(dryRun && force)) {
    console.log(`이미 사람이 입력한 라인업 있음(by=agent) — no-op. fixtureId=${fixtureId}`);
    return;
  }

  const oppKr = opponentKorean(opponentName);
  const queries = [
    '아시안게임 축구 선발 라인업',
    `아시안게임 ${oppKr} 선발`,
    '이민성호 선발 명단',
    `한국 ${oppKr} 선발 명단`,
  ];

  const now = Date.now();
  const seen = new Map(); // link → item
  for (const q of queries) {
    let items = [];
    try { items = await naverSearch(q); } catch (e) { console.error(`[경고] 검색 실패 "${q}": ${e.message}`); continue; }
    for (const it of items) {
      const title = decodeNaverSnippet(it.title);
      const pubMs = Date.parse(it.pubDate);
      const ageHours = (now - pubMs) / 3600000;
      if (ageHours > sinceHours) continue;
      if (!title.includes('선발')) continue;
      if (!/라인업|명단|출격|발표|공개|확정/.test(title)) continue;
      const link = it.originallink || it.link;
      if (!seen.has(link)) seen.set(link, { ...it, title, pubMs });
    }
  }

  const candidates = [...seen.values()].sort((a, b) => b.pubMs - a.pubMs);
  if (!candidates.length) {
    console.log(`후보 기사 없음 (fixtureId=${fixtureId}, opponent=${oppKr}, sinceHours=${sinceHours})`);
    process.exit(2);
  }

  let best = null;
  for (const c of candidates) {
    let text;
    try { text = await fetchArticleText(c.originallink || c.link); }
    catch (e) { console.error(`[경고] 기사 가져오기 실패 ${c.originallink}: ${e.message}`); continue; }
    const parsed = parseArticleText(text);
    if (!parsed.fail) {
      const source = { title: c.title, url: c.originallink || c.link, pubDate: c.pubDate };
      console.log(`채택: ${c.title}\n  ${c.originallink}`);
      if (dryRun) {
        const { events, warnings } = buildEvents({
          fixtureId, formation: parsed.formation, formationGuessed: parsed.formationGuessed,
          xi: parsed.xi, subs: parsed.bench, source, by: 'auto', parseStrategy: parsed.parseStrategy,
        });
        warnings.forEach((w) => console.error(`[경고] ${w}`));
        console.log('(--dry-run: 저장 안 함)');
        console.log(JSON.stringify(events, null, 2));
      } else {
        const { events, warnings } = await upsertLineup({
          fixtureId, formation: parsed.formation, formationGuessed: parsed.formationGuessed,
          xi: parsed.xi, subs: parsed.bench, source, by: 'auto', parseStrategy: parsed.parseStrategy,
        });
        warnings.forEach((w) => console.error(`[경고] ${w}`));
        console.log(JSON.stringify(events, null, 2));
      }
      return;
    }
    if (!best || parsed.count > best.parsed.count) best = { candidate: c, parsed };
  }

  console.log('11명 정확히 뽑힌 기사 없음. 최선 후보:');
  if (best) {
    console.log(`  제목: ${best.candidate.title}`);
    console.log(`  URL: ${best.candidate.originallink || best.candidate.link}`);
    console.log(`  이유: ${best.parsed.reason}`);
    console.log(`  뽑힌 이름(${best.parsed.count}): ${best.parsed.candidateNames.join(', ')}`);
  }
  process.exit(2);
}

// ---------------------------------------------------------------------------
// entrypoint
// ---------------------------------------------------------------------------

async function main() {
  const [sub, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  switch (sub) {
    case 'check': return cmdCheck(args);
    case 'set': return cmdSet(args);
    case 'get': return cmdGet(args);
    case 'auto': return cmdAuto(args);
    default:
      console.error('사용법: node ag-lineup.mjs <check|set|get|auto> [옵션]');
      process.exit(1);
  }
}

// CLI로 직접 실행됐을 때만 main() 을 돈다 — 다른 스크립트(테스트 등)가
// import 해서 파싱 함수만 재사용할 수 있게 하기 위함. 동작은 기존과 동일.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
}

export { AG_SQUAD, naverSearch, decodeNaverSnippet, fetchArticleText, articleHtmlToText, parseArticleText, opponentKorean };
