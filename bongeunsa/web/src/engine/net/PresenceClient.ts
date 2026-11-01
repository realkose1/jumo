// 실시간 서버(server)와 WebSocket으로 이야기하는 층. 화면(three.js)은 모른다.
//   - 연결하고 5초 안에 join을 보내고, welcome을 받으면 '온라인'
//   - 끊기면 지수 백오프로 다시 연결(최대 간격 제한, 탭이 숨겨져 있으면 서두르지 않는다)
//   - 연결 유지용 글자 "ping"과, 서버 시각 보정용 JSON ping
//   - 받은 메시지를 종류별로 알려주고, 보내는 메시지는 shared/protocol.ts 타입으로만 받는다
// 서버에 못 붙어도 던지지 않는다. 상태만 'offline'이 되고 화면은 혼자 모드로 돈다.
import {
  CLOSE,
  DEVICE_ID_PATTERN,
  LIMITS,
  type ActMsg,
  type ClientMsg,
  type JoinMsg,
  type Limits,
  type LocalizedName,
  type MoveMsg,
  type PeerId,
  type ServerMsg,
  type WelcomeMsg,
} from '@shared/protocol';
import { reconnectDelayMs } from './backoff';
import { Emitter, type Unsubscribe } from '../events';
import { TimeSync, sampleFromPong, sampleFromWelcome, type TimeSample } from './timeSync';

/**
 * - idle: 시작 전 / stop 뒤
 * - connecting: 맨 처음 연결을 시도하는 중
 * - online: welcome을 받았다
 * - offline: 연결이 없다. 뒤에서 다시 시도한다(혼자 모드)
 * - reconnecting: 잘 되던 연결이 끊겨 다시 붙이는 중
 * - full: 정원이 차서 들어가지 못했다(다시 시도하지 않는다)
 * - replaced: 같은 기기가 다른 탭에서 같은 방에 들어왔다(다시 시도하지 않는다)
 * - denied: 서버가 들이지 않았다(같은 IP 연결 초과 4003, 잘못된 join 4004, 너무 잦은 메시지 4005).
 *   다시 시도하지 않는다. 이유는 deniedCode. 화면은 "지금은 들어갈 수 없어요" 같은 안내를 띄운다
 */
export type PresenceStatus = 'idle' | 'connecting' | 'online' | 'offline' | 'reconnecting' | 'full' | 'replaced' | 'denied';

/** 다시 연결하지 않는 닫기 코드(denied) */
const FINAL_CLOSE_CODES: ReadonlySet<number> = new Set([CLOSE.tooManyFromIp, CLOSE.badJoin, CLOSE.abuse]);

/** 브라우저 WebSocket 중 우리가 쓰는 부분. 시험에서는 가짜로 바꿔 끼운다 */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface VisibilityLike {
  isHidden(): boolean;
  /** 보이는 상태로 돌아올 때 알려준다. 해제 함수를 돌려준다 */
  onVisible(handler: () => void): Unsubscribe;
}

export interface PresenceClientOptions {
  /** 서버 주소. 예: ws://localhost:8797 (경로 없이). http(s)로 써도 ws(s)로 바꿔 쓴다 */
  url: string;
  spaceId: string;
  /** 들어갈 방. 없으면 서버가 정해 주고 welcome.room으로 알려준다 */
  room?: number | null;
  /** 기기 식별값(8~64자, 영문 숫자 - _) */
  deviceId: string;
  /** join에 실을 지금 내 위치. 재접속 때마다 다시 부른다 */
  getSpawn?: () => { x: number; z: number; r: number } | null;
  createSocket?: (url: string) => SocketLike;
  visibility?: VisibilityLike;
  random?: () => number;
  /** 기기 시계(ms). 기본은 Date.now */
  now?: () => number;
}

export interface TimeEvent {
  offsetMs: number;
  rttMs: number;
  /** welcome으로 맞춘 임시 값이면 true */
  provisional: boolean;
}

type ServerEvents = { [T in ServerMsg['t']]: Extract<ServerMsg, { t: T }> };

export interface PresenceEventMap extends ServerEvents {
  status: { status: PresenceStatus; prev: PresenceStatus };
  /** 서버 시각과 기기 시계의 차이를 새로 알았다 */
  time: TimeEvent;
}

const OPEN = 1;
const CONNECT_TIMEOUT_MS = 8000;
const KEEPALIVE_MS = 25_000;
/** 이만큼 아무것도 못 받으면 끊어진 것으로 보고 다시 붙인다 */
const STALE_MS = 75_000;
const STABLE_MS = 10_000;
const TIME_PINGS_MS = [300, 900, 1800, 3000];
const TIME_RESYNC_MS = 5 * 60_000;
const RETURN_RECONNECT_MS = 300;

const SERVER_TYPES: ReadonlySet<string> = new Set([
  'welcome',
  'peer-join',
  'peer-leave',
  'peer-move',
  'seat',
  'act',
  'notice',
  'state',
  'room-full',
  'pong',
  'error',
]);

function toWebSocketBase(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (trimmed.startsWith('https://')) return `wss://${trimmed.slice('https://'.length)}`;
  if (trimmed.startsWith('http://')) return `ws://${trimmed.slice('http://'.length)}`;
  return trimmed;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isWelcome(m: ServerMsg): m is WelcomeMsg {
  const w = m as Partial<WelcomeMsg>;
  return (
    m.t === 'welcome' &&
    isFiniteNumber(w.id) &&
    isFiniteNumber(w.room) &&
    isFiniteNumber(w.capacity) &&
    typeof w.name?.ko === 'string' &&
    Array.isArray(w.peers) &&
    typeof w.seats === 'object' &&
    w.seats !== null
  );
}


function defaultVisibility(): VisibilityLike {
  return {
    isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
    onVisible(handler) {
      if (typeof document === 'undefined') return () => undefined;
      const fn = () => {
        if (document.visibilityState === 'visible') handler();
      };
      document.addEventListener('visibilitychange', fn);
      return () => document.removeEventListener('visibilitychange', fn);
    },
  };
}

export class PresenceClient {
  private readonly events = new Emitter<PresenceEventMap>();
  private readonly timeSync = new TimeSync();
  private readonly visibility: VisibilityLike;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly createSocket: (url: string) => SocketLike;
  private readonly base: string;

  private socket: SocketLike | null = null;
  private state: PresenceStatus = 'idle';
  private room: number | null;
  private wasOnline = false;
  private started = false;
  private attempt = 0;
  private lastRx = 0;
  private pingSentAt = new Map<number, number>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private resyncTimer: ReturnType<typeof setInterval> | null = null;
  private stopVisibility: Unsubscribe | null = null;
  private lastWelcome: WelcomeMsg | null = null;
  private denied: number | null = null;

  constructor(private readonly options: PresenceClientOptions) {
    this.room = options.room ?? null;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? (() => Date.now());
    this.createSocket = options.createSocket ?? ((u) => new WebSocket(u) as unknown as SocketLike);
    this.visibility = options.visibility ?? defaultVisibility();
    this.base = toWebSocketBase(options.url);
  }

  // ---- 읽기 ----

  get status(): PresenceStatus {
    return this.state;
  }

  /** 지금 들어와 있는(또는 들어가려는) 방 */
  get currentRoom(): number | null {
    return this.room;
  }

  /** 마지막으로 받은 welcome (끊긴 뒤에도 남아 있다) */
  get welcome(): WelcomeMsg | null {
    return this.lastWelcome;
  }

  get myId(): PeerId | null {
    return this.state === 'online' ? (this.lastWelcome?.id ?? null) : null;
  }

  /** status가 'denied'일 때 서버가 닫은 코드(4003, 4004, 4005). 아니면 null */
  get deniedCode(): number | null {
    return this.state === 'denied' ? this.denied : null;
  }

  get myName(): LocalizedName | null {
    return this.lastWelcome?.name ?? null;
  }

  get limits(): Limits {
    return this.lastWelcome?.limits ?? LIMITS;
  }

  get attempts(): number {
    return this.attempt;
  }

  isOnline(): boolean {
    return this.state === 'online';
  }

  /** 가장 믿을 만한 서버 시각 차이. 아직 모르면 null */
  getTimeSample(): TimeSample | null {
    return this.timeSync.best();
  }

  on<K extends keyof PresenceEventMap>(type: K, handler: (payload: PresenceEventMap[K]) => void): Unsubscribe {
    return this.events.on(type, handler);
  }

  // ---- 시작과 끝 ----

  start(): void {
    if (this.started) return;
    this.started = true;
    if (!DEVICE_ID_PATTERN.test(this.options.deviceId)) {
      // 서버가 join을 거절하는 값이다. 연결을 시도해 봐야 소용없으니 혼자 모드로 둔다
      this.setStatus('offline');
      return;
    }
    this.stopVisibility = this.visibility.onVisible(() => this.onBecameVisible());
    this.setStatus('connecting');
    this.connect();
  }

  stop(): void {
    this.started = false;
    this.stopVisibility?.();
    this.stopVisibility = null;
    this.clearTimers();
    this.teardownSocket(1000, 'bye');
    this.setStatus('idle');
  }

  dispose(): void {
    this.stop();
    this.events.clear();
  }

  /** 다른 방으로 옮긴다(또는 null이면 서버가 정하게 한다). 바로 다시 연결한다 */
  setRoom(room: number | null): void {
    this.room = room;
    if (!this.started || this.state === 'full' || this.state === 'replaced' || this.state === 'denied') return;
    this.attempt = 0;
    this.reconnectNow();
  }

  // ---- 보내기 ----

  sendMove(x: number, z: number, r: number): boolean {
    const msg: MoveMsg = { t: 'move', x, z, r };
    return this.send(msg);
  }

  sendSit(seat: string): boolean {
    return this.send({ t: 'sit', seat });
  }

  sendStand(): boolean {
    return this.send({ t: 'stand' });
  }

  sendAct(act: string, to?: PeerId, v?: number): boolean {
    const msg: ActMsg = { t: 'act', act, ...(to === undefined ? {} : { to }), ...(v === undefined ? {} : { v }) };
    return this.send(msg);
  }

  sendState(key: string, val: number): boolean {
    return this.send({ t: 'state', key, val });
  }

  /** 온라인일 때만 보낸다. 못 보내면 false (쌓아 두지 않는다: 연결이 돌아오면 옛 동작을 뒤늦게 보내는 건 이상하다) */
  send(msg: Exclude<ClientMsg, JoinMsg>): boolean {
    if (this.state !== 'online' || !this.socket || this.socket.readyState !== OPEN) return false;
    try {
      this.socket.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  // ---- 연결 ----

  private connect(): void {
    this.clearReconnectTimer();
    if (!this.started) return;
    const { spaceId } = this.options;
    const query = new URLSearchParams({ space: spaceId });
    if (this.room !== null) query.set('room', String(this.room));
    let socket: SocketLike;
    try {
      socket = this.createSocket(`${this.base}/ws?${query.toString()}`);
    } catch {
      this.onSocketLost(0, false);
      return;
    }
    this.socket = socket;
    this.connectTimer = setTimeout(() => {
      // 열리지도, 닫히지도 않고 오래 걸리면 포기하고 다시 시도한다
      if (this.socket === socket && this.state !== 'online') {
        this.teardownSocket(4000, 'connect-timeout');
        this.onSocketLost(0, false);
      }
    }, CONNECT_TIMEOUT_MS);

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.lastRx = this.now();
      this.sendJoin(socket);
    };
    socket.onmessage = (ev) => {
      if (this.socket !== socket) return;
      this.lastRx = this.now();
      this.onRawMessage(ev.data);
    };
    socket.onerror = () => {
      /* 닫힘(onclose)에서 같이 처리한다 */
    };
    socket.onclose = (ev) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.onSocketLost(ev.code, this.state === 'online');
    };
  }

  private sendJoin(socket: SocketLike): void {
    const spawn = this.options.getSpawn?.() ?? null;
    const join: JoinMsg = {
      t: 'join',
      space: this.options.spaceId,
      dev: this.options.deviceId,
      ...(this.room !== null ? { room: this.room } : {}),
      ...(spawn ? { x: spawn.x, z: spawn.z, r: spawn.r } : {}),
    };
    try {
      socket.send(JSON.stringify(join));
    } catch {
      /* 닫힘에서 처리 */
    }
  }

  private onRawMessage(data: unknown): void {
    if (typeof data !== 'string') return;
    if (data === 'pong') return; // 연결 유지 답. 받은 시각만 갱신하면 된다
    let msg: ServerMsg;
    try {
      msg = JSON.parse(data) as ServerMsg;
    } catch {
      return;
    }
    if (typeof msg !== 'object' || msg === null || typeof msg.t !== 'string' || !SERVER_TYPES.has(msg.t)) return;

    if (msg.t === 'welcome') {
      if (!isWelcome(msg)) {
        this.teardownSocket(4000, 'bad-welcome');
        this.onSocketLost(0, false);
        return;
      }
      this.onWelcome(msg);
      return;
    }
    if (msg.t === 'pong') this.onPong(msg);
    if (msg.t === 'room-full') this.setStatus('full');
    if (this.state === 'idle') return;
    this.events.emit(msg.t, msg as never);
  }

  private onWelcome(msg: WelcomeMsg): void {
    this.clearConnectTimer();
    this.lastWelcome = msg;
    this.room = msg.room; // 재접속은 같은 방으로
    this.wasOnline = true;
    this.setStatus('online');
    this.startKeepalive();
    this.stableTimer = setTimeout(() => {
      this.attempt = 0; // 한동안 안정적이었으니 다음 끊김은 처음부터 센다
    }, STABLE_MS);

    this.timeSync.reset();
    this.pingSentAt.clear();
    this.applyTimeSample(sampleFromWelcome(msg.now, this.now()), true);
    for (const ms of TIME_PINGS_MS) this.later(() => this.sendTimePing(), ms);
    this.resyncTimer = setInterval(() => this.sendTimePing(), TIME_RESYNC_MS);

    this.events.emit('welcome', msg);
  }

  private onPong(msg: Extract<ServerMsg, { t: 'pong' }>): void {
    if (!isFiniteNumber(msg.c)) return;
    const sentAt = this.pingSentAt.get(msg.c);
    this.pingSentAt.delete(msg.c);
    // c는 우리가 보낸 값 그대로 돌아온다. 모르는 값(다른 연결의 옛 답)은 쓰지 않는다
    if (sentAt === undefined) return;
    this.applyTimeSample(sampleFromPong(sentAt, this.now(), msg.now), false);
  }

  private applyTimeSample(sample: TimeSample | null, provisional: boolean): void {
    const before = this.timeSync.best();
    this.timeSync.add(sample);
    const best = this.timeSync.best();
    if (!best || best === before) return;
    this.events.emit('time', { offsetMs: best.offsetMs, rttMs: best.rttMs, provisional: provisional && !Number.isFinite(best.rttMs) });
  }

  private sendTimePing(): void {
    if (this.state !== 'online' || !this.socket) return;
    // c는 보낸 시각(ms)이고 서버가 그대로 돌려준다. 같은 값이 겹치면 1씩 올려 구분한다
    const sentAt = this.now();
    let c = Math.floor(sentAt);
    while (this.pingSentAt.has(c)) c += 1;
    this.pingSentAt.set(c, sentAt);
    if (this.pingSentAt.size > 16) {
      const oldest = this.pingSentAt.keys().next().value;
      if (oldest !== undefined) this.pingSentAt.delete(oldest);
    }
    this.send({ t: 'ping', c });
  }

  // ---- 끊김과 재연결 ----

  private onSocketLost(code: number, wasOnline: boolean): void {
    this.clearConnectTimer();
    this.clearKeepalive();
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
    this.pingSentAt.clear();
    this.socket = null;
    if (!this.started) return;

    if (code === CLOSE.replaced) {
      this.setStatus('replaced'); // 같은 기기의 다른 탭이 이 방을 가져갔다. 되찾으려 다투지 않는다
      return;
    }
    if (code === CLOSE.roomFull || this.state === 'full') {
      this.setStatus('full');
      return;
    }
    if (FINAL_CLOSE_CODES.has(code)) {
      // 다시 붙여도 같은 이유로 닫힌다(같은 와이파이에 사람이 많음, 잘못된 입장, 너무 잦은 메시지). 15~30초마다 헛되이 두드리지 않는다
      this.denied = code;
      this.setStatus('denied');
      return;
    }
    this.setStatus(this.wasOnline || wasOnline ? 'reconnecting' : 'offline');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    const delay = reconnectDelayMs(this.attempt, this.visibility.isHidden(), this.random);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /** 탭이 다시 보이면 기다리던 재연결을 곧바로 한다 */
  private onBecameVisible(): void {
    if (!this.started || this.reconnectTimer === null) return;
    this.attempt = 0;
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RETURN_RECONNECT_MS);
  }

  private reconnectNow(): void {
    this.clearReconnectTimer();
    this.clearConnectTimer();
    const hadSocket = this.socket !== null;
    this.teardownSocket(1000, 'switch-room');
    if (hadSocket && this.state === 'online') this.setStatus('reconnecting');
    this.connect();
  }

  private startKeepalive(): void {
    this.clearKeepalive();
    this.keepaliveTimer = setInterval(() => {
      const socket = this.socket;
      if (!socket || this.state !== 'online') return;
      if (this.now() - this.lastRx > STALE_MS) {
        // 한참 아무 소식이 없다: 조용히 끊어진 연결이다
        this.teardownSocket(4000, 'stale');
        this.onSocketLost(0, true);
        return;
      }
      try {
        socket.send('ping'); // 서버가 객체를 깨우지 않고 'pong'으로 답한다
      } catch {
        /* 닫힘에서 처리 */
      }
    }, KEEPALIVE_MS);
  }

  // ---- 정리 ----

  private setStatus(next: PresenceStatus): void {
    if (this.state === next) return;
    const prev = this.state;
    this.state = next;
    this.events.emit('status', { status: next, prev });
  }

  private teardownSocket(code: number, reason: string): void {
    const socket = this.socket;
    this.socket = null;
    this.clearKeepalive();
    if (!socket) return;
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    try {
      socket.close(code, reason);
    } catch {
      /* 이미 닫혔다 */
    }
  }

  private later(fn: () => void, ms: number): void {
    const id = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
  }

  private clearTimers(): void {
    this.clearReconnectTimer();
    this.clearConnectTimer();
    this.clearKeepalive();
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.stableTimer = null;
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private clearKeepalive(): void {
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = null;
    if (this.resyncTimer) clearInterval(this.resyncTimer);
    this.resyncTimer = null;
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
  }
}
