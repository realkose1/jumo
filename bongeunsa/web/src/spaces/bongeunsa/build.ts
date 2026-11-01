// 봉은사의 움직이지 않는 것들을 정점 색 한 덩어리(Batch)로 만든다: 땅과 길, 담장, 진여문, 법왕루, 대웅전, 판전,
// 선불당, 지장전, 범종각(종 빼고), 삼층석탑, 석등, 미륵대불, 나무, 방석과 의자.
// 현판(글씨)과 종, 연등, 빌딩은 따로 만든다(scene.ts).
import * as THREE from 'three';
import { Batch, groupMatrix } from './batch';
import { roofGeometry, roofSurface } from './roof';
import {
  BELL_PAVILION,
  BUDDHA,
  DAEUNGJEON,
  GATE,
  JIJANGJEON,
  LANTERN_ROWS,
  PAGODA,
  PANJEON,
  PAVILION,
  SEAT_PLACES,
  SEONBULDANG,
  STONE_LANTERNS,
  TREES,
  WALL,
  type HallSpec,
} from './layout';

// ---- 색 ----
const GROUND = 0xcdbd9c;
const GROUND_OUT = 0x8e8f93;
const SIDEWALK = 0xbdb6aa;
const ROAD = 0x55575d;
const LANE = 0xe8e4da;
const PATH = 0xb7b0a4;
const STONE = 0xb3ac9f;
const STONE_LIGHT = 0xcac3b6;
const GRANITE = 0xc9c2b4;
const COLUMN = 0x8f3524;
const PLASTER = 0xebe3d0;
const DOOR = 0x9a6136;
const LATTICE = 0xc99a62;
const RAIL = 0x7c2e20;
const DAN_GREEN = 0x2f7f69;
const DAN_RED = 0xb23a2c;
const DAN_BLUE = 0x2f5d8c;
const DAN_OCHRE = 0xd8a640;
const TILE_CAP = 0x3a3d43;
const MORTAR = 0xe9e3d6;
const WALL_STONE = 0xa99f8f;
const WALL_PLASTER = 0xd8cdb6;
const BARK = 0x5a4232;
const PINE = 0x2f5a3a;
const PINE_DARK = 0x244a30;
const GINKGO = 0xe8b923;
const GINKGO_DEEP = 0xd39b1a;
const CUSHION = 0x8c2f3c;
const CUSHION_EDGE = 0xd0a24a;
const BENCH = 0x8a6040;
const BUDDHA_STONE = 0xd9d3c5;

/** 아래쪽을 살짝 어둡게 (가짜 그늘) */
const groundShade = (y: number): number => 0.82 + 0.18 * Math.min(1, Math.max(0, y / 1.2));

// ---- 땅 ----
function buildGround(b: Batch): void {
  // 담장 밖: 도시의 회색 바닥, 큰길(진여문 앞 남쪽), 보도
  b.plane(600, 600, [0, -0.03, 0], GROUND_OUT, { rx: -Math.PI / 2 });
  b.plane(600, 14, [0, -0.02, 54], ROAD, { rx: -Math.PI / 2 });
  for (let x = -120; x <= 120; x += 6) b.plane(3, 0.18, [x, -0.01, 54], LANE, { rx: -Math.PI / 2 });
  b.plane(600, 7, [0, -0.015, 43.5], SIDEWALK, { rx: -Math.PI / 2 });
  // 담장 안: 마사토 마당 (얼룩을 위해 잘게 나눈다)
  const w = WALL.halfX * 2;
  const d = WALL.south - WALL.north;
  b.plane(w, d, [0, 0, (WALL.south + WALL.north) / 2], GROUND, { rx: -Math.PI / 2, jitter: 0.05 }, [34, 43]);
  // 돌길: 진여문 → 법왕루 → 대웅전 계단, 그리고 동서로 갈리는 길
  const path = (x0: number, x1: number, z0: number, z1: number): void => {
    b.plane(x1 - x0, z1 - z0, [(x0 + x1) / 2, 0.012, (z0 + z1) / 2], PATH, { rx: -Math.PI / 2, jitter: 0.06 }, [
      Math.max(1, Math.round((x1 - x0) / 0.8)),
      Math.max(1, Math.round((z1 - z0) / 0.8)),
    ]);
  };
  path(-1.6, 1.6, -14, 47);
  path(-22, -1.6, 13.6, 15.6);
  path(1.6, 18, 13.6, 15.6);
  // 미륵대불 앞 너른 돌마당
  path(BUDDHA.x - 9, BUDDHA.x + 7, BUDDHA.z + 4.5, BUDDHA.z + 10);
}

// ---- 담장 ----
function wallSegment(b: Batch, x0: number, z0: number, x1: number, z1: number): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const ry = Math.atan2(x1 - x0, z1 - z0);
  const m = groupMatrix((x0 + x1) / 2, (z0 + z1) / 2, ry);
  b.box([0.7, 1.0, len], [0, 0.5, 0], WALL_STONE, { parent: m, jitter: 0.08 });
  b.box([0.6, 1.0, len], [0, 1.5, 0], WALL_PLASTER, { parent: m });
  // 기와 얹은 담장 지붕: 양쪽으로 기운 두 판과 용마루
  b.box([0.62, 0.08, len + 0.2], [0.26, 2.08, 0], TILE_CAP, { parent: m, rz: -0.45 });
  b.box([0.62, 0.08, len + 0.2], [-0.26, 2.08, 0], TILE_CAP, { parent: m, rz: 0.45 });
  b.box([0.16, 0.14, len + 0.2], [0, 2.22, 0], TILE_CAP, { parent: m });
}

function buildWalls(b: Batch): void {
  const { halfX: X, north: N, south: S } = WALL;
  const g = GATE.w / 2;
  wallSegment(b, -X, S, -g, S);
  wallSegment(b, g, S, X, S);
  wallSegment(b, -X, N, X, N);
  wallSegment(b, -X, N, -X, S);
  wallSegment(b, X, N, X, S);
}

// ---- 한옥 부분들 ----
/** 처마 밑 공포 띠(단청): 기둥 머리를 두르는 초록 띠와 붉은·파란 줄, 띠 앞의 공포 덩이들 */
function dancheongBand(b: Batch, m: THREE.Matrix4, w: number, d: number, y: number, h: number, bays: number): void {
  b.box([w + 0.5, 0.12, d + 0.5], [0, y + 0.06, 0], DAN_RED, { parent: m });
  b.box([w + 0.4, h, d + 0.4], [0, y + 0.12 + h / 2, 0], DAN_GREEN, { parent: m });
  b.box([w + 0.46, 0.1, d + 0.46], [0, y + 0.12 + h * 0.55, 0], DAN_BLUE, { parent: m });
  b.box([w + 0.6, 0.14, d + 0.6], [0, y + 0.12 + h + 0.07, 0], DAN_RED, { parent: m });
  // 공포: 앞뒤 면에 칸마다 둘씩
  const n = bays * 2;
  for (let i = 0; i <= n; i++) {
    const x = -w / 2 + (w * i) / n;
    for (const side of [1, -1]) {
      b.box([0.3, h * 0.6, 0.24], [x, y + 0.12 + h * 0.5, side * (d / 2 + 0.3)], i % 2 === 0 ? DAN_OCHRE : DAN_GREEN, { parent: m });
    }
  }
}

/** 용마루와 내림마루: 하얀 회 띠 위에 검은 기와를 얹는다 */
function ridges(b: Batch, m: THREE.Matrix4, W: number, D: number, H: number, y0: number, hip?: number): void {
  const surf = roofSurface({ W, D, H, hip });
  const R = surf.R;
  if (R > 0.2) {
    b.box([R * 2 + 0.5, 0.22, 0.5], [0, y0 + H + 0.02, 0], MORTAR, { parent: m });
    b.box([R * 2 + 0.6, 0.3, 0.38], [0, y0 + H + 0.24, 0], TILE_CAP, { parent: m });
    // 용마루 끝의 치미 대신 둥근 망와
    for (const s of [-1, 1]) b.box([0.28, 0.55, 0.4], [s * (R + 0.35), y0 + H + 0.4, 0], TILE_CAP, { parent: m, rz: s * 0.25 });
  }
  // 네 귀로 내려가는 내림마루
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const steps = 7;
      for (let i = 0; i < steps; i++) {
        const t0 = i / steps;
        const t1 = (i + 1) / steps;
        const ax = sx * (R + (W - R) * t0 * 0.92);
        const az = sz * (D * t0 * 0.92);
        const bx = sx * (R + (W - R) * t1 * 0.92);
        const bz = sz * (D * t1 * 0.92);
        const ay = surf.height(ax, az);
        const by = surf.height(bx, bz);
        const len = Math.hypot(bx - ax, by - ay, bz - az);
        const ry = Math.atan2(bx - ax, bz - az);
        const rx = -Math.atan2(by - ay, Math.hypot(bx - ax, bz - az));
        b.box([0.26, 0.2, len + 0.05], [(ax + bx) / 2, y0 + (ay + by) / 2 + 0.12, (az + bz) / 2], TILE_CAP, { parent: m, ry, rx });
      }
    }
  }
}

interface HallOptions {
  /** 기단이 기둥 밖으로 나온 길이 */
  baseMargin: number;
  /** 앞 계단 너비 (0이면 없음) */
  stepWidth: number;
  /** 문을 달지 않는(트인) 앞뒤 칸 번호 */
  openBays?: number[];
  /** 앞쪽 칸에 문(창호) 대신 회벽 */
  plainFront?: boolean;
  hip?: number;
}

/** 한옥 건물 한 채. 기단, 주춧돌, 기둥, 창호, 회벽, 단청 띠, 지붕, 마루 */
function hall(b: Batch, h: HallSpec, o: HallOptions): void {
  const m = groupMatrix(h.x, h.z, h.ry);
  const { w, d, base, col, bays } = h;
  const bm = o.baseMargin;
  // 기단: 장대석 두 단
  b.box([w + bm * 2, base, d + bm * 2], [0, base / 2, 0], STONE, { parent: m, jitter: 0.05, shade: groundShade });
  b.box([w + bm * 2 + 0.06, 0.08, d + bm * 2 + 0.06], [0, base - 0.04, 0], STONE_LIGHT, { parent: m });
  // 계단
  if (o.stepWidth > 0 && base > 0.2) {
    const n = Math.max(2, Math.round(base / 0.22));
    const tread = 0.36;
    for (let i = 0; i < n; i++) {
      const top = base * (1 - i / n);
      b.box([o.stepWidth, top, tread], [0, top / 2, d / 2 + bm + tread * (i + 0.5)], STONE_LIGHT, { parent: m, jitter: 0.04 });
    }
  }
  const dBays = Math.max(2, Math.round(d / 3));
  const xs = Array.from({ length: bays + 1 }, (_, i) => -w / 2 + (w * i) / bays);
  const zs = Array.from({ length: dBays + 1 }, (_, j) => -d / 2 + (d * j) / dBays);
  const colAt = (x: number, z: number): void => {
    b.box([0.6, 0.18, 0.6], [x, base + 0.09, z], STONE_LIGHT, { parent: m });
    b.cylinder(0.2, 0.23, col, 10, [x, base + 0.18 + col / 2, z], COLUMN, { parent: m });
  };
  for (const x of xs) for (const z of [-d / 2, d / 2]) colAt(x, z);
  for (const z of zs.slice(1, -1)) for (const x of [-w / 2, w / 2]) colAt(x, z);
  const wallH = col - 0.25;
  const wy = base + 0.18 + wallH / 2;
  // 앞뒤 칸: 앞은 창호(문살), 뒤는 회벽
  for (let i = 0; i < bays; i++) {
    const x = (xs[i]! + xs[i + 1]!) / 2;
    const bw = xs[i + 1]! - xs[i]! - 0.4;
    const open = o.openBays?.includes(i) ?? false;
    if (!open) {
      if (o.plainFront) {
        b.box([bw, wallH, 0.14], [x, wy, d / 2 - 0.05], PLASTER, { parent: m });
        b.box([bw, 0.14, 0.18], [x, base + 0.18 + wallH * 0.4, d / 2 - 0.05], RAIL, { parent: m });
      } else {
        b.box([bw, wallH, 0.12], [x, wy, d / 2 - 0.05], DOOR, { parent: m });
        // 문짝 둘씩, 문살 무늬 대신 밝은 판과 가로살
        for (const s of [-1, 1]) {
          b.box([bw / 2 - 0.22, wallH - 0.6, 0.04], [x + s * (bw / 4), wy + 0.1, d / 2 + 0.02], LATTICE, { parent: m });
          for (let k = 1; k <= 3; k++) {
            b.box([bw / 2 - 0.22, 0.05, 0.06], [x + s * (bw / 4), base + 0.48 + ((wallH - 0.6) * k) / 4, d / 2 + 0.04], DOOR, { parent: m });
          }
        }
        b.box([bw, 0.2, 0.16], [x, base + 0.3, d / 2 - 0.03], RAIL, { parent: m });
      }
      b.box([bw, wallH, 0.14], [x, wy, -d / 2 + 0.05], PLASTER, { parent: m });
      b.box([bw, 0.14, 0.18], [x, base + 0.18 + wallH * 0.4, -d / 2 + 0.05], RAIL, { parent: m });
    }
  }
  // 옆 칸: 회벽
  for (let j = 0; j < dBays; j++) {
    const z = (zs[j]! + zs[j + 1]!) / 2;
    const bd = zs[j + 1]! - zs[j]! - 0.4;
    for (const s of [-1, 1]) {
      b.box([0.14, wallH, bd], [s * (w / 2 - 0.05), wy, z], PLASTER, { parent: m });
      b.box([0.18, 0.14, bd], [s * (w / 2 - 0.05), base + 0.18 + wallH * 0.4, z], RAIL, { parent: m });
    }
  }
  const bandY = base + 0.18 + col;
  const bandH = Math.min(0.9, col * 0.22);
  dancheongBand(b, m, w, d, bandY, bandH, bays);
  const roofY = bandY + bandH + 0.26;
  const W = w / 2 + h.eave;
  const D = d / 2 + h.eave;
  b.addColored(roofGeometry({ W, D, H: h.roofH, hip: o.hip }).translate(0, roofY, 0), m);
  ridges(b, m, W, D, h.roofH, roofY, o.hip);
}

/** 현판을 걸 곳 (월드 좌표, 정면 방향). scene.ts가 글씨 판을 붙인다 */
export function signPlacement(h: HallSpec): { pos: THREE.Vector3; ry: number; width: number } {
  const bandY = h.base + 0.18 + h.col;
  const bandH = Math.min(0.9, h.col * 0.22);
  const local = new THREE.Vector3(0, bandY + bandH * 0.5, h.d / 2 + 0.48);
  local.applyMatrix4(groupMatrix(h.x, h.z, h.ry));
  return { pos: local, ry: h.ry, width: Math.min(3, h.w * 0.2) };
}

// ---- 진여문 ----
export const GATE_HALL: HallSpec = { id: 'gate', x: 0, z: GATE.z, ry: 0, w: GATE.w, d: GATE.d, base: 0.25, col: GATE.col, bays: 3, roofH: GATE.roofH, eave: GATE.eave, sign: '眞如門' };

function buildGate(b: Batch): void {
  hall(b, GATE_HALL, { baseMargin: 0.4, stepWidth: 0, openBays: [1], hip: 0.75 });
  // 가운데 통로 양옆의 안벽(사천왕을 모신 칸을 가른다): 붉은 판에 초록 테
  const m = groupMatrix(0, GATE.z, 0);
  for (const s of [-1, 1]) {
    b.box([0.16, GATE.col - 0.3, GATE.d - 0.4], [s * (GATE.passage / 2), 0.25 + 0.18 + (GATE.col - 0.3) / 2, 0], DAN_RED, { parent: m });
    b.box([0.2, 0.3, GATE.d - 0.3], [s * (GATE.passage / 2), 0.25 + GATE.col - 0.25, 0], DAN_GREEN, { parent: m });
  }
}

// ---- 법왕루: 기둥 사이로 지나가는 이층 누각 ----
export const PAVILION_HALL: HallSpec = {
  id: 'beopwangnu',
  x: 0,
  z: PAVILION.z,
  ry: 0,
  w: PAVILION.w,
  d: PAVILION.d,
  base: 0,
  col: PAVILION.lower,
  bays: PAVILION.bays,
  roofH: PAVILION.roofH,
  eave: PAVILION.eave,
  sign: '法王樓',
};

function buildPavilion(b: Batch): { signY: number } {
  const m = groupMatrix(0, PAVILION.z, 0);
  const { w, d, lower, upper, bays } = PAVILION;
  const xs = Array.from({ length: bays + 1 }, (_, i) => -w / 2 + (w * i) / bays);
  // 아래층: 돌 주초 위의 굵은 기둥 세 줄
  for (const x of xs) {
    for (const z of [-d / 2, 0, d / 2]) {
      b.box([0.7, 0.3, 0.7], [x, 0.15, z], STONE_LIGHT, { parent: m });
      b.cylinder(0.24, 0.26, lower, 10, [x, 0.3 + lower / 2, z], COLUMN, { parent: m });
    }
  }
  // 위층 마루와 난간
  const floorY = 0.3 + lower;
  b.box([w + 1, 0.32, d + 1], [0, floorY + 0.16, 0], 0x6e4a30, { parent: m });
  b.box([w + 1.1, 0.14, d + 1.1], [0, floorY + 0.02, 0], DAN_GREEN, { parent: m });
  const railY = floorY + 0.32;
  for (const s of [-1, 1]) {
    b.box([w + 0.9, 0.08, 0.1], [0, railY + 0.75, s * (d / 2 + 0.45)], RAIL, { parent: m });
    b.box([w + 0.9, 0.06, 0.08], [0, railY + 0.25, s * (d / 2 + 0.45)], RAIL, { parent: m });
    b.box([0.1, 0.08, d + 0.9], [s * (w / 2 + 0.45), railY + 0.75, 0], RAIL, { parent: m });
    for (let i = 0; i <= 24; i++) {
      const x = -w / 2 - 0.45 + ((w + 0.9) * i) / 24;
      b.box([0.06, 0.75, 0.06], [x, railY + 0.38, s * (d / 2 + 0.45)], RAIL, { parent: m });
    }
  }
  // 위층 기둥과 창호(사방 문)
  const upY = floorY + 0.32;
  for (const x of xs) for (const z of [-d / 2, d / 2]) b.cylinder(0.18, 0.2, upper, 10, [x, upY + upper / 2, z], COLUMN, { parent: m });
  for (let i = 0; i < bays; i++) {
    const x = (xs[i]! + xs[i + 1]!) / 2;
    const bw = xs[i + 1]! - xs[i]! - 0.36;
    for (const s of [-1, 1]) {
      b.box([bw, upper - 0.3, 0.1], [x, upY + (upper - 0.3) / 2 + 0.1, s * (d / 2 - 0.05)], LATTICE, { parent: m });
      b.box([bw, 0.08, 0.14], [x, upY + upper * 0.5, s * (d / 2 - 0.05)], DOOR, { parent: m });
    }
  }
  for (const s of [-1, 1]) b.box([0.12, upper - 0.3, d - 0.3], [s * (w / 2 - 0.05), upY + (upper - 0.3) / 2 + 0.1, 0], PLASTER, { parent: m });
  const bandY = upY + upper;
  dancheongBand(b, m, w, d, bandY, 0.7, bays);
  const roofY = bandY + 0.96;
  const W = w / 2 + PAVILION.eave;
  const D = d / 2 + PAVILION.eave;
  b.addColored(roofGeometry({ W, D, H: PAVILION.roofH }).translate(0, roofY, 0), m);
  ridges(b, m, W, D, PAVILION.roofH, roofY);
  return { signY: bandY + 0.35 };
}

// ---- 범종각 (종은 scene.ts가 따로 만든다: 칠 때 흔들린다) ----
function buildBellPavilion(b: Batch): { beamY: number } {
  const { x, z, size, col } = BELL_PAVILION;
  const m = groupMatrix(x, z, 0);
  const hs = size / 2;
  b.box([size + 1.2, 0.35, size + 1.2], [0, 0.175, 0], STONE, { parent: m, jitter: 0.05 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box([0.6, 0.18, 0.6], [sx * hs, 0.44, sz * hs], STONE_LIGHT, { parent: m });
      b.cylinder(0.2, 0.22, col, 10, [sx * hs, 0.53 + col / 2, sz * hs], COLUMN, { parent: m });
    }
  }
  const beamY = 0.53 + col;
  // 종을 거는 들보
  b.box([size, 0.3, 0.32], [0, beamY - 0.3, 0], COLUMN, { parent: m });
  dancheongBand(b, m, size, size, beamY, 0.6, 2);
  const roofY = beamY + 0.86;
  const W = hs + BELL_PAVILION.eave;
  b.addColored(roofGeometry({ W, D: W, H: BELL_PAVILION.roofH, hip: 1 }).translate(0, roofY, 0), m);
  ridges(b, m, W, W, BELL_PAVILION.roofH, roofY, 1);
  // 꼭대기 절병통
  b.cylinder(0.12, 0.2, 0.5, 8, [0, roofY + BELL_PAVILION.roofH + 0.25, 0], TILE_CAP, { parent: m });
  b.sphere(0.16, [0, roofY + BELL_PAVILION.roofH + 0.62, 0], TILE_CAP, { parent: m });
  return { beamY: beamY - 0.45 };
}

// ---- 삼층석탑 ----
/** 네모난 돌(위아래 크기가 다른 사각뿔대). 4각 원기둥을 45도 돌려 만든다 */
function squareStone(b: Batch, top: number, bottom: number, h: number, pos: [number, number, number], color: number): void {
  b.cylinder(top * Math.SQRT1_2 * 2, bottom * Math.SQRT1_2 * 2, h, 4, pos, color, { ry: Math.PI / 4, jitter: 0.04 });
}

function buildPagoda(b: Batch): void {
  const { x, z } = PAGODA;
  let y = 0;
  // 기단 두 층
  b.box([2.6, 0.5, 2.6], [x, 0.25, z], GRANITE, { jitter: 0.04 });
  b.box([2.2, 0.7, 2.2], [x, 0.85, z], GRANITE, { jitter: 0.04 });
  b.box([2.3, 0.12, 2.3], [x, 1.26, z], GRANITE);
  b.box([1.8, 0.6, 1.8], [x, 1.62, z], GRANITE, { jitter: 0.04 });
  b.box([1.95, 0.12, 1.95], [x, 1.98, z], GRANITE);
  y = 2.04;
  // 탑신과 옥개석 셋. 위로 갈수록 작아진다
  const stories = [
    { body: 0.62, bodyH: 0.8, roof: 1.05 },
    { body: 0.52, bodyH: 0.5, roof: 0.92 },
    { body: 0.44, bodyH: 0.44, roof: 0.8 },
  ];
  for (const s of stories) {
    b.box([s.body * 2, s.bodyH, s.body * 2], [x, y + s.bodyH / 2, z], GRANITE, { jitter: 0.04 });
    y += s.bodyH;
    // 옥개석: 밑이 층층이 들어간 받침, 위는 낮게 기운 지붕돌
    squareStone(b, s.body * 1.15, s.body * 1.05, 0.08, [x, y + 0.04, z], GRANITE);
    squareStone(b, s.roof * 0.35, s.roof, 0.28, [x, y + 0.22, z], GRANITE);
    y += 0.36;
  }
  // 상륜: 노반, 복발, 보주
  b.box([0.34, 0.16, 0.34], [x, y + 0.08, z], GRANITE);
  b.sphere(0.17, [x, y + 0.28, z], GRANITE, {}, [1, 0.7, 1]);
  b.cylinder(0.035, 0.035, 0.7, 6, [x, y + 0.7, z], GRANITE);
  b.sphere(0.09, [x, y + 1.1, z], GRANITE);
}

// ---- 석등 ----
function buildStoneLanterns(b: Batch): { fireY: number } {
  const fireY = 1.55;
  for (const l of STONE_LANTERNS) {
    b.cylinder(0.42, 0.46, 0.3, 8, [l.x, 0.15, l.z], GRANITE, { jitter: 0.04 });
    b.cylinder(0.3, 0.38, 0.18, 8, [l.x, 0.39, l.z], GRANITE);
    b.cylinder(0.12, 0.14, 0.75, 8, [l.x, 0.85, l.z], GRANITE);
    b.cylinder(0.34, 0.2, 0.16, 8, [l.x, 1.3, l.z], GRANITE);
    // 화사석: 네 기둥 사이로 불빛이 보인다 (불빛은 scene.ts)
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      b.box([0.09, 0.42, 0.09], [l.x + Math.sin(a) * 0.2, fireY, l.z + Math.cos(a) * 0.2], GRANITE);
    }
    b.cylinder(0.12, 0.5, 0.22, 8, [l.x, 1.88, l.z], GRANITE);
    b.cylinder(0.05, 0.12, 0.14, 8, [l.x, 2.06, l.z], GRANITE);
    b.sphere(0.08, [l.x, 2.18, l.z], GRANITE);
  }
  return { fireY };
}

// ---- 미륵대불 ----
function buildBuddha(b: Batch): void {
  const { x, z, platform: P, platformH } = BUDDHA;
  // 기단 두 단과 앞 계단
  b.box([P, platformH * 0.55, P], [x, platformH * 0.275, z], STONE, { jitter: 0.05, shade: groundShade });
  b.box([P - 1.6, platformH * 0.45, P - 1.6], [x, platformH * 0.55 + platformH * 0.225, z], STONE_LIGHT, { jitter: 0.04 });
  const y0 = platformH;
  // 연꽃 대좌: 둥근 받침과 둘러 핀 꽃잎
  b.cylinder(1.9, 2.1, 0.5, 20, [x, y0 + 0.25, z], BUDDHA_STONE, { jitter: 0.03 });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    b.sphere(0.55, [x + Math.sin(a) * 1.85, y0 + 0.7, z + Math.cos(a) * 1.85], BUDDHA_STONE, { ry: a }, [0.8, 0.9, 0.35], [8, 6]);
  }
  b.cylinder(1.65, 1.8, 0.5, 20, [x, y0 + 0.8, z], BUDDHA_STONE);
  // 몸(가사 입은 서 있는 몸): 발치가 넓고 어깨에서 좁아지는 돌림 단면
  const body = y0 + 1.05;
  const H = BUDDHA.height;
  const prof: Array<[number, number]> = [
    [1.45, 0],
    [1.5, 0.05],
    [1.38, 0.18],
    [1.28, 0.4],
    [1.3, 0.55],
    [1.25, 0.66],
    [1.05, 0.71],
    [0.6, 0.735],
    [0.38, 0.745],
  ];
  const pts = prof.map(([r, t]) => new THREE.Vector2(r, t * H));
  b.add(new THREE.LatheGeometry(pts, 28), BUDDHA_STONE, [x, body, z], { jitter: 0.02 });
  // 옷 주름: 몸 앞으로 늘어진 U자 띠들
  for (let k = 0; k < 5; k++) {
    const yk = body + H * (0.25 + k * 0.08);
    b.add(new THREE.TorusGeometry(0.95 - k * 0.04, 0.05, 6, 20, Math.PI * 0.9), 0xcbc4b5, [x, yk, z + 0.6], { rz: Math.PI + Math.PI * 0.05, rx: 0.15 });
  }
  // 가슴 앞에 모은 두 손
  b.sphere(0.32, [x - 0.28, body + H * 0.5, z + 1.18], BUDDHA_STONE, {}, [1, 1.3, 0.8]);
  b.sphere(0.32, [x + 0.28, body + H * 0.47, z + 1.18], BUDDHA_STONE, {}, [1, 1.3, 0.8]);
  // 팔: 어깨에서 손으로 내려오는 가사 자락
  for (const s of [-1, 1]) {
    b.cylinder(0.32, 0.38, H * 0.25, 10, [x + s * 0.95, body + H * 0.58, z + 0.55], BUDDHA_STONE, { rx: 0.55, rz: s * 0.2 });
  }
  // 목, 머리, 귀, 육계
  const headY = body + H * 0.745 + 0.95;
  b.cylinder(0.42, 0.5, 0.5, 14, [x, body + H * 0.745 + 0.2, z], BUDDHA_STONE);
  b.sphere(0.95, [x, headY, z], BUDDHA_STONE, {}, [0.92, 1.08, 0.95], [20, 14]);
  for (const s of [-1, 1]) b.sphere(0.25, [x + s * 0.88, headY - 0.15, z - 0.05], BUDDHA_STONE, {}, [0.45, 1.6, 0.7]);
  // 나발(곱슬 머리)은 머리 위를 덮는 조금 어두운 반구로
  b.add(new THREE.SphereGeometry(0.98, 20, 10, 0, Math.PI * 2, 0, 1.2), 0x9c968a, [x, headY + 0.05, z - 0.04], { rx: -0.2 });
  b.sphere(0.45, [x, headY + 1.0, z - 0.1], 0x9c968a, {}, [1, 0.9, 1]);
  // 백호와 눈썹 자리 (멀리서 얼굴로 읽히게)
  b.sphere(0.06, [x, headY + 0.18, z + 0.9], 0xb8a46a);
  for (const s of [-1, 1]) b.box([0.34, 0.05, 0.05], [x + s * 0.27, headY + 0.02, z + 0.86], 0x8f897d, { rz: s * -0.08 });
}

// ---- 나무 ----
function buildTrees(b: Batch): void {
  for (const t of TREES) {
    const s = t.scale;
    if (t.kind === 'pine') {
      // 소나무: 살짝 기운 붉은 줄기와 넓게 퍼진 납작한 잎 무리
      const lean = ((t.x * 13 + t.z * 7) % 5) * 0.03 - 0.06;
      b.cylinder(0.18 * s, 0.3 * s, 6 * s, 7, [t.x, 3 * s, t.z], BARK, { rz: lean, jitter: 0.1 });
      const clumps: Array<[number, number, number, number]> = [
        [0, 6.4, 0, 2.2],
        [1.3, 5.4, 0.4, 1.6],
        [-1.2, 5, -0.5, 1.5],
        [0.3, 4.4, -1.1, 1.3],
      ];
      clumps.forEach(([dx, dy, dz, r], i) => {
        b.sphere(r * s, [t.x + dx * s + lean * dy * s, dy * s, t.z + dz * s], i % 2 ? PINE_DARK : PINE, { jitter: 0.12 }, [1, 0.45, 1], [9, 6]);
      });
    } else {
      // 은행나무: 곧은 줄기와 노랗게 물든 둥근 원뿔 잎
      b.cylinder(0.22 * s, 0.36 * s, 4 * s, 7, [t.x, 2 * s, t.z], BARK, { jitter: 0.1 });
      b.sphere(2.6 * s, [t.x, 5.6 * s, t.z], GINKGO, { jitter: 0.12 }, [1, 1.35, 1], [10, 8]);
      b.sphere(1.8 * s, [t.x + 0.8 * s, 7.6 * s, t.z - 0.4 * s], GINKGO_DEEP, { jitter: 0.1 }, [1, 1.2, 1], [9, 6]);
      // 떨어진 은행잎이 깔린 땅
      b.add(new THREE.CircleGeometry(3 * s, 14), GINKGO, [t.x, 0.015, t.z], { rx: -Math.PI / 2, jitter: 0.15 });
    }
  }
}

// ---- 연등 줄을 매는 기둥 ----
function buildLanternPoles(b: Batch): void {
  for (const row of LANTERN_ROWS) {
    for (const x of [row.x0, row.x1]) {
      b.cylinder(0.07, 0.09, row.y + 0.3, 6, [x, (row.y + 0.3) / 2, row.z], 0x5b4636);
      b.box([0.4, 0.15, 0.4], [x, 0.075, row.z], STONE);
    }
  }
}

// ---- 방석과 나무 의자 ----
function buildSeatsVisual(b: Batch): void {
  const benches = new Map<number, Array<{ x: number; z: number }>>();
  for (const s of Object.values(SEAT_PLACES)) {
    if (s.kind === 'cushion') {
      b.box([0.72, 0.1, 0.72], [s.x, 0.05, s.z], CUSHION, { ry: s.facing });
      b.box([0.76, 0.04, 0.76], [s.x, 0.02, s.z], CUSHION_EDGE, { ry: s.facing });
    } else {
      const key = s.z < 22 ? 0 : 1;
      const list = benches.get(key) ?? [];
      list.push({ x: s.x, z: s.z });
      benches.set(key, list);
    }
  }
  for (const list of benches.values()) {
    const z0 = Math.min(...list.map((p) => p.z)) - 0.45;
    const z1 = Math.max(...list.map((p) => p.z)) + 0.45;
    const x = list[0]!.x;
    const zc = (z0 + z1) / 2;
    b.box([0.5, 0.08, z1 - z0], [x, 0.42, zc], BENCH, { jitter: 0.08 });
    b.box([0.08, 0.5, z1 - z0], [x + 0.3, 0.75, zc], BENCH, { jitter: 0.08 });
    for (const zz of [z0 + 0.15, z1 - 0.15]) b.box([0.45, 0.4, 0.08], [x, 0.2, zz], 0x5b4030);
  }
}

export interface BuiltTemple {
  geometry: THREE.BufferGeometry;
  /** 범종각 들보 아래(종을 거는 높이) */
  bellBeamY: number;
  /** 석등 불 높이 */
  stoneLanternFireY: number;
  /** 법왕루 현판 높이 */
  pavilionSignY: number;
}

export function buildTemple(): BuiltTemple {
  const b = new Batch(7);
  buildGround(b);
  buildWalls(b);
  buildGate(b);
  const pav = buildPavilion(b);
  hall(b, DAEUNGJEON, { baseMargin: 1.5, stepWidth: 5 });
  hall(b, PANJEON, { baseMargin: 0.6, stepWidth: 2.4, hip: 0.7 });
  hall(b, SEONBULDANG, { baseMargin: 0.6, stepWidth: 2 });
  hall(b, JIJANGJEON, { baseMargin: 0.6, stepWidth: 2 });
  const bell = buildBellPavilion(b);
  buildPagoda(b);
  const lanterns = buildStoneLanterns(b);
  buildBuddha(b);
  buildTrees(b);
  buildSeatsVisual(b);
  buildLanternPoles(b);
  const geometry = b.build();
  if (!geometry) throw new Error('bongeunsa: 절을 만들지 못했어요');
  return { geometry, bellBeamY: bell.beamY, stoneLanternFireY: lanterns.fireY, pavilionSignY: pav.signY };
}
