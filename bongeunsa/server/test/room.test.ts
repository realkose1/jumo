import { env } from 'cloudflare:workers';
import { evictDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { CLOSE } from '../../shared/protocol';
import { SHARED_SPACES } from '../../shared/spaces';
import { newDev, sleep, TestClient, waitForFreshSecond } from './helpers';

const open: TestClient[] = [];
async function join(...args: Parameters<typeof TestClient.join>) {
  const c = await TestClient.join(...args);
  open.push(c);
  return c;
}
afterEach(() => {
  for (const c of open.splice(0)) c.close();
});

describe('입장', () => {
  it('welcome에 내 번호, 이름, 서버 시각, 제한이 들어 있고 다른 사람에게 peer-join이 간다', async () => {
    const a = await join('test-room', 1, { x: 1, z: 2, r: 0.5 });
    expect(a.welcome.peers).toEqual([]);
    expect(a.welcome.room).toBe(1);
    expect(a.welcome.capacity).toBe(50);
    expect(Math.abs(a.welcome.now - Date.now())).toBeLessThan(5000);
    expect(a.welcome.limits.moveHz).toBe(4);
    expect(SHARED_SPACES['test-room']!.nameWords.ko.adjectives.some((w) => a.welcome.name.ko.startsWith(w))).toBe(true);

    const b = await join('test-room', 1, { x: 3, z: 4 });
    const joined = await a.next('peer-join');
    expect(joined.peer.id).toBe(b.welcome.id);
    expect(joined.peer.name).toEqual(b.welcome.name);
    expect(b.welcome.peers).toEqual([{ id: a.welcome.id, name: a.welcome.name, x: 1, z: 2, r: 0.5 }]);
  });

  it('주소의 방과 다른 join, 첫 메시지가 join이 아닌 연결은 닫는다', async () => {
    const c1 = await TestClient.connect('space=test-room&room=2');
    c1.send({ t: 'join', space: 'other-room', room: 2, dev: newDev() });
    expect((await c1.closedWithin()).code).toBe(CLOSE.badJoin);

    const c2 = await TestClient.connect('space=test-room&room=2');
    c2.send({ t: 'move', x: 1, z: 1, r: 0 });
    expect((await c2.closedWithin()).code).toBe(CLOSE.badJoin);
  });

  it('없는 공간이나 범위 밖 방 번호는 연결되지 않는다', async () => {
    await expect(TestClient.connect('space=nope&room=1')).rejects.toThrow(/404/);
    await expect(TestClient.connect('space=test-room&room=11')).rejects.toThrow(/404/);
    await expect(TestClient.connect('space=test-room&room=0')).rejects.toThrow(/404/);
    await expect(TestClient.connect('space=test-room&room=abc')).rejects.toThrow(/404/);
  });

  it('방 번호 없이 연결하면 서버가 방을 골라 welcome에 알려 준다', async () => {
    const c = await TestClient.connect('space=test-room');
    open.push(c);
    c.send({ t: 'join', space: 'test-room', dev: newDev() });
    const w = await c.next('welcome');
    expect(w.room).toBeGreaterThanOrEqual(1);
    expect(w.room).toBeLessThanOrEqual(10);
  });
});

describe('정원', () => {
  it('정원이 차면 room-full(추천 방 포함) 뒤 연결을 닫는다', async () => {
    // 시험용 방 정원은 50명
    for (let i = 0; i < 50; i++) await join('test-room', 1);
    const extra = await TestClient.connect('space=test-room&room=1');
    open.push(extra);
    extra.send({ t: 'join', space: 'test-room', room: 1, dev: newDev() });
    const full = await extra.next('room-full');
    expect(full.rec).not.toBe(1);
    expect(full.rec).toBeGreaterThanOrEqual(2);
    expect(full.rec).toBeLessThanOrEqual(10);
    expect((await extra.closedWithin()).code).toBe(CLOSE.roomFull);
  });

  it('한 명이 나가면 다시 들어올 수 있다', async () => {
    const first = await join('test-room', 2);
    for (let i = 0; i < 49; i++) await join('test-room', 2);
    first.close();
    await sleep(100);
    const again = await join('test-room', 2);
    expect(again.welcome.peers.length).toBe(49);
  });
});

describe('이름', () => {
  it('같은 방 50명의 이름이 모두 다르다(단어 조합이 모자란 시험용 방도)', async () => {
    const clients = [];
    for (let i = 0; i < 50; i++) clients.push(await join('test-room', 3));
    const names = clients.map((c) => c.welcome.name.ko);
    expect(new Set(names).size).toBe(50);
    // 36가지 조합이 넘는 사람부터는 숫자가 붙는다
    expect(names.filter((n) => /\d$/.test(n)).length).toBe(14);
  });

  it('한국어만 있는 공간은 en이 없다', async () => {
    const c = await join('test-room', 9);
    expect(c.welcome.name.en).toBeUndefined();
  });
});

describe('자리', () => {
  it('같은 자리에 동시에 앉으면 한 명만 성공하고 나머지는 seat-taken', async () => {
    const a = await join('test-room', 4);
    const b = await join('test-room', 4);
    const c = await join('test-room', 4);
    a.send({ t: 'sit', seat: 'a1' });
    b.send({ t: 'sit', seat: 'a1' });
    c.send({ t: 'sit', seat: 'a1' });
    await sleep(300);
    const winners = [a, b, c].filter((x) => x.inbox.some((m) => m.t === 'seat' && m.seat === 'a1' && m.id === x.welcome.id));
    const losers = [a, b, c].filter((x) => x.inbox.some((m) => m.t === 'error' && m.code === 'seat-taken'));
    expect(winners.length).toBe(1);
    expect(losers.length).toBe(2);
    // 먼저 보낸 사람이 이긴다
    expect(winners[0]).toBe(a);
    // 모두가 같은 결과를 본다
    for (const x of [a, b, c]) {
      expect(x.inbox.filter((m) => m.t === 'seat')).toEqual([{ t: 'seat', seat: 'a1', id: a.welcome.id }]);
    }
  });

  it('일어나거나 나가면 자리가 풀리고, 옮겨 앉으면 이전 자리는 빈다', async () => {
    const a = await join('test-room', 5);
    const b = await join('test-room', 5);
    a.send({ t: 'sit', seat: 'a1' });
    await b.next('seat', (m) => m.id === a.welcome.id);

    a.send({ t: 'stand' });
    expect(await b.next('seat', (m) => m.seat === 'a1' && m.id === null)).toBeTruthy();

    b.send({ t: 'sit', seat: 'a2' });
    await a.next('seat', (m) => m.seat === 'a2' && m.id === b.welcome.id);
    b.send({ t: 'sit', seat: 'b1' });
    await a.next('seat', (m) => m.seat === 'a2' && m.id === null);
    await a.next('seat', (m) => m.seat === 'b1' && m.id === b.welcome.id);

    b.close();
    await a.next('seat', (m) => m.seat === 'b1' && m.id === null);
    await a.next('peer-leave', (m) => m.id === b.welcome.id);

    // 나간 사람의 자리는 새로 온 사람이 앉을 수 있다
    const c = await join('test-room', 5);
    expect(c.welcome.seats).toEqual({});
    c.send({ t: 'sit', seat: 'b1' });
    await c.next('seat', (m) => m.id === c.welcome.id);
  });

  it('모르는 자리는 bad-request, 앉은 채 움직이면 일어난 것으로 본다', async () => {
    const a = await join('test-room', 6);
    const b = await join('test-room', 6);
    a.send({ t: 'sit', seat: 'nope' });
    expect((await a.next('error')).code).toBe('bad-request');

    a.send({ t: 'sit', seat: 'a3' });
    await b.next('seat', (m) => m.seat === 'a3' && m.id === a.welcome.id);
    a.send({ t: 'move', x: 1, z: 1, r: 0 });
    await b.next('seat', (m) => m.seat === 'a3' && m.id === null);
  });

  it('새로 들어온 사람의 welcome에 이미 앉은 자리가 보인다', async () => {
    const a = await join('test-room', 7);
    a.send({ t: 'sit', seat: 'c1' });
    await a.next('seat');
    const b = await join('test-room', 7);
    expect(b.welcome.seats).toEqual({ c1: a.welcome.id });
  });
});

describe('움직임', () => {
  it('peer-move로 여러 사람의 위치가 묶여서 전달되고, 혼자 움직인 사람은 자기 것을 돌려받지 않는다', async () => {
    const a = await join('test-room', 8);
    const b = await join('test-room', 8);
    const c = await join('test-room', 8);
    a.send({ t: 'move', x: 1.234, z: -2, r: 7 });
    b.send({ t: 'move', x: 3, z: 4, r: 0 });
    const group = await c.next('peer-move');
    const byId = new Map(group.p.map((e) => [e[0], e]));
    // 한 묶음에 둘 다 들어 있거나(대개), 두 묶음으로 나뉘어 온다
    const rest = byId.size < 2 ? await c.next('peer-move') : null;
    for (const e of rest?.p ?? []) byId.set(e[0], e);
    expect(byId.get(a.welcome.id)).toEqual([a.welcome.id, 1.23, -2, 0.72]); // 반올림과 -π~π 접기
    expect(byId.get(b.welcome.id)).toEqual([b.welcome.id, 3, 4, 0]);
    expect(typeof group.now).toBe('number');
  });

  it('혼자 움직인 사람에게는 자기 위치를 돌려보내지 않는다', async () => {
    const a = await join('test-room', 8);
    const b = await join('test-room', 8);
    await sleep(100);
    a.send({ t: 'move', x: 5, z: 5, r: 0 });
    await b.next('peer-move', (m) => m.p.some((e) => e[0] === a.welcome.id && e[1] === 5));
    expect(a.inbox.some((m) => m.t === 'peer-move' && m.p.some((e) => e[0] === a.welcome.id && e[1] === 5))).toBe(false);
  });

  it('move는 초당 4번까지만 받고 넘치면 버린다(연결은 유지)', async () => {
    const a = await join('test-room', 9);
    const b = await join('test-room', 9);
    await waitForFreshSecond();
    for (let i = 1; i <= 25; i++) a.send({ t: 'move', x: i, z: 0, r: 0 });
    await sleep(400);
    const xs = b.inbox.flatMap((m) => (m.t === 'peer-move' ? m.p.filter((e) => e[0] === a.welcome.id).map((e) => e[1]) : []));
    expect(Math.max(...xs)).toBe(4); // 5번째부터는 버려졌다
    a.send({ t: 'ping', c: 1 });
    expect((await a.next('pong')).c).toBe(1);
  });

  it('움직임이 멈추면 더 보내지 않는다', async () => {
    const a = await join('test-room', 10);
    const b = await join('test-room', 10);
    a.send({ t: 'move', x: 1, z: 1, r: 0 });
    await b.next('peer-move');
    expect(await b.none('peer-move', 500)).toBeNull();
  });
});

describe('동작과 인사', () => {
  it('같은 동작은 1초에 한 번만: 연타하면 rate-limited, 다른 동작은 된다', async () => {
    const a = await join('test-room', 1);
    const b = await join('test-room', 1);
    a.send({ t: 'act', act: 'hop-small' });
    a.send({ t: 'act', act: 'hop-small' });
    a.send({ t: 'act', act: 'hop-twice' });
    const err = await a.next('error');
    expect(err).toEqual({ t: 'error', code: 'rate-limited', ref: 'act' });
    await b.next('act', (m) => m.act === 'hop-small');
    await b.next('act', (m) => m.act === 'hop-twice');
    expect(await b.none('act', 200, (m) => m.act === 'hop-small')).toBeNull();
    // 1초 뒤에는 다시 된다
    await sleep(1050);
    a.send({ t: 'act', act: 'hop-small' });
    await b.next('act', (m) => m.act === 'hop-small');
  });

  it('모르는 동작은 bad-request', async () => {
    const a = await join('test-room', 2);
    a.send({ t: 'act', act: 'dance' });
    expect((await a.next('error')).code).toBe('bad-request');
  });

  it('인사는 지정한 사람에게, 지정하지 않으면 가장 가까운 사람에게만 notice가 간다', async () => {
    const a = await join('test-room', 10, { x: 0, z: 0 });
    const near = await join('test-room', 10, { x: 1, z: 0 });
    const far = await join('test-room', 10, { x: 5, z: 0 });
    a.send({ t: 'act', act: 'hop-greet' });
    const notice = await near.next('notice');
    expect(notice).toEqual({ t: 'notice', kind: 'greeting', from: a.welcome.id, name: a.welcome.name, act: 'hop-greet' });
    const echo = await a.next('act');
    expect(echo.to).toBe(near.welcome.id);
    expect(await far.none('notice', 300)).toBeNull();
    // 모두에게 동작 자체는 보인다
    expect((await far.next('act')).id).toBe(a.welcome.id);

    // 가까운 사람이 움직이면 기준이 바뀐다
    near.send({ t: 'move', x: 20, z: 0, r: 0 });
    far.send({ t: 'move', x: 2, z: 0, r: 0 });
    await sleep(1050);
    a.send({ t: 'act', act: 'hop-greet' });
    await far.next('notice', (m) => m.from === a.welcome.id);
    expect(await near.none('notice', 300)).toBeNull();

    // 받을 사람을 지정하면 거리와 상관없이 그 사람
    await sleep(1000);
    a.send({ t: 'act', act: 'hop-greet', to: near.welcome.id });
    await near.next('notice', (m) => m.from === a.welcome.id);
  });

  it('없는 사람이나 나 자신에게 인사하면 no-target, 혼자 있으면 notice 없이 동작만', async () => {
    const a = await join('test-room', 5);
    a.send({ t: 'act', act: 'hop-greet', to: a.welcome.id });
    expect((await a.next('error')).code).toBe('no-target');
    await sleep(1050);
    a.send({ t: 'act', act: 'hop-greet', to: 9999 });
    expect((await a.next('error')).code).toBe('no-target');
    await sleep(1050);
    a.send({ t: 'act', act: 'hop-greet' });
    const echo = await a.next('act');
    expect(echo.to).toBeUndefined();
  });
});

describe('공간별 상태', () => {
  // 시험용 방(test-room)은 상태 키가 하나도 없다. 키 검사만 확인하고, 전달과 welcome의 상태는
  // 상태 키가 있던 공간(열람실 lamp)에서 확인하던 것이라 공간을 지우면서 함께 빠졌다.
  it('공간 데이터에 없는 상태 키는 bad-request, 다른 사람에게 전달되지 않는다', async () => {
    const a = await join('test-room', 1);
    const b = await join('test-room', 1);
    a.send({ t: 'state', key: 'lamp', val: 1 });
    expect((await a.next('error')).code).toBe('bad-request');
    expect(await b.none('state', 300)).toBeNull();
  });

  it('state는 초당 2번까지', async () => {
    const a = await join('test-room', 1);
    await waitForFreshSecond();
    for (let i = 0; i < 5; i++) a.send({ t: 'state', key: 'lamp', val: i % 2 });
    await sleep(300);
    const limited = a.inbox.filter((m) => m.t === 'error' && m.code === 'rate-limited');
    expect(limited.length).toBe(3);
  });
});

describe('같은 기기, 같은 IP', () => {
  it('같은 기기가 같은 방에 다시 들어오면 이전 연결을 닫는다', async () => {
    const dev = newDev();
    const watcher = await join('test-room', 6);
    const old = await join('test-room', 6, { dev });
    old.send({ t: 'sit', seat: 'a1' });
    await watcher.next('seat', (m) => m.id === old.welcome.id);

    const fresh = await join('test-room', 6, { dev });
    expect((await old.closedWithin()).code).toBe(CLOSE.replaced);
    // 이전 연결의 자리는 풀리고 나갔다고 알려진다
    await watcher.next('seat', (m) => m.seat === 'a1' && m.id === null);
    await watcher.next('peer-leave', (m) => m.id === old.welcome.id);
    expect(fresh.welcome.id).not.toBe(old.welcome.id);
    expect(fresh.welcome.peers.map((p) => p.id)).toEqual([watcher.welcome.id]);
  });

  it('같은 기기라도 다른 방이면 따로 들어간다', async () => {
    const dev = newDev();
    const a = await join('test-room', 7, { dev });
    const b = await join('test-room', 8, { dev });
    expect(a.closed).toBeNull();
    expect(b.welcome.room).toBe(8);
  });

  it('같은 IP는 방당 들어온 사람 30명까지: 31번째는 join 때 닫히고, 다른 IP와 다른 방은 된다', async () => {
    const headers = { 'CF-Connecting-IP': '203.0.113.7' };
    for (let i = 0; i < 30; i++) await join('test-room', 9, { headers });
    const extra = await TestClient.connect('space=test-room&room=9', headers);
    open.push(extra);
    extra.send({ t: 'join', space: 'test-room', room: 9, dev: newDev() });
    expect((await extra.closedWithin()).code).toBe(CLOSE.tooManyFromIp);
    expect(extra.inbox.some((m) => m.t === 'welcome')).toBe(false);
    // 다른 IP는 된다
    await join('test-room', 9, { headers: { 'CF-Connecting-IP': '203.0.113.8' } });
    // 다른 방은 된다
    await join('test-room', 10, { headers });
  });

  it('같은 IP가 꽉 찬 상태에서도 같은 기기의 재접속은 된다(옛 연결을 먼저 정리하고 센다)', async () => {
    const headers = { 'CF-Connecting-IP': '203.0.113.9' };
    const dev = newDev();
    const mine = await join('test-room', 8, { headers, dev });
    for (let i = 0; i < 29; i++) await join('test-room', 8, { headers });
    const again = await join('test-room', 8, { headers, dev });
    expect((await mine.closedWithin()).code).toBe(CLOSE.replaced);
    expect(again.closed).toBeNull();
  });

  it('join 전 연결은 같은 IP에서 10개까지(붙기만 하고 가만있는 연결)', async () => {
    const headers = { 'CF-Connecting-IP': '203.0.113.10' };
    const pending: TestClient[] = [];
    for (let i = 0; i < 10; i++) pending.push(await TestClient.connect('space=test-room&room=7', headers));
    open.push(...pending);
    const eleventh = await TestClient.connect('space=test-room&room=7', headers);
    open.push(eleventh);
    expect((await eleventh.closedWithin()).code).toBe(CLOSE.tooManyFromIp);
    expect(pending.every((c) => c.closed === null)).toBe(true);
    // 기다리던 연결이 join하면 자리가 난다
    pending[0]!.send({ t: 'join', space: 'test-room', room: 7, dev: newDev() });
    await pending[0]!.next('welcome');
    const next = await TestClient.connect('space=test-room&room=7', headers);
    open.push(next);
    expect(await next.closedWithin(300).catch(() => null)).toBeNull();
  });
});

describe('잘못된 메시지', () => {
  it('깨진 JSON, 모르는 종류, 범위 밖 좌표, 너무 큰 메시지는 무시하고 연결은 유지한다', async () => {
    const a = await join('test-room', 10);
    const b = await join('test-room', 10);
    a.sendRaw('not json');
    a.sendRaw('{"t":"teleport","x":1}');
    a.sendRaw('{"t":"move","x":1e9,"z":0,"r":0}');
    a.sendRaw('{"t":"move","x":"1","z":0,"r":0}');
    a.sendRaw('{"t":"move","x":null,"z":0,"r":0}');
    a.sendRaw('[1,2,3]');
    a.sendRaw('{"t":"sit","seat":{"$":1}}');
    a.sendRaw(JSON.stringify({ t: 'act', act: 'x'.repeat(2000) }));
    a.sendRaw('{"t":"say","text":"안녕하세요"}');
    a.sendRaw('{"t":"move","x":NaN,"z":0,"r":0}');
    expect(await b.none('peer-move', 400)).toBeNull();
    a.send({ t: 'ping', c: 42 });
    const pong = await a.next('pong');
    expect(pong.c).toBe(42);
    expect(Math.abs(pong.now - Date.now())).toBeLessThan(5000);
    expect(a.closed).toBeNull();
  });

  it('유효한 메시지도 1초에 12개까지만 받는다(나머지는 rate-limited)', async () => {
    const a = await join('test-room', 6);
    await waitForFreshSecond();
    for (let i = 0; i < 20; i++) a.send({ t: 'ping', c: i });
    await sleep(300);
    expect(a.inbox.filter((m) => m.t === 'pong')).toHaveLength(12);
    expect(a.inbox.filter((m) => m.t === 'error' && m.code === 'rate-limited')).toHaveLength(8);
    expect(a.closed).toBeNull();
  });

  it('제한을 넘는 메시지를 계속 쏟아내면 연결을 닫는다(4005)', async () => {
    const a = await join('test-room', 6);
    await waitForFreshSecond();
    for (let i = 0; i < 50; i++) a.send({ t: 'ping', c: i });
    expect((await a.closedWithin()).code).toBe(CLOSE.abuse);
  });

  it('잘못된 메시지를 계속 쏟아내면 연결을 닫는다', async () => {
    const a = await join('test-room', 10);
    await waitForFreshSecond();
    for (let i = 0; i < 40; i++) a.sendRaw('garbage');
    expect((await a.closedWithin()).code).toBe(CLOSE.abuse);
  });

  it('사용자 문자열은 어느 경로로도 다른 사람에게 전달되지 않는다', async () => {
    const a = await join('test-room', 10);
    const b = await join('test-room', 10);
    const marker = 'ZZ_USER_TEXT_ZZ';
    a.send({ t: 'move', x: 1, z: 1, r: 0, name: marker, text: marker } as never);
    a.send({ t: 'act', act: 'hop-small', name: marker, text: marker } as never);
    a.send({ t: 'sit', seat: 'a1', name: marker } as never);
    a.sendRaw(`{"t":"act","act":"${marker}"}`);
    a.sendRaw(`{"t":"sit","seat":"${marker}"}`);
    a.sendRaw(`{"t":"state","key":"${marker}","val":1}`);
    await sleep(500);
    expect(JSON.stringify(b.inbox)).not.toContain(marker);
    expect(JSON.stringify(a.inbox.filter((m) => m.t !== 'error'))).not.toContain(marker);
  });
});

describe('휴면 후 깨어남', () => {
  it('객체가 내려갔다 올라와도 연결, 자리, 위치가 이어진다', async () => {
    const a = await join('test-room', 5, { x: 2, z: 3 });
    const b = await join('test-room', 5);
    a.send({ t: 'sit', seat: 'b2' });
    await b.next('seat', (m) => m.seat === 'b2' && m.id === a.welcome.id);

    const stub = env.ROOM.get(env.ROOM.idFromName('test-room:5'));
    await evictDurableObject(stub);

    // 깨어난 뒤에도 메시지가 오간다
    b.send({ t: 'move', x: 7, z: 7, r: 0 });
    await a.next('peer-move', (m) => m.p.some((e) => e[0] === b.welcome.id && e[1] === 7));
    const c = await join('test-room', 5);
    expect(c.welcome.seats).toEqual({ b2: a.welcome.id });
    const pa = c.welcome.peers.find((p) => p.id === a.welcome.id)!;
    expect(pa).toMatchObject({ x: 2, z: 3 });
    expect(new Set(c.welcome.peers.map((p) => p.name.ko)).size).toBe(2);
    expect(c.welcome.id).toBeGreaterThan(b.welcome.id); // 번호는 이어서 붙는다
    // 깨어난 뒤에도 자리 충돌이 판정된다
    c.send({ t: 'sit', seat: 'b2' });
    expect((await c.next('error')).code).toBe('seat-taken');
  });
});
