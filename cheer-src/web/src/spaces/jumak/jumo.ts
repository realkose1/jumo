// 주모(주막 주인) NPC: 쪽 찐 머리에 흰 머릿수건, 노랑 저고리에 남치마, 흰 행주치마를 두른 다정한 얼굴.
// 그냥 서 있지 않고 쉬지 않고 부엌일을 한다: 가마솥 국을 휘휘 젓고, 번철에 전을 뒤집고, 국을 뜨고, 잠깐 TV를 본다.
// 주문이 들어오면 하던 일을 멈추고 손님 쪽을 보며 손을 들어 대답한다.
// 몸통 한 덩어리 + 두 팔(어깨를 축으로 돈다) + 뒤집히는 전 하나. 원점은 발 밑 가운데, 앞은 +z, 입은 사람의 오른쪽이 -x.
// 옷은 손님 한복(outfit.ts)처럼 덧붙인 도형이 아니라 몸을 감싼다: 치마와 저고리는 선반으로 돌린 한 덩어리(정점 색)이고,
// 깃, 동정, 고름, 행주치마, 허리끈, 머릿수건은 그 겉면을 따라 붙인다. 얼굴은 기본 도형이다.
import * as THREE from 'three';
import { DETAIL_PRESETS } from '../../engine/avatar';
import { Batch } from './batch';
import { JUMO } from './layout';
import { Surface, band, hanbokFoot, mergeParts, paint, revolve, shell, smoothstep, surfaceFrame, surfacePath, type Ring } from './outfit';

const SKIN = 0xf6d7b8;
const HAIR = 0x1b1511;
/** 저고리(연노랑)와 소맷부리 안쪽 그늘 */
const JACKET = 0xf2dc8f;
const JACKET_SHADE = 0xc4a964;
/** 깃, 끝동, 고름은 자주 (노랑 저고리에 자주 회장, 남치마) */
const JAJU = 0x9e2f58;
const DONGJEONG = 0xffffff;
const SKIRT = 0x2d4a86;
/** 행주치마(흰 무명)와 감친 가장자리, 허리끈 */
const APRON = 0xf3efe4;
const APRON_HEM = 0xe0d8c4;
const APRON_TIE = 0xdcd2ba;
const SCARF = 0xf6f2e8;
const BINYEO = 0xd8b25a;

/** 어깨 자리 (몸 기준) */
const SHOULDER_Y = 0.92;
const SHOULDER_X = 0.19;

// ---- 몸통: 치마 + 저고리 (한 덩어리) ----
/** 치마 말기(가슴), 여기서부터 저고리 */
const CHIMA_TOP = 0.735;
// 치마 옆모습 [반지름, 높이]. 아래에서 위로. 바닥에 닿는 단은 살짝 말려 있고 가슴으로 갈수록 좁아지는 종 모양
const CHIMA_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.0, 0.0],
  [0.3, 0.004],
  [0.336, 0.012],
  [0.345, 0.028],
  [0.342, 0.05],
  [0.333, 0.1],
  [0.318, 0.18],
  [0.299, 0.27],
  [0.278, 0.36],
  [0.256, 0.45],
  [0.236, 0.54],
  [0.219, 0.62],
  [0.207, 0.69],
  [0.2, CHIMA_TOP],
];
const CHIMA_SURFACE = new Surface(CHIMA_PROFILE);
// 짧은 저고리: 도련(밑단)이 살짝 퍼져 치마 말기를 덮고, 둥근 어깨를 지나 목에서 닫힌다
const JEOGORI_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.2002, CHIMA_TOP + 0.0002],
  [0.222, 0.74],
  [0.228, 0.752],
  [0.221, 0.772],
  [0.212, 0.8],
  [0.209, 0.835],
  [0.205, 0.865],
  [0.196, 0.89],
  [0.182, 0.912],
  [0.162, 0.932],
  [0.136, 0.95],
  [0.104, 0.965],
  [0.066, 0.978],
  [0.0, 0.99],
];
const BODY_SURFACE = new Surface([...CHIMA_PROFILE, ...JEOGORI_PROFILE]);

/** 치마 주름: 한 바퀴에 18개. 말기에서는 없고 아래로 갈수록 깊어진다 (반지름에 곱하는 비율) */
const PLEATS = 18;
function pleatDepth(y: number): number {
  return 0.032 * (1 - smoothstep(0.03, CHIMA_TOP - 0.01, y));
}
function pleat(phi: number, y: number): number {
  return y > CHIMA_TOP ? 1 : 1 + pleatDepth(y) * Math.cos(PLEATS * phi);
}

function chimaJeogori(): THREE.BufferGeometry {
  const rings: Ring[] = [
    ...CHIMA_PROFILE.map(([r, y]) => ({ y, rx: r, color: SKIRT })),
    ...JEOGORI_PROFILE.map(([r, y]) => ({ y, rx: r, color: JACKET })),
  ];
  const g = revolve(rings, PLEATS * 4, pleat);
  // 주름 골은 빛이 덜 들어 조금 어둡다
  const pos = g.getAttribute('position');
  const col = g.getAttribute('color');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > CHIMA_TOP) continue;
    const valley = 0.5 - 0.5 * Math.cos(PLEATS * Math.atan2(pos.getX(i), pos.getZ(i)));
    const k = 1 - 0.16 * (pleatDepth(y) / pleatDepth(0)) * valley;
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
  return g;
}

/** 치마 겉면(주름 마루)에서 lift만큼 띄운 옆모습 [반지름, 높이]. from에서 to까지 steps칸 */
function overSkirt(lift: number, from: number, to: number, steps: number): Array<[number, number]> {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const y = from + ((to - from) * i) / steps;
    return [CHIMA_SURFACE.radius(y) * (1 + pleatDepth(y)) + lift, y];
  });
}

// 깃: 손님 저고리와 같은 우임. 오른쪽 가슴의 안깃 끝에서 오른쪽 목으로 올라가 목 뒤를 돌고,
// 왼쪽 목에서 오른쪽 가슴으로 비스듬히 내려와 고름에서 끝난다. [각, 높이]. 각은 앞이 0, 입은 사람의 왼쪽(+x)이 +
const COLLAR_PATH: ReadonlyArray<readonly [number, number]> = [
  [0.12, 0.853],
  [-0.22, 0.878],
  [-0.52, 0.902],
  [-0.9, 0.916],
  [-1.6, 0.924],
  [-2.4, 0.927],
  [-Math.PI, 0.928],
  [-3.9, 0.927],
  [-4.7, 0.924],
  [-5.38, 0.916],
  [-5.76, 0.893],
  [-6.06, 0.867],
  [-6.33, 0.84],
  [-6.58, 0.818],
];
const COLLAR_WIDTH = 0.038;
const COLLAR_THICK = 0.006;
/** 고름이 달리는 곳 (겉깃 끝) */
const GOREUM_AT = { phi: -6.58 + Math.PI * 2, y: 0.818 };

function collar(): THREE.BufferGeometry[] {
  const samples = 40;
  // 안깃은 낮게, 겉깃은 높게 띄워 겹치는 곳에서 겉깃이 위로 온다
  const path = surfacePath(BODY_SURFACE, COLLAR_PATH, samples, (t) => 0.003 + 0.009 * smoothstep(0.4, 0.62, t));
  // 동정: 깃의 목 쪽 가장자리에 덧댄 흰 띠
  const from = Math.round(samples * 0.06);
  const to = Math.round(samples * 0.92);
  const dongjeong = path.slice(from, to + 1).map((s) => ({ p: s.p.clone().addScaledVector(s.n, COLLAR_THICK * 0.7), n: s.n }));
  const dw = 0.015;
  return [band(path, COLLAR_WIDTH, COLLAR_THICK, JAJU), band(dongjeong, dw, 0.004, DONGJEONG, (COLLAR_WIDTH - dw) / 2)];
}

// ---- 행주치마: 저고리 도련 밑에 허리끈으로 매어 앞을 덮는 흰 무명. 등 뒤에서 나비매듭 ----
const APRON_TOP = 0.738;
const APRON_BOTTOM = 0.25;
// 맨 위 1cm는 저고리 도련과 허리끈 밑에 숨는다 (가장자리 감침 색이 그 안에서만 번진다)
const APRON_PROFILE: Array<[number, number]> = [...overSkirt(0.007, APRON_BOTTOM, APRON_TOP - 0.01, 11), [CHIMA_SURFACE.radius(APRON_TOP) + 0.007, APRON_TOP]];
const APRON_SURFACE = new Surface(APRON_PROFILE);
/** 고름 가닥이 내려오는 겉면: 위는 저고리, 아래는 행주치마와 허리끈 위 */
const OVER_APRON = new Surface([...overSkirt(0.013, 0.45, 0.728, 8), ...JEOGORI_PROFILE.slice(1)]);
/** 허리끈 높이 */
const TIE_Y = [0.712, 0.728] as const;

/** 앞에서 감싸는 각(한쪽). 네모난 천이라 아래로 퍼질수록 덜 감싼다 */
function apronHalf(y: number): number {
  return 0.5 * (0.34 / APRON_SURFACE.radius(y)) + 0.8;
}

function apron(): THREE.BufferGeometry[] {
  // shell은 앞이 트인 옷이라 뒤를 감싸게 만든 뒤 반 바퀴 돌려 앞으로 보낸다
  const cloth = shell({
    profile: APRON_PROFILE,
    gap: (y) => Math.PI - apronHalf(y),
    cols: 20,
    color: APRON,
    trim: APRON_HEM,
    trimWidth: 0.012,
    thick: 0.006,
  }).rotateY(Math.PI);
  // 허리끈: 앞은 행주치마 위, 뒤는 치마 위에 붙어 한 바퀴
  const tieR = (y: number) => APRON_SURFACE.radius(y) + 0.003;
  const [lo, hi] = TIE_Y;
  const tie = revolve(
    [
      { y: lo, rx: tieR(lo) - 0.004, color: APRON_TIE },
      { y: lo + 0.0005, rx: tieR(lo), color: APRON_TIE },
      { y: hi - 0.0005, rx: tieR(hi), color: APRON_TIE },
      { y: hi, rx: tieR(hi) - 0.004, color: APRON_TIE },
    ],
    48,
    (phi, y) => {
      const a = Math.abs(Math.atan2(Math.sin(phi), Math.cos(phi)));
      const covered = 1 - smoothstep(apronHalf(y) - 0.15, apronHalf(y) + 0.1, a);
      const bare = (CHIMA_SURFACE.radius(y) + 0.003) / tieR(y);
      return bare + (1 - bare) * covered;
    },
  );
  // 나비매듭: 등 가운데 매듭과 양옆 고리 둘, 늘어진 두 가닥
  const midY = (lo + hi) / 2;
  const knotFrame = surfaceFrame(CHIMA_SURFACE, Math.PI, midY, 0.018);
  const knot = new THREE.SphereGeometry(0.02, 10, 7).scale(1.1, 1, 0.75).applyMatrix4(knotFrame);
  const loops = [-1, 1].map((s) =>
    new THREE.SphereGeometry(1, 10, 7)
      .scale(0.056, 0.028, 0.012)
      .rotateZ(s * 0.3)
      .translate(s * 0.055, 0.01, -0.002)
      .applyMatrix4(knotFrame),
  );
  const backSkirt = new Surface(overSkirt(0.004, 0.3, CHIMA_TOP, 10));
  const tail = (ctrl: ReadonlyArray<readonly [number, number]>) =>
    band(surfacePath(backSkirt, ctrl, 8, (t) => 0.012 - 0.008 * smoothstep(0, 0.3, t)), 0.028, 0.004, APRON_TIE);
  return [
    cloth,
    tie,
    paint(knot, APRON_TIE),
    ...loops.map((g) => paint(g, APRON_TIE)),
    tail([[Math.PI - 0.03, midY - 0.01], [Math.PI - 0.06, midY - 0.08], [Math.PI - 0.08, midY - 0.17]]),
    tail([[Math.PI + 0.03, midY - 0.01], [Math.PI + 0.07, midY - 0.07], [Math.PI + 0.1, midY - 0.13]]),
  ];
}

/** 옷고름: 겉깃 끝의 매듭과 넓적한 고 하나, 길이가 다른 두 가닥 (긴 가닥은 행주치마 위로 배까지) */
function goreum(): THREE.BufferGeometry[] {
  const { phi, y } = GOREUM_AT;
  const knot = new THREE.SphereGeometry(0.021, 10, 7).scale(1.15, 0.95, 0.7).applyMatrix4(surfaceFrame(BODY_SURFACE, phi, y, 0.022));
  const loop = new THREE.SphereGeometry(1, 10, 7)
    .scale(0.046, 0.022, 0.01)
    .translate(-0.012, 0, 0)
    .rotateZ(-0.42)
    .applyMatrix4(surfaceFrame(BODY_SURFACE, phi - 0.17, y + 0.016, 0.018));
  const tail = (ctrl: ReadonlyArray<readonly [number, number]>, width: number) =>
    band(surfacePath(OVER_APRON, ctrl, 10, (t) => 0.016 - 0.01 * smoothstep(0, 0.35, t)), width, 0.004, JAJU);
  return [
    paint(knot, JAJU),
    paint(loop, JAJU),
    tail([[phi + 0.02, y - 0.006], [phi - 0.03, y - 0.07], [phi - 0.07, y - 0.14], [phi - 0.1, y - 0.205]], 0.034),
    tail([[phi + 0.06, y - 0.006], [phi + 0.1, y - 0.06], [phi + 0.14, y - 0.12]], 0.03),
  ];
}

/** 버선코: 치맛단 앞으로 살짝 나온 두 발끝 (손님 버선과 같은 모양) */
function toes(): THREE.BufferGeometry[] {
  return [-1, 1].map((s) => hanbokFoot(DETAIL_PRESETS.self).rotateY(s * 0.12).translate(s * 0.068, 0.04, 0.252));
}

// ---- 머리: 얼굴과 쪽 찐 머리(비녀), 머리를 따라 감싼 흰 머릿수건 ----
/** 얼굴 구(중심 y 1.12, 반지름 0.22, 세로 1.02배, 앞뒤 0.98배)와 머리카락 구(중심 y 1.17 z -0.035, 반지름 0.226, 세로 0.9배) */
function headSlice(y: number): { rx: number; rz: number; cz: number } {
  const slice = (cy: number, r: number, sy: number) => Math.sqrt(Math.max(0, r * r - ((y - cy) / sy) ** 2));
  const face = slice(1.12, 0.22, 1.02);
  const hair = slice(1.17, 0.226, 0.9);
  const front = Math.max(face * 0.98, hair - 0.035);
  const back = Math.max(face * 0.98, hair + 0.035);
  return { rx: Math.max(face, hair), rz: (front + back) / 2, cz: (front - back) / 2 };
}

function scarf(): THREE.BufferGeometry[] {
  const lift = 0.007;
  const ring = (y: number, inset = 0): Ring => {
    const s = headSlice(y);
    return { y, rx: s.rx + lift - inset, rz: s.rz + lift - inset, cz: s.cz, color: SCARF };
  };
  // 위아래 가장자리는 안으로 접어 천 두께가 보인다
  const wrap = revolve([ring(1.195, 0.006), ring(1.196), ring(1.215), ring(1.235), ring(1.255), ring(1.274), ring(1.275, 0.006)], 28);
  // 뒤통수 오른쪽에서 묶은 매듭과 짧은 두 가닥
  const phi = Math.PI + 0.5;
  const s = headSlice(1.22);
  const at = new THREE.Vector3(Math.sin(phi) * (s.rx + lift + 0.012), 1.22, s.cz + Math.cos(phi) * (s.rz + lift + 0.012));
  const knot = new THREE.SphereGeometry(0.026, 10, 7).scale(1.2, 1, 0.75).rotateY(phi).translate(at.x, at.y, at.z);
  const tails = [-1, 1].map((side) =>
    new THREE.SphereGeometry(1, 8, 6)
      .scale(0.02, 0.055, 0.007)
      .rotateZ(side * 0.35)
      .translate(side * 0.022, -0.045, -0.004)
      .rotateY(phi)
      .translate(at.x, at.y, at.z),
  );
  return [wrap, paint(knot, SCARF), ...tails.map((g) => paint(g, SCARF))];
}

function head(): THREE.BufferGeometry[] {
  const b = new Batch(77);
  b.sphere(0.22, [0, 1.12, 0], SKIN, {}, [1, 1.02, 0.98], [18, 12]);
  b.sphere(0.226, [0, 1.17, -0.035], HAIR, {}, [1, 0.9, 1], [16, 8]);
  // 쪽: 목덜미에 틀어 올린 머리와 가로지른 비녀 (머리 쪽 끝이 동그랗다)
  b.sphere(0.088, [0, 1.07, -0.235], HAIR, {}, [1.15, 0.9, 1], [12, 8]);
  b.cylinder(0.008, 0.008, 0.27, 6, [0.01, 1.075, -0.25], BINYEO, { rz: Math.PI / 2 });
  b.sphere(0.017, [0.145, 1.075, -0.25], BINYEO, {}, [1, 1, 1], [8, 6]);
  // 눈웃음과 볼
  for (const s of [-1, 1]) {
    b.add(new THREE.TorusGeometry(0.03, 0.008, 4, 8, Math.PI), 0x2a1a14, [s * 0.075, 1.125, 0.205], { rz: 0 });
    b.sphere(0.036, [s * 0.125, 1.065, 0.185], 0xf2a79a, {}, [1, 0.7, 0.4], [8, 5]);
  }
  b.add(new THREE.TorusGeometry(0.045, 0.008, 4, 10, Math.PI), 0x9a3a32, [0, 1.065, 0.215], { rz: Math.PI });
  const g = b.build();
  if (!g) throw new Error('jumak: 주모 얼굴을 만들지 못했어요');
  return [g, ...scarf()];
}

function buildBody(): THREE.BufferGeometry {
  return mergeParts([chimaJeogori(), ...collar(), ...apron(), ...goreum(), ...toes(), ...head()], true);
}

// ---- 소매: 어깨에서 넓어졌다가 소맷부리로 둥글게 좁아지는 배래, 자주 끝동 ----
// 원점이 어깨, 아래(-y)로 늘어진다. 손님 소매처럼 뒤쪽 아래가 불룩해서, 팔을 앞으로 들면 배래가 아래로 처진다
const SLEEVE_RINGS: readonly Ring[] = [
  { y: 0.045, rx: 0.0, color: JACKET },
  { y: 0.038, rx: 0.034, rz: 0.038, color: JACKET },
  { y: 0.018, rx: 0.05, rz: 0.055, color: JACKET },
  { y: -0.03, rx: 0.056, rz: 0.064, cz: -0.004, color: JACKET },
  { y: -0.1, rx: 0.059, rz: 0.074, cz: -0.012, color: JACKET },
  { y: -0.17, rx: 0.06, rz: 0.082, cz: -0.019, color: JACKET },
  { y: -0.23, rx: 0.058, rz: 0.083, cz: -0.022, color: JACKET },
  { y: -0.27, rx: 0.054, rz: 0.074, cz: -0.017, color: JACKET },
  { y: -0.286, rx: 0.052, rz: 0.068, cz: -0.013, color: JACKET },
  // 끝동: 소맷부리에 두른 자주 단
  { y: -0.2862, rx: 0.052, rz: 0.068, cz: -0.013, color: JAJU },
  { y: -0.305, rx: 0.049, rz: 0.058, cz: -0.008, color: JAJU },
  { y: -0.322, rx: 0.045, rz: 0.05, cz: -0.004, color: JAJU },
  { y: -0.328, rx: 0.041, rz: 0.045, cz: -0.003, color: JAJU },
  // 소맷부리 안쪽 (위로 접혀 들어가 손목을 감싼다)
  { y: -0.3278, rx: 0.037, rz: 0.041, cz: -0.003, color: JACKET_SHADE },
  { y: -0.315, rx: 0.032, rz: 0.035, cz: -0.002, color: JACKET_SHADE },
  { y: -0.29, rx: 0.0, color: JACKET_SHADE },
];

/** 팔 한 짝: 원점이 어깨, 아래(-y)로 늘어진 소매와 손, 그리고 손에 든 도구 */
function buildArm(tool: 'ladle' | 'spatula'): THREE.BufferGeometry {
  // 단면은 어깨에서 소맷부리로 적었지만, 바깥을 보는 면이 되도록 아래에서 위로 돌린다
  const sleeve = revolve([...SLEEVE_RINGS].reverse(), 18);
  const b = new Batch(tool === 'ladle' ? 78 : 79);
  b.sphere(0.045, [0, -0.36, 0], SKIN, {}, [1, 1, 1], [8, 6]);
  if (tool === 'ladle') {
    // 국자: 손에서 아래로 긴 자루, 끝에 둥근 국자
    b.cylinder(0.012, 0.012, 0.42, 6, [0, -0.57, 0.01], 0x8a5e36);
    b.sphere(0.055, [0, -0.79, 0.02], 0xb9b9bd, {}, [1, 0.6, 1], [8, 5]);
  } else {
    // 뒤집개: 짧은 자루와 넓적한 쇠날
    b.cylinder(0.011, 0.011, 0.24, 6, [0, -0.5, 0.01], 0x8a5e36);
    b.box([0.11, 0.012, 0.13], [0, -0.63, 0.04], 0x9a9aa0);
  }
  const hand = b.build();
  if (!hand) throw new Error('jumak: 주모 팔을 만들지 못했어요');
  return mergeParts([sleeve, hand], true);
}

/** 번철 위에서 뒤집히는 전 한 장 */
function buildJeon(): THREE.BufferGeometry {
  const b = new Batch(80);
  b.cylinder(0.075, 0.075, 0.016, 12, [0, 0, 0], 0xd99a3a, { jitter: 0.12 });
  // 위에 올린 파와 고추
  b.box([0.09, 0.004, 0.012], [0, 0.01, 0.01], 0x4f8a3a, { ry: 0.4 });
  b.box([0.06, 0.004, 0.01], [0.01, 0.01, -0.02], 0xb8281c, { ry: -0.6 });
  const g = b.build();
  if (!g) throw new Error('jumak: 전을 만들지 못했어요');
  return g;
}

// ---- 부엌일 순서 ----

/** 주모가 서는 곳 (부엌일을 할 때는 부뚜막 앞으로 간다) */
export const JUMO_SPOTS = {
  home: { x: JUMO.x, z: JUMO.z },
  pot: { x: JUMO.stoveX - 0.25, z: -4.95 },
  griddle: { x: JUMO.stoveX + 0.42, z: -4.95 },
} as const;
type SpotId = keyof typeof JUMO_SPOTS;

/** 번철 위 전이 놓인 곳 (build.ts의 번철과 같은 자리) */
export const GRIDDLE = { x: JUMO.stoveX + 0.4, y: 0.7, z: JUMO.stoveZ + 0.02 } as const;

type Task =
  | { kind: 'walk'; to: SpotId }
  | { kind: 'stir'; dur: number }
  | { kind: 'flip'; dur: number }
  | { kind: 'scoop'; dur: number }
  | { kind: 'watch'; dur: number };

/** 한 바퀴: 국 젓기 -> 전 뒤집기 -> 국 뜨기 -> 제자리에서 TV 보기 */
export const JUMO_ROUTINE: readonly Task[] = [
  { kind: 'walk', to: 'pot' },
  { kind: 'stir', dur: 10 },
  { kind: 'walk', to: 'griddle' },
  { kind: 'flip', dur: 8 },
  { kind: 'walk', to: 'pot' },
  { kind: 'scoop', dur: 5 },
  { kind: 'walk', to: 'home' },
  { kind: 'watch', dur: 7 },
];

/** 부뚜막을 볼 때의 방향(-z)과 제자리에서 TV를 볼 때의 방향 */
const FACE_STOVE = Math.PI;
const FACE_TV = Math.atan2(0 - JUMO.x, -6.1 - JUMO.z);
const WALK_SPEED = 0.9;
/** 전을 뒤집는 간격과 걸리는 시간(초) */
const FLIP_EVERY = 2.6;
const FLIP_TIME = 0.45;

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** 팔 각도: fwd 앞으로 든 정도, out 바깥으로 벌린 정도(라디안) */
interface ArmPose {
  fwd: number;
  out: number;
}

/** 지금 하는 일에서 두 팔과 몸의 모양 (순수 계산이라 시험하기 쉽다) */
export function workPose(
  kind: Task['kind'],
  t: number,
  reduced: boolean,
): { right: ArmPose; left: ArmPose; lean: number; flip: number } {
  const calm = reduced ? 0.3 : 1;
  switch (kind) {
    case 'stir': {
      // 오른손 국자로 솥 안을 빙빙 젓는다
      const w = 2 * Math.PI * 0.75 * t;
      return {
        right: { fwd: 1.3 + 0.16 * calm * Math.sin(w), out: 0.05 + 0.18 * calm * Math.cos(w) },
        left: { fwd: 0.5, out: 0.15 },
        lean: 0.12,
        flip: -1,
      };
    }
    case 'flip': {
      // 왼손 뒤집개로 전을 밀어 넣었다가 휙 뒤집는다
      const cycle = t % FLIP_EVERY;
      const p = cycle < FLIP_TIME ? cycle / FLIP_TIME : -1;
      const flick = p >= 0 ? Math.sin(Math.PI * p) : 0;
      return {
        right: { fwd: 0.4, out: 0.12 },
        left: { fwd: 1.2 + 0.35 * flick * calm, out: -0.05 },
        lean: 0.1,
        flip: p,
      };
    }
    case 'scoop': {
      // 국자로 떠서 들어 올리기를 되풀이
      const s = (Math.sin(2 * Math.PI * 0.45 * t - Math.PI / 2) + 1) / 2;
      return { right: { fwd: 1.35 - 0.55 * s * calm, out: 0.05 }, left: { fwd: 0.6, out: 0.1 }, lean: 0.1, flip: -1 };
    }
    case 'watch':
      return { right: { fwd: 0.15, out: 0.12 }, left: { fwd: 0.35, out: 0.08 }, lean: 0, flip: -1 };
    default:
      return { right: { fwd: 0.1, out: 0.12 }, left: { fwd: 0.1, out: 0.12 }, lean: 0.04, flip: -1 };
  }
}

export class JumoRig {
  readonly group = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly armR: THREE.Mesh;
  private readonly armL: THREE.Mesh;
  private readonly jeon: THREE.Mesh;
  private readonly geos: THREE.BufferGeometry[];
  private readonly mat = new THREE.MeshLambertMaterial({ vertexColors: true });

  private step = 0;
  private taskT = 0;
  private x: number = JUMO_SPOTS.home.x;
  private z: number = JUMO_SPOTS.home.z;
  private yaw: number = FACE_TV;
  private walkPhase = 0;
  private time = 0;
  private reply = -1;
  private jeonTurn = 0;
  private lastFlip = -1;
  private readonly arm = { r: { fwd: 0.1, out: 0.12 }, l: { fwd: 0.1, out: 0.12 } };

  constructor() {
    this.geos = [buildBody(), buildArm('ladle'), buildArm('spatula'), buildJeon()];
    this.body = new THREE.Mesh(this.geos[0], this.mat);
    this.armR = new THREE.Mesh(this.geos[1], this.mat);
    this.armL = new THREE.Mesh(this.geos[2], this.mat);
    this.jeon = new THREE.Mesh(this.geos[3], this.mat);
    this.armR.position.set(SHOULDER_X, SHOULDER_Y, 0.02);
    this.armL.position.set(-SHOULDER_X, SHOULDER_Y, 0.02);
    this.body.add(this.armR, this.armL);
    this.group.add(this.body);
    for (const m of [this.body, this.armR, this.armL]) m.castShadow = true;
    this.jeon.position.set(GRIDDLE.x, GRIDDLE.y, GRIDDLE.z);
  }

  /** 번철 위 전 (장면에 따로 넣는다: 주모와 같이 움직이지 않는다) */
  get jeonMesh(): THREE.Mesh {
    return this.jeon;
  }

  /** 지금 서 있는 곳 (말풍선 자리) */
  get position(): { x: number; z: number } {
    return { x: this.x, z: this.z };
  }

  /** 대답한다: 손님 쪽을 보며 폴짝, 손을 든다 */
  react(): void {
    this.reply = 0;
  }

  update(dt: number, reduced: boolean): void {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    const task = JUMO_ROUTINE[this.step]!;
    let targetYaw = this.yaw;
    let moving = false;

    if (task.kind === 'walk') {
      const to = JUMO_SPOTS[task.to];
      const dx = to.x - this.x;
      const dz = to.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.02) {
        this.x = to.x;
        this.z = to.z;
        this.next();
      } else {
        const stepLen = Math.min(d, WALK_SPEED * dt);
        this.x += (dx / d) * stepLen;
        this.z += (dz / d) * stepLen;
        targetYaw = Math.atan2(dx, dz);
        moving = true;
        this.walkPhase += dt * 9;
      }
    } else {
      this.taskT += dt;
      targetYaw = task.kind === 'watch' ? FACE_TV + 0.35 * Math.sin(this.time * 0.4) : FACE_STOVE;
      if (this.taskT >= task.dur) this.next();
    }

    // 대답하는 동안은 손님 쪽(방 한가운데)을 본다
    let hop = 0;
    let replyArm = 0;
    if (this.reply >= 0) {
      this.reply += dt;
      const p = this.reply / 1.4;
      if (p >= 1) this.reply = -1;
      else {
        targetYaw = JUMO.yaw;
        replyArm = Math.sin(Math.PI * Math.min(1, p * 1.4));
        if (!reduced) hop = 0.06 * Math.abs(Math.sin(Math.PI * 2 * Math.min(1, p * 1.6)));
      }
    }

    const turn = 1 - Math.exp(-(reduced ? 5 : 7) * dt);
    this.yaw += wrapAngle(targetYaw - this.yaw) * turn;

    const cur = JUMO_ROUTINE[this.step]!;
    const pose = workPose(moving ? 'walk' as Task['kind'] : cur.kind === 'walk' ? 'watch' : cur.kind, this.taskT, reduced);
    if (moving) {
      const swing = (reduced ? 0.1 : 0.35) * Math.sin(this.walkPhase);
      pose.right = { fwd: 0.1 + swing, out: 0.12 };
      pose.left = { fwd: 0.1 - swing, out: 0.12 };
    }
    if (replyArm > 0) pose.right = { fwd: pose.right.fwd + (2.6 - pose.right.fwd) * replyArm, out: 0.3 * replyArm + pose.right.out * (1 - replyArm) };
    const k = 1 - Math.exp(-10 * dt);
    this.arm.r.fwd += (pose.right.fwd - this.arm.r.fwd) * k;
    this.arm.r.out += (pose.right.out - this.arm.r.out) * k;
    this.arm.l.fwd += (pose.left.fwd - this.arm.l.fwd) * k;
    this.arm.l.out += (pose.left.out - this.arm.l.out) * k;
    this.armR.rotation.set(-this.arm.r.fwd, 0, this.arm.r.out);
    this.armL.rotation.set(-this.arm.l.fwd, 0, -this.arm.l.out);

    // 몸: 걸을 때 통통, 일할 때 앞으로 살짝 숙임, 숨쉬기
    const bob = moving && !reduced ? 0.025 * Math.abs(Math.sin(this.walkPhase)) : 0;
    const breathe = reduced ? 0 : Math.sin(this.time * 1.7) * 0.008;
    this.group.position.set(this.x, hop + bob, this.z);
    this.group.rotation.set(0, this.yaw, 0);
    this.body.rotation.x = pose.lean * (this.reply >= 0 ? 0 : 1);
    this.body.scale.y = 1 + breathe;

    // 전 뒤집기: 뒤집개가 휙 올라갈 때 전이 폴짝 뛰며 반 바퀴 돈다
    if (cur.kind === 'flip' && pose.flip >= 0) {
      if (this.lastFlip < 0) this.jeonTurn += Math.PI;
      const from = this.jeonTurn - Math.PI;
      this.jeon.position.y = GRIDDLE.y + (reduced ? 0.03 : 0.14) * Math.sin(Math.PI * pose.flip);
      this.jeon.rotation.x = from + Math.PI * pose.flip;
    } else {
      this.jeon.position.y = GRIDDLE.y;
      this.jeon.rotation.x = this.jeonTurn;
    }
    this.lastFlip = cur.kind === 'flip' ? pose.flip : -1;
  }

  private next(): void {
    this.step = (this.step + 1) % JUMO_ROUTINE.length;
    this.taskT = 0;
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    this.mat.dispose();
  }
}
