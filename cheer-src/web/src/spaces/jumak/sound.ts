// 주막의 소리: 동작(박수, 건배, 주문), 경기 순간(골, 킥오프, 실점, 끝), 깔리는 부엌 소리(가마솥, 전 부치기).
// 소리 만드는 법은 recipes.ts(동작, 순간), kitchen.ts(부엌), music.ts(배경 음악)에 있고, 여기서는 층(효과음, 공동 소리,
// 환경음)에 이어 주고 켜짐/꺼짐과 크기는 엔진의 SoundMixer가 맡는다.
import type { MomentSound } from '../../cheer/moments';
import type { SoundLayerId, SoundMixer, SynthAudio } from '../../engine/sound';
import { startKitchen, type Kitchen } from './kitchen';
import { startMusic, type JumakMusic } from './music';
import * as recipes from './recipes';

export type SoundSource = 'self' | 'peer';

/** 남의 동작 소리는 내 것보다 작게 */
const PEER_GAIN = 0.36;

interface Bus {
  ctx: AudioContext;
  /** 소리를 보내는 곳: 층으로 곧장 가고, 일부는 잔향을 거친다 */
  input: GainNode;
}

export class JumakSound {
  private readonly buses = new Map<SoundLayerId, Bus>();
  private kitchen: Kitchen | null = null;
  private music: JumakMusic | null = null;
  private intensity = 0;

  constructor(private readonly mixer: SoundMixer) {
    // 환경음 층이 켜져 있는 동안 부엌 소리(가마솥 보글거림, 전 부치는 지글거림)와
    // 배경 음악(한산할 땐 가야금, 경기 중엔 장구 응원가)이 돈다
    mixer.setSynthLoop('ambient', {
      start: (ctx, out) => {
        const kitchen = startKitchen(ctx, out);
        kitchen.setIntensity(this.intensity);
        this.kitchen = kitchen;
        const music = startMusic(ctx, out, this.intensity > 0);
        this.music = music;
        return () => {
          kitchen.stop();
          music.stop();
          if (this.kitchen === kitchen) this.kitchen = null;
          if (this.music === music) this.music = null;
        };
      },
    });
  }

  /** 경기가 진행 중이면 부엌에서 전을 더 자주 부치고, 음악이 장구 응원가로 바뀐다 */
  setLive(live: boolean): void {
    this.intensity = live ? 1 : 0;
    this.kitchen?.setIntensity(this.intensity);
    this.music?.setLive(live);
  }

  /** 박수, 건배, 주문(딸랑). 내 동작은 크게, 남의 동작은 작게 */
  action(actionId: string, source: SoundSource): void {
    const audio = this.mixer.getAudio();
    if (!audio || !this.canPlay(audio, 'effects')) return;
    const bus = this.bus(audio, 'effects');
    const mine = source === 'self';
    const cue = this.cue(audio, mine ? 1 : PEER_GAIN);
    switch (actionId) {
      case 'clap':
        recipes.clap(audio.ctx, bus.input, cue, mine ? 3 : 2);
        break;
      case 'toast':
        recipes.toast(audio.ctx, bus.input, cue, mine ? 2 : 1);
        break;
      case 'order':
        recipes.bell(audio.ctx, bus.input, cue, mine ? 2 : 1);
        break;
      default:
        break;
    }
  }

  /** 음식이 상에 놓일 때 쿵. 남의 음식은 작게 */
  dishDown(source: SoundSource): void {
    const audio = this.mixer.getAudio();
    if (!audio || !this.canPlay(audio, 'effects')) return;
    recipes.clunk(audio.ctx, this.bus(audio, 'effects').input, this.cue(audio, source === 'self' ? 0.9 : PEER_GAIN));
  }

  /** 경기 순간: 모두가 함께 듣는 소리(공동 소리 층) */
  moment(kind: MomentSound): void {
    const audio = this.mixer.getAudio();
    if (!audio || !this.canPlay(audio, 'shared')) return;
    const bus = this.bus(audio, 'shared');
    const cue = this.cue(audio, 1);
    switch (kind) {
      case 'goal':
        recipes.goal(audio.ctx, bus.input, cue);
        break;
      case 'kickoff':
        recipes.kickoff(audio.ctx, bus.input, cue);
        break;
      case 'concede':
        recipes.concede(audio.ctx, bus.input, { ...cue, gain: 0.8 });
        break;
      case 'final-win':
        recipes.finalWhistle(audio.ctx, bus.input, cue, true);
        break;
      case 'final':
        recipes.finalWhistle(audio.ctx, bus.input, { ...cue, gain: 0.8 }, false);
        break;
    }
  }

  dispose(): void {
    this.mixer.setSynthLoop('ambient', null);
    this.kitchen = null;
    this.music = null;
    for (const b of this.buses.values()) b.input.disconnect();
    this.buses.clear();
  }

  /** 켜져 있고 장치가 돌고 있을 때만. 멈춘 장치(다른 탭에 가 있는 동안)에 예약하면 돌아왔을 때 한꺼번에 터진다 */
  private canPlay(audio: SynthAudio, layer: SoundLayerId): boolean {
    return audio.isEnabled(layer) && audio.ctx.state === 'running';
  }

  private cue(audio: SynthAudio, gain: number): recipes.Cue {
    return { t: audio.ctx.currentTime + 0.01, gain, rand: Math.random };
  }

  /** 층마다 입구 하나: 마른 소리와 잔향을 섞어 층으로 보낸다. 오디오 장치가 바뀌면 새로 만든다 */
  private bus(audio: SynthAudio, layer: SoundLayerId): Bus {
    const cached = this.buses.get(layer);
    if (cached && cached.ctx === audio.ctx) return cached;
    cached?.input.disconnect();
    const ctx = audio.ctx;
    const input = ctx.createGain();
    input.connect(audio.out[layer]);
    const send = ctx.createGain();
    send.gain.value = layer === 'shared' ? 0.28 : 0.16;
    const verb = ctx.createConvolver();
    verb.buffer = recipes.reverbImpulse(ctx, layer === 'shared' ? 1.5 : 0.9, 3);
    input.connect(send).connect(verb).connect(audio.out[layer]);
    const bus = { ctx, input };
    this.buses.set(layer, bus);
    return bus;
  }
}
