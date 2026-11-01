import { describe, expect, it } from 'vitest';
import { bongeunsa as shared } from '@shared/spaces/bongeunsa';
import { SPAWN, WALK_BLOCKERS, WALK_BOUNDS, buildSeats, groundHeight, inside } from './layout';

const blocked = (x: number, z: number): boolean => WALK_BLOCKERS.some((r) => inside(r, x, z));

describe('봉은사 배치', () => {
  it('자리 id가 shared와 같다', () => {
    expect(buildSeats().map((s) => s.id)).toEqual([...shared.seatIds]);
  });

  it('처음 서는 곳은 막히지 않았고 걸을 수 있는 곳 안이다', () => {
    expect(blocked(SPAWN.x, SPAWN.z)).toBe(false);
    expect(inside(WALK_BOUNDS, SPAWN.x, SPAWN.z)).toBe(true);
  });

  it('모든 자리와 다가서는 곳이 막히지 않았다', () => {
    for (const s of buildSeats()) {
      const ax = s.approach?.x ?? s.x + Math.sin(s.facing) * 0.75;
      const az = s.approach?.z ?? s.z + Math.cos(s.facing) * 0.75;
      expect(blocked(s.x, s.z), `${s.id} 자리`).toBe(false);
      expect(blocked(ax, az), `${s.id} 다가서는 곳`).toBe(false);
      expect(inside(WALK_BOUNDS, ax, az), `${s.id} 범위`).toBe(true);
    }
  });

  it('진여문 가운데 칸으로 드나들 수 있다', () => {
    for (let z = 44; z >= 30; z -= 0.25) expect(blocked(0, z), `z=${z}`).toBe(false);
  });

  it('대웅전 계단을 오르면 툇마루 높이가 된다', () => {
    expect(groundHeight(0, -13.9)).toBe(0);
    expect(groundHeight(0, -14.75)).toBeCloseTo(0.55, 2);
    expect(groundHeight(0, -16.5)).toBeCloseTo(1.1, 5);
  });
});
