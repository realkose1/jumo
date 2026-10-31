// 서버 연결과 장면을 잇는 층: PresenceClient(서버 이야기) + RemotePeers(다른 사람 그리기)
// + 서버 판정 자리(PresenceSeatArbiter) + 내 위치 보내기를 한곳에 묶는다.
// Engine은 이 세션 하나만 만지고, 화면(UI)이 알아야 할 일은 Engine 이벤트(NetEventMap)로 나간다.
// 서버에 못 붙는 동안(혼자 모드)에는 아무 일도 하지 않고, 자리도 기존 로컬 판정을 쓴다.
import type * as THREE from 'three';
import type { CheerFeed, ErrorMsg, LocalizedName, Moment, PeerId } from '@shared/protocol';
import { RemotePeers } from '../RemotePeers';
import { LocalSeatArbiter, type SeatArbiter, type SeatDenial, type SeatManager } from '../seats';
import type { QuietClock } from '../time';
import type { SpaceDefinition } from '../types';
import { MoveSender } from './moveSender';
import { PresenceClient, type PresenceStatus } from './PresenceClient';

/** 화면(UI)이 구독하는 서버 관련 이벤트 */
export interface NetEventMap {
  'net-status': { status: PresenceStatus; room: number | null };
  /** 서버가 붙여 준 내 이름 (연결될 때마다 새로 받는다) */
  'self-name': { name: LocalizedName; id?: PeerId };
  /** 들어간 방 번호가 정해졌다 (주소에 반영한다) */
  'room-change': { room: number };
  /** 정원이 차서 들어가지 못했다. rec은 추천 방(없으면 null) */
  'room-full': { rec: number | null };
  /** 누군가 나에게 인사를 건넸다 */
  greeted: { from: PeerId; name: LocalizedName; actionId: string };
  /** 오늘 보낼 수 있는 선물을 다 썼다 */
  'daily-limit': { actionId: string | null };
  /** 다른 사람 머리 위에 이름을 보여준다(null이면 숨김). x, y는 화면(뷰포트) 픽셀 */
  'peer-label': { name: LocalizedName; x: number; y: number } | null;
  /** 경기 피드(주막 TV). 들어가자마자 한 번, 그 뒤로는 바뀔 때마다 온다. 피드를 쓰지 않는 공간에는 오지 않는다 */
  feed: CheerFeed;
  /** 경기에서 일이 났다. 방 모두가 같은 순간에 반응한다: moment.at(서버 시각)을 clock으로 기기 시각에 맞춰 쓴다 */
  moment: Moment;
  /** 다른 사람이 동작을 했다(박수, 건배, 주문). 캐릭터 동작은 엔진이 이미 틀고, 이건 소리나 화면 효과용이다. 내 동작은 오지 않는다 */
  'peer-act': { id: PeerId; act: string; /** 변형 번호(주문의 메뉴 등). 변형이 없는 동작에는 없다 */ v?: number };
}

export interface SessionHost {
  emit<K extends keyof NetEventMap>(type: K, payload: NetEventMap[K]): void;
  /** 지금 내 캐릭터의 위치, 방향, 앉은 자리 */
  getSelf(): { x: number; z: number; yaw: number; seatId: string | null };
  /** 자리를 못 지켰다: 일어난다 */
  standUp(): void;
  /** 걸어가던 자리에 다른 사람이 앉았다 */
  abortSeat(seatId: string): void;
}

interface PendingSit {
  seatId: string;
  resolve: (granted: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** 서버 답을 기다리는 시간. 지나면 못 앉은 것으로 본다 */
const SIT_TIMEOUT_MS = 4000;

/**
 * 자리 판정. 서버에 붙어 있으면 sit을 보내고 서버의 seat 메시지(확정)나 error(거절)를 기다린다.
 * 붙어 있지 않으면 기존 로컬 판정이다. 기다리는 동안 연결이 끊기면 로컬로 앉은 것으로 한다.
 */
export class PresenceSeatArbiter implements SeatArbiter {
  private readonly local = new LocalSeatArbiter();
  private readonly pending: PendingSit[] = [];
  private mine: string | null = null;
  private lastDenial: Exclude<SeatDenial, 'occupied'> = 'taken';

  constructor(
    private readonly client: PresenceClient,
    /** 다른 사람이 앉은 자리인지 (RemotePeers의 점유 현황) */
    private readonly occupiedByOther: (seatId: string) => boolean,
    /** sit을 보내기 직전에 내 마지막 위치를 먼저 알린다(서버는 앉은 채 move를 받으면 일어난 것으로 본다) */
    private readonly flushPosition: () => void,
  ) {}

  /** 서버 답을 기다리는 sit이 있다. 이 동안에는 move를 보내면 안 된다 */
  hasPendingSit(): boolean {
    return this.pending.length > 0;
  }

  requestSit(seatId: string): boolean | Promise<boolean> {
    if (!this.client.isOnline()) return this.local.requestSit(seatId);
    if (this.occupiedByOther(seatId)) {
      this.lastDenial = 'taken';
      return false;
    }
    this.flushPosition();
    if (!this.client.sendSit(seatId)) return this.local.requestSit(seatId);
    return new Promise<boolean>((resolve) => {
      const entry: PendingSit = {
        seatId,
        resolve,
        timer: setTimeout(() => this.settle(entry, false, 'failed'), SIT_TIMEOUT_MS),
      };
      this.pending.push(entry);
    });
  }

  release(seatId: string): void {
    this.local.release(seatId);
    if (this.mine === seatId) {
      this.mine = null;
      this.client.sendStand(); // 온라인이 아니면 보내지지 않는다: 서버에서는 이미 풀렸다
    }
  }

  isOccupiedByOther(seatId: string): boolean {
    return this.client.isOnline() ? this.occupiedByOther(seatId) : this.local.isOccupiedByOther(seatId);
  }

  denialReason(): Exclude<SeatDenial, 'occupied'> {
    return this.lastDenial;
  }

  /** 지금 서버가 알고 있는 내 자리 */
  get mySeat(): string | null {
    return this.mine;
  }

  // ---- 서버 메시지 ----

  /** seat 메시지에서 내 번호가 자리를 차지했다 */
  onMySeat(seatId: string): void {
    const entry = this.pending.find((p) => p.seatId === seatId);
    this.mine = seatId;
    if (entry) this.settle(entry, true);
  }

  /** 서버가 내 자리를 비웠다 (내가 움직였거나 다른 이유) */
  onMySeatFreed(seatId: string): void {
    if (this.mine === seatId) this.mine = null;
  }

  /** sit에 대한 error. 가장 오래 기다린 sit이 거절된 것이다(서버는 같은 연결의 메시지를 순서대로 처리한다) */
  onSitError(code: ErrorMsg['code']): void {
    const entry = this.pending[0];
    if (entry) this.settle(entry, false, code === 'seat-taken' ? 'taken' : 'failed');
  }

  /** 연결이 끊겼다: 기다리던 sit은 로컬로 앉은 것으로 하고, 서버가 아는 자리는 사라졌다 */
  onOffline(): void {
    this.mine = null;
    for (const entry of [...this.pending]) this.settle(entry, true);
  }

  /** 끊겼다 다시 붙었다: 로컬에서 앉아 있던 자리를 서버에 다시 알린다. 못 얻으면 false */
  reclaim(seatId: string): boolean | Promise<boolean> {
    return this.requestSit(seatId);
  }

  dispose(): void {
    for (const entry of [...this.pending]) this.settle(entry, false, 'failed');
  }

  private settle(entry: PendingSit, granted: boolean, reason: Exclude<SeatDenial, 'occupied'> = 'taken'): void {
    const i = this.pending.indexOf(entry);
    if (i < 0) return;
    this.pending.splice(i, 1);
    clearTimeout(entry.timer);
    if (!granted) this.lastDenial = reason;
    entry.resolve(granted);
  }
}

export interface NetSessionOptions {
  space: SpaceDefinition;
  scene: THREE.Scene;
  seats: SeatManager;
  clock: QuietClock;
  /** 서버 주소 (예: ws://localhost:8797) */
  url: string;
  /** 주소에서 읽은 방 번호. 없으면 서버가 정한다 */
  room: number | null;
  deviceId: string;
  reducedMotion: boolean;
  host: SessionHost;
  /** 시험에서 PresenceClient를 바꿔 끼운다 */
  client?: PresenceClient;
}

export class NetSession {
  readonly client: PresenceClient;
  readonly peers: RemotePeers;
  readonly arbiter: PresenceSeatArbiter;

  private readonly mover = new MoveSender();
  private readonly host: SessionHost;
  private readonly space: SpaceDefinition;
  private readonly clock: QuietClock;
  private readonly cleanups: Array<() => void> = [];
  private roomProbeDone = false;
  private readonly roomRequested: number | null;
  private readonly url: string;

  constructor(options: NetSessionOptions) {
    this.host = options.host;
    this.space = options.space;
    this.clock = options.clock;
    this.url = options.url;
    this.roomRequested = options.room;

    this.peers = new RemotePeers(options.scene, {
      seats: options.seats,
      outfit: options.space.avatarOutfit,
      reducedMotion: options.reducedMotion,
      capacity: options.space.capacityPerRoom,
    });

    this.client =
      options.client ??
      new PresenceClient({
        url: options.url,
        spaceId: options.space.id,
        room: options.room,
        deviceId: options.deviceId,
        getSpawn: () => {
          const self = this.host.getSelf();
          this.mover.markSent(self.x, self.z, self.yaw, performance.now());
          return { x: self.x, z: self.z, r: self.yaw };
        },
      });

    this.arbiter = new PresenceSeatArbiter(
      this.client,
      (seatId) => this.peers.seatOwner(seatId) !== null,
      () => this.flushPosition(),
    );
    this.wire();
  }

  start(): void {
    this.client.start();
  }

  /** 마지막으로 받은 경기 피드. 아직 없으면 null */
  get feed(): CheerFeed | null {
    return this.client.feed;
  }

  setReducedMotion(on: boolean): void {
    this.peers.setReducedMotion(on);
  }

  /** 내가 동작을 했다: 같은 방 모두에게 보인다. 온라인이 아니면 보내지 않는다(혼자 모드) */
  sendAction(actionId: string, variant?: number): void {
    this.client.sendAct(actionId, undefined, variant);
  }

  /** 프레임마다: 다른 사람 움직임을 그리고, 내가 움직였으면 위치를 보낸다 */
  update(dt: number): void {
    this.peers.update(dt);
    if (!this.client.isOnline()) return;
    const self = this.host.getSelf();
    // 앉아 있거나 앉는 답을 기다리는 동안 move를 보내면 서버가 일어난 것으로 본다
    if (self.seatId !== null || this.arbiter.hasPendingSit()) return;
    const out = this.mover.next(self.x, self.z, self.yaw, performance.now());
    if (out) this.client.sendMove(out.x, out.z, out.r);
  }

  dispose(): void {
    for (const fn of this.cleanups) fn();
    this.cleanups.length = 0;
    this.arbiter.dispose();
    this.client.dispose();
    this.peers.dispose();
  }

  // ---- 안쪽 ----

  private flushPosition(): void {
    const self = this.host.getSelf();
    const out = this.mover.next(self.x, self.z, self.yaw, performance.now(), true);
    if (out) this.client.sendMove(out.x, out.z, out.r);
  }

  private wire(): void {
    const c = this.client;
    const sub = (unsubscribe: () => void): void => {
      this.cleanups.push(unsubscribe);
    };

    sub(
      c.on('status', ({ status, prev }) => {
        if (prev === 'online' && status !== 'online') {
          // 연결이 끊겼다: 옛 사람들과 자리 정보는 더 믿을 수 없다
          this.peers.clear();
          this.arbiter.onOffline();
          this.mover.reset();
        }
        this.host.emit('net-status', { status, room: c.currentRoom });
        if (status === 'offline' || status === 'reconnecting') void this.probeRoomOnce();
      }),
    );

    sub(c.on('time', ({ offsetMs }) => this.clock.setServerOffsetMs(offsetMs)));

    sub(
      c.on('welcome', (m) => {
        this.mover.setMaxHz(m.limits.moveHz);
        this.peers.reset(m.peers, m.seats);
        this.host.emit('self-name', { name: m.name, id: m.id });
        this.host.emit('room-change', { room: m.room });
        // 끊긴 사이에 로컬로 앉아 있던 자리는 다시 앉아 본다. 그새 다른 사람이 앉았으면 일어난다
        const seatId = this.host.getSelf().seatId;
        if (seatId) {
          void Promise.resolve(this.arbiter.reclaim(seatId)).then((ok) => {
            if (!ok) this.host.standUp();
          });
        }
      }),
    );

    sub(c.on('peer-join', (m) => this.peers.add(m.peer)));
    sub(c.on('peer-leave', (m) => this.peers.remove(m.id)));
    sub(c.on('peer-move', (m) => this.peers.applyMoves(m.p)));

    sub(
      c.on('seat', (m) => {
        if (m.id !== null && m.id === c.myId) {
          this.arbiter.onMySeat(m.seat);
          return;
        }
        if (m.id === null && this.arbiter.mySeat === m.seat) {
          // 서버가 내 자리를 풀었다(내가 움직였다고 본 경우). 로컬에서도 일어난다
          this.arbiter.onMySeatFreed(m.seat);
          if (this.host.getSelf().seatId === m.seat) this.host.standUp();
          return;
        }
        this.peers.setSeat(m.seat, m.id);
        if (m.id !== null) this.host.abortSeat(m.seat);
      }),
    );

    sub(
      c.on('act', (m) => {
        if (m.id === c.myId) return; // 내 동작은 누르는 순간 이미 보였다
        const def = this.space.actions.find((a) => a.id === m.act);
        if (def) this.peers.playMotion(m.id, def.motion);
        this.host.emit('peer-act', { id: m.id, act: m.act, ...(m.v === undefined ? {} : { v: m.v }) });
      }),
    );

    sub(c.on('feed', (m) => this.host.emit('feed', m.feed)));
    sub(c.on('moment', (m) => this.host.emit('moment', m.m)));

    sub(c.on('notice', (m) => this.host.emit('greeted', { from: m.from, name: m.name, actionId: m.act })));
    sub(c.on('room-full', (m) => this.host.emit('room-full', { rec: m.rec })));

    sub(
      c.on('error', (m) => {
        if (m.ref === 'sit') this.arbiter.onSitError(m.code);
        else if (m.code === 'daily-limit') this.host.emit('daily-limit', { actionId: null });
        // rate-limited, no-target, bad-request는 조용히 넘긴다: 화면이 시끄러울 일이 아니다
      }),
    );
  }

  /**
   * 주소의 방 번호가 서버에 없는 방이면 WebSocket이 404로 막혀 영영 붙지 못한다(브라우저는 이유를 알려주지 않는다).
   * 처음 한 번만 방 목록을 물어보고, 없는 방이면 방을 서버에 맡긴다.
   */
  private async probeRoomOnce(): Promise<void> {
    if (this.roomProbeDone || this.roomRequested === null || this.client.welcome !== null) return;
    this.roomProbeDone = true;
    try {
      const http = this.url.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/+$/, '');
      const res = await fetch(`${http}/rooms?space=${encodeURIComponent(this.space.id)}`);
      if (!res.ok) return;
      const body = (await res.json()) as { rooms?: Array<{ room: number }> };
      const rooms = body.rooms ?? [];
      if (rooms.length > 0 && !rooms.some((r) => r.room === this.roomRequested)) this.client.setRoom(null);
    } catch {
      /* 서버가 아예 안 열려 있다: 혼자 모드로 계속 */
    }
  }
}
