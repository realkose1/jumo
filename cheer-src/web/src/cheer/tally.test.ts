import { describe, expect, it } from 'vitest';
import { ActionTally, TALLY_HOLD_MS, TALLY_WINDOW_MS } from './tally';

describe('ActionTally', () => {
  it('시작 전에는 끄고, 시작하면 10초 동안 센다', () => {
    const t = new ActionTally();
    t.add('clap', 0);
    expect(t.snapshot(0).phase).toBe('off');
    expect(t.snapshot(0).total).toBe(0);
    t.start(1000);
    t.add('clap', 1500);
    t.add('clap', 2000);
    t.add('order', 2500);
    const s = t.snapshot(3000);
    expect(s.phase).toBe('live');
    expect(s.counts).toEqual({ clap: 2, order: 1 });
    expect(s.total).toBe(3);
  });

  it('10초가 지나면 더 세지 않고, 합계를 잠깐 더 보여 준 뒤 끈다', () => {
    const t = new ActionTally();
    t.start(0);
    t.add('toast', TALLY_WINDOW_MS - 1);
    t.add('toast', TALLY_WINDOW_MS + 1); // 늦었다
    expect(t.snapshot(TALLY_WINDOW_MS + 100)).toMatchObject({ phase: 'done', total: 1 });
    expect(t.snapshot(TALLY_WINDOW_MS + TALLY_HOLD_MS + 100).phase).toBe('off');
  });

  it('다시 시작하면 이전 합계는 지운다', () => {
    const t = new ActionTally();
    t.start(0);
    t.add('clap', 10);
    t.start(20_000);
    expect(t.snapshot(20_001).total).toBe(0);
  });
});
