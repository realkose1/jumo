import { describe, expect, it } from 'vitest';
import { QuietClock, msUntilNextMinuteOfHour, parseTimeOffsetMinutes, toSeoulTime } from './time';

// 2026-10-31 15:00:00 UTC = 2026-11-01 00:00:00 한국 시간
const MIDNIGHT_SEOUL = Date.UTC(2026, 9, 31, 15, 0, 0);

describe('toSeoulTime', () => {
  it('UTC에 9시간을 더해 날짜까지 넘어간다', () => {
    const t = toSeoulTime(MIDNIGHT_SEOUL);
    expect([t.year, t.month, t.day, t.hour, t.minute]).toEqual([2026, 11, 1, 0, 0]);
    expect(t.weekday).toBe(0); // 2026-11-01은 일요일
  });

  it('한국 시간 정각 직전은 전날 23:59', () => {
    const t = toSeoulTime(MIDNIGHT_SEOUL - 1);
    expect([t.month, t.day, t.hour, t.minute, t.second, t.millisecond]).toEqual([10, 31, 23, 59, 59, 999]);
  });
});

describe('parseTimeOffsetMinutes', () => {
  it('값이 없거나 이상하면 0', () => {
    expect(parseTimeOffsetMinutes('')).toBe(0);
    expect(parseTimeOffsetMinutes('?room=3')).toBe(0);
    expect(parseTimeOffsetMinutes('?timeOffset=abc')).toBe(0);
    expect(parseTimeOffsetMinutes('?timeOffset=')).toBe(0);
    expect(parseTimeOffsetMinutes('?timeOffset=Infinity')).toBe(0);
  });

  it('분 단위 숫자를 읽는다 (음수, 소수 포함)', () => {
    expect(parseTimeOffsetMinutes('?timeOffset=45')).toBe(45);
    expect(parseTimeOffsetMinutes('?room=2&timeOffset=-10')).toBe(-10);
    expect(parseTimeOffsetMinutes('?timeOffset=1.5')).toBe(1.5);
  });
});

describe('QuietClock', () => {
  it('기본은 기기 시계 그대로', () => {
    const clock = new QuietClock({ source: () => 1000 });
    expect(clock.now()).toBe(1000);
  });

  it('시험용 앞당김과 서버 차이 보정을 더한다', () => {
    const clock = new QuietClock({ source: () => 1_000_000, timeOffsetMinutes: 10, serverOffsetMs: -250 });
    expect(clock.now()).toBe(1_000_000 + 10 * 60_000 - 250);
    clock.setTestOffsetMinutes(0);
    expect(clock.now()).toBe(1_000_000 - 250);
    clock.setServerOffsetMs(500);
    expect(clock.getServerOffsetMs()).toBe(500);
  });

  it('서버 시각과 맞춘다 (왕복 가운데를 서버가 답한 순간으로 본다)', () => {
    const clock = new QuietClock({ source: () => 5000 });
    clock.syncWithServer(10_000, 4000, 6000); // 가운데 5000, 서버는 10000
    expect(clock.getServerOffsetMs()).toBe(5000);
    expect(clock.now()).toBe(10_000);
  });

  it('숫자가 아닌 값은 0으로 무시한다', () => {
    const clock = new QuietClock({ source: () => 0 });
    clock.setServerOffsetMs(Number.NaN);
    clock.setTestOffsetMinutes(Number.NaN);
    expect(clock.now()).toBe(0);
  });

  it('seoul()은 보정된 시각의 한국 시간', () => {
    const clock = new QuietClock({ source: () => MIDNIGHT_SEOUL, timeOffsetMinutes: 90 });
    const t = clock.seoul();
    expect([t.hour, t.minute]).toEqual([1, 30]);
  });
});

describe('msUntilNextMinuteOfHour', () => {
  it('같은 시각 안에서 다음 N분까지', () => {
    const at = MIDNIGHT_SEOUL + 10 * 60_000; // 00:10
    expect(msUntilNextMinuteOfHour(at, 50)).toBe(40 * 60_000);
  });

  it('이미 지났으면 다음 시각의 N분', () => {
    const at = MIDNIGHT_SEOUL + 55 * 60_000; // 00:55
    expect(msUntilNextMinuteOfHour(at, 50)).toBe(55 * 60_000);
  });

  it('정확히 그 분이면 한 시간 뒤', () => {
    expect(msUntilNextMinuteOfHour(MIDNIGHT_SEOUL, 0)).toBe(60 * 60_000);
  });
});
