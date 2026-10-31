// 주막 부엌 소리(파일 없음, WebAudio로 직접 만든다). 배경 음악 밑에 잔잔하게 깔린다.
// - 가마솥: 아궁이 불이 낮게 웅웅거리고 장작이 가끔 타닥 튄다. 솥 안에서는 국이 보글보글(낮은 소리가 짧게 솟아오르는 방울).
// - 번철: 기름 두른 번철에서 전이 늘 조금씩 지글거린다. 20~40초마다 새 전을 올리면 치익 하고 커졌다가 몇 초에 걸쳐
//   가라앉고, 기름이 톡톡 튄다. 반쯤은 몇 초 뒤 뒤집개로 뒤집는다.
// - 가끔: 국자로 솥전을 똑똑, 사발 내려놓기, 도마에 칼질. 멀찍이 띄워서 작게.
// 파도처럼 들리지 않게, 넓은 잡음이 천천히 부풀었다 꺼지는 소리는 쓰지 않는다. 늘 깔리는 소리는 크기가 일정하고,
// 바뀌는 것은 빨리 솟고 천천히 가라앉는다(치익). 경기 중에는 전을 더 자주, 더 많이 부친다.
// 소리는 앞을 내다보며(ctx.currentTime 기준) 조금씩 미리 예약한다. 무엇을 언제 낼지 짜는 부분(simmerBurst, fryBatch,
// chopPattern 등)은 소리 장치 없이 시험할 수 있는 순수 함수다.
import { mulberry32 } from './music';
import { clunk, noiseBuffer, noiseHit, tone } from './recipes';

// ---- 무엇을 언제 낼지 (순수) ----

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** 평균이 mean인 지수 분포 간격: 드문드문 아무 때나 일어나는 일의 간격 */
function expGap(rand: () => number, mean: number): number {
  return -Math.log(Math.max(1e-6, 1 - rand())) * mean;
}

export interface Bubble {
  /** 묶음 시작부터 몇 초 뒤 */
  at: number;
  /** 처음 높이(Hz). 큰 솥이라 낮다 */
  freq: number;
  /** 솟아오르는 배율 (방울이 터지며 높아진다) */
  rise: number;
  dur: number;
  /** 0~1 */
  vel: number;
  /** 수면에서 톡 터지는 소리를 붙일지 */
  pop: boolean;
}

/** 방울 처음 높이 범위(Hz) */
export const BUBBLE_RANGE = { low: 110, high: 380 } as const;

/** 가마솥 보글거림 한 묶음: 방울이 하나에서 넷, 잇따라 솟는다. next는 묶음 시작부터 다음 묶음까지(초) */
export function simmerBurst(rand: () => number): { bubbles: Bubble[]; next: number } {
  const count = 1 + Math.floor(rand() * rand() * 4); // 대개 하나둘, 가끔 서넛
  const bubbles: Bubble[] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    if (i > 0) at += 0.05 + rand() * 0.14;
    const big = rand() < 0.18; // 가끔 크고 낮은 뽀글
    bubbles.push({
      at,
      freq: big ? lerp(BUBBLE_RANGE.low, 165, rand()) : lerp(170, BUBBLE_RANGE.high, rand()),
      rise: big ? 1.25 + rand() * 0.3 : 1.45 + rand() * 0.8,
      dur: big ? 0.12 + rand() * 0.06 : 0.05 + rand() * 0.06,
      vel: 0.45 + rand() * 0.55,
      pop: rand() < 0.35,
    });
  }
  // 대개 잠깐 쉬고, 가끔 한동안 잠잠하다
  const rest = rand() < 0.1 ? 1.8 + rand() * 2 : 0.2 + Math.min(2.2, expGap(rand, 0.5));
  return { bubbles, next: at + rest };
}

export interface Crackle {
  at: number;
  freq: number;
  dur: number;
  vel: number;
}

/** 장작 타닥: 한 번, 가끔 두세 번 잇따라. next는 묶음 시작부터 다음 타닥까지(초) */
export function fireCrackles(rand: () => number): { hits: Crackle[]; next: number } {
  const count = rand() < 0.6 ? 1 : rand() < 0.7 ? 2 : 3;
  const hits: Crackle[] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    if (i > 0) at += 0.025 + rand() * 0.08;
    hits.push({ at, freq: 1300 + rand() * 2900, dur: 0.005 + rand() * 0.011, vel: (0.35 + rand() * 0.65) * (i === 0 ? 1 : 0.75) });
  }
  return { hits, next: at + 0.35 + Math.min(4.5, expGap(rand, 1.1)) };
}

/** 새 전을 올릴 때 지글거림이 솟는 정도(늘 나는 크기에 몇 배를 더하나). 뒤집을 때는 그보다 작게 */
export const LAY_BURST = 2.6;
export const FLIP_BURST = 1.1;
/** 치익 한 뒤 가라앉는 빠르기(초, 지수 시상수) */
export const FRY_SETTLE = 2.6;

export type FryKind = 'lay' | 'flip';

export interface FryEvent {
  /** 묶음 시작부터 몇 초 뒤 */
  at: number;
  kind: FryKind;
  burst: number;
}

export interface FryBatch {
  fries: FryEvent[];
  /** 기름이 톡톡 튀는 때(묶음 시작 기준 초, 시간 순) */
  pops: number[];
  /** 묶음 시작부터 다음 전을 올릴 때까지(초) */
  next: number;
}

/** 다음 전을 올릴 때까지(초): 한산할 땐 20~40초, 경기 중엔 13~26초 */
export function fryGap(rand: () => number, live: number): number {
  const base = lerp(20, 13, clamp01(live));
  return base + rand() * base;
}

/** 치익 한 뒤 기름 튀는 때: 처음엔 촘촘하다가(초당 peakRate번) 점점 드물어진다 */
export function fryPops(rand: () => number, peakRate: number, settle = FRY_SETTLE): number[] {
  const out: number[] = [];
  let t = 0.03 + rand() * 0.05;
  for (let guard = 0; guard < 200; guard++) {
    const rate = peakRate * Math.exp(-t / settle);
    if (rate < 0.35) break;
    out.push(t);
    t += 0.02 + expGap(rand, 1 / rate);
  }
  return out;
}

/** 전 한 장: 올리고(치익), 반쯤은 몇 초 뒤 뒤집는다(작게 치익). 다음 전은 튀던 기름이 잦아든 뒤에 */
export function fryBatch(rand: () => number, live: number): FryBatch {
  const fries: FryEvent[] = [{ at: 0, kind: 'lay', burst: LAY_BURST }];
  let pops = fryPops(rand, 6);
  if (rand() < 0.6) {
    const at = 6 + rand() * 5;
    fries.push({ at, kind: 'flip', burst: FLIP_BURST });
    pops = pops.concat(fryPops(rand, 3).map((p) => p + at));
  }
  pops.sort((a, b) => a - b);
  const last = Math.max(fries[fries.length - 1]!.at, pops.length > 0 ? pops[pops.length - 1]! : 0);
  return { fries, pops, next: Math.max(fryGap(rand, live), last + 2) };
}

/** 번철에 전이 다 익어 갈 때 가끔 톡 튀는 기름 사이(초). 경기 중엔 전이 많아 조금 잦다 */
export function idlePopGap(rand: () => number, live: number): number {
  return 0.08 + Math.min(8, expGap(rand, lerp(2, 1.3, clamp01(live))));
}

/** 가끔 들리는 부엌일: 국자로 솥전 두드리기, 사발 내려놓기, 도마에 칼질 */
export type Chore = 'ladle' | 'bowl' | 'chop';
export const CHORES: readonly Chore[] = ['ladle', 'bowl', 'chop'];

/** 다음 부엌일: 같은 일이 잇따르지 않게. 경기 중엔 사발 내가는 일이 조금 잦다 */
export function nextChore(rand: () => number, last: Chore | null, live: number): Chore {
  const weight: Record<Chore, number> = { ladle: 1, bowl: 1 + 0.6 * clamp01(live), chop: 0.9 };
  const options = CHORES.filter((c) => c !== last);
  const total = options.reduce((sum, c) => sum + weight[c], 0);
  let r = rand() * total;
  for (const c of options) {
    r -= weight[c];
    if (r < 0) return c;
  }
  return options[options.length - 1]!;
}

/** 부엌일 사이(초): 한산할 땐 11~25초, 경기 중엔 8~18초 */
export function choreGap(rand: () => number, live: number): number {
  const k = clamp01(live);
  return lerp(11, 8, k) + rand() * lerp(14, 10, k);
}

export interface Tap {
  at: number;
  /** 0~1 */
  vel: number;
}

/** 도마에 칼질: 네 번에서 아홉 번, 고르게 탁탁 치다가 끝이 약해진다 */
export function chopPattern(rand: () => number): Tap[] {
  const n = 4 + Math.floor(rand() * 6);
  const interval = 0.13 + rand() * 0.07;
  const taps: Tap[] = [];
  for (let i = 0; i < n; i++) {
    const tail = i >= n - 2 ? 0.7 : 1;
    taps.push({ at: i * interval + (i > 0 ? (rand() - 0.5) * 0.025 : 0), vel: (0.7 + rand() * 0.3) * tail });
  }
  return taps;
}

/** 국자로 솥전을 똑똑(가끔 똑똑똑). 뒤로 갈수록 약하다 */
export function ladleTaps(rand: () => number): Tap[] {
  const n = rand() < 0.7 ? 2 : 3;
  const taps: Tap[] = [];
  let at = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) at += 0.17 + rand() * 0.07;
    taps.push({ at, vel: i === 0 ? 1 : 0.85 - i * 0.1 });
  }
  return taps;
}

/** 지글 알갱이 곡선의 문턱: 흰 잡음 값 가운데 이것을 넘는 1.5%만 알갱이로 남는다(초당 수백 개) */
export const CRACKLE_THRESHOLD = 0.985;

/**
 * 흰 잡음을 드문드문 튀는 알갱이로 바꾸는 곡선(WaveShaper용). 문턱보다 작은 값은 지우고, 넘는 것만 거듭제곱으로 눌러
 * 남긴다: 아주 작은 알갱이가 많고(지이이) 큰 것은 드물다(톡). 양쪽은 대칭이다.
 */
export function crackleCurve(size = 4096, threshold = CRACKLE_THRESHOLD, power = 4) {
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    const a = Math.abs(x);
    curve[i] = a <= threshold ? 0 : Math.sign(x) * Math.pow(Math.min(1, (a - threshold) / (1 - threshold)), power);
  }
  return curve;
}

/** 동시에 울리는 짧은 소리 수 제한: 울리는 동안을 모아 두고, 그 시각에 겹치는 소리가 꽉 차면 새 소리를 버린다 */
export function voiceLimiter(max: number): (now: number, t: number, hold: number) => boolean {
  const spans: Array<[number, number]> = [];
  return (now, t, hold) => {
    for (let i = spans.length - 1; i >= 0; i--) if (spans[i]![1] <= now) spans.splice(i, 1);
    let overlapping = 0;
    for (const [s, e] of spans) if (s < t + hold && e > t) overlapping++;
    if (overlapping >= max) return false;
    spans.push([t, t + hold]);
    return true;
  };
}

// ---- 소리 내기 ----

type Ctx = BaseAudioContext;

/** 보글: 낮은 사인파가 짧게 솟아오르고, 가끔 수면에서 톡 터진다 */
export function bubble(ctx: Ctx, out: AudioNode, t: number, b: Bubble, gain: number, rand: () => number): void {
  tone(ctx, out, t, { freq: b.freq, freqEnd: b.freq * b.rise, peak: 0.075 * b.vel * gain, attack: 0.006, dur: b.dur });
  if (b.pop) {
    noiseHit(ctx, out, t + b.dur * 0.85, rand, { type: 'bandpass', freq: 900 + b.freq * 3, q: 2.2, peak: 0.03 * b.vel * gain, attack: 0.001, dur: 0.014 });
  }
}

/** 장작 타닥: 아주 짧은 잡음 알갱이 */
export function fireCrackle(ctx: Ctx, out: AudioNode, t: number, c: Crackle, gain: number, rand: () => number): void {
  noiseHit(ctx, out, t, rand, { type: 'bandpass', freq: c.freq, q: 1.3, peak: 0.12 * c.vel * gain, attack: 0.0015, dur: c.dur });
}

/** 기름이 톡: 높고 아주 짧게 */
export function oilPop(ctx: Ctx, out: AudioNode, t: number, vel: number, gain: number, rand: () => number): void {
  noiseHit(ctx, out, t, rand, { type: 'highpass', freq: 3200 + rand() * 2600, q: 0.9, peak: 0.07 * vel * gain, attack: 0.001, dur: 0.004 + rand() * 0.008 });
}

/** 반죽을 번철에 철퍽 붓고 치이익 (김 오르는 소리는 빨리 솟고 금방 잦아든다) */
export function batterDown(ctx: Ctx, out: AudioNode, t: number, gain: number, rand: () => number): void {
  noiseHit(ctx, out, t, rand, { type: 'bandpass', freq: 820, freqEnd: 420, q: 0.9, peak: 0.09 * gain, attack: 0.005, dur: 0.1 });
  noiseHit(ctx, out, t + 0.02, rand, { type: 'highpass', freq: 3000, q: 0.6, peak: 0.03 * gain, attack: 0.06, dur: 1.5 });
}

/** 쇠 뒤집개로 번철을 긁어 전을 뒤집고 탁 내려놓는다 */
export function spatulaFlip(ctx: Ctx, out: AudioNode, t: number, gain: number, rand: () => number): void {
  noiseHit(ctx, out, t, rand, { type: 'bandpass', freq: 1500, freqEnd: 2500, q: 2.5, peak: 0.04 * gain, attack: 0.012, dur: 0.09 });
  noiseHit(ctx, out, t + 0.16, rand, { type: 'lowpass', freq: 650, q: 0.8, peak: 0.07 * gain, attack: 0.003, dur: 0.07 });
  noiseHit(ctx, out, t + 0.17, rand, { type: 'highpass', freq: 3200, q: 0.6, peak: 0.02 * gain, attack: 0.05, dur: 1 });
}

/** 나무 국자가 무쇠 솥전에 똑: 나무가 딱 하는 소리에 무쇠의 둔한 울림이 짧게 붙는다 */
export function ladleTap(ctx: Ctx, out: AudioNode, t: number, vel: number, gain: number, rand: () => number): void {
  noiseHit(ctx, out, t, rand, { type: 'bandpass', freq: 1700, q: 1.6, peak: 0.06 * vel * gain, attack: 0.001, dur: 0.025 });
  const base = 330 + rand() * 40;
  // 무쇠: 배음이 정수배가 아니고 금방 죽는다
  const partials: Array<[number, number, number]> = [
    [1, 1, 0.2],
    [2.71, 0.45, 0.12],
    [5.2, 0.18, 0.07],
  ];
  for (const [ratio, amp, dur] of partials) {
    tone(ctx, out, t, { freq: base * ratio, peak: 0.045 * amp * vel * gain, attack: 0.002, dur });
  }
}

/** 도마에 칼질 한 번: 나무 도마의 둔한 톡과 칼날이 닿는 소리 */
export function knifeChop(ctx: Ctx, out: AudioNode, t: number, vel: number, gain: number, rand: () => number): void {
  tone(ctx, out, t, { freq: 230, freqEnd: 120, peak: 0.06 * vel * gain, attack: 0.002, dur: 0.06 });
  noiseHit(ctx, out, t, rand, { type: 'bandpass', freq: 2300, q: 1.1, peak: 0.05 * vel * gain, attack: 0.001, dur: 0.018 });
  noiseHit(ctx, out, t, rand, { type: 'lowpass', freq: 900, q: 0.7, peak: 0.04 * vel * gain, attack: 0.002, dur: 0.035 });
}

// ---- 앞을 내다보는 예약 ----

/** 부엌 소리 전체 크기(환경음 층 안에서). 배경 음악보다 한참 작게 깔린다 */
export const KITCHEN_LEVEL = 0.5;
/** 한꺼번에 울리는 짧은 소리 수 상한 (휴대폰에서 가볍게) */
export const MAX_KITCHEN_VOICES = 10;
/** 이만큼 앞까지 미리 예약한다(초). 뒤에 있는 탭은 타이머가 1초에 한 번쯤만 돈다 */
export const KITCHEN_LOOKAHEAD = 1.2;
const TICK_MS = 250;
/** 늘 깔리는 소리 크기: 아궁이 불(낮은 웅웅), 번철 지글거림. 경기 중엔 번철에 전이 많아 지글거림이 조금 크다 */
const RUMBLE_LEVEL = 0.16;
const SIZZLE_LEVEL = 0.6;
const SIZZLE_LIVE_BOOST = 0.35;

export interface Kitchen {
  /** 0(한산함)~1(경기 중이라 전을 더 부친다) */
  setIntensity(v: number): void;
  stop(): void;
}

interface KitchenEvent {
  t: number;
  /** 대략 울리는 길이(초). 동시 소리 수를 세는 데 쓴다 */
  hold: number;
  /** 수 제한과 상관없이 꼭 낸다(전 올리기, 뒤집기처럼 드문 것) */
  always?: boolean;
  fire: (t: number) => void;
}

/** 소리 줄기 하나(솥, 장작, 번철, 부엌일...): 다음 묶음을 그때그때 짜서 순서대로 낸다 */
interface Stream {
  queue: KitchenEvent[];
  /** 다음 묶음을 시작할 시각 */
  next: number;
  generate: (start: number) => { events: KitchenEvent[]; next: number };
}

/** 부엌 소리를 시작한다. out은 환경음 층(배경 음악과 같은 곳) */
export function startKitchen(ctx: Ctx, out: AudioNode, seed = Math.floor(Math.random() * 2 ** 32)): Kitchen {
  const rand = mulberry32(seed);
  const noise = noiseBuffer(ctx);
  const sampleRate = ctx.sampleRate;
  const noiseSeconds = noise.length / sampleRate;
  /** 잡음 조각을 표본 경계에 맞춘다(사이 값을 섞으면 알갱이가 무뎌진다) */
  const onFrame = (s: number): number => Math.round(s * sampleRate) / sampleRate;
  const start = ctx.currentTime;
  let intensity = 0;
  let stopped = false;

  const bus = ctx.createGain();
  bus.gain.setValueAtTime(0.0001, start);
  bus.gain.setTargetAtTime(KITCHEN_LEVEL, start, 0.9);
  // 저만치 부엌에서 들리듯 아주 높은 소리는 살짝 깎는다
  const soft = ctx.createBiquadFilter();
  soft.type = 'lowpass';
  soft.frequency.value = 9000;
  soft.Q.value = 0.5;
  bus.connect(soft).connect(out);

  // 늘 깔리는 바탕: 흰 잡음 조각을 아무 데서나 잘라 이어 붙이고(되풀이가 들리지 않게) 두 갈래로 나눈다
  const bedIn = ctx.createGain();
  // 아궁이 불: 낮게 웅웅. 크기는 일정하다(천천히 일렁이면 파도처럼 들린다)
  const rumbleLp = ctx.createBiquadFilter();
  rumbleLp.type = 'lowpass';
  rumbleLp.frequency.value = 230;
  rumbleLp.Q.value = 0.6;
  const rumbleGain = ctx.createGain();
  rumbleGain.gain.value = RUMBLE_LEVEL;
  bedIn.connect(rumbleLp).connect(rumbleGain).connect(bus);
  // 번철: 잡음에서 문턱을 넘는 알갱이만 남겨 높은 대역으로 보내면 지글지글
  const shaper = ctx.createWaveShaper();
  shaper.curve = crackleCurve();
  const sizzleHp = ctx.createBiquadFilter();
  sizzleHp.type = 'highpass';
  sizzleHp.frequency.value = 2300;
  sizzleHp.Q.value = 0.6;
  const sizzleBase = ctx.createGain();
  sizzleBase.gain.value = SIZZLE_LEVEL;
  // 새 전을 올릴 때 치익 솟는 몫은 따로 둔다(경기 중 바탕 크기 바꾸기와 서로 부딪히지 않게)
  const sizzleBurst = ctx.createGain();
  sizzleBurst.gain.value = 1;
  bedIn.connect(shaper).connect(sizzleHp).connect(sizzleBase).connect(sizzleBurst).connect(bus);
  const persistent: AudioNode[] = [bus, soft, bedIn, rumbleLp, rumbleGain, shaper, sizzleHp, sizzleBase, sizzleBurst];

  const bed: Array<{ src: AudioBufferSourceNode; end: number }> = [];
  let bedAt = onFrame(start);
  const runBed = (now: number, until: number): void => {
    while (bed.length > 0 && bed[0]!.end < now) bed.shift();
    if (bedAt < now) bedAt = onFrame(now + 0.02); // 뒤처졌으면 지금부터(지난 조각을 몰아서 틀지 않는다)
    for (let guard = 0; guard < 16 && bedAt < until; guard++) {
      const dur = onFrame(0.6 + rand() * 0.8);
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.connect(bedIn);
      src.start(bedAt, onFrame(rand() * Math.max(0, noiseSeconds - dur)));
      src.stop(bedAt + dur);
      bed.push({ src, end: bedAt + dur });
      bedAt += dur;
    }
  };

  // 번철: 전을 올리거나 뒤집으면 지글거림이 빨리 솟고 천천히 가라앉는다
  const fry = (t: number, f: FryEvent): void => {
    if (f.kind === 'lay') batterDown(ctx, bus, t, 1, rand);
    else spatulaFlip(ctx, bus, t, 1, rand);
    const at = t + (f.kind === 'lay' ? 0.02 : 0.17);
    const p = sizzleBurst.gain;
    p.setTargetAtTime(1 + f.burst, at, 0.05);
    p.setTargetAtTime(1, at + 0.45, FRY_SETTLE);
  };

  const pot: Stream = {
    queue: [],
    next: start + 0.4,
    generate: (at) => {
      const { bubbles, next } = simmerBurst(rand);
      const events = bubbles.map((b): KitchenEvent => ({ t: at + b.at, hold: b.dur + 0.02, fire: (t) => bubble(ctx, bus, t, b, 1, rand) }));
      return { events, next: at + next };
    },
  };

  const fire: Stream = {
    queue: [],
    next: start + 0.8,
    generate: (at) => {
      const { hits, next } = fireCrackles(rand);
      const events = hits.map((c): KitchenEvent => ({ t: at + c.at, hold: c.dur + 0.01, fire: (t) => fireCrackle(ctx, bus, t, c, 1, rand) }));
      return { events, next: at + next };
    },
  };

  const griddle: Stream = {
    queue: [],
    next: start + 2.5 + rand() * 5, // 첫 전은 곧 올린다
    generate: (at) => {
      const batch = fryBatch(rand, intensity);
      const events: KitchenEvent[] = batch.fries.map((f) => ({ t: at + f.at, hold: 0.3, always: true, fire: (t) => fry(t, f) }));
      for (const p of batch.pops) {
        const vel = 0.5 + rand() * 0.5;
        events.push({ t: at + p, hold: 0.015, fire: (t) => oilPop(ctx, bus, t, vel, 1, rand) });
      }
      events.sort((a, b) => a.t - b.t);
      return { events, next: at + batch.next };
    },
  };

  const idlePops: Stream = {
    queue: [],
    next: start + 1.2,
    generate: (at) => {
      const vel = 0.3 + rand() * 0.5;
      return { events: [{ t: at, hold: 0.015, fire: (t) => oilPop(ctx, bus, t, vel, 1, rand) }], next: at + idlePopGap(rand, intensity) };
    },
  };

  let lastChore: Chore | null = null;
  const choreEvents = (kind: Chore, at: number): KitchenEvent[] => {
    switch (kind) {
      case 'ladle':
        return ladleTaps(rand).map((tap) => ({ t: at + tap.at, hold: 0.2, fire: (t) => ladleTap(ctx, bus, t, tap.vel, 1, rand) }));
      case 'bowl':
        return [{ t: at, hold: 0.25, fire: (t) => clunk(ctx, bus, { t, gain: 0.16, rand }) }];
      case 'chop':
        return chopPattern(rand).map((tap) => ({ t: at + tap.at, hold: 0.06, fire: (t) => knifeChop(ctx, bus, t, tap.vel, 1, rand) }));
    }
  };
  const chores: Stream = {
    queue: [],
    next: start + 7 + rand() * 8,
    generate: (at) => {
      const kind = nextChore(rand, lastChore, intensity);
      lastChore = kind;
      const events = choreEvents(kind, at);
      return { events, next: events[events.length - 1]!.t + choreGap(rand, intensity) };
    },
  };

  const streams = [pot, fire, griddle, idlePops, chores];
  const claimVoice = voiceLimiter(MAX_KITCHEN_VOICES);

  const runStream = (s: Stream, now: number, until: number): void => {
    for (let guard = 0; guard < 128; guard++) {
      if (s.queue.length === 0) {
        // 뒤처졌으면(탭이 잠들었다 깨어나면) 지난 것은 건너뛰고 지금부터
        if (s.next < now) s.next = now + 0.05 + rand() * 0.3;
        if (s.next >= until) return;
        const batch = s.generate(s.next);
        s.queue = batch.events;
        s.next = Math.max(batch.next, s.next + 0.05);
      }
      const ev = s.queue[0]!;
      if (ev.t >= until) return;
      s.queue.shift();
      if (ev.t < now - 0.02) continue; // 이미 지난 소리는 버린다(한꺼번에 터지지 않게)
      const t = Math.max(ev.t, now);
      if (ev.always || claimVoice(now, t, ev.hold)) ev.fire(t);
    }
  };

  const tick = (): void => {
    if (stopped) return;
    // 멈춘 장치에 예약하면 돌아왔을 때 한꺼번에 터진다
    const state = (ctx as AudioContext).state;
    if (state !== undefined && state !== 'running') return;
    const now = ctx.currentTime;
    const until = now + KITCHEN_LOOKAHEAD;
    runBed(now, until);
    for (const s of streams) runStream(s, now, until);
  };

  tick();
  const timer = setInterval(tick, TICK_MS);

  return {
    setIntensity(v: number) {
      if (stopped) return;
      const next = clamp01(v);
      const rising = next > intensity + 0.2;
      intensity = next;
      const now = ctx.currentTime;
      sizzleBase.gain.setTargetAtTime(SIZZLE_LEVEL * (1 + SIZZLE_LIVE_BOOST * intensity), now, 2);
      // 경기가 시작되면 곧 새 전을 올린다(지금 부치는 전이 잦아든 뒤에)
      if (rising) griddle.next = Math.min(griddle.next, now + 3 + rand() * 4);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      for (const s of streams) s.queue = [];
      const now = ctx.currentTime;
      bus.gain.cancelScheduledValues(now);
      bus.gain.setTargetAtTime(0.0001, now, 0.12);
      // 미리 이어 붙여 둔 잡음 조각은 소리가 줄어든 뒤 끊는다
      const cut = now + 0.6;
      for (const b of bed) {
        if (b.end <= cut) continue;
        try {
          b.src.stop(cut);
        } catch {
          /* 이미 멈춤 */
        }
      }
      bed.length = 0;
      setTimeout(() => {
        for (const n of persistent) n.disconnect();
      }, 700);
    },
  };
}
