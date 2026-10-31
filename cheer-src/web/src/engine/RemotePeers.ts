// 같은 방의 다른 사람들. 저해상도 캐릭터를 InstancedMesh로 한꺼번에 그린다.
//   - 머리 1번, 몸통 1번, 발 1번(한 사람에 인스턴스 2개), 옷 소품마다 1번. 사람이 몇 명이든 그리기 호출은 늘지 않는다(최대 정원만큼 자리를 미리 잡아 둔다)
//   - 위치는 받은 점들 사이를 조금 늦춰서 이어 그린다(interpolation.ts)
//   - 자세(걷기, 앉기, 동작)는 내 캐릭터와 같은 PoseState를 쓴다
//   - 들어오고 나갈 때는 발끝에서 작게 커지고 작아진다(움직임 줄이기면 바로)
import * as THREE from 'three';
import type { LocalizedName, PeerId, PeerInfo } from '@shared/protocol';
import {
  AVATAR_HEIGHT,
  DETAIL_PRESETS,
  PoseState,
  WALK_SPEED,
  getAccessoryGeometry,
  getAvatarGeometries,
  getAvatarMaterial,
  getOutfit,
  type AccessorySpec,
  type AvatarDetailOptions,
  type OutfitSpec,
} from './avatar';
import { INTERPOLATION_DELAY_MS, PeerTrack } from './net/interpolation';
import type { SeatManager } from './seats';
import type { ActionMotion } from './types';

const APPEAR_SECONDS = 0.35;
const SIT_MOVE_SECONDS = 0.35;
/** 이 속도(m/s)보다 느리면 가만히 서 있는 것으로 본다 (받은 위치의 잔떨림으로 발이 꼼지락거리지 않게) */
const STANDING_SPEED = 0.25;
/** 잰 속도를 부드럽게 따라가는 빠르기(클수록 빨리). 받은 위치 간격이 들쭉날쭉해도 걸음이 떨리지 않게 한다 */
const SPEED_FOLLOW = 7;
/** 순간이동처럼 한 번에 크게 움직여도 걷는 정도는 이 이상 튀지 않는다 (WALK_SPEED 대비) */
const SPEED_CAP = 1.25;
const PICK_RADIUS = 0.5;
const PICK_CENTER_HEIGHT = 0.5;
const LABEL_RISE = 0.14;

function lerpAngle(from: number, to: number, t: number): number {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * t;
}

interface Peer {
  id: PeerId;
  name: LocalizedName;
  track: PeerTrack;
  x: number;
  z: number;
  yaw: number;
  rootY: number;
  pose: PoseState;
  /** 보이는 움직임에서 잰 속도(WALK_SPEED 대비, 부드럽게 따라간 값). 걷는 정도의 바탕 */
  moveSpeed: number;
  seatId: string | null;
  seatMove: { t: number; fromX: number; fromZ: number; fromYaw: number } | null;
  /** 0~1. 나타나는 중이면 올라가고, 나가는 중이면 내려간다 */
  appear: number;
  leaving: boolean;
}

interface AccessoryLayer {
  spec: AccessorySpec;
  mesh: THREE.InstancedMesh;
  local: THREE.Matrix4;
}

export interface RemotePeersOptions {
  seats: SeatManager;
  outfit: string | OutfitSpec;
  reducedMotion: boolean;
  /** 처음 잡아 둘 최대 인원. 넘으면 알아서 늘린다 */
  capacity: number;
  detail?: AvatarDetailOptions;
  /** 단조 증가하는 기기 시계(ms). 시험에서 바꿔 끼운다 */
  now?: () => number;
}

export class RemotePeers {
  private readonly peers = new Map<PeerId, Peer>();
  private readonly seatOwners = new Map<string, PeerId>();
  private readonly detail: AvatarDetailOptions;
  private readonly now: () => number;
  private readonly seats: SeatManager;
  private reduced: boolean;
  private outfit: OutfitSpec;
  private capacity: number;
  /** (x, z)에서 서 있는 바닥 높이 (평상 위면 높다). 장면이 정한다 */
  private groundAt: (x: number, z: number) => number = () => 0;

  private headMesh!: THREE.InstancedMesh;
  private bodyMesh!: THREE.InstancedMesh;
  /** 발: 한 사람에 인스턴스 2개 (2i가 왼발, 2i+1이 오른발). 그리기 호출은 1번 */
  private feetMesh!: THREE.InstancedMesh;
  private layers: AccessoryLayer[] = [];
  private order: Peer[] = [];

  // 계산용 임시 값 (프레임마다 새로 만들지 않는다)
  private readonly mRoot = new THREE.Matrix4();
  private readonly mPose = new THREE.Matrix4();
  private readonly mRP = new THREE.Matrix4();
  private readonly mBody = new THREE.Matrix4();
  private readonly mHead = new THREE.Matrix4();
  private readonly mFoot = new THREE.Matrix4();
  private readonly mTmp = new THREE.Matrix4();
  private readonly qYaw = new THREE.Quaternion();
  private readonly qPose = new THREE.Quaternion();
  private readonly qId = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();
  private readonly unit = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly sphere = new THREE.Sphere();
  private readonly hit = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    options: RemotePeersOptions,
  ) {
    this.seats = options.seats;
    this.detail = options.detail ?? DETAIL_PRESETS.peer;
    this.now = options.now ?? (() => performance.now());
    this.reduced = options.reducedMotion;
    this.outfit = typeof options.outfit === 'string' ? getOutfit(options.outfit) : options.outfit;
    this.capacity = Math.max(1, options.capacity);
    this.buildMeshes();
  }

  // ---- 읽기 ----

  /** 지금 보이는(나가는 중 포함) 사람 수 */
  get count(): number {
    return this.peers.size;
  }

  /** 나가는 중인 사람을 뺀 사람 수 */
  get activeCount(): number {
    let n = 0;
    for (const p of this.peers.values()) if (!p.leaving) n += 1;
    return n;
  }

  /** 장면에 올려 둔 InstancedMesh들 (그리기 호출 수 점검용) */
  getMeshes(): THREE.InstancedMesh[] {
    return [this.headMesh, this.bodyMesh, this.feetMesh, ...this.layers.map((l) => l.mesh)];
  }

  has(id: PeerId): boolean {
    const p = this.peers.get(id);
    return p !== undefined && !p.leaving;
  }

  nameOf(id: PeerId): LocalizedName | null {
    return this.peers.get(id)?.name ?? null;
  }

  /** 그 사람이 앉아 있는 자리 id (서 있으면 null) */
  seatIdOf(id: PeerId): string | null {
    const p = this.peers.get(id);
    return p && !p.leaving ? p.seatId : null;
  }

  /** 자리를 차지한 사람 번호 */
  seatOwner(seatId: string): PeerId | null {
    return this.seatOwners.get(seatId) ?? null;
  }

  /** 지금 보이는 위치 (나가는 중이거나 모르면 null) */
  positionOf(id: PeerId): { x: number; z: number; yaw: number } | null {
    const p = this.peers.get(id);
    return p ? { x: p.x, z: p.z, yaw: p.yaw } : null;
  }

  /** 이름표를 띄울 머리 위 위치 */
  labelAnchor(id: PeerId, out: THREE.Vector3): THREE.Vector3 | null {
    const p = this.peers.get(id);
    if (!p || p.leaving) return null;
    return out.set(p.x, p.rootY + AVATAR_HEIGHT + LABEL_RISE, p.z);
  }

  /** 시선(ray)이 지나가는 가장 가까운 사람. 나가는 중인 사람은 누를 수 없다 */
  pick(ray: THREE.Ray): PeerId | null {
    let best: PeerId | null = null;
    let bestT = Infinity;
    for (const p of this.peers.values()) {
      if (p.leaving) continue;
      this.sphere.center.set(p.x, p.rootY + PICK_CENTER_HEIGHT, p.z);
      this.sphere.radius = PICK_RADIUS;
      if (!ray.intersectSphere(this.sphere, this.hit)) continue;
      const t = this.hit.distanceTo(ray.origin);
      if (t < bestT) {
        best = p.id;
        bestT = t;
      }
    }
    return best;
  }

  // ---- 바꾸기 ----

  setReducedMotion(on: boolean): void {
    this.reduced = on;
    for (const p of this.peers.values()) p.pose.reduced = on;
    if (on) {
      // 나가는 중이던 사람은 바로 보낸다
      for (const p of [...this.peers.values()]) if (p.leaving) this.drop(p.id);
      for (const p of this.peers.values()) p.appear = 1;
    }
  }

  /** 장면의 바닥 높이 함수. 걷는 사람이 평상에 오르내린다 */
  setGroundHeight(fn: ((x: number, z: number) => number) | null): void {
    this.groundAt = fn ?? (() => 0);
    for (const p of this.peers.values()) p.pose.snapGround(this.groundAt(p.x, p.z));
  }

  setOutfit(outfit: string | OutfitSpec): void {
    this.outfit = typeof outfit === 'string' ? getOutfit(outfit) : outfit;
    this.disposeMeshes();
    this.buildMeshes();
  }

  /** welcome: 지금 방에 있는 사람들로 통째로 바꾼다. 이미 있던 사람이라 나타나는 연출은 없다 */
  reset(peers: readonly PeerInfo[], seats: Readonly<Record<string, PeerId>>): void {
    this.clear();
    this.ensureCapacity(peers.length + 1);
    for (const info of peers) this.addPeer(info, true);
    for (const [seatId, owner] of Object.entries(seats)) this.setSeat(seatId, owner, true);
  }

  /** peer-join: 발끝에서 살짝 나타난다 */
  add(info: PeerInfo): void {
    this.ensureCapacity(this.peers.size + 1);
    this.addPeer(info, false);
  }

  /** peer-leave: 살짝 작아지며 사라진다 */
  remove(id: PeerId): void {
    const p = this.peers.get(id);
    if (!p) return;
    this.releaseSeatOf(p);
    if (this.reduced) {
      this.drop(id);
    } else {
      p.leaving = true;
    }
  }

  /** 연결이 끊겼다: 옛 사람들은 이제 믿을 수 없으니 모두 바로 지운다 */
  clear(): void {
    this.peers.clear();
    this.seatOwners.clear();
    this.order.length = 0;
    this.syncCounts();
  }

  /** peer-move: [번호, x, z, r] */
  applyMoves(moves: ReadonlyArray<readonly [PeerId, number, number, number]>): void {
    const t = this.now();
    for (const [id, x, z, r] of moves) {
      const p = this.peers.get(id);
      if (!p || p.leaving || p.seatId) continue; // 앉은 사람은 서버가 먼저 seat 해제를 보낸다
      p.track.push(x, z, r, t);
    }
  }

  /** seat: 자리를 차지했거나(owner) 비웠다(null) */
  setSeat(seatId: string, owner: PeerId | null, snap = false): void {
    const prevOwner = this.seatOwners.get(seatId);
    if (owner === null) {
      this.seatOwners.delete(seatId);
      const p = prevOwner === undefined ? undefined : this.peers.get(prevOwner);
      if (p && p.seatId === seatId) this.standUp(p);
      return;
    }
    this.seatOwners.set(seatId, owner);
    const p = this.peers.get(owner);
    const def = this.seats.get(seatId);
    if (!p || !def || p.leaving) return;
    p.seatId = seatId;
    p.pose.seated = true;
    p.pose.seatY = this.seats.seatHeight(def);
    if (snap || this.reduced) {
      p.x = def.x;
      p.z = def.z;
      p.yaw = def.facing;
      p.seatMove = null;
      p.pose.snapSeated(true);
    } else {
      p.seatMove = { t: 0, fromX: p.x, fromZ: p.z, fromYaw: p.yaw };
    }
  }

  /** act: 다른 사람의 동작 몸짓 */
  playMotion(id: PeerId, motion: ActionMotion, delay = 0): void {
    const p = this.peers.get(id);
    if (p && !p.leaving) p.pose.playMotion(motion, delay);
  }

  /** 지금 있는 모든 사람이 같은 몸짓을 한다 (골 순간). 칼같이 같지 않게 maxDelay초 안에서 조금씩 어긋난다 */
  playMotionAll(motion: ActionMotion, maxDelay = 0): void {
    for (const p of this.peers.values()) {
      if (!p.leaving) p.pose.playMotion(motion, this.reduced ? 0 : Math.random() * maxDelay);
    }
  }

  // ---- 그리기 ----

  update(dt: number): void {
    const t = this.now() - INTERPOLATION_DELAY_MS;
    for (const p of [...this.peers.values()]) {
      this.stepPeer(p, dt, t);
      if (p.leaving && p.appear <= 0) this.drop(p.id);
    }
    this.syncCounts();
    this.writeMatrices();
  }

  dispose(): void {
    this.clear();
    this.disposeMeshes();
  }

  // ---- 안쪽 ----

  private addPeer(info: PeerInfo, instant: boolean): void {
    const existing = this.peers.get(info.id);
    if (existing && !existing.leaving) {
      existing.name = info.name;
      existing.track.push(info.x, info.z, info.r, this.now());
      return;
    }
    const pose = new PoseState(this.reduced);
    pose.snapGround(this.groundAt(info.x, info.z));
    const track = new PeerTrack();
    track.reset(info.x, info.z, info.r, this.now());
    this.peers.set(info.id, {
      id: info.id,
      name: info.name,
      track,
      x: info.x,
      z: info.z,
      yaw: info.r,
      rootY: 0,
      pose,
      moveSpeed: 0,
      seatId: null,
      seatMove: null,
      appear: instant || this.reduced ? 1 : 0,
      leaving: false,
    });
    this.order = [...this.peers.values()];
  }

  private drop(id: PeerId): void {
    const p = this.peers.get(id);
    if (!p) return;
    this.releaseSeatOf(p);
    this.peers.delete(id);
    this.order = [...this.peers.values()];
  }

  private releaseSeatOf(p: Peer): void {
    if (p.seatId && this.seatOwners.get(p.seatId) === p.id) this.seatOwners.delete(p.seatId);
    p.seatId = null;
    p.seatMove = null;
    p.pose.seated = false;
  }

  private standUp(p: Peer): void {
    p.seatId = null;
    p.seatMove = null;
    p.pose.seated = false;
    // 일어난 자리에서 다시 걷기 시작한다 (예전 위치로 되돌아가지 않게)
    p.track.reset(p.x, p.z, p.yaw, this.now());
  }

  private stepPeer(p: Peer, dt: number, renderTime: number): void {
    const prevX = p.x;
    const prevZ = p.z;
    const seat = p.seatId ? this.seats.get(p.seatId) : undefined;

    if (seat && p.seatMove) {
      const m = p.seatMove;
      m.t = Math.min(1, m.t + dt / SIT_MOVE_SECONDS);
      const e = m.t * m.t * (3 - 2 * m.t);
      p.x = m.fromX + (seat.x - m.fromX) * e;
      p.z = m.fromZ + (seat.z - m.fromZ) * e;
      p.yaw = lerpAngle(m.fromYaw, seat.facing, e);
      if (m.t >= 1) p.seatMove = null;
    } else if (seat) {
      p.x = seat.x;
      p.z = seat.z;
      p.yaw = seat.facing;
    } else {
      const at = p.track.at(renderTime);
      if (at) {
        p.x = at.x;
        p.z = at.z;
        p.yaw = at.r;
      }
    }

    // 걷는 정도는 실제로 움직인 속도로 센다 (조이스틱으로 천천히 가는 사람은 작은 걸음). 앉은 사람은 걷지 않는다
    if (seat || dt <= 0) {
      p.moveSpeed = 0;
    } else {
      const measured = Math.min(SPEED_CAP, Math.hypot(p.x - prevX, p.z - prevZ) / dt / WALK_SPEED);
      p.moveSpeed += (measured - p.moveSpeed) * (1 - Math.exp(-SPEED_FOLLOW * dt));
    }
    p.pose.speedTarget = p.moveSpeed * WALK_SPEED > STANDING_SPEED ? Math.min(1, p.moveSpeed) : 0;
    p.pose.groundY = this.groundAt(p.x, p.z);
    p.pose.update(dt);

    // 나타나고 사라지기
    if (!this.reduced) {
      const step = dt / APPEAR_SECONDS;
      p.appear = p.leaving ? Math.max(0, p.appear - step) : Math.min(1, p.appear + step);
    } else {
      p.appear = p.leaving ? 0 : 1;
    }
  }

  private writeMatrices(): void {
    const list = this.order;
    const n = Math.min(list.length, this.capacity);
    for (let i = 0; i < n; i++) {
      const p = list[i]!;
      const pose = p.pose.compute();
      p.rootY = pose.rootY;
      const grow = p.appear * p.appear * (3 - 2 * p.appear);
      const s = Math.max(grow, 0.0001);

      this.qYaw.setFromAxisAngle(this.up, p.yaw);
      this.pos.set(p.x, pose.rootY, p.z);
      this.scl.set(s, s, s);
      this.mRoot.compose(this.pos, this.qYaw, this.scl);

      this.euler.set(pose.pitch, pose.spin, pose.roll, 'XYZ');
      this.qPose.setFromEuler(this.euler);
      this.pos.set(0, pose.poseY, 0);
      this.mPose.compose(this.pos, this.qPose, this.unit);
      this.mRP.multiplyMatrices(this.mRoot, this.mPose);

      this.pos.set(0, 0, 0);
      this.scl.set(pose.bodyScaleXZ, pose.bodyScaleY, pose.bodyScaleXZ);
      this.mTmp.compose(this.pos, this.qId, this.scl);
      this.mBody.multiplyMatrices(this.mRP, this.mTmp);

      this.pos.set(0, pose.headY, 0);
      this.mTmp.compose(this.pos, this.qId, this.unit);
      this.mHead.multiplyMatrices(this.mRP, this.mTmp);

      // 발 두 짝: pose 그룹 기준 자리에서 몸통과 같은 비율로 (왼발 2i, 오른발 2i+1)
      this.scl.set(pose.bodyScaleXZ, pose.bodyScaleY, pose.bodyScaleXZ);
      this.pos.set(-pose.footX, pose.footLY, pose.footLZ);
      this.mTmp.compose(this.pos, this.qId, this.scl);
      this.mFoot.multiplyMatrices(this.mRP, this.mTmp);
      this.feetMesh.setMatrixAt(i * 2, this.mFoot);
      this.pos.set(pose.footX, pose.footRY, pose.footRZ);
      this.mTmp.compose(this.pos, this.qId, this.scl);
      this.mFoot.multiplyMatrices(this.mRP, this.mTmp);
      this.feetMesh.setMatrixAt(i * 2 + 1, this.mFoot);

      this.bodyMesh.setMatrixAt(i, this.mBody);
      this.headMesh.setMatrixAt(i, this.mHead);
      for (const layer of this.layers) {
        const parent = layer.spec.attach === 'head' ? this.mHead : this.mBody;
        this.mTmp.multiplyMatrices(parent, layer.local);
        layer.mesh.setMatrixAt(i, this.mTmp);
      }
    }
    for (const mesh of this.getMeshes()) mesh.instanceMatrix.needsUpdate = true;
  }

  private syncCounts(): void {
    const n = Math.min(this.order.length, this.capacity);
    for (const mesh of this.getMeshes()) {
      mesh.count = mesh === this.feetMesh ? n * 2 : n;
      mesh.visible = n > 0; // 아무도 없으면 그리기 호출도 없다
    }
  }

  private ensureCapacity(needed: number): void {
    if (needed <= this.capacity) return;
    this.capacity = Math.max(needed, this.capacity * 2);
    this.disposeMeshes();
    this.buildMeshes();
  }

  private buildMeshes(): void {
    const geo = getAvatarGeometries(this.detail);
    this.bodyMesh = this.makeMesh(geo.body, getAvatarMaterial(this.outfit.bodyColor, true));
    this.feetMesh = this.makeMesh(geo.foot, getAvatarMaterial(this.outfit.bodyColor, true), this.capacity * 2);
    this.headMesh = this.makeMesh(geo.head, getAvatarMaterial(this.outfit.skinColor, true));
    this.layers = (this.outfit.accessories ?? []).map((spec) => {
      const mesh = this.makeMesh(getAccessoryGeometry(spec, this.detail), getAvatarMaterial(spec.color, false));
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(spec.rotation ?? [0, 0, 0]), 'XYZ'));
      const local = new THREE.Matrix4().compose(
        new THREE.Vector3(...spec.position),
        q,
        new THREE.Vector3(...(spec.scale ?? [1, 1, 1])),
      );
      return { spec, mesh, local };
    });
    this.syncCounts();
  }

  private makeMesh(geometry: THREE.BufferGeometry, material: THREE.Material, capacity = this.capacity): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.frustumCulled = false; // 사람마다 위치가 달라 한 덩어리 경계로는 가릴 수 없다
    mesh.count = 0;
    mesh.visible = false;
    this.scene.add(mesh);
    return mesh;
  }

  private disposeMeshes(): void {
    // geometry와 material은 avatar.ts가 나눠 쓰는 것이라 여기서 놓지 않는다. 인스턴스 버퍼만 놓는다
    for (const mesh of this.getMeshes()) {
      this.scene.remove(mesh);
      mesh.dispose();
    }
    this.layers = [];
  }
}
