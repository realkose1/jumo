import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as M from './music';

describe('평조 음계', () => {
  it('다섯 음이 옥타브마다 되풀이되고, 음수는 아래 옥타브로 간다', () => {
    expect([0, 1, 2, 3, 4].map((d) => M.degreeToSemitone(d))).toEqual([0, 2, 5, 7, 9]);
    expect(M.degreeToSemitone(5)).toBe(12);
    expect(M.degreeToSemitone(7)).toBe(17);
    expect(M.degreeToSemitone(-1)).toBe(-3);
    expect(M.degreeToSemitone(-5)).toBe(-12);
  });

  it('주파수: 다섯 칸 위는 두 배, 다섯 칸 아래는 반', () => {
    expect(M.degreeFreq(155.56, 0)).toBeCloseTo(155.56, 5);
    expect(M.degreeFreq(155.56, 5)).toBeCloseTo(311.12, 5);
    expect(M.degreeFreq(155.56, -5)).toBeCloseTo(77.78, 5);
  });
});

describe('씨앗 난수', () => {
  it('씨앗이 같으면 같은 수열, 다르면 다른 수열이고 0~1 사이다', () => {
    const a = M.mulberry32(42);
    const b = M.mulberry32(42);
    const c = M.mulberry32(43);
    const xs = Array.from({ length: 50 }, () => a());
    expect(Array.from({ length: 50 }, () => b())).toEqual(xs);
    expect(Array.from({ length: 50 }, () => c())).not.toEqual(xs);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('한산할 때 가야금 가락', () => {
  it('음 범위 안에서 시간 순으로 놓이고, 길게 떠는 음으로 으뜸 근처에 맺는다', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const p = M.calmPhrase(M.mulberry32(seed));
      expect(p.notes.length).toBeGreaterThanOrEqual(3);
      expect(p.beats).toBeGreaterThan(0);
      let prev = -1;
      for (const n of p.notes) {
        expect(n.at).toBeGreaterThanOrEqual(prev);
        prev = n.at;
        expect(n.degree).toBeGreaterThanOrEqual(M.CALM_RANGE.low);
        expect(n.degree).toBeLessThanOrEqual(M.CALM_RANGE.high);
        expect(n.dur).toBeGreaterThan(0);
        expect(n.vel).toBeGreaterThan(0);
        expect(n.vel).toBeLessThanOrEqual(1);
        expect(n.at + n.dur).toBeLessThanOrEqual(p.beats + 4);
      }
      const last = p.notes[p.notes.length - 1]!;
      expect(last.orn).toBe('vibrato');
      expect([0, 2, 5]).toContain(last.degree);
    }
  });

  it('씨앗마다 가락이 달라 같은 소리가 되풀이되지 않는다', () => {
    const rand = M.mulberry32(7);
    const shapes = new Set(Array.from({ length: 30 }, () => JSON.stringify(M.calmPhrase(rand).notes.map((n) => [n.at, n.degree]))));
    expect(shapes.size).toBeGreaterThan(20);
  });
});

describe('경기 중 자진모리 장단', () => {
  it('한 장단은 열두 칸 안이고 덩으로 시작한다. 마무리 장단은 더 많이 친다', () => {
    const main = M.jangguBar(false);
    const fill = M.jangguBar(true);
    for (const bar of [main, fill]) {
      expect(bar[0]).toMatchObject({ step: 0, stroke: 'deong' });
      for (const h of bar) {
        expect(h.step).toBeGreaterThanOrEqual(0);
        expect(h.step).toBeLessThan(M.STEPS_PER_BAR);
        expect(h.accent).toBeGreaterThan(0);
        expect(h.accent).toBeLessThanOrEqual(1);
      }
    }
    expect(fill.length).toBeGreaterThan(main.length);
    // 돌려받은 것을 고쳐도 다음 장단은 그대로
    main[0]!.step = 5;
    expect(M.jangguBar(false)[0]!.step).toBe(0);
  });

  it('네 장단 묶음: 장구와 가락이 모두 48칸 안에 있고, 끝 장단은 마무리 장단이다', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const c = M.liveCycle(M.mulberry32(seed), seed === 1);
      expect(c.steps).toBe(M.STEPS_PER_BAR * M.BARS_PER_CYCLE);
      for (const h of c.strokes) expect(h.step).toBeLessThan(c.steps);
      for (let bar = 0; bar < M.BARS_PER_CYCLE; bar++) {
        expect(c.strokes.some((h) => h.step === bar * M.STEPS_PER_BAR && h.stroke === 'deong')).toBe(true);
      }
      const lastBar = c.strokes.filter((h) => h.step >= 3 * M.STEPS_PER_BAR).length;
      expect(lastBar).toBe(M.jangguBar(true).length);
      expect(c.melody.length).toBeGreaterThan(0);
      let prev = -1;
      for (const n of c.melody) {
        expect(n.step).toBeGreaterThanOrEqual(prev);
        prev = n.step;
        expect(n.step + n.len).toBeLessThanOrEqual(c.steps);
        expect(n.degree).toBeLessThanOrEqual(M.LIVE_RANGE.high);
        expect(n.degree).toBeGreaterThanOrEqual(-5);
      }
    }
    expect(M.liveCycle(M.mulberry32(3), true).jing).toBe(true);
  });
});

// ---- 예약기: WebAudio 흉내로 시작, 바꾸기, 멈추기만 본다 ----

class Param {
  value = 0;
  readonly times: number[] = [];
  setValueAtTime(v: number, t: number): void {
    this.value = v;
    this.times.push(t);
  }
  linearRampToValueAtTime(v: number, t: number): void {
    this.value = v;
    this.times.push(t);
  }
  exponentialRampToValueAtTime(v: number, t: number): void {
    expect(v).toBeGreaterThan(0);
    this.value = v;
    this.times.push(t);
  }
  setTargetAtTime(v: number, t: number): void {
    this.value = v;
    this.times.push(t);
  }
  cancelScheduledValues(): void {}
}

class FakeNode {
  gain = new Param();
  frequency = new Param();
  detune = new Param();
  Q = new Param();
  delayTime = new Param();
  type = '';
  buffer: unknown = null;
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  disconnected = false;
  constructor(readonly kind: string) {}
  connect(n: unknown): unknown {
    return n;
  }
  disconnect(): void {
    this.disconnected = true;
  }
  start(t = 0): void {
    this.startedAt = t;
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
  createDelay = this.make('delay');
  createBufferSource = this.make('buffer');
  createOscillator = this.make('osc');
  createBuffer = (_ch: number, length: number) => ({ length, getChannelData: () => new Float32Array(length) });
  sources(): FakeNode[] {
    return this.nodes.filter((n) => n.kind === 'osc' || n.kind === 'buffer');
  }
}

describe('배경 음악 예약기', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const start = (live: boolean) => {
    const ctx = new FakeCtx();
    const music = M.startMusic(ctx as unknown as BaseAudioContext, new FakeNode('out') as unknown as AudioNode, live, 1234);
    return { ctx, music };
  };

  const advance = (ctx: FakeCtx, seconds: number) => {
    for (let i = 0; i < seconds * 4; i++) {
      ctx.currentTime += 0.25;
      vi.advanceTimersByTime(250);
    }
  };

  it('한산할 때 가야금 음을 앞서 예약하고, 모든 음에 끝이 있다', () => {
    const { ctx, music } = start(false);
    advance(ctx, 20);
    const src = ctx.sources();
    expect(src.length).toBeGreaterThan(0);
    for (const s of src) {
      expect(s.startedAt).not.toBeNull();
      expect(s.stoppedAt!).toBeGreaterThan(s.startedAt!);
      // 앞을 내다보는 만큼보다 멀리 예약하지 않는다
      expect(s.startedAt!).toBeLessThanOrEqual(ctx.currentTime + 1.5);
    }
    music.stop();
  });

  it('경기가 시작되면 장구 소리가 들어오고, 동시에 울리는 음 수가 제한된다', () => {
    const { ctx, music } = start(false);
    advance(ctx, 3);
    const before = ctx.sources().length;
    music.setLive(true);
    advance(ctx, 10);
    const added = ctx.sources().slice(before);
    expect(added.length).toBeGreaterThan(40); // 장구가 촘촘하다
    // 같은 순간(0.5초 창)에 시작된 음이 지나치게 많지 않다
    const starts = added.map((s) => s.startedAt!).sort((a, b) => a - b);
    for (let i = 0; i < starts.length; i++) {
      const inWindow = starts.filter((t) => t >= starts[i]! && t < starts[i]! + 0.5).length;
      expect(inWindow).toBeLessThan(40);
    }
    music.setLive(false);
    advance(ctx, 5);
    music.stop();
  });

  it('멈추면 타이머가 사라지고 더 예약하지 않으며, 잠시 뒤 노드를 떼어 낸다. 두 번 멈춰도 괜찮다', () => {
    const { ctx, music } = start(true);
    advance(ctx, 4);
    music.stop();
    const count = ctx.nodes.length;
    advance(ctx, 5);
    expect(ctx.nodes.length).toBe(count);
    expect(vi.getTimerCount()).toBe(0);
    expect(ctx.nodes.filter((n) => n.disconnected).length).toBeGreaterThan(0);
    expect(() => {
      music.stop();
      music.setLive(false);
    }).not.toThrow();
  });

  it('장치가 멈춰 있으면(다른 탭) 아무것도 예약하지 않는다', () => {
    const ctx = new FakeCtx();
    ctx.state = 'suspended';
    const music = M.startMusic(ctx as unknown as BaseAudioContext, new FakeNode('out') as unknown as AudioNode, false, 1);
    vi.advanceTimersByTime(5000);
    expect(ctx.sources().length).toBe(0);
    music.stop();
  });
});
