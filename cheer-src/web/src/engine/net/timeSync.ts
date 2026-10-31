// 서버 시각 보정 계산. docs/engine.md 3장 '서버 시각 보정'을 그대로 옮긴 것이다.
//   왕복 = 지금 - c        (c는 ping을 보낸 기기 시각)
//   차이 = pong.now + 왕복 / 2 - 지금   (서버 시각 - 기기 시각)
// 처음엔 welcome.now로 먼저 맞추고(왕복을 모르니 임시 값), 몇 번 재서 왕복이 가장 짧은 값을 쓴다.

export interface TimeSample {
  /** 왕복 시간(ms). welcome에서 얻은 임시 값은 Infinity */
  rttMs: number;
  /** 서버 시각 - 기기 시각 (ms) */
  offsetMs: number;
}

/** pong 하나로 한 번 잰 값. 보낸 시각보다 받은 시각이 앞서면(기기 시계가 뒤로 갔다) null */
export function sampleFromPong(sentAtMs: number, receivedAtMs: number, serverNowMs: number): TimeSample | null {
  const rtt = receivedAtMs - sentAtMs;
  if (!Number.isFinite(rtt) || rtt < 0 || !Number.isFinite(serverNowMs)) return null;
  return { rttMs: rtt, offsetMs: serverNowMs + rtt / 2 - receivedAtMs };
}

/** welcome에 실린 서버 시각으로 만든 임시 값. 왕복을 모르니 받은 순간에 서버가 보냈다고 친다 */
export function sampleFromWelcome(serverNowMs: number, receivedAtMs: number): TimeSample | null {
  if (!Number.isFinite(serverNowMs)) return null;
  return { rttMs: Number.POSITIVE_INFINITY, offsetMs: serverNowMs - receivedAtMs };
}

export class TimeSync {
  private samples: TimeSample[] = [];

  /** @param keep 기억해 둘 최근 잰 값 개수. 오래된 값이 밀려나야 기기 시계가 흘러도 따라간다 */
  constructor(private readonly keep = 8) {}

  add(sample: TimeSample | null): void {
    if (!sample) return;
    this.samples.push(sample);
    // 잰 값이 하나라도 있으면 임시 값은 버린다
    if (sample.rttMs !== Number.POSITIVE_INFINITY) {
      this.samples = this.samples.filter((s) => s.rttMs !== Number.POSITIVE_INFINITY);
    }
    if (this.samples.length > this.keep) this.samples.splice(0, this.samples.length - this.keep);
  }

  /** 왕복이 가장 짧은 값. 같으면 더 최근 것. 아직 아무것도 없으면 null */
  best(): TimeSample | null {
    let best: TimeSample | null = null;
    for (const s of this.samples) {
      if (best === null || s.rttMs <= best.rttMs) best = s;
    }
    return best;
  }

  reset(): void {
    this.samples = [];
  }
}
