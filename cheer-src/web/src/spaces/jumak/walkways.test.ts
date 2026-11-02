import { describe, expect, it } from 'vitest';
import { jumak as shared } from '@shared/spaces/jumak';
import { DOORS, NPC_BOUNDS, STAND_SPOTS, blocked, pathLength, planPath, seatEntry, segmentClear, type Pt } from './walkways';

const allClear = (from: Pt, path: readonly Pt[]): boolean => {
  let at = from;
  for (const p of path) {
    if (!segmentClear(at, p)) return false;
    at = p;
  }
  return true;
};

describe('단골이 걷는 길', () => {
  it('서는 곳과 드나드는 곳은 평상·부뚜막에서 떨어져 있다', () => {
    for (const s of STAND_SPOTS) expect(blocked(s.x, s.z), s.id).toBe(false);
    for (const d of DOORS) expect(blocked(d.x, d.z)).toBe(false);
  });

  it('방석마다 평상 밖에 올라서는 곳이 있다', () => {
    for (const id of shared.seatIds) {
      const e = seatEntry(id);
      expect(e, id).not.toBeNull();
      expect(blocked(e!.x, e!.z), id).toBe(false);
      expect(e!.x).toBeGreaterThanOrEqual(NPC_BOUNDS.minX);
      expect(e!.z).toBeGreaterThanOrEqual(NPC_BOUNDS.minZ);
    }
    expect(seatEntry('z9')).toBeNull();
  });

  it('곧게 갈 수 있으면 한 번에 간다', () => {
    const to = { x: 6.3, z: 3.6 };
    expect(planPath({ x: 7.1, z: 1.2 }, to)).toEqual([to]);
  });

  it('평상을 가로지르지 않고 통로로 돌아간다', () => {
    const from = DOORS[0]!;
    const targets: Pt[] = [...STAND_SPOTS, ...shared.seatIds.map((id) => seatEntry(id)!)];
    for (const to of targets) {
      const path = planPath(from, to);
      expect(path.at(-1)).toEqual(to);
      expect(allClear(from, path)).toBe(true);
      // 돌아가도 터무니없이 멀지 않다
      expect(pathLength(from, path)).toBeLessThan(Math.hypot(to.x - from.x, to.z - from.z) * 2 + 4);
    }
  });

  it('뒷마당에서 주모 앞까지, 오른쪽 문에서 왼쪽 평상 앞줄까지', () => {
    const counter = STAND_SPOTS.find((s) => s.counter)!;
    const back = STAND_SPOTS.find((s) => s.id === 'back-right')!;
    expect(allClear(back, planPath(back, counter))).toBe(true);
    const a1 = seatEntry('a1')!;
    expect(allClear(DOORS[1]!, planPath(DOORS[1]!, a1))).toBe(true);
    // 곧게 가면 평상을 밟는 길이라, 중간에 꺾는 점이 있다
    expect(segmentClear(DOORS[1]!, a1)).toBe(false);
    expect(planPath(DOORS[1]!, a1).length).toBeGreaterThan(1);
  });
});
