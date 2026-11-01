// 봉은사 마당의 배치(미터). 화면 없이 시험할 수 있는 값과 계산만 둔다. 그리는 것은 build.ts.
// 방향: -z가 북쪽(대웅전), +z가 남쪽(진여문과 큰길), +x가 동쪽(범종각, 선불당), -x가 서쪽(미륵대불, 지장전).
// 실제 절보다 거리를 줄였다. 진여문 → 법왕루 → 앞마당(삼층석탑, 연등) → 대웅전 → 판전 순서로 북쪽으로 오른다.
import { bongeunsa as shared } from '@shared/spaces/bongeunsa';
import type { SeatDef, WalkRect } from '../../engine/types';

const rect = (minX: number, maxX: number, minZ: number, maxZ: number): WalkRect => ({ minX, maxX, minZ, maxZ });

/** 담장 안쪽 반 너비와 남북 끝 */
export const WALL = { halfX: 34, north: -46, south: 40 } as const;

/** 걸을 수 있는 곳: 담장 안과, 진여문 밖 큰길 앞 보도 */
export const WALK_BOUNDS: WalkRect = rect(-33.4, 33.4, -45.4, 47);

/** 진여문 밖 보도에서 절 쪽(북)을 보고 선다 */
export const SPAWN = { x: 0, z: 45, yaw: Math.PI } as const;

// ---- 건물 ----
/** 한옥 건물 하나. ry는 정면이 +z(남)에서 돌아간 각. w는 정면 너비, d는 옆 깊이 */
export interface HallSpec {
  id: string;
  x: number;
  z: number;
  ry: number;
  w: number;
  d: number;
  /** 기단 높이 */
  base: number;
  /** 기둥 높이 */
  col: number;
  /** 정면 칸 수 */
  bays: number;
  /** 지붕 높이(처마에서 용마루까지) */
  roofH: number;
  /** 처마가 기둥 밖으로 나온 길이 */
  eave: number;
  /** 현판 글 */
  sign: string;
}

export const DAEUNGJEON: HallSpec = { id: 'daeungjeon', x: 0, z: -22, ry: 0, w: 18, d: 10, base: 1.1, col: 4, bays: 5, roofH: 4.2, eave: 2, sign: '大雄殿' };
export const PANJEON: HallSpec = { id: 'panjeon', x: 0, z: -39, ry: 0, w: 12, d: 6, base: 0.6, col: 3.2, bays: 5, roofH: 3, eave: 1.4, sign: '板殿' };
export const SEONBULDANG: HallSpec = { id: 'seonbuldang', x: 17, z: -5, ry: -Math.PI / 2, w: 10, d: 6, base: 0.5, col: 3, bays: 4, roofH: 2.8, eave: 1.3, sign: '選佛堂' };
export const JIJANGJEON: HallSpec = { id: 'jijangjeon', x: -17, z: -2, ry: Math.PI / 2, w: 10, d: 6, base: 0.5, col: 3, bays: 3, roofH: 2.8, eave: 1.3, sign: '地藏殿' };

/** 진여문: 담장에 난 정문. 가운데 칸으로 드나든다 */
export const GATE = { z: 40, w: 12, d: 4, col: 3.4, roofH: 2.6, eave: 1.3, passage: 4 } as const;

/** 법왕루: 앞마당 들머리의 누각. 아래층 기둥 사이로 지나간다 */
export const PAVILION = { z: 10, w: 16, d: 6, lower: 3.6, upper: 2.6, roofH: 3.2, eave: 1.6, bays: 5 } as const;

/** 범종각: 큰 종이 걸린 정자 */
export const BELL_PAVILION = { x: 14, z: 22, size: 5, col: 3.4, roofH: 2.6, eave: 1.2 } as const;

/** 삼층석탑과 석등 둘 */
export const PAGODA = { x: 0, z: -4 } as const;
export const STONE_LANTERNS: ReadonlyArray<{ x: number; z: number }> = [
  { x: -8.5, z: -13 },
  { x: 8.5, z: -13 },
];

/** 미륵대불: 서쪽 마당의 큰 돌부처. 남쪽을 본다 */
export const BUDDHA = { x: -25, z: -20, platform: 9, platformH: 1.4, height: 13 } as const;

/** 연등 줄: 앞마당을 가로지르는 줄(z)마다 x 범위와 높이 */
export const LANTERN_ROWS: ReadonlyArray<{ z: number; x0: number; x1: number; y: number }> = [
  { z: 4.5, x0: -12.5, x1: 12.5, y: 5.5 },
  { z: 1.5, x0: -12.5, x1: 12.5, y: 5.5 },
  { z: -1.5, x0: -12.5, x1: 12.5, y: 5.5 },
  { z: -7, x0: -12.5, x1: 12.5, y: 5.5 },
  { z: -10, x0: -12.5, x1: 12.5, y: 5.5 },
  { z: -13, x0: -12.5, x1: 12.5, y: 5.8 },
  // 진여문에서 법왕루로 오는 길 위
  { z: 30, x0: -5, x1: 5, y: 5.7 },
  { z: 24, x0: -5, x1: 5, y: 5.7 },
  { z: 18, x0: -5, x1: 5, y: 5.7 },
];
/** 연등 사이 간격 */
export const LANTERN_SPACING = 0.72;

// ---- 자리 ----
/** 방석과 나무 의자. 자리 id는 shared/spaces/bongeunsa.ts가 원본이다 */
export type SeatKind = 'cushion' | 'bench';

export interface SeatPlace extends Omit<SeatDef, 'id'> {
  kind: SeatKind;
}

function seatLayout(): Record<string, SeatPlace> {
  const out: Record<string, SeatPlace> = {};
  // 대웅전 앞 방석: 두 줄 여섯씩, 대웅전(북)을 본다
  const xs = [-6.25, -3.75, -1.25, 1.25, 3.75, 6.25];
  xs.forEach((x, i) => {
    out[`d${i + 1}`] = { x, z: -11.6, y: 0.1, facing: Math.PI, kind: 'cushion', visual: 'none' };
    out[`d${i + 7}`] = { x, z: -9.4, y: 0.1, facing: Math.PI, kind: 'cushion', visual: 'none' };
  });
  // 미륵대불 앞 방석: 부처를 둘러싼 부채꼴
  for (let i = 0; i < 8; i++) {
    const th = (-50 + (100 * i) / 7) * (Math.PI / 180);
    const r = 7.8;
    out[`m${i + 1}`] = {
      x: BUDDHA.x + r * Math.sin(th),
      z: BUDDHA.z + r * Math.cos(th),
      y: 0.1,
      facing: th + Math.PI,
      kind: 'cushion',
      visual: 'none',
    };
  }
  // 범종각 동쪽 나무 의자 둘(셋씩 앉는다). 범종각(서)을 본다
  const benchZ = [18.8, 19.6, 20.4, 23.6, 24.4, 25.2];
  benchZ.forEach((z, i) => {
    out[`b${i + 1}`] = { x: 20.2, z, y: 0.46, facing: -Math.PI / 2, kind: 'bench', visual: 'none' };
  });
  return out;
}

export const SEAT_PLACES: Readonly<Record<string, SeatPlace>> = seatLayout();

export function buildSeats(): SeatDef[] {
  return shared.seatIds.map((id) => {
    const p = SEAT_PLACES[id];
    if (!p) throw new Error(`bongeunsa: 자리 ${id}의 3D 배치가 없어요`);
    const { kind: _kind, ...seat } = p;
    return { id, ...seat };
  });
}

// ---- 나무 ----
export interface TreeSpot {
  x: number;
  z: number;
  kind: 'pine' | 'ginkgo';
  scale: number;
}

export const TREES: readonly TreeSpot[] = [
  // 진여문 안쪽의 은행나무 (11월이라 노랗다)
  { x: -9, z: 33, kind: 'ginkgo', scale: 1.15 },
  { x: 9, z: 33, kind: 'ginkgo', scale: 1.05 },
  { x: -10, z: 22, kind: 'ginkgo', scale: 0.95 },
  { x: 24, z: 30, kind: 'ginkgo', scale: 1 },
  { x: -22, z: -38, kind: 'ginkgo', scale: 1.1 },
  { x: 22, z: -36, kind: 'ginkgo', scale: 1 },
  // 담장을 따라 선 소나무
  { x: -30, z: 34, kind: 'pine', scale: 1.1 },
  { x: -26, z: 28, kind: 'pine', scale: 0.9 },
  { x: -30.5, z: 20, kind: 'pine', scale: 1.2 },
  { x: -24, z: 14, kind: 'pine', scale: 1 },
  { x: -31, z: 6, kind: 'pine', scale: 1.1 },
  { x: -31, z: -6, kind: 'pine', scale: 0.95 },
  { x: -31, z: -30, kind: 'pine', scale: 1.2 },
  { x: -27, z: -42, kind: 'pine', scale: 1 },
  { x: -14, z: -43, kind: 'pine', scale: 1.15 },
  { x: 12, z: -43, kind: 'pine', scale: 1.05 },
  { x: 28, z: -42, kind: 'pine', scale: 1.2 },
  { x: 31, z: -28, kind: 'pine', scale: 1 },
  { x: 30.5, z: -16, kind: 'pine', scale: 1.1 },
  { x: 31, z: 4, kind: 'pine', scale: 0.95 },
  { x: 28, z: 12, kind: 'pine', scale: 1.15 },
  { x: 30.5, z: 36, kind: 'pine', scale: 1 },
  { x: -18, z: 36, kind: 'pine', scale: 0.9 },
  { x: 18, z: 36, kind: 'pine', scale: 0.95 },
  { x: -12, z: -30, kind: 'pine', scale: 0.9 },
  { x: 13, z: -30, kind: 'pine', scale: 0.85 },
];

// ---- 걸을 수 없는 곳 ----
/** 건물(정면 w, 옆 d, 기단 여유 m)이 차지하는 땅. 90도 돌린 건물은 너비와 깊이가 바뀐다 */
export function hallFootprint(h: HallSpec, margin = 0.6): WalkRect {
  const turned = Math.abs(Math.sin(h.ry)) > 0.5;
  const hx = (turned ? h.d : h.w) / 2 + margin;
  const hz = (turned ? h.w : h.d) / 2 + margin;
  return rect(h.x - hx, h.x + hx, h.z - hz, h.z + hz);
}

/** 대웅전 기단: 앞 툇마루(월대)만 계단으로 올라선다 */
export const DAEUNGJEON_BASE = rect(-10.5, 10.5, -28.5, -15.5);
export const DAEUNGJEON_STEPS = rect(-2.5, 2.5, -15.5, -14);
const PORCH_FRONT_Z = -17.3;

function pavilionColumns(): WalkRect[] {
  const out: WalkRect[] = [];
  const hw = PAVILION.w / 2;
  for (let i = 0; i <= PAVILION.bays; i++) {
    const x = -hw + (PAVILION.w * i) / PAVILION.bays;
    for (const z of [PAVILION.z - PAVILION.d / 2, PAVILION.z, PAVILION.z + PAVILION.d / 2]) {
      out.push(rect(x - 0.3, x + 0.3, z - 0.3, z + 0.3));
    }
  }
  return out;
}

function treeTrunks(): WalkRect[] {
  return TREES.map((t) => {
    const r = 0.35 * t.scale;
    return rect(t.x - r, t.x + r, t.z - r, t.z + r);
  });
}

export const WALK_BLOCKERS: readonly WalkRect[] = [
  // 남쪽 담장(진여문 가운데 칸만 뚫려 있다)과 진여문 양옆 칸
  rect(-34, -GATE.passage / 2, GATE.z - 0.5, GATE.z + 0.5),
  rect(GATE.passage / 2, 34, GATE.z - 0.5, GATE.z + 0.5),
  rect(-GATE.w / 2, -GATE.passage / 2, GATE.z - GATE.d / 2 + 0.3, GATE.z + GATE.d / 2 - 0.3),
  rect(GATE.passage / 2, GATE.w / 2, GATE.z - GATE.d / 2 + 0.3, GATE.z + GATE.d / 2 - 0.3),
  // 대웅전: 건물과 기단 옆, 툇마루 앞 턱(계단 자리만 열려 있다)
  rect(-10.5, 10.5, -28.5, PORCH_FRONT_Z),
  rect(-10.5, -9, PORCH_FRONT_Z, -15.5),
  rect(9, 10.5, PORCH_FRONT_Z, -15.5),
  rect(-9, DAEUNGJEON_STEPS.minX, -15.7, -15.3),
  rect(DAEUNGJEON_STEPS.maxX, 9, -15.7, -15.3),
  hallFootprint(PANJEON),
  hallFootprint(SEONBULDANG),
  hallFootprint(JIJANGJEON),
  // 법왕루 기둥들
  ...pavilionColumns(),
  // 범종각
  rect(BELL_PAVILION.x - BELL_PAVILION.size / 2, BELL_PAVILION.x + BELL_PAVILION.size / 2, BELL_PAVILION.z - BELL_PAVILION.size / 2, BELL_PAVILION.z + BELL_PAVILION.size / 2),
  // 삼층석탑, 석등
  rect(PAGODA.x - 1.3, PAGODA.x + 1.3, PAGODA.z - 1.3, PAGODA.z + 1.3),
  ...STONE_LANTERNS.map((l) => rect(l.x - 0.45, l.x + 0.45, l.z - 0.45, l.z + 0.45)),
  // 미륵대불 기단
  rect(BUDDHA.x - BUDDHA.platform / 2, BUDDHA.x + BUDDHA.platform / 2, BUDDHA.z - BUDDHA.platform / 2, BUDDHA.z + BUDDHA.platform / 2),
  // 나무 의자 등받이 쪽
  rect(20.55, 20.95, 18.3, 20.9),
  rect(20.55, 20.95, 23.1, 25.7),
  ...treeTrunks(),
];

/** 걷는 바닥 높이: 대웅전 툇마루와 계단, 진여문 문지방 돌 */
export function groundHeight(x: number, z: number): number {
  const s = DAEUNGJEON_STEPS;
  if (x >= s.minX && x <= s.maxX && z > s.minZ && z < s.maxZ) {
    return DAEUNGJEON.base * ((s.maxZ - z) / (s.maxZ - s.minZ));
  }
  const b = DAEUNGJEON_BASE;
  if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return DAEUNGJEON.base;
  if (Math.abs(x) <= GATE.passage / 2 && Math.abs(z - GATE.z) <= GATE.d / 2 + 0.4) return 0.25;
  return 0;
}

export function inside(r: WalkRect, x: number, z: number): boolean {
  return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
}

// ---- 카메라가 뚫고 들어가면 안 되는 상자 ----
type Box = { min: [number, number, number]; max: [number, number, number] };

function hallBox(h: HallSpec): Box {
  const turned = Math.abs(Math.sin(h.ry)) > 0.5;
  const hx = (turned ? h.d : h.w) / 2 + h.eave;
  const hz = (turned ? h.w : h.d) / 2 + h.eave;
  const top = h.base + 0.18 + h.col + Math.min(0.9, h.col * 0.22) + 0.26 + h.roofH + 0.5;
  return { min: [h.x - hx, 0, h.z - hz], max: [h.x + hx, top, h.z + hz] };
}

export function cameraObstacles(): Box[] {
  const P = PAVILION;
  const pavFloor = 0.3 + P.lower;
  const B = BELL_PAVILION;
  const W = WALL;
  return [
    hallBox(DAEUNGJEON),
    hallBox(PANJEON),
    hallBox(SEONBULDANG),
    hallBox(JIJANGJEON),
    // 진여문: 가운데 통로 위 지붕까지 한 덩어리 (통로를 지날 땐 초점이 상자 안이라 무시된다)
    {
      min: [-GATE.w / 2 - GATE.eave, 0, GATE.z - GATE.d / 2 - GATE.eave],
      max: [GATE.w / 2 + GATE.eave, 0.25 + 0.18 + GATE.col + 0.75 + 0.26 + GATE.roofH + 0.5, GATE.z + GATE.d / 2 + GATE.eave],
    },
    // 법왕루 위층과 지붕 (아래층 기둥 사이는 비워 둔다)
    {
      min: [-P.w / 2 - P.eave, pavFloor - 0.1, P.z - P.d / 2 - P.eave],
      max: [P.w / 2 + P.eave, pavFloor + 0.32 + P.upper + 0.96 + P.roofH + 0.5, P.z + P.d / 2 + P.eave],
    },
    // 범종각 지붕
    {
      min: [B.x - B.size / 2 - B.eave, 0.53 + B.col - 0.4, B.z - B.size / 2 - B.eave],
      max: [B.x + B.size / 2 + B.eave, 0.53 + B.col + 0.86 + B.roofH + 1, B.z + B.size / 2 + B.eave],
    },
    // 미륵대불과 기단, 삼층석탑
    { min: [BUDDHA.x - BUDDHA.platform / 2, 0, BUDDHA.z - BUDDHA.platform / 2], max: [BUDDHA.x + BUDDHA.platform / 2, BUDDHA.platformH, BUDDHA.z + BUDDHA.platform / 2] },
    { min: [BUDDHA.x - 2.2, 0, BUDDHA.z - 2.2], max: [BUDDHA.x + 2.2, BUDDHA.platformH + 1.05 + BUDDHA.height + 1, BUDDHA.z + 2.2] },
    { min: [PAGODA.x - 1.3, 0, PAGODA.z - 1.3], max: [PAGODA.x + 1.3, 6.4, PAGODA.z + 1.3] },
    // 담장 네 면
    { min: [-W.halfX - 0.5, 0, W.south - 0.5], max: [-GATE.w / 2, 2.3, W.south + 0.5] },
    { min: [GATE.w / 2, 0, W.south - 0.5], max: [W.halfX + 0.5, 2.3, W.south + 0.5] },
    { min: [-W.halfX - 0.5, 0, W.north - 0.5], max: [W.halfX + 0.5, 2.3, W.north + 0.5] },
    { min: [-W.halfX - 0.5, 0, W.north], max: [-W.halfX + 0.5, 2.3, W.south] },
    { min: [W.halfX - 0.5, 0, W.north], max: [W.halfX + 0.5, 2.3, W.south] },
  ];
}
