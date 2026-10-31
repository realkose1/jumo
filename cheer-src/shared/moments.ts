// 경기 피드 두 장(직전, 이번)을 비교해 방 전체가 함께 반응할 '순간'을 만든다. 순수 함수라 서버와 시험이 같이 쓴다.
//
// 규칙
//   - 처음 보는 경기에서는 아무것도 내지 않는다(방이 막 열렸을 때 지난 일을 다시 틀지 않는다)
//   - kickoff: pre -> live
//   - goal: 우리 쪽 점수가 올랐다(코리안 더비 side='both'는 어느 쪽 골이든 우리 골. 글자에 그 팀 이름)
//   - player-goal: 우리 선수의 g가 올랐다(축구 골, 야구 홈런). 축구에서 경기 중에 처음 목록에 나타난 선수는
//     0골에서 센다(대표팀 피드는 골이나 도움이 나온 선수만 싣는다)
//   - concede: 상대 점수가 올랐다(side가 home/away일 때만)
//   - final: live -> final. 우리 쪽 기준 승/무/패(더비와 모르는 쪽은 결과 없음)
//   - 점수나 g가 내려가면(비디오 판독 취소 등) 아무것도 내지 않고 그 값을 새 기준으로 삼는다.
//     그 경기의 '정정 횟수'(epoch)가 1 오르고, 그 뒤의 골, 실점, 선수 골 id에는 `:e<정정 횟수>`가 붙는다
//     (취소 뒤 같은 점수로 다시 들어간 진짜 골이 이미 보낸 id에 걸려 조용히 묻히지 않게)
//   - 한 번에 여러 골이 오르면 골마다 하나씩, MAX_MOMENTS_PER_JUMP개까지(가장 최근 것들)
//     야구 득점은 한 번에 몇 점이 나든 순간 하나로 묶는다("다저스 3점 득점!")
//   - id는 경기 안에서 그 일을 가리키는 고정 값이다. 같은 변화를 두 번 비교해도 같은 id가 나와서
//     서버가 이미 보낸 id를 걸러 낼 수 있다(재시도, 재시작에도 두 번 울리지 않는다)
//       `${match}:kickoff`, `${match}:final`
//       `${match}:goal:h2`     홈 팀의 2번째 골(득점이 2가 됨). 원정은 a
//       `${match}:concede:a1`  상대(원정)의 1번째 골
//       `${match}:pg:<선수>:2` 그 선수의 2번째 골(홈런)
//       `${match}:goal:h2:e1`  정정이 한 번 있은 뒤 홈 팀의 2번째 골
// 한 경기 안의 순서: kickoff, goal, player-goal, concede, final
import type { CheerFeed, CheerMatch, CheerPlayer, Moment } from './cheer';

/** 한 번 비교에서 한 쪽(팀 또는 선수)이 낼 수 있는 골 순간의 상한 */
export const MAX_MOMENTS_PER_JUMP = 3;

type Side = 'home' | 'away';
type OurSide = Side | 'both' | null;

const SIDES: readonly Side[] = ['home', 'away'];

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/** 우리 선수가 뛰는 쪽. 피드가 모르면(null) 선수 목록으로 짐작한다 */
export function ourSideOf(m: CheerMatch): OurSide {
  if (m.side === 'home' || m.side === 'away' || m.side === 'both') return m.side;
  let home = false;
  let away = false;
  for (const p of m.players ?? []) {
    if (p.side === 'home') home = true;
    else if (p.side === 'away') away = true;
  }
  if (home && away) return 'both';
  return home ? 'home' : away ? 'away' : null;
}

/** 직전 피드에서 본 점수. 경기 전이면 0으로, 진행 중인데 값이 없으면 모르는 것(null)으로 본다 */
function baseScore(prev: CheerMatch, side: Side): number | null {
  const s = prev[side]?.score;
  if (isCount(s)) return s;
  return prev.state === 'pre' ? 0 : null;
}

function nowScore(next: CheerMatch, side: Side): number | null {
  const s = next[side]?.score;
  return isCount(s) ? s : null;
}

/** from 다음 골부터 to까지, 가장 최근 MAX_MOMENTS_PER_JUMP개 */
function goalNumbers(from: number, to: number): number[] {
  const out: number[] = [];
  for (let n = Math.max(from + 1, to - MAX_MOMENTS_PER_JUMP + 1); n <= to; n++) out.push(n);
  return out;
}

function findPlayer(list: readonly CheerPlayer[] | undefined, p: CheerPlayer): CheerPlayer | undefined {
  return list?.find((q) => q.name === p.name && q.side === p.side) ?? list?.find((q) => q.name === p.name);
}

function resultText(result: 'win' | 'draw' | 'loss'): string {
  return result === 'win' ? '승리!' : result === 'draw' ? '무승부' : '아쉬운 패배';
}

/** 직전보다 점수나 우리 선수 g가 내려갔다(판독 취소 등). 그러면 그 경기의 정정 횟수가 오른다 */
export function scoreCorrected(prev: CheerMatch, next: CheerMatch): boolean {
  for (const s of SIDES) {
    const from = prev[s]?.score;
    const to = next[s]?.score;
    if (isCount(from) && isCount(to) && to < from) return true;
  }
  for (const p of next.players ?? []) {
    if (!isCount(p?.g)) continue;
    const before = findPlayer(prev.players, p);
    if (before && isCount(before.g) && p.g < before.g) return true;
  }
  return false;
}

/** 한 경기의 순간들. prev가 없으면(처음 보는 경기) 빈 배열. epoch는 그 경기의 정정 횟수(이번 비교의 정정까지 센 값) */
export function deriveMatchMoments(prev: CheerMatch | undefined, next: CheerMatch, now: number, epoch = 0): Moment[] {
  // 처음 본 경기와, 경기 전에서 바로 끝으로 건너뛴 경기(통째로 놓침)는 조용히 넘긴다
  if (!prev || (prev.state === 'pre' && next.state === 'final')) return [];
  const id = next.id;
  const ep = epoch > 0 ? `:e${epoch}` : '';
  const side = ourSideOf(next);
  const baseball = next.sport === 'baseball';
  const out: Moment[] = [];
  const add = (m: Omit<Moment, 'match' | 'at'>): void => {
    out.push({ ...m, match: id, at: now });
  };

  // 시작
  if (prev.state === 'pre' && next.state === 'live') add({ id: `${id}:kickoff`, kind: 'kickoff', text: '경기 시작!' });

  // 점수: 끝난 뒤 정정된 점수에는 반응하지 않는다(final -> final)
  const scored: Array<{ side: Side; numbers: number[]; runs: number }> = [];
  if (next.state !== 'pre' && prev.state !== 'final') {
    for (const s of SIDES) {
      const from = baseScore(prev, s);
      const to = nowScore(next, s);
      if (from === null || to === null || to <= from) continue;
      scored.push({ side: s, numbers: baseball ? [to] : goalNumbers(from, to), runs: to - from });
    }
  }
  const ours = (s: Side): boolean => side === 'both' || side === s;
  const theirs = (s: Side): boolean => (side === 'home' || side === 'away') && side !== s;

  for (const { side: s, numbers, runs } of scored) {
    if (!ours(s)) continue;
    const team = next[s].name;
    const text = baseball ? (runs > 1 ? `${team} ${runs}점 득점!` : `${team} 득점!`) : `${team} 골!`;
    for (const n of numbers) add({ id: `${id}:goal:${s[0]}${n}${ep}`, kind: 'goal', text });
  }

  // 우리 선수 골(홈런)
  if (next.state !== 'pre' && prev.state !== 'final') {
    for (const p of next.players ?? []) {
      if (typeof p?.name !== 'string' || !isCount(p.g)) continue;
      const before = findPlayer(prev.players, p);
      // 직전 목록에 없던 선수: 경기 전이었거나 축구면 0에서 센다(대표팀 피드는 골, 도움이 나온 선수만 싣는다).
      // 야구는 지금 값을 새 기준으로만 삼는다
      const from = before && isCount(before.g) ? before.g : prev.state === 'pre' || !baseball ? 0 : null;
      if (from === null || p.g <= from) continue;
      const text = baseball ? `${p.name} 홈런!` : `${p.name} 골!`;
      for (const n of goalNumbers(from, p.g)) {
        add({ id: `${id}:pg:${p.name}:${n}${ep}`, kind: 'player-goal', text, player: p.name });
      }
    }
  }

  for (const { side: s, numbers, runs } of scored) {
    if (!theirs(s)) continue;
    const text = baseball && runs > 1 ? `아쉬워요, ${runs}실점` : '아쉬워요, 실점';
    for (const n of numbers) add({ id: `${id}:concede:${s[0]}${n}${ep}`, kind: 'concede', text });
  }

  // 끝
  if (prev.state === 'live' && next.state === 'final') {
    const h = nowScore(next, 'home');
    const a = nowScore(next, 'away');
    if (h === null || a === null) {
      add({ id: `${id}:final`, kind: 'final', text: '경기 끝!' });
    } else if (side === 'home' || side === 'away') {
      const us = side === 'home' ? h : a;
      const them = side === 'home' ? a : h;
      const result = us > them ? 'win' : us < them ? 'loss' : 'draw';
      add({ id: `${id}:final`, kind: 'final', text: `경기 끝, ${us}:${them} ${resultText(result)}`, result });
    } else {
      add({ id: `${id}:final`, kind: 'final', text: `경기 끝, ${h}:${a}` });
    }
  }
  return out;
}

/**
 * 직전 피드(prev)와 이번 피드(next)를 비교해 생긴 순간들. at은 모두 now(서버 시각).
 * prev가 null이면(방이 막 열렸거나 피드가 오래됐으면) 아무것도 내지 않는다.
 * 직전 피드의 next(다음 경기)에 있던 경기도 '본 경기'로 친다.
 * 정정 횟수를 이어 가지 않는 간단한 형태. 서버는 deriveMomentsWithEpochs를 쓴다.
 */
export function deriveMoments(prev: CheerFeed | null, next: CheerFeed, now: number): Moment[] {
  return deriveMomentsWithEpochs(prev, next, now, {}).moments;
}

/** 경기 id -> 정정 횟수. 서버가 저장해 두고 다음 비교에 넘긴다(휴면, 재시작 뒤에도 이어지게) */
export type MatchEpochs = Readonly<Record<string, number>>;

/**
 * deriveMoments에 경기별 정정 횟수를 더한 것. 넘긴 epochs는 바꾸지 않고, 바뀐 값을 새 객체로 돌려준다.
 * 점수나 g가 내려간 경기는 정정 횟수가 1 오르고, 이번 비교에서 난 골부터 새 횟수로 id를 만든다.
 */
export function deriveMomentsWithEpochs(
  prev: CheerFeed | null,
  next: CheerFeed,
  now: number,
  epochs: MatchEpochs,
): { moments: Moment[]; epochs: Record<string, number> } {
  const nextEpochs: Record<string, number> = { ...epochs };
  if (!prev) return { moments: [], epochs: nextEpochs };
  const seen = new Map<string, CheerMatch>();
  if (prev.next && typeof prev.next.id === 'string') seen.set(prev.next.id, prev.next);
  for (const m of prev.matches ?? []) if (m && typeof m.id === 'string') seen.set(m.id, m);

  const out: Moment[] = [];
  const done = new Set<string>();
  for (const m of next.matches ?? []) {
    if (!m || typeof m.id !== 'string' || done.has(m.id)) continue;
    done.add(m.id);
    const before = seen.get(m.id);
    let epoch = Object.hasOwn(nextEpochs, m.id) ? (nextEpochs[m.id] ?? 0) : 0;
    if (before && scoreCorrected(before, m)) nextEpochs[m.id] = ++epoch;
    out.push(...deriveMatchMoments(before, m, now, epoch));
  }
  return { moments: out, epochs: nextEpochs };
}
