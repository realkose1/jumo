// 동작의 변형 번호(v): 주막의 주문은 메뉴 번호를 실어 보내고, 서버는 범위만 확인해 모두에게 같은 값을 전한다.
// 주문은 동작마다 다른 다시 하기 간격(4.5초)도 갖는다.
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_ACT_VARIANTS } from '../../shared/protocol';
import { jumak, ORDER_MENU } from '../../shared/spaces/jumak';
import { TestClient } from './helpers';

const open: TestClient[] = [];
async function join(room: number) {
  const c = await TestClient.join('jumak', room);
  open.push(c);
  return c;
}
afterEach(() => {
  for (const c of open.splice(0)) c.close();
});

describe('공간 데이터', () => {
  it('주문은 메뉴 개수만큼 변형이 있고 메뉴 목록과 같다', () => {
    const order = jumak.actions.find((a) => a.id === 'order')!;
    expect(order.variants).toBe(ORDER_MENU.length);
    expect(order.variants!).toBeLessThanOrEqual(MAX_ACT_VARIANTS);
    expect(jumak.actions.map((a) => a.id)).toEqual(['clap', 'toast', 'order']);
  });

  it('메뉴 글에 줄표가 없고 모두 "주모"로 시작한다', () => {
    for (const m of ORDER_MENU) {
      expect(m.line.startsWith('주모!')).toBe(true);
      expect(m.line).not.toMatch(/[—–]/);
      for (const r of m.replies) expect(r).not.toMatch(/[—–]/);
    }
  });
});

describe('act의 v', () => {
  it('보낸 번호가 보낸 사람과 다른 사람에게 그대로 간다', async () => {
    const a = await join(11);
    const b = await join(11);
    a.send({ t: 'act', act: 'order', v: 5 });
    expect((await b.next('act', (m) => m.act === 'order')).v).toBe(5);
    expect((await a.next('act', (m) => m.act === 'order')).v).toBe(5);
  });

  it('번호를 안 보내면 서버가 정해서 모두에게 같은 값을 준다', async () => {
    const a = await join(12);
    const b = await join(12);
    a.send({ t: 'act', act: 'order' });
    const seen = await b.next('act', (m) => m.act === 'order');
    const echo = await a.next('act', (m) => m.act === 'order');
    expect(Number.isInteger(seen.v)).toBe(true);
    expect(seen.v!).toBeGreaterThanOrEqual(0);
    expect(seen.v!).toBeLessThan(ORDER_MENU.length);
    expect(echo.v).toBe(seen.v);
  });

  it('선언한 개수 밖의 번호는 bad-request, 아무에게도 가지 않는다', async () => {
    const a = await join(13);
    const b = await join(13);
    a.send({ t: 'act', act: 'order', v: ORDER_MENU.length });
    expect(await a.next('error')).toEqual({ t: 'error', code: 'bad-request', ref: 'act' });
    expect(await b.none('act', 250, (m) => m.act === 'order')).toBeNull();
  });

  it('변형이 없는 동작에 번호를 보내면 bad-request', async () => {
    const a = await join(14);
    const b = await join(14);
    a.send({ t: 'act', act: 'clap', v: 0 });
    expect((await a.next('error')).code).toBe('bad-request');
    expect(await b.none('act', 250)).toBeNull();
    // 번호 없는 박수는 된다 (그리고 이벤트에 v가 없다)
    a.send({ t: 'act', act: 'clap' });
    const clap = await b.next('act', (m) => m.act === 'clap');
    expect('v' in clap).toBe(false);
  });

  it('모양이 틀린 번호(음수, 소수, 글자, 16 이상)는 조용히 버려지고 아무에게도 가지 않는다', async () => {
    const a = await join(15);
    const b = await join(15);
    for (const v of [-1, 1.5, '3', MAX_ACT_VARIANTS, null]) a.send({ t: 'act', act: 'order', v } as never);
    expect(await b.none('act', 300)).toBeNull();
    // 그 뒤에도 제대로 된 주문은 된다 (틀린 것은 다시 하기 간격을 쓰지 않는다)
    a.send({ t: 'act', act: 'order', v: 0 });
    expect((await b.next('act', (m) => m.act === 'order')).v).toBe(0);
  });
});

describe('동작마다 다른 다시 하기 간격', () => {
  it('주문은 4.5초 안에 다시 못 하지만, 다른 동작은 바로 된다', async () => {
    const a = await join(16);
    const b = await join(16);
    a.send({ t: 'act', act: 'order', v: 1 });
    await b.next('act', (m) => m.act === 'order');
    a.send({ t: 'act', act: 'order', v: 2 });
    expect(await a.next('error')).toEqual({ t: 'error', code: 'rate-limited', ref: 'act' });
    expect(await b.none('act', 250, (m) => m.act === 'order' && m.v === 2)).toBeNull();
    a.send({ t: 'act', act: 'clap' });
    await b.next('act', (m) => m.act === 'clap');
  });
});
