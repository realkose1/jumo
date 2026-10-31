import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputController, clampMove } from './input';

type Handler = (event: unknown) => void;

/** InputController는 만들 때 target과 window에 리스너를 단다. node 환경이라 최소한의 가짜를 준다. */
function setup() {
  const windowHandlers = new Map<string, Handler>();
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: Handler) => windowHandlers.set(type, fn),
    removeEventListener: (type: string) => windowHandlers.delete(type),
  });
  const target = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  } as unknown as HTMLElement;
  const input = new InputController(target);
  const key = (type: 'keydown' | 'keyup', code: string) =>
    windowHandlers.get(type)?.({
      code,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      repeat: false,
      target: null,
      preventDefault: () => {},
    });
  return { input, key, windowHandlers };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('clampMove', () => {
  it('길이 1 안은 그대로 둔다 (길이가 곧 빠르기라서 키우지 않는다)', () => {
    expect(clampMove(0.3, -0.4)).toEqual({ x: 0.3, y: -0.4 });
    expect(clampMove(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('1보다 길면 방향은 두고 길이만 1로 줄인다', () => {
    const v = clampMove(3, 4);
    expect(v.x).toBeCloseTo(0.6, 6);
    expect(v.y).toBeCloseTo(0.8, 6);
    expect(Math.hypot(clampMove(-9, 9).x, clampMove(-9, 9).y)).toBeCloseTo(1, 6);
  });

  it('숫자가 아닌 값은 0으로 본다', () => {
    expect(clampMove(Number.NaN, 1)).toEqual({ x: 0, y: 0 });
    expect(clampMove(1, Number.POSITIVE_INFINITY)).toEqual({ x: 0, y: 0 });
  });
});

describe('InputController.setVirtualMove', () => {
  it('아무것도 안 하면 (0, 0)이다', () => {
    const { input } = setup();
    expect(input.getMoveVector()).toEqual({ x: 0, y: 0 });
  });

  it('조이스틱 값은 길이를 1로 키우지 않고 그대로 낸다 (아날로그 빠르기)', () => {
    const { input } = setup();
    input.setVirtualMove(0.5, 0);
    expect(input.getMoveVector()).toEqual({ x: 0.5, y: 0 });
    input.setVirtualMove(0, 0.25);
    expect(input.getMoveVector()).toEqual({ x: 0, y: 0.25 });
  });

  it('길이 1이 넘으면 1로 줄인다', () => {
    const { input } = setup();
    input.setVirtualMove(3, 4);
    const v = input.getMoveVector();
    expect(v.x).toBeCloseTo(0.6, 6);
    expect(v.y).toBeCloseTo(0.8, 6);
  });

  it('(0, 0)을 주면 멈춘다', () => {
    const { input } = setup();
    input.setVirtualMove(0, 1);
    input.setVirtualMove(0, 0);
    expect(input.getMoveVector()).toEqual({ x: 0, y: 0 });
  });

  it('조이스틱이 움직이는 동안은 조이스틱이 이기고, 놓으면 키보드로 돌아온다', () => {
    const { input, key } = setup();
    key('keydown', 'KeyW');
    expect(input.getMoveVector()).toEqual({ x: 0, y: 1 });
    input.setVirtualMove(1, 0);
    expect(input.getMoveVector()).toEqual({ x: 1, y: 0 });
    input.setVirtualMove(0, 0);
    expect(input.getMoveVector()).toEqual({ x: 0, y: 1 });
  });

  it('키보드 대각선은 여전히 길이 1로 맞춘다', () => {
    const { input, key } = setup();
    key('keydown', 'KeyW');
    key('keydown', 'KeyD');
    const v = input.getMoveVector();
    expect(v.x).toBeCloseTo(Math.SQRT1_2, 6);
    expect(v.y).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('입력이 꺼지면 (0, 0)이고, 꺼진 동안 들어온 값은 받지 않는다', () => {
    const { input } = setup();
    input.setVirtualMove(0, 1);
    input.setEnabled(false);
    expect(input.getMoveVector()).toEqual({ x: 0, y: 0 });
    input.setVirtualMove(1, 0); // 설정 창이 열린 뒤에도 손가락이 움직였다
    expect(input.getMoveVector()).toEqual({ x: 0, y: 0 });
    input.setEnabled(true);
    expect(input.getMoveVector()).toEqual({ x: 0, y: 0 }); // 켜져도 이전 값이 되살아나지 않는다
    input.setVirtualMove(0, 0.5);
    expect(input.getMoveVector()).toEqual({ x: 0, y: 0.5 });
  });

  it('dispose 뒤에는 리스너를 모두 푼다', () => {
    const { input, windowHandlers } = setup();
    expect(windowHandlers.size).toBeGreaterThan(0);
    input.dispose();
    expect(windowHandlers.size).toBe(0);
  });
});
