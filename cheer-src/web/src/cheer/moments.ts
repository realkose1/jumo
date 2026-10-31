// 경기에서 일이 났을 때(Moment) 방 모두가 어떻게 반응할지 정한다. 순수한 계산이라 시험하기 쉽다.
import type { Moment, MomentKind } from '@shared/cheer';

export type MomentTone = 'cheer' | 'quiet' | 'info';
export type MomentSound = 'goal' | 'kickoff' | 'concede' | 'final-win' | 'final';

export interface MomentPlan {
  kind: MomentKind;
  /** 위쪽 알림 한 줄 */
  headline: string;
  tone: MomentTone;
  /** TV에 크게 띄울 글 (없으면 띄우지 않는다) */
  banner: { text: string; tone: 'goal' | 'info' } | null;
  /** 모두가 같이 신나게 뛴다 */
  celebrate: boolean;
  confetti: 'full' | null;
  /** 건배 버튼이 뛰고, TV에 방금 낸 응원 합계를 보여준다 */
  hype: boolean;
  sound: MomentSound;
}

/** 건배 버튼이 뛰고 합계를 세는 시간 */
export const HYPE_MS = 10_000;
/** 이보다 오래된 일은 지금 반응하지 않는다(늦게 들어왔거나 연결이 끊겼다 돌아온 경우) */
export const MOMENT_MAX_AGE_MS = 20_000;
/** 서버 시각이 이만큼 앞이면(시계 차이) 그만큼 기다렸다 반응한다 */
export const MOMENT_MAX_WAIT_MS = 3_000;

const clean = (s: string | undefined): string => (s ?? '').trim();

export function planMoment(m: Moment): MomentPlan {
  const text = clean(m.text);
  switch (m.kind) {
    case 'goal':
    case 'player-goal': {
      const player = clean(m.player);
      const banner = m.kind === 'player-goal' && player ? `${player} 골!` : text || '골!';
      return {
        kind: m.kind,
        headline: `${banner} 다 같이 건배!`,
        tone: 'cheer',
        banner: { text: banner, tone: 'goal' },
        celebrate: true,
        confetti: 'full',
        hype: true,
        sound: 'goal',
      };
    }
    case 'kickoff':
      return {
        kind: m.kind,
        headline: text || '킥오프! 경기가 시작됐어요',
        tone: 'info',
        banner: { text: '킥오프!', tone: 'info' },
        celebrate: false,
        confetti: null,
        hype: false,
        sound: 'kickoff',
      };
    case 'concede':
      return {
        kind: m.kind,
        headline: text || '실점했어요. 아직 괜찮아요, 힘내요!',
        tone: 'quiet',
        banner: null,
        celebrate: false,
        confetti: null,
        hype: false,
        sound: 'concede',
      };
    case 'final': {
      const win = m.result === 'win';
      const fallback = win ? '승리! 다 같이 수고했어요' : m.result === 'draw' ? '무승부로 끝났어요. 수고했어요' : '아쉽게 끝났어요. 수고했어요';
      return {
        kind: m.kind,
        headline: text || fallback,
        tone: win ? 'cheer' : 'quiet',
        banner: { text: win ? '승리!' : '경기 종료', tone: 'info' },
        celebrate: win,
        confetti: win ? 'full' : null,
        hype: false,
        sound: win ? 'final-win' : 'final',
      };
    }
  }
}

export type MomentVerdict = 'ok' | 'dup' | 'stale';

/** 같은 일을 두 번 처리하지 않고, 너무 오래된 일은 거른다 */
export class MomentGate {
  private readonly seen: string[] = [];

  constructor(
    private readonly maxAgeMs = MOMENT_MAX_AGE_MS,
    private readonly keep = 40,
  ) {}

  /** serverNowMs: 서버 기준 지금 시각 */
  check(m: Moment, serverNowMs: number): MomentVerdict {
    if (this.seen.includes(m.id)) return 'dup';
    this.seen.push(m.id);
    if (this.seen.length > this.keep) this.seen.shift();
    if (Number.isFinite(m.at) && serverNowMs - m.at > this.maxAgeMs) return 'stale';
    return 'ok';
  }
}

/** 반응하기까지 기다릴 시간(ms). 서버 시각이 조금 앞이면 그만큼, 아니면 바로 */
export function momentDelayMs(m: Moment, serverNowMs: number): number {
  if (!Number.isFinite(m.at)) return 0;
  return Math.min(MOMENT_MAX_WAIT_MS, Math.max(0, m.at - serverNowMs));
}
