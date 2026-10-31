import { describe, expect, it } from 'vitest';
import { AutoSeater, type SeatPort } from './autoSeat';

function setup(taken: string[] = [], failFor: string[] = []) {
  const requested: string[] = [];
  const takenSet = new Set(taken);
  const port: SeatPort = {
    isSeatTaken: (id) => takenSet.has(id),
    sitAtSeat: (id) => {
      requested.push(id);
      return !failFor.includes(id);
    },
  };
  return { port, requested, takenSet };
}

describe('AutoSeater', () => {
  it('앉고 싶은 순서대로 첫 빈 자리로 간다', () => {
    const { port, requested } = setup(['a1']);
    const s = new AutoSeater(['a1', 'a2', 'a3'], port);
    expect(s.start()).toBe(true);
    expect(requested).toEqual(['a2']);
  });

  it('거절되면 그 자리는 빼고 다음 자리로', () => {
    const { port, requested } = setup();
    const s = new AutoSeater(['a1', 'a2', 'a3'], port);
    s.start();
    s.onDenied('a1');
    s.onDenied('a2');
    expect(requested).toEqual(['a1', 'a2', 'a3']);
  });

  it('다른 자리의 거절 소식에는 반응하지 않는다', () => {
    const { port, requested } = setup();
    const s = new AutoSeater(['a1', 'a2'], port);
    s.start();
    s.onDenied('b5');
    expect(requested).toEqual(['a1']);
  });

  it('앉으면 끝, 그 뒤 거절 소식은 무시', () => {
    const { port, requested } = setup();
    const s = new AutoSeater(['a1', 'a2'], port);
    s.start();
    s.onSeated();
    s.onDenied('a1');
    expect(requested).toEqual(['a1']);
    expect(s.running).toBe(false);
  });

  it('빈 자리가 없으면 포기한다', () => {
    const { port } = setup(['a1', 'a2']);
    const s = new AutoSeater(['a1', 'a2'], port);
    expect(s.start()).toBe(false);
    expect(s.running).toBe(false);
  });

  it('걸어가지 못하는 자리는 건너뛴다', () => {
    const { port, requested } = setup([], ['a1']);
    const s = new AutoSeater(['a1', 'a2'], port);
    expect(s.start()).toBe(true);
    expect(requested).toEqual(['a1', 'a2']);
  });

  it('시도 횟수에 한도가 있다', () => {
    const { port, requested } = setup();
    const order = Array.from({ length: 20 }, (_, i) => `s${i}`);
    const s = new AutoSeater(order, port, 3);
    s.start();
    for (const id of order) s.onDenied(id);
    expect(requested).toHaveLength(3);
  });

  it('취소하면 더 하지 않는다', () => {
    const { port, requested } = setup();
    const s = new AutoSeater(['a1', 'a2'], port);
    s.start();
    s.cancel();
    s.onDenied('a1');
    expect(requested).toEqual(['a1']);
  });
});
