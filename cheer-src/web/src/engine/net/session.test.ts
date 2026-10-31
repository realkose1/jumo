import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { ServerMsg } from '@shared/protocol';
import { disposeAvatarResources } from '../avatar';
import { SeatManager } from '../seats';
import { QuietClock } from '../time';
import type { SpaceDefinition } from '../types';
import { PresenceClient, type SocketLike } from './PresenceClient';
import { NetSession, PresenceSeatArbiter, type NetEventMap } from './session';

function setup(opts: { online?: boolean; occupied?: string[] } = {}) {
  const sent: string[] = [];
  const state = { online: opts.online ?? true, occupied: new Set(opts.occupied ?? []) };
  const client = {
    isOnline: () => state.online,
    sendSit: (seat: string) => {
      sent.push(`sit:${seat}`);
      return state.online;
    },
    sendStand: () => {
      sent.push('stand');
      return state.online;
    },
  } as unknown as PresenceClient;
  const arbiter = new PresenceSeatArbiter(
    client,
    (seat) => state.occupied.has(seat),
    () => sent.push('flush'),
  );
  return { arbiter, sent, state };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('PresenceSeatArbiter (서버 판정)', () => {
  it('앉기 전에 내 마지막 위치부터 알리고, 서버가 확정하면 앉는다', async () => {
    const { arbiter, sent } = setup();
    const result = arbiter.requestSit('a1') as Promise<boolean>;
    expect(sent).toEqual(['flush', 'sit:a1']); // flush가 먼저: 앉은 채 move가 가면 서버가 일어난 것으로 본다
    expect(arbiter.hasPendingSit()).toBe(true);
    arbiter.onMySeat('a1');
    await expect(result).resolves.toBe(true);
    expect(arbiter.hasPendingSit()).toBe(false);
    expect(arbiter.mySeat).toBe('a1');
  });

  it('서버가 seat-taken으로 거절하면 못 앉는다', async () => {
    const { arbiter } = setup();
    const result = arbiter.requestSit('a1') as Promise<boolean>;
    arbiter.onSitError('seat-taken');
    await expect(result).resolves.toBe(false);
    expect(arbiter.denialReason()).toBe('taken');
    expect(arbiter.mySeat).toBeNull();
  });

  it('다른 이유의 거절(속도 제한, 모르는 자리)은 failed', async () => {
    const { arbiter } = setup();
    const result = arbiter.requestSit('a1') as Promise<boolean>;
    arbiter.onSitError('rate-limited');
    await expect(result).resolves.toBe(false);
    expect(arbiter.denialReason()).toBe('failed');
  });

  it('답이 없으면 4초 뒤에 못 앉은 것으로 본다', async () => {
    const { arbiter } = setup();
    const result = arbiter.requestSit('a1') as Promise<boolean>;
    vi.advanceTimersByTime(3999);
    expect(arbiter.hasPendingSit()).toBe(true);
    vi.advanceTimersByTime(1);
    await expect(result).resolves.toBe(false);
    expect(arbiter.denialReason()).toBe('failed');
  });

  it('이미 다른 사람이 앉은 자리는 서버에 묻지 않고 거절한다', () => {
    const { arbiter, sent } = setup({ occupied: ['a1'] });
    expect(arbiter.isOccupiedByOther('a1')).toBe(true);
    expect(arbiter.requestSit('a1')).toBe(false);
    expect(sent).toEqual([]);
  });

  it('일어나면 stand를 보낸다 (앉지 않은 자리를 놓으면 아무것도 보내지 않는다)', async () => {
    const { arbiter, sent } = setup();
    const result = arbiter.requestSit('a1') as Promise<boolean>;
    arbiter.onMySeat('a1');
    await result;
    sent.length = 0;
    arbiter.release('b1');
    expect(sent).toEqual([]);
    arbiter.release('a1');
    expect(sent).toEqual(['stand']);
    expect(arbiter.mySeat).toBeNull();
  });

  it('여러 번 물으면 거절은 가장 오래 기다린 것부터', async () => {
    const { arbiter } = setup();
    const first = arbiter.requestSit('a1') as Promise<boolean>;
    const second = arbiter.requestSit('a2') as Promise<boolean>;
    arbiter.onSitError('seat-taken');
    await expect(first).resolves.toBe(false);
    arbiter.onMySeat('a2');
    await expect(second).resolves.toBe(true);
  });

  it('혼자 모드(오프라인)에서는 기존 로컬 판정: 바로 앉는다', () => {
    const { arbiter, sent } = setup({ online: false, occupied: ['a1'] });
    expect(arbiter.requestSit('a1')).toBe(true); // 오프라인에서는 남이 없다
    expect(arbiter.isOccupiedByOther('a1')).toBe(false);
    expect(sent).toEqual([]);
  });

  it('답을 기다리다 연결이 끊기면 로컬로 앉은 것으로 한다', async () => {
    const { arbiter, state } = setup();
    const result = arbiter.requestSit('a1') as Promise<boolean>;
    state.online = false;
    arbiter.onOffline();
    await expect(result).resolves.toBe(true);
  });

  it('서버가 내 자리를 풀었다고 알리면 기억을 지운다', async () => {
    const { arbiter } = setup();
    const result = arbiter.requestSit('a1') as Promise<boolean>;
    arbiter.onMySeat('a1');
    await result;
    arbiter.onMySeatFreed('a1');
    expect(arbiter.mySeat).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// NetSession: 서버 메시지를 화면 이벤트(NetEventMap)로 내보낸다
// ---------------------------------------------------------------------------

afterAll(() => disposeAvatarResources());

class Sock implements SocketLike {
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send(): void {}
  close(): void {
    this.readyState = 3;
  }
  receive(msg: ServerMsg): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

function sessionSetup() {
  let sock: Sock | null = null;
  const client = new PresenceClient({
    url: 'ws://localhost:8797',
    spaceId: 'jumak',
    deviceId: 'dev-1234567890',
    createSocket: () => (sock = new Sock()),
    visibility: { isHidden: () => false, onVisible: () => () => undefined },
  });
  const scene = new THREE.Scene();
  const space = {
    id: 'jumak',
    avatarOutfit: 'plain',
    capacityPerRoom: 4,
    actions: [{ id: 'clap', label: { ko: '박수' }, motion: 'hop' }],
  } as unknown as SpaceDefinition;
  const events: Array<{ type: keyof NetEventMap; payload: unknown }> = [];
  const session = new NetSession({
    space,
    scene,
    seats: new SeatManager(scene, []),
    clock: new QuietClock(),
    url: 'ws://localhost:8797',
    room: null,
    deviceId: 'dev-1234567890',
    reducedMotion: true,
    client,
    host: {
      emit: (type, payload) => events.push({ type, payload }),
      getSelf: () => ({ x: 0, z: 0, yaw: 0, seatId: null }),
      standUp: () => undefined,
      abortSeat: () => undefined,
    },
  });
  session.start();
  sock!.readyState = 1;
  sock!.onopen?.({});
  sock!.receive({
    t: 'welcome',
    id: 1,
    name: { ko: '신난 파전' },
    space: 'jumak',
    room: 2,
    capacity: 24,
    peers: [{ id: 2, name: { ko: '들뜬 막걸리' }, x: 1, z: 1, r: 0 }],
    seats: {},
    now: Date.now(),
    limits: { moveHz: 10, stateHz: 2, actCooldownMs: 1000 },
  });
  const of = <K extends keyof NetEventMap>(type: K) => events.filter((e) => e.type === type).map((e) => e.payload as NetEventMap[K]);
  return { session, sock: sock!, of };
}

describe('NetSession 이벤트', () => {
  it('다른 사람의 동작은 peer-act로 알리고(모르는 동작 id도), 내 동작은 알리지 않는다', () => {
    const { session, sock, of } = sessionSetup();
    sock.receive({ t: 'act', id: 2, act: 'clap' });
    sock.receive({ t: 'act', id: 2, act: 'roar' });
    sock.receive({ t: 'act', id: 1, act: 'clap' }); // 나
    expect(of('peer-act')).toEqual([
      { id: 2, act: 'clap' },
      { id: 2, act: 'roar' },
    ]);
    session.dispose();
  });

  it('feed와 moment를 그대로 넘기고, 마지막 피드를 session.feed로 읽을 수 있다', () => {
    const { session, sock, of } = sessionSetup();
    const feed = { v: 1 as const, now: 1, matches: [] };
    const m = { id: 'x:kickoff', kind: 'kickoff' as const, match: 'x', at: 123, text: '경기 시작!' };
    sock.receive({ t: 'feed', feed });
    sock.receive({ t: 'moment', m });
    expect(of('feed')).toEqual([feed]);
    expect(of('moment')).toEqual([m]);
    expect(session.feed).toEqual(feed);
    session.dispose();
  });
});
