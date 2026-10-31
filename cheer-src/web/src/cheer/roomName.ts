// 주막 이름: 한 공간이지만 간판은 지금 응원하는 선수를 따라 "이강인 응원 주막"이 된다.
// 이름은 서버가 주는 경기 피드에서만 정하므로 방 모두가 같은 간판을 본다. three.js도 DOM도 모르는 순수한 계산이다.
import type { CheerFeed, CheerMatch } from '@shared/cheer';

/** 피드에 선수가 없을 때 */
export const FALLBACK_ROOM_NAME = '주모 응원 주막';
/** 피드가 없거나 로딩 중에도 쓰는 짧은 이름 (<title>의 처음 값도 이것) */
export const GENERIC_ROOM_NAME = '응원 주막';

const SUFFIX = '응원 주막';

/** 이름 목록 -> 간판 글. 1명 "이강인 응원 주막", 2명 "백승호·이강인 응원 주막", 3명 이상 "이강인 외 2명 응원 주막" */
export function formatRoomName(names: readonly string[]): string {
  const list = names.filter((n) => n.trim() !== '');
  if (list.length === 0) return FALLBACK_ROOM_NAME;
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
 * 간판에 올릴 선수 이름들.
 * 1) 진행 중인 경기의 선수들(킥오프 순)  2) 없으면 곧 시작하는(pre) 경기의 선수들  3) 없으면 피드의 다음 경기 선수.
 * focusId(?m=)가 그 경기라면 그 경기의 선수를 맨 앞으로 옮긴다(같은 이름들, 순서만 바뀐다).
 */
export function roomPlayerNames(feed: CheerFeed | null, focusId: string | null = null): string[] {
  if (!feed) return [];
  const live = feed.matches.filter((m) => m.state === 'live').sort(byKickoff);
  const pre = feed.matches.filter((m) => m.state === 'pre').sort(byKickoff);
  let chosen: CheerMatch[] = live;
  if (chosen.length === 0) chosen = pre;
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

export function roomName(feed: CheerFeed | null, focusId: string | null = null): string {
  return formatRoomName(roomPlayerNames(feed, focusId));
}
