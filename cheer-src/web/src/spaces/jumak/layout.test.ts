import { describe, expect, it } from 'vitest';
import { jumak as shared } from '@shared/spaces/jumak';
import {
  PLATFORMS,
  PLATFORM_D,
  PLATFORM_H,
  PLATFORM_W,
  SEAT_Y,
  SPAWN,
  TV,
  WALK_BOUNDS,
  SEAT_COLS,
  SEAT_ROWS,
  TABLE_LOCAL,
  buildSeats,
  dishSpot,
  groundHeight,
  platformToWorld,
  seatPreferenceOrder,
  worldToPlatform,
} from './layout';

describe('주막 자리 배치', () => {
  const seats = buildSeats();

  it('자리 24개, id가 서버와 같다', () => {
    expect(seats.map((s) => s.id).sort()).toEqual([...shared.seatIds].sort());
    expect(seats).toHaveLength(24);
  });

  it('모든 방석이 자기 평상 위에 있고 앉는 면 높이가 방석 윗면이다', () => {
    for (const s of seats) {
      const platform = PLATFORMS.find((p) => p.id === s.id[0])!;
      const local = worldToPlatform(platform, s.x, s.z);
      expect(Math.abs(local.x)).toBeLessThan(PLATFORM_W / 2 - 0.3);
      expect(Math.abs(local.z)).toBeLessThan(PLATFORM_D / 2 - 0.3);
      expect(s.y).toBeCloseTo(SEAT_Y);
      expect(s.visual).toBe('none');
    }
  });

  it('방석끼리 겹치지 않는다', () => {
    for (let i = 0; i < seats.length; i++) {
      for (let j = i + 1; j < seats.length; j++) {
        expect(Math.hypot(seats[i]!.x - seats[j]!.x, seats[i]!.z - seats[j]!.z)).toBeGreaterThan(0.9);
      }
    }
  });

  it('모두 TV 쪽을 바라본다', () => {
    for (const s of seats) {
      const toTv = { x: TV.x - s.x, z: TV.z - s.z };
      const look = { x: Math.sin(s.facing), z: Math.cos(s.facing) };
      const dot = (toTv.x * look.x + toTv.z * look.z) / Math.hypot(toTv.x, toTv.z);
      expect(dot).toBeGreaterThan(0.95);
    }
  });

  it('걷는 영역 안에 있고, 뒷줄 접근 지점도 평상 위다', () => {
    for (const s of seats) {
      expect(s.x).toBeGreaterThan(WALK_BOUNDS.minX);
      expect(s.x).toBeLessThan(WALK_BOUNDS.maxX);
      expect(s.z).toBeGreaterThan(WALK_BOUNDS.minZ);
      expect(s.z).toBeLessThan(WALK_BOUNDS.maxZ);
      if (s.approach) expect(groundHeight(s.approach.x, s.approach.z)).toBe(PLATFORM_H);
    }
  });

  it('처음 서는 곳은 통로(바닥)이고 걷는 영역 안이다', () => {
    expect(groundHeight(SPAWN.x, SPAWN.z)).toBe(0);
    expect(SPAWN.x).toBeGreaterThan(WALK_BOUNDS.minX);
    expect(SPAWN.z).toBeLessThan(WALK_BOUNDS.maxZ);
  });
});

describe('평상 좌표 변환', () => {
  it('왕복하면 제자리', () => {
    for (const p of PLATFORMS) {
      const w = platformToWorld(p, 0.7, -0.4);
      const l = worldToPlatform(p, w.x, w.z);
      expect(l.x).toBeCloseTo(0.7);
      expect(l.z).toBeCloseTo(-0.4);
    }
  });
});

describe('groundHeight', () => {
  it('평상 위는 평상 높이, 통로와 마루는 0', () => {
    for (const p of PLATFORMS) expect(groundHeight(p.cx, p.cz)).toBe(PLATFORM_H);
    expect(groundHeight(0, -2.4)).toBe(0);
    expect(groundHeight(0, 6)).toBe(0);
    expect(groundHeight(-6, 6)).toBe(0);
  });
});

describe('seatPreferenceOrder', () => {
  const seats = buildSeats();

  it('TV 한가운데에 가까운 앞줄 안쪽 자리가 먼저다', () => {
    const order = seatPreferenceOrder(seats, () => 0);
    expect(order).toHaveLength(24);
    expect(new Set(order).size).toBe(24);
    expect(['a3', 'b1']).toContain(order[0]);
    // 앞줄 평상(a, b)의 앞줄 자리가 뒷줄 평상(c, d)의 자리보다 먼저다
    const rank = (id: string): number => order.indexOf(id);
    expect(rank('a3')).toBeLessThan(rank('c3'));
    expect(rank('b1')).toBeLessThan(rank('d1'));
  });

  it('같은 거리여도 난수로 흩어서 모두가 같은 자리로 몰리지 않는다', () => {
    const firsts = new Set<string>();
    let r = 0;
    for (let i = 0; i < 30; i++) {
      firsts.add(seatPreferenceOrder(seats, () => (r = (r + 0.37) % 1))[0]!);
    }
    expect(firsts.size).toBeGreaterThan(1);
  });
});

describe('dishSpot (주문한 음식이 놓일 곳)', () => {
  const seats = buildSeats();
  const spots = seats.map((seat) => ({ seat, spot: dishSpot({ x: seat.x, z: seat.z, yaw: seat.facing, seatId: seat.id }) }));

  it('앉은 사람마다 자기 평상 위, 방석 곁에 놓인다', () => {
    for (const { seat, spot } of spots) {
      expect(spot.y).toBeCloseTo(PLATFORM_H);
      expect(groundHeight(spot.x, spot.z)).toBe(PLATFORM_H);
      const d = Math.hypot(spot.x - seat.x, spot.z - seat.z);
      expect(d).toBeGreaterThan(0.45);
      expect(d).toBeLessThan(0.8);
    }
  });

  it('24자리의 음식 자리가 서로 겹치지 않고, 다른 사람 방석 위에도 놓이지 않는다', () => {
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        expect(Math.hypot(spots[i]!.spot.x - spots[j]!.spot.x, spots[i]!.spot.z - spots[j]!.spot.z)).toBeGreaterThan(0.45);
      }
      for (const other of seats) {
        expect(Math.hypot(spots[i]!.spot.x - other.x, spots[i]!.spot.z - other.z)).toBeGreaterThan(0.38);
      }
    }
  });

  it('소반(탁자) 아래에 파묻히지 않는다', () => {
    for (const platform of PLATFORMS) {
      const rows = SEAT_ROWS.length * SEAT_COLS.length;
      expect(rows).toBe(6);
      void platform;
    }
    for (const { seat, spot } of spots) {
      const platform = PLATFORMS.find((p) => p.id === seat.id[0])!;
      const local = worldToPlatform(platform, spot.x, spot.z);
      const underTable = Math.abs(local.x - TABLE_LOCAL.x) < TABLE_LOCAL.w / 2 + 0.1 && Math.abs(local.z - TABLE_LOCAL.z) < TABLE_LOCAL.d / 2 + 0.1;
      expect(underTable).toBe(false);
    }
  });

  it('서 있는 사람은 바라보는 쪽 앞에, 바닥 높이로', () => {
    const spot = dishSpot({ x: 0, z: 5, yaw: Math.PI, seatId: null });
    expect(spot.x).toBeCloseTo(0, 5);
    expect(spot.z).toBeCloseTo(5 - 0.55, 5);
    expect(spot.y).toBe(0);
  });
});
