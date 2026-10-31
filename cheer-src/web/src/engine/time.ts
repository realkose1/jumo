// 시간 시스템: 모든 공동 일정은 한국 시간(Asia/Seoul) 기준.
// 한국은 UTC+9 고정이고 서머타임이 없으니 계산식으로 충분하다.
export const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export interface SeoulTime {
  year: number;
  month: number; // 1~12
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  weekday: number; // 0 = 일요일
}

export function toSeoulTime(epochMs: number): SeoulTime {
  const d = new Date(epochMs + SEOUL_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    millisecond: d.getUTCMilliseconds(),
    weekday: d.getUTCDay(),
  };
}

/** `?timeOffset=분` 값을 읽는다. 없거나 숫자가 아니면 0. 양수는 시간을 앞당긴다. */
export function parseTimeOffsetMinutes(search: string | URLSearchParams): number {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const raw = params.get('timeOffset');
  if (raw === null || raw.trim() === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** 다음 "매시 N분"까지 남은 밀리초. 지금이 정확히 N분이면 한 시간 뒤. */
export function msUntilNextMinuteOfHour(epochMs: number, minute: number): number {
  // 서울 오프셋이 정확히 9시간이라 UTC 시 경계와 같다
  const intoHour = ((epochMs % HOUR_MS) + HOUR_MS) % HOUR_MS;
  let delta = minute * MINUTE_MS - intoHour;
  if (delta <= 0) delta += HOUR_MS;
  return delta;
}

export interface ClockOptions {
  /** 시험용으로 시간을 앞당기는 분 (?timeOffset=) */
  timeOffsetMinutes?: number;
  /** 서버 시각과 기기 시계의 차이(ms). 서버가 붙기 전에는 0 */
  serverOffsetMs?: number;
  /** 기기 시계. 시험에서 바꿔 끼운다 */
  source?: () => number;
}

export class QuietClock {
  private serverOffsetMs: number;
  private testOffsetMs: number;
  private readonly source: () => number;

  constructor(options: ClockOptions = {}) {
    this.serverOffsetMs = options.serverOffsetMs ?? 0;
    this.testOffsetMs = (options.timeOffsetMinutes ?? 0) * MINUTE_MS;
    this.source = options.source ?? Date.now;
  }

  /** 보정된 현재 시각(epoch ms). 모든 공동 일정은 이 값으로 계산한다. */
  now(): number {
    return this.source() + this.serverOffsetMs + this.testOffsetMs;
  }

  seoul(): SeoulTime {
    return toSeoulTime(this.now());
  }

  getServerOffsetMs(): number {
    return this.serverOffsetMs;
  }

  setServerOffsetMs(ms: number): void {
    this.serverOffsetMs = Number.isFinite(ms) ? ms : 0;
  }

  /**
   * 서버 시각으로 차이를 계산한다. 요청 보낸 시각과 응답 받은 시각의 가운데를
   * 서버가 답한 순간으로 본다. 둘을 안 주면 지금 받은 것으로 친다.
   */
  syncWithServer(serverNowMs: number, sentAtMs?: number, receivedAtMs?: number): void {
    const received = receivedAtMs ?? this.source();
    const sent = sentAtMs ?? received;
    this.setServerOffsetMs(serverNowMs - (sent + received) / 2);
  }

  getTestOffsetMinutes(): number {
    return this.testOffsetMs / MINUTE_MS;
  }

  setTestOffsetMinutes(minutes: number): void {
    this.testOffsetMs = (Number.isFinite(minutes) ? minutes : 0) * MINUTE_MS;
  }
}
