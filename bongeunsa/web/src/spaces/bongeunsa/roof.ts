// 한옥 지붕: 용마루에서 처마로 내려오며 오목하게 휘고(지붕 곡선), 네 귀가 하늘로 들린다(추녀 곡선).
// 정점 색을 직접 칠한 geometry를 돌려준다: 기와 골(밝고 어두운 줄), 처마 밑 서까래(단청 초록), 처마 끝 연함(붉은 띠).
// 좌표: 처마 높이가 y=0, 앞이 +z. 반 너비 W(x), 반 깊이 D(z), 높이 H.
import * as THREE from 'three';

export interface RoofSpec {
  /** 처마 끝까지의 반 너비(x)와 반 깊이(z) */
  W: number;
  D: number;
  /** 처마에서 용마루까지 높이 */
  H: number;
  /** 용마루 반 길이를 정하는 값: R = W - D * hip. 클수록 용마루가 짧다(정자처럼 모이는 지붕은 1) */
  hip?: number;
  /** 네 귀가 들리는 높이 */
  lift?: number;
  tile?: number;
  tileDark?: number;
  under?: number;
  fascia?: number;
}

const _c = new THREE.Color();

function pushColor(arr: number[], hex: number, k: number, count: number): void {
  _c.set(hex);
  for (let i = 0; i < count; i++) arr.push(_c.r * k, _c.g * k, _c.b * k);
}

/** 지붕 겉면의 높이 함수 */
export function roofSurface(spec: RoofSpec): { R: number; height(x: number, z: number): number; t(x: number, z: number): number } {
  const hip = spec.hip ?? 0.62;
  const R = Math.max(0, spec.W - spec.D * hip);
  const run = spec.W - R;
  const lift = spec.lift ?? spec.H * 0.16;
  const tOf = (x: number, z: number): number => {
    const tz = Math.min(1, Math.abs(z) / spec.D);
    const tx = run > 0 ? Math.min(1, Math.max(0, (Math.abs(x) - R) / run)) : 0;
    return Math.max(tz, tx);
  };
  const height = (x: number, z: number): number => {
    const t = tOf(x, z);
    const along = Math.max(Math.abs(x) / spec.W, Math.abs(z) / spec.D);
    const s = Math.min(1, Math.max(0, (t - 0.5) / 0.5));
    const edge = s * s * (3 - 2 * s);
    return spec.H * Math.pow(1 - t, 1.4) + lift * edge * Math.pow(along, 4);
  };
  return { R, height, t: tOf };
}

export function roofGeometry(spec: RoofSpec): THREE.BufferGeometry {
  const { W, D } = spec;
  const surf = roofSurface(spec);
  const tile = spec.tile ?? 0x4b4f57;
  const tileDark = spec.tileDark ?? 0x363a41;
  const under = spec.under ?? 0x2f6b58;
  const fascia = spec.fascia ?? 0x8a3324;
  const stripe = 0.3;
  const nx = Math.max(8, Math.round((W * 2) / 0.3));
  const nz = Math.max(6, Math.round((D * 2) / 0.45));
  const pos: number[] = [];
  const col: number[] = [];
  const thick = (x: number, z: number): number => 0.12 + 0.22 * surf.t(x, z);
  const P = (i: number, j: number): [number, number, number] => {
    const x = -W + (2 * W * i) / nx;
    const z = -D + (2 * D * j) / nz;
    return [x, surf.height(x, z), z];
  };
  const tri = (a: number[], b: number[], c: number[]): void => {
    pos.push(...a, ...b, ...c);
  };
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const a = P(i, j);
      const b = P(i + 1, j);
      const c = P(i + 1, j + 1);
      const d = P(i, j + 1);
      const cx = (a[0] + c[0]) / 2;
      const cz = (a[2] + c[2]) / 2;
      const tz = Math.abs(cz) / D;
      const tx = surf.R < W ? (Math.abs(cx) - surf.R) / (W - surf.R) : 0;
      // 앞뒤 면은 x를 따라, 옆 면은 z를 따라 기와 골이 진다
      const lane = tz >= tx ? Math.floor(cx / stripe) : Math.floor(cz / stripe);
      const t = surf.t(cx, cz);
      const shade = 0.92 + 0.12 * (1 - t);
      const hex = (lane & 1) === 0 ? tile : tileDark;
      // 겉면 (위를 보게: a, c, b / a, d, c)
      tri(a, c, b);
      tri(a, d, c);
      pushColor(col, hex, shade, 6);
      // 밑면 (아래를 보게, 두께만큼 내려서)
      const down = (p: number[]): number[] => [p[0]!, p[1]! - thick(p[0]!, p[2]!), p[2]!];
      tri(down(a), down(b), down(c));
      tri(down(a), down(c), down(d));
      pushColor(col, under, t > 0.85 ? 1 : 0.75, 6);
    }
  }
  // 처마 끝 둘레: 겉면 가장자리와 밑면 가장자리를 잇는 띠
  const rim = (p: number[], q: number[]): void => {
    const pd = [p[0]!, p[1]! - thick(p[0]!, p[2]!), p[2]!];
    const qd = [q[0]!, q[1]! - thick(q[0]!, q[2]!), q[2]!];
    tri(p, pd, qd);
    tri(p, qd, q);
    pushColor(col, fascia, 1, 6);
  };
  for (let i = 0; i < nx; i++) {
    rim(P(i, nz), P(i + 1, nz));
    rim(P(i + 1, 0), P(i, 0));
  }
  for (let j = 0; j < nz; j++) {
    rim(P(0, j), P(0, j + 1));
    rim(P(nx, j + 1), P(nx, j));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
