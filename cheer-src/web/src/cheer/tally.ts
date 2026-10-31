// 골 순간 뒤 10초 동안 방 사람들이 보낸 동작을 센다 (내 동작과 남의 동작 모두).
export const TALLY_WINDOW_MS = 10_000;
/** 10초가 끝난 뒤 합계를 TV에 더 보여주는 시간 */
export const TALLY_HOLD_MS = 4_000;

export type TallyPhase = 'live' | 'done' | 'off';

export interface TallySnapshot {
  phase: TallyPhase;
  counts: Record<string, number>;
  total: number;
}

export class ActionTally {
  private startedAt: number | null = null;
  private counts: Record<string, number> = {};

  /** 새로 세기 시작한다 (이전 합계는 지운다) */
  start(now: number): void {
    this.startedAt = now;
    this.counts = {};
  }

  /** 세는 중에만 더한다 */
  add(actionId: string, now: number): void {
    if (this.startedAt === null || now - this.startedAt > TALLY_WINDOW_MS) return;
    this.counts[actionId] = (this.counts[actionId] ?? 0) + 1;
  }

  snapshot(now: number): TallySnapshot {
    const counts = { ...this.counts };
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (this.startedAt === null) return { phase: 'off', counts, total };
    const age = now - this.startedAt;
    const phase: TallyPhase = age <= TALLY_WINDOW_MS ? 'live' : age <= TALLY_WINDOW_MS + TALLY_HOLD_MS ? 'done' : 'off';
    return { phase, counts, total };
  }

  clear(): void {
    this.startedAt = null;
    this.counts = {};
  }
}
