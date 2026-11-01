// 주막 마당 밖 풍경: 하늘, 겹겹이 이어지는 산 능선, 초가·기와집 마을, 소나무, 흐르는 구름.
// 밤에는 달밤(불 켜진 창, 남빛 산), 낮에는 파란 하늘과 푸른 산으로 바뀐다(setDaylight, daylight.ts).
// 모두 기본 도형과 정점 색이고 재질이 같은 것끼리 합쳐서 그리기 호출은 몇 번 안 된다.
import * as THREE from 'three';
import { Batch, seeded } from './batch';
import { ROOM } from './layout';

/** 낮과 밤 사이 어디쯤인지 (stage.ts 가 해 위치로 정한다) */
export interface DaylightState {
  /** 0 밤 ~ 1 낮 */
  day: number;
  /** 0~1. 해돋이·해넘이 노을 */
  twilight: number;
  /** 장면 속 해 쪽 단위 벡터 (지평선 아래일 수도 있다) */
  sunDir: THREE.Vector3;
}

export interface Scenery {
  /** 장면에 넣을 것들 */
  objects: THREE.Object3D[];
  /** 매 프레임: 구름이 천천히 흐른다 */
  update(dt: number, reduced: boolean): void;
  /** 하늘·산·구름·창 불빛을 낮과 밤 사이로 맞춘다. 해가 조금 움직일 때만 부르면 된다 */
  setDaylight(state: DaylightState): void;
  dispose(): void;
}

const SKY_NIGHT = { zenith: new THREE.Color(0x03050c), mid: new THREE.Color(0x0b1430), horizon: new THREE.Color(0x2a3a62), glow: new THREE.Color(0x46588c) };
const SKY_DAY = { zenith: new THREE.Color(0x3a74c4), mid: new THREE.Color(0x6aa3da), horizon: new THREE.Color(0xc4dcee) };
const SUN_HALO = new THREE.Color(0xfff2d2);
const AFTERGLOW = new THREE.Color(0xff8c4c);

/**
 * 하늘 돔. 밤: 지평선은 달빛에 물든 푸른빛, 위로 갈수록 깊은 남색, 달 쪽은 조금 더 밝다.
 * 낮: 지평선은 옅은 하늘색, 위로 갈수록 파랗고, 해 둘레가 하얗게 밝다. 해돋이·해넘이에는 해 쪽 지평선이 주황빛으로 물든다
 */
function buildSkyDome(moonDir: THREE.Vector3): { geometry: THREE.BufferGeometry; recolor(state: DaylightState): void } {
  const g = new THREE.SphereGeometry(96, 48, 24);
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const dirs: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) dirs.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize());
  const attr = new THREE.BufferAttribute(colors, 3);
  g.setAttribute('color', attr);
  const night = new THREE.Color();
  const day = new THREE.Color();
  const sunFlat = new THREE.Vector3();
  const recolor = ({ day: d, twilight, sunDir }: DaylightState): void => {
    sunFlat.set(sunDir.x, 0, sunDir.z);
    if (sunFlat.lengthSq() > 1e-6) sunFlat.normalize();
    const sunUp = Math.min(1, Math.max(0, (sunDir.y + 0.03) / 0.08)); // 해 둘레 밝음은 해가 떠 있을 때만
    for (let i = 0; i < dirs.length; i++) {
      const v = dirs[i]!;
      const h = Math.max(0, v.y);
      if (d < 1) {
        if (h < 0.18) night.copy(SKY_NIGHT.horizon).lerp(SKY_NIGHT.mid, h / 0.18);
        else night.copy(SKY_NIGHT.mid).lerp(SKY_NIGHT.zenith, Math.min(1, (h - 0.18) / 0.7));
        if (v.y < 0) night.copy(SKY_NIGHT.horizon).multiplyScalar(0.6);
        night.lerp(SKY_NIGHT.glow, Math.pow(Math.max(0, v.dot(moonDir)), 18) * 0.85 * (1 - d));
      }
      if (d > 0) {
        if (h < 0.2) day.copy(SKY_DAY.horizon).lerp(SKY_DAY.mid, h / 0.2);
        else day.copy(SKY_DAY.mid).lerp(SKY_DAY.zenith, Math.min(1, (h - 0.2) / 0.7));
        if (v.y < 0) day.copy(SKY_DAY.horizon).multiplyScalar(0.85);
        day.lerp(SUN_HALO, Math.pow(Math.max(0, v.dot(sunDir)), 24) * 0.75 * sunUp);
      }
      const c = d <= 0 ? night : d >= 1 ? day : night.lerp(day, d);
      if (twilight > 0) {
        // 노을: 해 쪽 지평선 띠가 가장 붉고, 해에서 돌아설수록·위로 갈수록 옅어진다
        const band = Math.pow(1 - Math.min(1, Math.abs(v.y) / 0.38), 2);
        const toward = Math.pow(Math.max(0, v.x * sunFlat.x + v.z * sunFlat.z), 2);
        c.lerp(AFTERGLOW, twilight * band * (0.15 + 0.7 * toward));
      }
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    attr.needsUpdate = true;
  };
  return { geometry: g, recolor };
}

/** 둥그런 산 능선 한 겹: 반지름 r의 둘레를 따라 높이가 오르내리는 띠. 위 가장자리는 달빛(낮엔 햇빛)에 조금 밝다 */
interface Ridge {
  geometry: THREE.BufferGeometry;
  night: Float32Array;
  day: Float32Array;
}

function buildRidge(r: number, base: number, amp: number, seed: number, color: number, rim: number, dayColor: number, dayRim: number): Ridge {
  const n = 220;
  const rand = seeded(seed);
  const phases = [rand() * 6.28, rand() * 6.28, rand() * 6.28, rand() * 6.28];
  const height = (a: number): number =>
    base +
    amp * (0.55 * Math.sin(a * 3 + phases[0]!) + 0.3 * Math.sin(a * 7 + phases[1]!) + 0.18 * Math.sin(a * 13 + phases[2]!) + 0.08 * Math.sin(a * 29 + phases[3]!)) +
    amp * 0.5;
  const pos: number[] = [];
  const col: number[] = [];
  const colDay: number[] = [];
  const body = new THREE.Color(color);
  const top = new THREE.Color(rim);
  const bodyDay = new THREE.Color(dayColor);
  const topDay = new THREE.Color(dayRim);
  const push = (x: number, y: number, z: number, c: THREE.Color): void => {
    pos.push(x, y, z);
    col.push(c.r, c.g, c.b);
    const cd = c === top ? topDay : bodyDay;
    colDay.push(cd.r, cd.g, cd.b);
  };
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const h0 = Math.max(0.5, height(a0));
    const h1 = Math.max(0.5, height(a1));
    const x0 = Math.cos(a0) * r;
    const z0 = Math.sin(a0) * r;
    const x1 = Math.cos(a1) * r;
    const z1 = Math.sin(a1) * r;
    const yb = -8;
    // 두 삼각형 (안쪽에서 보이게 감는 방향은 DoubleSide로 무시)
    push(x0, yb, z0, body);
    push(x1, yb, z1, body);
    push(x1, h1, z1, top);
    push(x0, yb, z0, body);
    push(x1, h1, z1, top);
    push(x0, h0, z0, top);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return { geometry: g, night: new Float32Array(col), day: new Float32Array(colDay) };
}

/** 소나무: 굽은 줄기와 층층이 얹힌 납작한 솔잎 덩어리 */
function pine(b: Batch, x: number, z: number, s: number, rand: () => number): void {
  const lean = (rand() - 0.5) * 0.25;
  const trunkH = 3.2 * s;
  b.cylinder(0.12 * s, 0.2 * s, trunkH, 6, [x, trunkH / 2 - ROOM.yardDrop, z], 0x3b2a1e, { rz: lean, jitter: 0.1 });
  const topX = x + Math.sin(lean) * -trunkH * 0.5;
  for (let k = 0; k < 3; k++) {
    const y = trunkH * (0.62 + k * 0.2) - ROOM.yardDrop;
    const w = (1.7 - k * 0.38) * s;
    const ox = (rand() - 0.5) * 0.6 * s;
    const oz = (rand() - 0.5) * 0.6 * s;
    b.sphere(1, [topX + ox, y, z + oz], k === 2 ? 0x1f3a2a : 0x18301f, { jitter: 0.12 }, [w, 0.42 * s, w * 0.85], [9, 5]);
  }
}

/** 기와집 한 채: 흰 벽, 검은 기와지붕(처마가 살짝 들린 모양), 불 켜진 창 */
function hanok(lit: Batch, glow: Batch, x: number, z: number, ry: number, s: number, thatched: boolean): void {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, -ROOM.yardDrop, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(s, s, s));
  const w = 6;
  const d = 3.6;
  const h = 2.4;
  // 기단과 벽
  lit.box([w + 0.6, 0.4, d + 0.6], [0, 0.2, 0], 0x6c6a64, { parent: m, jitter: 0.06 });
  lit.box([w, h, d], [0, 0.4 + h / 2, 0], 0xb9b2a2, { parent: m, jitter: 0.05 });
  // 기둥
  for (const px of [-w / 2, -w / 6, w / 6, w / 2]) lit.box([0.22, h, 0.22], [px, 0.4 + h / 2, d / 2 + 0.02], 0x4a2f1c, { parent: m });
  // 불 켜진 창 (문종이)
  for (const px of [-w / 3, 0, w / 3]) {
    glow.plane(1.1, 1.2, [px, 0.4 + h * 0.52, d / 2 + 0.03], 0xffb860, { parent: m });
  }
  const roofY = 0.4 + h;
  if (thatched) {
    // 초가지붕: 둥근 볏짚 지붕
    lit.sphere(1, [0, roofY + 0.2, 0], 0x6e5a3a, { parent: m, jitter: 0.12 }, [w * 0.62, 1.3, d * 0.78], [14, 6]);
  } else {
    // 기와지붕: 양쪽 경사면 + 용마루, 처마 끝이 살짝 들린다
    const slope = Math.atan2(1.5, d / 2 + 0.9);
    const len = Math.hypot(1.5, d / 2 + 0.9);
    for (const side of [-1, 1]) {
      lit.box([w + 2.0, 0.16, len], [0, roofY + 0.75, side * (d / 4 + 0.45)], 0x23272e, { parent: m, rx: side * slope, jitter: 0.08 });
    }
    lit.box([w + 1.6, 0.34, 0.4], [0, roofY + 1.55, 0], 0x1a1d22, { parent: m });
    for (const sx of [-1, 1]) lit.box([0.5, 0.3, 0.4], [sx * (w / 2 + 0.9), roofY + 1.7, 0], 0x1a1d22, { parent: m, rz: sx * -0.35 });
  }
}

/** 부드러운 구름 그림 (가장자리가 흐린 덩어리 몇 개) */
function cloudTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  if (!g) return tex;
  const blobs: Array<[number, number, number]> = [
    [0.3, 0.58, 0.28],
    [0.5, 0.48, 0.34],
    [0.7, 0.58, 0.26],
    [0.42, 0.62, 0.3],
    [0.6, 0.66, 0.28],
  ];
  for (const [bx, by, br] of blobs) {
    const grad = g.createRadialGradient(bx * w, by * h, 0, bx * w, by * h, br * w * 0.6);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }
  tex.needsUpdate = true;
  return tex;
}

export function buildScenery(moonPos: THREE.Vector3): Scenery {
  const disposables: Array<{ dispose(): void }> = [];
  const objects: THREE.Object3D[] = [];
  const own = <T extends { dispose(): void }>(o: T): T => {
    disposables.push(o);
    return o;
  };

  // 하늘
  const moonDir = moonPos.clone().normalize();
  const skyMat = own(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  const skyDome = buildSkyDome(moonDir);
  const sky = new THREE.Mesh(own(skyDome.geometry), skyMat);
  sky.renderOrder = -10;
  objects.push(sky);

  // 산 능선 세 겹 (먼 산일수록 옅고 푸르다). 낮에는 먼 산은 옅은 쪽빛, 가까운 산은 짙은 솔빛
  const ridgeMat = own(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false }));
  const ridges = [
    buildRidge(90, 6, 9, 11, 0x1e2b48, 0x34466e, 0x7f97b6, 0xa3b8d0),
    buildRidge(74, 3, 7, 23, 0x131c31, 0x24324f, 0x5a7b6e, 0x7a9a86),
    buildRidge(58, 0.5, 4.5, 37, 0x0b111f, 0x172138, 0x3d5a43, 0x587a55),
  ];
  for (const r of ridges) objects.push(new THREE.Mesh(own(r.geometry), ridgeMat));

  // 마을과 소나무 (마당 담 너머)
  const lit = new Batch(91);
  const glow = new Batch(92);
  const rand = seeded(93);
  const houses: Array<[number, number, number, number, boolean]> = [
    [-19, -17, 0.35, 1.0, false],
    [-30, -26, 0.5, 1.1, false],
    [17, -22, -0.4, 1.0, true],
    [28, -15, -0.9, 1.0, false],
    [-24, 4, 1.4, 0.9, true],
    [22, 8, -1.5, 1.0, false],
    [-14, 22, 2.8, 0.9, false],
    [12, 24, 3.4, 1.0, true],
    [0, 30, 3.14, 1.1, false],
  ];
  for (const [x, z, ry, s, thatched] of houses) hanok(lit, glow, x, z, ry, s, thatched);
  const pines: Array<[number, number, number]> = [
    [-12, -10, 1.2],
    [-13.5, -4, 1.0],
    [12.5, -9, 1.3],
    [13, -2, 0.95],
    [-12.5, 5, 1.1],
    [12.2, 6, 1.15],
    [-7, 13, 1.0],
    [6, 13.5, 1.2],
    [-16, 12, 1.4],
    [17, 14, 1.3],
    [-8, -13, 1.25],
    [8.5, -13.5, 1.1],
    [-22, -8, 1.5],
    [24, -4, 1.4],
  ];
  for (const [x, z, s] of pines) pine(lit, x, z, s, rand);
  const litGeo = lit.build();
  const glowGeo = glow.build();
  if (litGeo) {
    const mesh = new THREE.Mesh(own(litGeo), own(new THREE.MeshLambertMaterial({ vertexColors: true })));
    mesh.receiveShadow = false;
    objects.push(mesh);
  }
  // 마을 창 불빛 (낮에는 거의 꺼진다)
  const windowMat = own(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  if (glowGeo) objects.push(new THREE.Mesh(own(glowGeo), windowMat));

  // 구름: 달(낮엔 해) 곁을 천천히 지나간다. 밤엔 달빛에 푸르스름, 낮엔 하얗고, 노을엔 발그레하다
  const cloudTex = own(cloudTexture());
  const clouds: Array<{ sprite: THREE.Sprite; speed: number; baseX: number; span: number }> = [];
  const cloudNight = new THREE.Color(0x8a98bf);
  const cloudDay = new THREE.Color(0xffffff);
  const cloudGlow = new THREE.Color(0xffb08a);
  const cloudDefs: Array<[number, number, number, number, number]> = [
    // x, y, z, 크기, 빠르기
    [moonPos.x - 14, moonPos.y + 3, moonPos.z + 4, 26, 0.35],
    [moonPos.x + 10, moonPos.y - 4, moonPos.z + 6, 20, 0.25],
    [moonPos.x - 34, moonPos.y - 1, moonPos.z + 10, 30, 0.3],
    [moonPos.x + 30, moonPos.y + 6, moonPos.z + 2, 24, 0.2],
  ];
  for (const [x, y, z, size, speed] of cloudDefs) {
    const mat = own(new THREE.SpriteMaterial({ map: cloudTex, color: 0x8a98bf, transparent: true, opacity: 0.38, depthWrite: false, fog: false }));
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(x, y, z);
    sprite.scale.set(size, size * 0.42, 1);
    objects.push(sprite);
    clouds.push({ sprite, speed, baseX: x, span: 90 });
  }

  return {
    objects,
    update(dt, reduced) {
      if (reduced) return;
      for (const c of clouds) {
        c.sprite.position.x += c.speed * dt;
        if (c.sprite.position.x > c.baseX + c.span / 2) c.sprite.position.x -= c.span;
      }
    },
    setDaylight(state) {
      const d = state.day;
      skyDome.recolor(state);
      for (const r of ridges) {
        const attr = r.geometry.getAttribute('color') as THREE.BufferAttribute;
        const out = attr.array as Float32Array;
        for (let i = 0; i < out.length; i++) out[i] = r.night[i]! + (r.day[i]! - r.night[i]!) * d;
        attr.needsUpdate = true;
      }
      windowMat.color.setScalar(1 - 0.8 * d);
      for (const c of clouds) {
        const mat = c.sprite.material;
        mat.color.copy(cloudNight).lerp(cloudDay, d).lerp(cloudGlow, 0.6 * state.twilight);
        mat.opacity = 0.38 + 0.4 * d;
      }
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
