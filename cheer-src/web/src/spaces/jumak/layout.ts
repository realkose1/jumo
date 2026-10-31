// 주막의 배치 숫자. three.js를 모르는 순수한 계산이라 시험하기 쉽다.
// 좌표는 미터, 바닥이 y=0. 앞(TV가 있는 벽)이 -z, 들어오는 쪽이 +z, 왼쪽이 -x.
// 평상 넷(a~d)에 방석 여섯씩. 자리 id는 shared/spaces/jumak.ts가 원본이다.
import { jumak as shared } from '@shared/spaces/jumak';
import type { SeatDef, WalkRect } from '../../engine/types';

/** 동작 id와 이모지. 버튼 그림과 머리 위로 뜨는 이모지가 같은 것이다 */
export const ACTION_EMOJI: Readonly<Record<string, string>> = {
  clap: '👏',
  toast: '🍻',
  order: '🍲',
};

export const ACTION_LABEL: Readonly<Record<string, string>> = {
  clap: '박수',
  toast: '건배',
  order: '주문',
};

// ---- 방 ----
export const ROOM = {
  /** 앞벽(TV가 걸린 벽)과 뒷벽의 z */
  frontZ: -6.3,
  backZ: 9.5,
  /** 마루 가장자리(기둥이 서는 선)의 x. 옆은 트여 있다 */
  halfWidth: 7.5,
  /** 처마 끝까지의 반 폭 */
  eaveHalfWidth: 9.6,
  /** 마루 아래 마당이 내려앉은 깊이 */
  yardDrop: 0.5,
  /** 천장(지붕 안쪽)의 높이: 용마루, 기둥 위, 처마 끝 */
  ridgeY: 6.4,
  postTopY: 4.5,
  eaveY: 3.9,
} as const;

// ---- 평상과 방석 ----
export const PLATFORM_W = 3.7;
export const PLATFORM_D = 3.0;
export const PLATFORM_H = 0.3;
export const CUSHION_H = 0.09;
/** 방석 윗면 높이 = 앉는 면 */
export const SEAT_Y = PLATFORM_H + CUSHION_H;

export interface PlatformDef {
  id: string;
  /** 평상 가운데 */
  cx: number;
  cz: number;
  /** 위에서 봤을 때의 돌림(라디안). 바깥 평상이 TV 쪽으로 살짝 모인다 */
  rot: number;
}

export const PLATFORMS: readonly PlatformDef[] = [
  { id: 'a', cx: -3.2, cz: -2.5, rot: -0.42 },
  { id: 'b', cx: 3.2, cz: -2.5, rot: 0.42 },
  { id: 'c', cx: -3.5, cz: 2.4, rot: -0.3 },
  { id: 'd', cx: 3.5, cz: 2.4, rot: 0.3 },
];

/** 평상 안의 방석 자리 (평상 기준 좌표). 1~3은 TV에 가까운 앞줄, 4~6은 뒷줄 */
export const SEAT_COLS: readonly number[] = [-1.1, 0, 1.1];
export const SEAT_ROWS: readonly number[] = [-0.75, 0.75];
/** 소반이 놓이는 곳 (평상 기준). 두 줄 사이 가운데 */
export const TABLE_LOCAL = { x: 0, z: 0, w: 0.9, d: 0.4 } as const;

/** 평상 기준 좌표를 방 좌표로 */
export function platformToWorld(p: PlatformDef, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  return { x: p.cx + lx * c + lz * s, z: p.cz - lx * s + lz * c };
}

/** 방 좌표를 평상 기준 좌표로 */
export function worldToPlatform(p: PlatformDef, x: number, z: number): { x: number; z: number } {
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  const dx = x - p.cx;
  const dz = z - p.cz;
  return { x: c * dx - s * dz, z: s * dx + c * dz };
}

/** (x, z)에서 서 있는 바닥 높이: 평상 위면 평상 높이, 아니면 0 */
export function groundHeight(x: number, z: number): number {
  const margin = 0.04;
  for (const p of PLATFORMS) {
    const l = worldToPlatform(p, x, z);
    if (Math.abs(l.x) <= PLATFORM_W / 2 - margin && Math.abs(l.z) <= PLATFORM_D / 2 - margin) return PLATFORM_H;
  }
  return 0;
}

/** 자리 id의 번호(1~6)에서 평상 안의 줄과 칸 */
export function seatSlot(index: number): { row: number; col: number } {
  return { row: index <= 3 ? 0 : 1, col: (index - 1) % 3 };
}

/** 평상 기준 (lx, lz)에 앉은 사람이 TV 한가운데를 바라보는 방향(yaw) */
export function seatFacing(p: PlatformDef, lx: number, lz: number): number {
  const at = platformToWorld(p, lx, lz);
  return Math.atan2(TV.x - at.x, TV.z - at.z);
}

export function buildSeats(): SeatDef[] {
  const seats: SeatDef[] = [];
  for (const id of shared.seatIds) {
    const platform = PLATFORMS.find((p) => p.id === id[0]);
    const index = Number(id.slice(1));
    if (!platform || !Number.isInteger(index) || index < 1 || index > 6) {
      throw new Error(`jumak: 자리 ${id}의 3D 배치가 없어요`);
    }
    const { row, col } = seatSlot(index);
    const lx = SEAT_COLS[col]!;
    const lz = SEAT_ROWS[row]!;
    const at = platformToWorld(platform, lx, lz);
    const seat: SeatDef = {
      id,
      x: at.x,
      z: at.z,
      y: SEAT_Y,
      // 모두 TV 한가운데를 바라본다 (바깥 평상은 TV가 옆으로 비껴 있어서 몸을 틀어 앉는다)
      facing: seatFacing(platform, lx, lz),
      visual: 'none', // 방석은 장면이 직접 그린다
    };
    if (row === 1) {
      // 뒷줄은 소반 바로 앞까지 걸어가서 앉는다 (앞줄 사람 위로 가로지르지 않게)
      seat.approach = platformToWorld(platform, lx, 0.3);
    }
    seats.push(seat);
  }
  return seats;
}

// ---- TV ----
export const TV = {
  x: 0,
  /** 화면 가운데 높이 */
  y: 2.0,
  /** 화면 앞면의 z */
  z: ROOM.frontZ + 0.2,
  w: 4.0,
  h: 2.25,
} as const;

// ---- 주모와 부뚜막 (TV 왼쪽 벽 가까이. TV를 가리지 않는 곳) ----
export const JUMO = {
  /** 주모가 서 있는 곳과 바라보는 방향(yaw): 방 한가운데를 본다 */
  x: -5.0,
  z: -5.05,
  yaw: 0.62,
  /** 부뚜막(아궁이와 가마솥) 가운데 */
  stoveX: -5.55,
  stoveZ: -5.8,
} as const;

/** 주모와 부뚜막 둘레: 사람이 들어가 겹치지 않게 막는다 */
export const WALK_BLOCKERS: WalkRect[] = [{ minX: -6.5, maxX: -4.35, minZ: -5.9, maxZ: -4.7 }];

// ---- 주문한 음식이 놓일 곳 ----
export interface DishSpot {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/**
 * 주문한 사람 곁에 음식이 놓일 곳. 방석에 앉아 있으면 그 방석 오른쪽 평상 위(자리마다 다른 틈이라 겹치지 않는다),
 * 서 있으면 바라보는 쪽 조금 앞.
 */
export function dishSpot(spot: { x: number; z: number; yaw: number; seatId: string | null }): DishSpot {
  const platform = spot.seatId ? PLATFORMS.find((p) => p.id === spot.seatId![0]) : undefined;
  const index = spot.seatId ? Number(spot.seatId.slice(1)) : NaN;
  if (platform && Number.isInteger(index) && index >= 1 && index <= 6) {
    const { row, col } = seatSlot(index);
    // 앉은 사람의 오른쪽 틈(평상 기준 +x)에, TV 쪽으로 조금
    const at = platformToWorld(platform, SEAT_COLS[col]! + 0.56, SEAT_ROWS[row]! - 0.1);
    return { x: at.x, y: PLATFORM_H, z: at.z, yaw: seatFacing(platform, SEAT_COLS[col]!, SEAT_ROWS[row]!) };
  }
  const x = spot.x + Math.sin(spot.yaw) * 0.55;
  const z = spot.z + Math.cos(spot.yaw) * 0.55;
  return { x, y: groundHeight(x, z), z, yaw: spot.yaw };
}

// ---- 걷기 ----
export const WALK_BOUNDS: WalkRect = { minX: -6.9, maxX: 6.9, minZ: -4.9, maxZ: 8.8 };

/** 처음 서는 곳: 앞줄 평상 사이 통로. TV를 바라본다 */
export const SPAWN = { x: 0, z: 0.4, yaw: Math.PI };

/** 처음 들어와서 자동으로 앉을 때 보는 자리 순서: TV 한가운데에 가까운 자리부터 */
export function seatPreferenceOrder(seats: readonly SeatDef[], random: () => number = Math.random): string[] {
  const target = { x: 0, z: TV.z };
  return seats
    .map((s) => ({ id: s.id, d: Math.hypot(s.x - target.x, (s.z - target.z) * 0.8) + random() * 0.15 }))
    .sort((a, b) => a.d - b.d)
    .map((s) => s.id);
}
