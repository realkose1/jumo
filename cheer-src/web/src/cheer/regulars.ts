// 주막 단골손님: 사람처럼 들어와 방석에 앉고, 일어나 마당을 돌아다니고, 박수치고 건배하고, 가끔 주모에게 주문한다.
// 서버와 상관없이 이 화면에서만 움직이는 사람들이라 사람 수에는 들지 않고, 이름 앞에 '단골'이 붙는다.
// 진짜 손님에게 늘 양보한다: 앉은 방석에 누가(나 포함) 앉거나 앉으러 오면 일어나 비켜 주고, 방이 붐비면 한 명은 나간다.
// 경기 중이면 오래 앉아 TV를 보며 자주 응원하고, 골이 나면 다 같이 뛰고 손뼉 치고 사발을 든다.
// 시간은 그리기 반복의 dt로만 센다(탭을 가리면 같이 멈춘다). 무작위는 바꿔 끼울 수 있어 시험에서 고정한다.
import type * as THREE from 'three';
import type { LocalizedName, PeerInfo } from '@shared/protocol';
import { WALK_SPEED, type OutfitSpec } from '../engine/avatar';
import { RemotePeers } from '../engine/RemotePeers';
import { SeatManager } from '../engine/seats';
import type { ActionMotion, SeatDef } from '../engine/types';
import { groundHeight } from '../spaces/jumak/layout';
import { DOORS, STAND_SPOTS, planPath, seatEntry, type Pt, type StandSpot } from '../spaces/jumak/walkways';

/**
 * 단골 다섯 (한 번에 셋까지). 번호는 서버 번호(1부터)와 겹치지 않게 음수이고, 번호가 곧 차림이다(avatar.lookFor, 4가지):
 * 0 갓·옥색 도포·수염, 1 상투·갈색 조끼·수염, 2 갓·쪽빛 도포, 3 상투·먹색 조끼
 */
export const ROSTER: ReadonlyArray<{ id: number; name: string }> = [
  { id: -4, name: '김 생원' },
  { id: -3, name: '박 첨지' },
  { id: -1, name: '돌쇠' },
  { id: -2, name: '윤 도령' },
  { id: -7, name: '최 서방' },
];

/** 방에 다른 사람이 이만큼 넘게 있으면 단골은 둘만 남는다 */
export const BUSY_PEERS = 6;
export const MAX_REGULARS = 3;
export const MIN_REGULARS = 2;

/** 걷는 빠르기: 사람보다 느긋하게 */
const STROLL = WALK_SPEED * 0.55;
const TURN_RATE = 7;
/** 다 와서 방석에 앉기 전에 잠깐 선다 (그려지는 위치가 0.32초 늦게 따라온다 — interpolation.ts) */
const SIT_PAUSE = 0.45;
/** 진짜 사람이 자리를 가져갔는지 보는 간격 */
const YIELD_CHECK = 0.3;
const POPULATION_CHECK = 2.5;
/** 단골끼리 주문 말풍선이 몰리지 않게: 한 번 주문하면 이만큼은 아무도 주문하지 않는다 */
const ORDER_GAP = 95;

type Target = { kind: 'seat'; seatId: string } | { kind: 'spot'; spot: StandSpot } | { kind: 'leave' };

interface Regular {
  id: number;
  x: number;
  z: number;
  yaw: number;
  mode: 'walk' | 'stand' | 'seated';
  target: Target;
  path: Pt[];
  /** 앉으러 가는 자리 또는 앉은 자리 (다른 단골이 겹쳐 고르지 않게 맡아 둔다) */
  seatId: string | null;
  /** 다음 할 일을 정할 때까지 (초) */
  timer: number;
  /** 다음 동작까지 (초) */
  actIn: number;
  /** 골 직후처럼 몰아서 할 동작들 */
  queue: Array<{ at: number; act: string }>;
  /** 이만큼 지나면 집에 간다 (초) */
  stayLeft: number;
  /** 이번에 앉아서 주문할 때 (초, 없으면 Infinity) */
  orderIn: number;
  pause: number;
}

export interface RegularsOptions {
  scene: THREE.Scene;
  seats: readonly SeatDef[];
  outfit: string | OutfitSpec;
  reducedMotion: boolean;
  /** 자리 선호 순서 (TV 가운데부터). 단골은 맨 앞 몇 자리는 손님 몫으로 비워 둔다 */
  seatOrder: readonly string[];
  /** 동작 id -> 몸짓 (공간의 동작 정의) */
  actions: ReadonlyArray<{ id: string; motion: ActionMotion }>;
  /** 진짜 사람(나 포함)이 앉았거나 앉으러 가는 자리 */
  isSeatBlocked(seatId: string): boolean;
  /** 내가 앉은(또는 앉으러 가는) 자리. 단골 하나는 대개 내 평상에 같이 앉는다 — 휴대폰 세로 화면에는 TV와 내 평상만 보인다 */
  mySeat?(): string | null;
  /** 같은 방의 다른 사람 수 (나는 빼고) */
  peerCount(): number;
  /** 경기가 진행 중인가 */
  isLive(): boolean;
  /** 단골의 동작(박수, 건배, 주문): 이모지·소리·주문 말풍선을 띄운다 (몸짓은 여기서 한다) */
  act(id: number, actionId: string, variant?: number): void;
  random?: () => number;
  /** RemotePeers 시계 (시험용) */
  now?: () => number;
}

export class Regulars {
  /** 단골들을 그리는 쪽. engine.addCrowd에 붙이면 이름표·머리 위 효과가 따라온다 */
  readonly peers: RemotePeers;
  private readonly seatManager: SeatManager;
  private readonly opts: RegularsOptions;
  private readonly rand: () => number;
  private readonly regulars = new Map<number, Regular>();
  private readonly motions: Map<string, ActionMotion>;
  private started = false;
  private clock = 0;
  private yieldIn = 0;
  private populationIn = 0;
  /** 누가 나간 뒤 다음 단골이 들어올 때까지 (초) */
  private arriveIn = 0;
  private lastOrderAt = -Infinity;
  private rosterTurn = 0;

  constructor(options: RegularsOptions) {
    this.opts = options;
    this.rand = options.random ?? Math.random;
    this.motions = new Map(options.actions.map((a) => [a.id, a.motion]));
    this.seatManager = new SeatManager(options.scene, options.seats);
    this.peers = new RemotePeers(options.scene, {
      seats: this.seatManager,
      outfit: options.outfit,
      reducedMotion: options.reducedMotion,
      capacity: MAX_REGULARS + 1,
      now: options.now,
    });
    this.peers.setGroundHeight(groundHeight);
  }

  // ---- 읽기 (시험과 확인용) ----

  /** 지금 주막에 있는 단골 (나가는 중인 사람 포함) */
  get count(): number {
    return this.regulars.size;
  }

  /** 집에 가는 중이 아닌 단골 */
  get stayingCount(): number {
    let n = 0;
    for (const r of this.regulars.values()) if (r.target.kind !== 'leave') n += 1;
    return n;
  }

  stateOf(id: number): { mode: Regular['mode']; target: Target['kind']; seatId: string | null; x: number; z: number } | null {
    const r = this.regulars.get(id);
    return r ? { mode: r.mode, target: r.target.kind, seatId: r.seatId, x: r.x, z: r.z } : null;
  }

  ids(): number[] {
    return [...this.regulars.keys()];
  }

  // ---- 시작과 끝 ----

  /** 처음 들어왔을 때 이미 와 있는 단골들: 둘은 앉아 있고 하나는 서 있다 (나타나는 연출 없이) */
  start(): void {
    if (this.started) return;
    this.started = true;
    const want = this.targetCount();
    const infos: PeerInfo[] = [];
    const seats: Record<string, number> = {};
    for (let i = 0; i < want; i++) {
      const who = this.nextFromRoster();
      if (!who) break;
      const r = this.makeRegular(who.id, 0, 0);
      const seatId = i < want - 1 ? this.pickSeat(r) : null;
      const seat = seatId ? this.seatManager.get(seatId) : undefined;
      if (seat && seatId) {
        r.x = seat.x;
        r.z = seat.z;
        r.yaw = seat.facing;
        this.sitDown(r, seatId, false);
        seats[seatId] = r.id;
      } else {
        const spot = this.pickSpot(r, false);
        r.x = spot.x;
        r.z = spot.z;
        r.yaw = spot.facing;
        this.standAt(r, spot);
      }
      // 처음부터 다 같이 일어나 움직이지 않게 할 일을 조금씩 어긋나게
      r.timer *= 0.4 + this.rand() * 0.6;
      this.regulars.set(r.id, r);
      infos.push({ id: r.id, name: nameOf(who.name), x: r.x, z: r.z, r: r.yaw });
    }
    this.peers.reset(infos, seats);
  }

  setReducedMotion(on: boolean): void {
    this.peers.setReducedMotion(on);
  }

  /** 골이나 이긴 순간: 다 같이 뛰는 몸짓(engine.celebrateAll) 뒤로 손뼉과 사발이 이어진다 */
  cheer(): void {
    for (const r of this.regulars.values()) {
      if (r.target.kind === 'leave') continue;
      const n = 2 + Math.floor(this.rand() * 2);
      for (let i = 0; i < n; i++) {
        r.queue.push({ at: this.clock + 1.1 + i * (0.7 + this.rand() * 0.9), act: this.rand() < 0.6 ? 'clap' : 'toast' });
      }
      r.actIn = Math.max(r.actIn, 5);
    }
  }

  dispose(): void {
    this.regulars.clear();
    this.peers.dispose();
    this.seatManager.dispose();
  }

  // ---- 매 프레임 ----

  update(dt: number): void {
    if (!this.started) return;
    this.clock += dt;
    this.yieldIn -= dt;
    if (this.yieldIn <= 0) {
      this.yieldIn = YIELD_CHECK;
      this.yieldSeats();
    }
    this.populationIn -= dt;
    this.arriveIn -= dt;
    if (this.populationIn <= 0) {
      this.populationIn = POPULATION_CHECK;
      this.balance();
    }
    const moves: Array<[number, number, number, number]> = [];
    for (const r of [...this.regulars.values()]) {
      this.step(r, dt);
      if (this.regulars.has(r.id) && r.mode !== 'seated') moves.push([r.id, r.x, r.z, r.yaw]);
    }
    if (moves.length) this.peers.applyMoves(moves);
    this.peers.update(dt);
  }

  // ---- 안쪽 ----

  private live(): boolean {
    return this.opts.isLive();
  }

  private between(a: number, b: number): number {
    return a + (b - a) * this.rand();
  }

  private targetCount(): number {
    return this.opts.peerCount() >= BUSY_PEERS ? MIN_REGULARS : MAX_REGULARS;
  }

  private nextFromRoster(): { id: number; name: string } | null {
    for (let i = 0; i < ROSTER.length; i++) {
      const who = ROSTER[(this.rosterTurn + i) % ROSTER.length]!;
      if (this.regulars.has(who.id) || this.peers.has(who.id)) continue;
      this.rosterTurn = (this.rosterTurn + i + 1) % ROSTER.length;
      return who;
    }
    return null;
  }

  private makeRegular(id: number, x: number, z: number): Regular {
    return {
      id,
      x,
      z,
      yaw: 0,
      mode: 'stand',
      target: { kind: 'leave' },
      path: [],
      seatId: null,
      timer: 10,
      actIn: this.between(3, 8),
      queue: [],
      stayLeft: this.between(240, 560),
      orderIn: Infinity,
      pause: 0,
    };
  }

  /** 붐비면 한 명은 집에 가고, 한가하면 (조금 뒤에) 다른 단골이 들어온다 */
  private balance(): void {
    const want = this.targetCount();
    const staying = [...this.regulars.values()].filter((r) => r.target.kind !== 'leave');
    if (staying.length > want) {
      // 서 있는 사람부터 보낸다 (앉은 사람이 갑자기 일어나는 것보다 자연스럽다)
      const goer = staying.find((r) => r.mode !== 'seated') ?? staying[0]!;
      this.leave(goer);
      return;
    }
    if (staying.length < want && this.arriveIn <= 0 && this.regulars.size < MAX_REGULARS + 1) {
      const who = this.nextFromRoster();
      if (!who) return;
      const door = DOORS[Math.floor(this.rand() * DOORS.length)]!;
      const r = this.makeRegular(who.id, door.x, door.z);
      r.yaw = Math.atan2(-door.x, 0);
      this.regulars.set(r.id, r);
      this.peers.add({ id: r.id, name: nameOf(who.name), x: r.x, z: r.z, r: r.yaw });
      this.decide(r, true);
      this.arriveIn = this.between(20, 50);
    }
  }

  /** 진짜 사람이 앉았거나 앉으러 오는 방석이면 비켜 준다. 내 바로 앞·뒤 자리에 있었어도 (내가 나중에 와 앉았으면) 옮긴다 */
  private yieldSeats(): void {
    const mine = this.opts.mySeat?.() ?? null;
    const inMyWay = new Set(mine ? sameColumn(mine) : []);
    for (const r of this.regulars.values()) {
      if (!r.seatId || !(this.opts.isSeatBlocked(r.seatId) || inMyWay.has(r.seatId))) continue;
      if (r.mode === 'seated') {
        this.standUp(r);
        this.goTo(r, { kind: 'spot', spot: this.pickSpot(r, false) });
      } else {
        // 앉으러 가던 길: 다른 곳으로
        r.seatId = null;
        this.decide(r, false);
      }
    }
  }

  private step(r: Regular, dt: number): void {
    // 몰아서 할 동작 (골 직후)
    while (r.queue.length && r.queue[0]!.at <= this.clock) {
      const q = r.queue.shift()!;
      if (r.mode !== 'walk') this.doAct(r, q.act);
    }
    r.stayLeft -= dt;
    if (r.mode === 'walk') {
      this.walk(r, dt);
      return;
    }
    if (r.mode === 'stand' && r.target.kind === 'spot') {
      r.yaw = turnToward(r.yaw, r.target.spot.facing, TURN_RATE * 0.6 * dt);
    }
    // 앉아서 주문
    if (r.mode === 'seated' && r.orderIn !== Infinity) {
      r.orderIn -= dt;
      if (r.orderIn <= 0) {
        r.orderIn = Infinity;
        this.tryOrder(r);
      }
    }
    r.actIn -= dt;
    if (r.actIn <= 0) {
      this.idleAct(r);
      r.actIn = this.actGap(r);
    }
    r.timer -= dt;
    if (r.timer <= 0) {
      if (r.mode === 'seated') this.standUp(r);
      this.decide(r, false);
    }
  }

  private walk(r: Regular, dt: number): void {
    if (r.pause > 0) {
      r.pause -= dt;
      if (r.pause <= 0) this.arrive(r);
      return;
    }
    let budget = STROLL * dt;
    while (budget > 0 && r.path.length) {
      const next = r.path[0]!;
      const dx = next.x - r.x;
      const dz = next.z - r.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-4) r.yaw = turnToward(r.yaw, Math.atan2(dx, dz), TURN_RATE * dt);
      if (d <= budget) {
        r.x = next.x;
        r.z = next.z;
        budget -= d;
        r.path.shift();
      } else {
        r.x += (dx / d) * budget;
        r.z += (dz / d) * budget;
        budget = 0;
      }
    }
    if (!r.path.length) {
      // 방석 앞에서는 잠깐 섰다가 앉는다. 나머지는 바로
      if (r.target.kind === 'seat') r.pause = SIT_PAUSE;
      else this.arrive(r);
    }
  }

  private arrive(r: Regular): void {
    const t = r.target;
    if (t.kind === 'leave') {
      this.regulars.delete(r.id);
      this.peers.remove(r.id);
      return;
    }
    if (t.kind === 'seat') {
      if (this.seatFree(t.seatId, r)) {
        this.sitDown(r, t.seatId, true);
      } else {
        r.seatId = null;
        this.decide(r, false);
      }
      return;
    }
    this.standAt(r, t.spot);
  }

  private sitDown(r: Regular, seatId: string, animate: boolean): void {
    r.mode = 'seated';
    r.seatId = seatId;
    r.target = { kind: 'seat', seatId };
    const live = this.live();
    r.timer = live ? this.between(70, 160) : this.between(35, 90);
    r.actIn = this.between(3, 8);
    // 앉으면 가끔 한 상 시킨다
    r.orderIn = this.rand() < (live ? 0.3 : 0.45) ? this.between(4, 10) : Infinity;
    if (animate) this.peers.setSeat(seatId, r.id);
  }

  private standUp(r: Regular): void {
    if (r.mode !== 'seated' || !r.seatId) return;
    const seat = this.seatManager.get(r.seatId);
    this.peers.setSeat(r.seatId, null);
    if (seat) {
      r.x = seat.x;
      r.z = seat.z;
      r.yaw = seat.facing;
    }
    r.seatId = null;
    r.mode = 'stand';
    r.orderIn = Infinity;
  }

  private standAt(r: Regular, spot: StandSpot): void {
    r.mode = 'stand';
    r.target = { kind: 'spot', spot };
    r.seatId = null;
    if (spot.counter) {
      // 주모 앞: 한 상 시키고 조금 있다 돌아간다
      r.timer = this.between(7, 11);
      r.actIn = 99;
      r.queue.push({ at: this.clock + 1.2, act: 'order?' });
    } else {
      r.timer = this.live() ? this.between(14, 35) : this.between(10, 25);
      r.actIn = this.between(1.5, 5);
    }
  }

  /** 다음 할 일: 앉기, 다른 데 서 보기, 주모 앞, 아니면 집에 가기 */
  private decide(r: Regular, justArrived: boolean): void {
    if (!justArrived && r.stayLeft <= 0) {
      this.leave(r);
      return;
    }
    const live = this.live();
    const wasSeated = r.target.kind === 'seat' && !justArrived;
    const roll = this.rand();
    let target: Target | null = null;
    if (justArrived || !wasSeated) {
      // 들어왔거나 서 있다가: 대개 앉는다 (경기 중이면 더)
      const sit = live ? 0.72 : 0.55;
      if (roll < sit) target = this.seatTarget(r);
      else if (roll < sit + 0.3 || !this.counterFree(r)) target = { kind: 'spot', spot: this.pickSpot(r, false) };
      else target = { kind: 'spot', spot: this.counter() };
    } else {
      // 앉아 있다가: 기지개 켜러 서 보거나, 주모 앞에 가거나, 자리를 옮긴다
      if (roll < 0.5) target = { kind: 'spot', spot: this.pickSpot(r, false) };
      else if (roll < 0.75 && this.counterFree(r)) target = { kind: 'spot', spot: this.counter() };
      else target = this.seatTarget(r);
    }
    this.goTo(r, target ?? { kind: 'spot', spot: this.pickSpot(r, false) });
  }

  private seatTarget(r: Regular): Target | null {
    const seatId = this.pickSeat(r);
    return seatId ? { kind: 'seat', seatId } : null;
  }

  private leave(r: Regular): void {
    if (r.mode === 'seated') this.standUp(r);
    const door = DOORS.reduce((best, d) => (Math.hypot(d.x - r.x, d.z - r.z) < Math.hypot(best.x - r.x, best.z - r.z) ? d : best));
    this.goTo(r, { kind: 'leave' }, door);
    this.arriveIn = Math.max(this.arriveIn, this.between(25, 60));
  }

  /** 길을 잡아 걷기 시작한다. 방석에서 일어났으면 평상 가장자리로 먼저 내려선다 */
  private goTo(r: Regular, target: Target, leaveTo?: Pt): void {
    const from: Pt = { x: r.x, z: r.z };
    const path: Pt[] = [];
    // 평상 위(방석)에 있으면 앉았던 줄 쪽 가장자리로 먼저 내려선다
    const sat = r.target.kind === 'seat' ? seatEntry(r.target.seatId) : null;
    let at = from;
    if (sat && Math.hypot(sat.x - from.x, sat.z - from.z) < 2.2 && groundHeight(from.x, from.z) > 0) {
      path.push(sat);
      at = sat;
    }
    let end: Pt;
    if (target.kind === 'seat') {
      end = seatEntry(target.seatId) ?? at;
      r.seatId = target.seatId;
    } else if (target.kind === 'spot') {
      end = target.spot;
      r.seatId = null;
    } else {
      end = leaveTo ?? DOORS[0]!;
      r.seatId = null;
    }
    path.push(...planPath(at, end));
    if (target.kind === 'seat') {
      const seat = this.seatManager.get(target.seatId);
      if (seat) path.push({ x: seat.x, z: seat.z });
    }
    r.target = target;
    r.path = path;
    r.mode = 'walk';
    r.pause = 0;
  }

  private seatFree(seatId: string, self: Regular | null): boolean {
    if (this.opts.isSeatBlocked(seatId)) return false;
    for (const o of this.regulars.values()) if (o !== self && o.seatId === seatId) return false;
    return this.peers.seatOwner(seatId) === null || this.peers.seatOwner(seatId) === self?.id;
  }

  /**
   * 내 평상에 단골이 아무도 없으면 대개 내 옆자리(같은 평상, 바로 옆 -> 같은 줄 -> 뒷줄 순)로.
   * 아니면 맨 앞 두 자리(새로 온 손님이 앉을 곳)는 비워 두고, 그다음 자리들 중에서. 없으면 아무 빈자리나.
   * 내 바로 앞자리(TV를 가린다)와 바로 뒷자리(내 뒤의 카메라를 가린다)에는 앉지 않는다
   */
  private pickSeat(r: Regular): string | null {
    const order = this.opts.seatOrder;
    const mine = this.opts.mySeat?.() ?? null;
    const avoid = new Set<string | null>([r.seatId, mine, ...(mine ? sameColumn(mine) : [])]);
    const ok = (id: string): boolean => !avoid.has(id) && this.seatFree(id, r);
    if (mine) {
      const platform = mine[0];
      const row = rowOf(mine);
      const someone = [...this.regulars.values()].some((o) => o !== r && o.seatId?.[0] === platform);
      const neighbors = order.filter((id) => id[0] === platform && ok(id));
      // 바로 옆(같은 줄 한 칸 옆)이 먼저다. 휴대폰 세로 화면에는 내 바로 옆까지만 보인다
      const col = (id: string): number => (Number(id.slice(1)) - 1) % 3;
      const sameRow = neighbors.filter((id) => rowOf(id) === row);
      const beside = sameRow.filter((id) => Math.abs(col(id) - col(mine)) === 1);
      const list = beside.length ? beside : sameRow.length ? sameRow : neighbors;
      if (list.length && (!someone || this.rand() < 0.2)) return list[Math.floor(this.rand() * list.length)]!;
    }
    const near = order.slice(2, 16).filter(ok);
    const pool = near.length ? near : order.filter(ok);
    if (!pool.length) return null;
    return pool[Math.floor(this.rand() * pool.length)]!;
  }

  private counter(): StandSpot {
    return STAND_SPOTS.find((s) => s.counter)!;
  }

  private counterFree(self: Regular): boolean {
    for (const o of this.regulars.values()) if (o !== self && o.target.kind === 'spot' && o.target.spot.counter) return false;
    return true;
  }

  /** 다른 단골이 서 있거나 가는 곳은 빼고 아무 데나 (지금 선 곳도 뺀다) */
  private pickSpot(self: Regular, counterOk: boolean): StandSpot {
    const taken = new Set<string>();
    for (const o of this.regulars.values()) if (o.target.kind === 'spot') taken.add(o.target.spot.id);
    if (self.target.kind === 'spot') taken.add(self.target.spot.id);
    const pool = STAND_SPOTS.filter((s) => (counterOk || !s.counter) && !taken.has(s.id));
    const list = pool.length ? pool : STAND_SPOTS.filter((s) => !s.counter);
    return list[Math.floor(this.rand() * list.length)]!;
  }

  private actGap(r: Regular): number {
    const live = this.live();
    if (r.mode === 'seated') return live ? this.between(6, 14) : this.between(14, 30);
    return live ? this.between(4, 9) : this.between(10, 22);
  }

  /** 가만히 있을 때의 응원: 경기 중이면 손뼉·건배·환호, 아니면 느긋하게 한 사발 */
  private idleAct(r: Regular): void {
    const roll = this.rand();
    if (this.live()) {
      if (roll < 0.4) this.doAct(r, 'clap');
      else if (roll < 0.6) this.doAct(r, 'toast');
      else this.peers.playMotion(r.id, roll < 0.8 ? 'hop-double' : 'roar');
    } else {
      if (roll < 0.45) this.doAct(r, 'toast');
      else if (roll < 0.6) this.doAct(r, 'clap');
      else if (roll < 0.7) this.peers.playMotion(r.id, 'hop');
    }
  }

  private tryOrder(r: Regular): void {
    if (this.clock - this.lastOrderAt < ORDER_GAP) return;
    this.lastOrderAt = this.clock;
    this.doAct(r, 'order', Math.floor(this.rand() * 8));
  }

  private doAct(r: Regular, act: string, variant?: number): void {
    if (act === 'order?') {
      this.tryOrder(r);
      return;
    }
    const motion = this.motions.get(act);
    if (motion) this.peers.playMotion(r.id, motion);
    this.opts.act(r.id, act, variant);
  }
}

/** 0 앞줄(1~3), 1 뒷줄(4~6) */
function rowOf(seatId: string): number {
  return Number(seatId.slice(1)) >= 4 ? 1 : 0;
}

/** 같은 평상에서 바로 앞이나 바로 뒤의 자리 (1과 4, 2와 5, 3과 6) */
function sameColumn(seatId: string): string[] {
  const index = Number(seatId.slice(1));
  if (!Number.isInteger(index) || index < 1 || index > 6) return [];
  return [`${seatId[0]}${index <= 3 ? index + 3 : index - 3}`];
}

function nameOf(name: string): LocalizedName {
  return { ko: `단골 ${name}` };
}

function turnToward(from: number, to: number, maxStep: number): number {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  if (Math.abs(delta) <= maxStep) return to;
  return from + Math.sign(delta) * maxStep;
}
