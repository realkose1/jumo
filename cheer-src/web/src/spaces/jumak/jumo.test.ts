import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { JUMO_ROUTINE, JUMO_SPOTS, JumoRig, workPose } from './jumo';

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

describe('주모 한복', () => {
  const rig = new JumoRig();
  const body = rig.group.children[0] as THREE.Mesh;
  const arms = body.children as THREE.Mesh[];
  /** 높이 y가 [lo, hi]인 정점들의 상자 */
  const boxBetween = (g: THREE.BufferGeometry, lo: number, hi: number): THREE.Box3 => {
    const pos = g.getAttribute('position');
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (v.y >= lo && v.y <= hi) box.expandByPoint(v);
    }
    return box;
  };

  it('몸과 두 팔, 그리기 세 번에 재질 하나(정점 색)다', () => {
    const meshes: THREE.Mesh[] = [];
    rig.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    expect(meshes).toHaveLength(3);
    expect(new Set(meshes.map((m) => m.material)).size).toBe(1);
    for (const m of meshes) expect(m.geometry.getAttribute('color')).toBeDefined();
  });

  it('치마는 바닥에 닿아 종처럼 퍼지고, 어깨 둘레는 팔이 붙는 자리 안쪽이다', () => {
    const g = body.geometry;
    g.computeBoundingBox();
    const box = g.boundingBox!;
    expect(box.min.y).toBeCloseTo(0, 2);
    expect(box.max.y).toBeGreaterThan(1.3);
    expect(box.max.y).toBeLessThan(1.42);
    // 치맛단(주름 포함)은 넓고, 가슴(말기)은 좁다
    const hem = boxBetween(g, 0.02, 0.06);
    const chest = boxBetween(g, 0.66, 0.7);
    expect(hem.max.x).toBeGreaterThan(0.33);
    expect(hem.max.x).toBeLessThan(0.38);
    expect(chest.max.x).toBeLessThan(0.24);
    // 어깨 높이에서는 몸이 어깨(x 0.19) 안쪽이라 소매가 몸을 파고들지 않는다
    expect(boxBetween(g, 0.91, 0.93).max.x).toBeLessThan(0.2);
  });

  it('몸 한 덩어리에 치마 주름 그늘, 저고리, 자주 깃과 고름, 동정, 행주치마, 수건 색이 다 들어 있다', () => {
    const c = body.geometry.getAttribute('color');
    const seen = new Set<string>();
    for (let i = 0; i < c.count; i++) seen.add([c.getX(i), c.getY(i), c.getZ(i)].map((v) => v.toFixed(3)).join(','));
    expect(seen.size).toBeGreaterThan(12);
    const has = (hex: number) => {
      const want = new THREE.Color(hex);
      for (let i = 0; i < c.count; i++) {
        if (Math.abs(c.getX(i) - want.r) + Math.abs(c.getY(i) - want.g) + Math.abs(c.getZ(i) - want.b) < 0.003) return true;
      }
      return false;
    };
    // 저고리, 자주(깃·고름), 동정, 행주치마
    for (const hex of [0xf2dc8f, 0x9e2f58, 0xffffff, 0xf3efe4]) expect(has(hex)).toBe(true);
  });

  it('소매는 앞뒤로 넓은 배래이고 손과 도구는 소맷부리 아래에 있다', () => {
    for (const arm of arms) {
      const g = arm.geometry;
      const baerae = boxBetween(g, -0.25, -0.15);
      const depth = baerae.max.z - baerae.min.z;
      expect(depth).toBeGreaterThan(0.15);
      expect(depth).toBeGreaterThan(baerae.max.x - baerae.min.x);
      g.computeBoundingBox();
      expect(g.boundingBox!.min.y).toBeLessThan(-0.6);
    }
  });

  it('몸 삼각형 수가 적당하다 (주모는 한 명이다)', () => {
    const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    expect(tris(body.geometry)).toBeLessThan(12000);
    for (const arm of arms) expect(tris(arm.geometry)).toBeLessThan(2000);
  });
});
