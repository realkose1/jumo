import { describe, expect, it } from 'vitest';
import { BACKOFF_DEFAULTS, reconnectDelayMs } from './backoff';

describe('reconnectDelayMs', () => {
  it('처음 몇 번은 지수로 늘어난다 (흩뜨리기를 가장 크게/작게 했을 때)', () => {
    expect(reconnectDelayMs(0, false, () => 1)).toBe(1000);
    expect(reconnectDelayMs(1, false, () => 1)).toBe(2000);
    expect(reconnectDelayMs(2, false, () => 1)).toBe(4000);
    expect(reconnectDelayMs(0, false, () => 0)).toBe(500);
    expect(reconnectDelayMs(2, false, () => 0)).toBe(2000);
  });

  it('최대 간격을 넘지 않는다', () => {
    for (const attempt of [5, 6, 10, 50, 1000]) {
      expect(reconnectDelayMs(attempt, false, () => 1)).toBe(BACKOFF_DEFAULTS.maxMs);
      expect(reconnectDelayMs(attempt, false, () => 0)).toBe(BACKOFF_DEFAULTS.maxMs / 2);
    }
  });

  it('흩뜨리기는 상한의 절반~전부 사이', () => {
    for (let i = 0; i < 50; i++) {
      const d = reconnectDelayMs(3, false);
      expect(d).toBeGreaterThanOrEqual(4000);
      expect(d).toBeLessThanOrEqual(8000);
    }
  });

  it('탭이 숨겨져 있으면 서두르지 않는다', () => {
    expect(reconnectDelayMs(0, true, () => 0)).toBe(BACKOFF_DEFAULTS.hiddenMinMs);
    expect(reconnectDelayMs(10, true, () => 1)).toBe(BACKOFF_DEFAULTS.maxMs);
  });

  it('이상한 시도 횟수도 안전하다', () => {
    expect(reconnectDelayMs(-3, false, () => 1)).toBe(1000);
    expect(reconnectDelayMs(Number.NaN, false, () => 1)).toBe(1000);
    expect(reconnectDelayMs(Number.POSITIVE_INFINITY, false, () => 1)).toBe(BACKOFF_DEFAULTS.maxMs);
  });

  it('설정으로 바꿀 수 있다', () => {
    expect(reconnectDelayMs(2, false, () => 1, { baseMs: 100, maxMs: 300 })).toBe(300);
    expect(reconnectDelayMs(0, true, () => 0, { baseMs: 100, hiddenMinMs: 5000 })).toBe(5000);
  });
});
