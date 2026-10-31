// 다시 연결하기까지 기다리는 시간. 지수로 늘리고, 최대 간격을 두고, 약간 흩뜨려서
// 서버가 다시 살아났을 때 모두가 같은 순간에 몰려오지 않게 한다.
export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  /** 탭이 숨겨져 있을 때의 최소 간격. 아무도 안 보는 화면이 서두를 이유가 없다 */
  hiddenMinMs?: number;
}

export const BACKOFF_DEFAULTS = { baseMs: 1000, maxMs: 30_000, hiddenMinMs: 30_000 } as const;

/**
 * attempt번째(0부터) 재시도 전 기다릴 시간(ms).
 * 상한은 base * 2^attempt (maxMs까지), 실제 값은 그 상한의 절반~전부 사이에서 고른다.
 */
export function reconnectDelayMs(
  attempt: number,
  hidden: boolean,
  random: () => number = Math.random,
  options: BackoffOptions = {},
): number {
  const base = options.baseMs ?? BACKOFF_DEFAULTS.baseMs;
  const max = options.maxMs ?? BACKOFF_DEFAULTS.maxMs;
  const hiddenMin = options.hiddenMinMs ?? BACKOFF_DEFAULTS.hiddenMinMs;
  const n = Math.max(0, Math.floor(Number.isNaN(attempt) ? 0 : attempt));
  const ceiling = Math.min(max, base * 2 ** Math.min(n, 30));
  const delay = ceiling / 2 + (ceiling / 2) * Math.min(1, Math.max(0, random()));
  return hidden ? Math.max(delay, hiddenMin) : delay;
}
