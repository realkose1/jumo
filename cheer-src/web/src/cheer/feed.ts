// 경기 피드(서버가 주는 CheerFeed)를 TV에 그릴 모양으로 바꾼다. 그림은 spaces/jumak/tv.ts가 그린다.
// 여기는 three.js도 DOM도 모르는 순수한 계산이라 시험하기 쉽다.
import type { CheerFeed, CheerMatch, CheerPlayer, CheerRole } from '@shared/cheer';
import { toSeoulTime } from '../engine/time';
import { roomName } from './roomName';

/** TV에 한꺼번에 보여주는 경기 수 */
export const MAX_TV_MATCHES = 3;

export interface TvPlayerLine {
  name: string;
  /** 골 표시: "⚽⚽", 야구는 "홈런 2". 아직 없으면 빈 글자 */
  badge: string;
  goals: number;
  /** 축구 출전 정보(선발·벤치·교체 투입·아웃). 모르면 없다 */
  role?: CheerRole;
}

export interface TvMatchView {
  id: string;
  sport: 'soccer' | 'baseball';
  comp: string;
  state: 'pre' | 'live' | 'final';
  /** 화면에 그대로: "67'", "HT", "19:30 시작", "종료" */
  clock: string;
  homeName: string;
  awayName: string;
  /** 시작 전에는 둘 다 빈 글자(화면이 'vs'를 그린다) */
  homeScore: string;
  awayScore: string;
  ours: 'home' | 'away' | 'both' | null;
  homePlayers: TvPlayerLine[];
  awayPlayers: TvPlayerLine[];
}

export interface TvNextView {
  comp: string;
  home: string;
  away: string;
  /** "오늘 19:30", "내일 04:00", "11월 3일 19:30" */
  when: string;
}

export type TvView =
  | { kind: 'waiting' }
  /** 피드가 한동안(약 20초) 오지 않았다: 로딩을 계속 말하지 않고 차분한 안내 */
  | { kind: 'quiet'; name: string }
  | { kind: 'matches'; matches: TvMatchView[] }
  | { kind: 'idle'; next: TvNextView | null; name: string };

const STATE_RANK: Record<CheerMatch['state'], number> = { live: 0, pre: 1, final: 2 };

/**
 * TV에 올릴 경기를 고른다. 주소의 ?m=<경기 id>가 있으면 그 경기가 맨 앞(크게),
 * 나머지는 진행 중 -> 곧 시작 -> 방금 끝난 순이고 최대 MAX_TV_MATCHES개.
 */
export function selectMatches(feed: CheerFeed, focusId: string | null): CheerMatch[] {
  const pool = [...feed.matches];
  if (focusId && feed.next && feed.next.id === focusId && !pool.some((m) => m.id === focusId)) pool.push(feed.next);
  pool.sort((a, b) => {
    const byState = STATE_RANK[a.state] - STATE_RANK[b.state];
    if (byState !== 0) return byState;
    // 끝난 경기는 최근 것이 먼저, 나머지는 먼저 시작하는 것이 먼저
    const byTime = a.state === 'final' ? b.ko - a.ko : a.ko - b.ko;
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });
  if (focusId) {
    const i = pool.findIndex((m) => m.id === focusId);
    if (i > 0) pool.unshift(pool.splice(i, 1)[0]!);
  }
  return pool.slice(0, MAX_TV_MATCHES);
}

function badgeFor(sport: CheerMatch['sport'], goals: number): string {
  if (goals <= 0) return '';
  if (sport === 'baseball') return `홈런 ${goals}`;
  return goals <= 3 ? '⚽'.repeat(goals) : `⚽×${goals}`;
}

const ROLES: readonly CheerRole[] = ['start', 'bench', 'in', 'off'];
const isRole = (v: unknown): v is CheerRole => ROLES.includes(v as CheerRole);

function playerLines(match: CheerMatch, side: 'home' | 'away'): TvPlayerLine[] {
  return match.players
    .filter((p: CheerPlayer) => p.side === side)
    .map((p) => ({ name: p.name, badge: badgeFor(match.sport, p.g), goals: p.g, ...(isRole(p.role) ? { role: p.role } : {}) }));
}

function scoreText(match: CheerMatch, team: 'home' | 'away'): string {
  if (match.state === 'pre') return '';
  const s = match[team].score;
  return s === null || s === undefined ? '-' : String(s);
}

export function toMatchView(m: CheerMatch): TvMatchView {
  return {
    id: m.id,
    sport: m.sport,
    comp: m.comp,
    state: m.state,
    clock: m.clock,
    homeName: m.home.name,
    awayName: m.away.name,
    homeScore: scoreText(m, 'home'),
    awayScore: scoreText(m, 'away'),
    ours: m.side === 'both' ? 'both' : m.side === 'home' || m.side === 'away' ? m.side : null,
    homePlayers: playerLines(m, 'home'),
    awayPlayers: playerLines(m, 'away'),
  };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 킥오프 시각을 한국 시간으로: 오늘/내일/모레는 말로, 그 밖은 날짜로 */
export function formatWhen(koMs: number, nowMs: number): string {
  const k = toSeoulTime(koMs);
  const n = toSeoulTime(nowMs);
  const dayOf = (t: { year: number; month: number; day: number }): number => Date.UTC(t.year, t.month - 1, t.day) / 86_400_000;
  const diff = dayOf(k) - dayOf(n);
  const time = `${pad2(k.hour)}:${pad2(k.minute)}`;
  if (diff === 0) return `오늘 ${time}`;
  if (diff === 1) return `내일 ${time}`;
  if (diff === 2) return `모레 ${time}`;
  return `${k.month}월 ${k.day}일 ${time}`;
}

export function buildTvView(feed: CheerFeed | null, focusId: string | null): TvView {
  if (!feed) return { kind: 'waiting' };
  const picked = selectMatches(feed, focusId);
  if (picked.length > 0) return { kind: 'matches', matches: picked.map(toMatchView) };
  const name = roomName(feed, focusId);
  const next = feed.next;
  if (!next) return { kind: 'idle', next: null, name };
  return {
    kind: 'idle',
    next: { comp: next.comp, home: next.home.name, away: next.away.name, when: formatWhen(next.ko, feed.now) },
    name,
  };
}

/** 진행 중인 경기가 있나 (웅성거림을 더 신나게 할지 정한다) */
export function hasLiveMatch(feed: CheerFeed | null): boolean {
  return !!feed && feed.matches.some((m) => m.state === 'live');
}
