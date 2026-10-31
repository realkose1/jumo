// 들어오자마자 TV 한가운데에 가까운 빈 방석에 앉는다. 못 앉으면(그새 다른 사람이 앉음) 다음 자리로.
export interface SeatPort {
  /** 다른 사람이 앉아 있거나 모르는 자리면 true */
  isSeatTaken(seatId: string): boolean;
  /** 그 자리로 걸어가 앉는다. 시작하지 못하면 false */
  sitAtSeat(seatId: string): boolean;
}

export class AutoSeater {
  private tried = new Set<string>();
  private attempts = 0;
  private active = false;
  /** 지금 걸어가는 중인 자리. 다른 자리의 거절 소식에는 반응하지 않는다 */
  private pending: string | null = null;

  constructor(
    /** 앉고 싶은 순서대로 */
    private readonly order: readonly string[],
    private readonly port: SeatPort,
    private readonly maxAttempts = 12,
  ) {}

  get running(): boolean {
    return this.active;
  }

  /** 첫 자리를 고른다. 자리가 하나도 없으면 false */
  start(): boolean {
    this.active = true;
    this.tried = new Set();
    this.attempts = 0;
    return this.next();
  }

  /** 어딘가에 앉았다: 끝 */
  onSeated(): void {
    this.active = false;
    this.pending = null;
  }

  /** 못 앉았다: 그 자리는 빼고 다음 자리로 (우리가 고른 자리일 때만) */
  onDenied(seatId: string): void {
    if (!this.active || seatId !== this.pending) return;
    this.tried.add(seatId);
    this.next();
  }

  /** 사용자가 직접 다른 곳으로 가기로 했거나 시간이 지났다 */
  cancel(): void {
    this.active = false;
    this.pending = null;
  }

  private next(): boolean {
    while (this.active && this.attempts < this.maxAttempts) {
      const id = this.order.find((s) => !this.tried.has(s) && !this.port.isSeatTaken(s));
      if (!id) break;
      this.attempts += 1;
      this.tried.add(id);
      if (this.port.sitAtSeat(id)) {
        this.pending = id;
        return true;
      }
    }
    this.active = false;
    this.pending = null;
    return false;
  }
}
