import { describe, expect, it } from 'vitest';
import { FrameMonitor, detectTier, lowerTier, parseTier, qualitySettings } from './quality';

describe('quality', () => {
  it('등급마다 설정이 낮아진다', () => {
    expect(qualitySettings('high').shadows).toBe(true);
    expect(qualitySettings('low').shadows).toBe(false);
    // 휴대폰에서 찌글거리지 않게 가장 낮은 등급도 1.5배 해상도와 안티앨리어싱은 지킨다
    expect(qualitySettings('low').pixelRatioCap).toBe(1.5);
    expect(qualitySettings('low').antialias).toBe(true);
    expect(qualitySettings('medium').shadowMapSize).toBeLessThan(qualitySettings('high').shadowMapSize);
  });

  it('기기 단서로 등급을 고른다', () => {
    expect(detectTier({ hardwareConcurrency: 10, deviceMemory: 8 })).toBe('high');
    expect(detectTier({ hardwareConcurrency: 8, coarsePointer: true })).toBe('medium');
    // iOS가 코어 수를 낮게 알려도 터치 기기라는 이유만으로 low가 되지 않는다
    expect(detectTier({ hardwareConcurrency: 4, coarsePointer: true })).toBe('medium');
    expect(detectTier({ deviceMemory: 1 })).toBe('low');
  });

  it('한 단계씩 내려가다 low에서 멈춘다', () => {
    expect(lowerTier('high')).toBe('medium');
    expect(lowerTier('medium')).toBe('low');
    expect(lowerTier('low')).toBeNull();
  });

  it('?quality= 값 읽기', () => {
    expect(parseTier('low')).toBe('low');
    expect(parseTier('ultra')).toBeNull();
    expect(parseTier(null)).toBeNull();
  });
});

describe('FrameMonitor', () => {
  const run = (m: FrameMonitor, fps: number, seconds: number) => {
    let degrade = false;
    for (let i = 0; i < fps * seconds; i++) degrade ||= m.push(1 / fps);
    return degrade;
  };

  it('60fps면 괜찮다', () => {
    expect(run(new FrameMonitor(), 60, 10)).toBe(false);
  });

  it('15fps가 이어지면 낮추라고 알린다', () => {
    expect(run(new FrameMonitor(), 15, 10)).toBe(true);
  });

  it('시작 직후 워밍업 동안은 느려도 봐준다', () => {
    expect(run(new FrameMonitor(), 10, 2)).toBe(false);
  });
});
