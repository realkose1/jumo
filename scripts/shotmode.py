#!/usr/bin/env python3
"""App Store 스크린샷 촬영용 임시 패치.

심사 가이드라인 4.1(a)로 한 번 반려됐다(2026-08-03): 스토어 메타데이터에
실제 구단·리그 표기와 엠블럼이 노출된 것이 문제였다. 스크린샷은 앱 UI를
그대로 보여주되 팀·리그·중계사만 가상 데이터로 바꿔 촬영한다.

  python3 scripts/shotmode.py apply    # index.html 에 촬영 모드 주입
  python3 scripts/shotmode.py revert   # git 으로 되돌리기

apply 후 `npm run build && npx cap copy ios` → 시뮬레이터 촬영 → revert.
촬영 모드 코드는 절대 커밋하지 않는다.
"""
import subprocess
import sys

SRC = 'index.html'

HELPERS = '''
// ─── App Store 스크린샷 촬영 모드 (scripts/shotmode.py 가 주입 · 커밋 금지) ───
// 구단·리그·중계사 실명과 엠블럼을 가상 데이터로 바꾼다.
const SHOT_MODE = true;
const SHOT_TEAMS = ['노르드 FC', '리버사이드 SC', '웨스트포트 FC', '하버 유나이티드',
  '그린필드 FC', '스톤브릿지 SC', '레이크뷰 FC', '아이언게이트 SC',
  '선셋 FC', '노스우드 SC', '베이사이드 FC', '크레스트힐 SC',
  '오크리지 FC', '실버레이크 SC', '포트힐 FC', '이스트뱅크 SC'];
const SHOT_MAP = new Map();
const shotName = (s) => {
  if (!s) return s;
  const k = String(s);
  if (SHOT_TEAMS.includes(k)) return k;               // 이미 치환된 값은 그대로
  if (!SHOT_MAP.has(k)) SHOT_MAP.set(k, SHOT_TEAMS[SHOT_MAP.size % SHOT_TEAMS.length]);
  return SHOT_MAP.get(k);
};
const shotLogo = (s) => {
  const n = shotName(s) || '';
  const initial = (n.replace(/[^가-힣A-Za-z]/g, '').charAt(0) || 'F');
  let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = [8, 210, 145, 42, 275, 190, 330][h % 7];
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
    + '<circle cx="32" cy="32" r="30" fill="hsl(' + hue + ',56%,42%)"/>'
    + '<text x="32" y="44" font-size="32" font-family="sans-serif" font-weight="700"'
    + ' fill="#fff" text-anchor="middle">' + initial + '</text></svg>';
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
};
// 실존 선수 이름·사진도 스토어 메타데이터에선 노출하지 않는다(선수 이름은 가상,
// 사진은 imageMap 미스 → 실루엣 폴백). 영문명은 경기 데이터 매칭에 쓰여
// KOREAN_PLAYERS 쪽은 원본을 유지하고 표시용(ALL_PLAYERS)만 바꾼다.
const SHOT_PLAYER = {
  '손흥민': ['김서준', 'Kim Seo-jun'],   '이강인': ['박도현', 'Park Do-hyun'],
  '김민재': ['최태오', 'Choi Tae-oh'],   '황희찬': ['정하람', 'Jung Ha-ram'],
  '황인범': ['한지우', 'Han Ji-woo'],    '조규성': ['서은호', 'Seo Eun-ho'],
  '이한범': ['윤도담', 'Yoon Do-dam'],   '오현규': ['임세인', 'Lim Se-in'],
  '양현준': ['문가온', 'Moon Ga-on'],    '백승호': ['강온유', 'Kang On-yu'],
  '배준호': ['조하민', 'Jo Ha-min'],     '엄지성': ['신은성', 'Shin Eun-sung'],
  '설영우': ['남기윤', 'Nam Gi-yun'],    '김하성': ['오재이', 'Oh Jae-yi'],
  '이정후': ['유시온', 'Yoo Si-on'],     '김혜성': ['표준영', 'Pyo Jun-young'],
};
const shotPlayerName = (n) => (SHOT_PLAYER[n] || [n])[0];
// 실사 대신 쓰는 플랫 일러스트 아바타 — 팀 컬러 유니폼 + 헤어 4종 + 피부톤 3종을
// 이름 해시로 골라 선수마다 다르게 보이게 한다. 빈 실루엣보다 '의도된 디자인'으로 읽힌다.
function ShotAvatar({ player, style = {} }) {
  let h = 0; for (const c of String(player.team || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = [8, 210, 145, 42, 275, 190, 330][h % 7];
  let h2 = 0; for (const c of String(player.name || '')) h2 = (h2 * 33 + c.charCodeAt(0)) >>> 0;
  const skin  = ['#e8b98f', '#f0c9a2', '#d9a97e'][h2 % 3];
  const skinD = ['#d6a67c', '#e0b78f', '#c7976c'][h2 % 3];
  const hairC = ['#221d1a', '#16161d', '#33261d'][(h2 >> 2) % 3];
  const jersey  = 'hsl(' + hue + ',48%,40%)';
  const jerseyD = 'hsl(' + hue + ',52%,29%)';
  const HAIR = [
    'M68,164 C68,108 90,88 120,88 C150,88 172,108 172,164 C172,130 152,118 120,118 C88,118 68,130 68,164 Z',
    'M68,164 C68,108 90,88 120,88 C150,88 172,108 172,164 C172,126 156,112 126,114 C110,116 94,126 84,138 C76,148 71,156 68,164 Z',
    'M68,164 C68,108 90,88 120,88 C150,88 172,108 172,164 C172,128 156,116 134,118 L120,132 L106,118 C84,116 68,128 68,164 Z',
    'M70,156 C70,104 94,86 120,86 C146,86 170,104 170,156 C170,126 148,110 120,110 C92,110 70,126 70,156 Z',
  ][h2 % 4];
  const gid = 'sav' + (player.id || h2);
  // 히어로처럼 넓은 영역(absolute inset 0)에선 확대·크롭하지 않고 인물 전체를
  // 하단 중앙에 fit — 배경은 div 그라디언트가 채운다.
  const isHero = style && style.position === 'absolute';
  return (
    <div style={{ position:'relative', overflow:'hidden',
      background: 'linear-gradient(180deg, hsl(' + hue + ',24%,17%), hsl(' + hue + ',20%,10%))', ...style }}>
      <svg width="100%" height="100%" viewBox="0 0 240 340"
        preserveAspectRatio={isHero ? 'xMidYMax meet' : 'xMidYMid slice'} style={{ display:'block' }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={'hsl(' + hue + ',24%,17%)'}/>
            <stop offset="1" stopColor={'hsl(' + hue + ',20%,10%)'}/>
          </linearGradient>
        </defs>
        {!isHero && <rect width="240" height="340" fill={'url(#' + gid + ')'}/>}
        <path d="M28,340 L28,306 C28,274 58,258 92,252 L148,252 C182,258 212,274 212,306 L212,340 Z" fill={jersey}/>
        <path d="M98,252 L120,274 L142,252 L130,247 L120,258 L110,247 Z" fill={jerseyD}/>
        <rect x="103" y="206" width="34" height="52" rx="13" fill={skinD}/>
        <circle cx="68" cy="166" r="10" fill={skinD}/>
        <circle cx="172" cy="166" r="10" fill={skinD}/>
        <ellipse cx="120" cy="162" rx="52" ry="60" fill={skin}/>
        <path d={HAIR} fill={hairC}/>
        <text x="120" y="322" textAnchor="middle" fontFamily="'Space Grotesk',monospace" fontWeight="700" fontSize="28" fill="rgba(255,255,255,0.55)">{player.number}</text>
      </svg>
    </div>
  );
}
const shotPlayerNameEn = (n, en) => (SHOT_PLAYER[n] || [null, en])[1];

function shotifySide(side) {
  if (!side) return side;
  // 선수의 kp.team 은 code 와 비교되므로 code 기준으로 한 번만 매핑해
  // 이름·코드·선수 소속이 같은 가상 팀으로 떨어지게 한다.
  const nm = shotName(side.code || side.name);
  return { ...side, name: nm, code: nm, logo: shotLogo(nm) };
}
function shotifyMatch(m) {
  if (!m) return m;
  const isBall = (m.sport || '').includes('MLB') || (m.sport || '').includes('⚾');
  return { ...m,
    home: shotifySide(m.home), away: shotifySide(m.away),
    competition: isBall ? '해외 야구 리그' : '해외 축구 리그', competitionLogo: null,
    // sport 의 두 번째 토큰은 카드 하단 '국가 · 리그' 라벨에 쓰인다 —
    // 이모지만 남겨 라벨이 '해외 축구 리그' 하나로 떨어지게 한다.
    sport: isBall ? '⚾' : '⚽',
    venue: '',
    koreanPlayer: m.koreanPlayer ? { ...m.koreanPlayer, team: shotName(m.koreanPlayer.team), name: shotPlayerName(m.koreanPlayer.name) } : m.koreanPlayer,
    koreanPlayers: m.koreanPlayers ? m.koreanPlayers.map(kp => ({ ...kp, team: shotName(kp.team), name: shotPlayerName(kp.name) })) : m.koreanPlayers,
  };
}
'''

# 1) 헬퍼는 getBroadcasters 앞(모듈 상단)에 둬야 함수 안에서 참조할 수 있다.
ANCHOR_HELPERS = 'function getBroadcasters(m) {'
# 2) 중계사는 표시하지 않는다.
ANCHOR_BROADCAST = ('function getBroadcasters(m) {', 'function getBroadcasters(m) {\n  if (SHOT_MODE) return [];')
# 3) 선수 레지스트리의 소속팀·리그도 가상 데이터로.
ANCHOR_PLAYERS = ("const PLAYERS = ALL_PLAYERS.slice(0, 5);",
                  "if (SHOT_MODE) ALL_PLAYERS.forEach(p => {\n"
                  "  p.team = shotName(p.team);\n"
                  "  p.league = p.sport === '야구' ? '해외 야구 리그' : '해외 축구 리그';\n"
                  "  p._origNameEn = p.nameEn;\n"
                  "  p.nameEn = shotPlayerNameEn(p.name, p.nameEn);\n"
                  "  p.name = shotPlayerName(p.name);\n"
                  "});\nconst PLAYERS = ALL_PLAYERS.slice(0, 5);")
# 4) 선수 상세·홈 히어로의 실사(유니폼에 구단 엠블럼이 크게 보임)는 쓰지 않는다.
ANCHOR_DETAIL_HERO = ("const file = LANDSCAPE[player.name];",
                      "const file = SHOT_MODE ? null : LANDSCAPE[player.name];")
ANCHOR_HOME_HERO = ("const landscapeFile = LANDSCAPE_MAP[playerName];",
                    "const landscapeFile = SHOT_MODE ? null : LANDSCAPE_MAP[playerName];")
# 4b) 커리어 타임라인(PLAYER_EXTRA.career)의 실제 구단·리그도 치환.
ANCHOR_CAREER = ("function CareerTimeline({ extra }) {",
                 """function CareerTimeline({ extra }) {
  if (SHOT_MODE) extra = { ...extra, career: (extra.career || []).map((c, i) => ({
    ...c, team: shotName(c.team),
    league: /K리그|K리그1|K리그2/.test(c.league) ? c.league : '해외 리그' })) };""")
# 4d) PlayerPhoto 를 통째로 아바타로 대체 (실사·실루엣 모두 대신)
ANCHOR_PHOTO = (
    "function PlayerPhoto({ player, style={}, tint='var(--bg)' }) {\n  const num = player.number;",
    "function PlayerPhoto({ player, style={}, tint='var(--bg)' }) {\n"
    "  if (SHOT_MODE) return <ShotAvatar player={player} style={style}/>;\n"
    "  const num = player.number;")
# 4c) AF 상세 토큰 매칭은 원본 영문명으로 (치환된 표기로는 로스터 매칭이 안 됨)
ANCHOR_CANONICAL = (
    "const canonical = ALL_PLAYERS.find(p => p.name === kp.name)?.nameEn || kp.nameEn || '';",
    "const _cp = ALL_PLAYERS.find(p => p.name === kp.name);\n"
    "              const canonical = (_cp && (_cp._origNameEn || _cp.nameEn)) || kp.nameEn || '';")
# 5) 경기 데이터는 상태에 들어가는 길목 한 곳에서 전부 치환한다.
ANCHOR_STATE = ("  const [liveMatches, setLiveMatches] = React.useState([]);",
                "  const [liveMatches, setLiveMatchesRaw] = React.useState([]);\n"
                "  const setLiveMatches = React.useCallback((v) => setLiveMatchesRaw(prev => {\n"
                "    const next = typeof v === 'function' ? v(prev) : v;\n"
                "    return SHOT_MODE ? next.map(shotifyMatch) : next;\n"
                "  }), []);")


def apply():
    s = open(SRC).read()
    if 'SHOT_MODE' in s:
        sys.exit('이미 촬영 모드가 적용돼 있습니다. 먼저 revert 하세요.')
    assert s.count(ANCHOR_HELPERS) == 1
    s = s.replace(ANCHOR_HELPERS, HELPERS.strip() + '\n\n' + ANCHOR_BROADCAST[1], 1)
    for old, new in (ANCHOR_PLAYERS, ANCHOR_DETAIL_HERO, ANCHOR_HOME_HERO, ANCHOR_CAREER, ANCHOR_CANONICAL, ANCHOR_PHOTO, ANCHOR_STATE):
        assert s.count(old) == 1, f'앵커를 찾지 못했습니다: {old[:40]}'
        s = s.replace(old, new, 1)
    open(SRC, 'w').write(s)
    print('촬영 모드 적용 — npm run build && npx cap copy ios 후 시뮬레이터에서 캡처하세요.')


def revert():
    subprocess.run(['git', 'checkout', '--', SRC], check=True)
    print('index.html 원복 완료.')


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'apply':
        apply()
    elif cmd == 'revert':
        revert()
    else:
        sys.exit('사용법: shotmode.py apply | revert')
