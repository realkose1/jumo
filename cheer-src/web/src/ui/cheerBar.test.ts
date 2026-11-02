import { describe, expect, it } from 'vitest';
import { pillShown } from './cheerBar';

describe('왼쪽 위 알약', () => {
  it('몇 명이 응원 중인지는 띄우지 않고, 연결에 문제가 있을 때만 뜬다', () => {
    expect(pillShown('online')).toBe(false);
    expect(pillShown('idle')).toBe(false);
    expect(pillShown('offline')).toBe(false);
    for (const s of ['connecting', 'reconnecting', 'full', 'denied', 'replaced']) expect(pillShown(s)).toBe(true);
  });
});
