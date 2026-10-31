// 휴대폰 왼쪽 아래 화면 조이스틱. 손가락을 끈 방향으로 걷고(카메라가 보는 쪽이 위), 끈 만큼 빠르게 걷는다.
// 놓으면 멈춘다. 터치(굵은 포인터) 기기에서만 보이고, 주소에 ?joystick=1 이면 어디서나, =0 이면 끈다.
//
// 조이스틱은 3D 캔버스 위의 DOM 요소다. 자기 손가락만 pointer capture로 잡기 때문에
// 캔버스(InputController)는 이 손가락을 보지 못한다: 다른 손가락으로는 그대로 둘러보고 두 손가락으로 확대할 수 있다.
import type { Engine } from '../engine/Engine';
import { h } from './dom';
import { S } from './strings';

/** 손잡이가 가운데에서 가장 멀리 갈 수 있는 거리(px). 이만큼 끌면 최대 빠르기 */
export const JOYSTICK_RADIUS = 36;
/** 이 비율(0~1)보다 덜 끌면 안 움직인다. 손가락이 가만히 있어도 미세하게 떨리는 것을 거른다 */
export const JOYSTICK_DEAD_ZONE = 0.12;

export interface StickVector {
  /** 오른쪽 +1 */
  x: number;
  /** 앞(화면 위로 끌기) +1 */
  y: number;
}

/** 부드러운 세기 곡선: 0에서 살살 출발하고 1에서 살살 닿는다. 0~1 -> 0~1, 가운데(0.5)는 그대로 0.5 */
export function stickCurve(t: number): number {
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * 가운데에서 (dx, dy)px 끈 것(화면 좌표: 오른쪽 +, 아래 +)을 걷기 방향/세기로 바꾼다.
 * 위로 끌면 앞(y=+1), 오른쪽으로 끌면 x=+1. 길이가 곧 빠르기(0~1)다.
 * 데드존 안은 (0, 0). 데드존 끝에서 0으로 시작해 radius에서 1이 되도록 다시 펴서 튀는 구간이 없다.
 */
export function joystickVector(
  dx: number,
  dy: number,
  radius: number = JOYSTICK_RADIUS,
  deadZone: number = JOYSTICK_DEAD_ZONE,
): StickVector {
  const dist = Math.hypot(dx, dy);
  if (!Number.isFinite(dist) || !(radius > 0) || dist === 0) return { x: 0, y: 0 };
  const raw = Math.min(1, dist / radius);
  const dead = Math.min(Math.max(deadZone, 0), 0.99);
  if (raw <= dead) return { x: 0, y: 0 };
  const speed = stickCurve((raw - dead) / (1 - dead));
  // 0 - 값: dy가 0일 때 -0이 되지 않게 한다
  return { x: (speed * dx) / dist, y: 0 - (speed * dy) / dist };
}

/** 손잡이를 그릴 위치: (dx, dy)가 radius 밖이면 같은 방향의 원 위로 끌어온다 */
export function clampToRadius(dx: number, dy: number, radius: number = JOYSTICK_RADIUS): { x: number; y: number } {
  const dist = Math.hypot(dx, dy);
  if (!Number.isFinite(dist) || dist === 0) return { x: 0, y: 0 };
  if (dist <= radius) return { x: dx, y: dy };
  return { x: (dx / dist) * radius, y: (dy / dist) * radius };
}

/** 주소의 ?joystick= 값: 1이면 true(항상 보임), 0이면 false(항상 숨김), 그 밖에는 null(기기를 보고 정함) */
export function joystickOverride(search: string): boolean | null {
  const value = new URLSearchParams(search).get('joystick');
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return null;
}

/** 조이스틱을 보여줄지: 주소가 정했으면 그대로, 아니면 터치(굵은 포인터) 기기일 때 */
export function joystickWanted(override: boolean | null, coarsePointer: boolean): boolean {
  return override ?? coarsePointer;
}

export interface JoystickOptions {
  /** true/false면 기기와 상관없이 보이거나 숨긴다. 없으면 주소의 ?joystick= 를, 그것도 없으면 기기를 따른다 */
  force?: boolean | null;
  radius?: number;
  deadZone?: number;
}

/** 화면 조이스틱을 parent(UI 바탕)에 붙인다. 보이는 동안 parent에 qs-ui--touch 를 달아 동작 버튼 배치를 터치용으로 바꾼다. */
export function mountJoystick(engine: Engine, parent: HTMLElement, options: JoystickOptions = {}): () => void {
  const radius = options.radius ?? JOYSTICK_RADIUS;
  const deadZone = options.deadZone ?? JOYSTICK_DEAD_ZONE;
  const forced = options.force !== undefined ? options.force : joystickOverride(window.location.search);

  const hintId = `qs-joystick-hint-${Math.random().toString(36).slice(2, 8)}`;
  const thumb = h('span', { class: 'qs-joystick__thumb', 'aria-hidden': true });
  const base = h(
    'div',
    {
      class: 'qs-joystick',
      role: 'application',
      'aria-label': S.joystick.label,
      'aria-roledescription': S.joystick.roleDescription,
      'aria-describedby': hintId,
      hidden: true,
    },
    h('span', { class: 'qs-joystick__tick qs-joystick__tick--up', 'aria-hidden': true }),
    h('span', { class: 'qs-joystick__tick qs-joystick__tick--right', 'aria-hidden': true }),
    h('span', { class: 'qs-joystick__tick qs-joystick__tick--down', 'aria-hidden': true }),
    h('span', { class: 'qs-joystick__tick qs-joystick__tick--left', 'aria-hidden': true }),
    thumb,
    h('span', { class: 'qs-joystick__hint', id: hintId }, S.joystick.hint),
  );
  parent.appendChild(base);

  let visible = false;
  let inputEnabled = true;
  let activeId: number | null = null;
  let centerX = 0;
  let centerY = 0;

  const drawThumb = (x: number, y: number): void => {
    thumb.style.transform = x === 0 && y === 0 ? '' : `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
  };

  /** 손가락 위치를 방향/세기로 바꿔 엔진에 알린다 */
  const track = (clientX: number, clientY: number): void => {
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const spot = clampToRadius(dx, dy, radius);
    drawThumb(spot.x, spot.y);
    const v = joystickVector(dx, dy, radius, deadZone);
    engine.setVirtualMove(v.x, v.y);
  };

  const onWindowMove = (e: PointerEvent): void => {
    if (e.pointerId === activeId) track(e.clientX, e.clientY);
  };
  const onWindowEnd = (e: PointerEvent): void => {
    if (e.pointerId === activeId) release();
  };
  const onLostCapture = (e: PointerEvent): void => {
    if (e.pointerId === activeId) release();
  };

  /** 손을 놓은 상태로 돌린다. 눌린 손가락이 없어도 안전하게 부를 수 있다 */
  function release(): void {
    const id = activeId;
    activeId = null;
    window.removeEventListener('pointermove', onWindowMove);
    window.removeEventListener('pointerup', onWindowEnd);
    window.removeEventListener('pointercancel', onWindowEnd);
    if (id !== null) {
      try {
        base.releasePointerCapture(id);
      } catch {
        /* 이미 풀림 */
      }
      engine.setVirtualMove(0, 0);
    }
    base.classList.remove('is-active');
    drawThumb(0, 0);
  }

  const onPointerDown = (e: PointerEvent): void => {
    if (!visible || !inputEnabled || activeId !== null) return; // 조이스틱 손가락은 하나만
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    activeId = e.pointerId;
    try {
      base.setPointerCapture(e.pointerId);
    } catch {
      /* 캡처 못 해도 window 쪽 리스너가 이어받는다 */
    }
    // 캡처가 없어도 손가락이 조이스틱 밖으로 나가서 끝까지 따라가게
    window.addEventListener('pointermove', onWindowMove);
    window.addEventListener('pointerup', onWindowEnd);
    window.addEventListener('pointercancel', onWindowEnd);
    const rect = base.getBoundingClientRect();
    centerX = rect.left + rect.width / 2;
    centerY = rect.top + rect.height / 2;
    base.classList.add('is-active');
    track(e.clientX, e.clientY);
  };

  const onContextMenu = (e: Event): void => e.preventDefault();
  const onBlur = (): void => release();
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') release();
  };

  base.addEventListener('pointerdown', onPointerDown);
  base.addEventListener('lostpointercapture', onLostCapture);
  base.addEventListener('contextmenu', onContextMenu);
  base.addEventListener('dragstart', onContextMenu);
  window.addEventListener('blur', onBlur);
  window.addEventListener('pagehide', onBlur);
  document.addEventListener('visibilitychange', onVisibility);

  // 설정 창이 열려 입력이 꺼지면 손을 놓은 것으로 돌린다(엔진 쪽 벡터도 이미 0이다)
  const offInput = engine.on('input-enabled', ({ enabled }) => {
    inputEnabled = enabled;
    if (!enabled) release();
  });

  // 보일지 말지: 주소가 정했으면 그대로, 아니면 굵은 포인터(터치) 기기일 때. 기기가 바뀌면(키보드 연결 등) 따라간다
  const coarse = typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null;
  const applyVisibility = (): void => {
    visible = joystickWanted(forced, coarse?.matches ?? false);
    base.hidden = !visible;
    parent.classList.toggle('qs-ui--touch', visible);
    if (!visible) release();
  };
  applyVisibility();
  coarse?.addEventListener?.('change', applyVisibility);

  return () => {
    release();
    engine.setVirtualMove(0, 0);
    offInput();
    coarse?.removeEventListener?.('change', applyVisibility);
    base.removeEventListener('pointerdown', onPointerDown);
    base.removeEventListener('lostpointercapture', onLostCapture);
    base.removeEventListener('contextmenu', onContextMenu);
    base.removeEventListener('dragstart', onContextMenu);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('pagehide', onBlur);
    document.removeEventListener('visibilitychange', onVisibility);
    parent.classList.remove('qs-ui--touch');
    base.remove();
  };
}
