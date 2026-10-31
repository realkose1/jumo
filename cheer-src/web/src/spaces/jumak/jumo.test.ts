import { describe, expect, it } from 'vitest';
import { JUMO_ROUTINE, JUMO_SPOTS, workPose } from './jumo';

describe('주모 부엌일', () => {
  it('한 바퀴에 국 젓기, 전 뒤집기, 국 뜨기, TV 보기가 다 있고 그 사이를 걸어 다닌다', () => {
    const kinds = JUMO_ROUTINE.map((t) => t.kind);
    for (const k of ['stir', 'flip', 'scoop', 'watch'] as const) expect(kinds).toContain(k);
    expect(kinds.filter((k) => k === 'walk').length).toBeGreaterThanOrEqual(3);
    // 일하는 자리는 부뚜막 앞, 제자리는 원래 서 있던 곳
    expect(JUMO_SPOTS.pot.z).toBeGreaterThan(-5.4);
    expect(JUMO_SPOTS.griddle.x).toBeGreaterThan(JUMO_SPOTS.pot.x);
  });

  it('국 저을 때 오른팔이 빙빙 돈다', () => {
    const a = workPose('stir', 0, false).right;
    const b = workPose('stir', 0.33, false).right;
    expect(a.fwd).toBeGreaterThan(1);
    expect(Math.abs(a.out - b.out) + Math.abs(a.fwd - b.fwd)).toBeGreaterThan(0.1);
  });

  it('전 뒤집기: 2.6초마다 0.45초 동안 뒤집개가 휙 올라가고 전이 돈다', () => {
    expect(workPose('flip', 0.2, false).flip).toBeGreaterThan(0);
    expect(workPose('flip', 1.5, false).flip).toBe(-1);
    expect(workPose('flip', 2.6 + 0.2, false).flip).toBeGreaterThan(0);
    expect(workPose('flip', 0.22, false).left.fwd).toBeGreaterThan(workPose('flip', 1.5, false).left.fwd);
  });
});
