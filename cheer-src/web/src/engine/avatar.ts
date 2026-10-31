// 기본 도형 캐릭터: 둥근 머리(구) + 몸통(캡슐). 외부 3D 파일은 쓰지 않는다.
// 공간의 옷이 몸통, 팔, 발 모양을 직접 만들 수도 있다(OutfitSpec.body/arm/foot, 예: 주막 한복).
// 같은 분할 수의 캐릭터는 geometry와 material을 공유한다(인스턴싱으로 가기 쉬운 구조).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ActionMotion } from './types';

// ---- 크기 (미터). 작고 귀여운 비율: 머리가 몸통만큼 크다 ----
const BODY_RADIUS = 0.2;
const BODY_LENGTH = 0.22; // 캡슐 가운데 직선 부분
export const BODY_HEIGHT = BODY_LENGTH + BODY_RADIUS * 2; // 0.62
const HEAD_RADIUS = 0.27;
const HEAD_RISE = 0.2; // 몸통 위끝에서 머리 중심까지

export const AVATAR_HEIGHT = BODY_HEIGHT + HEAD_RISE + HEAD_RADIUS;

// ---- 팔 ----
/** 팔(어깨에서 손 중심까지) 길이, 소매 굵기, 손 크기 */
const ARM_LENGTH = 0.2;
const ARM_RADIUS = 0.046;
const HAND_RADIUS = 0.052;
/** 어깨 자리 (몸통 바닥 기준. 왼팔 x<0) */
const SHOULDER_X = 0.2;
const SHOULDER_Y = 0.4;
const SHOULDER_Z = 0.01;

// ---- 분할 수 ----
export type AvatarDetail = 'self' | 'peer';

export interface AvatarDetailOptions {
  headWidthSegments: number;
  headHeightSegments: number;
  bodyRadialSegments: number;
  bodyCapSegments: number;
  eyeSegments: number;
}

/** 내 캐릭터는 곱게, 남의 캐릭터는 거칠게. 숫자만 바꿔 직접 지정할 수도 있다. */
export const DETAIL_PRESETS: Record<AvatarDetail, AvatarDetailOptions> = {
  self: { headWidthSegments: 32, headHeightSegments: 20, bodyRadialSegments: 20, bodyCapSegments: 8, eyeSegments: 10 },
  // 다른 사람은 인스턴싱으로 한 번에 그리니 분할을 조금 넉넉히 둬도 부담이 적다(24명 약 7천 삼각형)
  peer: { headWidthSegments: 16, headHeightSegments: 10, bodyRadialSegments: 12, bodyCapSegments: 3, eyeSegments: 6 },
};

// ---- 옷 ----
export interface AccessorySpec {
  /** 같은 key와 분할 수면 geometry를 공유한다 */
  key: string;
  attach: 'head' | 'body';
  create: (detail: AvatarDetailOptions) => THREE.BufferGeometry;
  color: number;
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  /** 이 소품을 쓰는 차림 번호들(OutfitSpec.looks 중). 없으면 모든 차림이 쓴다 */
  looks?: number[];
  /** 높이 솟은 소품(갓 등). 카메라가 내 머리 높이까지 내려오면 내 화면에서만 감춰 시야를 가리지 않는다 */
  tall?: boolean;
  /**
   * 정점 색(color 속성)을 쓴다. 여러 색 조각을 한 소품으로 합쳐 그리기 호출을 줄일 때 쓴다.
   * 이때 color는 정점 색에 곱해지는 색이라 보통 흰색(0xffffff)이다. 정점 색이 없는 geometry는 흰색으로 칠한다
   */
  vertexColors?: boolean;
}

/** 옷이 직접 만드는 몸 부위 geometry. 정점 색(color 속성)을 쓰며 재질 색(bodyColor)과 곱해진다(없으면 흰색으로 칠한다) */
export type OutfitPart = (detail: AvatarDetailOptions) => THREE.BufferGeometry;

export interface OutfitSpec {
  id: string;
  bodyColor: number;
  skinColor: number;
  accessories?: AccessorySpec[];
  /** 차림 가짓수. 사람 번호로 하나를 고른다(번호 % looks). 없으면 1 */
  looks?: number;
  /**
   * 기본 캡슐 대신 쓰는 몸통. 바닥이 y=0, 앞이 +z, 꼭대기가 BODY_HEIGHT 안팎이고 어깨(±0.2, 0.4)에 팔이 붙는다.
   * 앉으면 기본 몸통처럼 눌린다. 모든 차림이 같이 쓴다(차림마다 다른 것은 소품으로)
   */
  body?: OutfitPart;
  /** 기본 소매 대신 쓰는 팔 한 짝. 원점이 어깨이고 아래(-y)로 늘어지며, 손은 y=-0.2에 붙는다 */
  arm?: OutfitPart;
  /** 기본 발 대신 쓰는 발 한 짝. 원점이 발 중심, 앞이 +z */
  foot?: OutfitPart;
}

/** 사람 번호 -> 차림 번호. 같은 번호면 누구 화면에서나 같은 차림이다 */
export function lookFor(outfit: OutfitSpec, id: number): number {
  const n = Math.max(1, Math.floor(outfit.looks ?? 1));
  return ((Math.floor(id) % n) + n) % n;
}

/** 그 차림에서 이 소품이 보이는가 */
export function accessoryShown(acc: AccessorySpec, look: number): boolean {
  return !acc.looks || acc.looks.includes(look);
}

/** 1단계 기본형: 회색 */
export const PLAIN_OUTFIT: OutfitSpec = { id: 'plain', bodyColor: 0x8e8e93, skinColor: 0xd1d1d6 };

const outfits = new Map<string, OutfitSpec>([[PLAIN_OUTFIT.id, PLAIN_OUTFIT]]);

/** 공간이 자기 옷을 등록한다. SpaceDefinition.avatarOutfit이 이 id를 가리킨다. */
export function registerOutfit(spec: OutfitSpec): void {
  outfits.set(spec.id, spec);
}

export function getOutfit(id: string): OutfitSpec {
  return outfits.get(id) ?? PLAIN_OUTFIT;
}

// ---- 공유 geometry / material ----
export interface BodyGeometries {
  head: THREE.BufferGeometry;
  body: THREE.BufferGeometry;
  /** 발 한 짝 (원점이 발 중심). 왼발 오른발이 같은 geometry를 나눠 쓰고 걸을 때 따로 움직인다 */
  foot: THREE.BufferGeometry;
  /** 팔 한 짝(소매). 원점이 어깨이고 아래(-y)로 늘어진다. 몸통 색 */
  arm: THREE.BufferGeometry;
  /** 손 한 짝. 원점이 어깨(팔과 같은 기준)이고 팔 끝에 있다. 피부 색 */
  hand: THREE.BufferGeometry;
}

const geometryCache = new Map<string, BodyGeometries>();
/** 옷이 만든 몸 부위: 만드는 함수 -> 분할 수 -> geometry */
const outfitPartCache = new Map<OutfitPart, Map<string, THREE.BufferGeometry>>();
const accessoryGeometryCache = new Map<string, THREE.BufferGeometry>();
const materialCache = new Map<string, THREE.MeshLambertMaterial>();

function detailKey(d: AvatarDetailOptions): string {
  return [d.headWidthSegments, d.headHeightSegments, d.bodyRadialSegments, d.bodyCapSegments, d.eyeSegments].join('-');
}

/** 정점 색을 한 가지로 채운다 (눈을 머리 geometry에 합쳐 그리기 호출을 줄이려고) */
function paintVertices(g: THREE.BufferGeometry, shade: number): THREE.BufferGeometry {
  const count = g.getAttribute('position').count;
  const colors = new Float32Array(count * 3).fill(shade);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('avatar geometry merge failed');
  for (const p of parts) p.dispose();
  return merged;
}

function buildGeometries(d: AvatarDetailOptions): BodyGeometries {
  // 머리 + 눈 두 개(어두운 정점 색). 앞은 +z
  const head = paintVertices(new THREE.SphereGeometry(HEAD_RADIUS, d.headWidthSegments, d.headHeightSegments), 1);
  const eyes = [-1, 1].map((side) =>
    paintVertices(new THREE.SphereGeometry(0.036, d.eyeSegments, Math.max(3, d.eyeSegments - 2)), 0.1).translate(
      side * 0.095,
      0.035,
      0.248,
    ),
  );
  // 몸통. 바닥이 y=0
  const body = paintVertices(
    new THREE.CapsuleGeometry(BODY_RADIUS, BODY_LENGTH, d.bodyCapSegments, d.bodyRadialSegments),
    1,
  ).translate(0, BODY_HEIGHT / 2, 0);
  // 발 한 짝(조금 어두운 정점 색). 걸을 때 따로 움직이도록 몸통과 합치지 않고, 원점에 둔다
  const foot = paintVertices(new THREE.SphereGeometry(0.07, d.eyeSegments + 2, Math.max(3, d.eyeSegments - 2)), 0.55).scale(
    1,
    0.6,
    1.3,
  );
  // 팔(소매)과 손. 어깨에서 아래로 늘어진 모양이고, 어깨를 축으로 돌린다
  const arm = paintVertices(
    new THREE.CapsuleGeometry(ARM_RADIUS, ARM_LENGTH - ARM_RADIUS * 2, Math.max(2, d.bodyCapSegments - 2), Math.max(6, d.bodyRadialSegments - 6)),
    0.94,
  ).translate(0, -ARM_LENGTH / 2 + ARM_RADIUS * 0.4, 0);
  const hand = paintVertices(new THREE.SphereGeometry(HAND_RADIUS, d.eyeSegments + 2, Math.max(4, d.eyeSegments - 1)), 1).translate(
    0,
    -ARM_LENGTH,
    0,
  );
  return { head: merge([head, ...eyes]), body, foot, arm, hand };
}

/** 정점 색이 없으면 흰색으로 칠한다 (정점 색을 쓰는 재질에서 검게 나오지 않게) */
function ensureVertexColors(g: THREE.BufferGeometry): THREE.BufferGeometry {
  return g.getAttribute('color') ? g : paintVertices(g, 1);
}

function getOutfitPart(create: OutfitPart, d: AvatarDetailOptions): THREE.BufferGeometry {
  let byDetail = outfitPartCache.get(create);
  if (!byDetail) {
    byDetail = new Map();
    outfitPartCache.set(create, byDetail);
  }
  const key = detailKey(d);
  let g = byDetail.get(key);
  if (!g) {
    g = ensureVertexColors(create(d));
    byDetail.set(key, g);
  }
  return g;
}

/**
 * 같은 분할 수의 머리와 몸통 geometry (공유). 인스턴싱으로 한꺼번에 그릴 때도 이걸 쓴다.
 * 옷이 몸통, 팔, 발을 직접 만들면(OutfitSpec.body/arm/foot) 그것으로 바꿔 끼운다. 없으면 기본 캡슐 몸통
 */
export function getAvatarGeometries(d: AvatarDetailOptions, outfit?: OutfitSpec): BodyGeometries {
  const key = detailKey(d);
  let g = geometryCache.get(key);
  if (!g) {
    g = buildGeometries(d);
    geometryCache.set(key, g);
  }
  if (!outfit || (!outfit.body && !outfit.arm && !outfit.foot)) return g;
  return {
    ...g,
    body: outfit.body ? getOutfitPart(outfit.body, d) : g.body,
    arm: outfit.arm ? getOutfitPart(outfit.arm, d) : g.arm,
    foot: outfit.foot ? getOutfitPart(outfit.foot, d) : g.foot,
  };
}

/** 같은 색은 하나를 나눠 쓰는 재질 */
export function getAvatarMaterial(color: number, vertexColors: boolean): THREE.MeshLambertMaterial {
  const key = `${color}:${vertexColors ? 1 : 0}`;
  let m = materialCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, vertexColors });
    materialCache.set(key, m);
  }
  return m;
}

/** 옷의 소품 geometry (같은 key와 분할 수면 공유) */
export function getAccessoryGeometry(acc: AccessorySpec, d: AvatarDetailOptions): THREE.BufferGeometry {
  const cacheKey = `${acc.key}|${detailKey(d)}`;
  let geometry = accessoryGeometryCache.get(cacheKey);
  if (!geometry) {
    geometry = acc.create(d);
    if (acc.vertexColors) ensureVertexColors(geometry);
    accessoryGeometryCache.set(cacheKey, geometry);
  }
  return geometry;
}

/** 소품의 재질 (정점 색을 쓰는 소품이면 정점 색 재질) */
export function getAccessoryMaterial(acc: AccessorySpec): THREE.MeshLambertMaterial {
  return getAvatarMaterial(acc.color, acc.vertexColors ?? false);
}

/** 엔진이 끝날 때 공유 자원을 한꺼번에 놓는다 */
export function disposeAvatarResources(): void {
  for (const g of geometryCache.values()) {
    g.head.dispose();
    g.body.dispose();
    g.foot.dispose();
    g.arm.dispose();
    g.hand.dispose();
  }
  for (const byDetail of outfitPartCache.values()) for (const g of byDetail.values()) g.dispose();
  for (const g of accessoryGeometryCache.values()) g.dispose();
  for (const m of materialCache.values()) m.dispose();
  geometryCache.clear();
  outfitPartCache.clear();
  accessoryGeometryCache.clear();
  materialCache.clear();
}

// ---- 동작 몸짓 ----
interface MotionSpec {
  duration: number;
  hops: number;
  height: number;
  spin: number;
  /** 좌우로 기우는 최대 각(라디안)과 흔들리는 횟수(0.5면 한쪽으로 한 번 기울었다 돌아온다) */
  roll?: number;
  rollCycles?: number;
  /** 앞(+)이나 뒤(-)로 기우는 최대 각(라디안)과 횟수 */
  pitch?: number;
  pitchCycles?: number;
  /** 몸통이 위로 늘어나는 정도(0.1이면 10%) */
  stretch?: number;
  /** 뛸 때 눌렸다 늘어나는 세기. 기본 0.06 */
  squash?: number;
}

const MOTIONS: Record<ActionMotion, MotionSpec> = {
  hop: { duration: 0.5, hops: 1, height: 0.3, spin: 0 },
  'hop-double': { duration: 0.8, hops: 2, height: 0.2, spin: 0 },
  'hop-spin': { duration: 0.75, hops: 1, height: 0.36, spin: Math.PI * 2 },
  // 박수: 짧고 빠른 뜀박질 다섯 번, 몸을 살짝 앞뒤로 까딱
  clap: { duration: 0.7, hops: 5, height: 0.07, spin: 0, pitch: 0.09, pitchCycles: 5, squash: 0.05 },
  // 건배: 고개를 들며 한쪽으로 기울이고 한 번 폴짝
  toast: { duration: 0.9, hops: 1, height: 0.14, spin: 0, roll: 0.32, rollCycles: 0.5, pitch: -0.2, pitchCycles: 0.5, squash: 0.04 },
  // 함성: 뒤로 젖히며 위로 쭉 늘어난다
  roar: { duration: 1.0, hops: 1, height: 0.2, spin: 0, pitch: -0.5, pitchCycles: 0.5, stretch: 0.14, squash: 0.04 },
  // 골 순간: 세 번 크게 뛰며 좌우로 흔든다
  celebrate: { duration: 1.6, hops: 3, height: 0.3, spin: 0, roll: 0.2, rollCycles: 3, pitch: -0.15, pitchCycles: 0.5, stretch: 0.05, squash: 0.08 },
};

export interface MotionOffset {
  y: number;
  spin: number;
  squash: number;
  roll: number;
  pitch: number;
  done: boolean;
}

/** 움직임 줄이기에서 기울임에 곱하는 값 (뛰기는 0.35배, 기울임은 이만큼) */
const REDUCED_TILT = 0.3;

/** 동작 시작 후 t초 때의 몸짓. 움직임 줄이기면 낮게 뛰고 돌지 않고 덜 기운다. */
export function motionOffset(motion: ActionMotion, t: number, reduced: boolean): MotionOffset {
  const spec = MOTIONS[motion];
  const p = Math.min(1, Math.max(0, t / spec.duration));
  const height = reduced ? spec.height * 0.35 : spec.height;
  const arc = Math.abs(Math.sin(Math.PI * spec.hops * p));
  const eased = p * p * (3 - 2 * p);
  const tilt = reduced ? REDUCED_TILT : 1;
  const wave = (amp: number | undefined, cycles: number | undefined): number =>
    amp ? amp * tilt * Math.sin(2 * Math.PI * (cycles ?? 0.5) * p) : 0;
  const squashAmp = spec.squash ?? 0.06;
  return {
    y: height * arc,
    spin: reduced ? 0 : spec.spin * eased,
    squash: reduced ? 0 : squashAmp * (arc - 0.35) + (spec.stretch ?? 0) * Math.sin(Math.PI * p),
    roll: wave(spec.roll, spec.rollCycles),
    pitch: wave(spec.pitch, spec.pitchCycles),
    done: t >= spec.duration,
  };
}

// ---- 자세 (내 캐릭터와 인스턴싱으로 그리는 다른 사람 캐릭터가 같이 쓴다) ----
export interface PoseOutput {
  /** 앉을 때 올라가는 높이 (root의 y) */
  rootY: number;
  /** 걷기 통통 튐과 동작 뛰기 (pose 그룹의 y) */
  poseY: number;
  roll: number;
  /** 앞뒤로 기울기 (동작 몸짓) */
  pitch: number;
  spin: number;
  /** 몸통 크기 (가로세로 같은 비율, 세로) */
  bodyScaleXZ: number;
  bodyScaleY: number;
  /** 머리 중심의 높이 (몸통 바닥 기준) */
  headY: number;
  /** 발 위치 (pose 그룹 기준). 왼발은 x=-footX, 오른발은 x=+footX. 크기는 몸통과 같은 비율(bodyScale) */
  footX: number;
  footLY: number;
  footLZ: number;
  footRY: number;
  footRZ: number;
  /** 어깨 자리 (pose 그룹 기준. 왼팔은 x=-shoulderX) */
  shoulderX: number;
  shoulderY: number;
  shoulderZ: number;
  /** 팔 각도(라디안). fwd는 앞으로 든 정도(0 = 늘어뜨림, π/2 = 앞으로 쭉, π = 머리 위), out은 바깥으로 벌린 정도(음수면 안쪽으로 모음) */
  armLFwd: number;
  armLOut: number;
  armRFwd: number;
  armROut: number;
}

/** 팔 한 쌍의 각도 */
export interface ArmPose {
  lf: number;
  lo: number;
  rf: number;
  ro: number;
}

/** 가만히 서 있을 때 팔은 살짝 벌어져 늘어진다 */
const ARM_REST_OUT = 0.22;
/** 앉으면 손을 무릎 위에 올린다 */
const ARM_SEATED_FWD = 0.75;
const ARM_SEATED_OUT = 0.08;

const smooth01 = (x: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/**
 * 동작 중 팔 모양과 그 세기(w, 0~1). 세기만큼 평소 팔(걷기·앉기)과 섞는다.
 * 박수: 두 손을 앞으로 모아 짝짝, 건배: 오른손을 높이 들어 사발을 올림,
 * 외치기(주문): 오른손을 들어 흔들며 부름, 골: 두 팔 번쩍 만세, 뛰기: 팔을 벌린다.
 */
export function motionArms(motion: ActionMotion, t: number, reduced: boolean): ArmPose & { w: number } {
  const spec = MOTIONS[motion];
  const p = Math.min(1, Math.max(0, t / spec.duration));
  // 처음 15%에 들어 올리고 마지막 20%에 내린다
  const w = smooth01(p / 0.15) * smooth01((1 - p) / 0.2);
  const wave = (cycles: number, amp: number): number => (reduced ? 0 : amp * Math.sin(2 * Math.PI * cycles * p));
  switch (motion) {
    case 'clap': {
      // 손이 만났다(-0.95) 벌어졌다(-0.35)를 다섯 번
      const apart = reduced ? 0.5 : 0.5 + 0.5 * Math.cos(2 * Math.PI * spec.hops * p);
      const o = -0.95 + 0.6 * apart;
      return { lf: 1.25, lo: o, rf: 1.25, ro: o, w };
    }
    case 'toast':
      return { lf: 0.35, lo: ARM_REST_OUT, rf: 2.5, ro: 0.05 + wave(0.5, 0.15), w };
    case 'roar':
      return { lf: 0.2, lo: ARM_REST_OUT, rf: 2.75, ro: 0.35 + wave(3, 0.35), w };
    case 'celebrate':
      return { lf: 2.85, lo: 0.45 + wave(3, 0.25), rf: 2.85, ro: 0.45 - wave(3, 0.25), w };
    default: {
      // 뛰기: 뛰는 높이만큼 팔을 벌린다
      const arc = Math.abs(Math.sin(Math.PI * spec.hops * p));
      return { lf: 0.3, lo: 0.6 + 0.5 * arc, rf: 0.3, ro: 0.6 + 0.5 * arc, w };
    }
  }
}

// ---- 걷기 (발 번갈아 내딛기) ----
/** 걷는 빠르기 기준(m/s). 이 속도면 걷는 정도 1. 내 캐릭터의 걷는 빠르기이기도 하다 */
export const WALK_SPEED = 2.6;
/** 이 속도로 걸을 때 한 바퀴(왼발 한 걸음 + 오른발 한 걸음)에 걸리는 시간의 역수(Hz). 1이면 1초에 두 걸음 */
const WALK_CYCLE_HZ = 1;
/** 발이 앞뒤로 흔들리는 폭(한쪽, m)과 앞으로 나올 때 드는 높이(m) */
const WALK_STRIDE = 0.13;
const WALK_LIFT = 0.06;
/** 몸이 통통 튀는 높이(m, 두 걸음에 한 번씩 오르내림), 좌우로 기우는 각, 앞으로 숙이는 각(라디안) */
const WALK_BOB = 0.035;
const WALK_SWAY = 0.06;
const WALK_LEAN = 0.06;
/** 움직임 줄이기: 발 폭과 높이, 통통 튐은 이만큼만, 좌우 기울임과 숙임은 없다 */
const REDUCED_STRIDE = 0.4;
const REDUCED_BOB = 0.25;
/** 발의 기본 자리 (몸통 바닥 기준, 앞은 +z) */
const FOOT_X = 0.09;
const FOOT_Y = 0.035;
const FOOT_Z = 0.08;

/** 한 순간의 걸음. 위상(phase)과 걷는 정도(amount, 0~1)에서 나온다 */
export interface Gait {
  /** 발이 기본 자리에서 앞(+)뒤(-)로 벗어난 거리와 든 높이. 왼발(x<0)과 오른발(x>0) */
  stepL: number;
  liftL: number;
  stepR: number;
  liftR: number;
  /** 몸이 올라간 높이, 좌우로 기운 각(roll), 앞으로 숙인 각(pitch) */
  bob: number;
  sway: number;
  lean: number;
  /** 팔 흔들기(라디안). 왼팔은 -arm, 오른팔은 +arm만큼 앞으로 (발과 엇갈린다) */
  arm: number;
}

export function createGait(): Gait {
  return { stepL: 0, liftL: 0, stepR: 0, liftR: 0, bob: 0, sway: 0, lean: 0, arm: 0 };
}

/** 걸을 때 팔이 앞뒤로 흔들리는 최대 각(라디안) */
const WALK_ARM_SWING = 0.55;

/**
 * 걷기 한 바퀴는 위상 2π. 왼발과 오른발은 반 바퀴(π) 어긋나 번갈아 앞으로 나온다.
 * 발은 앞으로 나오는 동안(위상이 -π/2~π/2)만 들리고, 몸은 두 발이 엇갈리는 순간(위상 0, π)에 가장 높다.
 * amount가 0이면 모든 값이 0이라 가만히 서 있는 모습이다.
 */
export function walkGait(phase: number, amount: number, reduced: boolean, out: Gait = createGait()): Gait {
  const stride = WALK_STRIDE * amount * (reduced ? REDUCED_STRIDE : 1);
  const lift = WALK_LIFT * amount * (reduced ? REDUCED_STRIDE : 1);
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  out.stepL = stride * s;
  out.stepR = -stride * s;
  out.liftL = lift * Math.max(0, c);
  out.liftR = lift * Math.max(0, -c);
  out.bob = WALK_BOB * amount * (reduced ? REDUCED_BOB : 1) * Math.abs(c);
  // 딛고 선 발 쪽으로 몸이 기운다 (왼발이 x<0)
  out.sway = reduced ? 0 : -WALK_SWAY * amount * c;
  out.lean = reduced ? 0 : WALK_LEAN * amount;
  // 왼발이 앞으로 나올 때(sin>0) 오른팔이 앞으로
  out.arm = WALK_ARM_SWING * amount * (reduced ? REDUCED_STRIDE : 1) * s;
  return out;
}

const SIT_SQUASH = 0.86;
/** 앉고 일어나는 데 걸리는 시간 */
const SIT_BLEND_SECONDS = 0.55;
/** 앉고 일어나는 동안 앞으로 숙이는 각(라디안), 앉는 면으로 폴짝 오르는 높이(m) */
const SIT_LEAN = 0.32;
const SIT_HOP = 0.09;
/** 다 앉은 뒤 엉덩이를 붙이며 한 번 꾹 눌리는 깊이(m)와 시간(초), 앉아서 살짝 뒤로 기대는 각 */
const SIT_SETTLE_DEPTH = 0.035;
const SIT_SETTLE_SECONDS = 0.32;
const SIT_RECLINE = -0.05;
/** 앉으면 발은 양반다리처럼 앞 양옆으로 나온다 (몸통 바닥 기준) */
const SEATED_FOOT_X = 0.15;
const SEATED_FOOT_Z = 0.17;
/** 평상에 오르내릴 때 높이가 따라가는 빠르기 (클수록 빨리) */
const GROUND_FOLLOW = 18;

/** 걷는 정도, 앉는 정도, 동작 진행 같은 시간에 따라 변하는 값과 거기서 나오는 자세 */
export class PoseState {
  reduced: boolean;
  seated = false;
  seatY = 0.42;
  /** 0~1. 실제 속도를 WALK_SPEED로 나눈 값. 느리게 움직이면 작은 걸음, 멈추면 0 */
  speedTarget = 0;
  private speed = 0; // 0~1 걷는 정도 (부드럽게 따라감)
  /** 걷기 위상(라디안). 속도에 맞춰 흐르고, 멈춰 있는 동안은 그대로 둔다(이어 걸을 때 발이 튀지 않게) */
  private walkPhase = Math.random() * Math.PI * 2;
  private readonly gait = createGait();
  private breathePhase = Math.random() * Math.PI * 2;
  private seatBlend = 0;
  /** 다 앉은 뒤 지난 시간(초). 엉덩이를 붙이는 꾹 눌림에 쓴다. 서 있으면 Infinity */
  private settleT = Infinity;
  /** 서 있는 바닥의 높이(목표)와 지금 높이 */
  groundY = 0;
  private ground = 0;
  /** t가 0보다 작으면 시작을 기다리는 중 */
  private motion: { name: ActionMotion; t: number } | null = null;

  constructor(reduced = false) {
    this.reduced = reduced;
  }

  /** delay초 뒤에 시작한다 (여럿이 한꺼번에 하되 칼같이 같지는 않게) */
  playMotion(name: ActionMotion, delay = 0): void {
    this.motion = { name, t: -Math.max(0, delay) };
  }

  /** 서 있는 바닥 높이로 바로 간다 (처음 나타났을 때) */
  snapGround(y: number): void {
    this.groundY = y;
    this.ground = y;
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-12 * dt);
    this.speed += (Math.min(1, Math.max(0, this.speedTarget)) - this.speed) * k;
    // 느리게 걸으면 걸음도 느려진다. 자연스러운 걸음(1초에 두 걸음)보다 빨라지지는 않는다
    if (this.speed > 0.02) this.walkPhase += dt * Math.PI * 2 * WALK_CYCLE_HZ * (0.5 + this.speed * 0.5);
    this.breathePhase += dt * 1.8;
    this.ground += (this.groundY - this.ground) * (1 - Math.exp(-GROUND_FOLLOW * dt));
    const blendStep = dt / SIT_BLEND_SECONDS;
    const wasSeated = this.seatBlend >= 1;
    this.seatBlend = this.seated
      ? Math.min(1, this.seatBlend + blendStep)
      : Math.max(0, this.seatBlend - blendStep);
    if (this.seatBlend >= 1) this.settleT = wasSeated ? this.settleT + dt : 0;
    else this.settleT = Infinity;
    if (this.motion) {
      this.motion.t += dt;
      if (this.motion.t >= MOTIONS[this.motion.name].duration) this.motion = null;
    }
  }

  /** 앉은 자세로 바로 간다 (처음 들어왔을 때 이미 앉아 있던 사람) */
  snapSeated(on: boolean): void {
    this.seated = on;
    this.seatBlend = on ? 1 : 0;
    this.settleT = Infinity;
  }

  compute(): PoseOutput {
    const m = this.motion && this.motion.t >= 0 ? motionOffset(this.motion.name, this.motion.t, this.reduced) : null;
    const breathe = this.reduced ? 0 : Math.sin(this.breathePhase) * 0.012;
    const seat = this.seatBlend * this.seatBlend * (3 - 2 * this.seatBlend);
    // 앉고 일어나는 중: 앞으로 숙이며 앉는 면으로 폴짝 올랐다가 내려앉는다(일어날 때는 거꾸로)
    const moving = this.seatBlend > 0 && this.seatBlend < 1 ? Math.sin(Math.PI * this.seatBlend) : 0;
    const tm = this.reduced ? REDUCED_TILT : 1;
    const sitLean = SIT_LEAN * tm * moving + SIT_RECLINE * tm * seat;
    const sitHop = SIT_HOP * (this.reduced ? 0.35 : 1) * moving;
    // 다 앉은 직후: 엉덩이를 붙이며 한 번 꾹 눌렸다 돌아온다
    const settle =
      !this.reduced && this.settleT < SIT_SETTLE_SECONDS ? Math.sin((Math.PI * this.settleT) / SIT_SETTLE_SECONDS) : 0;
    // 앉아 있으면 발은 가만히 있는다 (앉는 정도만큼 걸음이 사그라든다)
    const g = walkGait(this.walkPhase, this.speed * (1 - seat), this.reduced, this.gait);
    // 앉으면 몸통이 살짝 눌리고, 뛸 때는 늘고 줄어든다
    const sy = (1 - (1 - SIT_SQUASH) * seat - 0.06 * settle) * (1 + (m?.squash ?? 0) + breathe);
    const sxz = 1 + (1 - sy) * 0.4;
    const footX = (FOOT_X + (SEATED_FOOT_X - FOOT_X) * seat) * sxz;
    const footLZ = (FOOT_Z + (SEATED_FOOT_Z - FOOT_Z) * seat) * sxz + g.stepL;
    const footRZ = (FOOT_Z + (SEATED_FOOT_Z - FOOT_Z) * seat) * sxz + g.stepR;
    // 팔: 평소(서 있음/걷기)와 앉은 자세를 섞고, 동작 중이면 동작 팔과 섞는다
    const restOut = ARM_REST_OUT + (ARM_SEATED_OUT - ARM_REST_OUT) * seat + breathe * 0.6;
    const restFwd = ARM_SEATED_FWD * seat;
    let lf = restFwd - g.arm;
    let rf = restFwd + g.arm;
    let lo = restOut;
    let ro = restOut;
    if (this.motion && this.motion.t >= 0) {
      const a = motionArms(this.motion.name, this.motion.t, this.reduced);
      lf += (a.lf - lf) * a.w;
      rf += (a.rf - rf) * a.w;
      lo += (a.lo - lo) * a.w;
      ro += (a.ro - ro) * a.w;
    }
    return {
      // 앉으면 앉는 면 높이로, 서 있으면 서 있는 바닥 높이로 (그 사이는 앉는 정도로 섞는다)
      rootY: this.ground * (1 - seat) + this.seatY * seat,
      poseY: g.bob + (m?.y ?? 0) + sitHop - SIT_SETTLE_DEPTH * settle,
      roll: g.sway + (m?.roll ?? 0),
      pitch: g.lean + (m?.pitch ?? 0) + sitLean,
      spin: m?.spin ?? 0,
      bodyScaleXZ: sxz,
      bodyScaleY: sy,
      headY: BODY_HEIGHT * sy + HEAD_RISE,
      // 발은 땅을 딛고 있으니, 걸을 때 몸이 튀고(bob) 숙고(lean) 기우는(sway) 만큼은 덜어 낸다 (뛰기 몸짓은 그대로 함께 뜬다)
      footX,
      footLY: FOOT_Y * sy + SIT_SETTLE_DEPTH * settle + g.liftL - g.bob + footLZ * g.lean + footX * g.sway,
      footLZ,
      footRY: FOOT_Y * sy + SIT_SETTLE_DEPTH * settle + g.liftR - g.bob + footRZ * g.lean - footX * g.sway,
      footRZ,
      shoulderX: SHOULDER_X * sxz,
      shoulderY: SHOULDER_Y * sy,
      shoulderZ: SHOULDER_Z,
      armLFwd: lf,
      armLOut: lo,
      armRFwd: rf,
      armROut: ro,
    };
  }
}

// ---- 캐릭터 ----
export interface AvatarOptions {
  detail?: AvatarDetail | AvatarDetailOptions;
  outfit?: string | OutfitSpec;
  reducedMotion?: boolean;
}

export class Avatar {
  /** 장면에 넣는 것. 위치(x, z)와 바라보는 방향(rotation.y)은 이걸로 정한다 */
  readonly root = new THREE.Group();
  private readonly pose = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly head: THREE.Mesh;
  /** 발 두 짝 (같은 geometry를 나눠 쓰고 걸을 때 따로 움직인다). 왼발이 x<0 */
  private readonly footL: THREE.Mesh;
  private readonly footR: THREE.Mesh;
  /** 팔 두 짝(소매)과 각 팔 끝의 손 (손은 팔의 자식이라 같이 돈다). 왼팔이 x<0 */
  private readonly armL: THREE.Mesh;
  private readonly armR: THREE.Mesh;
  private readonly handL: THREE.Mesh;
  private readonly handR: THREE.Mesh;
  private readonly accessories: THREE.Mesh[] = [];
  private accessorySpecs: AccessorySpec[] = [];
  private outfitSpec: OutfitSpec = PLAIN_OUTFIT;
  private look = 0;
  private tallHidden = false;
  private readonly detail: AvatarDetailOptions;

  private readonly state: PoseState;

  constructor(options: AvatarOptions = {}) {
    const d = options.detail ?? 'peer';
    this.detail = typeof d === 'string' ? DETAIL_PRESETS[d] : d;
    this.state = new PoseState(options.reducedMotion ?? false);
    const geo = getAvatarGeometries(this.detail);
    this.body = new THREE.Mesh(geo.body);
    this.head = new THREE.Mesh(geo.head);
    this.footL = new THREE.Mesh(geo.foot);
    this.footR = new THREE.Mesh(geo.foot);
    this.armL = new THREE.Mesh(geo.arm);
    this.armR = new THREE.Mesh(geo.arm);
    this.handL = new THREE.Mesh(geo.hand);
    this.handR = new THREE.Mesh(geo.hand);
    this.armL.add(this.handL);
    this.armR.add(this.handR);
    for (const m of [this.armL, this.armR, this.handL, this.handR]) m.castShadow = true;
    this.body.castShadow = true;
    this.head.castShadow = true;
    this.footL.castShadow = true;
    this.footR.castShadow = true;
    this.pose.add(this.body, this.head, this.footL, this.footR, this.armL, this.armR);
    this.root.add(this.pose);
    this.setOutfit(options.outfit ?? PLAIN_OUTFIT);
    this.applyPose();
  }

  /** 장면에 올라가는 mesh 개수 (그리기 호출 수 점검용) */
  getMeshes(): THREE.Mesh[] {
    return [this.body, this.head, this.footL, this.footR, ...this.accessories, this.armL, this.armR, this.handL, this.handR];
  }

  get yaw(): number {
    return this.root.rotation.y;
  }

  set yaw(v: number) {
    this.root.rotation.y = v;
  }

  setPosition(x: number, z: number): void {
    this.root.position.x = x;
    this.root.position.z = z;
  }

  /** 옷 색과 소품을 바꾼다 */
  setOutfit(outfit: string | OutfitSpec): void {
    const spec = typeof outfit === 'string' ? getOutfit(outfit) : outfit;
    // 옷이 몸통, 팔, 발을 직접 만들면 그것으로 바꿔 끼운다 (없으면 기본 캡슐 몸통)
    const geo = getAvatarGeometries(this.detail, spec);
    this.body.geometry = geo.body;
    this.footL.geometry = geo.foot;
    this.footR.geometry = geo.foot;
    this.armL.geometry = geo.arm;
    this.armR.geometry = geo.arm;
    this.body.material = getAvatarMaterial(spec.bodyColor, true);
    this.footL.material = this.body.material;
    this.footR.material = this.body.material;
    this.armL.material = this.body.material;
    this.armR.material = this.body.material;
    this.head.material = getAvatarMaterial(spec.skinColor, true);
    this.handL.material = this.head.material;
    this.handR.material = this.head.material;
    for (const m of this.accessories) m.parent?.remove(m);
    this.accessories.length = 0;
    this.outfitSpec = spec;
    this.accessorySpecs = spec.accessories ?? [];
    for (const acc of this.accessorySpecs) {
      const mesh = new THREE.Mesh(getAccessoryGeometry(acc, this.detail), getAccessoryMaterial(acc));
      mesh.position.set(...acc.position);
      if (acc.rotation) mesh.rotation.set(...acc.rotation);
      if (acc.scale) mesh.scale.set(...acc.scale);
      mesh.castShadow = true;
      (acc.attach === 'head' ? this.head : this.body).add(mesh);
      this.accessories.push(mesh);
    }
    this.applyLook();
  }

  /** 내 사람 번호로 차림(갓, 상투 등)을 고른다. 남들 화면에서도 같은 번호로 같은 차림이 된다 */
  setLookFromId(id: number): void {
    this.look = lookFor(this.outfitSpec, id);
    this.applyLook();
  }

  /** 카메라가 머리 바로 뒤로 내려왔을 때 높이 솟은 소품(갓)을 감춘다. 내 캐릭터에만 쓴다 */
  setTallHidden(on: boolean): void {
    if (on === this.tallHidden) return;
    this.tallHidden = on;
    this.applyLook();
  }

  private applyLook(): void {
    this.accessories.forEach((m, i) => {
      const spec = this.accessorySpecs[i]!;
      m.visible = accessoryShown(spec, this.look) && !(this.tallHidden && spec.tall);
    });
  }

  setReducedMotion(on: boolean): void {
    this.state.reduced = on;
  }

  /** 걷는 정도: 0 = 서 있음, 1 = 걷는 빠르기(WALK_SPEED)로 걷는 중. 실제 속도 / WALK_SPEED를 넣으면 발걸음과 통통 튐이 속도에 맞는다 */
  setWalking(amount: number): void {
    this.state.speedTarget = Math.min(1, Math.max(0, amount));
  }

  /** 앉는 자세로 가거나 일어난다. seatY는 앉는 면의 높이 */
  setSeated(on: boolean, seatY = 0.42): void {
    this.state.seated = on;
    if (on) this.state.seatY = seatY;
  }

  isSeated(): boolean {
    return this.state.seated;
  }

  /** '살짝 뛰기' 같은 동작용 몸짓. 걷거나 앉아 있어도 겹쳐서 보인다. delay초 뒤에 시작할 수도 있다. */
  playMotion(name: ActionMotion, delay = 0): void {
    this.state.playMotion(name, delay);
  }

  /** 서 있는 바닥 높이(평상 위면 높다). 걷는 동안 부드럽게 따라가고, 앉으면 앉는 면 높이가 된다 */
  setGround(y: number): void {
    this.state.groundY = y;
  }

  /** 서 있는 바닥 높이로 바로 간다 */
  snapGround(y: number): void {
    this.state.snapGround(y);
  }

  update(dt: number): void {
    this.state.update(dt);
    this.applyPose();
  }

  private applyPose(): void {
    const p = this.state.compute();
    this.root.position.y = p.rootY;
    this.pose.position.y = p.poseY;
    this.pose.rotation.z = p.roll;
    this.pose.rotation.x = p.pitch;
    this.pose.rotation.y = p.spin;
    this.body.scale.set(p.bodyScaleXZ, p.bodyScaleY, p.bodyScaleXZ);
    this.body.position.y = 0;
    this.head.position.y = p.headY;
    this.footL.position.set(-p.footX, p.footLY, p.footLZ);
    this.footR.position.set(p.footX, p.footRY, p.footRZ);
    this.footL.scale.set(p.bodyScaleXZ, p.bodyScaleY, p.bodyScaleXZ);
    this.footR.scale.set(p.bodyScaleXZ, p.bodyScaleY, p.bodyScaleXZ);
    this.armL.position.set(-p.shoulderX, p.shoulderY, p.shoulderZ);
    this.armR.position.set(p.shoulderX, p.shoulderY, p.shoulderZ);
    this.armL.rotation.set(-p.armLFwd, 0, -p.armLOut);
    this.armR.rotation.set(-p.armRFwd, 0, p.armROut);
  }

  /** 장면에서 뗀다. geometry와 material은 공유 중이라 여기서 놓지 않는다 */
  dispose(): void {
    this.root.parent?.remove(this.root);
  }
}
