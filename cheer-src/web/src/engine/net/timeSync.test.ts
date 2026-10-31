import { describe, expect, it } from 'vitest';
import { QuietClock } from '../time';
import { TimeSync, sampleFromPong, sampleFromWelcome } from './timeSync';

describe('sampleFromPong', () => {
  it('왕복 = 받은 시각 - 보낸 시각, 차이 = 서버 시각 + 왕복/2 - 받은 시각', () => {
    // 기기 시계 1000에 보내서 1100에 받았다. 서버는 그 가운데쯤 5000이라고 답했다.
    const s = sampleFromPong(1000, 1100, 5000)!;
    expect(s.rttMs).toBe(100);
    expect(s.offsetMs).toBe(5000 + 50 - 1100);
  });

  it('서버와 기기 시계가 똑같고 지연이 없으면 차이가 0', () => {
    expect(sampleFromPong(2000, 2000, 2000)).toEqual({ rttMs: 0, offsetMs: 0 });
  });

  it('차이를 시계에 더하면 서버 시각과 맞는다', () => {
    const device = { now: 10_000 };
    const clock = new QuietClock({ source: () => device.now });
    // 서버는 기기보다 3초 앞서 있고, 편도 지연 40ms
    const serverAt = (deviceTime: number) => deviceTime + 3000;
    const sentAt = 10_000;
    const receivedAt = 10_080;
    const s = sampleFromPong(sentAt, receivedAt, serverAt(sentAt + 40))!;
    clock.setServerOffsetMs(s.offsetMs);
    device.now = 20_000;
    expect(clock.now()).toBe(serverAt(20_000));
  });

  it('받은 시각이 보낸 시각보다 앞서거나 숫자가 아니면 버린다', () => {
    expect(sampleFromPong(1000, 900, 5000)).toBeNull();
    expect(sampleFromPong(1000, 1100, Number.NaN)).toBeNull();
  });
});

describe('TimeSync', () => {
  it('처음엔 welcome으로 맞춘다', () => {
    const t = new TimeSync();
    expect(t.best()).toBeNull();
    t.add(sampleFromWelcome(5000, 1000));
    expect(t.best()?.offsetMs).toBe(4000);
  });

  it('잰 값이 생기면 welcome의 임시 값은 쓰지 않는다', () => {
    const t = new TimeSync();
    t.add(sampleFromWelcome(5000, 1000));
    t.add({ rttMs: 300, offsetMs: 3900 });
    expect(t.best()).toEqual({ rttMs: 300, offsetMs: 3900 });
  });

  it('왕복이 가장 짧은 값을 쓴다', () => {
    const t = new TimeSync();
    t.add({ rttMs: 120, offsetMs: 100 });
    t.add({ rttMs: 40, offsetMs: 90 });
    t.add({ rttMs: 200, offsetMs: 140 });
    expect(t.best()).toEqual({ rttMs: 40, offsetMs: 90 });
  });

  it('최근 값만 기억해서, 오래전의 가장 빠른 값에 영원히 묶이지 않는다', () => {
    const t = new TimeSync(3);
    t.add({ rttMs: 10, offsetMs: 1 });
    t.add({ rttMs: 50, offsetMs: 2 });
    t.add({ rttMs: 60, offsetMs: 3 });
    t.add({ rttMs: 70, offsetMs: 4 });
    expect(t.best()).toEqual({ rttMs: 50, offsetMs: 2 });
  });

  it('reset하면 비운다', () => {
    const t = new TimeSync();
    t.add({ rttMs: 1, offsetMs: 1 });
    t.reset();
    expect(t.best()).toBeNull();
  });
});
