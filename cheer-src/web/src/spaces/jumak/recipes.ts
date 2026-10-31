// 주막의 소리를 WebAudio로 직접 만드는 법(파일 없음). 모두 BaseAudioContext만 받아서
// 브라우저에서 OfflineAudioContext로 미리 그려 크기를 재 볼 수도 있다.
// 소리 이름: 박수(clap), 건배(toast), 주문 방울(bell)과 그릇 내려놓기(clunk), 골(goal), 킥오프 북소리(kickoff), 실점(concede), 호루라기(final), 웅성거림(murmur)

export interface Cue {
  /** 소리가 시작하는 시각(ctx.currentTime 기준) */
  t: number;
  /** 전체 크기 배율. 남의 동작은 작게 */
  gain: number;
  /** 0~1 난수. 시험에서 고정할 수 있다 */
  rand: () => number;
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** 2초짜리 흰 잡음 (여러 소리가 나눠 쓴다) */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, buf);
  }
  return buf;
}

/** 분홍 잡음(낮은 소리가 더 센 잡음) 루프용 */
export function pinkNoiseBuffer(ctx: BaseAudioContext, seconds = 8): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < d.length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  // 루프 이음매가 딱 소리 나지 않게 양 끝을 서로 섞는다
  const fade = Math.floor(ctx.sampleRate * 0.25);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    d[i] = d[i]! * k + d[d.length - fade + i]! * (1 - k);
  }
  return buf;
}

/** 짧은 방울림(잔향)용 충격 응답: 지수로 줄어드는 잡음 */
export function reverbImpulse(ctx: BaseAudioContext, seconds = 1.1, decay = 3.2): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function envelope(g: GainNode, t: number, peak: number, attack: number, dur: number): void {
  const p = g.gain;
  p.cancelScheduledValues(t);
  p.setValueAtTime(0.0001, t);
  p.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + Math.max(0.001, attack));
  p.exponentialRampToValueAtTime(0.0001, t + dur);
}

interface NoiseOptions {
  type: BiquadFilterType;
  freq: number;
  freqEnd?: number;
  q?: number;
  peak: number;
  attack: number;
  dur: number;
}

/** 걸러진 잡음 한 번 */
export function noiseHit(ctx: BaseAudioContext, out: AudioNode, t: number, rand: () => number, o: NoiseOptions): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = o.type;
  f.frequency.setValueAtTime(o.freq, t);
  if (o.freqEnd !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t + o.dur);
  f.Q.value = o.q ?? 1;
  const g = ctx.createGain();
  envelope(g, t, o.peak, o.attack, o.dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, rand() * 1.4);
  src.stop(t + o.dur + 0.05);
}

interface ToneOptions {
  type?: OscillatorType;
  freq: number;
  freqEnd?: number;
  peak: number;
  attack: number;
  dur: number;
  detune?: number;
}

export function tone(ctx: BaseAudioContext, out: AudioNode, t: number, o: ToneOptions): OscillatorNode {
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t + o.dur);
  if (o.detune) osc.detune.value = o.detune;
  const g = ctx.createGain();
  envelope(g, t, o.peak, o.attack, o.dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + o.dur + 0.05);
  return osc;
}

// ---- 동작 소리 ----

/** 박수: 짧은 잡음 터짐 몇 번 */
export function clap(ctx: BaseAudioContext, out: AudioNode, c: Cue, hits = 3): void {
  for (let i = 0; i < hits; i++) {
    const t = c.t + i * (0.085 + c.rand() * 0.03);
    const pitch = 1500 + c.rand() * 1100;
    noiseHit(ctx, out, t, c.rand, { type: 'bandpass', freq: pitch, q: 0.9, peak: 0.75 * c.gain, attack: 0.002, dur: 0.085 });
    noiseHit(ctx, out, t, c.rand, { type: 'highpass', freq: 4200, q: 0.5, peak: 0.3 * c.gain, attack: 0.001, dur: 0.03 });
  }
}

/** 건배: 맑은 유리잔 부딪는 소리 두 번 */
export function toast(ctx: BaseAudioContext, out: AudioNode, c: Cue, pings = 2): void {
  const base = 1950 + c.rand() * 350;
  const ping = (t: number, f: number, g: number): void => {
    // 유리 같은 소리: 배음이 정수배가 아니다
    const partials: Array<[number, number, number]> = [
      [1, 1, 0.95],
      [2.76, 0.55, 0.55],
      [5.4, 0.28, 0.32],
      [8.93, 0.1, 0.18],
    ];
    for (const [ratio, amp, decay] of partials) {
      if (f * ratio > 14000) continue; // 너무 높은 소리는 들리지도 않고 장치 한계를 넘는다
      tone(ctx, out, t, { freq: f * ratio, peak: 0.16 * amp * g * c.gain, attack: 0.002, dur: decay });
    }
    noiseHit(ctx, out, t, c.rand, { type: 'bandpass', freq: 6500, q: 1.5, peak: 0.12 * g * c.gain, attack: 0.001, dur: 0.02 });
  };
  ping(c.t, base, 1);
  if (pings > 1) ping(c.t + 0.12, base * 1.335, 0.85);
}

interface CrowdOptions {
  dur: number;
  attack: number;
  /** 입 모양을 여는 소리(포먼트) 시작 높이 */
  openFrom?: number;
  openTo?: number;
  noise: number;
  voiced: number;
  pitch?: number;
}

/** 사람들이 내는 큰 소리: 입 벌린 포먼트 잡음 + 낮은 목소리 톱니파 */
function crowd(ctx: BaseAudioContext, out: AudioNode, c: Cue, o: CrowdOptions): void {
  const t = c.t;
  const openFrom = o.openFrom ?? 620;
  const openTo = o.openTo ?? 960;
  const formants: Array<[number, number, number]> = [
    [openFrom, 1.3, 1],
    [openFrom * 1.75, 1.6, 0.8],
    [330, 0.9, 0.7],
  ];
  for (const [freq, q, share] of formants) {
    noiseHit(ctx, out, t, c.rand, {
      type: 'bandpass',
      freq,
      freqEnd: freq * (openTo / openFrom),
      q,
      peak: o.noise * share * c.gain,
      attack: o.attack,
      dur: o.dur,
    });
  }
  if (o.voiced > 0) {
    const pitch = o.pitch ?? 165;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    lp.Q.value = 0.7;
    lp.connect(out);
    // 사람마다 높이가 조금씩 다른 목소리 셋
    [1, 1.26, 1.62].forEach((ratio, i) => {
      const osc = tone(ctx, lp, t, { type: 'sawtooth', freq: pitch * ratio, freqEnd: pitch * ratio * 1.12, peak: (o.voiced * c.gain) / (1 + i * 0.3), attack: o.attack, dur: o.dur, detune: (c.rand() - 0.5) * 30 });
      // 떨림
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5 + c.rand() * 1.5;
      const depth = ctx.createGain();
      depth.gain.value = 9;
      lfo.connect(depth).connect(osc.detune);
      lfo.start(t);
      lfo.stop(t + o.dur + 0.05);
    });
  }
}

/** 딸랑: 주모를 부르는 작은 방울 소리. 맑은 두 번 */
export function bell(ctx: BaseAudioContext, out: AudioNode, c: Cue, rings = 2): void {
  const base = 2350 + c.rand() * 250;
  for (let i = 0; i < rings; i++) {
    const t = c.t + i * 0.13;
    const f = base * (i % 2 ? 1.12 : 1);
    // 작은 쇠방울: 배음이 정수배가 아니고 빨리 사그라든다
    const partials: Array<[number, number, number]> = [
      [1, 1, 0.5],
      [2.4, 0.5, 0.3],
      [4.1, 0.3, 0.18],
    ];
    for (const [ratio, amp, decay] of partials) {
      if (f * ratio > 14000) continue;
      tone(ctx, out, t, { freq: f * ratio, peak: 0.2 * amp * c.gain, attack: 0.002, dur: decay });
    }
    noiseHit(ctx, out, t, c.rand, { type: 'bandpass', freq: 5200, q: 2, peak: 0.1 * c.gain, attack: 0.001, dur: 0.025 });
  }
}

/** 쿵: 그릇을 상에 내려놓는 소리. 낮게 울리는 나무와 맑은 사기그릇 부딪힘 */
export function clunk(ctx: BaseAudioContext, out: AudioNode, c: Cue): void {
  tone(ctx, out, c.t, { freq: 190 + c.rand() * 30, freqEnd: 78, peak: 0.5 * c.gain, attack: 0.003, dur: 0.18 });
  noiseHit(ctx, out, c.t, c.rand, { type: 'lowpass', freq: 600, q: 0.8, peak: 0.35 * c.gain, attack: 0.002, dur: 0.07 });
  tone(ctx, out, c.t + 0.012, { freq: 1750 + c.rand() * 200, peak: 0.07 * c.gain, attack: 0.002, dur: 0.22 });
  noiseHit(ctx, out, c.t + 0.01, c.rand, { type: 'bandpass', freq: 2600, q: 1.4, peak: 0.12 * c.gain, attack: 0.001, dur: 0.04 });
}

// ---- 북 ----
export function drum(ctx: BaseAudioContext, out: AudioNode, t: number, rand: () => number, gain: number, freq = 150): void {
  tone(ctx, out, t, { freq, freqEnd: freq * 0.32, peak: 0.85 * gain, attack: 0.004, dur: 0.38 });
  tone(ctx, out, t, { freq: freq * 0.5, freqEnd: freq * 0.2, peak: 0.5 * gain, attack: 0.004, dur: 0.5 });
  noiseHit(ctx, out, t, rand, { type: 'lowpass', freq: 700, q: 0.7, peak: 0.45 * gain, attack: 0.002, dur: 0.1 });
}

function cymbal(ctx: BaseAudioContext, out: AudioNode, t: number, rand: () => number, gain: number, dur: number): void {
  noiseHit(ctx, out, t, rand, { type: 'highpass', freq: 5500, q: 0.6, peak: 0.28 * gain, attack: 0.012, dur });
  noiseHit(ctx, out, t, rand, { type: 'bandpass', freq: 8200, q: 1.1, peak: 0.16 * gain, attack: 0.01, dur: dur * 0.8 });
}

// ---- 순간 소리 ----

/** 골: 터지는 함성과 북 */
export function goal(ctx: BaseAudioContext, out: AudioNode, c: Cue): void {
  cymbal(ctx, out, c.t, c.rand, c.gain * 0.8, 1.5);
  crowd(ctx, out, c, { dur: 3.6, attack: 0.3, noise: 0.95, voiced: 0.08, openFrom: 560, openTo: 1050, pitch: 172 });
  // 늦게 따라오는 두 번째 함성 (뒤에 앉은 사람들)
  crowd(ctx, out, { ...c, t: c.t + 0.22, gain: c.gain * 0.7 }, { dur: 3.0, attack: 0.4, noise: 0.6, voiced: 0.05, openFrom: 760, openTo: 1250, pitch: 205 });
  const hits: Array<[number, number]> = [[0, 1], [0.34, 0.75], [0.68, 0.85], [0.86, 0.65], [1.04, 1]];
  for (const [dt, g] of hits) drum(ctx, out, c.t + dt, c.rand, g * c.gain * 0.62, 150);
}

/** 킥오프: 점점 빨라지는 북 굴리기와 마지막 한 방 */
export function kickoff(ctx: BaseAudioContext, out: AudioNode, c: Cue): void {
  const total = 1.7;
  const n = 16;
  for (let i = 0; i < n; i++) {
    const p = i / n;
    const t = c.t + total * (1 - Math.pow(1 - p, 1.7));
    const g = (0.18 + 0.7 * p) * c.gain * 0.7;
    noiseHit(ctx, out, t, c.rand, { type: 'bandpass', freq: 1900 + c.rand() * 400, q: 0.9, peak: 0.42 * g, attack: 0.002, dur: 0.07 });
    if (i % 2 === 0) tone(ctx, out, t, { freq: 190, freqEnd: 120, peak: 0.28 * g, attack: 0.003, dur: 0.12 });
  }
  const end = c.t + total + 0.04;
  drum(ctx, out, end, c.rand, 0.75 * c.gain, 130);
  drum(ctx, out, end + 0.02, c.rand, 0.45 * c.gain, 90);
  cymbal(ctx, out, end, c.rand, 0.7 * c.gain, 1.6);
}

/** 실점: 숨이 빠지는 듯한 내려가는 소리 (조용히) */
export function concede(ctx: BaseAudioContext, out: AudioNode, c: Cue): void {
  noiseHit(ctx, out, c.t, c.rand, { type: 'bandpass', freq: 950, freqEnd: 240, q: 1.2, peak: 0.36 * c.gain, attack: 0.18, dur: 1.6 });
  noiseHit(ctx, out, c.t + 0.1, c.rand, { type: 'bandpass', freq: 560, freqEnd: 190, q: 1.6, peak: 0.22 * c.gain, attack: 0.25, dur: 1.5 });
  const osc = tone(ctx, out, c.t, { freq: 360, freqEnd: 175, peak: 0.07 * c.gain, attack: 0.2, dur: 1.4 });
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 4.5;
  const depth = ctx.createGain();
  depth.gain.value = 14;
  lfo.connect(depth).connect(osc.detune);
  lfo.start(c.t);
  lfo.stop(c.t + 1.5);
}

/** 호루라기 한 번 (알이 든 호루라기처럼 떨린다) */
function whistle(ctx: BaseAudioContext, out: AudioNode, t: number, dur: number, gain: number, rand: () => number): void {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22 * gain, t + 0.02);
  g.gain.setValueAtTime(0.22 * gain, t + Math.max(0.03, dur - 0.05));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(out);
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(2750, t);
  osc.frequency.linearRampToValueAtTime(2900 + rand() * 60, t + dur);
  const trem = ctx.createGain();
  trem.gain.value = 0.7;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 28;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0.3;
  lfo.connect(lfoDepth).connect(trem.gain);
  osc.connect(trem).connect(g);
  osc.start(t);
  lfo.start(t);
  osc.stop(t + dur + 0.05);
  lfo.stop(t + dur + 0.05);
  noiseHit(ctx, g, t, rand, { type: 'bandpass', freq: 3000, q: 7, peak: 0.3, attack: 0.02, dur });
}

/** 박수 갈채: 여기저기서 터지는 박수 */
export function applause(ctx: BaseAudioContext, out: AudioNode, c: Cue, dur = 2.6, density = 42): void {
  noiseHit(ctx, out, c.t, c.rand, { type: 'bandpass', freq: 1900, q: 0.5, peak: 0.1 * c.gain, attack: 0.5, dur });
  for (let i = 0; i < density; i++) {
    const t = c.t + 0.1 + c.rand() * (dur - 0.3);
    noiseHit(ctx, out, t, c.rand, { type: 'bandpass', freq: 1300 + c.rand() * 2400, q: 0.8, peak: (0.2 + c.rand() * 0.2) * c.gain, attack: 0.002, dur: 0.06 });
  }
}

/** 경기 끝: 호루라기 세 번(짧게 둘, 길게 하나). 이겼으면 박수 갈채가 이어진다 */
export function finalWhistle(ctx: BaseAudioContext, out: AudioNode, c: Cue, win: boolean): void {
  whistle(ctx, out, c.t, 0.2, c.gain, c.rand);
  whistle(ctx, out, c.t + 0.3, 0.2, c.gain, c.rand);
  whistle(ctx, out, c.t + 0.62, 0.95, c.gain, c.rand);
  if (win) {
    applause(ctx, out, { ...c, t: c.t + 0.9, gain: c.gain * 0.9 }, 2.8);
    crowd(ctx, out, { ...c, t: c.t + 0.8, gain: c.gain * 0.6 }, { dur: 2.2, attack: 0.35, noise: 0.5, voiced: 0.04 });
  }
}

// ---- 웅성거림 ----

export interface Murmur {
  /** 0(한산함)~1(경기 중이라 신남) */
  setIntensity(v: number): void;
  stop(): void;
}

/** 낮게 깔리는 사람들 말소리. 켜져 있는 동안 계속 돌고, 경기 중에는 더 활기차다 */
export function startMurmur(ctx: AudioContext, out: AudioNode): Murmur {
  const src = ctx.createBufferSource();
  src.buffer = pinkNoiseBuffer(ctx);
  src.loop = true;

  const master = ctx.createGain();
  master.gain.value = 0.0001;
  master.connect(out);

  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 110;
  src.connect(hp);

  // 말소리 높이의 포먼트 둘과 낮은 웅웅거림. 각각 천천히 커졌다 작아진다
  const branches: Array<{ freq: number; q: number; base: number; lfo: number }> = [
    { freq: 520, q: 1.4, base: 0.55, lfo: 0.17 },
    { freq: 980, q: 1.8, base: 0.4, lfo: 0.29 },
    { freq: 1650, q: 2.0, base: 0.16, lfo: 0.41 },
    { freq: 230, q: 0.8, base: 0.5, lfo: 0.11 },
  ];
  const filters: BiquadFilterNode[] = [];
  const gains: GainNode[] = [];
  const lfos: OscillatorNode[] = [];
  for (const b of branches) {
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = b.freq;
    f.Q.value = b.q;
    const g = ctx.createGain();
    g.gain.value = b.base;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = b.lfo;
    const depth = ctx.createGain();
    depth.gain.value = b.base * 0.55;
    lfo.connect(depth).connect(g.gain);
    lfo.start();
    hp.connect(f).connect(g).connect(master);
    filters.push(f);
    gains.push(g);
    lfos.push(lfo);
  }
  src.start(0, Math.random() * 6);

  let intensity = 0;
  let stopped = false;
  let swellTimer: ReturnType<typeof setTimeout> | undefined;

  const levelFor = (v: number): number => 0.5 + 0.55 * v;
  const apply = (swell = 1): void => {
    const now = ctx.currentTime;
    master.gain.setTargetAtTime(levelFor(intensity) * swell, now, swell > 1 ? 0.35 : 0.8);
    // 경기 중에는 말소리가 살짝 높고 밝아진다
    filters.forEach((f, i) => f.frequency.setTargetAtTime(branches[i]!.freq * (1 + 0.22 * intensity), now, 0.8));
  };
  // 처음엔 서서히 켜진다 (같은 방식의 자동화만 써서 이어지는 변화가 서로 부딪히지 않게 한다)
  master.gain.setValueAtTime(0.0001, ctx.currentTime);
  apply();

  // 가끔 웃음이 터지듯 소리가 한 번 부풀었다 가라앉는다
  const scheduleSwell = (): void => {
    const wait = (intensity > 0.5 ? 2500 + Math.random() * 3500 : 6500 + Math.random() * 7000);
    swellTimer = setTimeout(() => {
      if (stopped) return;
      apply(1.45 + Math.random() * 0.5 + intensity * 0.4);
      setTimeout(() => {
        if (!stopped) apply(1);
      }, 900 + Math.random() * 700);
      scheduleSwell();
    }, wait);
  };
  scheduleSwell();

  return {
    setIntensity(v: number) {
      intensity = Math.min(1, Math.max(0, v));
      if (!stopped) apply();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (swellTimer) clearTimeout(swellTimer);
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(0.0001, now, 0.12);
      const end = now + 0.6;
      try {
        src.stop(end);
        for (const l of lfos) l.stop(end);
      } catch {
        /* 이미 멈춤 */
      }
    },
  };
}

