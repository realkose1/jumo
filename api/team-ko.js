// 팀 이름 한글 표기 (응원 주막 TV·순간 문구용). 응원 주막에는 영어를 쓰지 않는다.
// API-Football·MLB statsapi 가 주는 영문 이름을 한글로 바꾼다. 우리 선수가 뛰는 리그와
// 자주 만나는 상대, 유럽 대항전 단골, MLB 30개 팀을 담았다. 표에 없는 이름은 teamKo 가
// 정규화(악센트·FC 같은 꼬리말 제거)해서 한 번 더 찾고, 그래도 없으면 원래 이름을 돌려준다.

const KO = {
  // ── 잉글랜드: 프리미어리그 ──
  'Arsenal': '아스널', 'Aston Villa': '애스턴 빌라', 'Bournemouth': '본머스', 'AFC Bournemouth': '본머스',
  'Brentford': '브렌트퍼드', 'Brighton': '브라이턴', 'Brighton & Hove Albion': '브라이턴', 'Burnley': '번리',
  'Chelsea': '첼시', 'Crystal Palace': '크리스털 팰리스', 'Everton': '에버턴', 'Fulham': '풀럼',
  'Leeds': '리즈', 'Leeds United': '리즈', 'Liverpool': '리버풀', 'Manchester City': '맨체스터 시티',
  'Manchester United': '맨체스터 유나이티드', 'Newcastle': '뉴캐슬', 'Newcastle United': '뉴캐슬',
  'Nottingham Forest': '노팅엄 포리스트', 'Sunderland': '선덜랜드', 'Tottenham': '토트넘',
  'Tottenham Hotspur': '토트넘', 'West Ham': '웨스트햄', 'West Ham United': '웨스트햄',
  'Wolves': '울버햄튼', 'Wolverhampton': '울버햄튼', 'Wolverhampton Wanderers': '울버햄튼',
  'Newcastle U21': '뉴캐슬 21세 이하',
  // ── 잉글랜드: 챔피언십 ──
  'Birmingham': '버밍엄', 'Birmingham City': '버밍엄', 'Blackburn': '블랙번', 'Blackburn Rovers': '블랙번',
  'Bristol City': '브리스톨 시티', 'Charlton': '찰턴', 'Charlton Athletic': '찰턴', 'Coventry': '코번트리',
  'Coventry City': '코번트리', 'Derby': '더비', 'Derby County': '더비', 'Hull City': '헐 시티', 'Hull': '헐 시티',
  'Ipswich': '입스위치', 'Ipswich Town': '입스위치', 'Leicester': '레스터', 'Leicester City': '레스터',
  'Middlesbrough': '미들즈브러', 'Millwall': '밀월', 'Norwich': '노리치', 'Norwich City': '노리치',
  'Oxford United': '옥스퍼드', 'Oxford Utd': '옥스퍼드', 'Portsmouth': '포츠머스', 'Preston': '프레스턴',
  'Preston North End': '프레스턴', 'QPR': '퀸스 파크 레인저스', 'Queens Park Rangers': '퀸스 파크 레인저스',
  'Sheffield Utd': '셰필드 유나이티드', 'Sheffield United': '셰필드 유나이티드',
  'Sheffield Wednesday': '셰필드 웬즈데이', 'Sheffield Wed': '셰필드 웬즈데이', 'Southampton': '사우샘프턴',
  'Stoke City': '스토크', 'Stoke': '스토크', 'Swansea': '스완지', 'Swansea City': '스완지', 'Watford': '왓퍼드',
  'West Brom': '웨스트브로미치', 'West Bromwich Albion': '웨스트브로미치', 'Wrexham': '렉섬',
  'Luton': '루턴', 'Luton Town': '루턴', 'Cardiff': '카디프', 'Cardiff City': '카디프', 'Plymouth': '플리머스',
  'Plymouth Argyle': '플리머스', 'Huddersfield': '허더즈필드', 'Huddersfield Town': '허더즈필드',
  // ── 잉글랜드: 리그 원·투 (컵에서 만난다) ──
  'Lincoln': '링컨', 'Lincoln City': '링컨', 'Barnsley': '반즐리', 'Bolton': '볼턴', 'Bolton Wanderers': '볼턴',
  'Bradford': '브래드퍼드', 'Bradford City': '브래드퍼드', 'Burton Albion': '버턴', 'Cambridge United': '케임브리지',
  'Exeter City': '엑서터', 'Exeter': '엑서터', 'Leyton Orient': '레이턴 오리엔트', 'Mansfield Town': '맨스필드',
  'Mansfield': '맨스필드', 'Northampton': '노샘프턴', 'Northampton Town': '노샘프턴', 'Peterborough': '피터버러',
  'Peterborough United': '피터버러', 'Reading': '레딩', 'Rotherham': '로더럼', 'Rotherham United': '로더럼',
  'Stevenage': '스티버니지', 'Stockport County': '스톡포트', 'Wigan': '위건', 'Wigan Athletic': '위건',
  'Wycombe': '위컴', 'Wycombe Wanderers': '위컴', 'Doncaster': '돈캐스터', 'Doncaster Rovers': '돈캐스터',
  'Blackpool': '블랙풀', 'Port Vale': '포트 베일', 'AFC Wimbledon': '윔블던', 'Burton': '버턴',
  'Bristol Rovers': '브리스톨 로버스', 'Shrewsbury': '슈루즈베리', 'Crawley Town': '크롤리', 'Milton Keynes Dons': '밀턴킨스',
  'MK Dons': '밀턴킨스', 'Notts County': '노츠 카운티', 'Salford City': '샐퍼드', 'Swindon': '스윈던',
  'Gillingham': '질링엄', 'Walsall': '월솔', 'Chesterfield': '체스터필드', 'Barrow': '배로', 'Grimsby': '그림즈비',
  'Fleetwood Town': '플리트우드', 'Accrington': '애크링턴', 'Carlisle': '칼라일', 'Colchester': '콜체스터',
  'Morecambe': '모어캠', 'Tranmere': '트랜미어', 'Harrogate Town': '해러게이트', 'Bromley': '브롬리', 'Cheltenham': '첼트넘',
  // ── 독일: 분데스리가·2부 ──
  'Bayern München': '바이에른 뮌헨', 'Bayern Munich': '바이에른 뮌헨', 'Borussia Dortmund': '도르트문트',
  'Bayer Leverkusen': '레버쿠젠', 'RB Leipzig': '라이프치히', 'Eintracht Frankfurt': '프랑크푸르트',
  'VfB Stuttgart': '슈투트가르트', 'SC Freiburg': '프라이부르크', 'Freiburg': '프라이부르크',
  'VfL Wolfsburg': '볼프스부르크', 'Wolfsburg': '볼프스부르크', 'Borussia Mönchengladbach': '묀헨글라트바흐',
  'Borussia Monchengladbach': '묀헨글라트바흐', 'FSV Mainz 05': '마인츠', 'Mainz': '마인츠', 'Mainz 05': '마인츠',
  'FC Augsburg': '아우크스부르크', 'Augsburg': '아우크스부르크', 'Union Berlin': '우니온 베를린',
  '1. FC Union Berlin': '우니온 베를린', 'Werder Bremen': '베르더 브레멘', '1899 Hoffenheim': '호펜하임',
  'Hoffenheim': '호펜하임', 'TSG Hoffenheim': '호펜하임', '1. FC Heidenheim': '하이덴하임', 'Heidenheim': '하이덴하임',
  'FC St. Pauli': '장크트파울리', 'St. Pauli': '장크트파울리', '1. FC Köln': '쾰른', 'FC Koln': '쾰른', 'Köln': '쾰른',
  'Hamburger SV': '함부르크', 'Hamburg': '함부르크', 'Holstein Kiel': '홀슈타인 킬', 'VfL Bochum': '보훔',
  'Bochum': '보훔', 'FC Schalke 04': '샬케', 'Schalke 04': '샬케', 'Schalke': '샬케', 'Hertha Berlin': '헤르타 베를린',
  'Hertha BSC': '헤르타 베를린', 'Fortuna Düsseldorf': '뒤셀도르프', 'Fortuna Dusseldorf': '뒤셀도르프',
  'Hannover 96': '하노버', 'Karlsruher SC': '카를스루에', '1. FC Kaiserslautern': '카이저슬라우테른',
  'Kaiserslautern': '카이저슬라우테른', 'SC Paderborn 07': '파더보른', 'Paderborn': '파더보른',
  'SV Darmstadt 98': '다름슈타트', 'Darmstadt': '다름슈타트', 'Greuther Fürth': '퓌르트', 'Greuther Furth': '퓌르트',
  '1. FC Nürnberg': '뉘른베르크', 'Nurnberg': '뉘른베르크', 'Eintracht Braunschweig': '브라운슈바이크',
  'Arminia Bielefeld': '빌레펠트', 'Preußen Münster': '뮌스터', 'Preussen Munster': '뮌스터', 'SV Elversberg': '엘퍼스베르크',
  '1. FC Magdeburg': '마그데부르크', 'Magdeburg': '마그데부르크', 'Dynamo Dresden': '드레스덴', 'SV Sandhausen': '잔트하우젠',
  // ── 스페인: 라리가 ──
  'Atletico Madrid': '아틀레티코 마드리드', 'Atlético Madrid': '아틀레티코 마드리드', 'Real Madrid': '레알 마드리드',
  'Barcelona': '바르셀로나', 'FC Barcelona': '바르셀로나', 'Athletic Club': '아틀레틱 빌바오', 'Athletic Bilbao': '아틀레틱 빌바오',
  'Real Sociedad': '레알 소시에다드', 'Real Betis': '레알 베티스', 'Villarreal': '비야레알', 'Valencia': '발렌시아',
  'Sevilla': '세비야', 'Girona': '지로나', 'Celta Vigo': '셀타 비고', 'Osasuna': '오사수나', 'Getafe': '헤타페',
  'Rayo Vallecano': '라요 바예카노', 'Mallorca': '마요르카', 'Alaves': '알라베스', 'Alavés': '알라베스',
  'Espanyol': '에스파뇰', 'Levante': '레반테', 'Elche': '엘체', 'Real Oviedo': '레알 오비에도', 'Oviedo': '레알 오비에도',
  'Las Palmas': '라스팔마스', 'Leganes': '레가네스', 'Leganés': '레가네스', 'Valladolid': '바야돌리드',
  'Real Valladolid': '바야돌리드', 'Cadiz': '카디스', 'Granada': '그라나다', 'Almeria': '알메리아',
  // ── 포르투갈 ──
  'FC Porto': '포르투', 'Porto': '포르투', 'Benfica': '벤피카', 'Sporting CP': '스포르팅', 'Sporting Lisbon': '스포르팅',
  'SC Braga': '브라가', 'Braga': '브라가', 'Vitoria Guimaraes': '비토리아 기마랑이스', 'Guimaraes': '비토리아 기마랑이스',
  'Famalicao': '파말리캉', 'Moreirense': '모레이렌스', 'Rio Ave': '히우 아브', 'Gil Vicente': '질 비센트',
  'Estoril': '이스토릴', 'Casa Pia': '카사 피아', 'Arouca': '아로카', 'Santa Clara': '산타클라라', 'Nacional': '나시오날',
  'Estrela': '이스트렐라', 'AVS': '아베에스', 'Tondela': '톤델라', 'Alverca': '아우베르카', 'Boavista': '보아비스타',
  // ── 덴마크 ──
  'FC Midtjylland': '미트윌란', 'Midtjylland': '미트윌란', 'FC Copenhagen': '코펜하겐', 'FC Kobenhavn': '코펜하겐',
  'Brondby': '브뢴비', 'Brøndby': '브뢴비', 'AGF Aarhus': '오르후스', 'Aarhus': '오르후스', 'FC Nordsjaelland': '노르셸란',
  'Nordsjaelland': '노르셸란', 'Silkeborg': '실케보르', 'Randers FC': '라네르스', 'Randers': '라네르스',
  'Viborg': '비보르', 'Odense': '오덴세', 'OB': '오덴세', 'Vejle': '바일레', 'Sonderjyske': '쇠네르위스케',
  'Aalborg': '올보르', 'AaB': '올보르', 'Lyngby': '륑비', 'Fredericia': '프레데리시아',
  // ── 벨기에 ──
  'Club Brugge KV': '클뤼프 브뤼허', 'Club Brugge': '클뤼프 브뤼허', 'Westerlo': '베스테를로', 'KVC Westerlo': '베스테를로',
  'Anderlecht': '안데를레흐트', 'Genk': '헹크', 'KRC Genk': '헹크', 'Gent': '헨트', 'KAA Gent': '헨트',
  'Union St. Gilloise': '위니옹 생질루아즈', 'Union Saint-Gilloise': '위니옹 생질루아즈', 'Standard Liege': '스탕다르 리에주',
  'Antwerp': '앤트워프', 'Royal Antwerp': '앤트워프', 'Cercle Brugge': '세르클러 브뤼허', 'Mechelen': '메헬렌',
  'KV Mechelen': '메헬렌', 'Charleroi': '샤를루아', 'OH Leuven': '루뱅', 'Sint-Truiden': '신트트라위던',
  'STVV': '신트트라위던', 'Dender': '덴더르', 'Zulte Waregem': '쥘터 바레험', 'La Louviere': '라루비에르',
  // ── 튀르키예 ──
  'Besiktas': '베식타시', 'Beşiktaş': '베식타시', 'Galatasaray': '갈라타사라이', 'Fenerbahce': '페네르바흐체',
  'Fenerbahçe': '페네르바흐체', 'Trabzonspor': '트라브존스포르', 'Basaksehir': '바샥셰히르', 'Istanbul Basaksehir': '바샥셰히르',
  'Samsunspor': '삼순스포르', 'Goztepe': '괴즈테페', 'Göztepe': '괴즈테페', 'Kasimpasa': '카슴파샤',
  'Eyupspor': '에위프스포르', 'Antalyaspor': '안탈리아스포르', 'Alanyaspor': '알라니아스포르', 'Konyaspor': '코니아스포르',
  'Kayserispor': '카이세리스포르', 'Rizespor': '리제스포르', 'Gaziantep FK': '가지안테프', 'Kocaelispor': '코자엘리스포르',
  'Genclerbirligi': '겐츨레르비를리이', 'Fatih Karagumruk': '카라귐뤼크',
  // ── 스코틀랜드 ──
  'Celtic': '셀틱', 'Rangers': '레인저스', 'Hearts': '하츠', 'Heart Of Midlothian': '하츠', 'Hibernian': '히버니언',
  'Aberdeen': '애버딘', 'Motherwell': '마더웰', 'Dundee': '던디', 'Dundee Utd': '던디 유나이티드',
  'Dundee United': '던디 유나이티드', 'Kilmarnock': '킬마녹', 'St Mirren': '세인트 미렌', 'St. Mirren': '세인트 미렌',
  'Livingston': '리빙스턴', 'Falkirk': '폴커크', 'Ross County': '로스 카운티', 'St Johnstone': '세인트 존스턴',
  // ── 오스트리아 ──
  'Austria Vienna': '아우스트리아 빈', 'Austria Wien': '아우스트리아 빈', 'FK Austria Wien': '아우스트리아 빈',
  'Rapid Vienna': '라피트 빈', 'Rapid Wien': '라피트 빈', 'Red Bull Salzburg': '잘츠부르크', 'Salzburg': '잘츠부르크',
  'Sturm Graz': '슈투름 그라츠', 'LASK': '린츠', 'LASK Linz': '린츠', 'Wolfsberger AC': '볼프스베르거',
  'WAC': '볼프스베르거', 'Hartberg': '하르트베르크', 'Altach': '알타흐', 'Rheindorf Altach': '알타흐',
  'Blau-Weiss Linz': '블라우바이스 린츠', 'Grazer AK': '그라츠', 'Ried': '리트', 'SV Ried': '리트', 'WSG Tirol': '티롤',
  // ── 미국: MLS ──
  'Los Angeles FC': '로스앤젤레스', 'LAFC': '로스앤젤레스', 'LA Galaxy': '로스앤젤레스 갤럭시',
  'Los Angeles Galaxy': '로스앤젤레스 갤럭시', 'Inter Miami': '인터 마이애미', 'Inter Miami CF': '인터 마이애미',
  'Seattle Sounders': '시애틀', 'Portland Timbers': '포틀랜드', 'Vancouver Whitecaps': '밴쿠버', 'San Diego': '샌디에이고',
  'San Diego FC': '샌디에이고', 'San Jose Earthquakes': '새너제이', 'Real Salt Lake': '레알 솔트레이크',
  'Colorado Rapids': '콜로라도', 'Sporting Kansas City': '캔자스시티', 'Minnesota United': '미네소타',
  'Minnesota United FC': '미네소타', 'Austin': '오스틴', 'Austin FC': '오스틴', 'FC Dallas': '댈러스',
  'Houston Dynamo': '휴스턴', 'St. Louis City': '세인트루이스', 'Atlanta United': '애틀랜타', 'Atlanta United FC': '애틀랜타',
  'Charlotte': '샬럿', 'Charlotte FC': '샬럿', 'Chicago Fire': '시카고', 'Columbus Crew': '콜럼버스',
  'DC United': '디시 유나이티드', 'FC Cincinnati': '신시내티', 'CF Montreal': '몬트리올', 'Nashville SC': '내슈빌',
  'New England Revolution': '뉴잉글랜드', 'New York City FC': '뉴욕 시티', 'New York Red Bulls': '뉴욕 레드불스',
  'Orlando City SC': '올랜도', 'Orlando City': '올랜도', 'Philadelphia Union': '필라델피아', 'Toronto FC': '토론토',
  // ── 이탈리아·프랑스·네덜란드 (대항전) ──
  'Inter': '인테르', 'Inter Milan': '인테르', 'AC Milan': '밀란', 'Juventus': '유벤투스', 'Napoli': '나폴리',
  'AS Roma': '로마', 'Roma': '로마', 'Lazio': '라치오', 'Atalanta': '아탈란타', 'Fiorentina': '피오렌티나', 'Bologna': '볼로냐',
  'Paris Saint Germain': '파리 생제르맹', 'Paris Saint-Germain': '파리 생제르맹', 'PSG': '파리 생제르맹', 'Marseille': '마르세유',
  'Lyon': '리옹', 'Monaco': '모나코', 'Lille': '릴', 'Nice': '니스', 'Lens': '랑스', 'Rennes': '렌', 'Strasbourg': '스트라스부르',
  'Ajax': '아약스', 'PSV Eindhoven': '에인트호번', 'PSV': '에인트호번', 'Feyenoord': '페예노르트', 'AZ Alkmaar': '알크마르',
  'FC Twente': '트벤테', 'Twente': '트벤테', 'Utrecht': '위트레흐트', 'FC Utrecht': '위트레흐트',
  // ── 그 밖의 유럽 대항전 단골 ──
  'Crvena Zvezda': '츠르베나 즈베즈다', 'Red Star Belgrade': '츠르베나 즈베즈다', 'Partizan': '파르티잔',
  'Shakhtar Donetsk': '샤흐타르', 'Dynamo Kyiv': '디나모 키이우', 'Olympiakos Piraeus': '올림피아코스',
  'Olympiacos': '올림피아코스', 'PAOK': '파오크', 'Panathinaikos': '파나티나이코스', 'AEK Athens': '아테네',
  'Slavia Praha': '슬라비아 프라하', 'Sparta Praha': '스파르타 프라하', 'Viktoria Plzen': '빅토리아 플젠',
  'Ferencvarosi TC': '페렌츠바로시', 'Ferencvaros': '페렌츠바로시', 'Dinamo Zagreb': '디나모 자그레브',
  'Young Boys': '영 보이스', 'Basel': '바젤', 'FC Basel 1893': '바젤', 'Malmo FF': '말뫼', 'Bodo/Glimt': '보되/글림트',
  'Molde': '몰데', 'Qarabag': '카라바흐', 'Ludogorets': '루도고레츠', 'Maccabi Tel Aviv': '마카비 텔아비브',
  'FCSB': '스테아우아', 'Legia Warszawa': '레기아 바르샤바', 'Lech Poznan': '레흐 포즈난', 'Celje': '첼레',
  // ── MLB ──
  'Arizona Diamondbacks': '애리조나', 'Atlanta Braves': '애틀랜타', 'Baltimore Orioles': '볼티모어',
  'Boston Red Sox': '보스턴', 'Chicago Cubs': '시카고 컵스', 'Chicago White Sox': '시카고 화이트삭스',
  'Cincinnati Reds': '신시내티', 'Cleveland Guardians': '클리블랜드', 'Colorado Rockies': '콜로라도',
  'Detroit Tigers': '디트로이트', 'Houston Astros': '휴스턴', 'Kansas City Royals': '캔자스시티',
  'Los Angeles Angels': '에인절스', 'Los Angeles Dodgers': '다저스', 'Miami Marlins': '마이애미',
  'Milwaukee Brewers': '밀워키', 'Minnesota Twins': '미네소타', 'New York Mets': '뉴욕 메츠',
  'New York Yankees': '뉴욕 양키스', 'Athletics': '애슬레틱스', 'Oakland Athletics': '애슬레틱스',
  'Philadelphia Phillies': '필라델피아', 'Pittsburgh Pirates': '피츠버그', 'San Diego Padres': '샌디에이고',
  'San Francisco Giants': '샌프란시스코', 'Seattle Mariners': '시애틀', 'St. Louis Cardinals': '세인트루이스',
  'Tampa Bay Rays': '탬파베이', 'Texas Rangers': '텍사스', 'Toronto Blue Jays': '토론토', 'Washington Nationals': '워싱턴',
};

/** 비교용으로 다듬기: 악센트·문장부호를 없애고 소문자로 */
function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss').replace(/ø/g, 'o').replace(/æ/g, 'ae')
    .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
/** 'FC', 'AFC' 같은 흔한 꼬리말을 뗀 꼴 */
const FILLER = new Set(['fc', 'afc', 'cf', 'sc', 'ac', 'fk', 'sk', 'kv', 'krc', 'kaa', 'tsg', 'vfb', 'vfl', 'sv', 'bsc', '1', 'cd', 'ud', 'rc', 'rcd', 'ca']);
const bare = (s) => norm(s).split(' ').filter((w) => !FILLER.has(w)).join(' ');

const BY_NORM = new Map();
const BY_BARE = new Map();
for (const [en, ko] of Object.entries(KO)) {
  if (!BY_NORM.has(norm(en))) BY_NORM.set(norm(en), ko);
  if (!BY_BARE.has(bare(en))) BY_BARE.set(bare(en), ko);
}

/** 영문 팀 이름 -> 한글. 이미 한글이거나 표에 없으면 받은 그대로(19세 이하 같은 꼬리 처리 포함) */
function teamKo(name) {
  const s = String(name || '').trim();
  if (!s || !/[A-Za-z]/.test(s)) return s;
  if (KO[s]) return KO[s];
  const n = norm(s);
  if (BY_NORM.has(n)) return BY_NORM.get(n);
  // 'Birmingham U21', 'Celtic W' 같은 꼬리
  const youth = /^(.*?)\s+(u-?\d{2}|ii|b|w|women)$/i.exec(s);
  if (youth) {
    const base = teamKo(youth[1]);
    if (base !== youth[1]) {
      const tail = youth[2].toLowerCase();
      const ko = /^u/.test(tail) ? `${tail.replace(/\D/g, '')}세 이하` : tail === 'w' || tail === 'women' ? '여자팀' : '2군';
      return `${base} ${ko}`;
    }
  }
  const b = bare(s);
  if (b && BY_BARE.has(b)) return BY_BARE.get(b);
  return s;
}

/** 대회 이름 -> 한글 (응원 주막 TV용) */
const COMP_KO = {
  'Premier League': '프리미어리그', 'Championship': '챔피언십', 'League One': '리그 원', 'League Two': '리그 투',
  'FA Cup': '잉글랜드 축구협회컵', 'League Cup': '잉글랜드 리그컵', 'EFL Cup': '잉글랜드 리그컵', 'EFL Trophy': '잉글랜드 트로피',
  'Community Shield': '커뮤니티 실드',
  'Bundesliga': '분데스리가', '2. Bundesliga': '2부 분데스리가', 'DFB Pokal': '독일 포칼컵',
  'La Liga': '라리가', 'Copa del Rey': '코파 델 레이', 'Ligue 1': '리그앙', 'Coupe de France': '프랑스컵',
  'Serie A': '세리에아', 'Coppa Italia': '이탈리아컵', 'Primeira Liga': '포르투갈 리그', 'Taça de Portugal': '포르투갈컵',
  'Superliga': '덴마크 리그', 'DBU Pokalen': '덴마크컵', 'Jupiler Pro League': '벨기에 리그', 'Belgian Cup': '벨기에컵',
  'Süper Lig': '튀르키예 리그', 'Super Lig': '튀르키예 리그', 'Turkish Cup': '튀르키예컵',
  'Premiership': '스코틀랜드 리그', 'Scottish Cup': '스코틀랜드컵',
  'Eredivisie': '에레디비시', 'Major League Soccer': '미국 프로축구', 'MLS': '미국 프로축구', 'US Open Cup': '미국 오픈컵',
  'Leagues Cup': '리그스컵', 'Serbian SuperLiga': '세르비아 리그',
  'UEFA Champions League': '챔피언스리그', 'UEFA Europa League': '유로파리그', 'UEFA Conference League': '컨퍼런스리그',
  'UEFA Europa Conference League': '컨퍼런스리그', 'UEFA Super Cup': '슈퍼컵', 'UEFA Nations League': '네이션스리그',
  'Asian Games': '아시안게임', 'Friendlies': '친선 경기', 'Friendlies Clubs': '친선 경기',
  'World Cup - Qualification Asia': '월드컵 아시아 예선', 'World Cup': '월드컵', 'AFC Asian Cup': '아시안컵',
  'Club Friendlies': '친선 경기', 'OFB Cup': '오스트리아컵',
};
/** 같은 이름을 여러 나라가 쓰는 대회(분데스리가, 리그컵)는 나라로 가른다 */
const COMP_BY_COUNTRY = {
  'Austria|Bundesliga': '오스트리아 리그', 'Scotland|League Cup': '스코틀랜드 리그컵', 'Denmark|Superliga': '덴마크 리그',
  'Serbia|Super Liga': '세르비아 리그',
};
function compKo(name, country) {
  const s = String(name || '').trim();
  if (!s) return '축구';
  if (!/[A-Za-z]/.test(s)) return s;
  return COMP_BY_COUNTRY[`${country || ''}|${s}`] || COMP_KO[s] || '축구';
}

module.exports = { teamKo, compKo, TEAM_KO: KO };
