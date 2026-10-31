/** 주모 경기 피드(GET /api/cheer-feed). 주막 방 서버와 화면이 같이 쓴다. */
export interface CheerTeam { name: string; score: number | null }
/** 축구 출전 정보: start 선발 · bench 벤치 · in 교체 투입 · off 교체 아웃 */
export type CheerRole = 'start' | 'bench' | 'in' | 'off';
/** g: 축구는 골, 야구는 홈런. a: 축구 도움(선택). role: 축구 출전 정보(선택, 모르면 없다) */
export interface CheerPlayer { name: string; side: 'home' | 'away'; g: number; a?: number; role?: CheerRole }
export interface CheerMatch {
  id: string;
  sport: 'soccer' | 'baseball';
  comp: string;
  home: CheerTeam;
  away: CheerTeam;
  /** 우리 선수가 뛰는 쪽. both = 코리안 더비, null = 모름 */
  side: 'home' | 'away' | 'both' | null;
  state: 'pre' | 'live' | 'final';
  /** 화면에 그대로 쓰는 글자: "67'", "HT", "7회초", "19:30 시작", "종료" */
  clock: string;
  /** 킥오프(경기 시작) 시각, ms */
  ko: number;
  players: CheerPlayer[];
}
/** matches: 진행 중 + 60분 안에 시작 + 끝난 지 30분 안. next: 그 밖의 가장 가까운 다음 경기 */
export interface CheerFeed { v: 1; now: number; matches: CheerMatch[]; next?: CheerMatch | null }
export type MomentKind = 'kickoff' | 'goal' | 'player-goal' | 'concede' | 'final';
/** 방 전체가 같은 순간에 반응하는 일. at = 서버 시각(ms) */
export interface Moment {
  id: string; kind: MomentKind; match: string; at: number; text: string;
  player?: string; result?: 'win' | 'draw' | 'loss';
}
