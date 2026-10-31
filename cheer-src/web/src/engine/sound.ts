// 소리 네 층: 배경 음악, 환경음, 공동 소리, 효과음. Web Audio GainNode 네 개로 층을 나눈다.
// 소리 파일을 읽어 틀 수도 있고, 장면이 WebAudio로 직접 만든 소리를 층에 이을 수도 있다(getAudio, setSynthLoop).
// 사용자의 첫 누르기 뒤에야 소리가 난다(브라우저 자동 재생 규칙). 층의 처음 켜짐 여부와 크기는 공간 정의(SoundLayerDef)가 정한다.
import { Emitter, type Unsubscribe } from './events';
import type { SpaceStorage } from './storage';
import type { SoundLayerDef, SoundLayers } from './types';

export type SoundLayerId = 'music' | 'ambient' | 'shared' | 'effects';
/** 설정 창에 놓이는 순서이기도 하다 */
export const SOUND_LAYER_IDS: readonly SoundLayerId[] = ['music', 'ambient', 'shared', 'effects'];

/** 층마다 값을 하나씩 */
function perLayer<T>(make: (id: SoundLayerId) => T): Record<SoundLayerId, T> {
  return { music: make('music'), ambient: make('ambient'), shared: make('shared'), effects: make('effects') };
}

export interface SoundLayerState {
  enabled: boolean;
  /** 0~1 */
  volume: number;
  /** 이 공간이 이 층에 소리 파일을 갖고 있는지 (없으면 UI가 흐리게 보여줄 수 있다) */
  hasFiles: boolean;
}

export interface SoundState {
  /** 이 브라우저가 Web Audio를 지원하는지 */
  supported: boolean;
  /** 사용자가 화면을 한 번 눌러서 소리를 켤 수 있는 상태인지 */
  unlocked: boolean;
  keepPlayingInBackground: boolean;
  /** 위쪽 스피커 버튼으로 소리를 모두 껐는지. 층마다의 켜짐·크기는 그대로 두고 맨 끝에서 막는다 */
  muted: boolean;
  layers: Record<SoundLayerId, SoundLayerState>;
}

/** 장면이 만드는 계속 이어지는 소리(예: 웅성거림). 층이 켜질 때 start, 꺼질 때 start가 돌려준 함수를 부른다 */
export interface SynthLoopProvider {
  start(ctx: AudioContext, out: AudioNode): () => void;
}

/** 장면이 WebAudio로 소리를 직접 만들 때 쓰는 연결 지점. 사용자가 화면을 누르기 전에는 null */
export interface SynthAudio {
  ctx: AudioContext;
  /** 층마다 하나씩. 여기에 이으면 층의 켜기/끄기/크기가 그대로 적용된다 */
  out: Record<SoundLayerId, GainNode>;
  isEnabled(layer: SoundLayerId): boolean;
}

export interface SoundMixerOptions {
  storage?: SpaceStorage;
  /** 상대 경로를 실제 주소로 바꾼다 (SceneContext.assetUrl과 같은 것) */
  resolveUrl?: (path: string) => string;
}

const DEFAULT_VOLUME = 0.7;
const FADE_SECONDS = 0.05;
const GESTURE_EVENTS = ['pointerup', 'touchend', 'click', 'keydown'] as const;

type AudioCtor = typeof AudioContext;

function audioCtor(): AudioCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext;
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

export class SoundMixer {
  private readonly events = new Emitter<{ change: SoundState }>();
  private readonly storage?: SpaceStorage;
  private readonly resolveUrl: (path: string) => string;
  private readonly enabled: Record<SoundLayerId, boolean>;
  private readonly volume: Record<SoundLayerId, number>;
  private readonly synthProviders: Partial<Record<SoundLayerId, SynthLoopProvider>> = {};
  private readonly synthStops: Partial<Record<SoundLayerId, () => void>> = {};
  private readonly gains: Partial<Record<SoundLayerId, GainNode>> = {};
  private readonly loops: Partial<Record<SoundLayerId, AudioBufferSourceNode>> = {};
  private readonly loopToken: Record<SoundLayerId, number> = perLayer(() => 0);
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private unlocked = false;
  private keepPlaying: boolean;
  private muted: boolean;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private removeGestureListeners: (() => void) | null = null;

  constructor(
    private readonly layers: SoundLayers,
    options: SoundMixerOptions = {},
  ) {
    this.storage = options.storage;
    this.resolveUrl = options.resolveUrl ?? ((p) => p);
    this.splitMusicFromAmbient();
    const volumeOf = (id: SoundLayerId): number => {
      const fallback = layers[id].defaultVolume ?? DEFAULT_VOLUME;
      return clamp01(this.storage?.get(`sound.volume.${id}`, fallback) ?? fallback);
    };
    this.volume = perLayer(volumeOf);
    // 사용자가 직접 켜고 끈 값이 있으면 그것, 없으면 공간이 정한 처음 값
    const enabledOf = (id: SoundLayerId): boolean => {
      const saved = this.storage?.get<boolean | null>(`sound.enabled.${id}`, null);
      return typeof saved === 'boolean' ? saved : layers[id].defaultOn === true;
    };
    this.enabled = perLayer(enabledOf);
    // 처음에는 모두 켜 둔다: 다른 탭으로 가도 소리가 이어진다(사용자가 끄면 그 값을 기억한다)
    this.keepPlaying = this.storage?.get<boolean | null>('sound.keepPlaying', null) !== false;
    // 모두 끄기는 사용자가 켠 적이 있을 때만 (처음에는 꺼 두지 않는다)
    this.muted = this.storage?.get<boolean | null>('sound.muted', null) === true;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  getState(): SoundState {
    const layerState = (id: SoundLayerId): SoundLayerState => ({
      enabled: this.enabled[id],
      volume: this.volume[id],
      hasFiles: this.hasFiles(this.layers[id]),
    });
    return {
      supported: audioCtor() !== undefined,
      unlocked: this.unlocked,
      keepPlayingInBackground: this.keepPlaying,
      muted: this.muted,
      layers: perLayer(layerState),
    };
  }

  onChange(handler: (state: SoundState) => void): Unsubscribe {
    return this.events.on('change', handler);
  }

  /** 화면을 처음 누르거나 키를 누르는 순간 소리를 켤 수 있게 만든다 (한 번만) */
  installGestureUnlock(target: EventTarget = window): void {
    if (this.unlocked || this.removeGestureListeners) return;
    const handler = () => {
      this.unlock();
    };
    for (const type of GESTURE_EVENTS) target.addEventListener(type, handler, { capture: true, passive: true });
    this.removeGestureListeners = () => {
      for (const type of GESTURE_EVENTS) target.removeEventListener(type, handler, { capture: true });
      this.removeGestureListeners = null;
    };
  }

  /** 사용자 동작 안에서 부른다. 오디오 장치를 만들고 gain 구조를 잇는다. */
  unlock(): boolean {
    if (this.unlocked) return true;
    const Ctor = audioCtor();
    if (!Ctor) return false;
    try {
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 1;
      this.master = master;
      // 여럿이 한꺼번에 소리를 내도 찢어지지 않게 마지막에 가볍게 눌러 준다
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -14;
      limiter.knee.value = 12;
      limiter.ratio.value = 6;
      limiter.attack.value = 0.004;
      limiter.release.value = 0.25;
      master.connect(limiter);
      limiter.connect(ctx.destination);
      for (const id of SOUND_LAYER_IDS) {
        const g = ctx.createGain();
        g.gain.value = 0;
        g.connect(master);
        this.gains[id] = g;
      }
      this.ctx = ctx;
      this.unlocked = true;
      this.removeGestureListeners?.();
      this.syncSuspend();
      // 처음부터 켜져 있어야 하는 층을 켠다
      for (const id of SOUND_LAYER_IDS) {
        if (!this.enabled[id]) continue;
        this.applyGain(id);
        void this.startLoop(id);
      }
      this.emitChange();
      return true;
    } catch {
      return false;
    }
  }

  isEnabled(layer: SoundLayerId): boolean {
    return this.enabled[layer];
  }

  /** 아직 소리를 켤 수 없는 상태(첫 누르기 전)면 false */
  setEnabled(layer: SoundLayerId, on: boolean): boolean {
    if (!this.unlocked || !this.ctx) return false;
    if (this.enabled[layer] === on) return true;
    this.enabled[layer] = on;
    this.storage?.set(`sound.enabled.${layer}`, on);
    this.applyGain(layer);
    if (on) void this.startLoop(layer);
    else this.stopLoop(layer);
    this.emitChange();
    return true;
  }

  getVolume(layer: SoundLayerId): number {
    return this.volume[layer];
  }

  setVolume(layer: SoundLayerId, volume: number): void {
    this.volume[layer] = clamp01(volume);
    this.storage?.set(`sound.volume.${layer}`, this.volume[layer]);
    this.applyGain(layer);
    this.emitChange();
  }

  isKeepPlayingInBackground(): boolean {
    return this.keepPlaying;
  }

  /** 다른 탭으로 가도 계속 듣기 */
  setKeepPlayingInBackground(on: boolean): void {
    this.keepPlaying = on;
    this.storage?.set('sound.keepPlaying', on);
    this.syncSuspend();
    this.emitChange();
  }

  isMuted(): boolean {
    return this.muted;
  }

  /**
   * 소리를 모두 끄고 켠다(위쪽 스피커 버튼). 층마다의 켜짐·크기는 건드리지 않고 맨 끝(master)에서 줄인다.
   * 첫 누르기 전에도 값은 기억해 두었다가 소리가 열릴 때 따른다. 다시 켤 때 장치를 깨우므로 누르는 동작 안에서 부른다
   */
  setMuted(on: boolean): void {
    if (this.muted === on) return;
    this.muted = on;
    this.storage?.set('sound.muted', on);
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? 0 : 1, this.ctx.currentTime, FADE_SECONDS);
    this.syncSuspend();
    this.emitChange();
  }

  /** 장면이 직접 만든 소리를 이을 지점. 사용자가 화면을 누르기 전에는 null */
  getAudio(): SynthAudio | null {
    const ctx = this.ctx;
    if (!ctx || SOUND_LAYER_IDS.some((id) => !this.gains[id])) return null;
    const out = perLayer((id) => this.gains[id]!);
    // 모두 꺼 둔 동안은 층도 꺼진 것으로 알려 장면이 소리를 예약하지 않게 한다
    return { ctx, out, isEnabled: (layer) => this.enabled[layer] && !this.muted };
  }

  /** 층이 켜져 있는 동안 이어지는 소리를 장면이 만든다. 이미 켜져 있으면 바로 시작한다 */
  setSynthLoop(layer: SoundLayerId, provider: SynthLoopProvider | null): void {
    this.synthStops[layer]?.();
    delete this.synthStops[layer];
    if (provider) this.synthProviders[layer] = provider;
    else delete this.synthProviders[layer];
    if (provider && this.ctx && this.enabled[layer]) void this.startLoop(layer);
  }

  /** 효과음 층에서 한 번 소리를 낸다. 파일이 없거나 꺼져 있으면 아무 일도 없다. */
  playEffect(id: string): void {
    void this.playOneShot('effects', id);
  }

  /** 공동 소리 층에서 한 번 소리를 낸다 (종소리 등) */
  playShared(id: string): void {
    void this.playOneShot('shared', id);
  }

  dispose(): void {
    this.removeGestureListeners?.();
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
    for (const id of SOUND_LAYER_IDS) this.stopLoop(id);
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.events.clear();
  }

  // ---- 안쪽 ----

  /**
   * 배경 음악은 예전엔 환경음 층에 섞여 있었다. 나뉜 뒤 처음 한 번, 환경음에 정해 둔 켜짐·크기를 음악 값으로 적어 둔다
   * (환경음을 꺼 두었던 사람에게 음악이 다시 들리지 않게). 그 뒤로는 서로 따로 — 부엌 소리만 꺼도 음악은 그대로다
   */
  private splitMusicFromAmbient(): void {
    const storage = this.storage;
    if (!storage || storage.get<boolean>('sound.musicSplit', false)) return;
    for (const kind of ['enabled', 'volume'] as const) {
      const old = storage.get<unknown>(`sound.${kind}.ambient`, null);
      if (old != null && storage.get<unknown>(`sound.${kind}.music`, null) == null) storage.set(`sound.${kind}.music`, old);
    }
    storage.set('sound.musicSplit', true);
  }

  private hasFiles(def: SoundLayerDef): boolean {
    return def.synth === true || Boolean(def.loop) || Object.keys(def.oneShots ?? {}).length > 0;
  }

  private emitChange(): void {
    this.events.emit('change', this.getState());
  }

  private applyGain(layer: SoundLayerId): void {
    const gain = this.gains[layer];
    if (!gain || !this.ctx) return;
    const target = this.enabled[layer] ? this.volume[layer] : 0;
    gain.gain.setTargetAtTime(target, this.ctx.currentTime, FADE_SECONDS);
  }

  private loadBuffer(path: string): Promise<AudioBuffer | null> {
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve(null);
    const url = this.resolveUrl(path);
    let pending = this.buffers.get(url);
    if (!pending) {
      pending = fetch(url)
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
        .then((data) => ctx.decodeAudioData(data))
        .catch(() => null);
      this.buffers.set(url, pending);
    }
    return pending;
  }

  private async startLoop(layer: SoundLayerId): Promise<void> {
    const ctx = this.ctx;
    const gain = this.gains[layer];
    const provider = this.synthProviders[layer];
    if (provider && ctx && gain) {
      this.synthStops[layer]?.();
      try {
        this.synthStops[layer] = provider.start(ctx, gain);
      } catch (cause) {
        console.warn('[sound] 직접 만든 소리를 시작하지 못했어요', cause);
      }
      return;
    }
    const path = this.layers[layer].loop;
    if (!path || !ctx || !gain) return;
    const token = ++this.loopToken[layer];
    const buffer = await this.loadBuffer(path);
    if (!buffer || token !== this.loopToken[layer] || !this.enabled[layer] || this.ctx !== ctx) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start();
    this.loops[layer] = source;
  }

  private stopLoop(layer: SoundLayerId): void {
    this.loopToken[layer] += 1;
    const stopSynth = this.synthStops[layer];
    if (stopSynth) {
      delete this.synthStops[layer];
      try {
        stopSynth();
      } catch {
        /* 이미 멈춘 소리 */
      }
    }
    const source = this.loops[layer];
    if (!source) return;
    delete this.loops[layer];
    try {
      source.stop((this.ctx?.currentTime ?? 0) + 0.2); // 줄어드는 동안 두었다가 멈춘다
    } catch {
      /* 이미 멈춘 소리 */
    }
  }

  private async playOneShot(layer: SoundLayerId, id: string): Promise<void> {
    const path = this.layers[layer].oneShots?.[id];
    const ctx = this.ctx;
    const gain = this.gains[layer];
    if (!path || !ctx || !gain || !this.enabled[layer] || this.muted) return;
    const buffer = await this.loadBuffer(path);
    if (!buffer || this.ctx !== ctx) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    source.start();
  }

  private isHidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  }

  /** 탭이 숨겨지면 멈추고(기본), 돌아오면 다시 잇는다. 모두 꺼 두면 소리가 잦아든 뒤 장치도 멈춰 배터리를 아낀다 */
  private syncSuspend(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
    if (this.muted) {
      this.suspendTimer = setTimeout(() => {
        this.suspendTimer = null;
        if (this.muted) void ctx.suspend().catch(() => undefined);
      }, FADE_SECONDS * 6 * 1000);
      return;
    }
    if (this.isHidden() && !this.keepPlaying) void ctx.suspend().catch(() => undefined);
    else void ctx.resume().catch(() => undefined);
  }

  private readonly onVisibility = (): void => {
    this.syncSuspend();
  };
}
