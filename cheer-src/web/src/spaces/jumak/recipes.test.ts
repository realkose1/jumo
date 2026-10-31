import { describe, expect, it } from 'vitest';
import * as R from './recipes';

/**
 * WebAudio 흉내. 만든 소리 재료(소스)가 모두 시작과 끝이 있는지, 시각이 이상한 값(NaN, 음수)이 아닌지만 본다.
 * 실제 크기와 음색은 브라우저에서 OfflineAudioContext로 그려서 확인한다.
 */
class Param {
  value = 0;
  readonly times: number[] = [];
  private note(t: number): void {
    this.times.push(t);
  }
  setValueAtTime(v: number, t: number): void {
    this.value = v;
    this.note(t);
  }
  linearRampToValueAtTime(v: number, t: number): void {
    this.value = v;
    this.note(t);
  }
  exponentialRampToValueAtTime(v: number, t: number): void {
    expect(v).toBeGreaterThan(0); // 지수 변화는 0으로 갈 수 없다
    this.value = v;
    this.note(t);
  }
  setTargetAtTime(v: number, t: number): void {
    this.value = v;
    this.note(t);
  }
  cancelScheduledValues(t: number): void {
    this.note(t);
  }
}

class Node {
  readonly kind: string;
  gain = new Param();
  frequency = new Param();
  detune = new Param();
  Q = new Param();
  type = '';
  loop = false;
  buffer: unknown = null;
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  constructor(kind: string) {
    this.kind = kind;
  }
  connect(n: unknown): unknown {
    return n;
  }
  start(t = 0): void {
    this.startedAt = t;
  }
  stop(t = 0): void {
    this.stoppedAt = t;
  }
}

class Ctx {
  sampleRate = 44100;
  currentTime = 0;
  readonly sources: Node[] = [];
  private make(kind: string, isSource = false): Node {
    const n = new Node(kind);
    if (isSource) this.sources.push(n);
    return n;
  }
  createGain = (): Node => this.make('gain');
  createBiquadFilter = (): Node => this.make('filter');
  createConvolver = (): Node => this.make('convolver');
  createBufferSource = (): Node => this.make('buffer', true);
  createOscillator = (): Node => this.make('osc', true);
  createBuffer = (channels: number, length: number) => ({ numberOfChannels: channels, length, getChannelData: () => new Float32Array(length) });
}

const cue = (): R.Cue => ({ t: 0.01, gain: 1, rand: () => 0.5 });

function check(play: (ctx: Ctx, out: Node) => void): Ctx {
  const ctx = new Ctx();
  play(ctx, new Node('out'));
  expect(ctx.sources.length).toBeGreaterThan(0);
  for (const s of ctx.sources) {
    expect(s.startedAt, `${s.kind} 시작`).not.toBeNull();
    expect(Number.isFinite(s.startedAt!)).toBe(true);
    expect(s.stoppedAt, `${s.kind} 끝 (안 끝나는 소리는 새어 나간다)`).not.toBeNull();
    expect(s.stoppedAt!).toBeGreaterThan(s.startedAt!);
    for (const p of [s.gain, s.frequency, s.detune, s.Q]) for (const t of p.times) expect(Number.isFinite(t)).toBe(true);
  }
  return ctx;
}

const asCtx = (c: Ctx) => c as unknown as BaseAudioContext;
const asOut = (n: Node) => n as unknown as AudioNode;

describe('주막 소리 재료', () => {
  it('박수: 터짐 수만큼 소리가 난다', () => {
    const one = check((c, o) => R.clap(asCtx(c), asOut(o), cue(), 1));
    const three = check((c, o) => R.clap(asCtx(c), asOut(o), cue(), 3));
    expect(three.sources.length).toBe(one.sources.length * 3);
  });

  it('건배: 두 번 부딪히면 한 번보다 많고, 들리지 않는 높은 소리는 만들지 않는다', () => {
    const one = check((c, o) => R.toast(asCtx(c), asOut(o), cue(), 1));
    const two = check((c, o) => R.toast(asCtx(c), asOut(o), cue(), 2));
    expect(two.sources.length).toBeGreaterThan(one.sources.length);
    for (const s of two.sources) if (s.kind === 'osc') expect(s.frequency.value).toBeLessThanOrEqual(14000);
  });

  it('딸랑: 방울 소리는 울림 수만큼 늘고, 들리지 않는 높은 소리는 만들지 않는다', () => {
    const one = check((c, o) => R.bell(asCtx(c), asOut(o), cue(), 1));
    const two = check((c, o) => R.bell(asCtx(c), asOut(o), cue(), 2));
    expect(two.sources.length).toBe(one.sources.length * 2);
    for (const s of two.sources) if (s.kind === 'osc') expect(s.frequency.value).toBeLessThanOrEqual(14000);
  });

  it('쿵: 그릇 내려놓는 소리는 끝이 있다', () => {
    check((c, o) => R.clunk(asCtx(c), asOut(o), cue()));
  });

  it('골, 킥오프, 실점, 호루라기, 박수 갈채가 모두 끝이 있는 소리다', () => {
    check((c, o) => R.goal(asCtx(c), asOut(o), cue()));
    check((c, o) => R.kickoff(asCtx(c), asOut(o), cue()));
    check((c, o) => R.concede(asCtx(c), asOut(o), cue()));
    check((c, o) => R.finalWhistle(asCtx(c), asOut(o), cue(), true));
    check((c, o) => R.finalWhistle(asCtx(c), asOut(o), cue(), false));
    check((c, o) => R.applause(asCtx(c), asOut(o), cue(), 2, 10));
  });

  it('이기면 박수 갈채가 더 붙는다', () => {
    const win = check((c, o) => R.finalWhistle(asCtx(c), asOut(o), cue(), true));
    const draw = check((c, o) => R.finalWhistle(asCtx(c), asOut(o), cue(), false));
    expect(win.sources.length).toBeGreaterThan(draw.sources.length);
  });

  it('크기 배율이 0에 가까워도 오류 없이 지나간다 (남의 동작은 작게)', () => {
    check((c, o) => R.clap(asCtx(c), asOut(o), { ...cue(), gain: 0.01 }, 2));
    check((c, o) => R.bell(asCtx(c), asOut(o), { ...cue(), gain: 0.01 }, 1));
  });
});
