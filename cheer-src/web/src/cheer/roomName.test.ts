import { describe, expect, it } from 'vitest';
import type { CheerFeed, CheerMatch, CheerPlayer } from '@shared/cheer';
import { FALLBACK_ROOM_NAME, formatRoomName, roomName, roomPlayerNames } from './roomName';

let n = 0;
function match(state: CheerMatch['state'], ko: number, names: string[], id = `m${++n}`): CheerMatch {
  const players: CheerPlayer[] = names.map((name) => ({ name, side: 'home', g: 0 }));
  return {
    id,
    sport: 'soccer',
    comp: '리그',
    home: { name: 'A', score: 0 },
    away: { name: 'B', score: 0 },
    side: 'home',
    state,
    clock: '',
    ko,
    players,
  };
}
const feed = (matches: CheerMatch[], next: CheerMatch | null = null): CheerFeed => ({ v: 1, now: 1000, matches, next });

describe('formatRoomName', () => {
  it('한 명, 두 명, 세 명 이상', () => {
    expect(formatRoomName(['이강인'])).toBe('이강인 응원 주막');
    expect(formatRoomName(['백승호', '이강인'])).toBe('백승호·이강인 응원 주막');
    expect(formatRoomName(['이강인', '황희찬', '김민재'])).toBe('이강인 외 2명 응원 주막');
    expect(formatRoomName(['a', 'b', 'c', 'd', 'e'])).toBe('a 외 4명 응원 주막');
  });

  it('이름이 없으면 주모', () => {
    expect(formatRoomName([])).toBe(FALLBACK_ROOM_NAME);
    expect(formatRoomName(['', '  '])).toBe('주모 응원 주막');
  });
});

describe('roomPlayerNames', () => {
  it('진행 중인 경기의 선수들을 킥오프 순으로', () => {
    const f = feed([match('live', 300, ['황희찬']), match('live', 100, ['이강인']), match('pre', 50, ['김민재'])]);
    expect(roomPlayerNames(f)).toEqual(['이강인', '황희찬']);
  });

  it('진행 중인 경기가 없으면 곧 시작하는 경기의 선수들', () => {
    const f = feed([match('final', 10, ['손흥민']), match('pre', 200, ['이강인']), match('pre', 100, ['황희찬'])]);
    expect(roomPlayerNames(f)).toEqual(['황희찬', '이강인']);
  });

  it('그것도 없으면 다음 경기의 선수', () => {
    expect(roomPlayerNames(feed([match('final', 1, ['손흥민'])], match('pre', 9, ['김하성'])))).toEqual(['김하성']);
  });

  it('피드가 없거나 선수가 없으면 빈 목록 -> 주모 응원 주막', () => {
    expect(roomPlayerNames(null)).toEqual([]);
    expect(roomName(feed([match('live', 1, [])]))).toBe('주모 응원 주막');
    expect(roomName(null)).toBe('주모 응원 주막');
  });

  it('같은 이름은 한 번만', () => {
    const f = feed([match('live', 1, ['이강인', '이강인']), match('live', 2, ['이강인', '황희찬'])]);
    expect(roomPlayerNames(f)).toEqual(['이강인', '황희찬']);
  });

  it('?m=은 그 경기의 선수를 맨 앞으로 옮길 뿐 이름들은 그대로', () => {
    const a = match('live', 1, ['이강인'], 'a');
    const b = match('live', 2, ['황희찬', '김민재'], 'b');
    const f = feed([a, b]);
    expect(roomPlayerNames(f, 'b')).toEqual(['황희찬', '김민재', '이강인']);
    expect(roomPlayerNames(f, 'a')).toEqual(['이강인', '황희찬', '김민재']);
    expect(new Set(roomPlayerNames(f, 'b'))).toEqual(new Set(roomPlayerNames(f)));
  });

  it('?m=이 선택된 선수들 밖이면 순서도 그대로', () => {
    const a = match('live', 1, ['이강인'], 'a');
    const b = match('live', 2, ['황희찬'], 'b');
    const fin = match('final', 0, ['손흥민'], 'fin');
    expect(roomPlayerNames(feed([a, b, fin]), 'fin')).toEqual(['이강인', '황희찬']);
    expect(roomPlayerNames(feed([a, b]), 'nope')).toEqual(['이강인', '황희찬']);
  });

  it('?m=이 다음 경기(next)일 때도 이름은 선택된 집합 안에서만', () => {
    const next = match('pre', 99, ['김하성'], 'n');
    expect(roomName(feed([], next), 'n')).toBe('김하성 응원 주막');
  });
});
