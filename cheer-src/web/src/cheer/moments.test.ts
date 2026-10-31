import { describe, expect, it } from 'vitest';
import type { Moment } from '@shared/cheer';
import { MOMENT_MAX_AGE_MS, MOMENT_MAX_WAIT_MS, MomentGate, momentDelayMs, planMoment } from './moments';

const m = (over: Partial<Moment>): Moment => ({ id: 'm1', kind: 'goal', match: 'x', at: 1_000_000, text: '', ...over });

describe('planMoment', () => {
  it('선수 골: "황희찬 골! 다 같이 건배!", 모두 같이 뛰고 색종이, 건배 버튼', () => {
    const p = planMoment(m({ kind: 'player-goal', player: '황희찬', text: '황희찬 골!' }));
    expect(p.headline).toBe('황희찬 골! 다 같이 건배!');
    expect(p.banner).toEqual({ text: '황희찬 골!', tone: 'goal' });
    expect(p.celebrate).toBe(true);
    expect(p.confetti).toBe('full');
    expect(p.hype).toBe(true);
    expect(p.sound).toBe('goal');
  });

  it('선수 이름이 있으면 서버 글보다 이름으로 만든다', () => {
    expect(planMoment(m({ kind: 'player-goal', player: '이강인', text: '골 소식' })).banner?.text).toBe('이강인 골!');
  });

  it('우리 팀 골: 서버 글을 쓰고, 없으면 "골!"', () => {
    expect(planMoment(m({ kind: 'goal', text: '울버햄튼 선제골!' })).headline).toBe('울버햄튼 선제골! 다 같이 건배!');
    expect(planMoment(m({ kind: 'goal' })).banner?.text).toBe('골!');
  });

  it('킥오프: 북소리와 알림, 색종이는 없다', () => {
    const p = planMoment(m({ kind: 'kickoff' }));
    expect(p.sound).toBe('kickoff');
    expect(p.confetti).toBeNull();
    expect(p.celebrate).toBe(false);
    expect(p.headline).toContain('킥오프');
  });

  it('실점: 조용한 알림, 띄우는 글 없음', () => {
    const p = planMoment(m({ kind: 'concede' }));
    expect(p.tone).toBe('quiet');
    expect(p.banner).toBeNull();
    expect(p.celebrate).toBe(false);
    expect(p.hype).toBe(false);
  });

  it('경기 끝: 이길 때만 색종이와 같이 뛰기', () => {
    const win = planMoment(m({ kind: 'final', result: 'win' }));
    expect(win.confetti).toBe('full');
    expect(win.celebrate).toBe(true);
    expect(win.sound).toBe('final-win');
    for (const result of ['draw', 'loss'] as const) {
      const p = planMoment(m({ kind: 'final', result }));
      expect(p.confetti).toBeNull();
      expect(p.celebrate).toBe(false);
      expect(p.sound).toBe('final');
      expect(p.tone).toBe('quiet');
    }
  });

  it('문구는 "~해요" 체이고 줄표가 없다', () => {
    for (const kind of ['kickoff', 'goal', 'player-goal', 'concede', 'final'] as const) {
      for (const result of ['win', 'draw', 'loss'] as const) {
        expect(planMoment(m({ kind, result, player: '선수' })).headline).not.toMatch(/[—–]/);
      }
    }
  });
});

describe('MomentGate', () => {
  it('같은 순간은 한 번만', () => {
    const g = new MomentGate();
    expect(g.check(m({ id: 'a' }), 1_000_100)).toBe('ok');
    expect(g.check(m({ id: 'a' }), 1_000_200)).toBe('dup');
    expect(g.check(m({ id: 'b' }), 1_000_300)).toBe('ok');
  });

  it('너무 오래된 순간은 거른다', () => {
    const g = new MomentGate();
    expect(g.check(m({ id: 'old', at: 1_000_000 }), 1_000_000 + MOMENT_MAX_AGE_MS + 1)).toBe('stale');
    expect(g.check(m({ id: 'new', at: 1_000_000 }), 1_000_000 + MOMENT_MAX_AGE_MS - 1)).toBe('ok');
  });

  it('기억은 한계가 있다', () => {
    const g = new MomentGate(MOMENT_MAX_AGE_MS, 3);
    for (const id of ['a', 'b', 'c', 'd']) g.check(m({ id }), 1_000_000);
    expect(g.check(m({ id: 'a' }), 1_000_000)).toBe('ok'); // 밀려났다
    expect(g.check(m({ id: 'd' }), 1_000_000)).toBe('dup');
  });
});

describe('momentDelayMs', () => {
  it('서버 시각이 앞이면 그만큼, 최대 한도까지 기다린다', () => {
    expect(momentDelayMs(m({ at: 1_000_500 }), 1_000_000)).toBe(500);
    expect(momentDelayMs(m({ at: 1_000_000 }), 1_000_000)).toBe(0);
    expect(momentDelayMs(m({ at: 1_000_000 - 5000 }), 1_000_000)).toBe(0);
    expect(momentDelayMs(m({ at: 1_000_000 + 60_000 }), 1_000_000)).toBe(MOMENT_MAX_WAIT_MS);
  });
});
