import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SeatManager } from './seats';

describe('방석 마커', () => {
  const seats = [
    { id: 'a', x: 1, z: 2, facing: 0, visual: 'none' as const, y: 0.6 },
    { id: 'b', x: -1, z: 2, facing: 0, visual: 'none' as const, y: 0.6 },
  ];

  it('누른 방석 위에 마커를 띄우고, 거두면 잠깐 뒤 사라진다', () => {
    const scene = new THREE.Scene();
    const m = new SeatManager(scene, seats);
    expect(m.markedSeatId).toBeNull();
    m.markSeat(m.get('a')!);
    expect(m.markedSeatId).toBe('a');
    const group = scene.children.at(-1)!;
    expect(group.visible).toBe(true);
    expect(group.position.x).toBeCloseTo(1);
    expect(group.position.y).toBeGreaterThan(0.6);
    m.update(0.1);
    // 다른 방석을 누르면 그리로 옮긴다
    m.markSeat(m.get('b')!);
    expect(group.position.x).toBeCloseTo(-1);
    m.markSeat(null);
    expect(m.markedSeatId).toBeNull();
    m.update(0.1);
    expect(group.visible).toBe(true); // 사라지는 중
    m.update(0.3);
    expect(group.visible).toBe(false);
    m.dispose();
    expect(scene.children.includes(group)).toBe(false);
  });
});
