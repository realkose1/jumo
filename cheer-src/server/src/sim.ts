// 로컬 개발용 가짜 경기 피드. FEED_SIM이 켜져 있으면 방 서버가 피드를 받는 대신 이걸 쓴다.
// 실제 경기가 없을 때도 '시작 -> 골 -> 우리 선수 골 -> 실점 -> 끝' 흐름을 한 바퀴 볼 수 있다.
// 첫 사람이 들어온 시각(startAt)부터 SIM_CYCLE_MS마다 같은 경기를 새 id로 되풀이한다
// (같은 id를 다시 쓰면 이미 보낸 순간으로 걸러져서 두 번째 바퀴부터 아무 일도 안 일어난다).
// 배포 설정(wrangler.jsonc vars)에는 FEED_SIM을 넣지 않는다.
import type { CheerFeed, CheerMatch } from '../../shared/cheer';

/** 시뮬레이션 중 피드를 다시 만드는 간격. 순간이 이만큼 늦을 수 있다 */
export const SIM_POLL_MS = 2000;

/** 한 바퀴 안의 시각(ms, 첫 사람이 들어온 때부터) */
export const SIM_TIMELINE = {
  kickoff: 10_000,
  goal: 40_000, // 울버햄튼 골(다른 선수)
  playerGoal: 70_000, // 황희찬 골(팀 점수도 함께 오른다)
  concede: 100_000, // 리버풀 골
  final: 130_000, // 2:1 승리
  cycle: 160_000, // 다음 바퀴
} as const;

const COMP = '연습 경기 (시뮬레이션)';

/** startAt부터 now까지 흐른 시간으로 만든 피드 */
export function simFeed(startAt: number, now: number): CheerFeed {
  const T = SIM_TIMELINE;
  const elapsed = Math.max(0, now - startAt);
  const lap = Math.floor(elapsed / T.cycle);
  const t = elapsed - lap * T.cycle;
  const lapStart = startAt + lap * T.cycle;

  const state: CheerMatch['state'] = t < T.kickoff ? 'pre' : t < T.final ? 'live' : 'final';
  const home = state === 'pre' ? null : (t >= T.goal ? 1 : 0) + (t >= T.playerGoal ? 1 : 0);
  const away = state === 'pre' ? null : t >= T.concede ? 1 : 0;
  let clock: string;
  if (state === 'pre') clock = `${Math.ceil((T.kickoff - t) / 1000)}초 뒤 시작`;
  else if (state === 'final') clock = '종료';
  else clock = `${Math.min(90, Math.floor(((t - T.kickoff) / (T.final - T.kickoff)) * 90) + 1)}'`;

  const match: CheerMatch = {
    id: `sim-${startAt.toString(36)}-${lap + 1}`,
    sport: 'soccer',
    comp: COMP,
    home: { name: '울버햄튼', score: home },
    away: { name: '리버풀', score: away },
    side: 'home',
    state,
    clock,
    ko: lapStart + T.kickoff,
    players: [{ name: '황희찬', side: 'home', g: state !== 'pre' && t >= T.playerGoal ? 1 : 0 }],
  };

  const next: CheerMatch = {
    id: `sim-${startAt.toString(36)}-next`,
    sport: 'baseball',
    comp: COMP,
    home: { name: '샌프란시스코', score: null },
    away: { name: '다저스', score: null },
    side: 'home',
    state: 'pre',
    clock: '내일 11:05 시작',
    ko: lapStart + 24 * 60 * 60 * 1000,
    players: [{ name: '이정후', side: 'home', g: 0 }],
  };

  return { v: 1, now, matches: [match], next };
}
