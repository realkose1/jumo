import { describe, expect, it, vi } from 'vitest';
import { lockPageScroll, shouldBlockTouchMove } from './scrollLock';

const el = (scrollable: boolean) => ({ closest: (s: string) => (scrollable && s === '.qs-panel' ? {} : null) });

describe('shouldBlockTouchMove', () => {
  it('보통 화면(캔버스, 조이스틱)에서는 페이지가 끌리지 않게 막는다', () => {
    expect(shouldBlockTouchMove(el(false), 1)).toBe(true);
    expect(shouldBlockTouchMove(null, 1)).toBe(true);
  });
  it('설정 창 안의 한 손가락 스크롤은 둔다', () => {
    expect(shouldBlockTouchMove(el(true), 1)).toBe(false);
  });
  it('두 손가락(확대)은 어디서든 막는다', () => {
    expect(shouldBlockTouchMove(el(true), 2)).toBe(true);
  });
});

describe('lockPageScroll', () => {
  it('touchmove를 passive가 아니게 걸고, 막을 곳에서 preventDefault 한다. 풀면 떼어 낸다', () => {
    const handlers = new Map<string, (e: unknown) => void>();
    const doc = {
      addEventListener: vi.fn((t: string, h: (e: unknown) => void) => handlers.set(t, h)),
      removeEventListener: vi.fn(),
    };
    const win = { addEventListener: vi.fn(), removeEventListener: vi.fn(), scrollTo: vi.fn(), scrollX: 0, scrollY: 0 };
    const unlock = lockPageScroll({ doc: doc as never, win: win as never });
    expect(doc.addEventListener).toHaveBeenCalledWith('touchmove', expect.any(Function), { passive: false });
    const prevent = vi.fn();
    handlers.get('touchmove')!({ cancelable: true, target: el(false), touches: { length: 1 }, preventDefault: prevent });
    expect(prevent).toHaveBeenCalledTimes(1);
    handlers.get('touchmove')!({ cancelable: true, target: el(true), touches: { length: 1 }, preventDefault: prevent });
    expect(prevent).toHaveBeenCalledTimes(1);
    unlock();
    expect(doc.removeEventListener).toHaveBeenCalledWith('touchmove', expect.any(Function));
    expect(win.removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
  });
});
