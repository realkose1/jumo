import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { JUMAK_NAMES } from '@shared/spaces/jumak-names';
import { buildSeats, groundHeight, seatPreferenceOrder } from '../spaces/jumak/layout';
import { seatEntry } from '../spaces/jumak/walkways';
import { MAX_REGULARS, MIN_REGULARS, Regulars } from './regulars';

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function setup(o: { peers?: number; live?: boolean; seed?: number; mine?: string } = {}) {
  const me = { seat: o.mine ?? null };
  const taken = new Set<string>();
  const seats = buildSeats();
  const order = seatPreferenceOrder(seats, () => 0.5);
  const blocked = new Set<string>();
  const acts: Array<{ t: number; id: number; act: string; v?: number }> = [];
  const state = { t: 0, peers: o.peers ?? 0, live: o.live ?? false };
  const r = new Regulars({
    scene: new THREE.Scene(),
    seats,
    outfit: 'plain',
    reducedMotion: false,
    seatOrder: order,
    actions: [
      { id: 'clap', motion: 'clap' },
      { id: 'toast', motion: 'toast' },
      { id: 'order', motion: 'roar' },
    ],
    isSeatBlocked: (id) => blocked.has(id) || id === me.seat,
    mySeat: () => me.seat,
    peerCount: () => state.peers,
    takenNames: () => taken,
    isLive: () => state.live,
    act: (id, act, v) => acts.push({ t: state.t, id, act, v }),
    random: seeded(o.seed ?? 7),
    now: () => state.t * 1000,
  });
  const run = (seconds: number, each?: () => void): void => {
    const dt = 1 / 30;
    for (let i = 0; i < seconds * 30; i++) {
      state.t += dt;
      r.update(dt);
      each?.();
    }
  };
  return { r, seats, order, blocked, acts, state, run, me, taken };
}

describe('단골손님', () => {
  it('처음에는 셋: 둘은 맨 앞 두 자리가 아닌 방석에 앉아 있고 하나는 서 있다. 이름은 손님 이름 목록에서', () => {
    const { r, order } = setup();
    r.start();
    expect(r.count).toBe(MAX_REGULARS);
    const states = r.ids().map((id) => r.stateOf(id)!);
    const seated = states.filter((s) => s.mode === 'seated');
    expect(seated).toHaveLength(2);
    for (const s of seated) expect(order.slice(0, 2)).not.toContain(s.seatId);
    expect(new Set(seated.map((s) => s.seatId)).size).toBe(2);
    expect(states.filter((s) => s.mode === 'stand')).toHaveLength(1);
    for (const id of r.ids()) {
      expect(id).toBeLessThan(0); // 서버 번호와 겹치지 않는다
      expect(JUMAK_NAMES).toContain(r.peers.nameOf(id)?.ko);
    }
    expect(new Set(r.ids().map((id) => r.peers.nameOf(id)?.ko)).size).toBe(r.count);
    // 그리는 쪽에도 앉아 있다
    for (const s of seated) expect(r.peers.seatOwner(s.seatId!)).not.toBeNull();
  });

  it('단골 하나는 내 평상 같은 줄 옆자리에 앉는다. 내 바로 앞(TV를 가린다)과 바로 뒤(카메라를 가린다)는 비워 둔다', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const front = setup({ mine: 'b1', seed });
      front.r.start();
      const onMine = front.r.ids().map((id) => front.r.stateOf(id)!.seatId).filter((id) => id?.[0] === 'b');
      expect(onMine).toContain('b2'); // 바로 옆
      expect(onMine).not.toContain('b1');
      const back = setup({ mine: 'b5', seed });
      back.r.start();
      back.run(300, () => {
        for (const id of back.r.ids()) expect(back.r.stateOf(id)!.seatId).not.toBe('b2');
      });
      front.run(300, () => {
        for (const id of front.r.ids()) expect(front.r.stateOf(id)!.seatId).not.toBe('b4');
      });
    }
  });

  it('내가 나중에 와서 단골 바로 앞자리에 앉으면, 뒤에 있던 단골이 자리를 옮긴다', () => {
    const { r, me, run } = setup({ seed: 9 });
    r.start();
    const sitter = r.ids().find((id) => r.stateOf(id)!.mode === 'seated')!;
    const seatId = r.stateOf(sitter)!.seatId!;
    const n = Number(seatId.slice(1));
    me.seat = `${seatId[0]}${n <= 3 ? n + 3 : n - 3}`;
    run(0.5);
    expect(r.stateOf(sitter)!.mode).toBe('walk');
    expect(r.stateOf(sitter)!.seatId).not.toBe(seatId);
  });

  it('진짜 사람이 그 방석에 앉으러 오면 일어나 비켜 준다', () => {
    const { r, blocked, run } = setup();
    r.start();
    const sitter = r.ids().find((id) => r.stateOf(id)!.mode === 'seated')!;
    const seatId = r.stateOf(sitter)!.seatId!;
    blocked.add(seatId);
    run(0.5);
    const s = r.stateOf(sitter)!;
    expect(s.mode).toBe('walk');
    expect(s.seatId).not.toBe(seatId);
    expect(r.peers.seatOwner(seatId)).toBeNull();
    // 그 뒤로도 누구도 그 자리에 앉지 않는다
    run(240);
    for (const id of r.ids()) expect(r.stateOf(id)!.seatId).not.toBe(seatId);
  });

  it('방 사람이 쓰는 이름은 피하고, 같은 이름의 손님이 들어오면 그 단골이 집에 간다', () => {
    const { r, taken, run } = setup();
    for (const n of JUMAK_NAMES.slice(0, JUMAK_NAMES.length - 6)) taken.add(n);
    r.start();
    for (const id of r.ids()) expect(taken.has(r.peers.nameOf(id)!.ko)).toBe(false);
    const twin = r.ids()[0]!;
    taken.add(r.peers.nameOf(twin)!.ko);
    run(3);
    expect(r.stateOf(twin)!.target).toBe('leave');
    run(120);
    expect(r.ids()).not.toContain(twin);
    expect(r.stayingCount).toBe(3);
    for (const id of r.ids()) expect(taken.has(r.peers.nameOf(id)!.ko)).toBe(false);
  });

  it('방이 붐비면 한 명은 집에 가고, 한가해지면 다른 단골이 들어온다', () => {
    const { r, state, run } = setup();
    r.start();
    const before = new Set(r.ids());
    state.peers = 8;
    run(5);
    expect(r.stayingCount).toBe(MIN_REGULARS);
    run(60);
    expect(r.count).toBe(MIN_REGULARS);
    state.peers = 1;
    run(70);
    expect(r.stayingCount).toBe(MAX_REGULARS);
    // 들어온 사람은 처음 셋과 다른 단골이다
    expect(r.ids().some((id) => !before.has(id))).toBe(true);
  });

  it('걸을 때 평상을 가로지르지 않는다 (앉고 일어설 때 방석 가까이만 오른다)', () => {
    const { r, seats, run } = setup({ seed: 11 });
    r.start();
    const near = (x: number, z: number): boolean =>
      seats.some((s) => {
        const e = seatEntry(s.id)!;
        // 방석과 그 방석에 올라서는 곳 사이의 짧은 길
        const t = Math.max(0, Math.min(1, ((x - e.x) * (s.x - e.x) + (z - e.z) * (s.z - e.z)) / ((s.x - e.x) ** 2 + (s.z - e.z) ** 2)));
        return Math.hypot(x - (e.x + (s.x - e.x) * t), z - (e.z + (s.z - e.z) * t)) < 0.15;
      });
    let walked = 0;
    let sat = 0;
    run(600, () => {
      for (const id of r.ids()) {
        const s = r.stateOf(id)!;
        if (s.mode === 'seated') sat += 1;
        if (s.mode !== 'walk') continue;
        walked += 1;
        if (groundHeight(s.x, s.z) > 0) expect(near(s.x, s.z)).toBe(true);
      }
    });
    expect(walked).toBeGreaterThan(300);
    expect(sat).toBeGreaterThan(300);
  });

  it('골이 나면 다들 손뼉 치고 사발을 든다', () => {
    const { r, acts, run } = setup({ live: true });
    r.start();
    run(1);
    acts.length = 0;
    r.cheer();
    run(6);
    const cheered = new Set(acts.filter((a) => a.act === 'clap' || a.act === 'toast').map((a) => a.id));
    // 걷던 사람은 빼도 둘 넘게는 응원한다
    expect(cheered.size).toBeGreaterThanOrEqual(2);
  });

  it('경기 중이면 더 자주 응원하고, 주문은 단골 다 합쳐 띄엄띄엄', () => {
    const quiet = setup({ live: false, seed: 3 });
    quiet.r.start();
    quiet.run(600);
    const live = setup({ live: true, seed: 3 });
    live.r.start();
    live.run(600);
    const cheers = (a: typeof quiet.acts) => a.filter((x) => x.act === 'clap').length;
    expect(cheers(live.acts)).toBeGreaterThan(cheers(quiet.acts));
    for (const s of [quiet, live]) {
      const orders = s.acts.filter((a) => a.act === 'order');
      for (let i = 1; i < orders.length; i++) expect(orders[i]!.t - orders[i - 1]!.t).toBeGreaterThanOrEqual(95);
      for (const o of orders) expect(o.v).toBeGreaterThanOrEqual(0);
    }
    expect(quiet.acts.some((a) => a.act === 'order')).toBe(true);
  });

  it('내가 근처에서 박수·건배하면 가까운 단골이 따라 하고, 먼 단골은 안 한다. 연타해도 한 번씩', () => {
    const { r, acts, run } = setup({ mine: 'b1', seed: 5 });
    r.start();
    run(0.2);
    const seated = r.ids().map((id) => ({ id, s: r.stateOf(id)! })).filter((x) => x.s.mode === 'seated');
    const me = { x: 1.89, z: -2.74 }; // b1
    const near = seated.filter((x) => Math.hypot(x.s.x - me.x, x.s.z - me.z) <= 4.5).map((x) => x.id);
    expect(near.length).toBeGreaterThanOrEqual(1);
    acts.length = 0;
    for (let i = 0; i < 5; i++) r.follow('toast', me); // 연타
    run(2);
    const toasts = acts.filter((a) => a.act === 'toast');
    for (const a of toasts) expect(near).toContain(a.id);
    expect(new Set(toasts.map((a) => a.id)).size).toBe(toasts.length);
    expect(toasts.length).toBeGreaterThanOrEqual(1);
    // 아주 먼 곳에서 하면 아무도 안 따라 한다
    acts.length = 0;
    run(4);
    acts.length = 0;
    r.follow('clap', { x: 0, z: 8.5 });
    run(2);
    expect(acts.filter((a) => a.act === 'clap')).toHaveLength(0);
  });

  it('내 주문은 가장 가까운 한 명만 따라 시키고, 25초 안에 다시 시켜도 따라 하지 않는다', () => {
    const { r, acts, run } = setup({ mine: 'b1', seed: 5 });
    r.start();
    run(0.2);
    const me = { x: 1.89, z: -2.74 };
    acts.length = 0;
    r.follow('order', me);
    run(5);
    r.follow('order', me);
    run(5);
    const orders = acts.filter((a) => a.act === 'order');
    expect(orders).toHaveLength(1);
  });

  it('혼자 하는 박수·건배는 띄엄띄엄: 경기 중에도 셋이 합쳐 10분에 마흔 번을 넘지 않는다', () => {
    const { r, acts, run } = setup({ live: true, seed: 3 });
    r.start();
    run(600);
    const n = acts.filter((a) => a.act === 'clap' || a.act === 'toast').length;
    expect(n).toBeGreaterThan(5);
    expect(n).toBeLessThan(40);
  });

  it('dispose하면 그린 것을 거둔다', () => {
    const { r } = setup();
    r.start();
    r.dispose();
    expect(r.count).toBe(0);
    expect(r.peers.count).toBe(0);
  });
});
