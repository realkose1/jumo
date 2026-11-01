// 내 캐릭터의 움직임: 목적지로 걷기, 키보드 이동, 자리로 걸어가 앉기, 이동하면 일어나기.
import * as THREE from 'three';
import { WALK_SPEED, type Avatar } from './avatar';
import type { SeatArbiter, SeatDenial, SeatManager } from './seats';
import type { SeatDef, WalkRect } from './types';

const ARRIVE_DISTANCE = 0.08;
const BODY_RADIUS = 0.25;
const TURN_RATE = 14;
const SIT_MOVE_SECONDS = 0.35;
const STUCK_SECONDS = 0.6;

function lerpAngle(from: number, to: number, t: number): number {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * t;
}

/** 누른 곳에 잠깐 보이는 작은 고리 */
class DestinationMarker {
  readonly mesh: THREE.Mesh;
  private time = 0;
  private reduced = false;

  constructor() {
    const geometry = new THREE.RingGeometry(0.16, 0.22, 24).rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.y = 0.02;
    this.mesh.visible = false;
  }

  setReducedMotion(on: boolean): void {
    this.reduced = on;
  }

  show(x: number, z: number): void {
    this.mesh.position.set(x, 0.02, z);
    this.mesh.visible = true;
    this.time = 0;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  update(dt: number): void {
    if (!this.mesh.visible) return;
    this.time += dt;
    const pulse = this.reduced ? 1 : 1 + Math.sin(this.time * 6) * 0.12;
    this.mesh.scale.setScalar(pulse);
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

export interface PlayerCallbacks {
  /** 앉으면 자리 id, 일어나면 null */
  onSeatChange?: (seatId: string | null) => void;
  /** 앉지 못했다 (이유는 SeatDenial) */
  onSeatDenied?: (seatId: string, reason: SeatDenial) => void;
}

export class Player {
  private x = 0;
  private z = 0;
  private yaw = 0;
  private dest: { x: number; z: number } | null = null;
  private pendingSeat: SeatDef | null = null;
  private seat: SeatDef | null = null;
  private sitToken = 0;
  private sitMove: { t: number; fromX: number; fromZ: number; fromYaw: number } | null = null;
  private stuckTime = 0;
  private lastDestDistance = Infinity;
  private bounds: WalkRect = { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
  private blockers: WalkRect[] = [];
  private groundAt: (x: number, z: number) => number = () => 0;
  private readonly marker = new DestinationMarker();
  private readonly move = new THREE.Vector2();

  constructor(
    readonly avatar: Avatar,
    private readonly seats: SeatManager,
    private readonly arbiter: SeatArbiter,
    scene: THREE.Scene,
    private readonly callbacks: PlayerCallbacks = {},
  ) {
    scene.add(avatar.root, this.marker.mesh);
  }

  setWalkArea(bounds: WalkRect, blockers: WalkRect[] = []): void {
    this.bounds = bounds;
    this.blockers = blockers;
  }

  /** (x, z)에서 서 있는 바닥 높이. 단(높은 바닥) 위를 걸을 때 캐릭터가 올라간다 */
  setGroundHeight(fn: ((x: number, z: number) => number) | null): void {
    this.groundAt = fn ?? (() => 0);
    this.avatar.snapGround(this.groundAt(this.x, this.z));
  }

  setReducedMotion(on: boolean): void {
    this.avatar.setReducedMotion(on);
    this.marker.setReducedMotion(on);
  }

  get seatId(): string | null {
    return this.seat?.id ?? null;
  }

  get position(): { x: number; z: number } {
    return { x: this.x, z: this.z };
  }

  /** 바라보는 방향 (yaw, 라디안) */
  get heading(): number {
    return this.yaw;
  }

  teleport(x: number, z: number, yaw: number): void {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.dest = null;
    this.avatar.setPosition(x, z);
    this.avatar.yaw = yaw;
    this.avatar.snapGround(this.groundAt(x, z));
  }

  /** 바닥을 눌렀다: 거기까지 걷는다 */
  walkTo(x: number, z: number): void {
    this.cancelSeatIntent();
    const px = THREE.MathUtils.clamp(x, this.bounds.minX + BODY_RADIUS, this.bounds.maxX - BODY_RADIUS);
    const pz = THREE.MathUtils.clamp(z, this.bounds.minZ + BODY_RADIUS, this.bounds.maxZ - BODY_RADIUS);
    this.setDest(px, pz);
    this.marker.show(px, pz);
  }

  /** 자리를 눌렀다: 앞까지 걸어가서 앉는다 */
  sitAt(seat: SeatDef): void {
    if (this.seat?.id === seat.id) return;
    if (this.arbiter.isOccupiedByOther(seat.id)) {
      this.callbacks.onSeatDenied?.(seat.id, 'occupied');
      return;
    }
    this.cancelSeatIntent();
    this.pendingSeat = seat;
    const a = this.seats.approachPoint(seat);
    this.setDest(a.x, a.z);
    this.marker.show(seat.x, seat.z);
  }

  /** 걸어가는 사이 그 자리에 다른 사람이 앉았다: 걸음을 멈춘다 (앉은 뒤에는 아무 일도 없다) */
  abortSeatIntent(seatId: string): void {
    if (this.pendingSeat?.id !== seatId) return;
    this.pendingSeat = null;
    this.dest = null;
    this.marker.hide();
    this.callbacks.onSeatDenied?.(seatId, 'taken');
  }

  /** 일어난다 (이미 서 있으면 아무 일도 없다) */
  standUp(): void {
    this.cancelSeatIntent();
  }

  update(dt: number, input: { x: number; y: number }, cameraYaw: number): void {
    this.marker.update(dt);
    const keyboard = input.x !== 0 || input.y !== 0;
    let walking = false;
    const fromX = this.x;
    const fromZ = this.z;

    if (keyboard) {
      this.dest = null;
      this.marker.hide();
      this.cancelSeatIntent();
      // 카메라가 보는 쪽이 앞
      const fx = -Math.sin(cameraYaw);
      const fz = -Math.cos(cameraYaw);
      const rx = Math.cos(cameraYaw);
      const rz = -Math.sin(cameraYaw);
      this.move.set(rx * input.x + fx * input.y, rz * input.x + fz * input.y);
      walking = this.stepBy(this.move.x * WALK_SPEED * dt, this.move.y * WALK_SPEED * dt, dt);
    } else if (this.sitMove) {
      this.updateSitMove(dt);
    } else if (this.dest) {
      walking = this.updateWalkToDest(dt);
    }

    // 걷는 정도는 실제로 움직인 거리로 센다: 조이스틱을 살짝 밀거나 벽을 따라 미끄러지면 작은 걸음, 벽에 막히면 제자리
    const speed = walking && dt > 0 ? Math.hypot(this.x - fromX, this.z - fromZ) / dt / WALK_SPEED : 0;
    this.avatar.setWalking(speed);
    this.avatar.setGround(this.groundAt(this.x, this.z));
    this.avatar.yaw = this.yaw;
    this.avatar.setPosition(this.x, this.z);
    this.avatar.update(dt);
  }

  dispose(): void {
    this.sitToken += 1;
    if (this.seat) this.arbiter.release(this.seat.id);
    this.marker.dispose();
    this.avatar.dispose();
  }

  // ---- 안쪽 ----

  private setDest(x: number, z: number): void {
    this.dest = { x, z };
    this.stuckTime = 0;
    this.lastDestDistance = Infinity;
  }

  /** 앉으려던 것, 앉아 있던 것을 모두 취소한다 */
  private cancelSeatIntent(): void {
    this.pendingSeat = null;
    this.sitToken += 1;
    this.sitMove = null;
    if (this.seat) {
      this.arbiter.release(this.seat.id);
      this.seat = null;
      this.avatar.setSeated(false);
      this.callbacks.onSeatChange?.(null);
    }
  }

  private updateWalkToDest(dt: number): boolean {
    const dest = this.dest!;
    const dx = dest.x - this.x;
    const dz = dest.z - this.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= ARRIVE_DISTANCE) {
      this.arrive();
      return false;
    }
    const step = Math.min(distance, WALK_SPEED * dt);
    const moved = this.stepBy((dx / distance) * step, (dz / distance) * step, dt);
    // 막혀서 더 가까워지지 못하면 포기한다
    if (distance > this.lastDestDistance - 0.002) this.stuckTime += dt;
    else this.stuckTime = 0;
    this.lastDestDistance = distance;
    if (this.stuckTime > STUCK_SECONDS) {
      this.dest = null;
      this.pendingSeat = null;
      this.marker.hide();
      return false;
    }
    return moved;
  }

  private arrive(): void {
    this.dest = null;
    this.marker.hide();
    const seat = this.pendingSeat;
    this.pendingSeat = null;
    if (seat) void this.beginSit(seat);
  }

  private async beginSit(seat: SeatDef): Promise<void> {
    const token = ++this.sitToken;
    let granted = false;
    try {
      granted = await this.arbiter.requestSit(seat.id);
    } catch {
      granted = false;
    }
    if (token !== this.sitToken) {
      // 기다리는 사이에 다른 걸 하러 갔다
      if (granted) this.arbiter.release(seat.id);
      return;
    }
    if (!granted) {
      this.callbacks.onSeatDenied?.(seat.id, this.arbiter.denialReason?.(seat.id) ?? 'taken');
      return;
    }
    this.seat = seat;
    this.sitMove = { t: 0, fromX: this.x, fromZ: this.z, fromYaw: this.yaw };
    this.avatar.setSeated(true, this.seats.seatHeight(seat));
    this.callbacks.onSeatChange?.(seat.id);
  }

  private updateSitMove(dt: number): void {
    const seat = this.seat;
    const s = this.sitMove;
    if (!seat || !s) return;
    s.t = Math.min(1, s.t + dt / SIT_MOVE_SECONDS);
    const e = s.t * s.t * (3 - 2 * s.t);
    this.x = s.fromX + (seat.x - s.fromX) * e;
    this.z = s.fromZ + (seat.z - s.fromZ) * e;
    this.yaw = lerpAngle(s.fromYaw, seat.facing, e);
    if (s.t >= 1) this.sitMove = null;
  }

  /** (dx, dz)만큼 움직인다. 벽과 상자에 막히면 밀려난다. 실제로 움직였으면 true. */
  private stepBy(dx: number, dz: number, dt: number): boolean {
    if (Math.hypot(dx, dz) < 1e-6) return false;
    const fromX = this.x;
    const fromZ = this.z;
    let nx = this.x + dx;
    let nz = this.z + dz;
    nx = THREE.MathUtils.clamp(nx, this.bounds.minX + BODY_RADIUS, this.bounds.maxX - BODY_RADIUS);
    nz = THREE.MathUtils.clamp(nz, this.bounds.minZ + BODY_RADIUS, this.bounds.maxZ - BODY_RADIUS);
    for (const b of this.blockers) {
      const minX = b.minX - BODY_RADIUS;
      const maxX = b.maxX + BODY_RADIUS;
      const minZ = b.minZ - BODY_RADIUS;
      const maxZ = b.maxZ + BODY_RADIUS;
      if (nx > minX && nx < maxX && nz > minZ && nz < maxZ) {
        // 가장 얕게 박힌 쪽으로 밀어낸다
        const pushes = [nx - minX, maxX - nx, nz - minZ, maxZ - nz];
        const least = Math.min(...pushes);
        if (least === pushes[0]) nx = minX;
        else if (least === pushes[1]) nx = maxX;
        else if (least === pushes[2]) nz = minZ;
        else nz = maxZ;
      }
    }
    const moved = Math.hypot(nx - fromX, nz - fromZ);
    if (moved < 1e-5) return false;
    this.x = nx;
    this.z = nz;
    // 가려던 방향을 본다 (밀려난 방향이 아니라)
    this.yaw = lerpAngle(this.yaw, Math.atan2(dx, dz), 1 - Math.exp(-TURN_RATE * dt));
    return true;
  }
}
