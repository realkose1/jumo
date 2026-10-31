import { env, exports } from 'cloudflare:workers';
import { runDurableObjectAlarm } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { TestClient, sleep } from './helpers';

const open: TestClient[] = [];
async function join(space: string, room: number) {
  const c = await TestClient.join(space, room);
  open.push(c);
  return c;
}
afterEach(() => {
  for (const c of open.splice(0)) c.close();
});

async function flushRoom(space: string, room: number) {
  await runDurableObjectAlarm(env.ROOM.get(env.ROOM.idFromName(`${space}:${room}`)));
}

async function getRooms(space: string) {
  const res = await exports.default.fetch(`http://presence.test/rooms?space=${space}`);
  return { res, body: (await res.json()) as any };
}

describe('GET /health', () => {
  it('살아 있다고 답한다', async () => {
    const res = await exports.default.fetch('http://presence.test/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const body = (await res.json()) as { ok: boolean; now: number };
    expect(body.ok).toBe(true);
    expect(Math.abs(body.now - Date.now())).toBeLessThan(5000);
  });
});

describe('GET /rooms', () => {
  it('방 개수만큼 인원을 돌려주고, 들어오고 나감에 따라 집계가 바뀐다', async () => {
    const first = await getRooms('test-room');
    expect(first.res.status).toBe(200);
    expect(first.body.capacity).toBe(50);
    expect(first.body.rooms).toHaveLength(10);
    expect(first.body.rooms.every((r: any) => r.n === 0)).toBe(true);
    expect(first.body.recommended).toBe(1); // 모두 비었으면 1번 방

    const clients = [await join('test-room', 3), await join('test-room', 3), await join('test-room', 3), await join('test-room', 7)];
    await flushRoom('test-room', 3);
    await flushRoom('test-room', 7);
    const busy = await getRooms('test-room');
    expect(busy.body.rooms.find((r: any) => r.room === 3).n).toBe(3);
    expect(busy.body.rooms.find((r: any) => r.room === 7).n).toBe(1);
    expect(busy.body.rooms.find((r: any) => r.room === 1).n).toBe(0);
    // 사람이 있는 방 중 가장 많은 방(적당히 찬 방)을 권한다
    expect(busy.body.recommended).toBe(3);

    for (const c of clients) c.close();
    await sleep(100);
    await flushRoom('test-room', 3);
    await flushRoom('test-room', 7);
    const empty = await getRooms('test-room');
    expect(empty.body.rooms.every((r: any) => r.n === 0)).toBe(true);
  });

  it('없는 공간은 404, 공간이 없으면 400, 캐시 헤더와 CORS가 있다', async () => {
    expect((await getRooms('nope')).res.status).toBe(404);
    expect((await exports.default.fetch('http://presence.test/rooms')).status).toBe(400);
    const { res } = await getRooms('test-room');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    // 시험 설정은 캐시를 끈다(ROOMS_CACHE_MS=0). 운영 기본값(3000ms)이면 max-age=3
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('찬 방은 추천하지 않는다', async () => {
    const clients = [];
    for (let i = 0; i < 50; i++) clients.push(await join('test-room', 4));
    await flushRoom('test-room', 4);
    const { body } = await getRooms('test-room');
    expect(body.rooms.find((r: any) => r.room === 4).n).toBe(50);
    expect(body.recommended).not.toBe(4);
  });
});

describe('방 더 열기 (로비)', () => {
  it('열린 방이 모두 거의 차면 상한까지 하나씩 더 열고, 다 차면 추천이 null', async () => {
    const lobby = env.LOBBY.get(env.LOBBY.idFromName('lobby:cap-test'));
    for (let room = 1; room <= 5; room++) await lobby.report(room, 24);
    let snap = await lobby.snapshot(5, 24, undefined, 12);
    expect(snap.rooms.map((r) => r.room)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(snap.recommended).toBe(6);
    // 꽉 찬 방에서 거절당한 사람에게도 새 방을 권한다
    expect((await lobby.snapshot(5, 24, 3, 12)).recommended).toBe(6);

    for (let room = 6; room <= 12; room++) await lobby.report(room, 24);
    snap = await lobby.snapshot(5, 24, 1, 12);
    expect(snap.rooms).toHaveLength(12);
    expect(snap.recommended).toBeNull(); // 화면은 "주막이 꽉 찼어요"
    // 상한을 넘는 방은 열지 않는다
    expect(snap.rooms.some((r) => r.room > 12)).toBe(false);
  });

  it('상한 안의 방 번호는 직접 들어갈 수 있고, 넘으면 404', async () => {
    // 시험 설정은 주막 방 100개(SPACE_OVERRIDES)
    const res = await exports.default.fetch('http://presence.test/ws?space=jumak&room=101', { headers: { Upgrade: 'websocket' } });
    expect(res.status).toBe(404);
  });
});

describe('알 수 없는 경로', () => {
  it('404', async () => {
    expect((await exports.default.fetch('http://presence.test/nope')).status).toBe(404);
    expect((await exports.default.fetch('http://presence.test/ws?space=test-room&room=1')).status).toBe(426);
  });
});
