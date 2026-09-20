// Vercel serverless proxy for the official Aichi-Nagoya 2026 Asian Games
// results-widget medal API — used to show the medal table / latest medals /
// Korea's medal list in the app without the client dealing with the
// upstream's raw (and oddly-encoded) zlib payloads.
//
// Usage from client:
//   /api/ag-medals
//
// No API key needed. Upstream sometimes rejects non-browser UAs, so we send
// a desktop Chrome UA + Accept header, matching a real browser request.
const zlib = require('zlib');

const BASE = 'https://back.widgets.asiangames2026.org';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const TIMEOUT_MS = 10000;

// 국가명(OrgDesc) → 한글. 목록에 없으면 영어 원문을 그대로 쓴다.
const NAME_KO = {
  'People\'s Republic of China': '중국',
  'China': '중국',
  'Japan': '일본',
  'Republic of Korea': '대한민국',
  'Korea': '대한민국',
  'Kazakhstan': '카자흐스탄',
  'India': '인도',
  'Uzbekistan': '우즈베키스탄',
  'Chinese Taipei': '대만',
  'Thailand': '태국',
  'Iran': '이란',
  'Islamic Republic of Iran': '이란',
  'Indonesia': '인도네시아',
  'DPR Korea': '북한',
  'Hong Kong China': '홍콩',
  'Hong Kong, China': '홍콩',
  'Malaysia': '말레이시아',
  'Philippines': '필리핀',
  'Vietnam': '베트남',
  'Viet Nam': '베트남',
  'Singapore': '싱가포르',
  'Qatar': '카타르',
  'Saudi Arabia': '사우디아라비아',
  'Bahrain': '바레인',
  'Kuwait': '쿠웨이트',
  'Mongolia': '몽골',
  'Kyrgyzstan': '키르기스스탄',
  'Pakistan': '파키스탄',
  'Sri Lanka': '스리랑카',
  'Jordan': '요르단',
  'UAE': '아랍에미리트',
  'United Arab Emirates': '아랍에미리트',
  'Iraq': '이라크',
  'Tajikistan': '타지키스탄',
  'Turkmenistan': '투르크메니스탄',
  'Nepal': '네팔',
  'Myanmar': '미얀마',
  'Cambodia': '캄보디아',
  'Laos': '라오스',
  "Lao People's Democratic Republic": '라오스',
  'Macau China': '마카오',
  'Macao, China': '마카오',
  'Bangladesh': '방글라데시',
  'Lebanon': '레바논',
  'Syria': '시리아',
  'Oman': '오만',
  'Afghanistan': '아프가니스탄',
  'Brunei': '브루나이',
  'Brunei Darussalam': '브루나이',
  'Bhutan': '부탄',
  'Maldives': '몰디브',
  'Palestine': '팔레스타인',
  'Yemen': '예멘',
  'Timor-Leste': '동티모르',
};

// 종목(DiscDesc) → 한글. 목록에 없으면 영어 원문을 그대로 쓴다.
const DISC_KO = {
  'Swimming': '수영',
  'Diving': '다이빙',
  'Artistic Swimming': '아티스틱 스위밍',
  'Water Polo': '수구',
  'Athletics': '육상',
  'Archery': '양궁',
  'Badminton': '배드민턴',
  'Baseball': '야구',
  'Softball': '소프트볼',
  'Basketball': '농구',
  '3x3 Basketball': '3x3 농구',
  'Boxing': '복싱',
  'Canoe Slalom': '카누 슬라럼',
  'Canoe Sprint': '카누 스프린트',
  'Cycling Road': '사이클 도로',
  'Cycling Track': '사이클 트랙',
  'Cycling BMX': 'BMX',
  'Cycling Mountain Bike': '산악자전거',
  'Equestrian': '승마',
  'Fencing': '펜싱',
  'Football': '축구',
  'Golf': '골프',
  'Artistic Gymnastics': '기계체조',
  'Rhythmic Gymnastics': '리듬체조',
  'Trampoline': '트램펄린',
  'Handball': '핸드볼',
  'Hockey': '하키',
  'Judo': '유도',
  'Karate': '가라테',
  'Modern Pentathlon': '근대5종',
  'Rowing': '조정',
  'Rugby Sevens': '럭비',
  'Sailing': '요트',
  'Shooting': '사격',
  'Table Tennis': '탁구',
  'Taekwondo': '태권도',
  'Tennis': '테니스',
  'Soft Tennis': '소프트테니스',
  'Triathlon': '트라이애슬론',
  'Volleyball': '배구',
  'Beach Volleyball': '비치발리볼',
  'Weightlifting': '역도',
  'Wrestling': '레슬링',
  'Wushu': '우슈', 'Teqball': '테크볼', 'Cricket T20': '크리켓',
  'Sport Climbing': '스포츠클라이밍',
  'Skateboarding': '스케이트보드',
  'Breaking': '브레이킹',
  'Esports': 'e스포츠',
  'Kabaddi': '카바디',
  'Sepaktakraw': '세팍타크로',
  'Squash': '스쿼시',
  'Cricket': '크리켓',
  'Dragon Boat': '드래곤보트',
  'Jujitsu': '주짓수',
  'Kurash': '쿠라시',
  'Ju-Jitsu': '주짓수',
  'Mixed Martial Arts': '종합격투기',
  'Bridge': '브리지',
  'Chess': '체스',
  'Go': '바둑',
  'Xiangqi': '샹치',
  'Roller Sports': '롤러',
  'Dancesport': '댄스스포츠',
};

// EventDesc 토큰 → 한글. 못 찾는 단어(숫자·단위 등)는 그대로 둔다.
const EVENT_TOKEN_KO = {
  "Men's": '남자',
  "Women's": '여자',
  'Mixed': '혼성',
  'Team': '단체',
  'Individual': '개인',
  'Doubles': '복식',
  'Singles': '단식',
  'Freestyle': '자유형',
  'Backstroke': '배영',
  'Breaststroke': '평영',
  'Butterfly': '접영',
  'Medley': '혼영',
};

function nameKo(orgDesc) {
  return NAME_KO[orgDesc] || orgDesc || null;
}

function discKo(discDesc) {
  return DISC_KO[discDesc] || discDesc || null;
}

function eventKo(eventDesc, discDesc) {
  if (!eventDesc) return eventDesc || null;
  let s = eventDesc;
  // 여러 단어로 된 구문은 먼저 치환(공백 없는 한글로 바뀌므로 이후 토큰 분리에 안전)
  s = s.replace(/Time Trial/g, '독주');
  s = s.replace(/Road Race/g, '도로');
  const relayKo = discDesc === 'Swimming' ? '계영' : '계주';
  s = s.replace(/Relay/g, relayKo);
  s = s
    .split(' ')
    .map((word) => (Object.prototype.hasOwnProperty.call(EVENT_TOKEN_KO, word) ? EVENT_TOKEN_KO[word] : word))
    .join(' ');
  return s;
}

function isTeamMedal(item) {
  // 개인전은 항상 Bib 필드(빈 문자열이라도)를 갖고, Reg 는 선수 등록번호(숫자 문자열).
  // 단체전은 Bib 이 아예 없고 Reg 가 국가 코드(Org)와 같다.
  if (!Object.prototype.hasOwnProperty.call(item, 'Bib')) return true;
  if (item.Reg && item.Org && item.Reg === item.Org) return true;
  if (item.Name && item.OrgDesc && item.Name === item.OrgDesc) return true;
  return false;
}

async function fetchAG(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${BASE}${path}`, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/plain, */*',
      },
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`upstream ${r.status} for ${path}`);
    const ab = await r.arrayBuffer();
    return decodeAGBody(ab);
  } finally {
    clearTimeout(timer);
  }
}

// 응답 바디는 원래 raw zlib 스트림인데 바이트가 UTF-8 텍스트로 전송돼 있다.
// 그대로 latin1 로 읽으면 멀티바이트가 깨지므로, 먼저 utf8 로 디코딩한 문자열을
// 다시 latin1 바이트로 되돌려야 zlib.inflateSync 가 원래 바이트를 복원한다.
// 이미 JSON( '[' 또는 '{' 로 시작)이면 그대로 파싱.
function decodeAGBody(arrayBuffer) {
  const asUtf8 = Buffer.from(arrayBuffer).toString('utf8');
  const trimmed = asUtf8.trimStart();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return JSON.parse(asUtf8);
  }
  const buf = Buffer.from(asUtf8, 'latin1');
  const inflated = zlib.inflateSync(buf).toString('utf8');
  return JSON.parse(inflated);
}

function mapMedalItem(item) {
  const medal =
    item.Medal === 'ME_GOLD' ? 'gold' : item.Medal === 'ME_SILVER' ? 'silver' : item.Medal === 'ME_BRONZE' ? 'bronze' : null;
  return {
    medal,
    org: item.Org || null,
    name: item.OrgDesc || null,
    nameKo: nameKo(item.OrgDesc),
    date: item.DateRaw || null,
    disc: item.Disc || null,
    discKo: discKo(item.DiscDesc),
    eventDesc: item.EventDesc || null,
    eventKo: eventKo(item.EventDesc, item.DiscDesc),
    athlete: item.Name || null,
    isTeam: isTeamMedal(item),
  };
}

function sortByDateDesc(a, b) {
  const da = a.DateRaw ? new Date(a.DateRaw).getTime() : 0;
  const db = b.DateRaw ? new Date(b.DateRaw).getTime() : 0;
  return db - da;
}

module.exports = async function handler(req, res) {
  // CORS: the native app (capacitor://localhost) fetches this proxy cross-origin.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  let standingsRaw;
  try {
    standingsRaw = await fetchAG('/s/AG2026/en/ALL/medals/standings');
  } catch (e) {
    res.status(502).json({ error: e.message || 'upstream error' });
    return;
  }

  const [latestResult, koreaOrgResult, koreaStdResult] = await Promise.allSettled([
    fetchAG('/s/AG2026/en/ALL/medals/latest'),
    fetchAG('/s/AG2026/en/ALL/medals/org/KOR'),
    fetchAG('/s/AG2026/en/ALL/medals/standings/KOR'),
  ]);

  const latestRaw = latestResult.status === 'fulfilled' ? latestResult.value : [];
  const koreaOrgRaw = koreaOrgResult.status === 'fulfilled' ? koreaOrgResult.value : [];
  const koreaStdRaw = koreaStdResult.status === 'fulfilled' ? koreaStdResult.value : [];

  const standings = (Array.isArray(standingsRaw) ? standingsRaw : [])
    .map((row) => ({
      org: row.Org || null,
      name: row.OrgDesc || null,
      nameKo: nameKo(row.OrgDesc),
      rank: row.RkPo != null ? row.RkPo : (row.Rk != null ? Number(row.Rk) : null),
      gold: row.Count?.ME_GOLD?.total ?? 0,
      silver: row.Count?.ME_SILVER?.total ?? 0,
      bronze: row.Count?.ME_BRONZE?.total ?? 0,
      total: row.Count?.total?.total ?? 0,
    }))
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));

  const koreaRow = (Array.isArray(standingsRaw) ? standingsRaw : []).find((row) => row.Org === 'KOR');
  const korea = koreaRow
    ? {
        rank: koreaRow.RkPo != null ? koreaRow.RkPo : (koreaRow.Rk != null ? Number(koreaRow.Rk) : null),
        gold: koreaRow.Count?.ME_GOLD?.total ?? 0,
        silver: koreaRow.Count?.ME_SILVER?.total ?? 0,
        bronze: koreaRow.Count?.ME_BRONZE?.total ?? 0,
        total: koreaRow.Count?.total?.total ?? 0,
      }
    : null;

  const koreaByDiscipline = (Array.isArray(koreaStdRaw) ? koreaStdRaw : [])
    .map((row) => ({
      disc: row.Discipline || null,
      discDesc: row.DiscDesc || null,
      discKo: discKo(row.DiscDesc),
      gold: row.Count?.ME_GOLD?.total ?? 0,
      silver: row.Count?.ME_SILVER?.total ?? 0,
      bronze: row.Count?.ME_BRONZE?.total ?? 0,
      total: row.Count?.total?.total ?? 0,
      rank: row.RkPo != null ? row.RkPo : (row.Rk != null ? Number(row.Rk) : null),
    }))
    .filter((row) => row.total > 0)
    .sort((a, b) => b.gold - a.gold);

  const latest = (Array.isArray(latestRaw) ? latestRaw : [])
    .slice()
    .sort(sortByDateDesc)
    .slice(0, 40)
    .map(mapMedalItem);

  const koreaMedals = (Array.isArray(koreaOrgRaw) ? koreaOrgRaw : [])
    .slice()
    .sort(sortByDateDesc)
    .map(mapMedalItem);

  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
  res.status(200).json({
    updatedAt: new Date().toISOString(),
    standings,
    korea,
    koreaByDiscipline,
    latest,
    koreaMedals,
  });
};
