// 응원 주막의 옷: 조선 사람의 한복.
// 모두가 같이 입는 것(저고리, 바지, 깃과 동정, 옷고름, 대님, 끝동 두른 넓은 소매, 흰 버선)은 몸통·팔·발 geometry 하나씩에
// 정점 색으로 칠해 한 번에 그린다(이음매 없이 한 덩어리). 차림마다 다른 것(갓, 상투, 도포, 조끼)은 소품으로 얹는다.
// 머리는 사람 번호로 네 가지 차림 중 하나다(누구 화면에서나 같다).
//   0 갓 + 옥색 도포 + 콧수염 + 턱수염   1 상투 + 밤색 조끼 + 콧수염 + 턱수염
//   2 갓 + 쪽빛 도포 + 콧수염            3 상투 + 먹색 조끼 + 콧수염
// 몸통 기준 좌표: 바닥이 y=0, 꼭대기 0.62, 어깨(±0.2, 0.4), 앞이 +z. 입은 사람의 오른쪽이 -x다.
// 머리 기준 좌표: 머리 중심이 원점, 반지름 0.27, 앞이 +z (눈은 y 0.035, z 0.248)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AccessorySpec, AvatarDetailOptions, OutfitSpec } from '../../engine/avatar';

// ---- 색 ----
const HAIR = 0x221d1a;
const GAT = 0x1a1716;
const CHEER_RED = 0xc8321f;
/** 저고리(흰 무명)와 소매 안쪽 그늘 */
const JACKET = 0xf6f0e2;
const JACKET_SHADE = 0xcdbfa6;
/** 바지(잿빛)와 대님(쪽빛 끈) */
const PANTS = 0x9aa3ad;
const DAENIM = 0x2b3554;
/** 깃(쪽빛)과 동정(흰 띠), 옷고름(응원 빨강) */
const COLLAR = 0x2b3554;
const DONGJEONG = 0xffffff;
/** 끝동(소맷부리 단) */
const CUFF = COLLAR;
const GOREUM = CHEER_RED;
/** 버선(흰)과 버선 바닥 */
const BEOSEON = 0xfbf8f2;
const BEOSEON_SOLE = 0xc9c2b6;

const GAT_LOOKS = [0, 2];
const SANGTU_LOOKS = [1, 3];
const GOATEE_LOOKS = [0, 1];

// ---- geometry 도우미 ----
type Hex = number;

/** 정점 색을 한 가지로 칠한다 (색은 sRGB 16진수. three가 선형 값으로 바꿔 준다) */
function paint(g: THREE.BufferGeometry, hex: Hex): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** 위치, 법선, (정점 색)만 남겨 합친다. 모두 색이 있거나(withColor) 모두 없어야 한다 */
function mergeParts(parts: THREE.BufferGeometry[], withColor = false): THREE.BufferGeometry {
  const keep = withColor ? ['position', 'normal', 'color'] : ['position', 'normal'];
  for (const g of parts) {
    for (const name of Object.keys(g.attributes)) if (!keep.includes(name)) g.deleteAttribute(name);
    if (withColor && !g.getAttribute('color')) throw new Error('jumak outfit: 정점 색이 없는 조각');
    if (!g.index) {
      const n = g.getAttribute('position').count;
      g.setIndex(Array.from({ length: n }, (_, i) => i));
    }
  }
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('jumak outfit merge failed');
  for (const g of parts) g.dispose();
  return merged;
}

const seg = (d: { headWidthSegments: number }, min: number): number => Math.max(min, d.headWidthSegments);
const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 단면 하나: 높이 y에서 x 반지름 rx, z 반지름 rz(없으면 rx), z 쪽으로 cz만큼 밀린 타원. 색 하나 */
interface Ring {
  y: number;
  rx: number;
  rz?: number;
  cz?: number;
  color: Hex;
}

/**
 * 단면들을 y축으로 돌려 만든 매끈한 몸 (선반 돌리듯). 이음매 없이 한 바퀴를 이어 붙이고 법선은 이웃 면으로 고르게 낸다.
 * 색이 바뀌는 곳은 높이가 거의 같은 단면 두 개를 겹쳐 두면 경계가 또렷하다.
 * deform으로 각(phi, 0이 앞 +z, +x 쪽으로 커진다)과 높이마다 반지름을 조금씩 바꿀 수 있다.
 */
function revolve(rings: readonly Ring[], segments: number, deform?: (phi: number, y: number) => number): THREE.BufferGeometry {
  const cols = segments;
  const pos = new Float32Array(rings.length * cols * 3);
  const col = new Float32Array(rings.length * cols * 3);
  const c = new THREE.Color();
  rings.forEach((ring, j) => {
    c.setHex(ring.color);
    for (let i = 0; i < cols; i++) {
      const phi = (i / cols) * Math.PI * 2;
      const k = deform ? deform(phi, ring.y) : 1;
      const o = (j * cols + i) * 3;
      pos[o] = Math.sin(phi) * ring.rx * k;
      pos[o + 1] = ring.y;
      pos[o + 2] = (ring.cz ?? 0) + Math.cos(phi) * (ring.rz ?? ring.rx) * k;
      col[o] = c.r;
      col[o + 1] = c.g;
      col[o + 2] = c.b;
    }
  });
  const index: number[] = [];
  for (let j = 0; j < rings.length - 1; j++) {
    // 아래 단면에서 위 단면으로 가면 바깥을 보는 면 (반지름이 줄며 위로 가면 안쪽 면이 된다: 소맷부리 안감)
    for (let i = 0; i < cols; i++) {
      const a = j * cols + i;
      const b = j * cols + ((i + 1) % cols);
      const cc = (j + 1) * cols + ((i + 1) % cols);
      const d = (j + 1) * cols + i;
      index.push(a, b, cc, a, cc, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** 돌린 몸의 겉면. 옆모습(반지름, 높이) 점들 사이를 이어 겉면 위의 점과 법선을 낸다 (띠와 고름을 몸에 붙일 때) */
class Surface {
  constructor(private readonly pts: ReadonlyArray<readonly [number, number]>) {}

  radius(y: number): number {
    const p = this.pts;
    if (y <= p[0]![1]) return p[0]![0];
    for (let i = 1; i < p.length; i++) {
      const [r1, y1] = p[i]!;
      if (y <= y1) {
        const [r0, y0] = p[i - 1]!;
        return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
      }
    }
    return p[p.length - 1]![0];
  }

  /** 겉면의 바깥 법선 (기울기는 조금 넓게 재서 부드럽게) */
  normal(phi: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
    const h = 0.012;
    const slope = (this.radius(y + h) - this.radius(y - h)) / (2 * h);
    const len = Math.hypot(1, slope);
    return out.set(Math.sin(phi) / len, -slope / len, Math.cos(phi) / len);
  }

  /** 각 phi, 높이 y의 겉면에서 법선 쪽으로 lift만큼 띄운 점 */
  point(phi: number, y: number, lift = 0, out = new THREE.Vector3()): THREE.Vector3 {
    const r = this.radius(y);
    const n = this.normal(phi, y);
    return out.set(Math.sin(phi) * r, y, Math.cos(phi) * r).addScaledVector(n, lift);
  }
}

interface BandSample {
  p: THREE.Vector3;
  n: THREE.Vector3;
}

/**
 * 겉면 위의 길(각, 높이 조절점)을 따라가는 표본 점들. 조절점 사이는 매끈하게 잇고 다시 겉면에 붙인다.
 * lift(t)는 길의 처음(0)부터 끝(1)까지 겉면에서 띄우는 높이
 */
function surfacePath(surface: Surface, ctrl: ReadonlyArray<readonly [number, number]>, samples: number, lift: (t: number) => number): BandSample[] {
  const curve = new THREE.CatmullRomCurve3(
    ctrl.map(([phi, y]) => surface.point(phi, y)),
    false,
    'centripetal',
  );
  return curve.getSpacedPoints(samples).map((q, i) => {
    const phi = Math.atan2(q.x, q.z);
    const t = i / samples;
    return { p: surface.point(phi, q.y, lift(t)), n: surface.normal(phi, q.y) };
  });
}

/**
 * 길을 따라가는 납작한 띠(천). 윗면과 양 옆면, 양 끝을 막아 두께가 보인다. 아랫면은 몸에 붙어 안 보이니 없다.
 * offset은 띠 가운데를 길에서 옆(+쪽은 목 쪽)으로 미는 거리
 */
function band(samples: readonly BandSample[], width: number, thick: number, hex: Hex, offset = 0): THREE.BufferGeometry {
  const n = samples.length;
  const bl: THREE.Vector3[] = [];
  const br: THREE.Vector3[] = [];
  const tl: THREE.Vector3[] = [];
  const tr: THREE.Vector3[] = [];
  const t = new THREE.Vector3();
  const w = new THREE.Vector3();
  const up = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const s = samples[i]!;
    t.subVectors(samples[Math.min(n - 1, i + 1)]!.p, samples[Math.max(0, i - 1)]!.p).normalize();
    w.crossVectors(t, s.n).normalize();
    up.crossVectors(w, t).normalize();
    const l = s.p.clone().addScaledVector(w, offset - width / 2);
    const r = s.p.clone().addScaledVector(w, offset + width / 2);
    bl.push(l);
    br.push(r);
    tl.push(l.clone().addScaledVector(up, thick));
    tr.push(r.clone().addScaledVector(up, thick));
  }
  const strip = (a: THREE.Vector3[], b: THREE.Vector3[]): THREE.BufferGeometry => {
    // a[i], b[i]를 잇는 띠. (a, b, 다음 b), (a, 다음 b, 다음 a)
    const pos: number[] = [];
    for (let i = 0; i < n; i++) pos.push(a[i]!.x, a[i]!.y, a[i]!.z, b[i]!.x, b[i]!.y, b[i]!.z);
    const index: number[] = [];
    for (let i = 0; i < n - 1; i++) index.push(2 * i, 2 * i + 1, 2 * i + 3, 2 * i, 2 * i + 3, 2 * i + 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
  };
  const cap = (q: THREE.Vector3[]): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(q.flatMap((v) => [v.x, v.y, v.z]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    return g;
  };
  const parts = [
    strip(tl, tr), // 윗면
    strip(bl, tl), // 왼 옆면 (-w)
    strip(tr, br), // 오른 옆면 (+w)
    cap([bl[0]!, br[0]!, tr[0]!, tl[0]!]),
    cap([br[n - 1]!, bl[n - 1]!, tl[n - 1]!, tr[n - 1]!]),
  ];
  return mergeParts(parts.map((g) => paint(g, hex)), true);
}

/** 겉면의 한 점에 붙인 좌표계 (옆 s, 위 u, 바깥 n). 고름 매듭처럼 몸에 납작하게 붙는 조각을 놓을 때 쓴다 */
function surfaceFrame(surface: Surface, phi: number, y: number, lift: number): THREE.Matrix4 {
  const n = surface.normal(phi, y);
  const upT = new THREE.Vector3(0, 1, 0).addScaledVector(n, -n.y).normalize();
  const s = new THREE.Vector3().crossVectors(upT, n).normalize();
  const u = new THREE.Vector3().crossVectors(n, s).normalize();
  return new THREE.Matrix4().makeBasis(s, u, n).setPosition(surface.point(phi, y, lift));
}

// ---- 몸통: 저고리 + 바지 (한 덩어리) ----
// 옆모습 [반지름, 높이, 색, 고운 분할에서만?]. 아래에서 위로. 색이 바뀌는 곳은 거의 같은 높이에 점을 두 번 둔다
const BODY_PROFILE: ReadonlyArray<readonly [number, number, Hex, boolean?]> = [
  // 바지 밑단: 대님으로 묶은 발목 아래로 살짝 퍼진다
  [0.0, 0.0, PANTS],
  [0.08, 0.005, PANTS, true],
  [0.113, 0.016, PANTS],
  [0.119, 0.0245, PANTS],
  // 대님: 발목을 졸라 맨 쪽빛 끈
  [0.1192, 0.025, DAENIM],
  [0.114, 0.035, DAENIM, true],
  [0.12, 0.046, DAENIM],
  [0.1205, 0.0465, PANTS],
  // 바지: 넉넉하게 부풀었다가 허리로 모인다
  [0.142, 0.066, PANTS],
  [0.17, 0.095, PANTS],
  [0.192, 0.13, PANTS],
  [0.201, 0.165, PANTS],
  [0.2, 0.2, PANTS],
  [0.195, 0.228, PANTS],
  // 저고리 도련(밑단): 살짝 퍼진 단이 바지 위로 덮인다
  [0.1952, 0.2283, JACKET],
  [0.217, 0.232, JACKET],
  [0.225, 0.243, JACKET],
  [0.219, 0.265, JACKET],
  // 허리와 가슴, 어깨
  [0.208, 0.3, JACKET],
  [0.205, 0.345, JACKET, true],
  [0.206, 0.39, JACKET],
  [0.202, 0.43, JACKET],
  [0.191, 0.47, JACKET],
  [0.174, 0.505, JACKET],
  [0.151, 0.535, JACKET],
  [0.122, 0.56, JACKET],
  [0.085, 0.584, JACKET],
  [0.045, 0.603, JACKET, true],
  [0.0, 0.614, JACKET],
];
const BODY_SURFACE = new Surface(BODY_PROFILE.map(([r, y]) => [r, y] as const));

/** 바짓가랑이: 앞뒤 가운데를 살짝 접어 두 다리로 보이게 (발목에서 엉덩이까지) */
function legCrease(phi: number, y: number): number {
  const w = smoothstep(0.004, 0.03, y) * (1 - smoothstep(0.1, 0.17, y));
  if (w <= 0) return 1;
  const toFront = Math.abs(Math.atan2(Math.sin(phi), Math.cos(phi)));
  const toBack = Math.PI - toFront;
  const g = Math.exp(-((toFront / 0.3) ** 2)) + Math.exp(-((toBack / 0.3) ** 2));
  return 1 - 0.1 * w * g;
}

// 깃: 입은 사람의 오른쪽 가슴(안깃 끝, 겉깃 밑에 숨는다)에서 오른쪽 목으로 올라가 목 뒤를 돌고,
// 왼쪽 목에서 오른쪽 가슴으로 비스듬히 내려와 고름에서 끝난다 (왼 섶이 오른 섶을 덮는 우임).
// [각, 높이]. 각은 앞이 0, 입은 사람의 왼쪽(+x)이 +. 한 바퀴를 끊김 없이 돌도록 각을 계속 줄여 간다
const COLLAR_PATH: ReadonlyArray<readonly [number, number]> = [
  [0.12, 0.47],
  [-0.22, 0.503],
  [-0.52, 0.533],
  [-0.9, 0.552],
  [-1.6, 0.562],
  [-2.4, 0.566],
  [-Math.PI, 0.567],
  [-3.9, 0.566],
  [-4.7, 0.562],
  [-5.38, 0.552],
  [-5.76, 0.522],
  [-6.06, 0.488],
  [-6.33, 0.454],
  [-6.58, 0.425],
];
const COLLAR_WIDTH = 0.044;
const COLLAR_THICK = 0.006;
/** 고름이 달리는 곳 (겉깃 끝) */
const GOREUM_AT = { phi: -6.58 + Math.PI * 2, y: 0.425 };

function collar(d: AvatarDetailOptions): THREE.BufferGeometry[] {
  const samples = Math.max(22, d.bodyRadialSegments * 2);
  // 안깃은 낮게, 겉깃은 높게 띄워 겹치는 곳에서 겉깃이 위로 온다
  const path = surfacePath(BODY_SURFACE, COLLAR_PATH, samples, (t) => 0.003 + 0.009 * smoothstep(0.4, 0.62, t));
  // 동정: 깃의 목 쪽 가장자리에 덧댄 흰 띠. 안깃 끝과 겉깃 끝(고름 자리)에는 없다
  const from = Math.round(samples * 0.06);
  const to = Math.round(samples * 0.92);
  const dongjeong = path.slice(from, to + 1).map((s) => ({ p: s.p.clone().addScaledVector(s.n, COLLAR_THICK * 0.7), n: s.n }));
  const dw = 0.017;
  return [band(path, COLLAR_WIDTH, COLLAR_THICK, COLLAR), band(dongjeong, dw, 0.004, DONGJEONG, (COLLAR_WIDTH - dw) / 2)];
}

/** 옷고름: 겉깃 끝의 매듭과 고리 하나, 길이가 다른 두 가닥 */
function goreum(d: AvatarDetailOptions): THREE.BufferGeometry[] {
  const { phi, y } = GOREUM_AT;
  const ws = Math.max(6, d.eyeSegments + 1);
  const knotFrame = surfaceFrame(BODY_SURFACE, phi, y, 0.02);
  const knot = new THREE.SphereGeometry(0.018, ws, Math.max(5, ws - 3)).scale(1.15, 0.95, 0.7).applyMatrix4(knotFrame);
  // 고리: 매듭에서 입은 사람의 오른쪽 위로 비스듬히 나온 납작한 고리 (작게 보여도 고름으로 읽히게 통통한 꽃잎 모양)
  const loopFrame = surfaceFrame(BODY_SURFACE, phi - 0.16, y + 0.014, 0.016);
  const loop = new THREE.SphereGeometry(1, ws, Math.max(5, ws - 3))
    .scale(0.034, 0.017, 0.009)
    .translate(-0.008, 0, 0)
    .rotateZ(-0.42)
    .applyMatrix4(loopFrame);
  const samples = Math.max(6, Math.round(d.bodyRadialSegments * 0.5));
  const tail = (ctrl: ReadonlyArray<readonly [number, number]>, width: number) =>
    band(
      surfacePath(BODY_SURFACE, ctrl, samples, (t) => 0.015 - 0.011 * smoothstep(0, 0.4, t)),
      width,
      0.004,
      GOREUM,
    );
  return [
    paint(knot, GOREUM),
    paint(loop, GOREUM),
    // 긴 가닥은 배까지, 짧은 가닥은 가슴 아래까지
    tail([[phi + 0.02, y - 0.005], [phi - 0.03, y - 0.055], [phi - 0.065, y - 0.105], [phi - 0.09, y - 0.15]], 0.027),
    tail([[phi + 0.05, y - 0.005], [phi + 0.085, y - 0.048], [phi + 0.12, y - 0.092]], 0.024),
  ];
}

/** 고운 분할(내 캐릭터)인가. 남의 캐릭터는 옆모습 점과 표본을 덜 쓴다 */
const fine = (d: AvatarDetailOptions): boolean => d.bodyRadialSegments >= 16;

function hanbokBody(d: AvatarDetailOptions): THREE.BufferGeometry {
  const rings: Ring[] = BODY_PROFILE.filter((p) => fine(d) || !p[3]).map(([r, y, color]) => ({ y, rx: r, color }));
  const shell = revolve(rings, Math.max(14, d.bodyRadialSegments + 2), legCrease);
  return mergeParts([shell, ...collar(d), ...goreum(d)], true);
}

// ---- 소매: 끝으로 갈수록 넓어지고 뒤쪽 아래가 둥글게 처진 배래, 손이 나오는 소맷부리 ----
// 팔이 늘어지면 앞뒤(z)로 넓은 납작한 소매가 되고, 앞으로 들면 뒤쪽 불룩한 곳이 아래로 처진다
const SLEEVE_RINGS: readonly Ring[] = [
  { y: 0.03, rx: 0.0, color: JACKET },
  { y: 0.024, rx: 0.03, rz: 0.034, color: JACKET },
  { y: 0.006, rx: 0.046, rz: 0.052, color: JACKET },
  { y: -0.035, rx: 0.055, rz: 0.064, cz: -0.006, color: JACKET },
  { y: -0.085, rx: 0.062, rz: 0.077, cz: -0.014, color: JACKET },
  { y: -0.128, rx: 0.065, rz: 0.085, cz: -0.019, color: JACKET },
  { y: -0.146, rx: 0.0645, rz: 0.084, cz: -0.018, color: JACKET },
  // 끝동: 소맷부리에 두른 쪽빛 단 (깃과 같은 색. 손과 소매가 또렷이 갈린다)
  { y: -0.1462, rx: 0.0645, rz: 0.084, cz: -0.018, color: CUFF },
  { y: -0.162, rx: 0.062, rz: 0.078, cz: -0.015, color: CUFF },
  { y: -0.175, rx: 0.057, rz: 0.068, cz: -0.009, color: CUFF },
  { y: -0.18, rx: 0.051, rz: 0.058, cz: -0.005, color: CUFF },
  // 소맷부리 안쪽 (위로 접혀 들어가 손목을 감싼다)
  { y: -0.1795, rx: 0.046, rz: 0.051, cz: -0.004, color: JACKET_SHADE },
  { y: -0.168, rx: 0.04, rz: 0.044, cz: -0.003, color: JACKET_SHADE },
  { y: -0.15, rx: 0.0, color: JACKET_SHADE },
];

function hanbokSleeve(d: AvatarDetailOptions): THREE.BufferGeometry {
  // 단면은 어깨에서 소맷부리로 적었지만, 바깥을 보는 면이 되도록 아래에서 위로 돌린다
  return revolve([...SLEEVE_RINGS].reverse(), Math.max(10, d.bodyRadialSegments - 2));
}

// ---- 발: 코가 위로 살짝 들린 흰 버선 (평상에는 신을 벗고 오른다) ----
function hanbokFoot(d: AvatarDetailOptions): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.07, Math.max(9, d.eyeSegments + 4), Math.max(5, d.eyeSegments - 1)).scale(1, 0.6, 1.3);
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const sole = new THREE.Color(BEOSEON_SOLE);
  const sock = new THREE.Color(BEOSEON);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // 버선코: 앞으로 갈수록 가늘어지며 위로 들려 뾰족해진다
    const toe = smoothstep(0.02, 0.091, z);
    pos.setXYZ(i, x * (1 - 0.55 * toe), y * (1 - 0.4 * toe) + 0.032 * toe * toe, z + 0.014 * toe);
    const c = y < -0.022 && toe < 0.6 ? sole : sock;
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

// ---- 도포와 조끼: 몸 위에 한 겹 더 입는 앞트임 옷 ----
interface ShellSpec {
  /** 옷의 옆모습 [반지름, 높이]. 아래에서 위로. 마지막 점이 뒷목 쪽 윗단 */
  profile: ReadonlyArray<readonly [number, number]>;
  /** 높이 y에서 앞 가운데로부터 트인 각(한쪽, 라디안) */
  gap: (y: number) => number;
  /** 한 바퀴 기둥 수 */
  cols: number;
  color: Hex;
  /** 앞섶 가장자리와 윗단에 두르는 선(깃)의 색과 폭(m). 0이면 두르지 않는다 */
  trim: Hex;
  trimWidth: number;
  /** 단 두께(m). 가장자리에서 보인다 */
  thick: number;
}

/**
 * 몸을 감싸는 겉옷 한 겹. 앞이 트여 있고(트임은 높이마다 다르다), 앞섶 가장자리와 윗단에 선을 두르며,
 * 가장자리에는 두께를 붙여 종잇장처럼 보이지 않게 한다. 정점 색을 쓴다.
 */
function shell(spec: ShellSpec): THREE.BufferGeometry {
  const surface = new Surface(spec.profile);
  const rows = spec.profile.length;
  const top = spec.profile[rows - 1]![1];
  // 기둥: 앞섶 선(trim) 두 줄 + 경계 + 가운데 고르게. 한 줄의 각은 높이마다 트임에 맞춰 늘고 준다
  const inner = Math.max(6, spec.cols);
  const grid: THREE.Vector3[][] = [];
  const colors: Hex[][] = [];
  for (let j = 0; j < rows; j++) {
    const [r, y] = spec.profile[j]!;
    const g = spec.gap(y);
    const span = Math.PI * 2 - g * 2;
    const tw = spec.trimWidth > 0 ? Math.min(0.25 * span, spec.trimWidth / Math.max(0.05, r)) : 0;
    const eps = 0.002;
    const phis: number[] = [];
    const cols: Hex[] = [];
    const rowTrim = spec.trimWidth > 0 && top - y < spec.trimWidth * 0.8;
    const push = (phi: number, trim: boolean) => {
      phis.push(phi);
      cols.push(trim || rowTrim ? spec.trim : spec.color);
    };
    if (tw > 0) {
      push(g, true);
      push(g + tw, true);
    }
    for (let i = 0; i <= inner; i++) push(g + tw + eps + ((span - 2 * tw - 2 * eps) * i) / inner, false);
    if (tw > 0) {
      push(Math.PI * 2 - g - tw, true);
      push(Math.PI * 2 - g, true);
    }
    grid.push(phis.map((phi) => surface.point(phi, y)));
    colors.push(cols);
  }
  const width = grid[0]!.length;
  const at = (j: number, i: number) => j * width + i;

  // 겉면
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < width; i++) {
      const v = grid[j]![i]!;
      pos.push(v.x, v.y, v.z);
      c.setHex(colors[j]![i]!);
      col.push(c.r, c.g, c.b);
    }
  }
  const index: number[] = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < width - 1; i++) index.push(at(j, i), at(j, i + 1), at(j + 1, i + 1), at(j, i), at(j + 1, i + 1), at(j + 1, i));
  }
  const outer = new THREE.BufferGeometry();
  outer.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  outer.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  outer.setIndex(index);
  outer.computeVertexNormals();

  // 가장자리 두께: 밑단, 윗단, 앞섶 두 줄을 따라 안쪽으로 접어 든 띠
  const rim = (cells: Array<[number, number]>, toward: Array<[number, number]>): THREE.BufferGeometry => {
    const p: number[] = [];
    const cc: number[] = [];
    const nrm = new THREE.Vector3();
    cells.forEach(([j, i]) => {
      const v = grid[j]![i]!;
      const phi = Math.atan2(v.x, v.z);
      surface.normal(phi, v.y, nrm);
      const inside = v.clone().addScaledVector(nrm, -spec.thick);
      p.push(v.x, v.y, v.z, inside.x, inside.y, inside.z);
      c.setHex(colors[j]![i]!);
      cc.push(c.r, c.g, c.b, c.r, c.g, c.b);
    });
    const idx: number[] = [];
    const tri = new THREE.Triangle();
    const fn = new THREE.Vector3();
    const out = new THREE.Vector3();
    const vtx = (k: number) => new THREE.Vector3(p[k * 3]!, p[k * 3 + 1]!, p[k * 3 + 2]!);
    for (let k = 0; k < cells.length - 1; k++) {
      const a = 2 * k;
      const b = 2 * k + 1;
      const a2 = 2 * k + 2;
      const b2 = 2 * k + 3;
      // 가장자리 바깥쪽(안쪽 이웃에서 가장자리로 가는 방향)을 보게 감는다
      const [tj, ti] = toward[k]!;
      const [cj, ci] = cells[k]!;
      out.subVectors(grid[cj]![ci]!, grid[tj]![ti]!);
      tri.set(vtx(a), vtx(b), vtx(b2)).getNormal(fn);
      if (fn.dot(out) >= 0) idx.push(a, b, b2, a, b2, a2);
      else idx.push(a, b2, b, a, a2, b2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  const hem = rim(
    Array.from({ length: width }, (_, i) => [0, i] as [number, number]),
    Array.from({ length: width }, (_, i) => [1, i] as [number, number]),
  );
  const neck = rim(
    Array.from({ length: width }, (_, i) => [rows - 1, i] as [number, number]),
    Array.from({ length: width }, (_, i) => [rows - 2, i] as [number, number]),
  );
  const left = rim(
    Array.from({ length: rows }, (_, j) => [j, 0] as [number, number]),
    Array.from({ length: rows }, (_, j) => [j, 1] as [number, number]),
  );
  const right = rim(
    Array.from({ length: rows }, (_, j) => [j, width - 1] as [number, number]),
    Array.from({ length: rows }, (_, j) => [j, width - 2] as [number, number]),
  );
  return mergeParts([outer, hem, neck, left, right], true);
}

// 도포: 목에서 발목 위까지 내려오는 긴 겉옷. 가슴에서 세조대로 여미고, 위로는 V로 트여 저고리 깃과 고름이 보이고,
// 아래로는 살짝 벌어져 바지가 보인다. 소매 없는 쾌자처럼 흰 저고리 소매가 나온다
// [반지름, 높이, 고운 분할에서만?]
const DOPO_PROFILE: ReadonlyArray<readonly [number, number, boolean?]> = [
  [0.228, 0.1],
  [0.226, 0.14, true],
  [0.226, 0.18],
  [0.23, 0.215],
  [0.242, 0.24],
  [0.24, 0.27],
  [0.231, 0.31],
  [0.226, 0.345],
  [0.225, 0.375],
  [0.223, 0.41],
  [0.217, 0.445],
  [0.204, 0.48],
  [0.186, 0.51],
  [0.165, 0.533],
  [0.152, 0.545],
];
const SASH_Y = 0.36;
function dopoGap(y: number): number {
  if (y >= SASH_Y) return 0.11 + 1.0 * Math.sqrt((y - SASH_Y) / (0.545 - SASH_Y));
  return 0.11 + (SASH_Y - y) * 0.28;
}
const DOPO_SURFACE = new Surface(DOPO_PROFILE.map(([r, y]) => [r, y] as const));

function dopo(color: Hex, trim: Hex) {
  return (d: AvatarDetailOptions): THREE.BufferGeometry => {
    const profile = DOPO_PROFILE.filter((p) => fine(d) || !p[2]).map(([r, y]) => [r, y] as const);
    const robe = shell({ profile, gap: dopoGap, cols: Math.max(14, d.bodyRadialSegments + 2), color, trim, trimWidth: 0.03, thick: 0.008 });
    // 등솔기: 뒤 가운데를 따라 내려오는 선 (뒤에서 봐도 옷으로 읽히게)
    const seam = surfacePath(DOPO_SURFACE, [[Math.PI, 0.54], [Math.PI, 0.3], [Math.PI, 0.1]], Math.max(6, Math.round(d.bodyRadialSegments * 0.5)), () => 0.001);
    return mergeParts([robe, band(seam, 0.012, 0.003, trim)], true);
  };
}

/** 세조대: 가슴에 두른 붉은 띠, 입은 사람의 왼쪽 앞 매듭에서 늘어진 두 가닥과 술 */
function sejodae(d: AvatarDetailOptions): THREE.BufferGeometry {
  const radial = Math.max(4, Math.round(d.eyeSegments * 0.7));
  const ring = new THREE.TorusGeometry(DOPO_SURFACE.radius(SASH_Y) + 0.006, 0.009, radial, Math.max(18, Math.round(d.bodyRadialSegments * 1.5)))
    .rotateX(Math.PI / 2)
    .translate(0, SASH_Y, 0);
  const knotPhi = 0.42;
  const knot = new THREE.SphereGeometry(0.017, radial + 3, radial).scale(1.2, 1, 0.8).applyMatrix4(surfaceFrame(DOPO_SURFACE, knotPhi, SASH_Y, 0.014));
  const parts: THREE.BufferGeometry[] = [ring, knot];
  for (const [dphi, len] of [
    [-0.03, 0.12],
    [0.08, 0.155],
  ] as const) {
    const pts = [0, 0.33, 0.66, 1].map((t) => DOPO_SURFACE.point(knotPhi + dphi * t, SASH_Y - len * t, 0.013));
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), fine(d) ? 6 : 4, 0.0055, 4, false));
    const end = pts[3]!;
    const out = DOPO_SURFACE.normal(knotPhi + dphi, end.y).multiplyScalar(0.006);
    parts.push(new THREE.SphereGeometry(0.01, radial + 1, radial - 1).translate(end.x + out.x, end.y - 0.004, end.z + out.z));
    parts.push(new THREE.CylinderGeometry(0.007, 0.017, 0.045, radial + 1).translate(end.x + out.x * 1.6, end.y - 0.03, end.z + out.z * 1.6));
  }
  return mergeParts(parts);
}

// 조끼: 저고리 위에 꼭 맞게 입는 짧은 조끼. 앞이 곧게 트이고 위로 V가 지며, 한쪽 섶에 놋쇠 단추 셋
const JOKKI_PROFILE: ReadonlyArray<readonly [number, number]> = [
  // 조끼 밑단은 저고리 도련보다 조금 위라 흰 도련이 밑으로 살짝 보인다
  [0.231, 0.262],
  [0.23, 0.278],
  [0.224, 0.305],
  [0.221, 0.345],
  [0.221, 0.39],
  [0.216, 0.43],
  [0.203, 0.47],
  [0.184, 0.503],
  [0.161, 0.527],
];
const JOKKI_SURFACE = new Surface(JOKKI_PROFILE);
function jokkiGap(y: number): number {
  return y < 0.36 ? 0.15 : 0.15 + 0.95 * Math.pow((y - 0.36) / (0.527 - 0.36), 0.6);
}
const BRASS = 0xd9a441;

function jokki(color: Hex, trim: Hex) {
  return (d: AvatarDetailOptions): THREE.BufferGeometry => {
    const body = shell({ profile: JOKKI_PROFILE, gap: jokkiGap, cols: Math.max(14, d.bodyRadialSegments + 2), color, trim, trimWidth: 0.018, thick: 0.007 });
    const ws = Math.max(6, d.eyeSegments);
    const buttons = [0.29, 0.325, 0.36].map((y) =>
      paint(
        new THREE.SphereGeometry(0.0115, ws, Math.max(4, ws - 2)).scale(1, 1, 0.55).applyMatrix4(surfaceFrame(JOKKI_SURFACE, jokkiGap(y) + 0.085, y, 0.004)),
        BRASS,
      ),
    );
    return mergeParts([body, ...buttons], true);
  };
}

// ---- 머리 소품 (갓, 상투, 수염) ----
const HEAD_ACCESSORIES: AccessorySpec[] = [
  {
    // 머리카락(정수리를 덮는 반구) + 망건 + 콧수염(양옆으로 처진 두 가닥). 모든 차림이 같은 색이라 하나로 그린다
    key: 'hair',
    attach: 'head',
    create: (d) => {
      const ws = Math.max(6, d.eyeSegments);
      return mergeParts([
        new THREE.SphereGeometry(0.277, seg(d, 12), Math.max(5, d.headHeightSegments), 0, Math.PI * 2, 0, 1.12),
        new THREE.TorusGeometry(0.244, 0.024, Math.max(4, Math.round(d.eyeSegments / 2)), seg(d, 10))
          .rotateX(Math.PI / 2)
          .translate(0, 0.118, 0),
        ...[-1, 1].map((side) =>
          new THREE.SphereGeometry(1, ws, Math.max(4, ws - 2))
            .scale(0.058, 0.016, 0.022)
            .rotateZ(side * -0.38)
            .translate(side * 0.05, -0.05, 0.262),
        ),
      ]);
    },
    color: HAIR,
    position: [0, 0, 0],
  },
  {
    // 갓: 넓은 챙과 원통 모자
    key: 'gat',
    tall: true,
    attach: 'head',
    looks: GAT_LOOKS,
    create: (d) =>
      mergeParts([
        new THREE.CylinderGeometry(0.38, 0.38, 0.014, seg(d, 14)).translate(0, 0.205, 0),
        new THREE.CylinderGeometry(0.15, 0.19, 0.17, seg(d, 12)).translate(0, 0.205 + 0.085, 0),
      ]),
    color: GAT,
    position: [0, 0, 0],
    rotation: [-0.08, 0, 0],
  },
  {
    // 갓끈: 챙 양옆에서 턱 옆으로 늘어진 붉은 구슬 줄
    key: 'gatkkeun',
    tall: true,
    attach: 'head',
    looks: GAT_LOOKS,
    create: (d) => {
      const beads: THREE.BufferGeometry[] = [];
      const ws = Math.max(5, Math.round(d.eyeSegments * 0.8));
      for (const side of [-1, 1]) {
        for (let i = 0; i < 7; i++) {
          const y = 0.18 - i * 0.05;
          const x = side * (0.275 + i * 0.004);
          beads.push(new THREE.SphereGeometry(0.019, ws, Math.max(3, ws - 2)).translate(x, y, 0.07 + i * 0.012));
        }
      }
      return mergeParts(beads);
    },
    color: CHEER_RED,
    position: [0, 0, 0],
  },
  {
    // 상투: 정수리에 틀어 올린 머리와 가로지른 동곳
    key: 'sangtu',
    tall: true,
    attach: 'head',
    looks: SANGTU_LOOKS,
    create: (d) =>
      mergeParts([
        new THREE.SphereGeometry(0.075, seg(d, 10), Math.max(5, d.headHeightSegments)).scale(1, 1.25, 1).translate(0, 0.31, -0.02),
        new THREE.CylinderGeometry(0.05, 0.075, 0.06, seg(d, 8)).translate(0, 0.26, -0.02),
        new THREE.CylinderGeometry(0.009, 0.009, 0.2, 6).rotateZ(Math.PI / 2).translate(0, 0.32, -0.02),
      ]),
    color: HAIR,
    position: [0, 0, 0],
  },
  {
    // 턱수염: 턱 아래로 뾰족하게
    key: 'goatee',
    attach: 'head',
    looks: GOATEE_LOOKS,
    create: (d) => new THREE.ConeGeometry(0.05, 0.15, Math.max(6, d.eyeSegments)).rotateX(Math.PI - 0.45).translate(0, -0.2, 0.2),
    color: HAIR,
    position: [0, 0, 0],
  },
];

// ---- 차림마다 다른 겉옷 ----
const OUTER_ACCESSORIES: AccessorySpec[] = [
  { key: 'dopo-jade', attach: 'body', looks: [0], create: dopo(0x8fc9b0, 0x4f8f78), vertexColors: true, color: 0xffffff, position: [0, 0, 0] },
  { key: 'dopo-indigo', attach: 'body', looks: [2], create: dopo(0x7b98d4, 0x3f5a99), vertexColors: true, color: 0xffffff, position: [0, 0, 0] },
  { key: 'sejodae', attach: 'body', looks: GAT_LOOKS, create: sejodae, color: 0xb3261e, position: [0, 0, 0] },
  { key: 'jokki-brown', attach: 'body', looks: [1], create: jokki(0x5e412d, 0x3e2a1d), vertexColors: true, color: 0xffffff, position: [0, 0, 0] },
  { key: 'jokki-ink', attach: 'body', looks: [3], create: jokki(0x3d3f47, 0x26272d), vertexColors: true, color: 0xffffff, position: [0, 0, 0] },
];

export const JUMAK_OUTFIT: OutfitSpec = {
  id: 'jumak',
  // 옷 색은 정점 색에 다 들어 있다 (재질은 흰색을 곱한다)
  bodyColor: 0xffffff,
  skinColor: 0xf6d7b8,
  looks: 4,
  body: hanbokBody,
  arm: hanbokSleeve,
  foot: hanbokFoot,
  accessories: [...HEAD_ACCESSORIES, ...OUTER_ACCESSORIES],
};
