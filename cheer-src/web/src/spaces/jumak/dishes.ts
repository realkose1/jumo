// 주문한 음식 여덟 가지를 기본 도형으로 만든다. 모양마다 한 덩어리(정점 색)라서 접시 하나가 그리기 호출 한 번이다.
// 원점은 접시 바닥 가운데이고 위가 +y. 크기는 반지름 0.3m 안.
import * as THREE from 'three';
import { Batch } from './batch';

export const DISH_KINDS = ['gukbap', 'pajeon', 'makgeolli', 'sundae', 'kimchijeon', 'dotorimuk', 'dubukimchi', 'bindaetteok'] as const;
export type DishKind = (typeof DISH_KINDS)[number];

/** 김이 나는 음식 (묵은 차갑다) */
export const HOT_DISHES: ReadonlySet<string> = new Set(['gukbap', 'pajeon', 'makgeolli', 'sundae', 'kimchijeon', 'dubukimchi', 'bindaetteok']);

/** 김이 올라오는 높이(음식 바닥 기준) */
export const STEAM_BASE_Y: Readonly<Record<string, number>> = {
  gukbap: 0.14, pajeon: 0.07, makgeolli: 0.3, sundae: 0.07, kimchijeon: 0.07, dotorimuk: 0.1, dubukimchi: 0.1, bindaetteok: 0.07,
};

const C = {
  cream: 0xf1e8d4,
  creamDark: 0xd9cdb2,
  broth: 0xd8c7a0,
  rice: 0xfbf8ef,
  green: 0x4f9a3a,
  red: 0xc23b22,
  gold: 0xd8a23c,
  kettle: 0xe2b02a,
  milk: 0xf7f3e8,
  sauce: 0x4a2b1a,
  sundae: 0x4a2626,
  sundaeIn: 0xa35b58,
  tofu: 0xf7f2e2,
  kimchi: 0xc8402a,
  muk: 0x6e4f3d,
  brass: 0xc9a24a,
  wood: 0x8a5e36,
};

function plate(b: Batch, r = 0.21): void {
  b.cylinder(r, r * 0.72, 0.03, 16, [0, 0.015, 0], C.cream);
  b.cylinder(r * 0.86, r * 0.86, 0.004, 16, [0, 0.031, 0], C.creamDark);
}

function sauceDish(b: Batch, x: number, z: number, color = C.sauce): void {
  b.cylinder(0.05, 0.035, 0.03, 10, [x, 0.015, z], C.cream);
  b.cylinder(0.04, 0.04, 0.004, 10, [x, 0.03, z], color);
}

function pancake(b: Batch, color: number, flecks: number[], seed: number): void {
  plate(b, 0.23);
  b.cylinder(0.18, 0.18, 0.035, 18, [0, 0.05, 0], color, { jitter: 0.06 });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + seed;
    const rad = 0.04 + ((i * 37) % 11) * 0.011;
    b.box([0.07, 0.008, 0.012], [Math.cos(a) * rad, 0.071, Math.sin(a) * rad], flecks[i % flecks.length]!, { ry: a * 2 });
  }
  sauceDish(b, 0.24, 0.16);
}

const BUILDERS: Record<DishKind, (b: Batch) => void> = {
  // 국밥: 뚝배기에 국물, 밥, 파
  gukbap(b) {
    const prof = [new THREE.Vector2(0.001, 0), new THREE.Vector2(0.075, 0), new THREE.Vector2(0.12, 0.035), new THREE.Vector2(0.16, 0.1), new THREE.Vector2(0.165, 0.125)];
    b.add(new THREE.LatheGeometry(prof, 16), 0x3b2a22, [0, 0, 0], { jitter: 0.05 });
    b.cylinder(0.155, 0.155, 0.006, 16, [0, 0.112, 0], C.broth);
    b.sphere(0.1, [0, 0.112, 0], C.rice, {}, [1, 0.45, 1], [12, 6]);
    for (let i = 0; i < 6; i++) {
      const a = i * 1.05;
      b.box([0.05, 0.012, 0.012], [Math.cos(a) * 0.08, 0.152, Math.sin(a) * 0.08], C.green, { ry: a * 3 });
    }
    b.box([0.025, 0.012, 0.02], [0.05, 0.158, -0.03], C.red);
    // 숟가락
    b.box([0.2, 0.008, 0.016], [0.3, 0.012, 0.06], C.brass, { ry: 0.4 });
    b.sphere(0.03, [0.2, 0.014, 0.1], C.brass, {}, [1, 0.35, 1.3], [8, 5]);
  },
  pajeon(b) {
    pancake(b, C.gold, [C.green, 0x7bbb55], 0.3);
  },
  kimchijeon(b) {
    pancake(b, 0xd9742a, [C.red, 0xe8a24a], 1.1);
  },
  bindaetteok(b) {
    pancake(b, 0xb98f3d, [C.green, C.red, 0xe6c46b], 2.0);
  },
  // 막걸리: 노란 양은 주전자와 사발 둘
  makgeolli(b) {
    b.cylinder(0.11, 0.15, 0.22, 12, [-0.08, 0.11, 0], C.kettle);
    b.sphere(0.075, [-0.08, 0.235, 0], C.kettle, {}, [1, 0.55, 1], [10, 6]);
    b.cylinder(0.025, 0.04, 0.16, 7, [0.07, 0.2, 0], C.kettle, { rz: -0.95 });
    b.add(new THREE.TorusGeometry(0.1, 0.014, 5, 10, Math.PI), C.kettle, [-0.2, 0.15, 0], { rz: Math.PI / 2 });
    for (const [x, z] of [[0.2, 0.1], [0.16, -0.12]] as const) {
      b.cylinder(0.075, 0.045, 0.06, 10, [x, 0.03, z], C.cream);
      b.cylinder(0.062, 0.062, 0.004, 10, [x, 0.058, z], C.milk);
    }
  },
  sundae(b) {
    plate(b, 0.23);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x = Math.cos(a) * 0.1;
      const z = Math.sin(a) * 0.1;
      b.cylinder(0.04, 0.04, 0.03, 10, [x, 0.05, z], C.sundae, { jitter: 0.05 });
      b.cylinder(0.026, 0.026, 0.004, 8, [x, 0.067, z], C.sundaeIn);
    }
    b.cylinder(0.04, 0.04, 0.03, 10, [0, 0.05, 0], C.sundae);
    sauceDish(b, 0.26, 0.12, 0xf2efe6);
  },
  dotorimuk(b) {
    plate(b, 0.23);
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) b.box([0.085, 0.045, 0.065], [(c - 1) * 0.095, 0.052 + r * 0.045, (r - 0.5) * 0.02], C.muk, { jitter: 0.07 });
    }
    b.box([0.1, 0.01, 0.014], [0, 0.123, 0], C.green, { ry: 0.5 });
    b.box([0.05, 0.008, 0.01], [0.03, 0.128, 0.02], C.red, { ry: -0.4 });
    sauceDish(b, 0.25, -0.12);
  },
  dubukimchi(b) {
    plate(b, 0.25);
    for (let i = 0; i < 5; i++) b.box([0.1, 0.035, 0.06], [-0.1 + i * 0.012, 0.05 + i * 0.012, -0.08 + i * 0.045], C.tofu, { ry: 0.2 });
    for (const [x, z, s] of [[0.1, 0.02, 1], [0.15, -0.04, 0.8], [0.12, 0.08, 0.85], [0.06, -0.03, 0.7]] as const) {
      b.sphere(0.055 * s, [x, 0.065, z], C.kimchi, { jitter: 0.1 }, [1.2, 0.7, 1], [8, 5]);
    }
  },
};

/** 모든 음식 모양을 만든다. 호출한 쪽이 geometry를 놓아 준다(dispose) */
export function buildDishGeometries(): Record<DishKind, THREE.BufferGeometry> {
  const out = {} as Record<DishKind, THREE.BufferGeometry>;
  DISH_KINDS.forEach((kind, i) => {
    const b = new Batch(300 + i);
    BUILDERS[kind](b);
    const g = b.build();
    if (!g) throw new Error(`jumak: 음식 ${kind}이 비었어요`);
    out[kind] = g;
  });
  return out;
}
