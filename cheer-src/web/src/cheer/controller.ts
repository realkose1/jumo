// 응원 주막의 마음: 서버가 주는 소식(경기 피드, 순간, 남의 동작)과 내 동작을
// 장면(TV, 이모지, 색종이, 소리)과 화면(알림, 버튼)에 이어 준다.
// 엔진은 공간 이름을 모르고, 이 컨트롤러가 주막 장면이 열어 준 기능(JumakStage)을 쓴다.
import * as THREE from 'three';
import type { CheerFeed, Moment } from '@shared/cheer';
import type { Engine } from '../engine/Engine';
import { dishSpot, seatPreferenceOrder } from '../spaces/jumak/layout';
import type { JumakStage } from '../spaces/jumak/stage';
import type { UIHandle } from '../ui';
import { AutoSeater } from './autoSeat';
import { buildTvView, hasLiveMatch } from './feed';
import { BudgetLimiter, RemoteCueLimiter } from './limiter';
import { HYPE_MS, MomentGate, momentDelayMs, planMoment, type MomentPlan } from './moments';
import { BUBBLE_MS, DISH_DELAY_MS, ORDER_REPLY_DELAY_MS, menuFor, pickReply } from './orders';
import { FALLBACK_ROOM_NAME, roomName } from './roomName';
import { ActionTally } from './tally';

export interface CheerControllerOptions {
  engine: Engine;
  ui: UIHandle;
  /** 주소의 ?m=<경기 id>: 이 경기를 TV 맨 앞에 크게 */
  focusMatchId?: string | null;
  /** 간판 이름("이강인 응원 주막")이 바뀌었다 (문서 제목 등에 쓴다) */
  onRoomName?: (name: string) => void;
}

/** 머리 위 좌표를 알려 주는 함수. 개발 데모는 가짜 사람들 것으로 바꿔 끼운다 */
export type AnchorProvider = (who: 'self' | number, out: THREE.Vector3) => THREE.Vector3 | null;

const BANNER_GOAL_MS = 6000;
const BANNER_INFO_MS = 4000;
const NOTICE_CHEER_MS = 6500;
const NOTICE_QUIET_MS = 5000;
/** 합계 줄을 다시 그릴 간격 */
const TALLY_TICK_MS = 250;
/** 서버가 응답하지 않아도 이만큼 지나면 혼자라도 자리에 앉는다 */
const AUTO_SEAT_FALLBACK_MS = 3000;
/** 자동 앉기가 이 시간 안에 끝나지 않으면 포기한다 */
const AUTO_SEAT_GIVE_UP_MS = 9000;
/** 피드가 이만큼 안 오면 '불러오는 중' 대신 차분한 안내 카드를 보여준다 */
export const NO_FEED_QUIET_MS = 20_000;
/** 주모 대답이 서로 겹치지 않게: 남의 주문에는 이 간격 안에 한 번만 말풍선 */
const JUMO_BUBBLE_GAP_MS = 1100;

export class CheerController {
  private readonly engine: Engine;
  private readonly ui: UIHandle;
  private readonly focus: string | null;
  private readonly tally = new ActionTally();
  private readonly gate = new MomentGate();
  private readonly limiter = new RemoteCueLimiter();
  private readonly head = new THREE.Vector3();
  private readonly jumoHead = new THREE.Vector3();
  /** 남의 주문 말풍선: 0.6초에 서넛까지 (24명이 한꺼번에 눌러도 화면이 말풍선으로 덮이지 않게) */
  private readonly remoteBubbles = new BudgetLimiter(3, 900);
  private readonly remoteDishDown = new BudgetLimiter(2, 500);
  private lastJumoBubble = -Infinity;
  private lastName = '';
  private noFeedTimer: number | undefined;
  private feedTimedOut = false;
  private readonly onRoomName: ((name: string) => void) | undefined;
  private readonly cleanups: Array<() => void> = [];
  private readonly timers = new Set<number>();

  private stage: JumakStage | null = null;
  private feed: CheerFeed | null = null;
  private seater: AutoSeater | null = null;
  private seatAttempted = false;
  private tallyTimer: number | undefined;
  private hypeTimer: number | undefined;
  private disposed = false;

  /** 머리 위 좌표. 기본은 엔진의 것 */
  anchorOf: AnchorProvider;
  /** 모두가 같이 신나게 뛴다. 기본은 엔진의 것 (개발 데모는 가짜 사람들도 뛰게 바꿔 끼운다) */
  celebrate: (maxDelay: number) => void;

  constructor(options: CheerControllerOptions) {
    this.engine = options.engine;
    this.ui = options.ui;
    this.focus = options.focusMatchId?.trim() ? options.focusMatchId.trim() : null;
    this.onRoomName = options.onRoomName;
    this.anchorOf = (who, out) => this.engine.getHeadAnchor(who, out);
    this.celebrate = (maxDelay) => this.engine.celebrateAll(maxDelay);
  }

  /** engine.start() 전에 부른다 (구독은 시작 전에 걸어야 놓치는 소식이 없다) */
  start(): void {
    const e = this.engine;
    this.cleanups.push(
      e.on('ready', () => this.onReady()),
      e.on('feed', (f) => this.handleFeed(f)),
      e.on('moment', (m) => this.handleMoment(m)),
      e.on('peer-act', ({ id, act, v }) => this.handlePeerAct(id, act, v)),
      e.on('action', (ev) => this.handleSelfAction(ev.actionId, ev.variant)),
      e.on('seat-change', ({ seatId }) => {
        if (seatId) this.seater?.onSeated();
      }),
      e.on('seat-denied', ({ seatId }) => this.seater?.onDenied(seatId)),
      // 서버가 방 사람들과 앉은 자리를 알려 준 직후가 앉기 좋은 때다
      e.on('self-name', () => this.startAutoSeat()),
      e.on('reduced-motion-change', ({ enabled }) => this.stage?.setReducedMotion(enabled)),
    );
    if (e.isReady()) this.onReady();
  }

  dispose(): void {
    this.disposed = true;
    for (const off of this.cleanups) off();
    this.cleanups.length = 0;
    for (const t of this.timers) window.clearTimeout(t);
    this.timers.clear();
    window.clearInterval(this.tallyTimer);
    window.clearTimeout(this.hypeTimer);
    window.clearTimeout(this.noFeedTimer);
    this.ui.bubbles.clear();
    this.ui.setHype(false);
  }

  // ---- 시작 ----

  private onReady(): void {
    if (this.disposed) return;
    this.stage = this.engine.getSceneApi<JumakStage>();
    if (!this.stage) return;
    this.stage.setReducedMotion(this.engine.getReducedMotion());
    this.applyFeed();
    // 피드가 한동안 안 오면(예: 피드 서버가 멈춤) 로딩 문구를 계속 보여주지 않는다
    if (!this.feed) {
      this.noFeedTimer = window.setTimeout(() => {
        if (this.feed) return;
        this.feedTimedOut = true;
        this.applyFeed();
      }, NO_FEED_QUIET_MS);
    }
    // 서버가 없거나(혼자 모드) 답이 늦으면 기다리지 않고 앉는다
    const { status } = this.engine.getNetState();
    if (status === 'online') this.startAutoSeat();
    else this.later(() => this.startAutoSeat(), status === 'connecting' ? AUTO_SEAT_FALLBACK_MS : 350);
  }

  private startAutoSeat(): void {
    if (this.disposed || this.seatAttempted || !this.stage || !this.engine.isReady()) return;
    if (this.engine.getSeatId()) return;
    this.seatAttempted = true;
    const order = seatPreferenceOrder(this.engine.space.seats);
    this.seater = new AutoSeater(order, {
      isSeatTaken: (id) => this.engine.isSeatTaken(id),
      sitAtSeat: (id) => this.engine.sitAtSeat(id),
    });
    this.seater.start();
    this.later(() => this.seater?.cancel(), AUTO_SEAT_GIVE_UP_MS);
  }

  // ---- 경기 피드 ----

  handleFeed(feed: CheerFeed): void {
    this.feed = feed;
    this.applyFeed();
  }

  /** 지금 간판 이름: 피드가 있으면 선수 이름으로, 없으면 기본 */
  get currentRoomName(): string {
    return this.feed ? roomName(this.feed, this.focus) : this.lastName || FALLBACK_ROOM_NAME;
  }

  private applyFeed(): void {
    if (!this.stage) return;
    if (!this.feed && this.feedTimedOut) {
      this.stage.setView({ kind: 'quiet', name: this.currentRoomName });
    } else {
      this.stage.setView(buildTvView(this.feed, this.focus));
    }
    this.stage.sound.setLive(hasLiveMatch(this.feed));
    if (this.feed) {
      const name = this.currentRoomName;
      if (name !== this.lastName) {
        this.lastName = name;
        this.stage.setRoomName(name);
        this.onRoomName?.(name);
      }
    }
  }

  // ---- 같이 모이는 순간 ----

  handleMoment(m: Moment): void {
    if (this.disposed) return;
    const serverNow = Date.now() + this.engine.clock.getServerOffsetMs();
    if (this.gate.check(m, serverNow) !== 'ok') return;
    const delay = momentDelayMs(m, serverNow);
    if (delay > 30) this.later(() => this.react(planMoment(m)), delay);
    else this.react(planMoment(m));
  }

  private react(plan: MomentPlan): void {
    if (this.disposed) return;
    const stage = this.stage;
    const reduced = this.engine.getReducedMotion();
    this.ui.showNotice(plan.headline, plan.tone === 'cheer' ? NOTICE_CHEER_MS : NOTICE_QUIET_MS, plan.tone === 'cheer' ? 'cheer' : 'quiet');
    if (!stage) return;

    stage.sound.moment(plan.sound);
    if (plan.banner) stage.flashBanner(plan.banner.text, plan.banner.tone, plan.banner.tone === 'goal' ? BANNER_GOAL_MS : BANNER_INFO_MS);
    if (plan.celebrate) this.celebrate(0.18);
    // 다른 탭이나 앱 밖에 가 있는 동안에는 색종이를 터뜨려 봐야 아무도 못 본다
    const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
    if (plan.confetti && !reduced && visible) stage.confetti(this.engine.getQuality().tier === 'low' ? 110 : 220);
    stage.glow(plan.kind === 'goal' || plan.kind === 'player-goal' ? 1 : plan.kind === 'concede' ? 0 : 0.55);
    if (plan.hype) this.startHype();
  }

  private startHype(): void {
    this.tally.start(performance.now());
    this.ui.setHype(true);
    window.clearTimeout(this.hypeTimer);
    this.hypeTimer = window.setTimeout(() => this.ui.setHype(false), HYPE_MS);
    window.clearInterval(this.tallyTimer);
    const tick = (): void => {
      const snap = this.tally.snapshot(performance.now());
      this.stage?.setTally(snap.phase === 'off' ? null : snap);
      if (snap.phase === 'off') window.clearInterval(this.tallyTimer);
    };
    tick();
    this.tallyTimer = window.setInterval(tick, TALLY_TICK_MS);
  }

  // ---- 동작 ----

  /** 내 동작: 언제나 보이고 들린다 */
  handleSelfAction(actionId: string, variant?: number): void {
    this.tally.add(actionId, performance.now());
    const stage = this.stage;
    if (!stage) return;
    stage.sound.action(actionId, 'self');
    if (actionId === 'order') {
      this.order('self', this.engine.getNetState().id ?? 0, variant);
      return;
    }
    const at = this.anchorOf('self', this.head);
    if (at) stage.emojiBurst(actionId, at, 1.1);
  }

  /** 남의 동작: 합계에는 모두 세고, 소리와 이모지는 조절 장치를 거친다 */
  handlePeerAct(id: number, actionId: string, variant?: number): void {
    const now = performance.now();
    this.tally.add(actionId, now);
    const stage = this.stage;
    if (!stage) return;
    if (this.limiter.allowSound(actionId, now)) stage.sound.action(actionId, 'peer');
    if (actionId === 'order') {
      this.order(id, id, variant);
      return;
    }
    if (!this.limiter.allowEmoji(now)) return;
    const at = this.anchorOf(id, this.head);
    if (at) stage.emojiBurst(actionId, at, 0.9);
  }

  // ---- 주문: 말풍선 -> 주모 대답 -> 음식 ----

  /**
   * who: 'self' 또는 사람 번호, senderId: 주문한 사람 번호(내 번호를 모르면 0), v: 메뉴 번호.
   * 같은 (번호, v)면 방 모두가 같은 글과 같은 음식과 같은 주모 대답을 본다.
   */
  private order(who: 'self' | number, senderId: number, v: number | undefined): void {
    const stage = this.stage;
    if (!stage) return;
    const now = performance.now();
    const item = menuFor(v);
    const mine = who === 'self';
    // 말풍선: 내 것은 언제나, 남의 것은 한꺼번에 몰리면 줄인다
    if (mine || this.remoteBubbles.take(now)) {
      this.ui.bubbles.show({
        key: `order-${mine ? 'self' : senderId}`,
        text: item.line,
        kind: 'order',
        anchor: (out) => this.anchorOf(who, out),
        ms: BUBBLE_MS,
      });
    }
    // 주모가 대답하고, 이어서 음식이 나온다
    this.later(() => this.jumoReply(mine, pickReply(item, senderId, v)), ORDER_REPLY_DELAY_MS);
    this.later(() => this.serve(who, item.dish), DISH_DELAY_MS);
  }

  private jumoReply(mine: boolean, reply: string): void {
    const stage = this.stage;
    if (!stage) return;
    stage.jumoReply();
    const now = performance.now();
    // 남의 주문 대답이 연달아 오면 말풍선은 건너뛴다 (몸짓은 한다)
    if (!mine && now - this.lastJumoBubble < JUMO_BUBBLE_GAP_MS) return;
    this.lastJumoBubble = now;
    this.ui.bubbles.show({
      key: 'jumo',
      text: reply,
      kind: 'jumo',
      anchor: (out) => stage.jumoAnchor(out),
      ms: BUBBLE_MS,
    });
    // 주모가 화면 밖(옆 벽 쪽)이면 내 주문의 대답만 알림 한 줄로도 알려 준다
    if (mine) {
      const view = this.engine.projectToScreen(stage.jumoAnchor(this.jumoHead), { x: 0, y: 0, visible: false });
      if (!view.visible) this.ui.showNotice(`주모: ${reply}`, 2800, 'quiet');
    }
  }

  private serve(who: 'self' | number, dish: string): void {
    const stage = this.stage;
    if (!stage) return;
    const spot = this.engine.getSpot(who) ?? this.spotOf?.(who) ?? null;
    if (!spot) return;
    stage.serveDish(dish, dishSpot(spot));
    if (who === 'self' || this.remoteDishDown.take(performance.now())) stage.sound.dishDown(who === 'self' ? 'self' : 'peer');
  }

  /** 서 있는 곳과 앉은 자리. 기본은 엔진의 것 (개발 데모는 가짜 사람들 것으로 바꿔 끼운다) */
  spotOf: ((who: 'self' | number) => { x: number; z: number; yaw: number; seatId: string | null } | null) | undefined;

  private later(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
  }
}
