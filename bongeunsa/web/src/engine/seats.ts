// 자리: 의자를 장면에 놓고, 누른 자리를 찾고, 앉아도 되는지 판정하는 자리.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SeatDef } from './types';

export const DEFAULT_SEAT_HEIGHT = 0.42;
const APPROACH_DISTANCE = 0.75;
const PICK_RADIUS = 0.5;

/**
 * 못 앉은 이유
 * - occupied: 눌렀을 때 이미 다른 사람이 앉아 있는 게 보였다(조용히 무시한다)
 * - taken: 걸어가는 사이, 또는 동시에 앉으려다 서버가 다른 사람에게 줬다
 * - failed: 서버가 받지 않았거나 답이 없었다
 */
export type SeatDenial = 'occupied' | 'taken' | 'failed';

/**
 * 앉아도 되는지 판정하는 쪽. 서버에 붙어 있으면 서버 판정(PresenceSeatArbiter)을 기다리고,
 * 혼자 모드면 이 기기 안에서만(LocalSeatArbiter) 판정한다. 그래서 requestSit은 Promise도 된다.
 */
export interface SeatArbiter {
  /** 앉기를 요청한다. true면 내 자리 */
  requestSit(seatId: string): boolean | Promise<boolean>;
  /** 일어났다 */
  release(seatId: string): void;
  /** 다른 사람이 앉아 있는 자리인지 */
  isOccupiedByOther(seatId: string): boolean;
  /** 방금 requestSit이 거절된 이유. 없으면 'taken'으로 본다 */
  denialReason?(seatId: string): Exclude<SeatDenial, 'occupied'>;
}

/** 이 기기 안에서만 판정: 다른 사람이 없으니 막힐 일이 없다. 시험하려면 setOthersOccupied로 막아 본다. */
export class LocalSeatArbiter implements SeatArbiter {
  private mine: string | null = null;
  private others = new Set<string>();

  requestSit(seatId: string): boolean {
    if (this.others.has(seatId)) return false;
    this.mine = seatId; // 1인 1석: 다른 자리에 있었다면 자동으로 옮긴 셈
    return true;
  }

  release(seatId: string): void {
    if (this.mine === seatId) this.mine = null;
  }

  isOccupiedByOther(seatId: string): boolean {
    return this.others.has(seatId);
  }

  setOthersOccupied(seatIds: Iterable<string>): void {
    this.others = new Set(seatIds);
  }
}

function buildChairGeometry(): THREE.BufferGeometry {
  // 앉는 면 윗면이 y=0.42, 등받이는 뒤(-z)쪽. 한 덩어리로 합쳐 의자 전체를 한 번에 그린다.
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) =>
    new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const parts = [
    box(0.5, 0.06, 0.5, 0, 0.39, 0),
    box(0.5, 0.46, 0.06, 0, 0.65, -0.22),
    box(0.05, 0.36, 0.05, -0.21, 0.18, 0.21),
    box(0.05, 0.36, 0.05, 0.21, 0.18, 0.21),
    box(0.05, 0.36, 0.05, -0.21, 0.18, -0.21),
    box(0.05, 0.36, 0.05, 0.21, 0.18, -0.21),
  ];
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('chair geometry merge failed');
  return merged;
}

export class SeatManager {
  private readonly byId = new Map<string, SeatDef>();
  private readonly mesh: THREE.InstancedMesh | null;
  private readonly geometry: THREE.BufferGeometry | null;
  private readonly material: THREE.MeshLambertMaterial | null;

  constructor(
    private readonly scene: THREE.Scene,
    readonly seats: readonly SeatDef[],
  ) {
    for (const s of seats) {
      if (this.byId.has(s.id)) console.warn(`[seats] duplicate seat id: ${s.id}`);
      this.byId.set(s.id, s);
    }
    const chairs = seats.filter((s) => s.visual !== 'none');
    if (chairs.length === 0) {
      this.mesh = null;
      this.geometry = null;
      this.material = null;
      return;
    }
    // 같은 모양의 의자는 인스턴스 하나로 모아 그리기 호출 1번
    this.geometry = buildChairGeometry();
    this.material = new THREE.MeshLambertMaterial({ color: 0x9a9aa0 });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, chairs.length);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    chairs.forEach((s, i) => {
      q.setFromAxisAngle(up, s.facing);
      m.compose(
        new THREE.Vector3(s.x, (s.y ?? DEFAULT_SEAT_HEIGHT) - DEFAULT_SEAT_HEIGHT, s.z),
        q,
        new THREE.Vector3(1, 1, 1),
      );
      this.mesh!.setMatrixAt(i, m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    scene.add(this.mesh);
  }

  get(id: string): SeatDef | undefined {
    return this.byId.get(id);
  }

  // ---- 고른 자리 표시: 방석을 누르면 그 방석 위에 노란 고리와 아래를 가리키는 화살표가 뜬다 ----
  private marker: { group: THREE.Group; ring: THREE.Mesh; arrow: THREE.Mesh; geos: THREE.BufferGeometry[]; mat: THREE.MeshBasicMaterial } | null = null;
  private marked: SeatDef | null = null;
  private markT = 0;
  private fade = 0;

  private ensureMarker(): NonNullable<SeatManager['marker']> {
    if (this.marker) return this.marker;
    const mat = new THREE.MeshBasicMaterial({ color: 0xf5c400, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    const ringGeo = new THREE.TorusGeometry(0.36, 0.04, 8, 40).rotateX(Math.PI / 2);
    const arrowGeo = new THREE.ConeGeometry(0.14, 0.28, 4).rotateX(Math.PI).rotateY(Math.PI / 4);
    const ring = new THREE.Mesh(ringGeo, mat);
    const arrow = new THREE.Mesh(arrowGeo, mat);
    ring.renderOrder = 20;
    arrow.renderOrder = 20;
    const group = new THREE.Group();
    group.add(ring, arrow);
    group.visible = false;
    this.scene.add(group);
    this.marker = { group, ring, arrow, geos: [ringGeo, arrowGeo], mat };
    return this.marker;
  }

  /** 이 자리를 골랐다고 표시한다. null이면 표시를 거둔다(살짝 사라진다) */
  markSeat(seat: SeatDef | null): void {
    if (seat) {
      const m = this.ensureMarker();
      this.marked = seat;
      this.markT = 0;
      this.fade = 1;
      m.group.position.set(seat.x, this.seatHeight(seat) + 0.03, seat.z);
      m.group.visible = true;
    } else {
      this.marked = null;
    }
  }

  /** 지금 표시 중인 자리 id (시험용) */
  get markedSeatId(): string | null {
    return this.marked?.id ?? null;
  }

  /** 매 프레임: 고리가 숨 쉬듯 커졌다 작아지고 화살표가 통통 뛴다. 표시를 거두면 0.25초에 걸쳐 사라진다 */
  update(dt: number, reduced = false): void {
    const m = this.marker;
    if (!m) return;
    this.markT += dt;
    if (!this.marked) {
      this.fade = Math.max(0, this.fade - dt / 0.25);
      if (this.fade <= 0) {
        m.group.visible = false;
        return;
      }
    }
    const pulse = reduced ? 0 : Math.sin(this.markT * 6);
    m.ring.scale.setScalar(1 + 0.08 * pulse);
    m.arrow.position.y = 0.75 + (reduced ? 0 : 0.08 * Math.abs(Math.sin(this.markT * 4)));
    m.arrow.rotation.y = reduced ? 0 : this.markT * 1.5;
    m.mat.opacity = this.fade * (0.85 + 0.15 * pulse);
  }

  seatHeight(seat: SeatDef): number {
    return seat.y ?? DEFAULT_SEAT_HEIGHT;
  }

  /** 걸어가서 멈출 자리 */
  approachPoint(seat: SeatDef): { x: number; z: number } {
    if (seat.approach) return seat.approach;
    return {
      x: seat.x + Math.sin(seat.facing) * APPROACH_DISTANCE,
      z: seat.z + Math.cos(seat.facing) * APPROACH_DISTANCE,
    };
  }

  /** 누른 방향(ray)이 자리 가까이 지나가면 그 자리를 돌려준다. 손가락으로도 누르기 쉽게 넉넉하게. */
  pick(ray: THREE.Ray): SeatDef | null {
    let best: SeatDef | null = null;
    let bestT = Infinity;
    const point = new THREE.Vector3();
    const rel = new THREE.Vector3();
    for (const s of this.seats) {
      point.set(s.x, (s.y ?? DEFAULT_SEAT_HEIGHT) + 0.2, s.z);
      rel.subVectors(point, ray.origin);
      const t = rel.dot(ray.direction);
      if (t <= 0) continue;
      const distance = rel.addScaledVector(ray.direction, -t).length();
      if (distance <= PICK_RADIUS && t < bestT) {
        best = s;
        bestT = t;
      }
    }
    return best;
  }

  dispose(): void {
    if (this.marker) {
      this.scene.remove(this.marker.group);
      for (const g of this.marker.geos) g.dispose();
      this.marker.mat.dispose();
      this.marker = null;
    }
    if (this.mesh) this.scene.remove(this.mesh);
    this.mesh?.dispose();
    this.geometry?.dispose();
    this.material?.dispose();
  }
}
