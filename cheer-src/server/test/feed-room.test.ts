// 주막 방의 경기 피드: 받아 오기(가짜 fetch), feed와 moment 보내기, 빈 방이면 멈추기, 늦게 온 사람.
// 시험 설정(vitest.config.ts)은 FEED_URL=https://feed.test/..., FEED_POLL_MS=150, 주막 방 100개.
import { env, exports } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheerFeed, CheerMatch } from '../../shared/cheer';
import type { ServerMsg } from '../../shared/protocol';
import { sleep, TestClient } from './helpers';

const POLL = 150;

let current: CheerFeed | null = null;
let failing = false;
let calls = 0;

function match(over: Partial<CheerMatch> & { h?: number | null; a?: number | null; g?: number } = {}): CheerMatch {
  const { h = 0, a = 0, g = 0, ...rest } = over;
  return {
    id: 'sm-1',
    sport: 'soccer',
    comp: 'EPL',
    home: { name: '울버햄튼', score: h },
    away: { name: '리버풀', score: a },
    side: 'home',
    state: 'live',
    clock: "30'",
    ko: 0,
    players: [{ name: '황희찬', side: 'home', g }],
    ...rest,
  };
}
const setFeed = (...matches: CheerMatch[]) => {
  current = { v: 1, now: 0, matches };
};

beforeEach(() => {
  current = null;
  failing = false;
  calls = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith('https://feed.test/')) throw new Error(`unexpected fetch ${url}`);
    calls++;
    if (failing || !current) return new Response('down', { status: 503 });
    // now는 매번 바뀐다: 서버는 now만 바뀐 피드를 '바뀌었다'고 보지 않아야 한다
    return Response.json({ ...current, now: Date.now() });
  });
});

const open: TestClient[] = [];
async function join(room: number, space = 'jumak') {
  const c = await TestClient.join(space, room);
  open.push(c);
  return c;
}
afterEach(async () => {
  for (const c of open.splice(0)) c.close();
  await sleep(50);
  vi.restoreAllMocks();
});

const count = (c: TestClient, t: ServerMsg['t'], pred: (m: any) => boolean = () => true) =>
  c.inbox.filter((m) => m.t === t && pred(m)).length;
const moments = (c: TestClient) => c.inbox.flatMap((m) => (m.t === 'moment' ? [m.m] : []));

describe('주막 경기 피드', () => {
  it('첫 사람이 오면 바로 받아 보내고, 바뀔 때만 다시 보내며, 순간은 한 번씩 모두에게 같은 시각으로', async () => {
    setFeed(match({ state: 'pre', h: null, a: null }));
    const a = await join(1);
    const first = await a.next('feed');
    expect(first.feed.matches[0]).toMatchObject({ id: 'sm-1', state: 'pre' });

    // 바뀐 게 없으면(now만 다름) 다시 보내지 않는다
    await sleep(POLL * 4);
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(count(a, 'feed')).toBe(1);
    expect(count(a, 'moment')).toBe(0); // 처음 본 피드는 기준일 뿐

    setFeed(match({ state: 'live' }));
    const kickoff = await a.next('moment');
    expect(kickoff.m).toMatchObject({ id: 'sm-1:kickoff', kind: 'kickoff', text: '경기 시작!' });
    expect(Math.abs(kickoff.m.at - Date.now())).toBeLessThan(5000);
    // 피드가 순간보다 먼저 온다(순간이 올 때 화면의 점수가 이미 바뀌어 있게)
    const iFeed = a.inbox.findIndex((m) => m.t === 'feed' && m.feed.matches[0]?.state === 'live');
    const iMoment = a.inbox.findIndex((m) => m.t === 'moment');
    expect(iFeed).toBeGreaterThan(-1);
    expect(iFeed).toBeLessThan(iMoment);

    // 늦게 온 사람: welcome 바로 다음에 지금 피드
    const b = await join(1);
    await b.next('feed');
    const welcomeAt = b.inbox.findIndex((m) => m.t === 'welcome');
    expect(b.inbox[welcomeAt + 1]).toMatchObject({ t: 'feed', feed: { matches: [{ state: 'live' }] } });
    expect(count(b, 'moment')).toBe(0); // 지난 순간은 다시 오지 않는다

    setFeed(match({ h: 1, g: 1 }));
    await a.next('moment', (m) => m.m.kind === 'player-goal');
    await b.next('moment', (m) => m.m.kind === 'player-goal');
    await sleep(POLL * 5); // 몇 번 더 받아도 두 번 울리지 않는다
    for (const c of [a, b]) {
      const ms = moments(c).filter((m) => m.id !== 'sm-1:kickoff');
      expect(ms.map((m) => `${m.id}|${m.text}`)).toEqual(['sm-1:goal:h1|울버햄튼 골!', 'sm-1:pg:황희찬:1|황희찬 골!']);
    }
    // 같은 순간은 모두에게 같은 at
    expect(moments(a).at(-1)!.at).toBe(moments(b).at(-1)!.at);
  });

  it('받기가 실패하면 마지막 피드를 두고 다시 시도하며, 방은 멀쩡하다', async () => {
    setFeed(match());
    const a = await join(2);
    await a.next('feed');
    failing = true;
    const before = calls;
    await sleep(POLL * 4);
    expect(calls).toBeGreaterThan(before + 1); // 계속 다시 시도한다
    expect(count(a, 'feed')).toBe(1);
    a.send({ t: 'ping', c: 1 });
    await a.next('pong');

    // 살아나면 실패 동안 생긴 일을 이어서 낸다(직전 피드가 오래되지 않았으므로)
    setFeed(match({ h: 1 }));
    failing = false;
    expect((await a.next('moment')).m.id).toBe('sm-1:goal:h1');
    expect(a.closed).toBeNull();
  });

  it('모양이 틀린 피드는 버린다', async () => {
    setFeed(match());
    const a = await join(3);
    await a.next('feed');
    current = { v: 9 } as never;
    await sleep(POLL * 3);
    expect(count(a, 'feed')).toBe(1);
    expect(a.closed).toBeNull();
  });

  it('방이 비면 받지 않고, 다시 열리면 지난 일을 틀지 않고 새 기준부터', async () => {
    setFeed(match());
    const a = await join(4);
    await a.next('feed');
    a.close();
    await sleep(POLL * 3);
    const stopped = calls;
    await sleep(POLL * 6);
    expect(calls).toBe(stopped);

    // 비어 있는 사이 골이 났다. 다시 들어와도 그 골은 울리지 않는다
    setFeed(match({ h: 1, g: 1 }));
    const b = await join(4);
    await b.next('feed', (m) => m.feed.matches[0]?.home.score === 1);
    await sleep(POLL * 4);
    expect(count(b, 'moment')).toBe(0);
    // 그 뒤로는 다시 순간이 난다
    setFeed(match({ h: 1, a: 1, g: 1 }));
    expect((await b.next('moment')).m).toMatchObject({ id: 'sm-1:concede:a1', kind: 'concede' });
  });

  it('판독 취소 뒤 같은 점수로 다시 들어간 골은 새 id로 울리고, 같은 피드를 다시 받아도 두 번 울리지 않는다. 기억은 저장소에 있다', async () => {
    setFeed(match());
    const a = await join(5);
    await a.next('feed');
    setFeed(match({ h: 1 }));
    await a.next('moment', (m) => m.m.id === 'sm-1:goal:h1');

    setFeed(match({ h: 0 })); // 취소
    await a.next('feed', (m) => m.feed.matches[0]?.home.score === 0);
    setFeed(match({ h: 1 })); // 진짜 골
    expect((await a.next('moment')).m).toMatchObject({ id: 'sm-1:goal:h1:e1', kind: 'goal' });
    await sleep(POLL * 4); // 같은 피드를 몇 번 더 받아도 그대로
    expect(moments(a).map((m) => m.id)).toEqual(['sm-1:goal:h1', 'sm-1:goal:h1:e1']);

    // 휴면이나 재시작 뒤에도 이어지도록 피드, 보낸 순간, 정정 횟수, 다음 차례는 모두 저장소에 있다
    // (시험의 150ms 폴링 중에는 evictDurableObject가 끝나지 않아서 저장소를 직접 본다)
    await runInDurableObject(env.ROOM.get(env.ROOM.idFromName('jumak:5')), (_instance, state) => {
      const kv = state.storage.kv;
      expect(kv.get<string[]>('fired')).toEqual(expect.arrayContaining(['sm-1:goal:h1', 'sm-1:goal:h1:e1']));
      expect(kv.get<Record<string, number>>('epochs')).toEqual({ 'sm-1': 1 });
      expect(kv.get<{ feed: CheerFeed }>('feed')?.feed.matches[0]?.home.score).toBe(1);
      expect(kv.get<number>('due:poll')).toBeGreaterThan(Date.now() - 1000);
    });
  });

  it('피드를 쓰지 않는 공간(test-room)에는 feed가 오지 않는다', async () => {
    setFeed(match());
    const a = await join(1, 'test-room');
    await sleep(POLL * 4);
    expect(count(a, 'feed')).toBe(0);
  });

  it('피드를 받는 동안에도 로비 인원 알림이 제때 간다(알람 하나를 나눠 쓴다)', async () => {
    setFeed(match());
    await join(6);
    await join(6);
    await join(6); // 2초 묶음에 걸려 알람으로 미뤄진다
    await sleep(2600);
    const res = await exports.default.fetch('http://presence.test/rooms?space=jumak');
    const body = (await res.json()) as { rooms: Array<{ room: number; n: number }>; capacity: number };
    expect(body.capacity).toBe(24);
    expect(body.rooms.find((r) => r.room === 6)?.n).toBe(3);
  });
});
