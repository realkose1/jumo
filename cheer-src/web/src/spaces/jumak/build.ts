// 주막의 고정된 모양을 만든다: 흙 마당, 평상 넷과 방석, 소반, 돌담, 기둥, TV 판벽과 차양, 청사초롱. 지붕이 없는 바깥 마당이다.
// 모두 기본 도형이고, 재질이 같은 것은 한 덩어리로 합친다.
//   lit  : 정점 색 Lambert (나무, 기와, 방석, 소반 …)  -> 그리기 호출 1번
//   glow : 정점 색 Basic  (초롱 종이, 문종이처럼 스스로 빛나는 것)  -> 그리기 호출 1번
import * as THREE from 'three';
import { Batch, groupMatrix, seeded, smoothstep } from './batch';
import {
  CUSHION_H,
  JUMO,
  PLATFORMS,
  PLATFORM_D,
  PLATFORM_H,
  PLATFORM_W,
  ROOM,
  SEAT_COLS,
  SEAT_ROWS,
  TABLE_LOCAL,
  TV,
  seatFacing,
} from './layout';

export interface LanternSpot {
  x: number;
  y: number;
  z: number;
  /** 붉은 초롱이면 따뜻한 빛, 푸른 초롱이면 차가운 빛 */
  warm: boolean;
}

export interface RoomBuild {
  lit: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
  lanterns: LanternSpot[];
}

const C = {
  floorBase: 0x74502f,
  floorSlab: 0x1b1108,
  yard: 0x14161b,
  platTop: 0xa8794a,
  platFrame: 0x58381e,
  platSkirt: 0x3a2514,
  wall: 0x4e3524,
  wallDark: 0x2c1b11,
  trim: 0x2a190d,
  post: 0x6e4228,
  beam: 0x4a2c18,
  stone: 0x6f6d68,
  roofUnder: 0x42291a,
  rafter: 0x6a4228,
  tileA: 0x3e434b,
  tileB: 0x2f333a,
  eaveTile: 0xc4bfb2,
  eaveTileB: 0x8f8a7f,
  tableTop: 0x6a4428,
  tableLeg: 0x3a2316,
  kettle: 0xe2b02a,
  bowl: 0xf0e6d0,
  makgeolli: 0xf7f3e8,
  pancake: 0xc98a2c,
  paper: 0xd9b57a,
  lacquer: 0x1a1209,
  red: 0xd8321f,
  blue: 0x2760d4,
  jar: 0x7b4a2a,
} as const;

/** 방석 색: 청, 홍, 황이 돌아가며 (평상마다 시작이 다르다) */
const CUSHION_COLORS = [0xc8382a, 0x2d5fb0, 0xd9a21b] as const;

const wallShade = (y: number): number => 0.5 + 0.5 * smoothstep(0, 2.6, y);


export function buildRoom(): RoomBuild {
  const lit = new Batch(7);
  const glow = new Batch(11);
  const lanterns: LanternSpot[] = [];

  buildFloor(lit);
  buildPlatforms(lit);
  buildShell(lit, glow);
  buildCanopy(lit);
  buildTvSet(lit);
  buildStove(lit, glow);
  buildPennants(lit);
  buildLanterns(lit, glow, lanterns);

  const litGeo = lit.build();
  const glowGeo = glow.build();
  if (!litGeo || !glowGeo) throw new Error('jumak: 방 모양이 비었어요');
  return { lit: litGeo, glow: glowGeo, lanterns };
}

// ---- 마루 ----
function buildFloor(b: Batch): void {
  const rand = seeded(21);
  const width = ROOM.halfWidth * 2;
  const depth = ROOM.backZ - ROOM.frontZ;
  const midZ = (ROOM.frontZ + ROOM.backZ) / 2;
  // 널 사이 틈으로 보이는 어두운 바닥
  b.plane(width + 0.4, depth, [0, -0.02, midZ], C.floorSlab, { rx: -Math.PI / 2 });
  // 다진 흙 마당: 조각마다 색이 조금씩 다르고, 군데군데 납작한 돌
  const dirt = new THREE.Color(0x6b5236);
  const tiles = 12;
  const tw = width / tiles;
  const td = depth / tiles;
  for (let i = 0; i < tiles; i++) {
    for (let j = 0; j < tiles; j++) {
      const color = dirt.clone().multiplyScalar(0.86 + rand() * 0.22).getHex();
      b.plane(tw + 0.01, td + 0.01, [-ROOM.halfWidth + (i + 0.5) * tw, 0, ROOM.frontZ + (j + 0.5) * td], color, { rx: -Math.PI / 2, jitter: 0.05 });
    }
  }
  for (let k = 0; k < 26; k++) {
    const x = -ROOM.halfWidth + rand() * width;
    const z = ROOM.frontZ + rand() * depth;
    b.cylinder(0.12 + rand() * 0.16, 0.16 + rand() * 0.18, 0.04, 7, [x, 0.01, z], C.stone, { jitter: 0.12 });
  }
  // 마루 가장자리(옆이 트인 쪽)와 마당
  for (const s of [-1, 1]) {
    b.box([0.3, ROOM.yardDrop, depth], [s * (ROOM.halfWidth + 0.15), -ROOM.yardDrop / 2, midZ], C.platFrame);
    // 디딤돌
    b.box([0.9, 0.22, 1.1], [s * (ROOM.halfWidth + 0.95), -ROOM.yardDrop + 0.11, 1.2], C.stone, { jitter: 0.08 });
  }
  b.plane(120, 120, [0, -ROOM.yardDrop, midZ], C.yard, { rx: -Math.PI / 2 });
}

// ---- 평상, 방석, 소반 ----
function buildPlatforms(b: Batch): void {
  PLATFORMS.forEach((p, pi) => {
    const parent = groupMatrix(p.cx, p.cz, p.rot);
    const o = { parent };
    // 몸체와 테두리
    b.box([PLATFORM_W - 0.1, PLATFORM_H - 0.07, PLATFORM_D - 0.1], [0, (PLATFORM_H - 0.07) / 2, 0], C.platSkirt, { parent, shade: (y) => 0.55 + 0.45 * smoothstep(0, 0.4, y) });
    const rim = 0.09;
    b.box([PLATFORM_W, 0.07, rim], [0, PLATFORM_H - 0.035, -PLATFORM_D / 2 + rim / 2], C.platFrame, o);
    b.box([PLATFORM_W, 0.07, rim], [0, PLATFORM_H - 0.035, PLATFORM_D / 2 - rim / 2], C.platFrame, o);
    b.box([rim, 0.07, PLATFORM_D], [-PLATFORM_W / 2 + rim / 2, PLATFORM_H - 0.035, 0], C.platFrame, o);
    b.box([rim, 0.07, PLATFORM_D], [PLATFORM_W / 2 - rim / 2, PLATFORM_H - 0.035, 0], C.platFrame, o);
    // 윗면 널 (앞뒤로 긴 널을 가로로 나란히)
    const rand = seeded(40 + pi);
    const slats = 11;
    const inner = PLATFORM_W - rim * 2;
    const sw = inner / slats;
    const top = new THREE.Color(C.platTop);
    for (let i = 0; i < slats; i++) {
      const color = top.clone().multiplyScalar(0.9 + rand() * 0.2).getHex();
      b.plane(sw - 0.012, PLATFORM_D - rim * 2, [-inner / 2 + (i + 0.5) * sw, PLATFORM_H + 0.001, 0], color, { parent, rx: -Math.PI / 2, jitter: 0.05 }, [1, 4]);
    }
    // 방석 여섯
    SEAT_ROWS.forEach((lz, row) => {
      SEAT_COLS.forEach((lx, col) => {
        const color = CUSHION_COLORS[(row * 3 + col + pi) % CUSHION_COLORS.length]!;
        const dark = new THREE.Color(color).multiplyScalar(0.72).getHex();
        // 방석도 TV 쪽으로 틀어 놓는다 (평상 기준 돌림 = TV 방향 - 평상이 놓인 방향)
        const turn = Math.atan2(Math.sin(seatFacing(p, lx, lz) - (p.rot + Math.PI)), Math.cos(seatFacing(p, lx, lz) - (p.rot + Math.PI)));
        b.box([0.54, CUSHION_H * 0.62, 0.54], [lx, PLATFORM_H + (CUSHION_H * 0.62) / 2, lz], dark, { parent, ry: turn });
        b.box([0.5, CUSHION_H * 0.55, 0.5], [lx, PLATFORM_H + CUSHION_H * 0.62 + (CUSHION_H * 0.38) / 2 - 0.004, lz], color, { parent, ry: turn, jitter: 0.04 });
        // 가운데 단추
        b.cylinder(0.035, 0.035, 0.012, 6, [lx, PLATFORM_H + CUSHION_H + 0.001, lz], dark, o);
      });
    });
    // 소반
    buildTable(b, parent);
  });
}

function buildTable(b: Batch, parent: THREE.Matrix4): void {
  const o = { parent };
  const { x, z, w, d } = TABLE_LOCAL;
  const legH = 0.2;
  const y0 = PLATFORM_H;
  const topY = y0 + legH + 0.035;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box([0.04, legH, 0.04], [x + sx * (w / 2 - 0.05), y0 + legH / 2, z + sz * (d / 2 - 0.05)], C.tableLeg, o);
    }
  }
  b.box([w, 0.035, d], [x, y0 + legH + 0.0175, z], C.tableTop, { parent, jitter: 0.06 });
  // 막걸리 주전자(노란 양은 주전자)
  const kx = x - 0.27;
  b.cylinder(0.085, 0.115, 0.17, 10, [kx, topY + 0.085, z], C.kettle, o);
  b.sphere(0.058, [kx, topY + 0.18, z], C.kettle, o, [1, 0.55, 1], [9, 5]);
  b.cylinder(0.018, 0.03, 0.13, 6, [kx + 0.115, topY + 0.15, z], C.kettle, { parent, rz: -0.9 });
  b.add(new THREE.TorusGeometry(0.075, 0.011, 5, 9, Math.PI), C.kettle, [kx - 0.095, topY + 0.1, z], { parent, rz: Math.PI / 2 });
  // 사발 둘과 전 한 접시
  const bowl = (bx: number, bz: number): void => {
    b.cylinder(0.075, 0.045, 0.06, 10, [bx, topY + 0.03, bz], C.bowl, o);
    b.cylinder(0.062, 0.062, 0.004, 10, [bx, topY + 0.058, bz], C.makgeolli, o);
  };
  bowl(x - 0.02, z + 0.07);
  bowl(x + 0.13, z - 0.08);
  b.cylinder(0.11, 0.11, 0.014, 12, [x + 0.32, topY + 0.007, z + 0.02], C.bowl, o);
  b.cylinder(0.085, 0.085, 0.02, 12, [x + 0.32, topY + 0.022, z + 0.02], C.pancake, o);
}

// ---- 담장, 기둥 (지붕 없이 하늘이 트인 마당) ----
// 예전에는 기와지붕 아래 방이었지만, 지금은 지붕을 걷고 돌담으로 둘러싼 바깥 마당이다.
// TV 뒤에만 나무 판벽(차양이 달린다)이 서고, 양옆 기둥과 도리는 초롱을 거는 시렁으로 남는다.
function buildShell(lit: Batch, glow: Batch): void {
  void glow;
  const midZ = (ROOM.frontZ + ROOM.backZ) / 2;
  const depth = ROOM.backZ - ROOM.frontZ;

  // TV 뒤 판벽: 세로 널
  const rand = seeded(61);
  const wallBase = new THREE.Color(C.wall);
  const strip = 0.6;
  const boardHalf = 4.2;
  const boardTop = 4.7;
  const strips = Math.round((boardHalf * 2) / strip);
  for (let i = 0; i < strips; i++) {
    const x = -boardHalf + (i + 0.5) * strip;
    const bottom = -ROOM.yardDrop;
    const color = wallBase.clone().multiplyScalar(0.88 + rand() * 0.24).getHex();
    lit.plane(strip - 0.02, boardTop - bottom, [x, (boardTop + bottom) / 2, ROOM.frontZ], color, { shade: wallShade, jitter: 0.05 }, [1, 4]);
    // 뒷면(마당 밖에서 보이는 쪽)
    lit.plane(strip - 0.02, boardTop - bottom, [x, (boardTop + bottom) / 2, ROOM.frontZ - 0.12], C.wallDark, { ry: Math.PI });
  }
  lit.box([boardHalf * 2 + 0.3, 0.22, 0.3], [0, boardTop + 0.05, ROOM.frontZ - 0.06], C.trim);
  for (const sx of [-1, 1]) lit.box([0.26, boardTop + ROOM.yardDrop + 0.1, 0.3], [sx * (boardHalf + 0.1), (boardTop - ROOM.yardDrop) / 2, ROOM.frontZ - 0.06], C.post);

  // 돌담: 앞(판벽 양옆)과 뒤
  stoneWall(lit, -ROOM.eaveHalfWidth, -boardHalf - 0.2, ROOM.frontZ - 0.1, 71);
  stoneWall(lit, boardHalf + 0.2, ROOM.eaveHalfWidth, ROOM.frontZ - 0.1, 72);
  stoneWall(lit, -ROOM.eaveHalfWidth, ROOM.eaveHalfWidth, ROOM.backZ, 73);

  // 기둥과 주춧돌, 옆 도리(초롱을 거는 시렁)
  const postZ = [ROOM.frontZ + 0.4, -3.0, 0, 3.0, 6.0, ROOM.backZ - 0.4];
  for (const s of [-1, 1]) {
    for (const z of postZ) {
      lit.cylinder(0.14, 0.17, ROOM.postTopY + ROOM.yardDrop, 10, [s * ROOM.halfWidth, (ROOM.postTopY - ROOM.yardDrop) / 2, z], C.post, { shade: wallShade, jitter: 0.04 });
      lit.cylinder(0.27, 0.3, 0.3, 8, [s * ROOM.halfWidth, 0.1, z], C.stone, { jitter: 0.06 });
    }
    lit.box([0.2, 0.24, depth], [s * ROOM.halfWidth, ROOM.postTopY - 0.1, midZ], C.beam);
  }
}

/** 돌담: 둥글둥글한 돌을 몇 줄 쌓고 위에 기와를 얹는다 (x0~x1, 높이 약 1.3m) */
function stoneWall(b: Batch, x0: number, x1: number, z: number, seed: number): void {
  const rand = seeded(seed);
  const bottom = -ROOM.yardDrop;
  const rows = 4;
  const rowH = 0.3;
  const len = x1 - x0;
  // 속을 채우는 흙벽
  b.box([len, rows * rowH, 0.5], [(x0 + x1) / 2, bottom + (rows * rowH) / 2, z], 0x5d4a38, { jitter: 0.05 });
  for (let r = 0; r < rows; r++) {
    let x = x0 + (r % 2) * 0.2;
    while (x < x1 - 0.1) {
      const w = Math.min(x1 - x, 0.38 + rand() * 0.3);
      const shade = 0.8 + rand() * 0.35;
      const col = new THREE.Color(C.stone).multiplyScalar(shade).getHex();
      for (const side of [-1, 1]) {
        b.box([w - 0.05, rowH - 0.05, 0.12], [x + w / 2, bottom + r * rowH + rowH / 2, z + side * 0.25], col, { jitter: 0.1 });
      }
      x += w;
    }
  }
  // 기와 지붕(담 위)
  const top = bottom + rows * rowH;
  b.box([len + 0.2, 0.1, 0.8], [(x0 + x1) / 2, top + 0.05, z], C.tileB);
  b.box([len + 0.2, 0.14, 0.36], [(x0 + x1) / 2, top + 0.17, z], C.tileA);
  const caps = Math.max(1, Math.round(len / 0.32));
  for (let i = 0; i < caps; i++) {
    for (const side of [-1, 1]) {
      b.cylinder(0.07, 0.07, 0.04, 6, [x0 + (i + 0.5) * (len / caps), top + 0.06, z + side * 0.42], i % 2 ? C.eaveTile : C.eaveTileB, { rx: Math.PI / 2 });
    }
  }
}

// ---- TV 위에 달린 차양(작은 기와지붕) ----
function buildCanopy(b: Batch): void {
  const wallZ = ROOM.frontZ;
  const edgeZ = wallZ + 1.5;
  const yWall = 4.45;
  const yEdge = 4.0;
  const width = 13.2;
  const len = Math.hypot(edgeZ - wallZ, yWall - yEdge);
  const tilt = Math.atan2(yWall - yEdge, edgeZ - wallZ); // 앞쪽이 낮다
  const midZ = (wallZ + edgeZ) / 2;
  const midY = (yWall + yEdge) / 2;
  // 안쪽 널(아래를 본다)과 기와 면(위를 본다)
  b.plane(width, len, [0, midY - 0.03, midZ], C.roofUnder, { rx: Math.PI / 2 + tilt });
  const stripes = 22;
  for (let i = 0; i < stripes; i++) {
    const sw = width / stripes;
    b.plane(sw, len, [-width / 2 + (i + 0.5) * sw, midY + 0.12, midZ], i % 2 ? C.tileA : C.tileB, { rx: -Math.PI / 2 + tilt });
  }
  // 서까래
  const rafters = 28;
  for (let i = 0; i < rafters; i++) {
    b.box([0.1, 0.08, len], [-width / 2 + (i + 0.5) * (width / rafters), midY - 0.08, midZ], C.rafter, { rx: tilt });
  }
  // 앞 끝 평고대와 막새
  b.box([width, 0.22, 0.14], [0, yEdge + 0.02, edgeZ], C.trim);
  const caps = Math.round(width / 0.3);
  for (let i = 0; i < caps; i++) {
    b.cylinder(0.125, 0.125, 0.05, 8, [-width / 2 + (i + 0.5) * (width / caps), yEdge + 0.2, edgeZ + 0.05], i % 2 ? C.eaveTile : C.eaveTileB, { rx: Math.PI / 2 - 0.12 });
  }
  // 차양을 받치는 두 팔
  for (const sx of [-1, 1]) {
    b.box([0.14, 0.14, 1.6], [sx * 5.6, 4.1, midZ], C.beam, { rx: tilt });
    b.box([0.12, 0.8, 0.12], [sx * 5.6, 3.7, wallZ + 0.18], C.beam);
  }
}

// ---- TV 틀, 장식장, 항아리 ----
function buildTvSet(b: Batch): void {
  const z = ROOM.frontZ;
  const frameZ = TV.z - 0.09; // 틀의 앞면이 화면보다 살짝 앞
  b.box([TV.w + 0.3, TV.h + 0.3, 0.16], [TV.x, TV.y, frameZ - 0.02], 0x0b0b0e);
  b.box([TV.w + 0.5, 0.06, 0.2], [TV.x, TV.y + TV.h / 2 + 0.17, frameZ], C.trim);
  b.box([TV.w + 0.5, 0.06, 0.2], [TV.x, TV.y - TV.h / 2 - 0.17, frameZ], C.trim);
  // 아래 장식장
  const topY = TV.y - TV.h / 2 - 0.45;
  b.box([6.2, topY, 0.7], [0, topY / 2, z + 0.4], C.platFrame, { shade: (y) => 0.65 + 0.35 * smoothstep(0, 0.8, y) });
  b.box([6.4, 0.06, 0.78], [0, topY + 0.03, z + 0.42], C.tableTop);
  for (const sx of [-1, 1]) {
    b.box([0.02, topY - 0.12, 0.02], [sx * 0.9 + 0, topY / 2, z + 0.77], C.trim);
    b.box([0.9, topY - 0.14, 0.02], [sx * 1.9, topY / 2, z + 0.76], C.platSkirt);
  }
  // 항아리 (장독대)
  const jar = (x: number, s: number): void => {
    const prof = [new THREE.Vector2(0.001, 0), new THREE.Vector2(0.2 * s, 0.02), new THREE.Vector2(0.3 * s, 0.25 * s), new THREE.Vector2(0.32 * s, 0.4 * s), new THREE.Vector2(0.24 * s, 0.62 * s), new THREE.Vector2(0.15 * s, 0.7 * s), new THREE.Vector2(0.17 * s, 0.76 * s), new THREE.Vector2(0.001, 0.76 * s)];
    b.add(new THREE.LatheGeometry(prof, 12), C.jar, [x, 0, z + 0.75], { jitter: 0.06, shade: (y) => 0.6 + 0.4 * smoothstep(0, 0.6, y) });
  };
  jar(-6.95, 1.0);
  jar(4.8, 1.1);
  jar(5.5, 0.8);
}

// ---- 부뚜막: 주모가 음식을 하는 곳 (TV 왼쪽 벽 가까이) ----
function buildStove(b: Batch, glow: Batch): void {
  const x = JUMO.stoveX;
  const z = JUMO.stoveZ;
  const clay = 0xa17b57;
  b.box([1.5, 0.6, 0.9], [x, 0.3, z], clay, { jitter: 0.06, shade: (y) => 0.7 + 0.3 * smoothstep(0, 0.6, y) });
  b.box([1.56, 0.05, 0.96], [x, 0.625, z], 0x8a6544, { jitter: 0.05 });
  // 아궁이: 어두운 구멍과 불씨
  b.box([0.42, 0.3, 0.03], [x + 0.35, 0.2, z + 0.455], 0x14100d);
  glow.box([0.3, 0.08, 0.02], [x + 0.35, 0.1, z + 0.472], 0xe8591c);
  // 가마솥과 나무 뚜껑
  b.sphere(0.4, [x - 0.3, 0.78, z], 0x232326, {}, [1, 0.55, 1], [14, 7]);
  b.add(new THREE.TorusGeometry(0.4, 0.03, 6, 16), 0x2d2d31, [x - 0.3, 0.8, z], { rx: Math.PI / 2 });
  b.cylinder(0.34, 0.36, 0.05, 14, [x - 0.3, 0.92, z], 0x8a5e36, { jitter: 0.05 });
  b.sphere(0.04, [x - 0.3, 0.97, z], 0x5a3a22, {}, [1, 1, 1], [8, 5]);
  // 벽 선반과 그릇
  b.box([1.7, 0.05, 0.26], [x, 1.5, ROOM.frontZ + 0.15], 0x6a4428);
  for (let i = 0; i < 4; i++) {
    b.cylinder(0.075, 0.045, 0.06, 10, [x - 0.6 + i * 0.4, 1.555, ROOM.frontZ + 0.15], 0xf0e6d0);
  }
  b.box([0.06, 0.2, 0.2], [x - 0.8, 1.4, ROOM.frontZ + 0.15], 0x5a3a22);
  b.box([0.06, 0.2, 0.2], [x + 0.8, 1.4, ROOM.frontZ + 0.15], 0x5a3a22);
  // 말린 고추 두름
  for (let i = 0; i < 5; i++) b.cylinder(0.025, 0.012, 0.16, 5, [x + 1.1, 2.55 - i * 0.12, ROOM.frontZ + 0.1], 0xb8281c, { rz: (i % 2 ? 1 : -1) * 0.12 });
}

// ---- 줄 깃발 (오방색) ----
function buildPennants(b: Batch): void {
  const colors = [0xd8321f, 0x2760d4, 0xe8b923, 0xf0ece0, 0x2f3a46];
  const z = ROOM.frontZ + 1.2;
  const span = 6.4;
  const n = 21;
  // TV 위로 충분히 올려서(아래로 늘어진 깃발 끝도 TV 윗변보다 위) 어느 자리에서도 화면을 가리지 않는다.
  // 간판이 걸린 가운데(|x| < 1.7)는 비운다
  const line = (x: number): number => 3.95 - 0.3 * (1 - Math.pow(x / span, 2));
  for (let i = 0; i < n; i++) {
    const x = -span + ((i + 0.5) * span * 2) / n;
    if (Math.abs(x) < 1.7) continue;
    const w = 0.22;
    const y0 = line(x);
    const verts = new Float32Array([x - w / 2, y0, z, x + w / 2, y0, z, x, y0 - 0.3, z]);
    for (const back of [false, true]) {
      const g = new THREE.BufferGeometry();
      const v = back ? new Float32Array([verts[3]!, verts[4]!, verts[5]!, verts[0]!, verts[1]!, verts[2]!, verts[6]!, verts[7]!, verts[8]!]) : verts;
      g.setAttribute('position', new THREE.BufferAttribute(v, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, back ? -1 : 1, 0, 0, back ? -1 : 1, 0, 0, back ? -1 : 1]), 3));
      b.add(g, colors[i % colors.length]!, [0, 0, 0]);
    }
  }
  // 줄
  for (let i = 0; i < 16; i++) {
    const x0 = -span + (i * span * 2) / 16;
    const x1 = -span + ((i + 1) * span * 2) / 16;
    const y0 = line(x0);
    const y1 = line(x1);
    b.box([Math.hypot(x1 - x0, y1 - y0), 0.012, 0.012], [(x0 + x1) / 2, (y0 + y1) / 2, z], C.lacquer, { rz: Math.atan2(y1 - y0, x1 - x0) });
  }
}

// ---- 청사초롱 ----
function buildLanterns(lit: Batch, glow: Batch, out: LanternSpot[]): void {
  const spots: Array<{ x: number; z: number; topY: number; ropeTo: number; scale: number }> = [];
  // TV 앞 시선을 가리지 않게: 차양 앞줄은 TV 폭(±2.15) 바깥에만, 지붕 아래 줄은 양옆 기둥 쪽에만 둔다.
  // (방 한가운데 줄에 달면 통로와 앞줄 어느 자리에서든 TV 앞에 걸린다)
  for (const x of [-5.9, -4.65, -3.45, 3.45, 4.65, 5.9]) spots.push({ x, z: ROOM.frontZ + 1.4, topY: 3.62, ropeTo: 4.02, scale: 1.1 });
  for (const x of [-ROOM.halfWidth, ROOM.halfWidth]) for (const z of [-1.5, 1.5, 4.5]) spots.push({ x, z, topY: 3.55, ropeTo: ROOM.postTopY - 0.22, scale: 1 });

  spots.forEach((s, i) => {
    const blueBody = i % 3 === 1;
    const body = blueBody ? C.blue : C.red;
    const band = blueBody ? C.red : C.blue;
    const k = s.scale;
    // 줄
    const ropeLen = Math.max(0.1, s.ropeTo - s.topY);
    lit.box([0.014, ropeLen, 0.014], [s.x, s.topY + ropeLen / 2, s.z], C.lacquer);
    // 위 뚜껑, 띠, 몸통, 띠, 아래 뚜껑
    let y = s.topY;
    lit.cylinder(0.085 * k, 0.1 * k, 0.05 * k, 8, [s.x, y - 0.025 * k, s.z], C.lacquer);
    y -= 0.05 * k;
    glow.cylinder(0.13 * k, 0.14 * k, 0.07 * k, 10, [s.x, y - 0.035 * k, s.z], band);
    y -= 0.07 * k;
    // 아래에서 위로 (그래야 면이 바깥을 본다)
    const prof = [new THREE.Vector2(0.14 * k, -0.28 * k), new THREE.Vector2(0.18 * k, -0.21 * k), new THREE.Vector2(0.19 * k, -0.14 * k), new THREE.Vector2(0.18 * k, -0.07 * k), new THREE.Vector2(0.14 * k, 0)];
    glow.add(new THREE.LatheGeometry(prof, 10), body, [s.x, y, s.z]);
    y -= 0.28 * k;
    glow.cylinder(0.14 * k, 0.13 * k, 0.07 * k, 10, [s.x, y - 0.035 * k, s.z], band);
    y -= 0.07 * k;
    lit.cylinder(0.1 * k, 0.07 * k, 0.05 * k, 8, [s.x, y - 0.025 * k, s.z], C.lacquer);
    y -= 0.05 * k;
    // 술(매듭)
    lit.box([0.012, 0.26 * k, 0.012], [s.x, y - 0.13 * k, s.z], C.red);
    lit.box([0.045 * k, 0.05 * k, 0.045 * k], [s.x, y - 0.26 * k, s.z], C.red);
    out.push({ x: s.x, y: s.topY - 0.2 * k, z: s.z, warm: !blueBody });
  });
}
