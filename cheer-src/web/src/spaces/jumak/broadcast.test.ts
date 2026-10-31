import { describe, expect, it } from 'vitest';
import type { TvMatchView } from '../../cheer/feed';
import { PitchSim, ourPlayers, sceneAt } from './broadcast';
import { playerPhotoUrl } from './playerPhotos';

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
  it('진행 중 축구: 경기장 -> 선수 카드 -> 점수판이 40초마다 돈다', () => {
    const m = match();
    expect(sceneAt(m, 0).kind).toBe('pitch');
    expect(sceneAt(m, 25_000).kind).toBe('pitch');
    expect(sceneAt(m, 27_000)).toEqual({ kind: 'player', index: 0 });
    expect(sceneAt(m, 35_000).kind).toBe('scores');
    expect(sceneAt(m, 41_000).kind).toBe('pitch');
  });

  it('우리 선수가 없으면 선수 카드는 건너뛴다', () => {
    const m = match({ awayPlayers: [] });
    expect(sceneAt(m, 27_000).kind).toBe('scores');
  });

  it('시작 전·야구는 경기장 없이 점수판과 선수 카드만', () => {
    const pre = match({ state: 'pre', clock: '22:00 시작' });
    expect(sceneAt(pre, 0).kind).toBe('scores');
    expect(sceneAt(pre, 13_000).kind).toBe('player');
    const baseball = match({ sport: 'baseball' });
    expect(sceneAt(baseball, 0).kind).toBe('scores');
  });

  it('선수 카드는 골 많은 선수부터 돌아가며', () => {
    const m = match({ homePlayers: [{ name: '백승호', badge: '⚽', goals: 1 }] });
    expect(ourPlayers(m).map((p) => p.name)).toEqual(['백승호', '이강인']);
    expect(ourPlayers(m)[0]!.side).toBe('home');
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

describe('선수 사진', () => {
  it('주모 앱과 같은 /image/ 사진을 쓴다', () => {
    expect(playerPhotoUrl('이강인')).toBe('/image/kangin.png');
    expect(playerPhotoUrl('백승호')).toBe('/image/seungho.png');
    expect(playerPhotoUrl('모르는선수')).toBeNull();
  });
});
