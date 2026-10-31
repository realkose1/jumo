// 주막 장면을 조립한다: 방(build.ts), TV(tv.ts), 조명, 하늘, 효과(effects.ts), 소리(sound.ts).
// 장면이 밖(컨트롤러)에 열어 주는 기능은 JumakStage이고 SceneHandle.api로 나간다.
import * as THREE from 'three';
import type { TvView } from '../../cheer/feed';
import { GENERIC_ROOM_NAME } from '../../cheer/roomName';
import type { TallySnapshot } from '../../cheer/tally';
import type { SceneContext, SceneHandle } from '../../engine/types';
import { buildRoom } from './build';
import { Confetti, EmojiBursts } from './effects';
import { JUMO, ACTION_EMOJI, ACTION_PICTURE, ROOM, SPAWN, TV, WALK_BLOCKERS, WALK_BOUNDS, groundHeight, type DishSpot } from './layout';
import { JumoMotion, buildJumoGeometry } from './jumo';
import { Service } from './service';
import { JumakSound } from './sound';
import { createDot } from './stage-dot';
import { TvScreen } from './tv';
import { buildScenery } from './scenery';

const ACTION_IDS = Object.keys(ACTION_EMOJI);

/** 장면이 컨트롤러에게 열어 주는 기능 */
export interface JumakStage {
  readonly scene: THREE.Scene;
  readonly sound: JumakSound;
  /** TV에 띄울 내용 */
  setView(view: TvView): void;
  /** TV에 큰 글을 잠깐 띄운다 */
  flashBanner(text: string, tone: 'goal' | 'info', ms: number): void;
  /** TV 아래 합계 줄 (null이면 감춘다) */
  setTally(snapshot: TallySnapshot | null): void;
  /** 머리 위로 이모지가 떠오른다 */
  emojiBurst(actionId: string, at: THREE.Vector3, scale?: number): void;
  readonly activeEmojiCount: number;
  /** 골 순간 색종이 */
  confetti(count: number): void;
  /** 조명과 TV가 환해졌다 가라앉는다 (0~1) */
  glow(strength: number): void;
  /** 움직임 줄이기 */
  setReducedMotion(on: boolean): void;
  /** 간판 글(예: "이강인 응원 주막"). 바뀔 때만 다시 그린다 */
  setRoomName(name: string): void;
  /** 주문한 음식을 놓는다 (최대 8개, 약 40초 뒤 사라진다) */
  serveDish(dish: string, spot: DishSpot): void;
  readonly activeDishCount: number;
  /** 주모가 대답하는 몸짓(폴짝, 갸웃) */
  jumoReply(): void;
  /** 주모 머리 위 좌표 (말풍선을 붙일 곳) */
  jumoAnchor(out: THREE.Vector3): THREE.Vector3;
  /** 매 프레임 불리는 함수를 더한다. 해제 함수를 돌려준다 */
  addTicker(fn: (dt: number) => void): () => void;
  /** 개발 중 확인용: 장면의 그리기 호출/삼각형 수를 센다 */
  describe(): { meshes: number; triangles: number };
}

/** 간판: 나무판에 금빛 글. 이름이 길면 글자 크기를 줄여 판 안에 넣는다 */
function makeSign(): { texture: THREE.CanvasTexture; draw(name: string): void } {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 160;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  let drawn = '';
  const draw = (name: string): void => {
    if (name === drawn) return;
    drawn = name;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const g = ctx.createLinearGradient(0, 0, 0, 160);
    g.addColorStop(0, '#4a2c18');
    g.addColorStop(1, '#2d1a0d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 640, 160);
    ctx.strokeStyle = '#c8962e';
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, 620, 140);
    ctx.strokeStyle = 'rgba(200,150,46,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(22, 22, 596, 116);
    const family = '-apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';
    let size = 82;
    ctx.font = `800 ${size}px ${family}`;
    while (size > 30 && ctx.measureText(name).width > 550) {
      size -= 2;
      ctx.font = `800 ${size}px ${family}`;
    }
    let text = name;
    while (text.length > 2 && ctx.measureText(text).width > 550) text = `${text.slice(0, -2)}…`;
    ctx.fillStyle = '#f4cf72';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 320, 84);
    texture.needsUpdate = true;
  };
  draw(GENERIC_ROOM_NAME);
  return { texture, draw };
}

function confettiBudget(tier: SceneContext['quality']['tier']): number {
  return tier === 'high' ? 260 : tier === 'medium' ? 200 : 130;
}

export function createJumakScene(ctx: SceneContext): SceneHandle {
  const { scene } = ctx;
  const disposables: Array<{ dispose(): void }> = [];
  const added: THREE.Object3D[] = [];
  const own = <T extends { dispose(): void }>(o: T): T => {
    disposables.push(o);
    return o;
  };
  const add = <T extends THREE.Object3D>(o: T): T => {
    scene.add(o);
    added.push(o);
    return o;
  };

  const previousBackground = scene.background;
  scene.background = new THREE.Color(0x0a1122); // 달 밝은 밤하늘

  // ---- 방 ----
  const room = buildRoom();
  own(room.lit);
  own(room.glow);
  const litMat = own(new THREE.MeshLambertMaterial({ vertexColors: true }));
  const lit = add(new THREE.Mesh(room.lit, litMat));
  lit.castShadow = true;
  lit.receiveShadow = true;
  const glowMat = own(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false }));
  add(new THREE.Mesh(room.glow, glowMat));
  ctx.reportProgress(0.3);

  // ---- TV와 간판 ----
  const tv = own(new TvScreen(ACTION_IDS, Math.min(4, ctx.renderer.capabilities.getMaxAnisotropy())));
  tv.setReducedMotion(ctx.isReducedMotion());
  const tvMat = own(new THREE.MeshBasicMaterial({ map: tv.texture, toneMapped: false }));
  const tvGeo = own(new THREE.PlaneGeometry(TV.w, TV.h));
  const tvMesh = add(new THREE.Mesh(tvGeo, tvMat));
  tvMesh.position.set(TV.x, TV.y, TV.z);

  const sign = makeSign();
  const signTex = own(sign.texture);
  const signMat = own(new THREE.MeshBasicMaterial({ map: signTex, color: 0xd9d2c4, toneMapped: false }));
  const signGeo = own(new THREE.PlaneGeometry(2.6, 0.65));
  const signMesh = add(new THREE.Mesh(signGeo, signMat));
  signMesh.position.set(0, 3.82, ROOM.frontZ + 0.05);
  ctx.reportProgress(0.5);

  // ---- 조명 ----
  const hemi = add(new THREE.HemisphereLight(0x5a6498, 0x2f2218, 0.62));
  const key = add(new THREE.DirectionalLight(0xffd7a6, 0.4));
  key.position.set(3.5, 11, 8);
  key.target.position.set(0, 0, -1);
  add(key.target);
  key.castShadow = true;
  key.shadow.mapSize.set(ctx.quality.shadowMapSize, ctx.quality.shadowMapSize);
  key.shadow.camera.left = -9;
  key.shadow.camera.right = 9;
  key.shadow.camera.top = 10;
  key.shadow.camera.bottom = -9;
  key.shadow.camera.near = 2;
  key.shadow.camera.far = 30;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.03;

  // 초롱 불빛: 따뜻한 점 조명 셋 (많이 두면 느려진다)
  const warm: Array<{ light: THREE.PointLight; base: number; seed: number }> = [
    { light: new THREE.PointLight(0xffa35a, 30, 16, 1.7), base: 30, seed: 1.3 },
    { light: new THREE.PointLight(0xff9a55, 30, 16, 1.7), base: 30, seed: 4.1 },
    { light: new THREE.PointLight(0xffb070, 18, 14, 1.7), base: 18, seed: 7.7 },
  ];
  warm[0]!.light.position.set(-3.2, 3.5, -1.2);
  warm[1]!.light.position.set(3.2, 3.5, -1.2);
  warm[2]!.light.position.set(0, 3.4, 5.5);
  for (const w of warm) add(w.light);
  // TV 불빛: 앞쪽을 푸르스름하게 비춘다
  const tvLight = add(new THREE.PointLight(0x8fb4ff, 10, 9, 1.8));
  tvLight.position.set(0, TV.y - 0.2, ROOM.frontZ + 1.7);
  const tvLightBase = 10;

  // ---- 초롱 불빛 번짐 ----
  const dot = own(createDot());
  const lanternPos = new Float32Array(room.lanterns.length * 3);
  const lanternCol = new Float32Array(room.lanterns.length * 3);
  room.lanterns.forEach((l, i) => {
    lanternPos.set([l.x, l.y, l.z], i * 3);
    const c = new THREE.Color(l.warm ? 0xff6a3a : 0x4f86ff);
    lanternCol.set([c.r, c.g, c.b], i * 3);
  });
  const haloGeo = own(new THREE.BufferGeometry());
  haloGeo.setAttribute('position', new THREE.BufferAttribute(lanternPos, 3));
  haloGeo.setAttribute('color', new THREE.BufferAttribute(lanternCol, 3));
  const haloMat = own(
    new THREE.PointsMaterial({
      size: 1.7,
      map: dot,
      vertexColors: true,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
  add(new THREE.Points(haloGeo, haloMat));

  // ---- 밤하늘: 별과 달 ----
  const starCount = 180;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const e = 0.18 + Math.random() * 1.2; // 고도
    const r = 88;
    starPos[i * 3] = Math.cos(a) * Math.cos(e) * r;
    starPos[i * 3 + 1] = Math.sin(e) * r;
    starPos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
  }
  const starGeo = own(new THREE.BufferGeometry());
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = own(new THREE.PointsMaterial({ size: 1.8, sizeAttenuation: false, color: 0xdfe6ff, transparent: true, opacity: 0.75, depthWrite: false, fog: false }));
  add(new THREE.Points(starGeo, starMat));
  // 보름달: 표면 무늬는 캔버스로 그린다
  // 하늘 한 곳에 박혀 있다(보는 사람을 따라오지 않는다). TV 정가운데 위 하늘이라 시점을 조금 들면 보인다.
  // 휴대폰 세로 화면은 좌우가 좁아서 양옆 자리에서는 시점을 돌려야 보인다
  const MOON_POS = new THREE.Vector3(0, 21.5, -66);
  const moonTex = own(makeMoonTexture());
  // 달과 달무리는 늘 화면을 정면으로 보는 스프라이트다. 기울어진 원판에 달무리를 같은 깊이로 겹치면
  // 원판 절반이 달무리 뒤로 가서 대각선으로 밝기가 갈라져 보였다(깨진 달). 달무리는 달보다 조금 뒤에 둔다
  const moonMat = own(new THREE.SpriteMaterial({ map: moonTex, fog: false, toneMapped: false, transparent: true, depthWrite: false }));
  const moon = add(new THREE.Sprite(moonMat));
  moon.position.copy(MOON_POS);
  moon.scale.set(5.4, 5.4, 1);
  moon.renderOrder = 2;
  const moonHaloMat = own(new THREE.SpriteMaterial({ map: dot, color: 0xb9c8f2, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
  const halo = add(new THREE.Sprite(moonHaloMat));
  halo.position.copy(MOON_POS).multiplyScalar(1.03); // 달 바로 뒤
  halo.scale.set(22, 22, 1);
  halo.renderOrder = 1;
  // 달빛: 마당을 푸르스름하게 비춘다
  const moonLight = add(new THREE.DirectionalLight(0xaebfff, 0.35));
  moonLight.position.copy(MOON_POS);
  // 마당 밖 풍경: 하늘 돔, 산 능선 세 겹, 불 켜진 마을과 소나무, 흐르는 구름
  const scenery = buildScenery(MOON_POS);
  disposables.push(scenery);
  for (const o of scenery.objects) add(o);
  ctx.reportProgress(0.8);

  // ---- 효과와 소리 ----
  const bursts = new EmojiBursts(scene, ACTION_EMOJI, undefined, ACTION_PICTURE);
  bursts.setReducedMotion(ctx.isReducedMotion());
  disposables.push(bursts);
  const confetti = new Confetti(scene, confettiBudget(ctx.quality.tier), { ground: groundHeight, cannonZ: ROOM.frontZ + 1.4, camera: ctx.camera });
  disposables.push(confetti);
  const sound = new JumakSound(ctx.sound);

  // ---- 주모와 서빙 ----
  const jumoGeo = own(buildJumoGeometry());
  const jumoMat = own(new THREE.MeshLambertMaterial({ vertexColors: true }));
  const jumoMesh = add(new THREE.Mesh(jumoGeo, jumoMat));
  jumoMesh.castShadow = true;
  jumoMesh.position.set(JUMO.x, 0, JUMO.z);
  jumoMesh.rotation.y = JUMO.yaw;
  const jumoMotion = new JumoMotion();
  const service = new Service({
    scene,
    cauldron: { x: JUMO.stoveX - 0.3, y: 1.0, z: JUMO.stoveZ },
    castShadow: ctx.quality.shadows,
  });
  service.setReducedMotion(ctx.isReducedMotion());
  disposables.push(service);

  // ---- 매 프레임 ----
  const tickers = new Set<(dt: number) => void>();
  let glowLevel = 0;
  let reduced = ctx.isReducedMotion();
  const half = (t: number): number => (Math.sin(t) + Math.sin(t * 1.9 + 1.3)) / 2;

  const update = (dt: number, elapsed: number): void => {
    const now = performance.now();
    reduced = ctx.isReducedMotion();
    tv.setReducedMotion(reduced);
    bursts.setReducedMotion(reduced);
    tv.update(now);
    bursts.update(dt);
    scenery.update(dt, reduced);
    confetti.update(dt);
    service.setReducedMotion(reduced);
    service.update(dt);
    const jm = jumoMotion.update(dt, reduced);
    jumoMesh.position.y = jm.y;
    jumoMesh.rotation.set(0, JUMO.yaw + jm.yaw, jm.roll);
    jumoMesh.scale.y = jm.scaleY;
    for (const fn of tickers) fn(dt);

    glowLevel *= Math.exp(-dt / 1.1);
    if (glowLevel < 0.003) glowLevel = 0;
    // 초롱 불빛이 숨 쉬듯 살짝 흔들린다 (움직임 줄이기면 고정)
    for (const w of warm) {
      const flicker = reduced ? 0 : 0.045 * half(elapsed * 6.3 + w.seed);
      w.light.intensity = w.base * (1 + flicker + 0.9 * glowLevel);
    }
    hemi.intensity = 0.62 + 0.3 * glowLevel;
    haloMat.opacity = 0.62 + 0.3 * glowLevel;
    const pulse = tv.bannerActive && !reduced ? 0.06 * Math.sin(elapsed * 9) : 0;
    tvMat.color.setScalar(1 + pulse + 0.18 * glowLevel);
    tvLight.intensity = tvLightBase * (1 + 1.6 * glowLevel + (tv.bannerActive ? 0.35 : 0));
  };

  const stage: JumakStage = {
    scene,
    sound,
    setView: (view) => tv.setView(view),
    flashBanner: (text, tone, ms) => tv.showBanner(text, tone, ms),
    setTally: (snapshot) => tv.setTally(snapshot),
    emojiBurst: (id, at, scale) => bursts.spawn(id, at, scale),
    get activeEmojiCount() {
      return bursts.activeCount;
    },
    confetti: (count) => confetti.burst(count),
    glow: (strength) => {
      glowLevel = Math.max(glowLevel, Math.min(1, strength));
    },
    setReducedMotion: (on) => {
      reduced = on;
      tv.setReducedMotion(on);
      bursts.setReducedMotion(on);
      service.setReducedMotion(on);
    },
    setRoomName: (name) => sign.draw(name),
    serveDish: (dish, spot) => service.serve(dish, spot),
    get activeDishCount() {
      return service.activeCount;
    },
    jumoReply: () => jumoMotion.react(),
    jumoAnchor: (out) => out.set(JUMO.x, 1.62, JUMO.z),
    addTicker(fn) {
      tickers.add(fn);
      return () => tickers.delete(fn);
    },
    describe() {
      let meshes = 0;
      let triangles = 0;
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite) {
          if (!o.visible) return;
          meshes += 1;
          const g = m.geometry as THREE.BufferGeometry | undefined;
          if (g) triangles += g.index ? g.index.count / 3 : (g.getAttribute('position')?.count ?? 0) / 3;
        }
      });
      return { meshes, triangles: Math.round(triangles) };
    },
  };

  ctx.reportProgress(0.95);

  return {
    spawn: SPAWN,
    bounds: WALK_BOUNDS,
    blockers: WALK_BLOCKERS,
    groundHeight,
    camera: {
      distance: 3.8,
      portraitDistance: 5.0,
      pitch: 0.22,
      minDistance: 2.6,
      maxDistance: 8.5,
      minPitch: 0.06,
      maxPitch: 0.8,
      focusHeight: 1.3,
      lookAt: { x: TV.x, z: TV.z },
    },
    api: stage,
    update,
    dispose() {
      sound.dispose();
      for (const o of added) scene.remove(o);
      for (const d of disposables) d.dispose();
      key.shadow.map?.dispose();
      scene.background = previousBackground;
    },
  };
}

/** 보름달 그림: 밝은 원판에 옅은 바다(어두운 무늬)와 가장자리 어둡게 */
function makeMoonTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (!g) return tex;
  const c = size / 2;
  const r = size / 2 - 2;
  const base = g.createRadialGradient(c * 0.92, c * 0.9, r * 0.1, c, c, r);
  base.addColorStop(0, '#fffbea');
  base.addColorStop(0.8, '#f2e9c8');
  base.addColorStop(1, '#d9cfa8');
  g.fillStyle = base;
  g.beginPath();
  g.arc(c, c, r, 0, Math.PI * 2);
  g.fill();
  // 달의 바다 (토끼 무늬처럼 보이는 어두운 곳)
  g.save();
  g.beginPath();
  g.arc(c, c, r, 0, Math.PI * 2);
  g.clip();
  const maria: Array<[number, number, number, number]> = [
    [0.38, 0.36, 0.17, 0.22],
    [0.6, 0.3, 0.12, 0.2],
    [0.52, 0.52, 0.15, 0.18],
    [0.34, 0.62, 0.1, 0.16],
    [0.66, 0.6, 0.09, 0.14],
    [0.46, 0.76, 0.08, 0.1],
  ];
  for (const [x, y, rad, a] of maria) {
    const m = g.createRadialGradient(x * size, y * size, 0, x * size, y * size, rad * size);
    m.addColorStop(0, `rgba(150,140,115,${a + 0.12})`);
    m.addColorStop(1, 'rgba(150,140,115,0)');
    g.fillStyle = m;
    g.fillRect(0, 0, size, size);
  }
  g.restore();
  tex.needsUpdate = true;
  return tex;
}
