import { describe, expect, it } from 'vitest';
import {
  JOYSTICK_DEAD_ZONE,
  JOYSTICK_RADIUS,
  clampToRadius,
  joystickOverride,
  joystickVector,
  joystickWanted,
  stickCurve,
} from './joystick';

const R = JOYSTICK_RADIUS;
const len = (v: { x: number; y: number }) => Math.hypot(v.x, v.y);

describe('joystickVector', () => {
  it('가운데와 데드존 안은 (0, 0)이다', () => {
    expect(joystickVector(0, 0, R)).toEqual({ x: 0, y: 0 });
    expect(joystickVector(2, -2, R)).toEqual({ x: 0, y: 0 });
    // 데드존 경계 바로 안쪽
    expect(joystickVector(R * JOYSTICK_DEAD_ZONE * 0.999, 0, R)).toEqual({ x: 0, y: 0 });
  });

  it('데드존을 막 넘으면 0에서 시작한다 (튀는 구간이 없다)', () => {
    const v = joystickVector(R * (JOYSTICK_DEAD_ZONE + 0.01), 0, R);
    expect(v.x).toBeGreaterThan(0);
    expect(len(v)).toBeLessThan(0.01);
  });

  it('위로 끌면 앞(y=+1), 아래는 뒤(y=-1)', () => {
    const up = joystickVector(0, -R, R);
    expect(up.x).toBeCloseTo(0, 6);
    expect(up.y).toBeCloseTo(1, 6);
    const down = joystickVector(0, R, R);
    expect(down.y).toBeCloseTo(-1, 6);
  });

  it('오른쪽으로 끌면 x=+1, 왼쪽은 x=-1', () => {
    const right = joystickVector(R, 0, R);
    expect(right.x).toBeCloseTo(1, 6);
    expect(right.y).toBeCloseTo(0, 6);
    expect(joystickVector(-R, 0, R).x).toBeCloseTo(-1, 6);
  });

  it('반지름 밖으로 끌어도 길이는 1을 넘지 않고 방향은 같다', () => {
    const v = joystickVector(300, -300, R);
    expect(len(v)).toBeCloseTo(1, 6);
    expect(v.x).toBeCloseTo(Math.SQRT1_2, 6);
    expect(v.y).toBeCloseTo(Math.SQRT1_2, 6);
    expect(len(joystickVector(-1e6, 5, R))).toBeCloseTo(1, 6);
  });

  it('끈 만큼 빠르다: 길이가 거리에 따라 줄어들지 않고 늘어난다', () => {
    let last = 0;
    for (let d = R * JOYSTICK_DEAD_ZONE + 0.5; d <= R; d += 1) {
      const l = len(joystickVector(d, 0, R));
      expect(l).toBeGreaterThanOrEqual(last);
      last = l;
    }
    expect(len(joystickVector(R, 0, R))).toBeCloseTo(1, 6);
    expect(len(joystickVector(R, 0, R))).toBeGreaterThanOrEqual(last);
  });

  it('데드존 끝과 반지름 사이의 한가운데는 절반 빠르기다', () => {
    const mid = R * (JOYSTICK_DEAD_ZONE + (1 - JOYSTICK_DEAD_ZONE) / 2);
    expect(len(joystickVector(mid, 0, R))).toBeCloseTo(0.5, 6);
  });

  it('대각선은 방향 비율을 지킨다', () => {
    const v = joystickVector(20, -10, R); // 오른쪽 위, x가 y의 2배
    expect(v.x).toBeGreaterThan(0);
    expect(v.y).toBeGreaterThan(0);
    expect(v.x / v.y).toBeCloseTo(2, 6);
  });

  it('-0을 내지 않는다', () => {
    expect(Object.is(joystickVector(R, 0, R).y, 0)).toBe(true);
    expect(Object.is(joystickVector(0, R, R).x, 0)).toBe(true);
  });

  it('엉뚱한 값에도 (0, 0)이다', () => {
    expect(joystickVector(Number.NaN, 5, R)).toEqual({ x: 0, y: 0 });
    expect(joystickVector(10, 10, 0)).toEqual({ x: 0, y: 0 });
    expect(joystickVector(10, 10, -5)).toEqual({ x: 0, y: 0 });
  });

  it('데드존을 직접 정할 수 있다', () => {
    expect(joystickVector(10, 0, R, 0.5)).toEqual({ x: 0, y: 0 });
    expect(len(joystickVector(10, 0, R, 0))).toBeGreaterThan(0);
  });
});

describe('stickCurve', () => {
  it('0은 0, 1은 1, 범위 밖은 끝에 붙인다', () => {
    expect(stickCurve(0)).toBe(0);
    expect(stickCurve(1)).toBe(1);
    expect(stickCurve(-3)).toBe(0);
    expect(stickCurve(4)).toBe(1);
    expect(stickCurve(0.5)).toBeCloseTo(0.5, 6);
  });

  it('늘어나기만 한다', () => {
    let last = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const c = stickCurve(t);
      expect(c).toBeGreaterThanOrEqual(last);
      last = c;
    }
  });
});

describe('clampToRadius', () => {
  it('반지름 안은 그대로, 밖은 같은 방향의 원 위로 끌어온다', () => {
    expect(clampToRadius(10, -5, R)).toEqual({ x: 10, y: -5 });
    const c = clampToRadius(R * 3, 0, R);
    expect(c.x).toBeCloseTo(R, 6);
    expect(c.y).toBeCloseTo(0, 6);
    expect(len(clampToRadius(100, 100, R))).toBeCloseTo(R, 6);
    expect(clampToRadius(0, 0, R)).toEqual({ x: 0, y: 0 });
  });
});

describe('보일지 정하기', () => {
  it('주소의 ?joystick= 값을 읽는다', () => {
    expect(joystickOverride('?joystick=1')).toBe(true);
    expect(joystickOverride('?demo=1&joystick=1')).toBe(true);
    expect(joystickOverride('?joystick=0')).toBe(false);
    expect(joystickOverride('?joystick=')).toBeNull();
    expect(joystickOverride('')).toBeNull();
    expect(joystickOverride('?demo=1')).toBeNull();
  });

  it('주소가 정했으면 기기와 상관없고, 아니면 터치 기기일 때만 보인다', () => {
    expect(joystickWanted(true, false)).toBe(true);
    expect(joystickWanted(false, true)).toBe(false);
    expect(joystickWanted(null, true)).toBe(true);
    expect(joystickWanted(null, false)).toBe(false);
  });
});
