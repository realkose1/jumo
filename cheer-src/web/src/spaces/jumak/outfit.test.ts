import { afterAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  BODY_HEIGHT,
  DETAIL_PRESETS,
  accessoryShown,
  disposeAvatarResources,
  getAccessoryGeometry,
  getAvatarGeometries,
} from '../../engine/avatar';
import { JUMAK_OUTFIT } from './outfit';

afterAll(() => disposeAvatarResources());

const triangles = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
const accessories = JUMAK_OUTFIT.accessories ?? [];
const shownKeys = (look: number): string[] => accessories.filter((a) => accessoryShown(a, look)).map((a) => a.key);

function distinctColors(g: THREE.BufferGeometry): number {
  const c = g.getAttribute('color');
  const seen = new Set<string>();
  for (let i = 0; i < c.count; i++) seen.add([c.getX(i), c.getY(i), c.getZ(i)].map((v) => v.toFixed(3)).join(','));
  return seen.size;
}

describe('주막 한복', () => {
  it('몸통, 소매, 발을 캡슐 대신 직접 만든다 (정점 색, 기본 몸과 같은 크기와 어깨 자리)', () => {
    for (const d of [DETAIL_PRESETS.peer, DETAIL_PRESETS.self]) {
      const g = getAvatarGeometries(d, JUMAK_OUTFIT);
      const base = getAvatarGeometries(d);
      expect(g.body).not.toBe(base.body);
      expect(g.arm).not.toBe(base.arm);
      expect(g.foot).not.toBe(base.foot);
      for (const part of [g.body, g.arm, g.foot]) expect(part.getAttribute('color')).toBeDefined();
      g.body.computeBoundingBox();
      const box = g.body.boundingBox!;
      expect(box.min.y).toBeCloseTo(0, 2);
      expect(box.max.y).toBeGreaterThan(BODY_HEIGHT - 0.02);
      expect(box.max.y).toBeLessThan(BODY_HEIGHT + 0.02);
      // 어깨(x 0.2) 둘레가 기본 몸통과 비슷해 팔이 제자리에 붙는다 (저고리 도련만 살짝 퍼진다)
      expect(box.max.x).toBeGreaterThan(0.2);
      expect(box.max.x).toBeLessThan(0.24);
    }
  });

  it('몸통 한 덩어리에 저고리, 바지, 대님, 깃, 동정, 고름 색이 다 들어 있다', () => {
    const g = getAvatarGeometries(DETAIL_PRESETS.peer, JUMAK_OUTFIT);
    expect(distinctColors(g.body)).toBeGreaterThanOrEqual(5);
    // 옷 색은 정점 색에 있고 재질은 흰색을 곱한다
    expect(JUMAK_OUTFIT.bodyColor).toBe(0xffffff);
  });

  it('차림마다 겉옷이 정확히 하나다: 선비는 갓, 도포, 세조대, 장정은 상투와 조끼', () => {
    const outer = (look: number) => shownKeys(look).filter((k) => k.startsWith('dopo') || k.startsWith('jokki'));
    for (const look of [0, 1, 2, 3]) expect(outer(look)).toHaveLength(1);
    for (const look of [0, 2]) {
      expect(shownKeys(look)).toEqual(expect.arrayContaining(['gat', 'gatkkeun', 'sejodae']));
      expect(outer(look)[0]).toMatch(/^dopo/);
    }
    for (const look of [1, 3]) {
      expect(shownKeys(look)).toContain('sangtu');
      expect(shownKeys(look)).not.toContain('sejodae');
      expect(outer(look)[0]).toMatch(/^jokki/);
    }
    // 같은 겉옷이라도 차림마다 색이 다르다
    expect(outer(0)[0]).not.toBe(outer(2)[0]);
    expect(outer(1)[0]).not.toBe(outer(3)[0]);
  });

  it('남의 캐릭터는 그리기 호출과 삼각형이 적당하다', () => {
    const d = DETAIL_PRESETS.peer;
    // 다른 사람 전체: 머리, 몸통, 발, 팔, 손 다섯 번 + 소품마다 한 번
    expect(5 + accessories.length).toBeLessThanOrEqual(15);
    const g = getAvatarGeometries(d, JUMAK_OUTFIT);
    for (const look of [0, 1, 2, 3]) {
      let total = triangles(g.body) + triangles(g.head) + 2 * (triangles(g.arm) + triangles(g.foot) + triangles(g.hand));
      for (const acc of accessories) if (accessoryShown(acc, look)) total += triangles(getAccessoryGeometry(acc, d));
      expect(total).toBeLessThan(4500);
    }
  });
});
