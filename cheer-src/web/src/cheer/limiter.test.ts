import { describe, expect, it } from 'vitest';
import { BudgetLimiter, DEFAULT_REMOTE_LIMITS, RemoteCueLimiter } from './limiter';

describe('BudgetLimiter', () => {
  it('창 안에서는 한도까지, 창이 지나면 다시', () => {
    const l = new BudgetLimiter(2, 100);
    expect(l.take(0)).toBe(true);
    expect(l.take(10)).toBe(true);
    expect(l.take(20)).toBe(false);
    expect(l.take(100)).toBe(true); // 첫 번째가 창 밖으로 나갔다
  });
});

describe('RemoteCueLimiter', () => {
  it('24명이 한꺼번에 박수를 쳐도 소리는 한도까지만', () => {
    const l = new RemoteCueLimiter();
    let played = 0;
    for (let i = 0; i < 24; i++) if (l.allowSound('clap', 1000 + i)) played += 1;
    expect(played).toBe(DEFAULT_REMOTE_LIMITS.soundPerActionMax);
  });

  it('동작이 달라도 전체 한도를 넘지 않는다', () => {
    const l = new RemoteCueLimiter();
    let played = 0;
    const ids = ['clap', 'toast', 'order'];
    for (let i = 0; i < 60; i++) if (l.allowSound(ids[i % 3]!, 5000 + i * 10)) played += 1;
    // 0.6초 동안 60번을 눌러도 1초 한도(6)를 넘지 않는다
    expect(played).toBeLessThanOrEqual(DEFAULT_REMOTE_LIMITS.soundTotalMax);
    expect(played).toBeGreaterThan(0);
  });

  it('시간이 지나면 다시 소리가 난다', () => {
    const l = new RemoteCueLimiter();
    expect(l.allowSound('order', 0)).toBe(true);
    expect(l.allowSound('order', 10)).toBe(true);
    expect(l.allowSound('order', 20)).toBe(false);
    expect(l.allowSound('order', 2000)).toBe(true);
  });

  it('이모지도 따로 한도가 있다', () => {
    const l = new RemoteCueLimiter();
    let shown = 0;
    for (let i = 0; i < 40; i++) if (l.allowEmoji(i)) shown += 1;
    expect(shown).toBe(DEFAULT_REMOTE_LIMITS.emojiMax);
  });
});
