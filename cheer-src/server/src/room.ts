// 방 하나 = Durable Object 하나 (이름 `<공간id>:<방번호>`).
// WebSocket 휴면(Hibernation) 방식: 조용히 앉아 있는 동안에는 객체가 메모리에서 내려가고, 메시지가 오면 다시 깨어난다.
// 그래서 연결별 상태는 serializeAttachment에 두고, 깨어날 때 생성자에서 다시 모은다.
// 속도 제한 카운터, 위치 묶음 대기열 같은 잠깐의 값만 메모리에 둔다.
//
// 알람은 객체마다 하나뿐이라 두 가지 일을 한 알람에 모은다(가장 이른 일이 알람 시각):
//   due:report  로비에 인원 알리기(묶어 보내기 2초, 사람이 있는 동안 10분마다 다시)
//   due:poll    경기 피드 받기(피드를 쓰는 공간에서 사람이 있는 동안 FEED_POLL_MS마다)
// 할 일의 시각은 저장소에 두어서 휴면, 재시작 뒤에도 이어진다. 알람이 울리면 때가 된 일을 모두 하고 다음 알람을 건다.
import { DurableObject } from 'cloudflare:workers';
import type { CheerFeed } from '../../shared/cheer';
import { deriveMomentsWithEpochs } from '../../shared/moments';
import {
  CLOSE,
  LIMITS,
  type ClientMsg,
  type ClientMsgType,
  type ErrorCode,
  type LocalizedName,
  type PeerId,
  type PeerInfo,
  type ServerMsg,
} from '../../shared/protocol';
import { flagVar, getSpaceConfig, lobbyName, numberVar, type PresenceEnv, type SpaceConfig } from './env';
import { feedKey, fetchFeed } from './feed';
import { pickNames } from './names';
import { RateWindow, type RateKind } from './ratelimit';
import { SIM_POLL_MS, simFeed } from './sim';
import { normalizeAngle, parseClientMessage, round2 } from './validate';

/** 첫 join을 기다리는 시간 */
const JOIN_TIMEOUT_MS = 5000;
/** 방 인원을 로비에 알리는 최소 간격(묶어 보내기) */
const REPORT_INTERVAL_MS = 2000;
/** 사람이 있는 동안 로비에 다시 알리는 간격(로비가 오래된 값을 0으로 보지 않게) */
const HEARTBEAT_MS = 10 * 60 * 1000;
/** 속도 제한으로 버려진 메시지가 1초에 이만큼 넘으면 연결을 닫는다(정상 화면은 제한 안에서 보낸다) */
const ABUSE_PER_SECOND = 30;
/** 틀린 메시지가 1초에 이만큼 넘으면 연결을 닫는다 */
const BAD_PER_SECOND = 15;
/** 경기 피드를 받아 오는 기본 간격 */
const FEED_POLL_DEFAULT_MS = 15_000;
/** 직전 피드가 이보다 오래됐으면(받기가 한참 실패했으면) 순간을 내지 않고 새 기준으로만 쓴다. 받는 간격의 4배와 비교해 큰 쪽 */
const FEED_MAX_GAP_MS = 2 * 60_000;
/** 새로 들어온 사람에게 저장된 피드를 바로 보내는 최대 나이 */
const FEED_SEND_MAX_AGE_MS = 10 * 60_000;
/** 이미 보낸 순간 id를 기억하는 개수(휴면, 재시작 뒤에도 두 번 보내지 않게) */
const FIRED_KEEP = 300;
/** 경기별 정정 횟수(점수가 내려간 횟수)를 기억하는 경기 수 */
const EPOCHS_KEEP = 100;
/** 한 IP에서 아직 join하지 않은 연결의 상한(붙기만 하고 가만있는 연결 방지). join한 연결은 MAX_CONN_PER_IP로 센다 */
const MAX_PENDING_PER_IP = 10;
/** 알람이 울렸을 때 이만큼 뒤의 일까지 같이 한다 */
const ALARM_SLACK_MS = 250;

type DueTask = 'report' | 'poll';

interface StoredFeed {
  feed: CheerFeed;
  /** 받은 시각(서버) */
  at: number;
  key: string;
}

interface PendingAttach {
  j: false;
  ip: string | null;
}

interface JoinedAttach {
  j: true;
  ip: string | null;
  id: PeerId;
  dev: string;
  name: LocalizedName;
  x: number;
  z: number;
  r: number;
  seat: string | null;
  st: Record<string, number>;
}

type Attach = PendingAttach | JoinedAttach;

interface Conn {
  ws: WebSocket;
  att: Attach;
  rate: RateWindow;
  /** 닫는 중이라 더 받지 않는다 */
  closing: boolean;
}

interface RoomMeta {
  space: string;
  room: number;
}

export class Room extends DurableObject<PresenceEnv> {
  private readonly conns = new Map<WebSocket, Conn>();
  private readonly byId = new Map<PeerId, Conn & { att: JoinedAttach }>();
  private meta: RoomMeta | undefined;
  private cfg: SpaceConfig | undefined;
  private seatSet: Set<string> | undefined;

  private readonly pendingMoves = new Map<PeerId, [number, number, number]>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  private lastReported: number | undefined;
  private lastReportAt = 0;

  constructor(ctx: DurableObjectState, env: PresenceEnv) {
    super(ctx, env);
    this.meta = ctx.storage.kv.get<RoomMeta>('meta');
    // 'ping' 글자는 객체를 깨우지 않고 'pong'으로 답한다(연결 유지용). 서버 시각이 필요하면 JSON ping을 쓴다
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    for (const ws of ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attach | null;
      if (!att) {
        ws.close(CLOSE.badJoin, 'no-state');
        continue;
      }
      this.adopt({ ws, att, rate: new RateWindow(), closing: false });
    }
  }

  // ------------------------------------------------------------------ 연결

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('websocket only', { status: 426 });
    }
    const space = request.headers.get('X-Qs-Space') ?? '';
    const room = Number(request.headers.get('X-Qs-Room'));
    const cfg = getSpaceConfig(this.env, space);
    if (!cfg || !Number.isInteger(room) || room < 1 || room > cfg.maxRooms) {
      return new Response('unknown room', { status: 404 });
    }
    if (!this.meta) {
      this.meta = { space, room };
      this.ctx.storage.kv.put('meta', this.meta);
    } else if (this.meta.space !== space || this.meta.room !== room) {
      return new Response('room mismatch', { status: 400 });
    }
    this.cfg = cfg;

    // 아직 join하지 않은 연결까지 센 하드 상한(붙기만 하고 가만있는 연결 방지)
    if (this.conns.size >= cfg.capacity * 2 + 10) {
      return new Response('busy', { status: 503, headers: { 'Retry-After': '5' } });
    }

    const ip = request.headers.get('CF-Connecting-IP');
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    const conn: Conn = { ws: server, att: { j: false, ip }, rate: new RateWindow(), closing: false };
    server.serializeAttachment(conn.att);
    this.conns.set(server, conn);

    // 같은 IP의 '들어온 사람' 수는 join 때(같은 기기 정리 뒤) 센다. 여기서는 아직 join 안 한 연결만 센다
    if (ip && this.countFromIp(ip, false) > MAX_PENDING_PER_IP) {
      this.closeConn(conn, CLOSE.tooManyFromIp, 'too-many-pending-from-ip');
    } else {
      setTimeout(() => {
        if (!conn.att.j && !conn.closing && this.conns.has(server)) this.closeConn(conn, CLOSE.badJoin, 'join-timeout');
      }, JOIN_TIMEOUT_MS);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const conn = this.conns.get(ws);
    if (!conn || conn.closing) return;
    const now = Date.now();

    const parsed = parseClientMessage(message);
    if (!parsed.ok) {
      this.onBad(conn, now);
      return;
    }
    const msg = parsed.msg;
    if (!conn.rate.take(rateKind(msg), now)) {
      // move는 말없이 버리고, 나머지는 버렸다고 알린다
      if (msg.t !== 'move') this.error(conn, 'rate-limited', msg.t);
      if (conn.rate.dropped > ABUSE_PER_SECOND) this.closeConn(conn, CLOSE.abuse, 'flood');
      return;
    }

    if (msg.t === 'join') {
      if (conn.att.j) return this.error(conn, 'bad-request', 'join');
      return this.onJoin(conn, msg);
    }
    if (!conn.att.j) {
      this.closeConn(conn, CLOSE.badJoin, 'join-first');
      return;
    }
    const me = conn as Conn & { att: JoinedAttach };
    switch (msg.t) {
      case 'move':
        return this.onMove(me, msg);
      case 'sit':
        return this.onSit(me, msg.seat);
      case 'stand':
        return this.onStand(me);
      case 'act':
        return this.onAct(me, msg.act, msg.to, msg.v, now);
      case 'state':
        return this.onState(me, msg.key, msg.val);
      case 'ping':
        this.send(conn, { t: 'pong', ...(msg.c !== undefined ? { c: msg.c } : {}), now });
        return;
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    const conn = this.conns.get(ws);
    if (conn) this.removePeer(conn);
    try {
      // 예약된 코드(1005, 1006 등)는 그대로 돌려줄 수 없다
      ws.close(code >= 4000 || (code >= 1000 && code <= 1003) ? code : 1000, 'bye');
    } catch {
      // 이미 닫혔다
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    const conn = this.conns.get(ws);
    if (conn) this.removePeer(conn);
    try {
      ws.close(1011, 'error');
    } catch {
      // 이미 닫혔다
    }
  }

  async alarm(): Promise<void> {
    const kv = this.ctx.storage.kv;
    const report = kv.get<number>('due:report');
    const poll = kv.get<number>('due:poll');
    // 가장 이른 일은 늘 하고(시험의 runDurableObjectAlarm처럼 일찍 불려도), 그때까지 때가 된 일도 같이 한다
    const earliest = Math.min(report ?? Infinity, poll ?? Infinity);
    const cutoff = Math.max(Date.now(), earliest) + ALARM_SLACK_MS;
    try {
      if (report !== undefined && report <= cutoff) {
        kv.delete('due:report');
        this.pushCount();
      }
      if (poll !== undefined && poll <= cutoff) await this.pollFeed();
    } catch (err) {
      // 알람이 던지면 다시 시도가 쌓인다. 여기서 끝내고 다음 차례를 건다
      console.warn('[room] alarm failed', String(err));
    }
    this.armAlarm();
  }

  // ------------------------------------------------------------------ 메시지 처리

  private onBad(conn: Conn, now: number): void {
    if (conn.rate.strike(now) > BAD_PER_SECOND) this.closeConn(conn, CLOSE.abuse, 'bad-messages');
  }

  private onJoin(conn: Conn, msg: Extract<ClientMsg, { t: 'join' }>): void {
    const meta = this.meta;
    const cfg = this.config();
    if (!meta || !cfg || msg.space !== meta.space || (msg.room !== undefined && msg.room !== meta.room)) {
      this.closeConn(conn, CLOSE.badJoin, 'wrong-room');
      return;
    }

    // 같은 기기가 같은 방에 다시 들어오면 이전 연결을 닫는다(새로고침, 재접속 때 옛 연결이 남아 있는 경우)
    for (const other of [...this.byId.values()]) {
      if (other.att.dev === msg.dev) this.closeConn(other, CLOSE.replaced, 'replaced');
    }

    // 같은 IP(같은 와이파이, 통신사 NAT)에서 이미 들어온 사람 수. 기다리는 연결과 방금 바뀐 같은 기기는 세지 않는다
    const maxPerIp = numberVar(this.env.MAX_CONN_PER_IP, 30, 1);
    if (conn.att.ip && this.countFromIp(conn.att.ip, true) >= maxPerIp) {
      this.closeConn(conn, CLOSE.tooManyFromIp, 'too-many-from-ip');
      return;
    }

    if (this.byId.size >= cfg.capacity) {
      void this.rejectFull(conn);
      return;
    }

    const usedKo = new Set<string>();
    const usedEn = new Set<string>();
    for (const c of this.byId.values()) {
      usedKo.add(c.att.name.ko);
      if (c.att.name.en) usedEn.add(c.att.name.en);
    }
    const name = pickNames(cfg.space.nameWords, usedKo, usedEn);
    const id = this.nextId();
    const att: JoinedAttach = {
      j: true,
      ip: conn.att.ip,
      id,
      dev: msg.dev,
      name,
      x: round2(msg.x ?? 0),
      z: round2(msg.z ?? 0),
      r: normalizeAngle(msg.r ?? 0),
      seat: null,
      st: {},
    };

    const peers: PeerInfo[] = [];
    const seats: Record<string, PeerId> = {};
    for (const c of this.byId.values()) {
      peers.push(peerInfo(c.att));
      if (c.att.seat) seats[c.att.seat] = c.att.id;
    }

    conn.att = att;
    conn.ws.serializeAttachment(att);
    this.adopt(conn);

    this.send(conn, {
      t: 'welcome',
      id,
      name,
      space: meta.space,
      room: meta.room,
      capacity: cfg.capacity,
      peers,
      seats,
      now: Date.now(),
      limits: LIMITS,
    });
    this.broadcast({ t: 'peer-join', peer: peerInfo(att) }, conn);
    this.noteCountChanged();
    if (this.feedEnabled()) this.onFeedJoin(conn);
  }

  private async rejectFull(conn: Conn): Promise<void> {
    conn.closing = true;
    const cfg = this.config();
    let rec: number | null = null;
    try {
      if (cfg && this.meta) {
        const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName(lobbyName(this.meta.space)));
        rec = (await lobby.snapshot(cfg.roomCount, cfg.capacity, this.meta.room, cfg.maxRooms)).recommended;
      }
    } catch {
      // 로비를 못 불러도 정원 초과 안내는 보낸다
    }
    this.send(conn, { t: 'room-full', rec });
    this.closeConn(conn, CLOSE.roomFull, 'room-full');
  }

  private onMove(me: Conn & { att: JoinedAttach }, msg: Extract<ClientMsg, { t: 'move' }>): void {
    if (me.att.seat) this.freeSeat(me); // 앉은 채 움직이면 일어난 것으로 본다
    me.att.x = round2(msg.x);
    me.att.z = round2(msg.z);
    me.att.r = normalizeAngle(msg.r);
    this.pendingMoves.set(me.att.id, [me.att.x, me.att.z, me.att.r]);
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => this.flushMoves(), numberVar(this.env.MOVE_FLUSH_MS, 120, 10));
    }
  }

  private onSit(me: Conn & { att: JoinedAttach }, seat: string): void {
    if (!this.seats().has(seat)) return this.error(me, 'bad-request', 'sit');
    if (me.att.seat === seat) return;
    for (const c of this.byId.values()) {
      if (c.att.seat === seat) return this.error(me, 'seat-taken', 'sit');
    }
    if (me.att.seat) this.freeSeat(me); // 1인 1석: 옮겨 앉으면 이전 자리는 비운다
    me.att.seat = seat;
    me.ws.serializeAttachment(me.att);
    this.broadcast({ t: 'seat', seat, id: me.att.id });
  }

  private onStand(me: Conn & { att: JoinedAttach }): void {
    if (me.att.seat) this.freeSeat(me);
  }

  private async onAct(
    me: Conn & { att: JoinedAttach },
    actId: string,
    to: PeerId | undefined,
    variant: number | undefined,
    now: number,
  ): Promise<void> {
    const cfg = this.config();
    const def = cfg?.space.actions.find((a) => a.id === actId);
    if (!cfg || !def) return this.error(me, 'bad-request', 'act');
    // 변형 번호: 변형이 있는 동작에서만, 선언한 개수 안의 값만. 안 보냈으면 서버가 정해서 모두에게 같은 값을 준다
    let v: number | undefined;
    if (def.variants !== undefined) {
      if (variant !== undefined && variant >= def.variants) return this.error(me, 'bad-request', 'act');
      v = variant ?? Math.floor(Math.random() * def.variants);
    } else if (variant !== undefined) {
      return this.error(me, 'bad-request', 'act');
    }
    // 같은 동작을 다시 하기까지: 동작마다 정할 수 있다(주문은 몇 초). 없으면 기본 1초
    if (!me.rate.takeAct(actId, now, def.cooldownMs ?? LIMITS.actCooldownMs)) return this.error(me, 'rate-limited', 'act');

    // 인사 동작의 받는 사람: 지정했으면 그 사람, 아니면 가장 가까운 사람
    let target: (Conn & { att: JoinedAttach }) | undefined;
    if (def.greeting) {
      if (to !== undefined) {
        target = this.byId.get(to);
        if (!target || target === me) return this.error(me, 'no-target', 'act');
      } else {
        target = this.nearest(me);
      }
    }

    // 선물은 받을 사람이 있을 때(인사가 아닌 선물은 늘) 하루 제한에서 하나 쓴다
    let left: number | undefined;
    if (def.gift && (!def.greeting || target)) {
      let result: number;
      try {
        const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName(lobbyName(cfg.space.id)));
        result = await lobby.consumeGift(me.att.dev, def.id, def.gift.dailyLimit);
      } catch {
        // 제한을 확인하지 못하면 보내지 않는다(스팸 쪽보다 안전한 쪽)
        return this.error(me, 'daily-limit', 'act');
      }
      if (result < 0) return this.error(me, 'daily-limit', 'act');
      left = result;
      // 기다리는 사이 연결이 끊겼거나 받는 사람이 나갔을 수 있다
      if (this.byId.get(me.att.id) !== me) return;
      if (target && this.byId.get(target.att.id) !== target) target = undefined;
    }

    const event: ServerMsg = {
      t: 'act',
      id: me.att.id,
      act: def.id,
      ...(target ? { to: target.att.id } : {}),
      ...(v !== undefined ? { v } : {}),
    };
    this.broadcast(event, me);
    this.send(me, left === undefined ? event : { ...event, left });
    if (target) {
      this.send(target, { t: 'notice', kind: 'greeting', from: me.att.id, name: me.att.name, act: def.id });
    }
  }

  private onState(me: Conn & { att: JoinedAttach }, key: string, val: number): void {
    const def = this.config()?.space.states.find((s) => s.id === key);
    if (!def || val < def.min || val > def.max) return this.error(me, 'bad-request', 'state');
    if (me.att.st[key] === val) return;
    me.att.st[key] = val;
    me.ws.serializeAttachment(me.att);
    this.broadcast({ t: 'state', id: me.att.id, key, val }, me);
  }

  // ------------------------------------------------------------------ 위치 묶음

  private flushMoves(): void {
    this.flushTimer = null;
    if (this.pendingMoves.size === 0) return;
    const p: Array<[PeerId, number, number, number]> = [];
    for (const [id, [x, z, r]] of this.pendingMoves) {
      p.push([id, x, z, r]);
      // 쉬는 동안 깨어날 때를 대비해 마지막 위치를 연결 상태에 남긴다
      const mover = this.byId.get(id);
      if (mover) mover.ws.serializeAttachment(mover.att);
    }
    this.pendingMoves.clear();
    const text = JSON.stringify({ t: 'peer-move', now: Date.now(), p } satisfies ServerMsg);
    // 혼자 움직인 사람에게는 자기 위치를 돌려보내지 않는다
    const only = p.length === 1 ? p[0]![0] : undefined;
    for (const c of this.byId.values()) {
      if (c.att.id !== only) this.sendRaw(c, text);
    }
  }

  // ------------------------------------------------------------------ 사람 목록

  private adopt(conn: Conn): void {
    this.conns.set(conn.ws, conn);
    if (conn.att.j) this.byId.set(conn.att.id, conn as Conn & { att: JoinedAttach });
  }

  private removePeer(conn: Conn): void {
    this.conns.delete(conn.ws);
    if (!conn.att.j) return;
    const att = conn.att;
    if (this.byId.get(att.id) !== conn) return;
    this.byId.delete(att.id);
    this.pendingMoves.delete(att.id);
    if (att.seat) this.broadcast({ t: 'seat', seat: att.seat, id: null });
    this.broadcast({ t: 'peer-leave', id: att.id });
    this.noteCountChanged();
  }

  /** 연결을 닫고 목록에서 뺀다. 이미 들어온 사람이면 나갔다고 알린다 */
  private closeConn(conn: Conn, code: number, reason: string): void {
    conn.closing = true;
    this.removePeer(conn);
    this.conns.delete(conn.ws);
    try {
      conn.ws.close(code, reason);
    } catch {
      // 이미 닫혔다
    }
  }

  private freeSeat(me: Conn & { att: JoinedAttach }): void {
    const seat = me.att.seat;
    if (!seat) return;
    me.att.seat = null;
    me.ws.serializeAttachment(me.att);
    this.broadcast({ t: 'seat', seat, id: null });
  }

  /** 마지막 위치가 가장 가까운 다른 사람. 같은 거리면 번호가 작은 쪽 */
  private nearest(me: Conn & { att: JoinedAttach }): (Conn & { att: JoinedAttach }) | undefined {
    let best: (Conn & { att: JoinedAttach }) | undefined;
    let bestD = Infinity;
    for (const c of this.byId.values()) {
      if (c === me) continue;
      const d = (c.att.x - me.att.x) ** 2 + (c.att.z - me.att.z) ** 2;
      if (d < bestD || (d === bestD && best && c.att.id < best.att.id)) {
        best = c;
        bestD = d;
      }
    }
    return best;
  }

  /** 그 IP의 연결 수. joined가 true면 들어온 사람만, false면 아직 join하지 않은 연결만 */
  private countFromIp(ip: string, joined: boolean): number {
    let n = 0;
    for (const c of this.conns.values()) if (c.att.ip === ip && !c.closing && c.att.j === joined) n++;
    return n;
  }

  private nextId(): PeerId {
    const kv = this.ctx.storage.kv;
    const id = (kv.get<number>('nid') ?? 0) + 1;
    kv.put('nid', id);
    return id;
  }

  private config(): SpaceConfig | undefined {
    if (!this.cfg && this.meta) this.cfg = getSpaceConfig(this.env, this.meta.space) ?? undefined;
    return this.cfg;
  }

  private seats(): Set<string> {
    if (!this.seatSet) this.seatSet = new Set(this.config()?.space.seatIds ?? []);
    return this.seatSet;
  }

  // ------------------------------------------------------------------ 보내기

  private error(conn: Conn, code: ErrorCode, ref?: ClientMsgType): void {
    this.send(conn, { t: 'error', code, ...(ref ? { ref } : {}) });
  }

  private send(conn: Conn, msg: ServerMsg): void {
    this.sendRaw(conn, JSON.stringify(msg));
  }

  private sendRaw(conn: Conn, text: string): void {
    try {
      conn.ws.send(text);
    } catch {
      // 끊어진 연결은 webSocketClose가 정리한다
    }
  }

  private broadcast(msg: ServerMsg, except?: Conn): void {
    const text = JSON.stringify(msg);
    for (const c of this.byId.values()) {
      if (c !== except) this.sendRaw(c, text);
    }
  }

  // ------------------------------------------------------------------ 로비에 인원 알리기

  private noteCountChanged(): void {
    const n = this.byId.size;
    // 방이 비면 피드 받기도 멈춘다
    if (n === 0 && this.ctx.storage.kv.get<number>('due:poll') !== undefined) this.setDue('poll', null);
    if (n === this.lastReported) return;
    const now = Date.now();
    const wait = this.lastReportAt + REPORT_INTERVAL_MS - now;
    if (wait <= 0) {
      this.pushCount();
    } else {
      // 너무 자주 보내지 않도록 묶어서, 잠시 뒤에 최신 값을 한 번만 보낸다(이미 더 이른 차례가 잡혀 있으면 그대로)
      const due = this.ctx.storage.kv.get<number>('due:report');
      if (due === undefined || due > now + wait) this.setDue('report', now + wait);
    }
  }

  private pushCount(): void {
    const meta = this.meta;
    if (!meta) return;
    const n = this.byId.size;
    this.lastReported = n;
    this.lastReportAt = Date.now();
    const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName(lobbyName(meta.space)));
    this.ctx.waitUntil(lobby.report(meta.room, n).catch(() => {}));
    // 사람이 있는 동안은 가끔 다시 알린다. 비면 이 일은 없앤다
    this.setDue('report', n > 0 ? Date.now() + HEARTBEAT_MS : null);
  }

  // ------------------------------------------------------------------ 알람 차례

  /** 할 일의 시각을 정하거나(null이면 지운다) 알람을 가장 이른 일에 맞춘다 */
  private setDue(task: DueTask, at: number | null): void {
    const kv = this.ctx.storage.kv;
    if (at === null) kv.delete(`due:${task}`);
    else kv.put(`due:${task}`, at);
    this.armAlarm();
  }

  private armAlarm(): void {
    const kv = this.ctx.storage.kv;
    const next = Math.min(kv.get<number>('due:report') ?? Infinity, kv.get<number>('due:poll') ?? Infinity);
    if (next === Infinity) void this.ctx.storage.deleteAlarm();
    else void this.ctx.storage.setAlarm(next);
  }

  // ------------------------------------------------------------------ 경기 피드(주막)

  private feedSim(): boolean {
    return flagVar(this.env.FEED_SIM);
  }

  /** 이 방이 피드를 받는가: 피드를 쓰는 공간이고, 주소나 시뮬레이션이 있다 */
  private feedEnabled(): boolean {
    return this.config()?.space.feed === true && (this.feedSim() || Boolean(this.env.FEED_URL?.trim()));
  }

  private pollMs(): number {
    return this.feedSim() ? SIM_POLL_MS : numberVar(this.env.FEED_POLL_MS, FEED_POLL_DEFAULT_MS, 100);
  }

  /** 막 들어온 사람: 들고 있는 피드를 바로 보내고, 빈 방이었으면 피드 받기를 시작한다 */
  private onFeedJoin(conn: Conn): void {
    const kv = this.ctx.storage.kv;
    const now = Date.now();
    const stored = kv.get<StoredFeed>('feed');
    if (stored && now - stored.at <= FEED_SEND_MAX_AGE_MS) this.send(conn, { t: 'feed', feed: stored.feed });
    if (kv.get<number>('due:poll') === undefined) {
      // 빈 방에 첫 사람이 왔다: 바로 받아 오되, 그 피드는 기준으로만 쓴다(지난 일을 다시 틀지 않는다)
      kv.put('feed:base', true);
      if (this.feedSim()) kv.put('sim:start', now);
      this.setDue('poll', now);
    }
  }

  private async pollFeed(): Promise<void> {
    const kv = this.ctx.storage.kv;
    if (this.byId.size === 0 || !this.feedEnabled()) {
      kv.delete('due:poll');
      return;
    }
    // 다음 차례를 먼저 잡는다: 받는 동안 들어온 사람이 또 잡지 않고, 여기서 실패해도 다음 차례가 온다
    kv.put('due:poll', Date.now() + this.pollMs());
    let feed: CheerFeed;
    try {
      feed = this.feedSim()
        ? simFeed(kv.get<number>('sim:start') ?? Date.now(), Date.now())
        : await fetchFeed(this.env.FEED_URL!.trim());
    } catch (err) {
      // 마지막 피드를 그대로 두고 다음 차례에 다시 받는다
      console.warn('[feed] fetch failed', String(err));
      return;
    }
    this.applyFeed(feed, Date.now());
  }

  /** 새 피드: 저장하고, 바뀌었으면 보내고, 생긴 순간을 한 번씩 보낸다 */
  private applyFeed(feed: CheerFeed, now: number): void {
    const kv = this.ctx.storage.kv;
    const stored = kv.get<StoredFeed>('feed');
    const baseline = kv.get<boolean>('feed:base') === true;
    const maxGap = Math.max(FEED_MAX_GAP_MS, this.pollMs() * 4);
    const prev = !baseline && stored && now - stored.at <= maxGap ? stored.feed : null;
    const key = feedKey(feed);

    const fired = kv.get<string[]>('fired') ?? [];
    const seen = new Set(fired);
    const oldEpochs = kv.get<Record<string, number>>('epochs') ?? {};
    const derived = deriveMomentsWithEpochs(prev, feed, now, oldEpochs);
    const moments = derived.moments.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      fired.push(m.id);
      return true;
    });

    // 보내기 전에 저장한다(보낸 뒤 객체가 내려가도 같은 순간을 다시 보내지 않게)
    kv.put('feed', { feed, at: now, key } satisfies StoredFeed);
    if (baseline) kv.delete('feed:base');
    if (moments.length > 0) kv.put('fired', fired.slice(-FIRED_KEEP));
    if (JSON.stringify(derived.epochs) !== JSON.stringify(oldEpochs)) kv.put('epochs', pruneEpochs(derived.epochs, feed));

    // 피드 먼저: 순간이 올 때 화면의 점수가 이미 바뀌어 있게
    if (prev === null || stored?.key !== key) this.broadcast({ t: 'feed', feed });
    for (const m of moments) this.broadcast({ t: 'moment', m });
  }
}

/** 정정 횟수 기억은 EPOCHS_KEEP개까지. 넘치면 지금 피드에 없는 오래된 경기부터 지운다 */
function pruneEpochs(epochs: Record<string, number>, feed: CheerFeed): Record<string, number> {
  const ids = Object.keys(epochs);
  if (ids.length <= EPOCHS_KEEP) return epochs;
  const live = new Set(feed.matches.map((m) => m.id));
  const out: Record<string, number> = {};
  let drop = ids.length - EPOCHS_KEEP;
  for (const id of ids) {
    if (drop > 0 && !live.has(id)) {
      drop--;
      continue;
    }
    out[id] = epochs[id]!;
  }
  return out;
}

function peerInfo(att: JoinedAttach): PeerInfo {
  const info: PeerInfo = { id: att.id, name: att.name, x: att.x, z: att.z, r: att.r };
  if (Object.keys(att.st).length > 0) info.st = att.st;
  return info;
}

function rateKind(msg: ClientMsg): RateKind {
  switch (msg.t) {
    case 'move':
      return 'move';
    case 'state':
      return 'state';
    case 'sit':
    case 'stand':
      return 'seat';
    case 'act':
      return 'act';
    default:
      return 'any';
  }
}
