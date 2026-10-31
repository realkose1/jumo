import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as K from './kitchen';
import { mulberry32 } from './music';

describe('가마솥 보글거림', () => {
  it('방울은 하나에서 넷, 시간 순이고, 낮은 소리에서 짧게 솟아오른다', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { bubbles, next } = K.simmerBurst(mulberry32(seed));
      expect(bubbles.length).toBeGreaterThanOrEqual(1);
      expect(bubbles.length).toBeLessThanOrEqual(4);
      let prev = -1;
      for (const b of bubbles) {
        expect(b.at).toBeGreaterThan(prev);
        prev = b.at;
        expect(b.freq).toBeGreaterThanOrEqual(K.BUBBLE_RANGE.low);
        expect(b.freq).toBeLessThanOrEqual(K.BUBBLE_RANGE.high);
        expect(b.rise).toBeGreaterThan(1);
        expect(b.dur).toBeGreaterThan(0);
        expect(b.dur).toBeLessThan(0.25);
        expect(b.vel).toBeGreaterThan(0);
        expect(b.vel).toBeLessThanOrEqual(1);
      }
      expect(next).toBeGreaterThan(prev);
      expect(next).toBeLessThan(prev + 4);
    }
  });

  it('대개 1초에 두어 번 보글거린다: 너무 촘촘하지도 드물지도 않다', () => {
    const rand = mulberry32(5);
    let t = 0;
    let count = 0;
    while (t < 600) {
      const { bubbles, next } = K.simmerBurst(rand);
      count += bubbles.length;
      t += next;
    }
    const perSecond = count / t;
    expect(perSecond).toBeGreaterThan(1);
    expect(perSecond).toBeLessThan(4);
  });
});

describe('장작 타닥', () => {
  it('한 번에서 세 번, 아주 짧고, 드문드문하다', () => {
    const rand = mulberry32(11);
    let t = 0;
    let count = 0;
    while (t < 600) {
      const { hits, next } = K.fireCrackles(rand);
      expect(hits.length).toBeGreaterThanOrEqual(1);
      expect(hits.length).toBeLessThanOrEqual(3);
      for (const h of hits) {
        expect(h.dur).toBeLessThan(0.02);
        expect(h.vel).toBeGreaterThan(0);
        expect(h.vel).toBeLessThanOrEqual(1);
      }
      expect(next).toBeGreaterThan(hits[hits.length - 1]!.at);
      count += hits.length;
      t += next;
    }
    expect(count / t).toBeGreaterThan(0.3);
    expect(count / t).toBeLessThan(1.5);
  });
});

describe('번철에 전 부치기', () => {
  it('새 전은 한산할 땐 20~40초, 경기 중엔 13~26초마다', () => {
    const rand = mulberry32(3);
    for (let i = 0; i < 500; i++) {
      const calm = K.fryGap(rand, 0);
      expect(calm).toBeGreaterThanOrEqual(20);
      expect(calm).toBeLessThanOrEqual(40);
      const live = K.fryGap(rand, 1);
      expect(live).toBeGreaterThanOrEqual(13);
      expect(live).toBeLessThanOrEqual(26);
    }
  });

  it('한 장: 올리며 시작하고, 뒤집기는 몇 초 뒤 작게, 다음 전은 튀던 기름이 잦아든 뒤에', () => {
    let flips = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const b = K.fryBatch(mulberry32(seed), seed % 2);
      expect(b.fries[0]).toEqual({ at: 0, kind: 'lay', burst: K.LAY_BURST });
      expect(b.fries.length).toBeLessThanOrEqual(2);
      const flip = b.fries[1];
      if (flip) {
        flips++;
        expect(flip.kind).toBe('flip');
        expect(flip.at).toBeGreaterThanOrEqual(6);
        expect(flip.at).toBeLessThanOrEqual(11);
        expect(flip.burst).toBeLessThan(K.LAY_BURST);
      }
      let prev = 0;
      for (const p of b.pops) {
        expect(p).toBeGreaterThanOrEqual(prev);
        prev = p;
      }
      expect(b.next).toBeGreaterThanOrEqual(prev + 2);
      expect(b.next).toBeGreaterThanOrEqual(13);
    }
    // 반쯤은 뒤집는다
    expect(flips).toBeGreaterThan(120);
    expect(flips).toBeLessThan(240);
  });

  it('치익 한 뒤 기름 튀는 소리는 처음에 촘촘하고 점점 드물어진다', () => {
    let early = 0;
    let late = 0;
    for (let seed = 1; seed <= 200; seed++) {
      for (const p of K.fryPops(mulberry32(seed), 6)) {
        if (p < 2) early++;
        else if (p >= 4 && p < 6) late++;
      }
    }
    expect(early).toBeGreaterThan(late * 2);
    expect(late).toBeGreaterThan(0);
  });

  it('경기 중엔 전을 더 자주 부친다', () => {
    const count = (live: number): number => {
      const rand = mulberry32(21);
      let t = 0;
      let n = 0;
      while (t < 1200) {
        t += K.fryBatch(rand, live).next;
        n++;
      }
      return n;
    };
    expect(count(1)).toBeGreaterThan(count(0) * 1.2);
  });

  it('다 익어 갈 때 튀는 기름은 드물고, 경기 중엔 조금 잦다', () => {
    const mean = (live: number): number => {
      const rand = mulberry32(8);
      let sum = 0;
      for (let i = 0; i < 2000; i++) sum += K.idlePopGap(rand, live);
      return sum / 2000;
    };
    expect(mean(0)).toBeGreaterThan(1);
    expect(mean(1)).toBeLessThan(mean(0));
  });
});

describe('부엌일', () => {
  it('같은 일이 잇따르지 않고, 세 가지가 모두 나온다', () => {
    const rand = mulberry32(17);
    const seen = new Set<K.Chore>();
    let last: K.Chore | null = null;
    for (let i = 0; i < 300; i++) {
      const c = K.nextChore(rand, last, i % 3 === 0 ? 1 : 0);
      expect(c).not.toBe(last);
      seen.add(c);
      last = c;
    }
    expect([...seen].sort()).toEqual([...K.CHORES].sort());
  });

  it('부엌일 사이는 길고(한산할 때 11~25초), 경기 중엔 조금 짧다(8~18초)', () => {
    const rand = mulberry32(2);
    for (let i = 0; i < 500; i++) {
      const calm = K.choreGap(rand, 0);
      expect(calm).toBeGreaterThanOrEqual(11);
      expect(calm).toBeLessThanOrEqual(25);
      const live = K.choreGap(rand, 1);
      expect(live).toBeGreaterThanOrEqual(8);
      expect(live).toBeLessThanOrEqual(18);
    }
  });

  it('칼질: 네 번에서 아홉 번 고르게 탁탁, 끝이 약해진다', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const taps = K.chopPattern(mulberry32(seed));
      expect(taps.length).toBeGreaterThanOrEqual(4);
      expect(taps.length).toBeLessThanOrEqual(9);
      expect(taps[0]!.at).toBe(0);
      for (let i = 1; i < taps.length; i++) {
        const gap = taps[i]!.at - taps[i - 1]!.at;
        expect(gap).toBeGreaterThan(0.1);
        expect(gap).toBeLessThan(0.23);
      }
      for (const tap of taps) expect(tap.vel).toBeLessThanOrEqual(1);
      expect(taps[taps.length - 1]!.vel).toBeLessThan(0.71);
    }
  });

  it('국자: 두세 번 똑똑, 뒤로 갈수록 약하다', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const taps = K.ladleTaps(mulberry32(seed));
      expect(taps.length).toBeGreaterThanOrEqual(2);
      expect(taps.length).toBeLessThanOrEqual(3);
      for (let i = 1; i < taps.length; i++) {
        expect(taps[i]!.at).toBeGreaterThan(taps[i - 1]!.at);
        expect(taps[i]!.vel).toBeLessThan(taps[i - 1]!.vel);
      }
    }
  });
});

describe('지글 알갱이 곡선', () => {
  it('문턱 아래와 천장 위는 0, 사이만 남고, 양쪽이 대칭이며 -1~1 안이다', () => {
    const size = 4096;
    const { threshold, ceiling, power } = K.SIZZLE_CURVE;
    const c = K.crackleCurve(size, threshold, ceiling, power);
    expect(c[0]).toBeCloseTo(-1, 5);
    expect(c[size - 1]).toBeCloseTo(1, 5);
    expect(c[size >> 1]).toBe(0);
    let kept = 0;
    for (let i = 0; i < size; i++) {
      expect(Math.abs(c[i]!)).toBeLessThanOrEqual(1);
      expect(c[i]!).toBeCloseTo(-c[size - 1 - i]!, 6);
      if (c[i] !== 0) kept++;
    }
    // 남는 몫이 문턱이 정한 만큼(2%)
    expect(kept / size).toBeCloseTo(1 - threshold, 2);
  });

  it('치익 갈래는 늘 나는 지글거림과 다른 값만 남겨서, 두 갈래의 알갱이가 같은 순간에 겹치지 않는다', () => {
    const size = 4096;
    const s = K.crackleCurve(size, K.SIZZLE_CURVE.threshold, K.SIZZLE_CURVE.ceiling, K.SIZZLE_CURVE.power);
    const f = K.crackleCurve(size, K.FIZZ_CURVE.threshold, K.FIZZ_CURVE.ceiling, K.FIZZ_CURVE.power);
    let fizzKept = 0;
    for (let i = 0; i < size; i++) {
      expect(s[i] !== 0 && f[i] !== 0).toBe(false);
      if (f[i] !== 0) fizzKept++;
    }
    // 치익이 훨씬 촘촘하다
    expect(fizzKept).toBeGreaterThan(2 * s.filter((v) => v !== 0).length);
  });
});

describe('동시 소리 수 제한', () => {
  it('겹치는 소리가 상한에 닿으면 버리고, 겹치지 않거나 끝난 뒤에는 다시 받는다', () => {
    const claim = K.voiceLimiter(3);
    expect(claim(0, 0.1, 0.5)).toBe(true);
    expect(claim(0, 0.2, 0.5)).toBe(true);
    expect(claim(0, 0.3, 0.5)).toBe(true);
    expect(claim(0, 0.35, 0.1)).toBe(false);
    // 앞의 소리가 다 끝난 뒤에 울릴 소리는 받는다
    expect(claim(0, 1, 0.1)).toBe(true);
    // 시간이 흘러 앞의 셋이 끝났다. 1초에 울릴 소리와 겹치는 둘을 더 받고, 넷째는 버린다
    expect(claim(0.9, 0.9, 0.3)).toBe(true);
    expect(claim(0.9, 0.92, 0.3)).toBe(true);
    expect(claim(0.9, 0.95, 0.3)).toBe(false);
  });
});

// ---- 소리 장치 흉내: 시작과 끝, 시각, 연결, 끊기만 본다 ----

class Param {
  value = 0;
  readonly times: number[] = [];
  readonly targets: Array<{ v: number; t: number; tau: number }> = [];
  setValueAtTime(v: number, t: number): void {
    this.value = v;
    this.times.push(t);
  }
  linearRampToValueAtTime(v: number, t: number): void {
    this.value = v;
    this.times.push(t);
  }
  exponentialRampToValueAtTime(v: number, t: number): void {
    expect(v).toBeGreaterThan(0); // 지수 변화는 0으로 갈 수 없다
    this.value = v;
    this.times.push(t);
  }
  setTargetAtTime(v: number, t: number, tau: number): void {
    expect(tau).toBeGreaterThan(0);
    this.value = v;
    this.times.push(t);
    this.targets.push({ v, t, tau });
  }
  cancelScheduledValues(t: number): void {
    this.times.push(t);
  }
}

class FakeNode {
  gain = new Param();
  frequency = new Param();
  detune = new Param();
  Q = new Param();
  type = '';
  buffer: unknown = null;
  curve: Float32Array | null = null;
  startedAt: number | null = null;
  offset = 0;
  stoppedAt: number | null = null;
  disconnected = false;
  readonly outputs: FakeNode[] = [];
  constructor(readonly kind: string) {}
  connect(n: FakeNode): FakeNode {
    this.outputs.push(n);
    return n;
  }
  disconnect(): void {
    this.disconnected = true;
  }
  start(t = 0, offset = 0): void {
    this.startedAt = t;
    this.offset = offset;
  }
  stop(t = 0): void {
    this.stoppedAt = t;
  }
}

class FakeCtx {
  sampleRate = 8000;
  currentTime = 0;
  state = 'running';
  readonly nodes: FakeNode[] = [];
  private make = (kind: string) => () => {
    const n = new FakeNode(kind);
    this.nodes.push(n);
    return n;
  };
  createGain = this.make('gain');
  createBiquadFilter = this.make('filter');
  createWaveShaper = this.make('shaper');
  createBufferSource = this.make('buffer');
  createOscillator = this.make('osc');
  createBuffer = (_ch: number, length: number) => ({ length, getChannelData: () => new Float32Array(length) });
  sources(): FakeNode[] {
    return this.nodes.filter((n) => n.kind === 'osc' || n.kind === 'buffer');
  }
  /** 바탕 잡음 조각: 걸러지지 않고 곧장 바탕 입구(gain)로 들어가는 잡음 */
  bedSegments(): FakeNode[] {
    return this.nodes.filter((n) => n.kind === 'buffer' && n.outputs[0]?.kind === 'gain');
  }
  /** 번철 치익(새 전 올리기) 횟수: 치익 갈래가 LAY_BURST 크기로 솟은 수 */
  lays(): number {
    const top = K.FIZZ_LEVEL * K.LAY_BURST;
    return this.nodes.reduce((sum, n) => sum + n.gain.targets.filter((x) => x.v === top).length, 0);
  }
}

const asCtx = (c: FakeCtx) => c as unknown as BaseAudioContext;
const asOut = (n: FakeNode) => n as unknown as AudioNode;

describe('부엌 소리 재료', () => {
  const rand = () => 0.5;
  const play = (fn: (ctx: BaseAudioContext, out: AudioNode) => void): FakeCtx => {
    const ctx = new FakeCtx();
    fn(asCtx(ctx), asOut(new FakeNode('out')));
    const src = ctx.sources();
    expect(src.length).toBeGreaterThan(0);
    for (const s of src) {
      expect(s.startedAt, `${s.kind} 시작`).not.toBeNull();
      expect(s.stoppedAt, `${s.kind} 끝 (안 끝나는 소리는 새어 나간다)`).not.toBeNull();
      expect(s.stoppedAt!).toBeGreaterThan(s.startedAt!);
      for (const p of [s.gain, s.frequency, s.detune, s.Q]) for (const t of p.times) expect(Number.isFinite(t)).toBe(true);
    }
    return ctx;
  };

  it('보글, 타닥, 톡, 철퍽, 뒤집기, 똑, 탁 모두 끝이 있는 소리다', () => {
    const b: K.Bubble = { at: 0, freq: 200, rise: 1.6, dur: 0.08, vel: 0.8, pop: true };
    const withPop = play((c, o) => K.bubble(c, o, 0.01, b, 1, rand));
    const noPop = play((c, o) => K.bubble(c, o, 0.01, { ...b, pop: false }, 1, rand));
    expect(withPop.sources().length).toBeGreaterThan(noPop.sources().length);
    play((c, o) => K.fireCrackle(c, o, 0.01, { at: 0, freq: 2000, dur: 0.01, vel: 1 }, 1, rand));
    play((c, o) => K.oilPop(c, o, 0.01, 1, 1, rand));
    play((c, o) => K.batterDown(c, o, 0.01, 1, rand));
    play((c, o) => K.spatulaFlip(c, o, 0.01, 1, rand));
    play((c, o) => K.ladleTap(c, o, 0.01, 1, 1, rand));
    play((c, o) => K.knifeChop(c, o, 0.01, 1, 1, rand));
  });

  it('크기 배율이 0에 가까워도 오류 없이 지나간다', () => {
    play((c, o) => K.oilPop(c, o, 0.01, 0.001, 0.001, rand));
    play((c, o) => K.knifeChop(c, o, 0.01, 0.001, 0.001, rand));
  });
});

describe('부엌 소리 예약기', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const start = (seed = 1234) => {
    const ctx = new FakeCtx();
    const kitchen = K.startKitchen(asCtx(ctx), asOut(new FakeNode('out')), seed);
    return { ctx, kitchen };
  };

  const advance = (ctx: FakeCtx, seconds: number) => {
    for (let i = 0; i < seconds * 4; i++) {
      ctx.currentTime += 0.25;
      vi.advanceTimersByTime(250);
    }
  };

  it('켜면 바탕 잡음이 빈틈없이 이어지고, 짧은 소리를 앞서 예약하며, 모든 소리에 끝이 있다', () => {
    const { ctx, kitchen } = start();
    advance(ctx, 30);
    const src = ctx.sources();
    expect(src.length).toBeGreaterThan(60);
    for (const s of src) {
      expect(s.startedAt).not.toBeNull();
      expect(s.stoppedAt!).toBeGreaterThan(s.startedAt!);
      // 앞을 내다보는 만큼보다 멀리 예약하지 않는다
      expect(s.startedAt!).toBeLessThanOrEqual(ctx.currentTime + K.KITCHEN_LOOKAHEAD + 0.05);
    }
    // 바탕 잡음은 조각이 끝나는 바로 그때 다음 조각이 시작한다(틈도 겹침도 없다)
    const bed = ctx.bedSegments().sort((a, b) => a.startedAt! - b.startedAt!);
    expect(bed.length).toBeGreaterThan(15);
    for (let i = 1; i < bed.length; i++) expect(bed[i]!.startedAt!).toBeCloseTo(bed[i - 1]!.stoppedAt!, 9);
    expect(bed[bed.length - 1]!.stoppedAt!).toBeGreaterThanOrEqual(ctx.currentTime + K.KITCHEN_LOOKAHEAD);
    // 조각은 2초짜리 잡음 안에서 아무 데서나 잘라 온다(같은 조각이 되풀이되지 않게)
    const offsets = new Set(bed.map((s) => s.offset.toFixed(3)));
    expect(offsets.size).toBeGreaterThan(bed.length * 0.8);
    for (const s of bed) expect(s.offset + (s.stoppedAt! - s.startedAt!)).toBeLessThanOrEqual(2 + 1e-9);
    // 파도처럼 천천히 일렁이게 하는 것이 없다: 크기나 높이를 흔드는 LFO가 없고, 오래 도는 발진기도 없다
    expect(ctx.nodes.every((n) => n.outputs.every((o) => o instanceof FakeNode))).toBe(true);
    for (const s of ctx.sources()) expect(s.stoppedAt! - s.startedAt!).toBeLessThan(2);
    kitchen.stop();
  });

  it('20~40초마다 새 전을 올리면 치익 솟았다 가라앉고, 경기 중엔 더 자주 부친다', () => {
    const calm = start(99);
    advance(calm.ctx, 240);
    const calmLays = calm.ctx.lays();
    expect(calmLays).toBeGreaterThanOrEqual(5);
    expect(calmLays).toBeLessThanOrEqual(13);
    // 솟을 때마다 천천히 가라앉는 변화가 따라붙는다
    const fizz = calm.ctx.nodes.find((n) => n.gain.targets.some((x) => x.v === K.FIZZ_LEVEL * K.LAY_BURST))!;
    const rises = fizz.gain.targets.filter((x) => x.v > 0);
    const settles = fizz.gain.targets.filter((x) => x.v === 0 && x.tau === K.FRY_SETTLE);
    expect(settles.length).toBe(rises.length);
    for (const r of rises) expect(r.tau).toBeLessThan(0.1); // 빨리 솟는다(파도처럼 천천히 부풀지 않는다)
    calm.kitchen.stop();

    const live = start(99);
    live.kitchen.setIntensity(1);
    advance(live.ctx, 240);
    expect(live.ctx.lays()).toBeGreaterThan(calmLays);
    live.kitchen.stop();
  });

  it('번철 소리(지글거림, 치익, 철퍽, 뒤집기, 기름 톡)는 한 갈래로 묶여 GRIDDLE_LEVEL만큼 작다', () => {
    const { ctx, kitchen } = start(7);
    advance(ctx, 120);
    expect(K.GRIDDLE_LEVEL).toBeLessThan(0.5);
    const griddle = ctx.nodes.find((n) => n.kind === 'gain' && n.gain.value === K.GRIDDLE_LEVEL)!;
    expect(griddle).toBeDefined();
    // 갈래는 부엌 전체 크기(KITCHEN_LEVEL)로 이어진다
    expect(griddle.outputs[0]!.gain.targets.some((x) => x.v === K.KITCHEN_LEVEL)).toBe(true);
    // 지글거림(높은 대역 거름)과, 전 올리기·뒤집기·기름 톡 같은 짧은 소리들이 이 갈래로 들어온다
    const feeders = ctx.nodes.filter((n) => n.outputs.includes(griddle));
    expect(feeders.some((n) => n.kind === 'filter' && n.frequency.value === 2300)).toBe(true);
    expect(feeders.length).toBeGreaterThan(5);
    kitchen.stop();
  });

  it('경기 중엔 번철 지글거림이 조금 커지고, 끝나면 돌아온다', () => {
    const { ctx, kitchen } = start();
    advance(ctx, 2);
    kitchen.setIntensity(1);
    kitchen.setIntensity(0);
    const levels = ctx.nodes.flatMap((n) => n.gain.targets.filter((x) => x.tau === 2).map((x) => x.v));
    expect(levels.length).toBe(2);
    expect(levels[0]!).toBeGreaterThan(levels[1]!);
    expect(levels[0]! / levels[1]!).toBeLessThan(1.5); // 살짝만
    kitchen.stop();
  });

  it('멈추면 타이머가 사라지고 더 예약하지 않으며, 잠시 뒤 노드를 떼어 낸다. 두 번 멈춰도 괜찮다', () => {
    const { ctx, kitchen } = start();
    advance(ctx, 10);
    kitchen.stop();
    const count = ctx.nodes.length;
    advance(ctx, 5);
    expect(ctx.nodes.length).toBe(count);
    expect(vi.getTimerCount()).toBe(0);
    // 늘 도는 노드(바탕 입구, 필터, 알갱이 곡선, 크기)를 모두 떼어 낸다
    expect(ctx.nodes.filter((n) => n.kind === 'shaper').every((n) => n.disconnected)).toBe(true);
    expect(ctx.nodes.filter((n) => n.disconnected).length).toBeGreaterThanOrEqual(10);
    // 미리 이어 붙여 둔 바탕 잡음은 소리가 줄어든 뒤 끊긴다
    for (const s of ctx.bedSegments()) expect(s.stoppedAt!).toBeLessThanOrEqual(ctx.currentTime);
    expect(() => {
      kitchen.stop();
      kitchen.setIntensity(1);
    }).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('장치가 멈춰 있으면(다른 탭) 아무것도 예약하지 않고, 다시 돌면 이어서 예약한다', () => {
    const ctx = new FakeCtx();
    ctx.state = 'suspended';
    const kitchen = K.startKitchen(asCtx(ctx), asOut(new FakeNode('out')), 1);
    vi.advanceTimersByTime(5000);
    expect(ctx.sources().length).toBe(0);
    ctx.state = 'running';
    advance(ctx, 3);
    expect(ctx.bedSegments().length).toBeGreaterThan(0);
    expect(ctx.sources().length).toBeGreaterThan(ctx.bedSegments().length);
    kitchen.stop();
  });

  it('탭이 오래 잠들었다 깨어나도 지난 소리를 한꺼번에 몰아서 내지 않는다', () => {
    const { ctx, kitchen } = start(7);
    advance(ctx, 5);
    const before = ctx.sources().length;
    // 타이머가 돌지 못한 채 시계만 60초 흘렀다
    ctx.currentTime += 60;
    vi.advanceTimersByTime(250);
    const added = ctx.sources().slice(before);
    for (const s of added) expect(s.startedAt!).toBeGreaterThanOrEqual(ctx.currentTime - 0.02);
    expect(added.length).toBeLessThan(40);
    kitchen.stop();
  });

  it('1분 동안 만드는 소리 수가 휴대폰에서 가벼운 정도다', () => {
    const { ctx, kitchen } = start(42);
    kitchen.setIntensity(1);
    advance(ctx, 60);
    // 바탕 잡음 조각(초당 한 개 남짓)과 짧은 소리들. 초당 노드 서른 개 안쪽
    expect(ctx.nodes.length / 60).toBeLessThan(30);
    kitchen.stop();
  });
});
