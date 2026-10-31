import { describe, expect, it } from 'vitest';
import type { TvMatchView } from '../../cheer/feed';
import { PitchSim, broadcastPlaylist, ourPlayers, sameScene, sceneAt, seedOf } from './broadcast';

const match = (o: Partial<TvMatchView> = {}): TvMatchView => ({
  id: 'm1',
  sport: 'soccer',
  comp: '라리가',
  state: 'live',
  clock: "34'",
  homeName: '레반테',
  awayName: '아틀레티코',
  homeScore: '0',
  awayScore: '1',
  ours: 'away',
  homePlayers: [],
  awayPlayers: [{ name: '이강인', badge: '', goals: 0 }],
  ...o,
});

describe('중계 장면 순서', () => {
  it('진행 중 축구 하나: 경기장 20초 -> 선수 카드 7초 -> 점수판 7초 (34초 한 바퀴)', () => {
    const m = [match()];
    expect(sceneAt(m, 0)).toEqual({ kind: 'pitch', match: 0 });
    expect(sceneAt(m, 19_000).kind).toBe('pitch');
    expect(sceneAt(m, 21_000)).toEqual({ kind: 'player', match: 0, index: 0 });
    expect(sceneAt(m, 28_000).kind).toBe('scores');
    expect(sceneAt(m, 35_000).kind).toBe('pitch');
  });

  it('경기가 겹치면 한 TV가 경기마다 돌아가며 보여 주고 마지막에 점수판', () => {
    const a = match({ id: 'a', homeName: '버밍엄', awayName: '레딩', ours: 'home', homePlayers: [{ name: '백승호', badge: '', goals: 0 }], awayPlayers: [] });
    const b = match({ id: 'b' });
    const list = broadcastPlaylist([a, b]).map((s) => s.scene);
    expect(list).toEqual([
      { kind: 'pitch', match: 0 },
      { kind: 'player', match: 0, index: 0 },
      { kind: 'pitch', match: 1 },
      { kind: 'player', match: 1, index: 0 },
      { kind: 'scores' },
    ]);
    // 61초 한 바퀴: 20 + 7 + 20 + 7 + 7
    expect(sceneAt([a, b], 30_000)).toEqual({ kind: 'pitch', match: 1 });
    expect(sceneAt([a, b], 50_000)).toEqual({ kind: 'player', match: 1, index: 0 });
  });

  it('우리 선수가 없으면 선수 카드는 건너뛴다', () => {
    const m = [match({ awayPlayers: [] })];
    expect(broadcastPlaylist(m).map((s) => s.scene.kind)).toEqual(['pitch', 'scores']);
  });

  it('시작 전·야구는 경기장 없이 선수 카드와 (더 긴) 점수판', () => {
    const pre = [match({ state: 'pre', clock: '22:00 시작' })];
    expect(broadcastPlaylist(pre).map((s) => [s.scene.kind, s.ms])).toEqual([
      ['player', 7_000],
      ['scores', 12_000],
    ]);
    const baseball = [match({ sport: 'baseball' })];
    expect(broadcastPlaylist(baseball).some((s) => s.scene.kind === 'pitch')).toBe(false);
  });

  it('선수 카드는 골 많은 선수부터 돌아가며', () => {
    const m = match({ homePlayers: [{ name: '백승호', badge: '⚽', goals: 1 }] });
    expect(ourPlayers(m).map((p) => p.name)).toEqual(['백승호', '이강인']);
    expect(ourPlayers(m)[0]!.side).toBe('home');
  });

  it('같은 경기는 누구 화면에서나 같은 씨앗으로 움직이기 시작한다', () => {
    expect(seedOf('m1')).toBe(seedOf('m1'));
    expect(seedOf('m1')).not.toBe(seedOf('m2'));
    expect(sameScene({ kind: 'pitch', match: 0 }, { kind: 'pitch', match: 1 })).toBe(false);
    expect(sameScene({ kind: 'scores' }, { kind: 'scores' })).toBe(true);
  });
});

describe('가상 경기장', () => {
  it('22명이 경기장 안에서 움직이고 공이 오간다', () => {
    const sim = new PitchSim(42);
    expect(sim.players).toHaveLength(22);
    const start = sim.players.map((p) => [p.x, p.y]);
    const carriers = new Set<number>();
    for (let i = 0; i < 60 * 20; i++) {
      sim.step(1 / 60);
      carriers.add(sim.possession);
      for (const p of sim.players) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1);
      }
      expect(Number.isFinite(sim.ball.x) && Number.isFinite(sim.ball.y)).toBe(true);
    }
    const moved = sim.players.filter((p, i) => Math.hypot(p.x - start[i]![0]!, p.y - start[i]![1]!) > 0.02).length;
    expect(moved).toBeGreaterThan(10);
    // 20초 동안 공격권이 한 번은 넘어간다
    expect(carriers.size).toBe(2);
  });
});
