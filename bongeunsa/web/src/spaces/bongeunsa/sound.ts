// 봉은사의 소리. 파일 없이 WebAudio로 만든다.
// 환경음: 솔바람, 처마 끝 풍경, (낮에는) 산새, 담장 너머 도시의 낮은 웅웅거림.
// 배경 음악: 느리게 울리는 싱잉볼과 대금 같은 긴 음 몇 개.
// 공동 소리: 범종(정시에 모두가 같은 순간에 듣는다). 효과음: 합장(싱잉볼), 목탁, 연등(작은 방울).
import type { SoundLayerId, SoundMixer, SynthAudio } from '../../engine/sound';

export type SoundSource = 'self' | 'peer';

/** 남의 동작 소리는 내 것보다 작게 */
const PEER_GAIN = 0.35;

function noiseBuffer(ctx: BaseAudioContext, seconds: number, brown = false): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  return buf;
}

function reverbImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

/** 한 번 울리는 사인파: 빠르게 올라가 decay초 동안 줄어든다 */
function partial(ctx: BaseAudioContext, out: AudioNode, t: number, freq: number, gain: number, decay: number, attack = 0.005): void {
  const o = ctx.createOscillator();
  o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + decay + 0.05);
}

/** 짧은 잡음 터짐(띠 거르개). 나무 두드림의 '딱' */
function knock(ctx: BaseAudioContext, out: AudioNode, t: number, freq: number, gain: number, decay: number): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 0.08);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = 6;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  src.connect(f).connect(g).connect(out);
  src.start(t);
  src.stop(t + 0.1);
}

// ---- 소리 조리법 ----
/** 목탁: 속이 빈 나무가 똑, 똑, 똑 */
export function moktak(ctx: BaseAudioContext, out: AudioNode, t0: number, gain: number, count = 3): void {
  for (let i = 0; i < count; i++) {
    const t = t0 + i * 0.28;
    const g = gain * (i === count - 1 ? 1 : 0.85);
    partial(ctx, out, t, 760, 0.5 * g, 0.16, 0.002);
    partial(ctx, out, t, 1180, 0.18 * g, 0.08, 0.002);
    knock(ctx, out, t, 1900, 0.35 * g, 0.05);
  }
}

/** 싱잉볼: 맑은 금속 그릇이 길게 웅- (조금 어긋난 두 음이 맥놀이를 만든다) */
export function singingBowl(ctx: BaseAudioContext, out: AudioNode, t: number, gain: number, base = 262): void {
  const ratios: Array<[number, number, number]> = [
    [1, 0.35, 5.5],
    [1.006, 0.25, 5.5],
    [2.71, 0.16, 3.5],
    [5.15, 0.07, 2],
    [8.4, 0.03, 1.2],
  ];
  for (const [r, a, d] of ratios) partial(ctx, out, t, base * r, a * gain, d, 0.01);
  knock(ctx, out, t, 3200, 0.08 * gain, 0.03);
}

/** 연등을 띄울 때 작은 방울 소리 */
export function chime(ctx: BaseAudioContext, out: AudioNode, t: number, gain: number, rand: () => number): void {
  const notes = [1046.5, 1174.7, 1318.5, 1568, 1760];
  const f = notes[Math.floor(rand() * notes.length)]!;
  partial(ctx, out, t, f, 0.22 * gain, 1.6, 0.003);
  partial(ctx, out, t, f * 2.76, 0.06 * gain, 0.6, 0.003);
  partial(ctx, out, t + 0.12, f * 1.5, 0.12 * gain, 1.2, 0.003);
}

/** 범종: 낮고 긴 울림. 아래 두 음이 조금 어긋나 '우웅- 우웅-' 맥놀이가 난다 */
export function templeBell(ctx: BaseAudioContext, out: AudioNode, t: number, gain: number): void {
  const base = 96;
  const parts: Array<[number, number, number]> = [
    [0.5, 0.42, 16],
    [0.503, 0.36, 16],
    [1, 0.3, 12],
    [1.19, 0.16, 9],
    [1.52, 0.12, 7],
    [2.02, 0.1, 6],
    [2.68, 0.06, 4],
    [3.3, 0.04, 3],
    [4.2, 0.025, 2],
  ];
  for (const [r, a, d] of parts) partial(ctx, out, t, base * r, a * gain, d, 0.02);
  // 당목이 종을 치는 둔한 '쿵'
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 0.4, true);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 260;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.9 * gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  src.connect(f).connect(g).connect(out);
  src.start(t);
}

// ---- 계속 도는 소리 ----
interface Loop {
  stop(): void;
}

/** 환경음: 솔바람(천천히 일렁이는 잡음), 도시 웅웅거림, 띄엄띄엄 풍경과 산새 */
function startAmbient(ctx: AudioContext, out: AudioNode, isDay: () => number): Loop {
  const master = ctx.createGain();
  master.gain.value = 0;
  master.gain.linearRampToValueAtTime(1, ctx.currentTime + 2);
  master.connect(out);
  // 솔바람
  const wind = ctx.createBufferSource();
  wind.buffer = noiseBuffer(ctx, 4);
  wind.loop = true;
  const wf = ctx.createBiquadFilter();
  wf.type = 'bandpass';
  wf.frequency.value = 520;
  wf.Q.value = 0.6;
  const wg = ctx.createGain();
  wg.gain.value = 0.05;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.035;
  lfo.connect(lfoGain).connect(wg.gain);
  wind.connect(wf).connect(wg).connect(master);
  // 담장 너머 도시: 아주 낮은 갈색 잡음
  const city = ctx.createBufferSource();
  city.buffer = noiseBuffer(ctx, 5, true);
  city.loop = true;
  const cf = ctx.createBiquadFilter();
  cf.type = 'lowpass';
  cf.frequency.value = 180;
  const cg = ctx.createGain();
  cg.gain.value = 0.12;
  city.connect(cf).connect(cg).connect(master);
  wind.start();
  city.start();
  lfo.start();
  // 풍경과 산새는 띄엄띄엄
  let timer = 0;
  const tick = (): void => {
    const t = ctx.currentTime + 0.05;
    if (ctx.state === 'running') {
      if (Math.random() < 0.55) {
        // 풍경: 물고기 모양 추가 흔들려 맑은 쇳소리 한두 번
        const f = 1900 + Math.random() * 500;
        partial(ctx, master, t, f, 0.05, 2.4, 0.002);
        partial(ctx, master, t, f * 2.4, 0.015, 1, 0.002);
        if (Math.random() < 0.5) partial(ctx, master, t + 0.35, f * 1.12, 0.035, 2, 0.002);
      }
      if (isDay() > 0.5 && Math.random() < 0.6) {
        // 산새: 빠르게 오르내리는 짧은 휘파람 서너 번
        const n = 2 + Math.floor(Math.random() * 3);
        const base = 2600 + Math.random() * 1400;
        for (let i = 0; i < n; i++) {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          const s = t + i * 0.13;
          o.frequency.setValueAtTime(base, s);
          o.frequency.exponentialRampToValueAtTime(base * 1.35, s + 0.05);
          o.frequency.exponentialRampToValueAtTime(base * 0.9, s + 0.1);
          g.gain.setValueAtTime(0, s);
          g.gain.linearRampToValueAtTime(0.025, s + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, s + 0.11);
          o.connect(g).connect(master);
          o.start(s);
          o.stop(s + 0.12);
        }
      }
    }
    timer = window.setTimeout(tick, 3500 + Math.random() * 6000);
  };
  timer = window.setTimeout(tick, 1500);
  return {
    stop() {
      window.clearTimeout(timer);
      for (const s of [wind, city, lfo]) {
        try {
          s.stop();
        } catch {
          /* 이미 멈췄다 */
        }
      }
      master.disconnect();
    },
  };
}

/** 배경 음악: 느린 오음계 긴 음(대금 비슷한 숨결)과 가끔 싱잉볼 */
function startMusic(ctx: AudioContext, out: AudioNode): Loop {
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(out);
  const scale = [220, 246.9, 293.7, 329.6, 392, 440, 493.9];
  let timer = 0;
  let step = 0;
  const play = (): void => {
    const t = ctx.currentTime + 0.05;
    if (ctx.state === 'running') {
      if (step % 4 === 0) singingBowl(ctx, master, t, 0.5, scale[Math.floor(Math.random() * 3)]! / 2);
      const f = scale[Math.floor(Math.random() * scale.length)]!;
      const dur = 3 + Math.random() * 2.5;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const vib = ctx.createOscillator();
      vib.frequency.value = 4.5;
      const vg = ctx.createGain();
      vg.gain.setValueAtTime(0, t);
      vg.gain.linearRampToValueAtTime(f * 0.008, t + dur * 0.6);
      vib.connect(vg).connect(o.frequency);
      const breath = ctx.createBufferSource();
      breath.buffer = noiseBuffer(ctx, dur + 0.2);
      const bf = ctx.createBiquadFilter();
      bf.type = 'bandpass';
      bf.frequency.value = f * 2;
      bf.Q.value = 8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.06, t + 0.8);
      g.gain.setValueAtTime(0.06, t + dur - 1.2);
      g.gain.linearRampToValueAtTime(0, t + dur);
      const bg = ctx.createGain();
      bg.gain.value = 0.25;
      o.connect(g);
      breath.connect(bf).connect(bg).connect(g);
      g.connect(master);
      o.start(t);
      vib.start(t);
      breath.start(t);
      o.stop(t + dur + 0.1);
      vib.stop(t + dur + 0.1);
      breath.stop(t + dur + 0.1);
    }
    step++;
    timer = window.setTimeout(play, 4200 + Math.random() * 3800);
  };
  timer = window.setTimeout(play, 800);
  return {
    stop() {
      window.clearTimeout(timer);
      master.disconnect();
    },
  };
}

interface Bus {
  ctx: AudioContext;
  input: GainNode;
}

export class BongeunsaSound {
  private readonly buses = new Map<SoundLayerId, Bus>();

  constructor(
    private readonly mixer: SoundMixer,
    isDay: () => number,
  ) {
    mixer.setSynthLoop('ambient', {
      start: (ctx, out) => {
        const loop = startAmbient(ctx, out, isDay);
        return () => loop.stop();
      },
    });
    mixer.setSynthLoop('music', {
      start: (ctx, out) => {
        const loop = startMusic(ctx, out);
        return () => loop.stop();
      },
    });
  }

  /** 합장, 목탁, 연등 */
  action(actionId: string, source: SoundSource): void {
    const audio = this.mixer.getAudio();
    if (!audio || !this.canPlay(audio, 'effects')) return;
    const bus = this.bus(audio, 'effects');
    const gain = source === 'self' ? 1 : PEER_GAIN;
    const t = audio.ctx.currentTime + 0.01;
    switch (actionId) {
      case 'hapjang':
        singingBowl(audio.ctx, bus.input, t, gain);
        break;
      case 'moktak':
        moktak(audio.ctx, bus.input, t, gain);
        break;
      case 'lantern':
        chime(audio.ctx, bus.input, t, gain, Math.random);
        break;
      default:
        break;
    }
  }

  /** 범종 한 번 (공동 소리 층) */
  bell(): void {
    const audio = this.mixer.getAudio();
    if (!audio || !this.canPlay(audio, 'shared')) return;
    templeBell(audio.ctx, this.bus(audio, 'shared').input, audio.ctx.currentTime + 0.01, 1);
  }

  dispose(): void {
    this.mixer.setSynthLoop('ambient', null);
    this.mixer.setSynthLoop('music', null);
    for (const b of this.buses.values()) b.input.disconnect();
    this.buses.clear();
  }

  /** 켜져 있고 장치가 돌고 있을 때만. 멈춘 장치에 예약하면 돌아왔을 때 한꺼번에 터진다 */
  private canPlay(audio: SynthAudio, layer: SoundLayerId): boolean {
    return audio.isEnabled(layer) && audio.ctx.state === 'running';
  }

  /** 층마다 입구 하나: 마른 소리와 잔향(마당과 전각의 울림)을 섞는다 */
  private bus(audio: SynthAudio, layer: SoundLayerId): Bus {
    const cached = this.buses.get(layer);
    if (cached && cached.ctx === audio.ctx) return cached;
    cached?.input.disconnect();
    const ctx = audio.ctx;
    const input = ctx.createGain();
    input.connect(audio.out[layer]);
    const send = ctx.createGain();
    send.gain.value = layer === 'shared' ? 0.45 : 0.25;
    const verb = ctx.createConvolver();
    verb.buffer = reverbImpulse(ctx, layer === 'shared' ? 4 : 2, 3);
    input.connect(send).connect(verb).connect(audio.out[layer]);
    const bus = { ctx, input };
    this.buses.set(layer, bus);
    return bus;
  }
}
