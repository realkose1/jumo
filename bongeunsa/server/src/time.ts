// 한국 시간(UTC+9, 서머타임 없음) 기준 날짜 계산.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 한국 시간 기준 날짜 문자열 'YYYY-MM-DD'. 자정에 바뀐다 */
export function kstDay(nowMs: number): string {
  return new Date(nowMs + KST_OFFSET_MS).toISOString().slice(0, 10);
}
