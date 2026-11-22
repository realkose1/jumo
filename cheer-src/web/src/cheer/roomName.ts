// 주막 이름. 간판과 문서 제목에는 선수 이름을 붙이지 않고, 지금 보는 경기가 무엇인지로 정한다(roomTitleFor):
// 국가대표 경기면 '국가대표 응원 주막', 해외 소속팀 축구면 '해외 축구 응원 주막', 메이저리그면 '해외 야구 응원 주막'.
// 앱 주막 입구(index.html jumakTitle)도 같은 규칙이다 — 고치면 같이 고친다.
// roomPlayerNames, formatRoomName은 선수 이름 묶음이 필요한 곳(시험, 앞으로의 화면)을 위해 남겨 둔다.
// three.js도 DOM도 모르는 순수한 계산이다.
import type { CheerFeed, CheerMatch } from '@shared/cheer';

/** 주막 간판 기본 이름 (경기가 없을 때, 해외 소속팀 축구를 볼 때) */
export const ROOM_TITLE = '해외 축구 응원 주막';
export const NATIONAL_TITLE = '국가대표 응원 주막';
export const BASEBALL_TITLE = '해외 야구 응원 주막';
/** 피드에 선수가 없을 때 */
export const FALLBACK_ROOM_NAME = ROOM_TITLE;
/** 피드가 없거나 로딩 중에도 쓰는 이름 (<title>의 처음 값도 이것) */
export const GENERIC_ROOM_NAME = ROOM_TITLE;

const SUFFIX = '응원 주막';

/** 이름 목록 -> 선수 이름을 붙인 글. 1명 "이강인 응원 주막", 2명 "백승호·이강인 응원 주막", 3명 이상 "이강인 외 2명 응원 주막" (간판에는 쓰지 않는다) */
export function formatRoomName(names: readonly string[]): string {
  const list = names.filter((n) => n.trim() !== '');
  if (list.length === 0) return ROOM_TITLE;
  if (list.length === 1) return `${list[0]} ${SUFFIX}`;
  if (list.length === 2) return `${list[0]}·${list[1]} ${SUFFIX}`;
  return `${list[0]} 외 ${list.length - 1}명 ${SUFFIX}`;
}

function namesOf(matches: readonly CheerMatch[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    for (const p of m.players) {
      const name = p.name.trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
  }
  return out;
}

const byKickoff = (a: CheerMatch, b: CheerMatch): number => a.ko - b.ko || a.id.localeCompare(b.id);

/**
 * 간판에 올릴 선수 이름들. 경기가 겹쳐도 주막은 하나라서 지금 함께 보는 경기의 선수를 모두 올린다.
 * 1) 진행 중인 경기의 선수들(킥오프 순) 다음에 곧 시작하는(pre, 60분 안) 경기의 선수들  2) 둘 다 없으면 피드의 다음 경기 선수.
 * focusId(?m=)가 그 경기라면 그 경기의 선수를 맨 앞으로 옮긴다(같은 이름들, 순서만 바뀐다).
 */
export function roomPlayerNames(feed: CheerFeed | null, focusId: string | null = null): string[] {
  if (!feed) return [];
  const live = feed.matches.filter((m) => m.state === 'live').sort(byKickoff);
  const pre = feed.matches.filter((m) => m.state === 'pre').sort(byKickoff);
  let chosen: CheerMatch[] = [...live, ...pre];
  if (chosen.length === 0 && feed.next) chosen = [feed.next];
  const names = namesOf(chosen);
  if (focusId && names.length > 1) {
    const focus = [...feed.matches, ...(feed.next ? [feed.next] : [])].find((m) => m.id === focusId);
    if (focus) {
      const first = namesOf([focus]).filter((n) => names.includes(n));
      if (first.length > 0) return [...first, ...names.filter((n) => !first.includes(n))];
    }
  }
  return names;
}

/** 대한민국 대표팀(A대표·U-23·올림픽 대표팀) 경기인가. 피드는 대표팀을 '대한민국', '대한민국 U-23', '올림픽 대표팀'으로 쓴다 */
export function isNationalMatch(m: CheerMatch): boolean {
  return m.sport === 'soccer' && [m.home.name, m.away.name].some((n) => /^대한민국|대표팀$/.test(n.trim()));
}

type MatchKind = 'national' | 'club' | 'baseball';
const kindOf = (m: CheerMatch): MatchKind => (m.sport === 'baseball' ? 'baseball' : isNationalMatch(m) ? 'national' : 'club');

/** 경기 묶음 -> 간판 이름. 한 종류면 그 이름, 섞이면 넓은 이름 */
export function roomTitleFor(matches: readonly CheerMatch[]): string {
  const kinds = new Set(matches.map(kindOf));
  if (kinds.size === 0) return ROOM_TITLE;
  if (kinds.size === 1) {
    const [only] = kinds;
    return only === 'national' ? NATIONAL_TITLE : only === 'baseball' ? BASEBALL_TITLE : ROOM_TITLE;
  }
  if (!kinds.has('baseball')) return '축구 응원 주막'; // 국가대표 + 해외 축구
  if (!kinds.has('national')) return '해외 스포츠 응원 주막'; // 해외 축구 + 야구
  return '응원 주막';
}

/**
 * 간판 이름: 지금 보는 경기로 정한다. 진행 중·곧 시작 경기 -> 없으면 막 끝난 경기 -> 없으면 다음 경기.
 * 피드가 없거나 경기가 하나도 없으면 '해외 축구 응원 주막'
 */
export function roomName(feed: CheerFeed | null = null, _focusId: string | null = null): string {
  if (!feed) return ROOM_TITLE;
  const open = feed.matches.filter((m) => m.state === 'live' || m.state === 'pre');
  if (open.length) return roomTitleFor(open);
  if (feed.matches.length) return roomTitleFor(feed.matches);
  return roomTitleFor(feed.next ? [feed.next] : []);
}
