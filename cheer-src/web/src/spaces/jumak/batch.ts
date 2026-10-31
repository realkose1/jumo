// 정적인 도형을 정점 색으로 칠해 한 덩어리로 합치는 도우미.
// 재질이 하나(정점 색 Lambert)라서 방 전체의 나무, 기와, 방석, 소반이 그리기 호출 한 번이다.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** 시드가 같으면 늘 같은 난수 (방이 열 때마다 같은 모양이도록) */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PartOptions {
  /** 도형을 놓고 난 뒤 돌림(라디안). 먼저 y로 돌린 뒤 x, z 순서로 눕히고 기울인다 */
  ry?: number;
  rx?: number;
  rz?: number;
  /** 평상 같은 묶음의 변환. 도형 변환 다음에 곱한다 */
  parent?: THREE.Matrix4;
  /** 방 좌표의 높이 y에 따라 밝기를 곱한다 (아래쪽을 어둡게 하는 가짜 그늘) */
  shade?: (y: number) => number;
  /** 정점마다 밝기를 조금씩 흔들어 나뭇결 같은 얼룩을 만든다 (0.1이면 ±10%) */
  jitter?: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();

export class Batch {
  private readonly parts: THREE.BufferGeometry[] = [];
  private readonly rand: () => number;

  constructor(seed = 1) {
    this.rand = seeded(seed);
  }

  get partCount(): number {
    return this.parts.length;
  }

  /** 도형 하나를 색과 함께 더한다. geo는 이 안에서 변형되므로 새로 만든 것을 넘긴다. */
  add(geo: THREE.BufferGeometry, color: number, pos: [number, number, number], o: PartOptions = {}): this {
    if (geo.hasAttribute('uv')) geo.deleteAttribute('uv');
    if (geo.index !== null) {
      // 섞이는 도형이 모두 같은 방식(인덱스 없음)이어야 합칠 수 있다
      const flat = geo.toNonIndexed();
      geo.dispose();
      geo = flat;
    }
    _e.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, 'ZXY');
    _q.setFromEuler(_e);
    _p.set(pos[0], pos[1], pos[2]);
    _m.compose(_p, _q, _s);
    if (o.parent) _m.premultiply(o.parent);
    geo.applyMatrix4(_m);
    this.paint(geo, color, o);
    this.parts.push(geo);
    return this;
  }

  box(size: [number, number, number], pos: [number, number, number], color: number, o: PartOptions = {}): this {
    return this.add(new THREE.BoxGeometry(size[0], size[1], size[2]), color, pos, o);
  }

  /** 위가 +z를 보는 평면. 눕히려면 rx를 준다 */
  plane(
    w: number,
    h: number,
    pos: [number, number, number],
    color: number,
    o: PartOptions = {},
    segments: [number, number] = [1, 1],
  ): this {
    return this.add(new THREE.PlaneGeometry(w, h, segments[0], segments[1]), color, pos, o);
  }

  cylinder(
    radiusTop: number,
    radiusBottom: number,
    height: number,
    radial: number,
    pos: [number, number, number],
    color: number,
    o: PartOptions = {},
    openEnded = false,
  ): this {
    return this.add(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radial, 1, openEnded), color, pos, o);
  }

  sphere(
    radius: number,
    pos: [number, number, number],
    color: number,
    o: PartOptions = {},
    scale: [number, number, number] = [1, 1, 1],
    segments: [number, number] = [10, 7],
  ): this {
    const g = new THREE.SphereGeometry(radius, segments[0], segments[1]);
    g.scale(scale[0], scale[1], scale[2]);
    return this.add(g, color, pos, o);
  }

  /** 합친 geometry. 하나도 없으면 null */
  build(): THREE.BufferGeometry | null {
    if (this.parts.length === 0) return null;
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    if (!merged) throw new Error('jumak: 도형을 합치지 못했어요');
    return merged;
  }

  private paint(geo: THREE.BufferGeometry, color: number, o: PartOptions): void {
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    _c.set(color);
    const jit = o.jitter ?? 0;
    // 같은 자리의 정점은 같은 흔들림을 받게 해서 면 사이가 갈라지지 않게 한다
    const noise = new Map<string, number>();
    for (let i = 0; i < pos.count; i++) {
      let k = o.shade ? o.shade(pos.getY(i)) : 1;
      if (jit > 0) {
        const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
        let n = noise.get(key);
        if (n === undefined) {
          n = 1 + (this.rand() * 2 - 1) * jit;
          noise.set(key, n);
        }
        k *= n;
      }
      colors[i * 3] = _c.r * k;
      colors[i * 3 + 1] = _c.g * k;
      colors[i * 3 + 2] = _c.b * k;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
}

/** 평상처럼 한 묶음으로 움직이는 도형들의 변환: 위치(cx, cz)와 y축 돌림 */
export function groupMatrix(cx: number, cz: number, rotY: number, y = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(cx, y, cz),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
    new THREE.Vector3(1, 1, 1),
  );
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
