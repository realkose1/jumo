// 입력: 바닥/자리 누르기, 드래그 둘러보기, 두 손가락 확대, WASD/방향키, 숫자키 1 2 3.
// 드래그와 '누르기'를 구분한다(조금만 움직였으면 누르기).
import { Emitter, type Unsubscribe } from './events';

export interface InputEvents {
  tap: { clientX: number; clientY: number; pointerType: string };
  look: { dx: number; dy: number };
  /** 1보다 크면 멀어지기(축소), 작으면 가까워지기(확대) */
  zoom: { factor: number };
  actionKey: { key: 1 | 2 | 3 };
  /** 마우스를 누르지 않고 올려 둔 위치 (터치에는 없다) */
  hover: { clientX: number; clientY: number };
  /** 마우스가 캔버스를 떠났거나 눌러서 올려 둔 상태가 끝났다 */
  hoverEnd: Record<string, never>;
}

export interface MoveVector {
  /** 오른쪽 +1, 왼쪽 -1 */
  x: number;
  /** 앞 +1, 뒤 -1 */
  y: number;
}

/**
 * 화면 조이스틱 같은 아날로그 입력을 길이 1 안으로 맞춘다. 길이 자체가 걷는 빠르기라서
 * 1로 키우지 않고, 1보다 길 때만 줄인다. NaN, 무한대는 0으로 본다.
 */
export function clampMove(x: number, y: number): MoveVector {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
  const length = Math.hypot(x, y);
  if (length > 1) return { x: x / length, y: y / length };
  return { x, y };
}

/** 이보다 짧은 화면 조이스틱 입력은 '안 움직임'으로 보고 키보드 쪽을 따른다 */
const VIRTUAL_EPSILON = 1e-4;

const TAP_SLOP_MOUSE = 6;
const TAP_SLOP_TOUCH = 12;

const KEY_DIRECTION: Record<string, 'up' | 'down' | 'left' | 'right'> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

const ACTION_KEYS: Record<string, 1 | 2 | 3> = {
  Digit1: 1,
  Numpad1: 1,
  Digit2: 2,
  Numpad2: 2,
  Digit3: 3,
  Numpad3: 3,
};

interface PointerInfo {
  x: number;
  y: number;
  startX: number;
  startY: number;
  type: string;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

export class InputController {
  readonly events = new Emitter<InputEvents>();

  private readonly pointers = new Map<number, PointerInfo>();
  private readonly held = new Set<'up' | 'down' | 'left' | 'right'>();
  private enabled = true;
  private virtualX = 0; // 화면 조이스틱 (오른쪽 +1)
  private virtualY = 0; // 화면 조이스틱 (앞 +1)
  private dragging = false; // 한 손가락(마우스) 드래그가 시작됐는지
  private gestureDirty = false; // 두 손가락을 썼거나 이미 드래그라서 '누르기'가 아닌 제스처
  private pinchDistance = 0;
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly target: HTMLElement) {
    const on = <K extends keyof HTMLElementEventMap>(
      el: HTMLElement,
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      el.addEventListener(type, fn, options);
      this.disposers.push(() => el.removeEventListener(type, fn, options));
    };
    on(target, 'pointerdown', this.onPointerDown);
    on(target, 'pointermove', this.onPointerMove);
    on(target, 'pointerup', this.onPointerUp);
    on(target, 'pointercancel', this.onPointerCancel);
    on(target, 'pointerleave', () => this.events.emit('hoverEnd', {}));
    on(target, 'wheel', this.onWheel, { passive: false });
    on(target, 'contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.disposers.push(() => {
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
      window.removeEventListener('blur', this.onBlur);
    });
  }

  on<K extends keyof InputEvents>(type: K, fn: (payload: InputEvents[K]) => void): Unsubscribe {
    return this.events.on(type, fn);
  }

  /** 설정 창 같은 UI가 열려 있는 동안 끌 수 있다 */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      this.reset();
      this.events.emit('hoverEnd', {});
    }
  }

  /**
   * 화면 조이스틱의 방향과 세기. x 오른쪽 +1, y 앞 +1이고 길이는 1 안으로 맞춘다.
   * 길이가 곧 걷는 빠르기라서 키보드처럼 1로 키우지 않는다. (0, 0)이면 놓은 것이다.
   * 입력이 꺼져 있는 동안(설정 창)에는 받지 않는다.
   */
  setVirtualMove(x: number, y: number): void {
    if (!this.enabled) return;
    const v = clampMove(x, y);
    this.virtualX = v.x;
    this.virtualY = v.y;
  }

  /** 걷는 방향과 세기. 화면 조이스틱이 움직이는 중이면 그것을, 아니면 지금 눌린 이동키를 쓴다 */
  getMoveVector(): MoveVector {
    if (!this.enabled) return { x: 0, y: 0 };
    if (Math.hypot(this.virtualX, this.virtualY) > VIRTUAL_EPSILON) {
      return { x: this.virtualX, y: this.virtualY };
    }
    // 키보드: 대각선도 길이 1로 맞춘다
    let x = (this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0);
    let y = (this.held.has('up') ? 1 : 0) - (this.held.has('down') ? 1 : 0);
    if (x !== 0 && y !== 0) {
      x *= Math.SQRT1_2;
      y *= Math.SQRT1_2;
    }
    return { x, y };
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.events.clear();
  }

  private reset(): void {
    this.held.clear();
    this.virtualX = 0;
    this.virtualY = 0;
    this.pointers.clear();
    this.dragging = false;
    this.gestureDirty = false;
    this.pinchDistance = 0;
  }

  // ---- 포인터 ----

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    this.events.emit('hoverEnd', {});
    this.pointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      type: e.pointerType,
    });
    try {
      this.target.setPointerCapture(e.pointerId);
    } catch {
      /* 캡처 못 해도 동작에는 문제 없다 */
    }
    if (this.pointers.size === 1) {
      this.dragging = false;
      this.gestureDirty = e.pointerType === 'mouse' && e.button === 2; // 오른쪽 버튼은 둘러보기만
      if (this.gestureDirty) this.dragging = true;
    } else {
      this.gestureDirty = true;
      this.dragging = false;
      this.pinchDistance = this.currentPinchDistance();
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (this.enabled && e.pointerType === 'mouse' && this.pointers.size === 0) {
        this.events.emit('hover', { clientX: e.clientX, clientY: e.clientY });
      }
      return;
    }
    if (!this.enabled) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;

    if (this.pointers.size >= 2) {
      const d = this.currentPinchDistance();
      if (this.pinchDistance > 0 && d > 0) {
        this.events.emit('zoom', { factor: this.pinchDistance / d });
      }
      this.pinchDistance = d;
      return;
    }

    if (!this.dragging) {
      const slop = p.type === 'touch' || p.type === 'pen' ? TAP_SLOP_TOUCH : TAP_SLOP_MOUSE;
      if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) <= slop) return;
      this.dragging = true;
      this.gestureDirty = true;
      return; // 시작하는 순간의 튐은 버린다
    }
    this.events.emit('look', { dx, dy });
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    try {
      this.target.releasePointerCapture(e.pointerId);
    } catch {
      /* 이미 풀림 */
    }
    if (!this.enabled) return;
    const wasTap = !this.gestureDirty && this.pointers.size === 0 && !this.dragging;
    if (this.pointers.size === 0) {
      this.dragging = false;
      this.gestureDirty = false;
      this.pinchDistance = 0;
    } else {
      this.pinchDistance = 0; // 두 손가락 중 하나가 떨어졌다: 남은 손가락은 누르기로 치지 않는다
    }
    if (wasTap) this.events.emit('tap', { clientX: e.clientX, clientY: e.clientY, pointerType: p.type });
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) {
      this.dragging = false;
      this.gestureDirty = false;
      this.pinchDistance = 0;
    }
  };

  private currentPinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (!this.enabled) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    this.events.emit('zoom', { factor: Math.exp(e.deltaY * unit * 0.0012) });
  };

  // ---- 키보드 ----

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
    const dir = KEY_DIRECTION[e.code];
    if (dir) {
      this.held.add(dir);
      e.preventDefault();
      return;
    }
    const key = ACTION_KEYS[e.code];
    if (key && !e.repeat) this.events.emit('actionKey', { key });
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const dir = KEY_DIRECTION[e.code];
    if (dir) this.held.delete(dir);
  };

  private readonly onBlur = (): void => {
    this.held.clear();
  };
}
