// 주모의 서빙: 주문한 음식이 손님 곁에 놓였다가 사라지고, 가마솥과 음식에서 김이 올라온다.
// 음식은 최대 8개(그리기 호출도 최대 8번), 김은 점 하나로 한꺼번에 그려서 호출 1번이다.
import * as THREE from 'three';
import { DISH_LIFE_MS, MAX_DISHES } from '../../cheer/orders';
import { HOT_DISHES, STEAM_BASE_Y, buildDishGeometries, type DishKind } from './dishes';
import { createDot } from './stage-dot';
import type { DishSpot } from './layout';

const APPEAR_S = 0.45;
const FADE_S = 1.5;
const PUFFS_PER_DISH = 4;
const CAULDRON_PUFFS = 5;

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

interface Slot {
  mesh: THREE.Mesh;
  material: THREE.MeshLambertMaterial;
  active: boolean;
  age: number;
  kind: string;
  spot: DishSpot;
  /** 0~1: 지금 얼마나 보이나 (김의 진하기에도 쓴다) */
  show: number;
}

export interface ServiceOptions {
  scene: THREE.Scene;
  /** 가마솥 김이 올라오는 곳 */
  cauldron: { x: number; y: number; z: number };
  castShadow: boolean;
}

export class Service {
  private readonly slots: Slot[] = [];
  private readonly geometries: Record<DishKind, THREE.BufferGeometry>;
  private readonly steam: THREE.Points;
  private readonly steamPos: Float32Array;
  private readonly steamCol: Float32Array;
  private readonly steamGeo = new THREE.BufferGeometry();
  private readonly steamMat: THREE.PointsMaterial;
  private readonly dot: THREE.CanvasTexture;
  private readonly cauldron: ServiceOptions['cauldron'];
  private time = 0;
  private reduced = false;

  constructor(private readonly options: ServiceOptions) {
    this.geometries = buildDishGeometries();
    this.cauldron = options.cauldron;
    for (let i = 0; i < MAX_DISHES; i++) {
      // 사라질 때 흐려져야 해서 재질은 하나씩
      const material = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true });
      const mesh = new THREE.Mesh(this.geometries.gukbap, material);
      mesh.visible = false;
      mesh.castShadow = options.castShadow;
      options.scene.add(mesh);
      this.slots.push({ mesh, material, active: false, age: 0, kind: 'gukbap', spot: { x: 0, y: 0, z: 0, yaw: 0 }, show: 0 });
    }
    const total = MAX_DISHES * PUFFS_PER_DISH + CAULDRON_PUFFS;
    this.steamPos = new Float32Array(total * 3);
    this.steamCol = new Float32Array(total * 4).fill(1);
    this.steamGeo.setAttribute('position', new THREE.BufferAttribute(this.steamPos, 3));
    this.steamGeo.setAttribute('color', new THREE.BufferAttribute(this.steamCol, 4));
    this.dot = createDot(64);
    this.steamMat = new THREE.PointsMaterial({
      size: 0.3,
      map: this.dot,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.steam = new THREE.Points(this.steamGeo, this.steamMat);
    this.steam.frustumCulled = false;
    options.scene.add(this.steam);
  }

  setReducedMotion(on: boolean): void {
    this.reduced = on;
  }

  /** 지금 놓여 있는 음식 수 */
  get activeCount(): number {
    return this.slots.reduce((n, s) => n + (s.active ? 1 : 0), 0);
  }

  /** 음식을 놓는다. 같은 자리에 있던 음식은 바꾸고, 가득 차면 가장 오래된 것을 치운다 */
  serve(kind: string, spot: DishSpot): void {
    const geometry = this.geometries[kind as DishKind] ?? this.geometries.gukbap;
    let slot =
      this.slots.find((s) => s.active && Math.hypot(s.spot.x - spot.x, s.spot.z - spot.z) < 0.15) ??
      this.slots.find((s) => !s.active);
    if (!slot) slot = this.slots.reduce((a, b) => (a.age > b.age ? a : b));
    slot.active = true;
    slot.age = 0;
    slot.kind = kind;
    slot.spot = spot;
    slot.mesh.geometry = geometry;
    slot.mesh.visible = true;
    slot.mesh.rotation.y = spot.yaw;
    slot.mesh.position.set(spot.x, spot.y, spot.z);
    slot.material.opacity = this.reduced ? 1 : 0;
    slot.show = this.reduced ? 1 : 0;
  }

  update(dt: number): void {
    this.time += dt;
    const life = DISH_LIFE_MS / 1000;
    let puff = 0;
    for (const s of this.slots) {
      if (s.active) {
        s.age += dt;
        if (s.age >= life) {
          s.active = false;
          s.mesh.visible = false;
          s.show = 0;
        } else {
          const t = Math.min(1, s.age / APPEAR_S);
          const fadeOut = Math.min(1, (life - s.age) / FADE_S);
          // 나타날 때는 살짝 떨어지며 통통, 사라질 때는 흐려진다
          const appear = this.reduced ? 1 : Math.max(0, easeOutBack(t));
          s.show = Math.min(t, fadeOut);
          s.material.opacity = Math.min(1, t * 1.4) * Math.max(0, fadeOut);
          s.mesh.scale.setScalar(Math.max(0.01, appear));
          s.mesh.position.y = s.spot.y + (this.reduced ? 0 : (1 - t) * 0.12);
        }
      }
      // 김: 따뜻한 음식에서만, 움직임 줄이기에서는 없다
      const steaming = s.active && !this.reduced && HOT_DISHES.has(s.kind);
      for (let k = 0; k < PUFFS_PER_DISH; k++) {
        this.writePuff(puff++, steaming ? 0.45 * s.show : 0, s.spot.x, s.spot.y + (STEAM_BASE_Y[s.kind] ?? 0.1) * 1.1, s.spot.z, k, PUFFS_PER_DISH, 0.5, 0.06);
      }
    }
    for (let k = 0; k < CAULDRON_PUFFS; k++) {
      this.writePuff(puff++, this.reduced ? 0 : 0.4, this.cauldron.x, this.cauldron.y, this.cauldron.z, k, CAULDRON_PUFFS, 0.9, 0.12);
    }
    this.steamGeo.attributes.position!.needsUpdate = true;
    this.steamGeo.attributes.color!.needsUpdate = true;
  }

  private writePuff(i: number, strength: number, x: number, y: number, z: number, k: number, n: number, rise: number, spread: number): void {
    // 점마다 시작 시각을 어긋나게 해서 끊이지 않고 올라온다
    const p = (this.time * 0.38 + k / n + i * 0.13) % 1;
    const sway = Math.sin(this.time * 1.7 + i * 2.1 + k) * spread * p;
    this.steamPos[i * 3] = x + sway + (k % 2 ? 0.02 : -0.02);
    this.steamPos[i * 3 + 1] = y + p * rise;
    this.steamPos[i * 3 + 2] = z + Math.cos(this.time * 1.3 + i + k * 1.7) * spread * 0.5 * p;
    const a = strength * Math.sin(Math.PI * p);
    this.steamCol[i * 4] = 0.96;
    this.steamCol[i * 4 + 1] = 0.96;
    this.steamCol[i * 4 + 2] = 0.98;
    this.steamCol[i * 4 + 3] = a;
  }

  dispose(): void {
    for (const s of this.slots) {
      this.options.scene.remove(s.mesh);
      s.material.dispose();
    }
    for (const g of Object.values(this.geometries)) g.dispose();
    this.options.scene.remove(this.steam);
    this.steamGeo.dispose();
    this.steamMat.dispose();
    this.dot.dispose();
  }
}
