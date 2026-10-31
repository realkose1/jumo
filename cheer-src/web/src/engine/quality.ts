// 성능 등급. 낮은 기기는 그림자와 해상도를 줄이고, 느려지면 스스로 한 단계씩 낮춘다.
export type QualityTier = 'high' | 'medium' | 'low';

export interface QualitySettings {
  tier: QualityTier;
  shadows: boolean;
  shadowMapSize: number;
  pixelRatioCap: number;
  antialias: boolean;
}

const TABLE: Record<QualityTier, QualitySettings> = {
  high: { tier: 'high', shadows: true, shadowMapSize: 1024, pixelRatioCap: 2, antialias: true },
  medium: { tier: 'medium', shadows: true, shadowMapSize: 512, pixelRatioCap: 1.5, antialias: true },
  low: { tier: 'low', shadows: false, shadowMapSize: 512, pixelRatioCap: 1, antialias: false },
};

export function qualitySettings(tier: QualityTier): QualitySettings {
  return { ...TABLE[tier] };
}

export function parseTier(value: string | null | undefined): QualityTier | null {
  return value === 'high' || value === 'medium' || value === 'low' ? value : null;
}

export function lowerTier(tier: QualityTier): QualityTier | null {
  if (tier === 'high') return 'medium';
  if (tier === 'medium') return 'low';
  return null;
}

export interface DeviceHints {
  hardwareConcurrency?: number;
  deviceMemory?: number;
  coarsePointer?: boolean;
}

export function readDeviceHints(): DeviceHints {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }) : undefined;
  let coarse = false;
  try {
    coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  } catch {
    coarse = false;
  }
  return {
    hardwareConcurrency: nav?.hardwareConcurrency,
    deviceMemory: nav?.deviceMemory,
    coarsePointer: coarse,
  };
}

export function detectTier(hints: DeviceHints = readDeviceHints()): QualityTier {
  const lowCpu = (hints.hardwareConcurrency ?? 8) <= 4;
  const lowMemory = (hints.deviceMemory ?? 8) <= 2;
  if (lowMemory || (hints.coarsePointer && lowCpu)) return 'low';
  if (hints.coarsePointer || lowCpu) return 'medium';
  return 'high';
}

export interface FrameMonitorOptions {
  /** 시작 직후 무시할 시간(ms). 첫 컴파일과 로딩 끊김을 제외한다 */
  warmupMs?: number;
  windowMs?: number;
  minFps?: number;
}

/** 일정 시간 평균 프레임이 기준보다 낮으면 push가 true를 돌려준다 */
export class FrameMonitor {
  private readonly warmupMs: number;
  private readonly windowMs: number;
  private readonly minFps: number;
  private warm = 0;
  private time = 0;
  private frames = 0;

  constructor(options: FrameMonitorOptions = {}) {
    this.warmupMs = options.warmupMs ?? 2500;
    this.windowMs = options.windowMs ?? 2500;
    this.minFps = options.minFps ?? 26;
  }

  reset(): void {
    this.warm = 0;
    this.time = 0;
    this.frames = 0;
  }

  push(dtSeconds: number): boolean {
    const ms = dtSeconds * 1000;
    if (this.warm < this.warmupMs) {
      this.warm += ms;
      return false;
    }
    this.time += ms;
    this.frames += 1;
    if (this.time < this.windowMs) return false;
    const fps = (this.frames * 1000) / this.time;
    this.time = 0;
    this.frames = 0;
    return fps < this.minFps;
  }
}
