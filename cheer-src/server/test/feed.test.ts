// 피드 모양 확인(src/feed.ts)과 로컬 가짜 경기(src/sim.ts)
import { describe, expect, it } from 'vitest';
import type { CheerFeed, Moment } from '../../shared/cheer';
import { deriveMoments } from '../../shared/moments';
import { feedKey, parseFeed } from '../src/feed';
import { SIM_TIMELINE, simFeed } from '../src/sim';

const goodMatch = {
  id: 'af-1',
  sport: 'soccer',
  comp: 'EPL',
  home: { name: 'A', score: 0 },
  away: { name: 'B', score: null },
  side: 'home',
  state: 'live',
  clock: "10'",
  ko: 1,
  players: [{ name: '선수', side: 'home', g: 0, a: 1 }],
};

describe('parseFeed', () => {
  it('피드 모양이 아니면 null', () => {
    expect(parseFeed(null)).toBeNull();
    expect(parseFeed([])).toBeNull();
    expect(parseFeed({ v: 2, now: 1, matches: [] })).toBeNull();
    expect(parseFeed({ v: 1, matches: [] })).toBeNull();
    expect(parseFeed({ v: 1, now: 1, matches: {} })).toBeNull();
  });

  it('모양이 틀린 경기는 빼고, 맞는 경기와 다른 필드는 그대로 둔다', () => {
    const feed = parseFeed({
      v: 1,
      now: 5,
      extra: 'kept',
      matches: [
        goodMatch,
        { ...goodMatch, id: 'bad-state', state: 'halftime' },
        { ...goodMatch, id: 'bad-score', home: { name: 'A', score: -1 } },
        { ...goodMatch, id: 'bad-player', players: [{ name: '', side: 'home', g: 0 }] },
        { ...goodMatch, id: 'x'.repeat(500) },
        'nope',
      ],
      next: { ...goodMatch, sport: 'cricket' },
    });
    expect(feed?.matches.map((m) => m.id)).toEqual(['af-1']);
    expect(feed?.next).toBeNull();
    expect((feed as unknown as { extra: string }).extra).toBe('kept');
  });

  it('feedKey는 피드를 만든 시각(now)이 달라도 같다', () => {
    const a = parseFeed({ v: 1, now: 1, matches: [goodMatch] })!;
    const b = parseFeed({ v: 1, now: 2, matches: [goodMatch] })!;
    expect(feedKey(a)).toBe(feedKey(b));
    const c = parseFeed({ v: 1, now: 2, matches: [{ ...goodMatch, clock: "11'" }] })!;
    expect(feedKey(c)).not.toBe(feedKey(a));
  });
});

describe('simFeed (로컬 가짜 경기)', () => {
  const START = 1_800_000_000_000;

  it('시간표대로 경기 전 -> 시작 -> 골 -> 우리 선수 골 -> 실점 -> 끝', () => {
    const at = (ms: number) => simFeed(START, START + ms).matches[0]!;
    expect(at(0)).toMatchObject({ state: 'pre', home: { score: null }, away: { score: null } });
    expect(at(SIM_TIMELINE.kickoff)).toMatchObject({ state: 'live', home: { score: 0 }, away: { score: 0 }, clock: "1'" });
    expect(at(SIM_TIMELINE.goal)).toMatchObject({ home: { score: 1 }, players: [{ name: '황희찬', g: 0 }] });
    expect(at(SIM_TIMELINE.playerGoal)).toMatchObject({ home: { score: 2 }, players: [{ name: '황희찬', g: 1 }] });
    expect(at(SIM_TIMELINE.concede)).toMatchObject({ away: { score: 1 } });
    expect(at(SIM_TIMELINE.final)).toMatchObject({ state: 'final', clock: '종료', home: { score: 2 }, away: { score: 1 } });
    expect(simFeed(START, START).next).toMatchObject({ sport: 'baseball', state: 'pre' });
  });

  it('2초마다 받아서 순간을 만들면 kickoff, goal, goal+player-goal, concede, final(승리) 순서로 한 번씩', () => {
    const seen = new Set<string>();
    const out: Moment[] = [];
    let prev: CheerFeed | null = null;
    for (let t = 0; t <= SIM_TIMELINE.cycle + 20_000; t += 2000) {
      const next = simFeed(START, START + t);
      for (const m of deriveMoments(prev, next, START + t)) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          out.push(m);
        }
      }
      prev = next;
    }
    expect(out.map((m) => `${m.kind}:${m.text}`)).toEqual([
      'kickoff:경기 시작!',
      'goal:울버햄튼 골!',
      'goal:울버햄튼 골!',
      'player-goal:황희찬 골!',
      'concede:아쉬워요, 실점',
      'final:경기 끝, 2:1 승리!',
      // 다음 바퀴는 새 경기 id라 처음 보는 경기: 경기 전으로 시작해서 다시 kickoff
      'kickoff:경기 시작!',
    ]);
    expect(new Set(out.map((m) => m.match)).size).toBe(2);
  });
});
