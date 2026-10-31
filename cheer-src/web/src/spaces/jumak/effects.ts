// 장면에 얹는 반짝이는 것들: 머리 위로 떠오르는 이모지, 골 순간의 색종이.
import * as THREE from 'three';
import { MAKGEOLLI_ICON, makgeolliImage } from './makgeolli';

const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function makeEmojiTexture(emoji: string, picture?: () => HTMLImageElement | null, onPicture?: (draw: () => void) => void): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (!ctx) return tex;
  const drawEmoji = (): void => {
    ctx.font = `92px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, size / 2, size / 2 + 6);
  };
  const drawPicture = (img: HTMLImageElement): void => {
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 8, 8, size - 16, size - 16);
    tex.needsUpdate = true;
  };
  const img = picture?.();
  if (img) drawPicture(img);
  else {
    // 그림이 아직 안 왔으면 이모지로 그려 두고, 오면 바꿔 그린다
    drawEmoji();
    onPicture?.(() => {
      const ready = picture?.();
      if (ready) drawPicture(ready);
    });
  }
  return tex;
}

interface Puff {
  sprite: THREE.Sprite;
  active: boolean;
  age: number;
  life: number;
  x: number;
  y: number;
  z: number;
  phase: number;
  size: number;
}

/** 박수, 건배를 할 때 머리 위로 떠올라 사라지는 이모지 */
export class EmojiBursts {
  private readonly pool: Puff[] = [];
  private readonly textures = new Map<string, THREE.CanvasTexture>();
  private reduced = false;

  constructor(
    private readonly scene: THREE.Scene,
    emojiById: Readonly<Record<string, string>>,
    max = 28,
    /** 이모지 대신 쓰는 그림 (예: 건배는 막걸리 사발) */
    pictureById: Readonly<Record<string, string>> = {},
  ) {
    for (const [id, emoji] of Object.entries(emojiById)) {
      const usesMakgeolli = pictureById[id] === MAKGEOLLI_ICON;
      this.textures.set(
        id,
        usesMakgeolli ? makeEmojiTexture(emoji, () => makgeolliImage(), (draw) => void makgeolliImage(draw)) : makeEmojiTexture(emoji),
      );
    }
    const first = this.textures.values().next().value as THREE.Texture | undefined;
    for (let i = 0; i < max; i++) {
      // 투명도를 따로 줘야 해서 재질은 하나씩
      const material = new THREE.SpriteMaterial({ map: first ?? null, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      sprite.renderOrder = 20;
      scene.add(sprite);
      this.pool.push({ sprite, active: false, age: 0, life: 1, x: 0, y: 0, z: 0, phase: 0, size: 0.6 });
    }
  }

  setReducedMotion(on: boolean): void {
    this.reduced = on;
  }

  /** 지금 떠 있는 이모지 수 */
  get activeCount(): number {
    let n = 0;
    for (const p of this.pool) if (p.active) n += 1;
    return n;
  }

  /** at: 머리 위 좌표. 풀이 가득 차면 가장 오래된 것을 다시 쓴다 */
  spawn(actionId: string, at: THREE.Vector3, scale = 1): void {
    const tex = this.textures.get(actionId);
    if (!tex) return;
    let slot = this.pool.find((p) => !p.active);
    if (!slot) slot = this.pool.reduce((a, b) => (a.age / a.life > b.age / b.life ? a : b));
    slot.active = true;
    slot.age = 0;
    slot.life = this.reduced ? 0.9 : 1.35;
    slot.x = at.x;
    slot.y = at.y;
    slot.z = at.z;
    slot.phase = Math.random() * Math.PI * 2;
    slot.size = 0.58 * scale;
    const mat = slot.sprite.material;
    mat.map = tex;
    mat.opacity = 1;
    slot.sprite.visible = true;
    slot.sprite.position.copy(at);
    slot.sprite.scale.setScalar(slot.size);
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }
      const mat = p.sprite.material;
      if (this.reduced) {
        p.sprite.position.set(p.x, p.y + 0.45, p.z);
        mat.opacity = t < 0.5 ? 1 : (1 - t) / 0.5;
        p.sprite.scale.setScalar(p.size);
      } else {
        const rise = 1.05 * easeOutCubic(t);
        p.sprite.position.set(p.x + Math.sin(p.age * 5 + p.phase) * 0.06, p.y + rise, p.z);
        mat.opacity = t < 0.55 ? 1 : (1 - t) / 0.45;
        const pop = t < 0.14 ? 0.45 + 0.55 * easeOutBack(t / 0.14) : 1;
        p.sprite.scale.setScalar(p.size * pop * (1 - 0.12 * t));
      }
    }
  }

  dispose(): void {
    for (const p of this.pool) {
      this.scene.remove(p.sprite);
      p.sprite.material.dispose();
    }
    for (const t of this.textures.values()) t.dispose();
    this.pool.length = 0;
    this.textures.clear();
  }
}

// ---- 색종이 ----
const CONFETTI_COLORS = [0xf5c400, 0xffd83a, 0xe0352b, 0x2d62d6, 0xffffff, 0xff8a3d] as const;
const GRAVITY = 6;
const TERMINAL_FALL = 2.1;

interface Piece {
  active: boolean;
  delay: number;
  age: number;
  life: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  ax: number;
  ay: number;
  az: number;
  wx: number;
  wy: number;
  wz: number;
  phase: number;
  size: number;
  fade: number;
}

export interface ConfettiOptions {
  /** (x, z)의 바닥 높이 (평상 위에 쌓이게) */
  ground?: (x: number, z: number) => number;
  /** 대포가 서는 z (TV 앞) */
  cannonZ: number;
  /** 보는 카메라. 있으면 색종이 비가 카메라 앞쪽에 내리고, 카메라 가까이에 온 조각은 작아진다 */
  camera?: THREE.Camera;
}

/** 카메라에서 이 거리보다 가까우면 조각이 작아져 화면을 덮지 않는다 */
const NEAR_FADE_START = 0.9;
const NEAR_FADE_END = 2.4;

/** 골 순간의 색종이: TV 양옆에서 쏘아 올리고 천장에서도 내린다. 그리기 호출 1번 */
export class Confetti {
  private readonly mesh: THREE.InstancedMesh;
  private readonly pieces: Piece[];
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly color = new THREE.Color();
  private readonly fwd = new THREE.Vector3();
  private live = 0;

  constructor(
    private readonly scene: THREE.Scene,
    max: number,
    private readonly options: ConfettiOptions,
  ) {
    this.geometry = new THREE.PlaneGeometry(0.1, 0.16);
    this.material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, max);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.visible = false;
    this.pieces = Array.from({ length: max }, () => ({
      active: false, delay: 0, age: 0, life: 4, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0,
      ax: 0, ay: 0, az: 0, wx: 0, wy: 0, wz: 0, phase: 0, size: 1, fade: 0,
    }));
    for (let i = 0; i < max; i++) {
      this.mesh.setMatrixAt(i, this.zero);
      this.mesh.setColorAt(i, this.color.set(0xffffff));
    }
    scene.add(this.mesh);
  }

  get activeCount(): number {
    return this.live;
  }

  /** count개를 터뜨린다. 쓸 수 있는 조각이 모자라면 있는 만큼만 */
  burst(count: number): void {
    const rand = Math.random;
    let made = 0;
    for (let i = 0; i < this.pieces.length && made < count; i++) {
      const c = this.pieces[i]!;
      if (c.active) continue;
      const cannon = made % 100 < 58;
      if (cannon) {
        const side = made % 2 === 0 ? -1 : 1;
        c.px = side * (3.3 + rand() * 0.6);
        c.py = 0.8 + rand() * 0.4;
        c.pz = this.options.cannonZ + rand() * 0.6;
        c.vx = -side * (1.2 + rand() * 2.6);
        c.vy = 6.2 + rand() * 3.4;
        c.vz = 0.8 + rand() * 3.2;
        c.delay = rand() * 0.25;
      } else {
        // 카메라가 보는 쪽 앞에 비처럼 내린다 (카메라가 없으면 방 한가운데)
        const cam = this.options.camera;
        if (cam) {
          cam.getWorldDirection(this.fwd);
          this.fwd.y = 0;
          if (this.fwd.lengthSq() < 1e-4) this.fwd.set(0, 0, -1);
          this.fwd.normalize();
          const ahead = 2.8 + rand() * 7;
          const side = (rand() - 0.5) * (4 + ahead * 0.8);
          c.px = cam.position.x + this.fwd.x * ahead - this.fwd.z * side;
          c.pz = cam.position.z + this.fwd.z * ahead + this.fwd.x * side;
        } else {
          c.px = (rand() - 0.5) * 11;
          c.pz = -5 + rand() * 8;
        }
        c.py = 4.0 + rand() * 0.5;
        c.vx = (rand() - 0.5) * 0.8;
        c.vy = -0.4 - rand() * 0.8;
        c.vz = (rand() - 0.5) * 0.8;
        c.delay = 0.3 + rand() * 1.5;
      }
      c.age = 0;
      c.life = 5.2 + rand() * 1.2;
      c.ax = rand() * 6.28;
      c.ay = rand() * 6.28;
      c.az = rand() * 6.28;
      c.wx = (rand() - 0.5) * 14;
      c.wy = (rand() - 0.5) * 14;
      c.wz = (rand() - 0.5) * 10;
      c.phase = rand() * 6.28;
      c.size = 0.75 + rand() * 0.7;
      c.fade = 0;
      c.active = true;
      this.mesh.setColorAt(i, this.color.set(CONFETTI_COLORS[Math.floor(rand() * CONFETTI_COLORS.length)]!));
      made += 1;
    }
    if (made > 0) {
      this.live += made;
      this.mesh.visible = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  update(dt: number): void {
    if (this.live === 0) return;
    const ground = this.options.ground ?? (() => 0);
    const cam = this.options.camera;
    let alive = 0;
    for (let i = 0; i < this.pieces.length; i++) {
      const c = this.pieces[i]!;
      if (!c.active) continue;
      if (c.delay > 0) {
        c.delay -= dt;
        this.mesh.setMatrixAt(i, this.zero);
        alive += 1;
        continue;
      }
      c.age += dt;
      c.vy = Math.max(c.vy - GRAVITY * dt, -TERMINAL_FALL);
      const drag = Math.exp(-1.1 * dt);
      c.vx *= drag;
      c.vz *= drag;
      c.px += (c.vx + Math.sin(c.age * 3.4 + c.phase) * 0.35) * dt;
      c.py += c.vy * dt;
      c.pz += (c.vz + Math.cos(c.age * 2.7 + c.phase) * 0.3) * dt;
      c.ax += c.wx * dt;
      c.ay += c.wy * dt;
      c.az += c.wz * dt;
      const floor = ground(c.px, c.pz) + 0.02;
      let scale = c.size;
      if (c.py <= floor) {
        // 바닥에 닿으면 멈추고 서서히 사라진다
        c.py = floor;
        c.vy = 0;
        c.vx = 0;
        c.vz = 0;
        c.wx = c.wy = c.wz = 0;
        c.fade += dt;
      }
      if (c.age > c.life - 0.5) c.fade = Math.max(c.fade, c.age - (c.life - 0.5));
      if (c.fade > 0) scale *= Math.max(0, 1 - c.fade / 0.5);
      if (cam) {
        const d = Math.hypot(c.px - cam.position.x, c.py - cam.position.y, c.pz - cam.position.z);
        if (d < NEAR_FADE_END) scale *= Math.max(0, (d - NEAR_FADE_START) / (NEAR_FADE_END - NEAR_FADE_START));
      }
      if (c.age >= c.life || (c.fade > 0 && scale <= 0.01)) {
        c.active = false;
        this.mesh.setMatrixAt(i, this.zero);
        continue;
      }
      this.e.set(c.ax, c.ay, c.az);
      this.q.setFromEuler(this.e);
      this.p.set(c.px, c.py, c.pz);
      this.s.setScalar(scale);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      alive += 1;
    }
    this.live = alive;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (alive === 0) this.mesh.visible = false;
  }

  /** 모두 치운다 */
  clear(): void {
    for (let i = 0; i < this.pieces.length; i++) {
      this.pieces[i]!.active = false;
      this.mesh.setMatrixAt(i, this.zero);
    }
    this.live = 0;
    this.mesh.visible = false;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
