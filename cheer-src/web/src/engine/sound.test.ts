import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundMixer } from './sound';
import { SpaceStorage, type StorageBackend } from './storage';
import type { SoundLayers } from './types';

/** WebAudio 흉내: 노드는 연결만 받고, 소리는 나지 않는다 */
class FakeParam {
  value = 0;
  setValueAtTime(v: number): void {
    this.value = v;
  }
  setTargetAtTime(v: number): void {
    this.value = v;
  }
  exponentialRampToValueAtTime(v: number): void {
    this.value = v;
  }
  cancelScheduledValues(): void {}
}
class FakeNode {
  gain = new FakeParam();
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
  connect(n: unknown): unknown {
    return n;
  }
  disconnect(): void {}
}
class FakeAudioContext {
  currentTime = 0;
  state = 'running';
  destination = new FakeNode();
  createGain = (): FakeNode => new FakeNode();
  createDynamicsCompressor = (): FakeNode => new FakeNode();
  resume = (): Promise<void> => Promise.resolve();
  suspend = (): Promise<void> => Promise.resolve();
  close = (): Promise<void> => Promise.resolve();
}

function memoryBackend(): StorageBackend & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const layers: SoundLayers = {
  music: { synth: true, defaultOn: true, defaultVolume: 0.4 },
  ambient: { synth: true, defaultOn: true, defaultVolume: 0.4 },
  shared: { synth: true, defaultOn: true, defaultVolume: 0.8 },
  effects: { synth: true, defaultOn: false },
};

beforeEach(() => {
  vi.stubGlobal('window', { AudioContext: FakeAudioContext });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SoundMixer (공간이 직접 만든 소리)', () => {
  it('공간이 정한 처음 켜짐과 크기를 따르고, 소리가 있다고 알린다', () => {
    const mixer = new SoundMixer(layers, { storage: new SpaceStorage('t', memoryBackend()) });
    const s = mixer.getState();
    expect(s.layers.ambient).toMatchObject({ enabled: true, volume: 0.4, hasFiles: true });
    expect(s.layers.shared).toMatchObject({ enabled: true, volume: 0.8 });
    expect(s.layers.effects).toMatchObject({ enabled: false, volume: 0.7 }); // 기본 크기
    expect(s.unlocked).toBe(false);
  });

  it('화면을 누르기 전에는 연결 지점이 없고, 누르면 생긴다', () => {
    const mixer = new SoundMixer(layers, { storage: new SpaceStorage('t', memoryBackend()) });
    expect(mixer.getAudio()).toBeNull();
    expect(mixer.unlock()).toBe(true);
    const audio = mixer.getAudio();
    expect(audio).not.toBeNull();
    expect(audio!.isEnabled('ambient')).toBe(true);
    expect(audio!.isEnabled('effects')).toBe(false);
  });

  it('켜져 있는 층의 이어지는 소리는 누르는 순간 시작하고, 끄면 멈춘다', () => {
    const mixer = new SoundMixer(layers, { storage: new SpaceStorage('t', memoryBackend()) });
    const stop = vi.fn();
    const start = vi.fn(() => stop);
    mixer.setSynthLoop('ambient', { start });
    expect(start).not.toHaveBeenCalled(); // 아직 소리를 낼 수 없다
    mixer.unlock();
    expect(start).toHaveBeenCalledTimes(1);
    mixer.setEnabled('ambient', false);
    expect(stop).toHaveBeenCalledTimes(1);
    mixer.setEnabled('ambient', true);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('이미 소리가 열린 뒤에 등록해도 바로 시작한다, 꺼진 층은 시작하지 않는다', () => {
    const mixer = new SoundMixer(layers, { storage: new SpaceStorage('t', memoryBackend()) });
    mixer.unlock();
    const effectsStart = vi.fn(() => () => undefined);
    mixer.setSynthLoop('effects', { start: effectsStart });
    expect(effectsStart).not.toHaveBeenCalled();
    const ambientStart = vi.fn(() => () => undefined);
    mixer.setSynthLoop('ambient', { start: ambientStart });
    expect(ambientStart).toHaveBeenCalledTimes(1);
  });

  it('사용자가 직접 켜고 끈 값은 기억하고, 다음에는 그것을 따른다', () => {
    const backend = memoryBackend();
    const first = new SoundMixer(layers, { storage: new SpaceStorage('t', backend) });
    first.unlock();
    first.setEnabled('ambient', false);
    first.setEnabled('effects', true);
    first.setVolume('shared', 0.3);
    const second = new SoundMixer(layers, { storage: new SpaceStorage('t', backend) });
    const s = second.getState();
    expect(s.layers.ambient.enabled).toBe(false);
    expect(s.layers.effects.enabled).toBe(true);
    expect(s.layers.shared.volume).toBeCloseTo(0.3);
  });

  it('소리 없음 표시는 파일도 직접 만든 소리도 없는 층에만', () => {
    const mixer = new SoundMixer({ music: {}, ambient: {}, shared: { synth: true }, effects: { oneShots: { a: 'a.mp3' } } });
    const s = mixer.getState().layers;
    expect(s.ambient.hasFiles).toBe(false);
    expect(s.shared.hasFiles).toBe(true);
    expect(s.effects.hasFiles).toBe(true);
  });

  it('dispose하면 이어지는 소리를 멈춘다', () => {
    const mixer = new SoundMixer(layers, { storage: new SpaceStorage('t', memoryBackend()) });
    const stop = vi.fn();
    mixer.setSynthLoop('ambient', { start: () => stop });
    mixer.unlock();
    mixer.dispose();
    expect(stop).toHaveBeenCalled();
  });
});

describe('SoundMixer 배경 음악 층 (환경음에서 나뉨)', () => {
  it('배경 음악과 환경음은 따로 켜고 끈다', () => {
    const mixer = new SoundMixer(layers, { storage: new SpaceStorage('t', memoryBackend()) });
    const music = vi.fn(() => () => undefined);
    const musicStop = vi.fn();
    const kitchenStop = vi.fn();
    mixer.setSynthLoop('music', { start: () => (music(), musicStop) });
    mixer.setSynthLoop('ambient', { start: () => kitchenStop });
    mixer.unlock();
    expect(music).toHaveBeenCalledTimes(1);
    mixer.setEnabled('music', false);
    expect(musicStop).toHaveBeenCalled();
    expect(kitchenStop).not.toHaveBeenCalled();
    const audio = mixer.getAudio()!;
    expect(audio.isEnabled('music')).toBe(false);
    expect(audio.isEnabled('ambient')).toBe(true);
    expect(audio.out.music).toBeDefined();
  });

  it('나뉘기 전에 환경음에 정해 둔 값을 음악이 한 번 물려받는다', () => {
    const backend = memoryBackend();
    // 나뉘기 전 판이 남긴 값(음악 값·나뉨 표시 없음)
    const before = new SpaceStorage('t', backend);
    before.set('sound.enabled.ambient', false);
    before.set('sound.volume.ambient', 0.15);
    const s = new SoundMixer(layers, { storage: new SpaceStorage('t', backend) }).getState().layers;
    expect(s.music.enabled).toBe(false);
    expect(s.music.volume).toBeCloseTo(0.15);
    expect(s.ambient.enabled).toBe(false);
  });

  it('물려받기는 처음 한 번뿐 — 나뉜 뒤에 부엌 소리만 끄면 음악은 그대로', () => {
    const backend = memoryBackend();
    const first = new SoundMixer(layers, { storage: new SpaceStorage('t', backend) });
    first.unlock();
    first.setEnabled('ambient', false);
    const s = new SoundMixer(layers, { storage: new SpaceStorage('t', backend) }).getState().layers;
    expect(s.music.enabled).toBe(true);
    expect(s.ambient.enabled).toBe(false);
  });

  it('아무것도 정한 적 없으면 공간이 정한 처음 값', () => {
    const s = new SoundMixer(layers, { storage: new SpaceStorage('t', memoryBackend()) }).getState().layers;
    expect(s.music).toMatchObject({ enabled: true, volume: 0.4, hasFiles: true });
  });
});

describe('SoundMixer 모두 끄기 (위쪽 스피커 버튼)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('처음에는 켜져 있고, 끄면 층 설정은 그대로 두고 장면에는 꺼진 것으로 알린다', () => {
    const mixer = new SoundMixer(layers, { storage: new SpaceStorage('t', memoryBackend()) });
    expect(mixer.getState().muted).toBe(false);
    mixer.unlock();
    expect(mixer.getAudio()!.isEnabled('ambient')).toBe(true);
    mixer.setMuted(true);
    const s = mixer.getState();
    expect(s.muted).toBe(true);
    expect(s.layers.ambient.enabled).toBe(true);
    expect(mixer.getAudio()!.isEnabled('ambient')).toBe(false);
    mixer.setMuted(false);
    expect(mixer.getAudio()!.isEnabled('ambient')).toBe(true);
  });

  it('끈 값은 기억하고, 첫 누르기 전에 꺼 두어도 소리가 열릴 때 따른다', () => {
    const backend = memoryBackend();
    const first = new SoundMixer(layers, { storage: new SpaceStorage('t', backend) });
    first.setMuted(true);
    const second = new SoundMixer(layers, { storage: new SpaceStorage('t', backend) });
    expect(second.isMuted()).toBe(true);
    second.unlock();
    expect(second.getAudio()!.isEnabled('shared')).toBe(false);
  });

  it('꺼 두면 소리가 잦아든 뒤 장치를 멈추고, 다시 켜면 깨운다', () => {
    vi.useFakeTimers();
    const mixer = new SoundMixer(layers, { storage: new SpaceStorage('t', memoryBackend()) });
    mixer.unlock();
    const ctx = mixer.getAudio()!.ctx;
    const suspend = vi.spyOn(ctx, 'suspend');
    const resume = vi.spyOn(ctx, 'resume');
    mixer.setMuted(true);
    expect(suspend).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(suspend).toHaveBeenCalledTimes(1);
    mixer.setMuted(false);
    expect(resume).toHaveBeenCalled();
  });

  it('껐다가 금방 다시 켜면 장치를 멈추지 않는다', () => {
    vi.useFakeTimers();
    const mixer = new SoundMixer(layers, { storage: new SpaceStorage('t', memoryBackend()) });
    mixer.unlock();
    const suspend = vi.spyOn(mixer.getAudio()!.ctx, 'suspend');
    mixer.setMuted(true);
    mixer.setMuted(false);
    vi.advanceTimersByTime(1000);
    expect(suspend).not.toHaveBeenCalled();
  });
});
