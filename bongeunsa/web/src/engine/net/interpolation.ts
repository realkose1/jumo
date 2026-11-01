// 다른 사람 위치 보간. 서버가 초당 5~10번 묶어 보내는 위치를 그대로 그리면 뚝뚝 끊겨 보인다.
// 받은 위치들을 시간순으로 모아 두고, 조금 지난 시점(delayMs 전)의 위치를 두 점 사이에서 이어서 그린다.
export interface TrackSample {
  /** 받은 시각(ms, 단조 증가하는 기기 시계) */
  t: number;
  x: number;
  z: number;
  r: number;
}

/** 이보다 멀리 떨어진 두 위치 사이는 걸어서 간 게 아니라 순간이동으로 본다(미터) */
export const TELEPORT_DISTANCE = 6;
/** 그린 시점을 실제보다 이만큼 늦춘다. 한 사람의 위치는 초당 4번(250ms마다) 오므로 그 간격보다 조금 길게 */
export const INTERPOLATION_DELAY_MS = 320;

function lerpAngle(from: number, to: number, t: number): number {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * t;
}

export class PeerTrack {
  private samples: TrackSample[] = [];

  constructor(private readonly maxSamples = 8) {}

  get size(): number {
    return this.samples.length;
  }

  /** 가장 최근에 받은 위치 */
  latest(): TrackSample | null {
    return this.samples[this.samples.length - 1] ?? null;
  }

  /** 모은 위치를 모두 버리고 이 위치에서 다시 시작한다 (자리에서 일어날 때, 처음 들어올 때) */
  reset(x: number, z: number, r: number, t: number): void {
    this.samples = [{ t, x, z, r }];
  }

  push(x: number, z: number, r: number, t: number): void {
    const last = this.samples[this.samples.length - 1];
    if (last && t <= last.t) t = last.t + 1; // 같은 순간에 두 번 오면 한 칸 뒤로 민다
    this.samples.push({ t, x, z, r });
    if (this.samples.length > this.maxSamples) this.samples.shift();
  }

  /** t 시점의 위치. 모은 게 없으면 null, 마지막 위치를 지났으면 마지막 위치에 머문다 */
  at(t: number): { x: number; z: number; r: number } | null {
    const s = this.samples;
    if (s.length === 0) return null;
    const first = s[0]!;
    if (t <= first.t) return { x: first.x, z: first.z, r: first.r };
    for (let i = 0; i < s.length - 1; i++) {
      const a = s[i]!;
      const b = s[i + 1]!;
      if (t > b.t) continue;
      if (Math.hypot(b.x - a.x, b.z - a.z) > TELEPORT_DISTANCE) {
        const p = t < b.t ? a : b;
        return { x: p.x, z: p.z, r: p.r };
      }
      const k = (t - a.t) / (b.t - a.t);
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, r: lerpAngle(a.r, b.r, k) };
    }
    const last = s[s.length - 1]!;
    return { x: last.x, z: last.z, r: last.r };
  }
}
