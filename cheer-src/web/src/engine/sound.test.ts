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
    const mixer = new SoundMixer({ ambient: {}, shared: { synth: true }, effects: { oneShots: { a: 'a.mp3' } } });
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
