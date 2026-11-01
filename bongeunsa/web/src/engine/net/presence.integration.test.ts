// 실제 로컬 서버(server)에 화면 코드(NetSession, PresenceClient, RemotePeers)를 두 개 붙여 보는 시험.
// 서버가 떠 있을 때만 돈다:
//   (server) npm run dev
//   (web)        VITE_PRESENCE_TEST_URL=ws://localhost:8797 npx vitest run presence.integration
// 평소의 npm test에서는 건너뛴다.
import * as THREE from 'three';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PeerId } from '@shared/protocol';
import { disposeAvatarResources } from '../avatar';
import { SeatManager } from '../seats';
import { QuietClock } from '../time';
import type { SpaceDefinition } from '../types';
import { loadSpace } from '../../spaces';
import { generateDeviceId } from './deviceId';
import { NetSession, type NetEventMap } from './session';

const URL_ = import.meta.env.VITE_PRESENCE_TEST_URL as string | undefined;

afterAll(() => disposeAvatarResources());

interface Person {
  session: NetSession;
  self: { x: number; z: number; yaw: number; seatId: string | null };
  events: Array<{ type: string; payload: unknown }>;
  clock: QuietClock;
  id(): PeerId;
}

const people: Person[] = [];
let space: SpaceDefinition;

async function join(room: number, spawn = { x: 0, z: 4 }): Promise<Person> {
  const scene = new THREE.Scene();
  const seats = new SeatManager(scene, space.seats);
  const clock = new QuietClock();
  const events: Person['events'] = [];
  const self = { x: spawn.x, z: spawn.z, yaw: 0, seatId: null as string | null };
  const session = new NetSession({
    space,
    scene,
    seats,
    clock,
    url: URL_!,
    room,
    deviceId: generateDeviceId(),
    reducedMotion: true,
    host: {
      emit: <K extends keyof NetEventMap>(type: K, payload: NetEventMap[K]) => events.push({ type, payload }),
      getSelf: () => ({ ...self }),
      standUp: () => {
        self.seatId = null;
      },
      abortSeat: () => undefined,
    },
  });
  const person: Person = { session, self, events, clock, id: () => session.client.myId! };
  people.push(person);
  session.start();
  await waitFor(() => session.client.isOnline(), 'online');
  return person;
}

async function waitFor(cond: () => boolean, what: string, timeoutMs = 3000, tick?: () => void): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`시간 안에 안 됨: ${what}`);
    tick?.();
    await new Promise((r) => setTimeout(r, 20));
  }
}

const run = (...ps: Person[]) => () => ps.forEach((p) => p.session.update(0.02));

afterEach(() => {
  for (const p of people.splice(0)) p.session.dispose();
});

describe.skipIf(!URL_)('화면 코드 두 개가 실제 서버에서 서로 보인다', () => {
  beforeAll(async () => {
    space = (await loadSpace('test-room'))!;
  });

  it('서로 들어오고 나가는 게 보이고, 이름은 서로 다르다', async () => {
    const room = 1 + Math.floor(Math.random() * 10);
    const a = await join(room);
    expect(a.events.some((e) => e.type === 'self-name')).toBe(true);
    expect(a.events.find((e) => e.type === 'room-change')?.payload).toEqual({ room });
    const b = await join(room);
    await waitFor(() => a.session.peers.has(b.id()), 'A가 B를 본다');
    expect(b.session.peers.has(a.id())).toBe(true);
    const nameA = a.session.client.myName!.ko;
    const nameB = b.session.client.myName!.ko;
    expect(nameA).not.toBe(nameB);
    expect(b.session.peers.nameOf(a.id())?.ko).toBe(nameA);

    b.session.dispose();
    await waitFor(() => !a.session.peers.has(b.id()), 'A가 B의 퇴장을 본다');
  });

  it('내가 걸으면 상대 화면에 부드럽게 따라 걷는다 (멈추면 더는 안 보낸다)', async () => {
    const room = 1 + Math.floor(Math.random() * 10);
    const a = await join(room, { x: 0, z: 4 });
    const b = await join(room, { x: 1, z: 1 });
    await waitFor(() => a.session.peers.has(b.id()), 'A가 B를 본다');
    // B가 오른쪽으로 걷는다 (초당 2.6m 정도)
    const started = Date.now();
    await waitFor(
      () => Date.now() - started > 1200,
      '걷기',
      3000,
      () => {
        b.self.x = 1 + ((Date.now() - started) / 1000) * 2.6;
        b.self.yaw = Math.PI / 2;
        run(a, b)();
      },
    );
    const seen: number[] = [];
    await waitFor(() => (a.session.peers.positionOf(b.id())?.x ?? 0) > 3.5, 'A 화면에서 B가 도착', 3000, () => {
      run(a, b)();
      seen.push(a.session.peers.positionOf(b.id())?.x ?? 0);
    });
    const pos = a.session.peers.positionOf(b.id())!;
    expect(pos.x).toBeGreaterThan(3.5);
    // 멈춘 B는 더 보내지 않는다: A가 받는 peer-move가 없어서 위치가 그대로다
    const frozen = pos.x;
    for (let i = 0; i < 20; i++) {
      run(a, b)();
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(Math.abs((a.session.peers.positionOf(b.id())?.x ?? 0) - frozen)).toBeLessThan(0.7);
  });

  it('자리: 먼저 앉은 사람이 갖고, 나중 사람은 거절되고, 일어나면 풀린다', async () => {
    const room = 1 + Math.floor(Math.random() * 10);
    const a = await join(room);
    const b = await join(room);
    await waitFor(() => a.session.peers.has(b.id()) && b.session.peers.has(a.id()), '서로 보임');

    const okA = await a.session.arbiter.requestSit('a1');
    expect(okA).toBe(true);
    a.self.seatId = 'a1';
    await waitFor(() => b.session.peers.seatOwner('a1') === a.id(), 'B가 A의 자리를 본다');
    expect(b.session.arbiter.isOccupiedByOther('a1')).toBe(true);

    // B가 화면 쪽 검사를 우회해 같은 자리를 서버에 직접 물어도 서버가 거절한다
    const errors: string[] = [];
    b.session.client.on('error', (m) => errors.push(`${m.code}:${m.ref}`));
    expect(b.session.client.sendSit('a1')).toBe(true);
    await waitFor(() => errors.length > 0, 'seat-taken 답');
    expect(errors).toEqual(['seat-taken:sit']);

    // A가 일어나면 B에게 풀린다
    a.session.arbiter.release('a1');
    a.self.seatId = null;
    await waitFor(() => b.session.peers.seatOwner('a1') === null, 'B가 빈 자리를 본다');
    expect(b.session.arbiter.isOccupiedByOther('a1')).toBe(false);
    const okB = await b.session.arbiter.requestSit('a1');
    expect(okB).toBe(true);
  });

  it('앉은 채 위치를 보내지 않는다: 앉은 뒤에도 자리가 풀리지 않는다', async () => {
    const room = 1 + Math.floor(Math.random() * 10);
    const a = await join(room, { x: 0, z: 0 });
    const b = await join(room);
    await waitFor(() => b.session.peers.has(a.id()), 'B가 A를 본다');
    a.self.x = 0.7; // 자리 앞까지 걸어온 마지막 위치 (아직 서버에 안 보냄)
    const ok = await a.session.arbiter.requestSit('b1');
    expect(ok).toBe(true);
    a.self.seatId = 'b1';
    a.self.x = -1.25; // 자리 위치로 앉으러 이동
    for (let i = 0; i < 30; i++) {
      run(a, b)();
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(b.session.peers.seatOwner('b1')).toBe(a.id());
  });

  it('동작은 상대 화면에서 재생되고, 인사는 알림이 간다', async () => {
    const room = 1 + Math.floor(Math.random() * 10);
    const a = await join(room);
    const b = await join(room);
    await waitFor(() => a.session.peers.has(b.id()) && b.session.peers.has(a.id()), '서로 보임');
    a.session.sendAction('hop-small');
    await new Promise((r) => setTimeout(r, 150));
    a.session.sendAction('hop-greet');
    await waitFor(() => b.events.some((e) => e.type === 'greeted'), 'B가 인사를 받는다');
    const greeted = b.events.find((e) => e.type === 'greeted')!.payload as NetEventMap['greeted'];
    expect(greeted.actionId).toBe('hop-greet');
    expect(greeted.name.ko).toBe(a.session.client.myName!.ko);
  });

  it('서버 시각을 받아 시계를 맞춘다', async () => {
    const a = await join(1 + Math.floor(Math.random() * 10));
    await waitFor(() => a.session.client.getTimeSample() !== null, '시간 보정');
    const server = a.session.client.getTimeSample()!;
    // 같은 컴퓨터라 차이는 아주 작다
    expect(Math.abs(server.offsetMs)).toBeLessThan(500);
    expect(Math.abs(a.clock.getServerOffsetMs())).toBeLessThan(500);
  });

  it('없는 방 번호로 들어와도 서버가 방을 정해 준다', async () => {
    const a = await join(9999);
    const room = (a.events.find((e) => e.type === 'room-change')!.payload as NetEventMap['room-change']).room;
    expect(room).toBeLessThanOrEqual(10);
    expect(room).toBeGreaterThanOrEqual(1);
  }, 15_000);
});
