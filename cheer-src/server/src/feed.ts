// 주모 경기 피드(GET /api/cheer-feed) 받기와 모양 확인.
// 피드는 우리 API가 만들지만, 그대로 방 모두에게 보내고 순간 계산에도 쓰므로 모양이 틀린 경기는 버린다.
import type { CheerFeed, CheerMatch, CheerPlayer, CheerTeam } from '../../shared/cheer';

/** 피드를 기다리는 최대 시간. 받아 오는 간격보다 짧아야 한다 */
export const FEED_TIMEOUT_MS = 5000;
/** 받은 피드 본문의 최대 길이(글자 수). 넘으면 버린다 */
export const MAX_FEED_CHARS = 256 * 1024;
const MAX_MATCHES = 40;
const MAX_PLAYERS = 40;
const MAX_TEXT = 120;

const isStr = (v: unknown, max = MAX_TEXT): v is string => typeof v === 'string' && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isCount = (v: unknown): v is number => isNum(v) && Number.isInteger(v) && v >= 0 && v < 1000;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function isTeam(v: unknown): v is CheerTeam {
  return isObj(v) && isStr(v.name) && (v.score === null || isCount(v.score));
}

function isPlayer(v: unknown): v is CheerPlayer {
  return (
    isObj(v) &&
    isStr(v.name) &&
    v.name.length > 0 &&
    (v.side === 'home' || v.side === 'away') &&
    isCount(v.g) &&
    (v.a === undefined || isCount(v.a))
  );
}

export function isMatch(v: unknown): v is CheerMatch {
  return (
    isObj(v) &&
    isStr(v.id) &&
    v.id.length > 0 &&
    (v.sport === 'soccer' || v.sport === 'baseball') &&
    isStr(v.comp) &&
    isTeam(v.home) &&
    isTeam(v.away) &&
    (v.side === 'home' || v.side === 'away' || v.side === 'both' || v.side === null) &&
    (v.state === 'pre' || v.state === 'live' || v.state === 'final') &&
    isStr(v.clock) &&
    isNum(v.ko) &&
    Array.isArray(v.players) &&
    v.players.length <= MAX_PLAYERS &&
    v.players.every(isPlayer)
  );
}

/** 받은 JSON을 피드로. 피드 모양이 아니면 null, 모양이 틀린 경기는 빼고 돌려준다 */
export function parseFeed(raw: unknown): CheerFeed | null {
  if (!isObj(raw) || raw.v !== 1 || !isNum(raw.now) || !Array.isArray(raw.matches)) return null;
  const matches = raw.matches.filter(isMatch).slice(0, MAX_MATCHES);
  return { ...(raw as unknown as CheerFeed), matches, next: isMatch(raw.next) ? raw.next : null };
}

/** 바뀌었는지 비교할 때 쓰는 값. 피드를 만든 시각(now)은 매번 바뀌므로 뺀다 */
export function feedKey(feed: CheerFeed): string {
  return JSON.stringify({ matches: feed.matches, next: feed.next ?? null });
}

/** 피드를 받아 온다. 실패(시간 초과, HTTP 오류, 모양 틀림)하면 던진다 */
export async function fetchFeed(url: string, timeoutMs = FEED_TIMEOUT_MS): Promise<CheerFeed> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'jumo-cheer-room' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`feed http ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_FEED_CHARS) throw new Error('feed too large');
  const feed = parseFeed(JSON.parse(text));
  if (!feed) throw new Error('feed shape');
  return feed;
}
