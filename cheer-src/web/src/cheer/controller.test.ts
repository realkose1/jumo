import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheerFeed, Moment } from '@shared/cheer';
import type { Engine } from '../engine/Engine';
import { buildSeats } from '../spaces/jumak/layout';
import type { UIHandle } from '../ui';
import { CheerController } from './controller';

type Handler = (payload: never) => void;

function makeEngine(opts: { ready?: boolean; status?: string; reduced?: boolean; taken?: string[]; jumoVisible?: boolean } = {}) {
  const handlers = new Map<string, Set<Handler>>();
  const log = {
    celebrate: [] as number[],
    sits: [] as string[],
    stage: [] as string[],
  };
  const stage = {
    sound: {
      action: vi.fn(),
      moment: vi.fn(),
      setLive: vi.fn(),
      dishDown: vi.fn(),
    },
    setView: vi.fn(),
    flashBanner: vi.fn(),
    setTally: vi.fn(),
    emojiBurst: vi.fn(),
    confetti: vi.fn(),
    glow: vi.fn(),
    setReducedMotion: vi.fn(),
    setRoomName: vi.fn(),
    serveDish: vi.fn(),
    jumoReply: vi.fn(),
    jumoAnchor: (out: { set(x: number, y: number, z: number): unknown }) => out.set(0, 1.6, 0),
  };
  const taken = new Set(opts.taken ?? []);
  const engine = {
    space: { seats: buildSeats() },
    clock: { getServerOffsetMs: () => 0 },
    isReady: () => opts.ready ?? true,
    getSceneApi: () => stage,
    getNetState: () => ({ status: opts.status ?? 'idle', room: null, name: null, id: 5, deniedCode: null }),
    getReducedMotion: () => opts.reduced ?? false,
    getQuality: () => ({ tier: 'high' }),
    getSeatId: () => null,
    getSpot: (who: unknown) => (who === 'self' ? { x: 0, z: -3, yaw: Math.PI, seatId: 'a3' } : { x: 1, z: -3, yaw: Math.PI, seatId: 'b2' }),
    projectToScreen: (_p: unknown, out: { x: number; y: number; visible: boolean }) => Object.assign(out, { x: 0, y: 0, visible: opts.jumoVisible ?? true }),
    getHeadAnchor: (_who: unknown, out: { set(x: number, y: number, z: number): unknown }) => out.set(1, 2, 3),
    celebrateAll: (d: number) => log.celebrate.push(d),
    isSeatTaken: (id: string) => taken.has(id),
    sitAtSeat: (id: string) => {
      log.sits.push(id);
      return true;
    },
    on: (type: string, fn: Handler) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(fn);
      return () => handlers.get(type)!.delete(fn);
    },
  };
  const emit = (type: string, payload?: unknown): void => {
    for (const fn of [...(handlers.get(type) ?? [])]) fn(payload as never);
  };
  return { engine: engine as unknown as Engine, emit, stage, log };
}

function makeUi() {
  const bubbles = { show: vi.fn(), clear: vi.fn(), dispose: vi.fn(), count: 0 };
  return { showNotice: vi.fn(), setHype: vi.fn(), setPeopleOverride: vi.fn(), bubbles, dispose: vi.fn() } satisfies UIHandle;
}

const moment = (over: Partial<Moment>): Moment => ({ id: `m-${Math.random()}`, kind: 'goal', match: 'x', at: Date.now(), text: '', ...over });

const feed: CheerFeed = {
  v: 1,
  now: Date.now(),
  matches: [
    {
      id: 'live1',
      sport: 'soccer',
      comp: '리그',
      home: { name: '홈', score: 1 },
      away: { name: '원정', score: 0 },
      side: 'home',
      state: 'live',
      clock: "10'",
      ko: Date.now() - 600_000,
      players: [],
    },
  ],
  next: null,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('CheerController: 경기 순간', () => {
  it('선수 골: 알림, TV 글, 소리, 같이 뛰기, 색종이, 불빛, 건배 버튼이 한꺼번에', () => {
    const { engine, emit, stage, log } = makeEngine();
    const ui = makeUi();
    const c = new CheerController({ engine, ui });
    c.start();
    emit('moment', moment({ kind: 'player-goal', player: '황희찬' }));
    expect(ui.showNotice).toHaveBeenCalledWith('황희찬 골! 다 같이 건배!', expect.any(Number), 'cheer');
    expect(stage.flashBanner).toHaveBeenCalledWith('황희찬 골!', 'goal', 6000);
    expect(stage.sound.moment).toHaveBeenCalledWith('goal');
    expect(log.celebrate).toHaveLength(1);
    expect(stage.confetti).toHaveBeenCalledWith(220);
    expect(stage.glow).toHaveBeenCalledWith(1);
    expect(ui.setHype).toHaveBeenCalledWith(true);
    // 10초 뒤에 건배 버튼이 가라앉는다
    vi.advanceTimersByTime(10_100);
    expect(ui.setHype).toHaveBeenLastCalledWith(false);
    c.dispose();
  });

  it('같은 순간이 두 번 와도 한 번만 반응한다', () => {
    const { engine, emit, stage } = makeEngine();
    const c = new CheerController({ engine, ui: makeUi() });
    c.start();
    const m = moment({ id: 'same', kind: 'goal' });
    emit('moment', m);
    emit('moment', m);
    expect(stage.sound.moment).toHaveBeenCalledTimes(1);
  });

  it('오래된 순간은 조용히 넘긴다 (늦게 들어온 사람)', () => {
    const { engine, emit, stage } = makeEngine();
    const ui = makeUi();
    new CheerController({ engine, ui }).start();
    emit('moment', moment({ at: Date.now() - 60_000 }));
    expect(stage.sound.moment).not.toHaveBeenCalled();
    expect(ui.showNotice).not.toHaveBeenCalled();
  });

  it('서버 시각이 조금 앞이면 그때까지 기다렸다 반응한다', () => {
    const { engine, emit, stage } = makeEngine();
    new CheerController({ engine, ui: makeUi() }).start();
    emit('moment', moment({ at: Date.now() + 800 }));
    expect(stage.sound.moment).not.toHaveBeenCalled();
    vi.advanceTimersByTime(900);
    expect(stage.sound.moment).toHaveBeenCalledTimes(1);
  });

  it('실점: 조용한 알림만, 뛰지도 색종이도 건배 버튼도 없다', () => {
    const { engine, emit, stage, log } = makeEngine();
    const ui = makeUi();
    new CheerController({ engine, ui }).start();
    emit('moment', moment({ kind: 'concede' }));
    expect(ui.showNotice).toHaveBeenCalledWith(expect.any(String), expect.any(Number), 'quiet');
    expect(stage.sound.moment).toHaveBeenCalledWith('concede');
    expect(log.celebrate).toHaveLength(0);
    expect(stage.confetti).not.toHaveBeenCalled();
    expect(ui.setHype).not.toHaveBeenCalledWith(true);
    expect(stage.flashBanner).not.toHaveBeenCalled();
  });

  it('경기 끝: 이기면 색종이, 비기거나 지면 없다', () => {
    const win = makeEngine();
    new CheerController({ engine: win.engine, ui: makeUi() }).start();
    win.emit('moment', moment({ kind: 'final', result: 'win' }));
    expect(win.stage.confetti).toHaveBeenCalled();
    const loss = makeEngine();
    new CheerController({ engine: loss.engine, ui: makeUi() }).start();
    loss.emit('moment', moment({ kind: 'final', result: 'loss' }));
    expect(loss.stage.confetti).not.toHaveBeenCalled();
    expect(loss.log.celebrate).toHaveLength(0);
  });

  it('움직임 줄이기: 색종이는 없고 알림과 소리는 그대로', () => {
    const { engine, emit, stage } = makeEngine({ reduced: true });
    const ui = makeUi();
    new CheerController({ engine, ui }).start();
    emit('moment', moment({ kind: 'goal' }));
    expect(stage.confetti).not.toHaveBeenCalled();
    expect(stage.sound.moment).toHaveBeenCalledWith('goal');
    expect(ui.setHype).toHaveBeenCalledWith(true);
  });

  it('킥오프: 북소리와 알림, 같이 뛰지는 않는다', () => {
    const { engine, emit, stage, log } = makeEngine();
    new CheerController({ engine, ui: makeUi() }).start();
    emit('moment', moment({ kind: 'kickoff' }));
    expect(stage.sound.moment).toHaveBeenCalledWith('kickoff');
    expect(log.celebrate).toHaveLength(0);
  });
});

describe('CheerController: 방금 낸 소리 합계', () => {
  it('골 직후 10초 동안 내 동작과 남의 동작을 모두 센다', () => {
    const { engine, emit, stage } = makeEngine();
    const c = new CheerController({ engine, ui: makeUi() });
    c.start();
    emit('moment', moment({ kind: 'goal' }));
    emit('action', { actionId: 'order', variant: 1 });
    emit('peer-act', { id: 7, act: 'order', v: 2 });
    emit('peer-act', { id: 8, act: 'clap' });
    vi.advanceTimersByTime(300);
    const last = stage.setTally.mock.calls.at(-1)![0] as { counts: Record<string, number>; phase: string };
    expect(last.phase).toBe('live');
    expect(last.counts).toEqual({ order: 2, clap: 1 });
  });

  it('합계 시간이 끝나면 TV의 합계 줄을 치운다', () => {
    const { engine, emit, stage } = makeEngine();
    new CheerController({ engine, ui: makeUi() }).start();
    emit('moment', moment({ kind: 'goal' }));
    vi.advanceTimersByTime(15_000);
    expect(stage.setTally).toHaveBeenLastCalledWith(null);
  });
});

describe('CheerController: 동작', () => {
  it('내 동작은 소리와 머리 위 이모지가 언제나 나온다', () => {
    const { engine, emit, stage } = makeEngine();
    new CheerController({ engine, ui: makeUi() }).start();
    for (let i = 0; i < 5; i++) emit('action', { actionId: 'clap' });
    expect(stage.sound.action).toHaveBeenCalledTimes(5);
    expect(stage.sound.action).toHaveBeenCalledWith('clap', 'self');
    expect(stage.emojiBurst).toHaveBeenCalledTimes(5);
  });

  it('남의 동작은 한꺼번에 몰려도 소리와 이모지를 조절한다', () => {
    const { engine, emit, stage } = makeEngine();
    new CheerController({ engine, ui: makeUi() }).start();
    for (let i = 0; i < 24; i++) emit('peer-act', { id: i, act: 'clap' });
    expect(stage.sound.action.mock.calls.length).toBeLessThanOrEqual(2);
    expect(stage.sound.action).toHaveBeenCalledWith('clap', 'peer');
    expect(stage.emojiBurst.mock.calls.length).toBeLessThanOrEqual(9);
    expect(stage.emojiBurst.mock.calls.length).toBeGreaterThan(0);
  });

  it('머리 위 좌표를 모르는 사람(막 나간 사람)은 이모지를 건너뛴다', () => {
    const { engine, emit, stage } = makeEngine();
    const c = new CheerController({ engine, ui: makeUi() });
    c.anchorOf = () => null;
    c.start();
    emit('peer-act', { id: 1, act: 'clap' });
    expect(stage.emojiBurst).not.toHaveBeenCalled();
  });
});

describe('CheerController: 주문', () => {
  it('내 주문: 말풍선에 메뉴 글, 1.2초 뒤 주모 대답, 그 뒤 음식이 내 방석 곁에', () => {
    const { engine, emit, stage } = makeEngine();
    const ui = makeUi();
    new CheerController({ engine, ui }).start();
    emit('action', { actionId: 'order', variant: 0 });
    expect(stage.sound.action).toHaveBeenCalledWith('order', 'self');
    expect(ui.bubbles.show).toHaveBeenCalledTimes(1);
    expect(ui.bubbles.show.mock.calls[0]![0]).toMatchObject({ key: 'order-self', kind: 'order', text: '주모! 여기 국밥 한 그릇 주쇼!' });
    expect(stage.emojiBurst).not.toHaveBeenCalled(); // 이모지 대신 말풍선
    vi.advanceTimersByTime(1250);
    expect(stage.jumoReply).toHaveBeenCalledTimes(1);
    expect(ui.bubbles.show).toHaveBeenCalledTimes(2);
    expect(ui.bubbles.show.mock.calls[1]![0]).toMatchObject({ key: 'jumo', kind: 'jumo' });
    expect(stage.serveDish).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(stage.serveDish).toHaveBeenCalledTimes(1);
    expect(stage.serveDish.mock.calls[0]![0]).toBe('gukbap');
    expect(stage.sound.dishDown).toHaveBeenCalledWith('self');
  });

  it('남의 주문도 같은 번호면 같은 글과 같은 음식', () => {
    const { engine, emit, stage } = makeEngine();
    const ui = makeUi();
    new CheerController({ engine, ui }).start();
    emit('peer-act', { id: 7, act: 'order', v: 3 });
    expect(ui.bubbles.show.mock.calls[0]![0]).toMatchObject({ key: 'order-7', text: '주모! 순대 한 접시요!' });
    vi.advanceTimersByTime(2000);
    expect(stage.serveDish.mock.calls[0]![0]).toBe('sundae');
  });

  it('주모가 화면 밖이면 내 주문의 대답을 알림 한 줄로도 알려 준다 (남의 주문에는 알림이 없다)', () => {
    const away = makeEngine({ jumoVisible: false });
    const ui = makeUi();
    new CheerController({ engine: away.engine, ui }).start();
    away.emit('peer-act', { id: 7, act: 'order', v: 1 });
    vi.advanceTimersByTime(2000);
    expect(ui.showNotice).not.toHaveBeenCalled();
    away.emit('action', { actionId: 'order', variant: 1 });
    vi.advanceTimersByTime(1300);
    expect(ui.showNotice).toHaveBeenCalledWith(expect.stringMatching(/^주모: /), expect.any(Number), 'quiet');
    const seen = makeEngine({ jumoVisible: true });
    const ui2 = makeUi();
    new CheerController({ engine: seen.engine, ui: ui2 }).start();
    seen.emit('action', { actionId: 'order', variant: 1 });
    vi.advanceTimersByTime(1300);
    expect(ui2.showNotice).not.toHaveBeenCalled();
  });

  it('24명이 한꺼번에 주문해도 남의 말풍선과 쿵 소리는 조절한다', () => {
    const { engine, emit, stage } = makeEngine();
    const ui = makeUi();
    new CheerController({ engine, ui }).start();
    for (let i = 1; i <= 24; i++) emit('peer-act', { id: i, act: 'order', v: i % 8 });
    expect(ui.bubbles.show.mock.calls.length).toBeLessThanOrEqual(3);
    vi.advanceTimersByTime(2500);
    expect(stage.serveDish).toHaveBeenCalledTimes(24); // 음식은 모두(무대가 8개까지만 둔다)
    expect(stage.sound.dishDown.mock.calls.length).toBeLessThanOrEqual(2);
    // 주모 말풍선은 연달아 오면 한 번만, 몸짓은 매번
    const jumoBubbles = ui.bubbles.show.mock.calls.filter((c) => (c[0] as { key: string }).key === 'jumo');
    expect(jumoBubbles.length).toBeLessThanOrEqual(2);
    expect(stage.jumoReply).toHaveBeenCalledTimes(24);
  });

  it('주문에는 알림(인사 알림)이 없다 — 인사는 건배만', () => {
    const { engine, emit } = makeEngine({ jumoVisible: true });
    const ui = makeUi();
    new CheerController({ engine, ui }).start();
    emit('peer-act', { id: 2, act: 'order', v: 0 });
    vi.advanceTimersByTime(3000);
    expect(ui.showNotice).not.toHaveBeenCalled();
  });
});

describe('CheerController: 간판 이름과 피드가 없을 때', () => {
  const live = (name: string): CheerFeed => ({
    v: 1,
    now: Date.now(),
    matches: [{ ...feed.matches[0]!, players: [{ name, side: 'home', g: 0 }] }],
    next: null,
  });

  it('피드가 오면 간판과 문서 제목 이름을 선수 이름으로 바꾼다 (바뀔 때만)', () => {
    const { engine, emit, stage } = makeEngine();
    const names: string[] = [];
    new CheerController({ engine, ui: makeUi(), onRoomName: (n) => names.push(n) }).start();
    emit('feed', live('이강인'));
    emit('feed', live('이강인'));
    emit('feed', live('황희찬'));
    expect(names).toEqual(['이강인 응원 주막', '황희찬 응원 주막']);
    expect(stage.setRoomName).toHaveBeenCalledTimes(2);
  });

  it('피드가 20초 안 오면 불러오는 중 대신 차분한 안내 카드', () => {
    const { engine, stage } = makeEngine();
    new CheerController({ engine, ui: makeUi() }).start();
    expect(stage.setView).toHaveBeenLastCalledWith({ kind: 'waiting' });
    vi.advanceTimersByTime(19_000);
    expect(stage.setView).toHaveBeenLastCalledWith({ kind: 'waiting' });
    vi.advanceTimersByTime(1_500);
    expect(stage.setView).toHaveBeenLastCalledWith({ kind: 'quiet', name: '주모 응원 주막' });
  });

  it('안내 카드 뒤에 피드가 오면 다시 정상', () => {
    const { engine, emit, stage } = makeEngine();
    new CheerController({ engine, ui: makeUi() }).start();
    vi.advanceTimersByTime(21_000);
    emit('feed', feed);
    expect(stage.setView).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'matches' }));
  });

  it('피드가 일찍 오면 안내 카드 타이머는 아무 일도 하지 않는다', () => {
    const { engine, emit, stage } = makeEngine();
    new CheerController({ engine, ui: makeUi() }).start();
    emit('feed', feed);
    stage.setView.mockClear();
    vi.advanceTimersByTime(30_000);
    expect(stage.setView).not.toHaveBeenCalled();
  });
});

describe('CheerController: 경기 피드', () => {
  it('피드가 오면 TV를 바꾸고, 진행 중이면 웅성거림이 활기차다', () => {
    const { engine, emit, stage } = makeEngine();
    new CheerController({ engine, ui: makeUi() }).start();
    emit('feed', feed);
    expect(stage.setView).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'matches' }));
    expect(stage.sound.setLive).toHaveBeenLastCalledWith(true);
    emit('feed', { ...feed, matches: [] });
    expect(stage.sound.setLive).toHaveBeenLastCalledWith(false);
  });

  it('장면이 준비되기 전에 온 피드는 준비되면 바로 그린다', () => {
    const made = makeEngine({ ready: false });
    const c = new CheerController({ engine: made.engine, ui: makeUi() });
    c.start();
    c.handleFeed(feed);
    expect(made.stage.setView).not.toHaveBeenCalled();
    made.emit('ready');
    expect(made.stage.setView).toHaveBeenCalledWith(expect.objectContaining({ kind: 'matches' }));
  });

  it('?m= 경기를 맨 앞에 둔다', () => {
    const { engine, emit, stage } = makeEngine();
    new CheerController({ engine, ui: makeUi(), focusMatchId: 'live2' }).start();
    const two: CheerFeed = { ...feed, matches: [{ ...feed.matches[0]!, id: 'live1' }, { ...feed.matches[0]!, id: 'live2', ko: Date.now() }] };
    emit('feed', two);
    const view = stage.setView.mock.calls.at(-1)![0] as { matches: Array<{ id: string }> };
    expect(view.matches[0]!.id).toBe('live2');
  });
});

describe('CheerController: 자동으로 앉기', () => {
  it('혼자 모드면 잠깐 뒤 TV 가까운 빈 방석으로 걸어간다', () => {
    const { engine, log } = makeEngine({ status: 'idle' });
    new CheerController({ engine, ui: makeUi() }).start();
    expect(log.sits).toHaveLength(0);
    vi.advanceTimersByTime(400);
    expect(log.sits).toHaveLength(1);
    expect(['a3', 'b1']).toContain(log.sits[0]);
  });

  it('서버가 방 사람들을 알려 준 직후에 앉는다 (이미 찬 자리는 피한다)', () => {
    const { engine, emit, log } = makeEngine({ status: 'connecting', taken: ['a3', 'b1'] });
    new CheerController({ engine, ui: makeUi() }).start();
    expect(log.sits).toHaveLength(0);
    emit('self-name', { name: { ko: '내 이름' } });
    expect(log.sits).toHaveLength(1);
    expect(['a3', 'b1']).not.toContain(log.sits[0]);
  });

  it('거절되면(그새 다른 사람이 앉음) 다음 자리로, 앉으면 끝', () => {
    const { engine, emit, log } = makeEngine({ status: 'idle' });
    new CheerController({ engine, ui: makeUi() }).start();
    vi.advanceTimersByTime(400);
    const first = log.sits[0]!;
    emit('seat-denied', { seatId: first, reason: 'taken' });
    expect(log.sits).toHaveLength(2);
    expect(log.sits[1]).not.toBe(first);
    emit('seat-change', { seatId: log.sits[1] });
    emit('seat-denied', { seatId: log.sits[1], reason: 'taken' });
    expect(log.sits).toHaveLength(2);
  });

  it('한 번만 시도한다 (사용자가 일어나 걸어간 뒤에 다시 앉히지 않는다)', () => {
    const { engine, emit, log } = makeEngine({ status: 'idle' });
    new CheerController({ engine, ui: makeUi() }).start();
    vi.advanceTimersByTime(400);
    emit('seat-change', { seatId: log.sits[0] });
    emit('seat-change', { seatId: null });
    emit('self-name', { name: { ko: 'x' } });
    vi.advanceTimersByTime(10_000);
    expect(log.sits).toHaveLength(1);
  });
});

describe('CheerController: 끝내기', () => {
  it('dispose하면 구독과 타이머를 모두 거둔다', () => {
    const { engine, emit, stage } = makeEngine();
    const ui = makeUi();
    const c = new CheerController({ engine, ui });
    c.start();
    emit('moment', moment({ kind: 'goal' }));
    c.dispose();
    stage.sound.moment.mockClear();
    emit('moment', moment({ kind: 'goal' }));
    expect(stage.sound.moment).not.toHaveBeenCalled();
    expect(ui.setHype).toHaveBeenLastCalledWith(false);
  });
});
