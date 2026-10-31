// 주막의 배경 음악(파일 없음, WebAudio로 직접 만든다).
// 한산할 때: 가야금처럼 뜯는 줄 소리가 평조 다섯 음으로 느릿하게, 그때그때 다른 가락을 탄다.
// 경기 중: 자진모리 장구(덩, 덕, 쿵)에 태평소 같은 날카로운 가락과 가야금이 얹혀 신나게.
// 둘 사이는 몇 초에 걸쳐 서로 엇갈려 바뀐다. 음은 앞을 내다보며(ctx.currentTime 기준) 조금씩 미리 예약한다.
// 가락과 장단을 짜는 부분(calmPhrase, jangguBar, liveCycle 등)은 소리 장치 없이 시험할 수 있는 순수 함수다.
import { noiseBuffer } from './recipes';

// ---- 음계와 난수 (순수) ----

/** 평조: 황종(E♭)을 으뜸으로 하는 다섯 음 (E♭ F A♭ B♭ C), 으뜸음에서 반음 몇 개인지 */
export const PYEONGJO: readonly number[] = [0, 2, 5, 7, 9];

/** 음계 몇 번째 음(옥타브를 넘어 이어지고, 음수면 아래)을 반음 수로 */
export function degreeToSemitone(degree: number, scale: readonly number[] = PYEONGJO): number {
  const n = scale.length;
  const octave = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return octave * 12 + scale[idx]!;
}

export function degreeFreq(root: number, degree: number, scale: readonly number[] = PYEONGJO): number {
  return root * Math.pow(2, degreeToSemitone(degree, scale) / 12);
}

/** 씨앗이 같으면 같은 수열을 내는 가벼운 난수 (0~1) */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rand() * items.length))]!;
}

/** 음 꾸밈: 농현(떠는 소리), 추성(밀어 올림), 퇴성(흘려 내림) */
export type Ornament = 'none' | 'vibrato' | 'slideUp' | 'bendDown';

export interface PhraseNote {
  /** 가락 시작부터 몇 박 뒤 */
  at: number;
  degree: number;
  /** 울림 길이(박) */
  dur: number;
  /** 0~1 */
  vel: number;
  orn: Ornament;
}

export interface CalmPhrase {
  notes: PhraseNote[];
  /** 가락 길이(박). 이 뒤에 쉼이 따로 붙는다 */
  beats: number;
}

/** 한산할 때 가락의 음 범위(평조 몇 번째 음) */
export const CALM_RANGE = { low: -5, high: 9 } as const;
/** 가락이 끝나며 내려앉는 음: 으뜸(E♭), 셋째(A♭), 위 으뜸(E♭) */
const CALM_ENDINGS = [0, 2, 5] as const;

/** 한산할 때 한 가락: 서너 음에서 일곱 음 남짓, 가까운 음으로 걸어 다니다 길게 떨며 끝난다. 가끔 낮은 음이 받친다 */
export function calmPhrase(rand: () => number): CalmPhrase {
  const notes: PhraseNote[] = [];
  const count = 3 + Math.floor(rand() * 5);
  let at = 0;
  if (rand() < 0.45) {
    // 낮은 줄을 한 번 짚고 시작
    notes.push({ at: 0, degree: pick(rand, [-5, -3, -2]), dur: 4, vel: 0.55, orn: 'none' });
    at = rand() < 0.5 ? 0 : 1;
  }
  let degree = pick(rand, [2, 3, 4, 5, 6]);
  const steps = [-2, -1, -1, 1, 1, 2] as const;
  const lengths = [1, 1, 1, 1.5, 2, 0.5] as const;
  for (let i = 0; i < count; i++) {
    const last = i === count - 1;
    if (last) {
      // 가장 가까운 끝맺음 음으로
      degree = CALM_ENDINGS.reduce((best, d) => (Math.abs(d - degree) < Math.abs(best - degree) ? d : best), CALM_ENDINGS[0]);
    }
    const dur = last ? 3 + Math.floor(rand() * 2) : pick(rand, lengths);
    const orn: Ornament = last ? 'vibrato' : rand() < 0.15 ? 'slideUp' : rand() < 0.12 ? 'bendDown' : 'none';
    const vel = (last ? 0.75 : 0.55 + rand() * 0.35) * (i === 0 ? 1 : 0.92);
    notes.push({ at, degree, dur, vel, orn });
    at += dur;
    if (!last) {
      degree += pick(rand, steps);
      degree = Math.min(CALM_RANGE.high - 2, Math.max(0, degree));
    }
  }
  return { notes, beats: at };
}

// ---- 경기 중: 자진모리 장단 (순수) ----

/** 장구: 덩(양손 함께), 덕(채편, 날카로운 채), 쿵(궁편, 낮은 북면), 기(덕 앞의 꾸밈 채) */
export type Stroke = 'deong' | 'deok' | 'kung' | 'gi';

export interface StrokeHit {
  /** 한 장단 12 칸(세 칸씩 네 박) 가운데 몇째 칸 */
  step: number;
  stroke: Stroke;
  /** 0~1 */
  accent: number;
}

/** 한 장단 칸 수: 3분박 네 박(12/8) */
export const STEPS_PER_BAR = 12;
/** 한 번에 짜는 장단 수(네 장단마다 징과 몰아치는 마무리) */
export const BARS_PER_CYCLE = 4;

const MAIN_BAR: readonly StrokeHit[] = [
  { step: 0, stroke: 'deong', accent: 1 },
  { step: 2, stroke: 'deok', accent: 0.55 },
  { step: 3, stroke: 'kung', accent: 0.7 },
  { step: 5, stroke: 'deok', accent: 0.6 },
  { step: 6, stroke: 'deong', accent: 0.85 },
  { step: 8, stroke: 'deok', accent: 0.55 },
  { step: 9, stroke: 'kung', accent: 0.75 },
  { step: 10, stroke: 'deok', accent: 0.6 },
];

const FILL_BAR: readonly StrokeHit[] = [
  { step: 0, stroke: 'deong', accent: 1 },
  { step: 2, stroke: 'deok', accent: 0.6 },
  { step: 3, stroke: 'deong', accent: 0.85 },
  { step: 5, stroke: 'deok', accent: 0.6 },
  { step: 6, stroke: 'deong', accent: 0.9 },
  { step: 7, stroke: 'gi', accent: 0.45 },
  { step: 8, stroke: 'deok', accent: 0.7 },
  { step: 9, stroke: 'deong', accent: 0.95 },
  { step: 10, stroke: 'deok', accent: 0.75 },
  { step: 11, stroke: 'deok', accent: 0.85 },
];

/** 한 장단의 장구 치기. 마무리 장단(fill)은 더 몰아친다 */
export function jangguBar(fill: boolean): StrokeHit[] {
  return (fill ? FILL_BAR : MAIN_BAR).map((h) => ({ ...h }));
}

export type LiveVoice = 'piri' | 'pluck';

export interface LiveNote {
  /** 네 장단(48 칸) 안에서 몇째 칸 */
  step: number;
  /** 칸 수 */
  len: number;
  degree: number;
  vel: number;
  voice: LiveVoice;
}

export interface LiveCycle {
  strokes: StrokeHit[];
  melody: LiveNote[];
  /** 이 묶음 맨 앞에서 징을 칠지 */
  jing: boolean;
  steps: number;
}

/** 한 장단 안 가락 모양들: [시작 칸, 길이] */
const RIFF_SHAPES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[0, 3], [3, 3], [6, 2], [8, 1], [9, 3]],
  [[0, 2], [2, 1], [3, 3], [6, 3], [9, 2], [11, 1]],
  [[0, 1], [1, 2], [3, 1], [4, 2], [6, 6]],
  [[0, 3], [3, 2], [5, 1], [6, 3], [9, 3]],
];
const CADENCE_SHAPE: ReadonlyArray<readonly [number, number]> = [[0, 3], [3, 3], [6, 6]];

/** 경기 중 가락 음 범위(평조 몇 번째 음, 태평소 기준) */
export const LIVE_RANGE = { low: 0, high: 8 } as const;

function riffDegrees(rand: () => number, count: number, start: number): number[] {
  const out: number[] = [];
  let d = start;
  for (let i = 0; i < count; i++) {
    out.push(d);
    d += pick(rand, [-2, -1, 1, 1, 2, 0]);
    d = Math.min(LIVE_RANGE.high, Math.max(LIVE_RANGE.low + 1, d));
  }
  return out;
}

/**
 * 경기 중 네 장단 한 묶음: 메기고(첫째) 다시 받고(둘째, 끝음만 바꿈) 새 가락(셋째) 뒤 으뜸음으로 맺는다(넷째).
 * 주된 가락은 태평소나 가야금이 번갈아 맡고, 태평소일 때는 가야금이 큰 박마다 낮게 받쳐 준다.
 */
export function liveCycle(rand: () => number, first = false): LiveCycle {
  const strokes: StrokeHit[] = [];
  for (let bar = 0; bar < BARS_PER_CYCLE; bar++) {
    for (const h of jangguBar(bar === BARS_PER_CYCLE - 1)) strokes.push({ ...h, step: h.step + bar * STEPS_PER_BAR });
  }
  const lead: LiveVoice = rand() < 0.6 ? 'piri' : 'pluck';
  const melody: LiveNote[] = [];
  const shapeA = pick(rand, RIFF_SHAPES);
  const shapeB = pick(rand, RIFF_SHAPES);
  const degA = riffDegrees(rand, shapeA.length, pick(rand, [3, 4, 5, 6]));
  const degA2 = [...degA];
  degA2[degA2.length - 1] = Math.min(LIVE_RANGE.high, Math.max(LIVE_RANGE.low + 1, degA2[degA2.length - 1]! + pick(rand, [-1, 1, 2])));
  const degB = riffDegrees(rand, shapeB.length, pick(rand, [4, 5, 6, 7]));
  const cadence = [pick(rand, [4, 6, 7]), pick(rand, [3, 4, 6]), pick(rand, [5, 5, 0])];
  const bars: Array<[ReadonlyArray<readonly [number, number]>, number[]]> = [
    [shapeA, degA],
    [shapeA, degA2],
    [shapeB, degB],
    [CADENCE_SHAPE, cadence],
  ];
  bars.forEach(([shape, degs], bar) => {
    shape.forEach(([step, len], i) => {
      const accent = step === 0 || step === 6 ? 1 : 0.8;
      melody.push({ step: bar * STEPS_PER_BAR + step, len, degree: degs[i]!, vel: accent * (0.8 + rand() * 0.2), voice: lead });
    });
    if (lead === 'piri') {
      for (const step of [0, 6]) melody.push({ step: bar * STEPS_PER_BAR + step, len: 6, degree: pick(rand, [-5, -3, 0]), vel: 0.5, voice: 'pluck' });
    }
  });
  melody.sort((a, b) => a.step - b.step);
  return { strokes, melody, jing: first || rand() < 0.5, steps: STEPS_PER_BAR * BARS_PER_CYCLE };
}

// ---- 소리 내기 ----

/** 가야금 으뜸음 E♭3 */
const GAYAGEUM_ROOT = 155.56;
/** 태평소 으뜸음 E♭4 */
const PIRI_ROOT = 311.13;
/** 한꺼번에 울리는 음 수 상한 (휴대폰에서 가볍게) */
const MAX_VOICES = 12;
/** 이만큼 앞까지 미리 예약한다(초). 뒤에 있는 탭은 타이머가 1초에 한 번쯤만 돈다 */
const LOOKAHEAD = 1.3;
const TICK_MS = 250;
/** 두 분위기가 엇갈려 바뀌는 시간(초) */
export const CROSSFADE_SECONDS = 2.5;
const CALM_LEVEL = 0.55;
const LIVE_LEVEL = 0.6;

type Ctx = BaseAudioContext;

/** 주파수 꾸밈을 한 줄에 그린다 */
function ornament(p: AudioParam, t: number, freq: number, orn: Ornament, dur: number): void {
  switch (orn) {
    case 'slideUp': // 추성: 한 음 아래서 밀어 올림
      p.setValueAtTime(freq * 0.89, t);
      p.setValueAtTime(freq * 0.89, t + 0.04);
      p.exponentialRampToValueAtTime(freq, t + 0.2);
      break;
    case 'bendDown': // 퇴성: 울리다가 살짝 흘려 내림
      p.setValueAtTime(freq, t);
      p.setValueAtTime(freq, t + 0.35);
      p.exponentialRampToValueAtTime(freq * 0.945, t + 0.7);
      break;
    case 'vibrato': {
      // 농현: 조금 울린 뒤 점점 깊게 떤다 (LFO 없이 점 몇 개로)
      p.setValueAtTime(freq, t);
      const start = t + 0.3;
      p.setValueAtTime(freq, start);
      const rate = 4.6;
      const end = t + Math.min(dur, 2.4);
      let k = 0;
      for (let x = start + 0.5 / rate; x < end; x += 0.5 / rate, k++) {
        const depth = Math.min(1, (x - start) / 0.8) * 0.022;
        p.linearRampToValueAtTime(freq * (1 + (k % 2 === 0 ? depth : -depth * 0.6)), x);
      }
      break;
    }
    default:
      p.setValueAtTime(freq, t);
  }
}

/** 가야금처럼 뜯는 줄: 톱니파를 빨리 어두워지는 저역 통과로, 사인파 몸통, 손끝 잡음 */
export function pluck(ctx: Ctx, out: AudioNode, t: number, freq: number, vel: number, orn: Ornament = 'none', sustain = 1.6): void {
  const dur = Math.max(0.4, sustain) + (freq < 200 ? 0.6 : 0);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.2 * vel), t + 0.005);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.07 * vel), t + 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(out);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 3;
  lp.frequency.setValueAtTime(Math.min(7000, freq * 9), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(120, freq * 1.6), t + 0.35);
  lp.connect(g);

  const saw = ctx.createOscillator();
  saw.type = 'sawtooth';
  ornament(saw.frequency, t, freq, orn, dur);
  const sawGain = ctx.createGain();
  sawGain.gain.value = 0.55;
  saw.connect(sawGain).connect(lp);

  const body = ctx.createOscillator();
  body.type = 'sine';
  ornament(body.frequency, t, freq, orn, dur);
  body.connect(lp);

  // 손끝이 줄을 튕기는 짧은 잡음
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = Math.min(6000, freq * 5);
  bp.Q.value = 2.5;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.12 * vel), t + 0.002);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  n.connect(bp).connect(ng).connect(out);

  saw.start(t);
  body.start(t);
  n.start(t, (freq * 7.3) % 1.5);
  saw.stop(t + dur + 0.05);
  body.stop(t + dur + 0.05);
  n.stop(t + 0.05);
}

/** 태평소처럼 코맹맹이 날카로운 피리: 톱니파를 대역 통과, 아래서 끌어 올리고 떤다 */
export function piri(ctx: Ctx, out: AudioNode, t: number, freq: number, dur: number, vel: number): void {
  const len = Math.max(0.12, dur);
  const g = ctx.createGain();
  const peak = Math.max(0.0002, 0.075 * vel);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.03);
  g.gain.setValueAtTime(peak, t + len * 0.75);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  g.connect(out);

  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1350;
  bp.Q.value = 1.4;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3200;
  bp.connect(lp).connect(g);

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(freq * 0.95, t);
  osc.frequency.exponentialRampToValueAtTime(freq, t + 0.05);
  osc.connect(bp);
  // 떨림: 긴 음일수록 또렷하게
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 6.2;
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(0, t);
  depth.gain.linearRampToValueAtTime(len > 0.5 ? 22 : 8, t + Math.min(0.4, len));
  lfo.connect(depth).connect(osc.detune);

  osc.start(t);
  lfo.start(t);
  osc.stop(t + len + 0.05);
  lfo.stop(t + len + 0.05);
}

/** 장구 한 번 */
export function janggu(ctx: Ctx, out: AudioNode, t: number, stroke: Stroke, accent: number): void {
  const a = Math.max(0.05, accent);
  const kung = (gain: number): void => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(105, t);
    osc.frequency.exponentialRampToValueAtTime(62, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.42 * gain), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.36);
  };
  const deok = (gain: number, at = t): void => {
    // 대나무 채가 얇은 가죽을 때리는 딱: 잡음 터짐과 짧은 높은 울림
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3000;
    bp.Q.value = 1.3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.32 * gain), at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    n.connect(bp).connect(g).connect(out);
    n.start(at, (at * 3.7) % 1.5);
    n.stop(at + 0.07);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, at);
    osc.frequency.exponentialRampToValueAtTime(430, at + 0.06);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, at);
    og.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.1 * gain), at + 0.002);
    og.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
    osc.connect(og).connect(out);
    osc.start(at);
    osc.stop(at + 0.1);
  };
  switch (stroke) {
    case 'deong':
      kung(a);
      deok(a * 0.9);
      break;
    case 'kung':
      kung(a);
      break;
    case 'deok':
      deok(a);
      break;
    case 'gi':
      deok(a * 0.5);
      break;
  }
}

/** 징: 낮게 오래 맥놀이하며 울린다 */
export function jing(ctx: Ctx, out: AudioNode, t: number, gain: number): void {
  const partials: Array<[number, number, number]> = [
    [164, 1, 3],
    [166.4, 0.7, 2.8],
    [331, 0.25, 1.6],
  ];
  for (const [freq, amp, dur] of partials) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 0.985, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.16 * amp * gain), t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
}

// ---- 앞을 내다보는 예약 ----

interface ScheduledEvent {
  t: number;
  /** 대략 울리는 길이(초). 동시 음 수를 세는 데 쓴다. 0이면 세지 않는다(장구처럼 아주 짧은 것) */
  hold: number;
  fire: (t: number) => void;
}

/** 한 분위기의 소리 줄기: 이어서 짤 묶음을 그때그때 만들어 순서대로 낸다 */
interface Track {
  gain: GainNode;
  level: number;
  active: boolean;
  /** 꺼지는 중이면 이때까지만 예약한다 */
  fadeUntil: number;
  queue: ScheduledEvent[];
  cursor: number;
  generate: (start: number) => { events: ScheduledEvent[]; end: number };
}

export interface JumakMusic {
  setLive(live: boolean): void;
  stop(): void;
}

/** 배경 음악을 시작한다. out은 환경음 층(웅성거림과 같은 곳) */
export function startMusic(ctx: Ctx, out: AudioNode, live = false, seed = Math.floor(Math.random() * 2 ** 32)): JumakMusic {
  const rand = mulberry32(seed);
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, ctx.currentTime);
  master.gain.setTargetAtTime(1, ctx.currentTime, 0.6);
  master.connect(out);

  // 한산할 때만 얇게 메아리(지연 하나, 되먹임 하나: 잔향보다 훨씬 가볍다)
  const echoIn = ctx.createGain();
  echoIn.gain.value = 0.22;
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.36;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.3;
  const echoLp = ctx.createBiquadFilter();
  echoLp.type = 'lowpass';
  echoLp.frequency.value = 1800;
  echoIn.connect(delay).connect(echoLp).connect(feedback).connect(delay);
  echoLp.connect(master);

  const voices: number[] = [];
  const claimVoice = (t: number, hold: number): boolean => {
    if (hold <= 0) return true;
    const now = ctx.currentTime;
    for (let i = voices.length - 1; i >= 0; i--) if (voices[i]! < now) voices.splice(i, 1);
    // 이미 예약된 음이 그 시각에 몇이나 울리는지
    if (voices.length >= MAX_VOICES) return false;
    voices.push(t + hold);
    return true;
  };

  const calmGain = ctx.createGain();
  calmGain.connect(master);
  calmGain.connect(echoIn);
  const liveGain = ctx.createGain();
  liveGain.connect(master);

  const calm: Track = {
    gain: calmGain,
    level: CALM_LEVEL,
    active: false,
    fadeUntil: 0,
    queue: [],
    cursor: 0,
    generate: (start) => {
      const phrase = calmPhrase(rand);
      const beat = 0.55 + rand() * 0.15;
      const events: ScheduledEvent[] = phrase.notes.map((n) => {
        const sustain = Math.min(3.2, n.dur * beat + 0.6);
        return {
          t: start + n.at * beat + (rand() - 0.5) * 0.02,
          hold: sustain,
          fire: (t) => pluck(ctx, calmGain, t, degreeFreq(GAYAGEUM_ROOT, n.degree), n.vel, n.orn, sustain),
        };
      });
      const rest = 2.2 + rand() * 4.5;
      return { events, end: start + phrase.beats * beat + rest };
    },
  };

  let firstCycle = true;
  const liveTrack: Track = {
    gain: liveGain,
    level: LIVE_LEVEL,
    active: false,
    fadeUntil: 0,
    queue: [],
    cursor: 0,
    generate: (start) => {
      const cycle = liveCycle(rand, firstCycle);
      firstCycle = false;
      const bpm = 100 + rand() * 10; // 큰 박(점4분음표) 빠르기
      const step = 60 / bpm / 3;
      const events: ScheduledEvent[] = [];
      if (cycle.jing) events.push({ t: start, hold: 3, fire: (t) => jing(ctx, liveGain, t, 0.9) });
      for (const h of cycle.strokes) {
        events.push({ t: start + h.step * step + (rand() - 0.5) * 0.008, hold: 0, fire: (t) => janggu(ctx, liveGain, t, h.stroke, h.accent) });
      }
      for (const n of cycle.melody) {
        const dur = n.len * step;
        if (n.voice === 'piri') {
          events.push({ t: start + n.step * step, hold: dur, fire: (t) => piri(ctx, liveGain, t, degreeFreq(PIRI_ROOT, n.degree), dur * 0.95, n.vel) });
        } else {
          const sustain = Math.min(1.4, dur + 0.3);
          events.push({ t: start + n.step * step, hold: sustain, fire: (t) => pluck(ctx, liveGain, t, degreeFreq(GAYAGEUM_ROOT * 2, n.degree), n.vel * 0.9, 'none', sustain) });
        }
      }
      events.sort((a, b) => a.t - b.t);
      return { events, end: start + cycle.steps * step };
    },
  };

  const fade = (track: Track, on: boolean, seconds: number): void => {
    const now = ctx.currentTime;
    const p = track.gain.gain;
    const from = p.value;
    p.cancelScheduledValues(now);
    p.setValueAtTime(from, now);
    p.linearRampToValueAtTime(on ? track.level : 0, now + seconds);
    if (on && !track.active && now >= track.fadeUntil) {
      // 새로 들어오는 분위기는 처음부터
      track.queue = [];
      track.cursor = now + 0.1;
    }
    track.active = on;
    track.fadeUntil = on ? 0 : now + seconds;
  };

  const runTrack = (track: Track, until: number): void => {
    const now = ctx.currentTime;
    if (!track.active && now >= track.fadeUntil) return;
    const limit = track.active ? until : Math.min(until, track.fadeUntil);
    for (let guard = 0; guard < 256; guard++) {
      if (track.queue.length === 0) {
        // 뒤처졌으면(탭이 잠들었다 깨어나면) 지난 것은 건너뛰고 지금부터
        if (track.cursor < now) track.cursor = now + 0.05;
        if (track.cursor >= limit) return;
        const next = track.generate(track.cursor);
        track.queue = next.events;
        track.cursor = Math.max(next.end, track.cursor + 0.1);
      }
      const ev = track.queue[0]!;
      if (ev.t >= limit) return;
      track.queue.shift();
      if (ev.t < now - 0.02) continue; // 이미 지난 음은 버린다(한꺼번에 터지지 않게)
      const t = Math.max(ev.t, now);
      if (claimVoice(t, ev.hold)) ev.fire(t);
    }
  };

  let stopped = false;
  const tick = (): void => {
    if (stopped) return;
    // 멈춘 장치에 예약하면 돌아왔을 때 한꺼번에 터진다
    if ((ctx as AudioContext).state !== undefined && (ctx as AudioContext).state !== 'running') return;
    const until = ctx.currentTime + LOOKAHEAD;
    runTrack(calm, until);
    runTrack(liveTrack, until);
  };

  calmGain.gain.value = 0;
  liveGain.gain.value = 0;
  fade(live ? liveTrack : calm, true, 0.8);
  let isLive = live;
  tick();
  const timer = setInterval(tick, TICK_MS);

  return {
    setLive(next: boolean) {
      if (stopped || next === isLive) return;
      isLive = next;
      fade(next ? liveTrack : calm, true, CROSSFADE_SECONDS);
      fade(next ? calm : liveTrack, false, CROSSFADE_SECONDS);
      if (next) firstCycle = true;
      tick();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      calm.queue = [];
      liveTrack.queue = [];
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(0.0001, now, 0.12);
      setTimeout(() => {
        for (const n of [master, calmGain, liveGain, echoIn, delay, feedback, echoLp]) n.disconnect();
      }, 700);
    },
  };
}
