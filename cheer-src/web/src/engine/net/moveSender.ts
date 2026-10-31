// 내 위치를 서버로 보낼지 정한다: 위치가 바뀌었을 때만, 초당 최대 moveHz번. 멈추면 보내지 않는다.
// 매 프레임 next()를 부르면 된다. 보낼 게 있으면 보낼 값을, 없으면 null을 돌려준다.
// 마지막으로 '보낸' 값과 비교하므로, 간격 때문에 못 보낸 마지막 위치도 다음 프레임에 빠짐없이 나간다.
import { LIMITS } from '@shared/protocol';

export interface MoveSenderOptions {
  /** 초당 최대 횟수. 서버가 welcome으로 알려주는 값(limits.moveHz)에 맞춘다 */
  maxHz?: number;
  /** 이만큼(미터) 이상 움직여야 바뀐 것으로 본다. 서버가 소수 둘째 자리로 반올림한다 */
  positionEpsilon?: number;
  /** 바라보는 방향이 이만큼(라디안) 이상 바뀌어야 바뀐 것으로 본다 */
  yawEpsilon?: number;
}

export interface MovePayload {
  x: number;
  z: number;
  r: number;
}

/** 속도 제한(초당 maxHz)을 넘지 않도록 약간 여유를 둔 간격 */
const SAFETY_MS = 10;

export function normalizeYaw(r: number): number {
  if (!Number.isFinite(r)) return 0;
  return Math.atan2(Math.sin(r), Math.cos(r));
}

export class MoveSender {
  private minIntervalMs: number;
  private readonly positionEpsilon: number;
  private readonly yawEpsilon: number;
  private last: (MovePayload & { at: number }) | null = null;

  constructor(options: MoveSenderOptions = {}) {
    this.minIntervalMs = intervalFor(options.maxHz ?? LIMITS.moveHz);
    this.positionEpsilon = options.positionEpsilon ?? 0.01;
    this.yawEpsilon = options.yawEpsilon ?? 0.03;
  }

  setMaxHz(hz: number): void {
    this.minIntervalMs = intervalFor(hz);
  }

  /** join처럼 다른 경로로 이미 알린 위치. 이 값에서 움직여야 다음 move가 나간다 */
  markSent(x: number, z: number, r: number, nowMs: number): void {
    this.last = { x, z, r: normalizeYaw(r), at: nowMs };
  }

  /** 연결이 끊겼다: 다시 붙으면 join이 위치를 알리니, 그때 markSent로 다시 시작한다 */
  reset(): void {
    this.last = null;
  }

  /** @param force true면 간격을 기다리지 않는다(앉기 직전처럼 마지막 위치를 꼭 알려야 할 때). 바뀌지 않았으면 그래도 null */
  next(x: number, z: number, r: number, nowMs: number, force = false): MovePayload | null {
    const yaw = normalizeYaw(r);
    const last = this.last;
    if (last) {
      const moved = Math.hypot(x - last.x, z - last.z) >= this.positionEpsilon;
      const turned = Math.abs(normalizeYaw(yaw - last.r)) >= this.yawEpsilon;
      if (!moved && !turned) return null;
      if (!force && nowMs - last.at < this.minIntervalMs) return null;
    }
    this.last = { x, z, r: yaw, at: nowMs };
    return { x, z, r: yaw };
  }
}

function intervalFor(hz: number): number {
  const safeHz = Number.isFinite(hz) && hz > 0 ? hz : 10;
  return 1000 / safeHz + SAFETY_MS;
}
