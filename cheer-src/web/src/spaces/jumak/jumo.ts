// 주모(주막 주인) NPC: 쪽 찐 머리에 흰 두건, 앞치마를 두른 다정한 얼굴.
// 그냥 서 있지 않고 쉬지 않고 부엌일을 한다: 가마솥 국을 휘휘 젓고, 번철에 전을 뒤집고, 국을 뜨고, 잠깐 TV를 본다.
// 주문이 들어오면 하던 일을 멈추고 손님 쪽을 보며 손을 들어 대답한다.
// 몸통 한 덩어리 + 두 팔(어깨를 축으로 돈다) + 뒤집히는 전 하나. 모두 기본 도형이다. 원점은 발 밑 가운데, 앞은 +z.
import * as THREE from 'three';
import { Batch } from './batch';
import { JUMO } from './layout';

const SKIN = 0xf6d7b8;
const HAIR = 0x1b1511;
const SLEEVE = 0xf2dc8f;

/** 어깨 자리 (몸 기준) */
const SHOULDER_Y = 0.92;
const SHOULDER_X = 0.19;

function buildBody(): THREE.BufferGeometry {
  const b = new Batch(77);
  // 치마(남색)와 앞치마(흰색), 저고리(연노랑)와 고름(붉은색)
  b.cylinder(0.2, 0.34, 0.66, 14, [0, 0.33, 0], 0x2d4a86, { jitter: 0.04 });
  b.box([0.3, 0.5, 0.03], [0, 0.34, 0.255], 0xf3efe4, { jitter: 0.03 });
  b.box([0.34, 0.035, 0.05], [0, 0.62, 0.2], 0xe2dccb);
  b.cylinder(0.17, 0.2, 0.3, 12, [0, 0.8, 0], SLEEVE, { jitter: 0.03 });
  b.box([0.05, 0.14, 0.02], [-0.03, 0.78, 0.2], 0xc23b32, { rz: 0.15 });
  b.box([0.05, 0.12, 0.02], [0.05, 0.77, 0.2], 0xc23b32, { rz: -0.2 });
  // 머리: 얼굴, 쪽 찐 머리, 흰 두건
  b.sphere(0.22, [0, 1.12, 0], SKIN, {}, [1, 1.02, 0.98], [18, 12]);
  b.sphere(0.226, [0, 1.17, -0.035], HAIR, {}, [1, 0.9, 1], [16, 8]);
  b.sphere(0.095, [0, 1.17, -0.235], HAIR, {}, [1, 1, 1], [10, 7]);
  b.cylinder(0.228, 0.228, 0.075, 18, [0, 1.235, -0.01], 0xf6f2e8, {}, true);
  b.box([0.07, 0.07, 0.03], [0.05, 1.2, -0.215], 0xf6f2e8, { rz: 0.5 });
  // 눈웃음과 볼
  for (const s of [-1, 1]) {
    b.add(new THREE.TorusGeometry(0.03, 0.008, 4, 8, Math.PI), 0x2a1a14, [s * 0.075, 1.125, 0.205], { rz: 0 });
    b.sphere(0.036, [s * 0.125, 1.065, 0.185], 0xf2a79a, {}, [1, 0.7, 0.4], [8, 5]);
  }
  b.add(new THREE.TorusGeometry(0.045, 0.008, 4, 10, Math.PI), 0x9a3a32, [0, 1.065, 0.215], { rz: Math.PI });
  const g = b.build();
  if (!g) throw new Error('jumak: 주모를 만들지 못했어요');
  return g;
}

/** 팔 한 짝: 원점이 어깨, 아래(-y)로 늘어진 소매와 손, 그리고 손에 든 도구 */
function buildArm(tool: 'ladle' | 'spatula'): THREE.BufferGeometry {
  const b = new Batch(tool === 'ladle' ? 78 : 79);
  b.cylinder(0.05, 0.045, 0.34, 8, [0, -0.17, 0], SLEEVE, { jitter: 0.03 });
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
  const g = b.build();
  if (!g) throw new Error('jumak: 주모 팔을 만들지 못했어요');
  return g;
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
