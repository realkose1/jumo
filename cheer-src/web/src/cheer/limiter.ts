// 24명이 동시에 눌러도 소리와 이모지가 한꺼번에 쏟아지지 않게 하는 조절 장치.
// 내 동작은 언제나 보이고 들리고, 남의 동작만 이 장치를 거친다.

/** 창(windowMs) 안에 최대 max번 */
export class BudgetLimiter {
  private readonly stamps: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** 지금 써도 되면 true (쓴 것으로 센다) */
  take(now: number): boolean {
    while (this.stamps.length > 0 && now - this.stamps[0]! >= this.windowMs) this.stamps.shift();
    if (this.stamps.length >= this.max) return false;
    this.stamps.push(now);
    return true;
  }

  reset(): void {
    this.stamps.length = 0;
  }
}

export interface RemoteCueLimits {
  /** 같은 동작 소리: 이 시간(ms) 안에 최대 몇 번 */
  soundPerActionMax: number;
  soundPerActionWindowMs: number;
  /** 모든 동작 소리 합쳐서 */
  soundTotalMax: number;
  soundTotalWindowMs: number;
  /** 머리 위 이모지 */
  emojiMax: number;
  emojiWindowMs: number;
}

export const DEFAULT_REMOTE_LIMITS: RemoteCueLimits = {
  soundPerActionMax: 2,
  soundPerActionWindowMs: 350,
  soundTotalMax: 6,
  soundTotalWindowMs: 1000,
  emojiMax: 9,
  emojiWindowMs: 600,
};

export class RemoteCueLimiter {
  private readonly perAction = new Map<string, BudgetLimiter>();
  private readonly total: BudgetLimiter;
  private readonly emoji: BudgetLimiter;

  constructor(private readonly limits: RemoteCueLimits = DEFAULT_REMOTE_LIMITS) {
    this.total = new BudgetLimiter(limits.soundTotalMax, limits.soundTotalWindowMs);
    this.emoji = new BudgetLimiter(limits.emojiMax, limits.emojiWindowMs);
  }

  allowSound(actionId: string, now: number): boolean {
    let own = this.perAction.get(actionId);
    if (!own) {
      own = new BudgetLimiter(this.limits.soundPerActionMax, this.limits.soundPerActionWindowMs);
      this.perAction.set(actionId, own);
    }
    // 같은 동작 한도를 먼저 보고, 통과해야 전체 한도를 쓴다
    if (!own.take(now)) return false;
    return this.total.take(now);
  }

  allowEmoji(now: number): boolean {
    return this.emoji.take(now);
  }
}
