// 연결 하나의 속도 제한. 1초 단위 창에서 종류별 횟수를 센다. 메모리에만 두며, 휴면 뒤에는 새로 시작해도 괜찮다.
import { LIMITS } from '../../shared/protocol';

export type RateKind = 'any' | 'move' | 'state' | 'seat' | 'act';

// 정상 화면이 1초에 보내는 양: move 4 + 동작 셋(같은 동작 1초 1번) + 가끔 sit/stand, 시각 ping. 합계 12면 넉넉하고,
// 스크립트가 유효한 메시지를 초당 수십 개씩 계속 보내지는 못한다.
const CAPS: Record<RateKind, number> = {
  any: 12, // 모든 메시지 합계
  move: LIMITS.moveHz,
  state: LIMITS.stateHz,
  seat: 3, // sit + stand
  act: 4, // 모든 동작 합계(같은 동작 1초 1번은 따로 본다)
};

export class RateWindow {
  private windowStart = 0;
  private counts: Record<RateKind, number> = { any: 0, move: 0, state: 0, seat: 0, act: 0 };
  /** 이번 창에서 막은 횟수. 계속 크면 연결을 닫는 데 쓴다 */
  dropped = 0;
  private lastAct = new Map<string, number>();

  /** 이번 창에서 틀린 메시지를 받은 횟수 */
  bad = 0;

  private roll(now: number): void {
    const w = Math.floor(now / 1000);
    if (w !== this.windowStart) {
      this.windowStart = w;
      this.counts = { any: 0, move: 0, state: 0, seat: 0, act: 0 };
      this.dropped = 0;
      this.bad = 0;
    }
  }

  /** 틀린 메시지를 받았다. 이번 창의 횟수를 돌려준다 */
  strike(now: number): number {
    this.roll(now);
    return ++this.bad;
  }

  /** 보내도 되면 true. 넘치면 false(그 메시지는 버린다) */
  take(kind: RateKind, now: number): boolean {
    this.roll(now);
    if (this.counts.any >= CAPS.any || this.counts[kind] >= CAPS[kind]) {
      this.dropped++;
      return false;
    }
    this.counts.any++;
    if (kind !== 'any') this.counts[kind]++; // ping처럼 종류가 any인 메시지를 두 번 세지 않는다
    return true;
  }

  /** 같은 동작은 cooldownMs에 한 번. 통과하면 지금 시각을 기록한다 */
  takeAct(actId: string, now: number, cooldownMs: number): boolean {
    const last = this.lastAct.get(actId);
    if (last !== undefined && now - last < cooldownMs) return false;
    this.lastAct.set(actId, now);
    return true;
  }
}
