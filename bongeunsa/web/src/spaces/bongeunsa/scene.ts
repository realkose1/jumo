// 봉은사 장면을 조립한다: 절(build.ts)과 현판, 범종, 연등 줄, 석등 불, 담장 너머 빌딩, 하늘과 해, 동작 효과, 소리.
// 하늘은 서울의 실제 해 위치를 따라 낮과 밤이 바뀐다. 밤에는 연등과 석등, 빌딩 창이 켜진다.
// 정시마다 범종이 울린다(새벽 4시와 저녁 6시 예불에는 더 많이). 모두가 서버 시각으로 같은 순간에 듣는다.
import * as THREE from 'three';
import type { SceneContext, SceneHandle } from '../../engine/types';
import { seeded } from './batch';
import { GATE_HALL, PAVILION_HALL, buildTemple, signPlacement } from './build';
import { daylightLevel, solarPosition, twilightLevel } from './daylight';
import {
  BELL_PAVILION,
  DAEUNGJEON,
  JIJANGJEON,
  LANTERN_ROWS,
  LANTERN_SPACING,
  PANJEON,
  SEONBULDANG,
  SPAWN,
  STONE_LANTERNS,
  WALK_BLOCKERS,
  WALK_BOUNDS,
  cameraObstacles,
  groundHeight,
  type HallSpec,
} from './layout';
import { BongeunsaSound, type SoundSource } from './sound';

/** 연등 색: 연등 동작의 변형 번호(v)가 이 순서다 (shared LANTERN_VARIANTS와 같은 개수) */
export const LANTERN_COLORS = [0xf06a8a, 0xe8452f, 0xf7c531, 0x52b26b, 0x4f86d9, 0xf6efe0] as const;

/** 장면이 attach(index.ts)에 열어 주는 기능 */
export interface BongeunsaStage {
  /** 동작 효과와 소리. at은 그 사람 머리 위 */
  actionEffect(actionId: string, at: THREE.Vector3, variant: number | undefined, source: SoundSource): void;
  /** 개발 중 확인용 */
  describe(): { meshes: number; triangles: number };
}

const DAY_SKY = new THREE.Color(0xb9d5ee);
const NIGHT_SKY = new THREE.Color(0x0d1630);
const DUSK_SKY = new THREE.Color(0xeea36e);
const DAY_FOG = new THREE.Color(0xd5e2ec);
const NIGHT_FOG = new THREE.Color(0x141b33);

// ---- 현판 ----
function signTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 184;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, 184);
    g.addColorStop(0, '#2b2117');
    g.addColorStop(1, '#17110b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 184);
    // 단청 테두리
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#2f7f69';
    ctx.strokeRect(6, 6, 500, 172);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#d8a640';
    ctx.strokeRect(18, 18, 476, 148);
    // 옛 현판처럼 오른쪽에서 왼쪽으로 쓴다
    const chars = [...text].reverse();
    ctx.fillStyle = '#f0d27a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const size = chars.length > 2 ? 104 : 118;
    ctx.font = `700 ${size}px "Noto Serif KR", "Nanum Myeongjo", "AppleMyungjo", "Batang", serif`;
    const step = 440 / chars.length;
    chars.forEach((c, i) => ctx.fillText(c, 36 + step * (i + 0.5), 96));
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---- 빌딩 ----
function windowTextures(): { map: THREE.CanvasTexture; glow: THREE.CanvasTexture } {
  const size = 128;
  const make = (): [HTMLCanvasElement, CanvasRenderingContext2D | null] => {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    return [c, c.getContext('2d')];
  };
  const [mc, m] = make();
  const [gc, g] = make();
  const rand = seeded(11);
  if (m && g) {
    m.fillStyle = '#5d6b78';
    m.fillRect(0, 0, size, size);
    g.fillStyle = '#000';
    g.fillRect(0, 0, size, size);
    // 4 x 4 창. 창 사이 기둥은 밝은 회색, 창은 하늘을 비추는 푸른 유리
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const x = i * 32 + 4;
        const y = j * 32 + 6;
        m.fillStyle = rand() < 0.5 ? '#8fa9c0' : '#7d97b0';
        m.fillRect(x, y, 24, 20);
        if (rand() < 0.55) {
          g.fillStyle = rand() < 0.7 ? '#ffe3a8' : '#dbe8ff';
          g.fillRect(x, y, 24, 20);
        }
      }
    }
  }
  const wrap = (c: HTMLCanvasElement): THREE.CanvasTexture => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: wrap(mc), glow: wrap(gc) };
}

/** 담장 너머 강남의 빌딩들 (x, z, 너비, 높이). 남쪽 큰길 건너, 동쪽, 북쪽에 선다 */
const TOWERS: ReadonlyArray<[number, number, number, number]> = [
  [-62, 82, 22, 52],
  [-28, 78, 16, 38],
  [14, 88, 18, 72],
  [52, 80, 22, 46],
  [92, 98, 20, 62],
  [74, 22, 18, 118],
  [80, -28, 22, 52],
  [68, -78, 26, 40],
  [-18, -88, 30, 34],
  [28, -96, 22, 60],
  [-82, -22, 24, 44],
  [-74, 42, 20, 36],
  [-96, 96, 26, 30],
  [110, 40, 24, 70],
];

function towerGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const [x, z, w, h] of TOWERS) {
    const add = (bw: number, bh: number, by: number): void => {
      const g = new THREE.BoxGeometry(bw, bh, bw);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      // 면마다 창 크기가 같도록 uv를 늘린다 (창 하나 약 2m x 3.4m)
      for (let face = 0; face < 6; face++) {
        const top = face === 2 || face === 3;
        for (let k = 0; k < 4; k++) {
          const i = face * 4 + k;
          if (top) uv.setXY(i, 0, 0);
          else uv.setXY(i, uv.getX(i) * (bw / 8), uv.getY(i) * (bh / 13.6));
        }
      }
      g.translate(x, by + bh / 2, z);
      parts.push(g);
    };
    add(w, h, 0);
    if (h > 50) add(w * 0.7, h * 0.12, h);
  }
  const merged = mergeBoxes(parts);
  return merged;
}

function mergeBoxes(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0;
  let idx = 0;
  for (const p of parts) {
    count += p.getAttribute('position').count;
    idx += p.index!.count;
  }
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const index = new Uint32Array(idx);
  let vo = 0;
  let io = 0;
  for (const p of parts) {
    const n = p.getAttribute('position').count;
    pos.set(p.getAttribute('position').array as Float32Array, vo * 3);
    nor.set(p.getAttribute('normal').array as Float32Array, vo * 3);
    uv.set(p.getAttribute('uv').array as Float32Array, vo * 2);
    const src = p.index!.array;
    for (let i = 0; i < src.length; i++) index[io + i] = src[i]! + vo;
    vo += n;
    io += src.length;
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  return g;
}

// ---- 연등 줄 ----
interface LanternString {
  mesh: THREE.InstancedMesh;
  tassels: THREE.InstancedMesh;
  wires: THREE.LineSegments;
  base: Array<{ x: number; y: number; z: number; phase: number }>;
}

function sag(t: number, depth: number): number {
  return -depth * 4 * t * (1 - t);
}

function buildLanternStrings(owned: Array<{ dispose(): void }>): LanternString {
  const rand = seeded(5);
  const base: LanternString['base'] = [];
  const wirePts: number[] = [];
  for (const row of LANTERN_ROWS) {
    const len = row.x1 - row.x0;
    const n = Math.floor(len / LANTERN_SPACING);
    const depth = 0.35 + len * 0.012;
    const segs = 24;
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs;
      const t1 = (i + 1) / segs;
      wirePts.push(row.x0 + len * t0, row.y + sag(t0, depth), row.z, row.x0 + len * t1, row.y + sag(t1, depth), row.z);
    }
    for (let i = 1; i < n; i++) {
      const t = i / n;
      base.push({ x: row.x0 + len * t, y: row.y + sag(t, depth) - 0.32, z: row.z, phase: rand() * Math.PI * 2 });
    }
  }
  const geo = new THREE.SphereGeometry(0.21, 12, 8).scale(1, 0.88, 1);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const mesh = new THREE.InstancedMesh(geo, mat, base.length);
  const tGeo = new THREE.CylinderGeometry(0.035, 0.012, 0.32, 5).translate(0, -0.33, 0);
  const tMat = new THREE.MeshBasicMaterial({ color: 0xfff4d2 });
  const tassels = new THREE.InstancedMesh(tGeo, tMat, base.length);
  const c = new THREE.Color();
  const palette = [0xf06a8a, 0xf06a8a, 0xe8452f, 0xf7c531, 0x52b26b, 0x4f86d9, 0xf6efe0, 0xf29a3a];
  base.forEach((_b, i) => {
    c.set(palette[Math.floor(rand() * palette.length)]!);
    mesh.setColorAt(i, c);
  });
  const wGeo = new THREE.BufferGeometry();
  wGeo.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
  const wMat = new THREE.LineBasicMaterial({ color: 0x3a3430 });
  const wires = new THREE.LineSegments(wGeo, wMat);
  owned.push(geo, mat, tGeo, tMat, wGeo, wMat);
  return { mesh, tassels, wires, base };
}

// ---- 하늘을 오르는 연등 (연등 동작) ----
interface Floater {
  group: THREE.Group;
  mat: THREE.MeshBasicMaterial;
  t: number;
  start: THREE.Vector3;
  phase: number;
  active: boolean;
}

const FLOAT_SECONDS = 7;

// ---- 발밑 물결 (합장, 목탁) ----
interface Ripple {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t: number;
  dur: number;
  size: number;
  active: boolean;
}

export async function createBongeunsaScene(ctx: SceneContext): Promise<SceneHandle> {
  const { scene, camera } = ctx;
  const owned: Array<{ dispose(): void }> = [];
  const added: THREE.Object3D[] = [];
  const add = <T extends THREE.Object3D>(obj: T): T => {
    scene.add(obj);
    added.push(obj);
    return obj;
  };

  // 멀리 있는 빌딩까지 보이도록 카메라를 길게 본다 (장면을 닫을 때 되돌린다)
  const prevFar = camera.far;
  camera.far = 420;
  camera.updateProjectionMatrix();

  // ---- 절 ----
  const temple = buildTemple();
  const templeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  owned.push(temple.geometry, templeMat);
  const templeMesh = add(new THREE.Mesh(temple.geometry, templeMat));
  templeMesh.castShadow = true;
  templeMesh.receiveShadow = true;
  ctx.reportProgress(0.45);
  await Promise.resolve();

  // ---- 현판 ----
  const signs: Array<{ hall: HallSpec; y?: number }> = [
    { hall: DAEUNGJEON },
    { hall: PANJEON },
    { hall: SEONBULDANG },
    { hall: JIJANGJEON },
    { hall: GATE_HALL },
    { hall: PAVILION_HALL, y: temple.pavilionSignY },
  ];
  for (const s of signs) {
    const p = signPlacement(s.hall);
    if (s.y !== undefined) p.pos.y = s.y;
    const tex = signTexture(s.hall.sign);
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    const geo = new THREE.PlaneGeometry(p.width, p.width * 0.36);
    owned.push(tex, mat, geo);
    const sign = add(new THREE.Mesh(geo, mat));
    sign.position.copy(p.pos);
    sign.rotation.set(-0.12, p.ry, 0, 'YXZ');
  }
  // 법왕루는 남쪽(진여문 쪽)에서도 현판이 보이게 뒤쪽이 아니라 앞쪽에 건다: 위 signPlacement가 앞면(+z)이다

  // ---- 범종 ----
  const bellGroup = add(new THREE.Group());
  bellGroup.position.set(BELL_PAVILION.x, temple.bellBeamY, BELL_PAVILION.z);
  const bellProfile = [
    [0.0, 0],
    [0.5, 0],
    [0.55, -0.12],
    [0.6, -0.5],
    [0.66, -1.1],
    [0.76, -1.55],
    [0.9, -1.85],
    [0.94, -1.95],
    [0.86, -1.97],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const bellGeo = new THREE.LatheGeometry(bellProfile, 28);
  const bellMat = new THREE.MeshLambertMaterial({ color: 0x55705f, side: THREE.DoubleSide });
  const bell = new THREE.Mesh(bellGeo, bellMat);
  bell.castShadow = true;
  // 용뉴(종 고리)
  const hookGeo = new THREE.TorusGeometry(0.18, 0.06, 6, 12);
  const hook = new THREE.Mesh(hookGeo, bellMat);
  hook.position.y = 0.12;
  bellGroup.add(bell, hook);
  owned.push(bellGeo, bellMat, hookGeo);
  // 당목: 종 옆에 줄로 매단 통나무. 칠 때 뒤로 갔다가 종을 친다
  const logPivot = add(new THREE.Group());
  logPivot.position.set(BELL_PAVILION.x + 1.75, temple.bellBeamY + 0.1, BELL_PAVILION.z);
  const logGeo = new THREE.CylinderGeometry(0.13, 0.13, 1.5, 10).rotateZ(Math.PI / 2).translate(0, -1.25, 0);
  const logMat = new THREE.MeshLambertMaterial({ color: 0x7a5a3c });
  const ropeGeo = new THREE.CylinderGeometry(0.015, 0.015, 1.25, 4).translate(0, -0.62, 0);
  const ropeMat = new THREE.MeshLambertMaterial({ color: 0xd9c9a3 });
  logPivot.add(new THREE.Mesh(logGeo, logMat));
  for (const dx of [-0.5, 0.5]) {
    const rope = new THREE.Mesh(ropeGeo, ropeMat);
    rope.position.x = dx;
    logPivot.add(rope);
  }
  owned.push(logGeo, logMat, ropeGeo, ropeMat);

  // ---- 연등 줄 ----
  const strings = buildLanternStrings(owned);
  add(strings.mesh);
  add(strings.tassels);
  add(strings.wires);
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _v = new THREE.Vector3();
  const _s = new THREE.Vector3(1, 1, 1);
  const placeLanterns = (elapsed: number, sway: number): void => {
    strings.base.forEach((b, i) => {
      const a = sway * Math.sin(elapsed * 1.3 + b.phase);
      _e.set(0, 0, a);
      _q.setFromEuler(_e);
      _v.set(b.x, b.y, b.z);
      _m.compose(_v, _q, _s);
      strings.mesh.setMatrixAt(i, _m);
      strings.tassels.setMatrixAt(i, _m);
    });
    strings.mesh.instanceMatrix.needsUpdate = true;
    strings.tassels.instanceMatrix.needsUpdate = true;
  };
  placeLanterns(0, 0);

  // ---- 석등 불 ----
  const fireGeo = new THREE.SphereGeometry(0.12, 8, 6);
  const fireMat = new THREE.MeshBasicMaterial({ color: 0xffc56b });
  owned.push(fireGeo, fireMat);
  for (const l of STONE_LANTERNS) {
    const f = add(new THREE.Mesh(fireGeo, fireMat));
    f.position.set(l.x, temple.stoneLanternFireY, l.z);
  }

  // ---- 빌딩 ----
  const win = windowTextures();
  const towerGeo = towerGeometry();
  const towerMat = new THREE.MeshLambertMaterial({ map: win.map, emissiveMap: win.glow, emissive: 0xffffff, emissiveIntensity: 0 });
  owned.push(win.map, win.glow, towerGeo, towerMat);
  add(new THREE.Mesh(towerGeo, towerMat));
  ctx.reportProgress(0.7);

  // ---- 하늘, 별, 빛 ----
  scene.background = DAY_SKY.clone();
  const fog = new THREE.Fog(DAY_FOG.clone(), 70, 330);
  const prevFog = scene.fog;
  scene.fog = fog;
  const starPos: number[] = [];
  const srand = seeded(23);
  for (let i = 0; i < 500; i++) {
    const th = srand() * Math.PI * 2;
    const ph = Math.acos(1 - srand() * 0.95);
    starPos.push(300 * Math.sin(ph) * Math.cos(th), 300 * Math.cos(ph), 300 * Math.sin(ph) * Math.sin(th));
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  owned.push(starGeo, starMat);
  const stars = add(new THREE.Points(starGeo, starMat));
  const moonGeo = new THREE.SphereGeometry(6, 16, 12);
  const moonMat = new THREE.MeshBasicMaterial({ color: 0xfdf3d6, fog: false, transparent: true, opacity: 0 });
  owned.push(moonGeo, moonMat);
  const moon = add(new THREE.Mesh(moonGeo, moonMat));
  moon.position.set(-120, 140, -200);

  const hemi = add(new THREE.HemisphereLight(0xdfeaff, 0x8a7a5e, 1.1));
  const sun = add(new THREE.DirectionalLight(0xfff1dc, 1.8));
  sun.castShadow = ctx.quality.shadows;
  sun.shadow.mapSize.set(ctx.quality.shadowMapSize * 2, ctx.quality.shadowMapSize * 2);
  const S = 26;
  Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 140 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  add(sun.target);

  const sunDir = new THREE.Vector3();
  let day = 1;
  /** 서울 하늘에 맞춰 하늘색, 안개, 빛, 별, 연등 밝기를 정한다 */
  const applySky = (): void => {
    const { elevation, azimuth } = solarPosition(ctx.clock.now());
    day = daylightLevel(elevation);
    const dusk = twilightLevel(elevation);
    // 이 장면은 -z가 북쪽, +x가 동쪽
    const flat = Math.cos(elevation);
    sunDir.set(Math.sin(azimuth) * flat, Math.max(0.15, Math.sin(elevation)), -Math.cos(azimuth) * flat).normalize();
    const sky = scene.background as THREE.Color;
    sky.copy(NIGHT_SKY).lerp(DAY_SKY, day).lerp(DUSK_SKY, dusk * 0.55);
    fog.color.copy(NIGHT_FOG).lerp(DAY_FOG, day).lerp(DUSK_SKY, dusk * 0.4);
    hemi.intensity = 0.55 + 0.65 * day;
    hemi.color.set(day > 0.5 ? 0xdfeaff : 0x9fb0e0);
    sun.intensity = 0.25 + 1.65 * day;
    sun.color.set(0xfff1dc).lerp(new THREE.Color(0xffb27a), dusk * 0.7).lerp(new THREE.Color(0x9fb4ff), 1 - day);
    starMat.opacity = Math.max(0, 1 - day * 1.6) * 0.9;
    moonMat.opacity = Math.max(0, 1 - day * 1.4);
    towerMat.emissiveIntensity = Math.max(0, 1 - day * 1.25) * 0.95;
    const night = 1 - day;
    (strings.mesh.material as THREE.MeshBasicMaterial).color.setScalar(0.82 + 0.18 * night);
    fireMat.color.set(0xffc56b).multiplyScalar(0.55 + 0.45 * night);
  };
  applySky();
  let skyTimer = 0;

  // ---- 동작 효과 ----
  const floatGeo = new THREE.SphereGeometry(0.26, 12, 8).scale(1, 0.88, 1);
  const flameGeo = new THREE.SphereGeometry(0.07, 6, 4);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true });
  owned.push(floatGeo, flameGeo, flameMat);
  const floaters: Floater[] = [];
  for (let i = 0; i < 16; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
    owned.push(mat);
    const group = new THREE.Group();
    group.add(new THREE.Mesh(floatGeo, mat));
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.y = -0.2;
    group.add(flame);
    group.visible = false;
    add(group);
    floaters.push({ group, mat, t: 0, start: new THREE.Vector3(), phase: 0, active: false });
  }
  const rippleGeo = new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2);
  owned.push(rippleGeo);
  const ripples: Ripple[] = [];
  for (let i = 0; i < 12; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xf3d58a, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    owned.push(mat);
    const mesh = new THREE.Mesh(rippleGeo, mat);
    mesh.visible = false;
    add(mesh);
    ripples.push({ mesh, mat, t: 0, dur: 1, size: 1, active: false });
  }
  const spawnRipple = (at: THREE.Vector3, size: number, dur: number, color: number): void => {
    const r = ripples.find((x) => !x.active) ?? ripples[0]!;
    r.active = true;
    r.t = 0;
    r.dur = dur;
    r.size = size;
    r.mat.color.set(color);
    r.mesh.position.set(at.x, groundHeight(at.x, at.z) + 0.04, at.z);
    r.mesh.visible = true;
  };

  const sound = new BongeunsaSound(ctx.sound, () => day);

  const stage: BongeunsaStage = {
    actionEffect(actionId, at, variant, source) {
      sound.action(actionId, source);
      const reduced = ctx.isReducedMotion();
      const feet = new THREE.Vector3(at.x, 0, at.z);
      switch (actionId) {
        case 'hapjang':
          spawnRipple(feet, 1.6, reduced ? 0.8 : 1.8, 0xf3d58a);
          break;
        case 'moktak':
          spawnRipple(feet, 0.9, 0.7, 0xd9b48a);
          break;
        case 'lantern': {
          const f = floaters.find((x) => !x.active) ?? floaters[0]!;
          f.active = true;
          f.t = 0;
          f.phase = Math.random() * Math.PI * 2;
          f.start.copy(at).add(new THREE.Vector3(0, 0.25, 0));
          const v = variant ?? 0;
          f.mat.color.set(LANTERN_COLORS[((v % LANTERN_COLORS.length) + LANTERN_COLORS.length) % LANTERN_COLORS.length]!);
          f.group.position.copy(f.start);
          f.group.scale.setScalar(0.4);
          f.group.visible = true;
          break;
        }
        default:
          break;
      }
    },
    describe() {
      let meshes = 0;
      let triangles = 0;
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        meshes++;
        const g = m.geometry;
        const n = g.index ? g.index.count : g.getAttribute('position').count;
        const inst = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
        triangles += (n / 3) * inst;
      });
      return { meshes, triangles: Math.round(triangles) };
    },
  };

  // ---- 범종 일정: 정시마다 세 번, 새벽 4시와 저녁 6시 예불에는 일곱 번 ----
  const STRIKE_GAP = 9;
  let hourKey = '';
  let lastStrike = Number.POSITIVE_INFINITY; // 처음 들어온 순간에는 이미 지난 타종을 다시 치지 않는다
  let swing = 0; // 종 흔들림 (0~1)
  let logT = -1; // 당목 움직임 시간 (-1이면 가만히)
  const checkBell = (): void => {
    const st = ctx.clock.seoul();
    const key = `${st.year}-${st.month}-${st.day}-${st.hour}`;
    const count = st.hour === 4 || st.hour === 18 ? 7 : 3;
    const s = st.minute * 60 + st.second + st.millisecond / 1000;
    if (key !== hourKey) {
      // 정시를 지나 처음 본 시각이면 지난 타종은 건너뛴다 (막 들어온 사람, 탭을 오래 비운 사람)
      lastStrike = hourKey === '' ? Math.floor(s / STRIKE_GAP) - (s % STRIKE_GAP < 0.5 ? 1 : 0) : -1;
      hourKey = key;
    }
    if (s >= count * STRIKE_GAP) return;
    const k = Math.floor(s / STRIKE_GAP);
    // 당목은 치기 1.2초 전에 뒤로 당긴다
    const next = k + 1;
    if (next < count && next > lastStrike && next * STRIKE_GAP - s <= 1.2 && logT < 0) logT = 1.2 - (next * STRIKE_GAP - s);
    if (k > lastStrike) {
      lastStrike = k;
      if (s - k * STRIKE_GAP < 1) {
        swing = 1;
        if (logT < 0) logT = 1.2;
        sound.bell();
      }
    }
  };

  ctx.reportProgress(0.9);

  return {
    spawn: SPAWN,
    bounds: WALK_BOUNDS,
    blockers: [...WALK_BLOCKERS],
    groundHeight,
    cameraObstacles: cameraObstacles(),
    camera: { distance: 9, portraitDistance: 11.5, pitch: 0.34, maxDistance: 26, minDistance: 2.5, focusHeight: 1.1 },
    api: stage,
    update(dt, elapsed) {
      skyTimer -= dt;
      if (skyTimer <= 0) {
        skyTimer = 5;
        applySky();
      }
      // 그림자는 카메라가 보는 앞쪽을 따라간다 (넓은 마당을 작은 그림자 지도로 덮는다)
      _v.set(0, 0, -1).applyQuaternion(camera.quaternion);
      _v.y = 0;
      _v.normalize().multiplyScalar(12).add(camera.position);
      _v.y = 0;
      sun.target.position.copy(_v);
      sun.position.copy(_v).addScaledVector(sunDir, 70);
      const reduced = ctx.isReducedMotion();
      placeLanterns(elapsed, reduced ? 0 : 0.06);
      checkBell();
      // 범종과 당목
      if (swing > 0) {
        swing = Math.max(0, swing - dt * 0.18);
        bellGroup.rotation.z = reduced ? 0 : 0.035 * swing * Math.sin(elapsed * 2.2);
      }
      if (logT >= 0) {
        logT += dt;
        // 1.2초 동안 뒤로(+x 쪽으로 들려) 당겼다가 0.15초 만에 종으로 친다, 그 뒤 천천히 돌아온다
        let a: number;
        if (logT < 1.2) a = -0.5 * Math.sin((logT / 1.2) * (Math.PI / 2));
        else if (logT < 1.35) a = -0.5 + 0.55 * ((logT - 1.2) / 0.15);
        else if (logT < 3) a = 0.05 * (1 - (logT - 1.35) / 1.65);
        else {
          a = 0;
          logT = -1;
        }
        logPivot.rotation.z = reduced ? 0 : -a;
      }
      // 떠오르는 연등
      for (const f of floaters) {
        if (!f.active) continue;
        f.t += dt;
        const p = f.t / FLOAT_SECONDS;
        if (p >= 1) {
          f.active = false;
          f.group.visible = false;
          continue;
        }
        const rise = reduced ? 3 * p : 10 * p * (0.6 + 0.4 * p);
        const sx = reduced ? 0 : 0.35 * Math.sin(f.phase + f.t * 1.4) * p;
        f.group.position.set(f.start.x + sx, f.start.y + rise, f.start.z + sx * 0.6);
        f.group.scale.setScalar(Math.min(1, 0.4 + p * 3));
        f.mat.opacity = p > 0.7 ? (1 - p) / 0.3 : 1;
      }
      for (const r of ripples) {
        if (!r.active) continue;
        r.t += dt;
        const p = r.t / r.dur;
        if (p >= 1) {
          r.active = false;
          r.mesh.visible = false;
          continue;
        }
        r.mesh.scale.setScalar(0.3 + p * r.size);
        r.mat.opacity = 0.7 * (1 - p);
      }
      stars.rotation.y = elapsed * 0.002;
    },
    dispose() {
      sound.dispose();
      for (const obj of added) scene.remove(obj);
      sun.shadow.map?.dispose();
      for (const o of owned) o.dispose();
      scene.fog = prevFog;
      camera.far = prevFar;
      camera.updateProjectionMatrix();
    },
  };
}
