import { describe, expect, it } from 'vitest';
import { ORDER_MENU } from '@shared/spaces/jumak';
import { menuFor, pickReply } from './orders';

describe('주문 메뉴', () => {
  it('메뉴가 5~8개이고 서버가 아는 변형 개수와 같다', () => {
    expect(ORDER_MENU.length).toBeGreaterThanOrEqual(5);
    expect(ORDER_MENU.length).toBeLessThanOrEqual(8);
  });

  it('번호가 같으면 모두에게 같은 글이다', () => {
    expect(menuFor(2).line).toBe(menuFor(2).line);
    expect(menuFor(0).line).toContain('국밥');
  });

  it('이상한 번호는 첫 메뉴로 (그림이 비지 않게)', () => {
    expect(menuFor(undefined)).toBe(ORDER_MENU[0]);
    expect(menuFor(99)).toBe(ORDER_MENU[0]);
    expect(menuFor(-1)).toBe(ORDER_MENU[0]);
    expect(menuFor(1.5)).toBe(ORDER_MENU[0]);
  });

  it('주모 대답은 같은 주문이면 누가 봐도 같고, 두 가지가 섞여 나온다', () => {
    const item = menuFor(0);
    expect(pickReply(item, 4, 0)).toBe(pickReply(item, 4, 0));
    const seen = new Set<string>();
    for (let id = 1; id < 6; id++) seen.add(pickReply(item, id, 0));
    expect(seen.size).toBe(2);
    for (const r of seen) expect(item.replies).toContain(r);
  });
});
