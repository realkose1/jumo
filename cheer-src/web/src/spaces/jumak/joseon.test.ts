import { describe, expect, it } from 'vitest';
import { oldClock, sijin } from './joseon';

describe('옛 시진', () => {
  it('두 시간씩: 23~1시 자시 … 21~23시 해시', () => {
    expect(sijin(23)).toBe('자시');
    expect(sijin(0)).toBe('자시');
    expect(sijin(1)).toBe('축시');
    expect(sijin(12)).toBe('오시');
    expect(sijin(21)).toBe('해시');
    expect(sijin(22)).toBe('해시');
    expect(sijin(20)).toBe('술시');
  });
});

describe('옛 말투 경기 시계', () => {
  it('진행 중: 분, 추가 시간, 쉬는 참', () => {
    expect(oldClock('live', "34'")).toBe('34분');
    expect(oldClock('live', "45+2'")).toBe('45+2분');
    expect(oldClock('live', 'HT')).toBe('쉬는 참');
    expect(oldClock('live', '7회초')).toBe('7회초');
    expect(oldClock('live', '')).toBe('겨루는 중');
  });
  it('시작 전: 시진과 개전 (오늘 밤 백승호 21:30, 이강인 22:00)', () => {
    expect(oldClock('pre', '21:30 시작')).toBe('해시 21:30 개전');
    expect(oldClock('pre', '22:00 시작')).toBe('해시 22:00 개전');
    expect(oldClock('pre', '곧 시작')).toBe('곧 개전');
  });
  it('끝: 파장', () => {
    expect(oldClock('final', '종료')).toBe('파장 · 경기 끝');
  });
});
