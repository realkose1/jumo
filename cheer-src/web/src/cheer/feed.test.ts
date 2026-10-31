import { describe, expect, it } from 'vitest';
import type { CheerFeed, CheerMatch } from '@shared/cheer';
import { buildTvView, formatWhen, hasLiveMatch, selectMatches, toMatchView } from './feed';

const NOW = Date.UTC(2026, 9, 31, 10, 0, 0); // 한국 시간 19:00 (토)

function match(id: string, over: Partial<CheerMatch> = {}): CheerMatch {
  return {
    id,
    sport: 'soccer',
    comp: '프리미어리그',
    home: { name: '울버햄튼', score: 1 },
    away: { name: '토트넘', score: 0 },
    side: 'home',
    state: 'live',
    clock: "67'",
    ko: NOW - 3_600_000,
    players: [],
    ...over,
  };
}

const feed = (matches: CheerMatch[], next: CheerMatch | null = null): CheerFeed => ({ v: 1, now: NOW, matches, next });

describe('selectMatches', () => {
  it('진행 중 -> 곧 시작 -> 방금 끝난 순', () => {
    const f = feed([
      match('fin', { state: 'final', ko: NOW - 7_000_000 }),
      match('pre', { state: 'pre', ko: NOW + 1_000_000 }),
      match('live', { state: 'live' }),
    ]);
    expect(selectMatches(f, null).map((m) => m.id)).toEqual(['live', 'pre', 'fin']);
  });

  it('최대 세 경기', () => {
    const f = feed([match('a'), match('b', { ko: NOW - 2_000_000 }), match('c', { ko: NOW - 1_000_000 }), match('d', { ko: NOW - 500_000 })]);
    expect(selectMatches(f, null)).toHaveLength(3);
  });

  it('?m= 경기가 맨 앞으로 온다', () => {
    const f = feed([match('a'), match('b', { state: 'pre', ko: NOW + 1000 })]);
    expect(selectMatches(f, 'b').map((m) => m.id)).toEqual(['b', 'a']);
  });

  it('?m= 경기가 다음 경기(next)여도 올린다', () => {
    const next = match('n', { state: 'pre', ko: NOW + 9_000_000 });
    const f = feed([match('a')], next);
    expect(selectMatches(f, 'n').map((m) => m.id)).toEqual(['n', 'a']);
  });

  it('없는 ?m=은 무시한다', () => {
    expect(selectMatches(feed([match('a')]), 'zzz').map((m) => m.id)).toEqual(['a']);
  });
});

describe('toMatchView', () => {
  it('우리 선수의 골은 공 그림으로, 야구는 홈런 글자로', () => {
    const v = toMatchView(match('a', { players: [{ name: '황희찬', side: 'home', g: 2 }, { name: '김하성', side: 'away', g: 0 }] }));
    expect(v.homePlayers).toEqual([{ name: '황희찬', badge: '⚽⚽', goals: 2 }]);
    expect(v.awayPlayers[0]).toMatchObject({ name: '김하성', badge: '' });
    const b = toMatchView(match('b', { sport: 'baseball', players: [{ name: '이정후', side: 'home', g: 1 }] }));
    expect(b.homePlayers[0]!.badge).toBe('홈런 1');
    const many = toMatchView(match('c', { players: [{ name: 'x', side: 'home', g: 5 }] }));
    expect(many.homePlayers[0]!.badge).toBe('⚽×5');
  });

  it('시작 전에는 점수를 비우고, 점수를 모르면 -', () => {
    const pre = toMatchView(match('a', { state: 'pre', home: { name: 'a', score: null }, away: { name: 'b', score: null } }));
    expect(pre.homeScore).toBe('');
    const unknown = toMatchView(match('b', { home: { name: 'a', score: null } }));
    expect(unknown.homeScore).toBe('-');
  });

  it('우리 쪽 표시', () => {
    expect(toMatchView(match('a', { side: 'away' })).ours).toBe('away');
    expect(toMatchView(match('a', { side: 'both' })).ours).toBe('both');
    expect(toMatchView(match('a', { side: null })).ours).toBeNull();
  });
});

describe('formatWhen (한국 시간)', () => {
  it('오늘, 내일, 모레, 그 밖은 날짜', () => {
    expect(formatWhen(NOW + 3_600_000, NOW)).toBe('오늘 20:00');
    expect(formatWhen(NOW + 9 * 3_600_000, NOW)).toBe('내일 04:00');
    expect(formatWhen(NOW + 33 * 3_600_000, NOW)).toBe('모레 04:00');
    expect(formatWhen(Date.UTC(2026, 10, 5, 10, 30), NOW)).toBe('11월 5일 19:30');
  });

  it('한국 날짜 기준으로 센다 (UTC 자정 직전이어도 한국은 다음 날)', () => {
    const lateUtc = Date.UTC(2026, 9, 31, 20, 0, 0); // 한국 11/1 05:00
    expect(formatWhen(lateUtc, NOW)).toBe('내일 05:00');
  });
});

describe('buildTvView', () => {
  it('피드가 없으면 기다리는 화면', () => {
    expect(buildTvView(null, null)).toEqual({ kind: 'waiting' });
  });

  it('경기가 있으면 경기 목록', () => {
    const v = buildTvView(feed([match('a')]), null);
    expect(v.kind).toBe('matches');
  });

  it('경기가 없으면 다음 경기, 그것도 없으면 쉬는 날', () => {
    const next = match('n', { state: 'pre', ko: NOW + 3_600_000, clock: '20:00 시작' });
    const idle = buildTvView(feed([], next), null);
    expect(idle).toEqual({
      kind: 'idle',
      next: { comp: '프리미어리그', home: '울버햄튼', away: '토트넘', when: '오늘 20:00' },
      name: '해외 축구 응원 주막',
    });
    expect(buildTvView(feed([]), null)).toEqual({ kind: 'idle', next: null, name: '해외 축구 응원 주막' });
  });
});

describe('hasLiveMatch', () => {
  it('진행 중인 경기가 있을 때만', () => {
    expect(hasLiveMatch(feed([match('a')]))).toBe(true);
    expect(hasLiveMatch(feed([match('a', { state: 'final' })]))).toBe(false);
    expect(hasLiveMatch(null)).toBe(false);
  });
});
