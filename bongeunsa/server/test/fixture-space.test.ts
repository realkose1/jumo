// 시험 공간(test/fixtures.ts)으로 확인하는 공간 데이터 규칙:
// 동작의 변형 번호(v), 동작마다 다른 다시 하기 간격, 선물의 하루 제한, 공간별 상태.
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_ACT_VARIANTS } from '../../shared/protocol';
import { getSharedSpace } from '../../shared/spaces';
import { fixture } from './fixtures';
import { TestClient, newDev, sleep } from './helpers';

const PICK_VARIANTS = fixture.actions.find((a) => a.id === 'pick')!.variants!;

const open: TestClient[] = [];
async function join(room: number, opts: Parameters<typeof TestClient.join>[2] = {}) {
  const c = await TestClient.join('fixture', room, opts);
  open.push(c);
  return c;
}
afterEach(() => {
  for (const c of open.splice(0)) c.close();
});

describe('시험 공간', () => {
  it('SHARED_SPACES에 등록되어 있다', () => {
    expect(getSharedSpace('fixture')).toBe(fixture);
    expect(PICK_VARIANTS).toBeLessThanOrEqual(MAX_ACT_VARIANTS);
  });
});

describe('act의 v', () => {
  it('보낸 번호가 보낸 사람과 다른 사람에게 그대로 간다', async () => {
    const a = await join(11);
    const b = await join(11);
    a.send({ t: 'act', act: 'pick', v: 5 });
    expect((await b.next('act', (m) => m.act === 'pick')).v).toBe(5);
    expect((await a.next('act', (m) => m.act === 'pick')).v).toBe(5);
  });

  it('번호를 안 보내면 서버가 정해서 모두에게 같은 값을 준다', async () => {
    const a = await join(12);
    const b = await join(12);
    a.send({ t: 'act', act: 'pick' });
    const seen = await b.next('act', (m) => m.act === 'pick');
    const echo = await a.next('act', (m) => m.act === 'pick');
    expect(Number.isInteger(seen.v)).toBe(true);
    expect(seen.v!).toBeGreaterThanOrEqual(0);
    expect(seen.v!).toBeLessThan(PICK_VARIANTS);
    expect(echo.v).toBe(seen.v);
  });

  it('선언한 개수 밖의 번호는 bad-request, 아무에게도 가지 않는다', async () => {
    const a = await join(13);
    const b = await join(13);
    a.send({ t: 'act', act: 'pick', v: PICK_VARIANTS });
    expect(await a.next('error')).toEqual({ t: 'error', code: 'bad-request', ref: 'act' });
    expect(await b.none('act', 250, (m) => m.act === 'pick')).toBeNull();
  });

  it('변형이 없는 동작에 번호를 보내면 bad-request', async () => {
    const a = await join(14);
    const b = await join(14);
    a.send({ t: 'act', act: 'wave', v: 0 });
    expect((await a.next('error')).code).toBe('bad-request');
    expect(await b.none('act', 250)).toBeNull();
    // 번호 없는 동작은 된다 (그리고 이벤트에 v가 없다)
    a.send({ t: 'act', act: 'wave' });
    const wave = await b.next('act', (m) => m.act === 'wave');
    expect('v' in wave).toBe(false);
  });

  it('모양이 틀린 번호(음수, 소수, 글자, 16 이상)는 조용히 버려지고 아무에게도 가지 않는다', async () => {
    const a = await join(15);
    const b = await join(15);
    for (const v of [-1, 1.5, '3', MAX_ACT_VARIANTS, null]) a.send({ t: 'act', act: 'pick', v } as never);
    expect(await b.none('act', 300)).toBeNull();
    // 그 뒤에도 제대로 된 동작은 된다 (틀린 것은 다시 하기 간격을 쓰지 않는다)
    a.send({ t: 'act', act: 'pick', v: 0 });
    expect((await b.next('act', (m) => m.act === 'pick')).v).toBe(0);
  });
});

describe('동작마다 다른 다시 하기 간격', () => {
  it('cooldownMs가 4.5초인 동작은 그 안에 다시 못 하지만, 다른 동작은 바로 된다', async () => {
    const a = await join(16);
    const b = await join(16);
    a.send({ t: 'act', act: 'pick', v: 1 });
    await b.next('act', (m) => m.act === 'pick');
    await sleep(1100); // 기본 간격(1초)은 지났다
    a.send({ t: 'act', act: 'pick', v: 2 });
    expect(await a.next('error')).toEqual({ t: 'error', code: 'rate-limited', ref: 'act' });
    expect(await b.none('act', 250, (m) => m.act === 'pick' && m.v === 2)).toBeNull();
    a.send({ t: 'act', act: 'wave' });
    await b.next('act', (m) => m.act === 'wave');
  });
});

describe('선물의 하루 제한', () => {
  it('인사가 아닌 선물은 보낼 때마다 하나씩 쓰고, 보낸 사람에게만 남은 횟수(left)가 간다', async () => {
    const dev = newDev();
    const a = await join(20, { dev });
    const b = await join(20);
    a.send({ t: 'act', act: 'lantern' });
    expect((await a.next('act', (m) => m.act === 'lantern')).left).toBe(1);
    expect('left' in (await b.next('act', (m) => m.act === 'lantern'))).toBe(false);
    await sleep(1050);
    a.send({ t: 'act', act: 'lantern' });
    expect((await a.next('act', (m) => m.act === 'lantern')).left).toBe(0);
    await sleep(1050);
    a.send({ t: 'act', act: 'lantern' });
    expect(await a.next('error')).toEqual({ t: 'error', code: 'daily-limit', ref: 'act' });
  });

  it('제한은 방이 아니라 공간 단위로 센다(방을 옮겨도 이어진다)', async () => {
    const dev = newDev();
    const a = await join(21, { dev });
    a.send({ t: 'act', act: 'lantern' });
    expect((await a.next('act')).left).toBe(1);
    a.close();
    const again = await join(22, { dev });
    again.send({ t: 'act', act: 'lantern' });
    expect((await again.next('act')).left).toBe(0);
  });

  it('인사 선물은 받을 사람이 있을 때만 쓴다', async () => {
    const dev = newDev();
    const a = await join(23, { dev });
    // 혼자일 때: 동작만 가고 횟수는 그대로
    a.send({ t: 'act', act: 'bow' });
    const alone = await a.next('act');
    expect(alone.to).toBeUndefined();
    expect('left' in alone).toBe(false);
    const b = await join(23);
    await sleep(1050);
    a.send({ t: 'act', act: 'bow' });
    const echo = await a.next('act', (m) => m.act === 'bow' && m.to !== undefined);
    expect(echo).toMatchObject({ to: b.welcome.id, left: 1 });
    await b.next('notice', (m) => m.from === a.welcome.id && m.act === 'bow');
  });
});

describe('공간별 상태', () => {
  it('상태는 다른 사람에게 전해지고, 새로 들어온 사람의 welcome에 보인다', async () => {
    const a = await join(30);
    const b = await join(30);
    a.send({ t: 'state', key: 'pose', val: 3 });
    expect(await b.next('state')).toEqual({ t: 'state', id: a.welcome.id, key: 'pose', val: 3 });
    const c = await join(30);
    expect(c.welcome.peers.find((p) => p.id === a.welcome.id)?.st).toEqual({ pose: 3 });
    expect(c.welcome.peers.find((p) => p.id === b.welcome.id)?.st).toBeUndefined();
  });

  it('범위 밖 값과 모르는 키는 bad-request, 같은 값은 다시 보내지 않는다', async () => {
    const a = await join(31);
    const b = await join(31);
    a.send({ t: 'state', key: 'lamp', val: 2 });
    expect(await a.next('error')).toEqual({ t: 'error', code: 'bad-request', ref: 'state' });
    await sleep(1050);
    a.send({ t: 'state', key: 'nope', val: 0 });
    expect((await a.next('error')).code).toBe('bad-request');
    await sleep(1050);
    a.send({ t: 'state', key: 'lamp', val: 1 });
    await b.next('state', (m) => m.key === 'lamp' && m.val === 1);
    await sleep(1050);
    a.send({ t: 'state', key: 'lamp', val: 1 });
    expect(await b.none('state', 300)).toBeNull();
  });
});
