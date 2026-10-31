import { describe, expect, it } from 'vitest';
import { LIMITS } from '@shared/protocol';
import { MoveSender, normalizeYaw } from './moveSender';

describe('MoveSender', () => {
  it('기본 간격은 서버 제한(LIMITS.moveHz, 초당 4번)을 따른다. welcome 값은 setMaxHz로 바꾼다', () => {
    expect(LIMITS.moveHz).toBe(4);
    const count = (m: MoveSender) => {
      m.markSent(0, 0, 0, 0);
      let sent = 0;
      let x = 0;
      for (let t = 16; t <= 2000; t += 16) {
        x += 0.04;
        if (m.next(x, 0, 0, t)) sent++;
      }
      return sent;
    };
    expect(count(new MoveSender())).toBeLessThanOrEqual(8);
    expect(count(new MoveSender())).toBeGreaterThanOrEqual(6);
    const fromWelcome = new MoveSender();
    fromWelcome.setMaxHz(2);
    expect(count(fromWelcome)).toBeLessThanOrEqual(4);
  });

  it('처음 join으로 알린 자리에서 안 움직였으면 보내지 않는다', () => {
    const m = new MoveSender({ maxHz: 10 });
    m.markSent(1, 2, 0.5, 0);
    expect(m.next(1, 2, 0.5, 1000)).toBeNull();
    expect(m.next(1.001, 2, 0.5, 2000)).toBeNull(); // 아주 작은 흔들림
  });

  it('움직이면 보낸다', () => {
    const m = new MoveSender({ maxHz: 10 });
    m.markSent(0, 0, 0, 0);
    expect(m.next(0.5, 0, 0, 200)).toEqual({ x: 0.5, z: 0, r: 0 });
  });

  it('초당 최대 10번: 프레임이 아무리 잦아도 간격을 지킨다', () => {
    const m = new MoveSender({ maxHz: 10 });
    m.markSent(0, 0, 0, 0);
    let sent = 0;
    let x = 0;
    // 60fps로 2초 동안 계속 걷는다
    for (let t = 16; t <= 2000; t += 16) {
      x += 0.04;
      if (m.next(x, 0, 0, t)) sent++;
    }
    expect(sent).toBeLessThanOrEqual(20);
    expect(sent).toBeGreaterThanOrEqual(15);
  });

  it('어느 1초 구간을 잡아도 10번을 넘지 않는다', () => {
    const m = new MoveSender({ maxHz: 10 });
    m.markSent(0, 0, 0, 0);
    const times: number[] = [];
    let x = 0;
    for (let t = 1; t <= 5000; t += 7) {
      x += 0.01;
      if (m.next(x, 0, 0, t)) times.push(t);
    }
    for (let i = 0; i + 10 < times.length; i++) {
      expect(times[i + 10]! - times[i]!).toBeGreaterThan(1000);
    }
  });

  it('간격 때문에 못 보낸 마지막 위치도 멈춘 뒤 한 번 나간다', () => {
    const m = new MoveSender({ maxHz: 10 });
    m.markSent(0, 0, 0, 0);
    expect(m.next(1, 0, 0, 200)).not.toBeNull();
    expect(m.next(1.5, 0, 0, 230)).toBeNull(); // 간격이 안 지났다
    expect(m.next(1.5, 0, 0, 260)).toBeNull();
    expect(m.next(1.5, 0, 0, 400)).toEqual({ x: 1.5, z: 0, r: 0 }); // 멈췄지만 마지막 위치는 보낸다
  });

  it('멈추면 더는 보내지 않는다', () => {
    const m = new MoveSender({ maxHz: 10 });
    m.markSent(0, 0, 0, 0);
    m.next(1, 0, 0, 200);
    for (let t = 300; t < 3000; t += 16) expect(m.next(1, 0, 0, t)).toBeNull();
  });

  it('제자리에서 방향만 바뀌어도 보낸다 (작은 떨림은 무시)', () => {
    const m = new MoveSender({ maxHz: 10 });
    m.markSent(0, 0, 0, 0);
    expect(m.next(0, 0, 0.01, 500)).toBeNull();
    expect(m.next(0, 0, 1, 700)).toEqual({ x: 0, z: 0, r: 1 });
  });

  it('방향은 -π~π로 맞춰 보낸다', () => {
    const m = new MoveSender({ maxHz: 10 });
    m.markSent(0, 0, 0, 0);
    const out = m.next(1, 0, Math.PI * 3, 500)!;
    expect(out.r).toBeCloseTo(Math.PI, 5);
    expect(normalizeYaw(Math.PI * 2 + 0.5)).toBeCloseTo(0.5, 5);
    expect(normalizeYaw(Number.NaN)).toBe(0);
  });

  it('reset 뒤 첫 호출은 바로 나간다', () => {
    const m = new MoveSender({ maxHz: 10 });
    m.markSent(0, 0, 0, 0);
    m.reset();
    expect(m.next(0, 0, 0, 10)).not.toBeNull();
  });

  it('서버가 알려준 속도 제한에 맞춘다', () => {
    const m = new MoveSender({ maxHz: 10 });
    m.setMaxHz(5);
    m.markSent(0, 0, 0, 0);
    expect(m.next(1, 0, 0, 150)).toBeNull(); // 5Hz면 200ms 이상
    expect(m.next(1, 0, 0, 250)).not.toBeNull();
  });
});

describe('MoveSender force', () => {
  it('앉기 직전처럼 꼭 알려야 하면 간격을 기다리지 않는다 (바뀐 게 있을 때만)', () => {
    const m = new MoveSender({ maxHz: 10 });
    m.markSent(0, 0, 0, 0);
    m.next(1, 0, 0, 200);
    expect(m.next(1.5, 0, 0, 230)).toBeNull();
    expect(m.next(1.5, 0, 0, 230, true)).toEqual({ x: 1.5, z: 0, r: 0 });
    expect(m.next(1.5, 0, 0, 240, true)).toBeNull();
  });
});
