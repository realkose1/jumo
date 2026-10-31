// shared/moments.ts: 피드 두 장을 비교해 순간을 만드는 순수 함수
import { describe, expect, it } from 'vitest';
import type { CheerFeed, CheerMatch, CheerPlayer } from '../../shared/cheer';
import { MAX_MOMENTS_PER_JUMP, deriveMoments, deriveMomentsWithEpochs, ourSideOf } from '../../shared/moments';

const NOW = 1_800_000_000_000;

function match(over: Partial<CheerMatch> & { h?: number | null; a?: number | null } = {}): CheerMatch {
  const { h = 0, a = 0, ...rest } = over;
  return {
    id: 'm1',
    sport: 'soccer',
    comp: 'EPL',
    home: { name: '울버햄튼', score: h },
    away: { name: '리버풀', score: a },
    side: 'home',
    state: 'live',
    clock: "30'",
    ko: NOW - 30 * 60_000,
    players: [{ name: '황희찬', side: 'home', g: 0 }],
    ...rest,
  };
}

const feed = (...matches: CheerMatch[]): CheerFeed => ({ v: 1, now: NOW, matches });
const players = (...p: CheerPlayer[]) => p;
const kinds = (ms: ReturnType<typeof deriveMoments>) => ms.map((m) => m.kind);
const ids = (ms: ReturnType<typeof deriveMoments>) => ms.map((m) => m.id);

describe('처음에는 아무것도 내지 않는다', () => {
  it('직전 피드가 없으면(방이 막 열림) 빈 배열', () => {
    expect(deriveMoments(null, feed(match({ h: 3, a: 1, state: 'final' })), NOW)).toEqual([]);
  });

  it('처음 보는 경기는 이미 골이 났어도, 끝났어도 조용하다', () => {
    const prev = feed(match({ id: 'other' }));
    expect(deriveMoments(prev, feed(match({ h: 2, state: 'live' })), NOW)).toEqual([]);
    expect(deriveMoments(prev, feed(match({ h: 2, state: 'final' })), NOW)).toEqual([]);
  });

  it('직전 피드의 next(다음 경기)에 있던 경기는 본 경기로 친다', () => {
    const prev: CheerFeed = { v: 1, now: NOW, matches: [], next: match({ state: 'pre', h: null, a: null }) };
    expect(kinds(deriveMoments(prev, feed(match({ state: 'live' })), NOW))).toEqual(['kickoff']);
  });

  it('바뀐 것이 없으면 빈 배열', () => {
    const m = match({ h: 1 });
    expect(deriveMoments(feed(m), feed(structuredClone(m)), NOW)).toEqual([]);
  });
});

describe('시작', () => {
  it('pre -> live에 kickoff 하나, 모양과 글자', () => {
    const out = deriveMoments(feed(match({ state: 'pre', h: null, a: null })), feed(match({ state: 'live' })), NOW);
    expect(out).toEqual([{ id: 'm1:kickoff', kind: 'kickoff', match: 'm1', at: NOW, text: '경기 시작!' }]);
  });

  it('시작과 첫 골이 한 번에 보이면 kickoff 다음 goal (경기 전 점수 null은 0으로 본다)', () => {
    const out = deriveMoments(feed(match({ state: 'pre', h: null, a: null })), feed(match({ state: 'live', h: 1 })), NOW);
    expect(ids(out)).toEqual(['m1:kickoff', 'm1:goal:h1']);
  });

  it('pre -> final(시작을 놓침)은 시작도 끝도 내지 않는다', () => {
    expect(deriveMoments(feed(match({ state: 'pre', h: null, a: null })), feed(match({ state: 'final', h: 1 })), NOW)).toEqual([]);
  });
});

describe('골과 실점', () => {
  it('우리(홈) 골: 팀 이름을 넣은 글자, 홈 골 수가 들어간 id', () => {
    const out = deriveMoments(feed(match()), feed(match({ h: 1 })), NOW);
    expect(out).toEqual([{ id: 'm1:goal:h1', kind: 'goal', match: 'm1', at: NOW, text: '울버햄튼 골!' }]);
  });

  it('상대 골은 concede', () => {
    const out = deriveMoments(feed(match({ h: 1 })), feed(match({ h: 1, a: 1 })), NOW);
    expect(out).toEqual([{ id: 'm1:concede:a1', kind: 'concede', match: 'm1', at: NOW, text: '아쉬워요, 실점' }]);
  });

  it('우리가 원정이면 원정 골이 goal, 홈 골이 concede', () => {
    const away = { side: 'away' as const, players: [{ name: '이강인', side: 'away' as const, g: 0 }] };
    expect(deriveMoments(feed(match(away)), feed(match({ ...away, a: 1 })), NOW)).toMatchObject([
      { id: 'm1:goal:a1', kind: 'goal', text: '리버풀 골!' },
    ]);
    expect(deriveMoments(feed(match(away)), feed(match({ ...away, h: 1 })), NOW)).toMatchObject([
      { id: 'm1:concede:h1', kind: 'concede' },
    ]);
  });

  it('코리안 더비(both): 어느 쪽 골이든 goal이고 글자는 넣은 팀 이름, 실점은 없다', () => {
    const derby = { side: 'both' as const, home: { name: '토트넘', score: 0 }, away: { name: 'PSG', score: 0 } };
    const prev = feed(match(derby));
    const next = feed(match({ ...derby, home: { name: '토트넘', score: 1 }, away: { name: 'PSG', score: 1 } }));
    expect(deriveMoments(prev, next, NOW)).toMatchObject([
      { id: 'm1:goal:h1', kind: 'goal', text: '토트넘 골!' },
      { id: 'm1:goal:a1', kind: 'goal', text: 'PSG 골!' },
    ]);
  });

  it('한 번에 두 골이 오르면 골마다 하나씩', () => {
    expect(ids(deriveMoments(feed(match()), feed(match({ h: 2 })), NOW))).toEqual(['m1:goal:h1', 'm1:goal:h2']);
  });

  it(`크게 뛰면 최근 ${MAX_MOMENTS_PER_JUMP}골까지만`, () => {
    expect(ids(deriveMoments(feed(match()), feed(match({ h: 5 })), NOW))).toEqual(['m1:goal:h3', 'm1:goal:h4', 'm1:goal:h5']);
  });

  it('점수가 내려가면(판독 취소) 아무것도 내지 않는다', () => {
    expect(deriveMoments(feed(match({ h: 2, a: 1 })), feed(match({ h: 1, a: 0 })), NOW)).toEqual([]);
  });

  it('정정 횟수를 이어 가지 않으면(deriveMoments) 같은 점수의 골은 같은 id다', () => {
    const first = deriveMoments(feed(match()), feed(match({ h: 1 })), NOW);
    const again = deriveMoments(feed(match({ h: 0 })), feed(match({ h: 1 })), NOW + 60_000);
    expect(ids(again)).toEqual(ids(first));
  });

  it('같은 변화를 두 번 비교해도(다시 시도한 폴링) 같은 id', () => {
    const prev = feed(match());
    const next = feed(match({ h: 1, a: 1, players: players({ name: '황희찬', side: 'home', g: 1 }) }));
    expect(ids(deriveMoments(prev, next, NOW))).toEqual(ids(deriveMoments(prev, next, NOW + 5)));
  });

  it('진행 중인데 직전 점수가 없으면(피드가 잠깐 비었음) 새 기준으로만 삼는다', () => {
    expect(deriveMoments(feed(match({ h: null })), feed(match({ h: 2 })), NOW)).toEqual([]);
    expect(deriveMoments(feed(match({ h: 1 })), feed(match({ h: null })), NOW)).toEqual([]);
  });

  it('끝난 뒤 점수 정정에는 반응하지 않는다', () => {
    expect(deriveMoments(feed(match({ state: 'final', h: 1 })), feed(match({ state: 'final', h: 2 })), NOW)).toEqual([]);
  });

  it('우리 쪽을 모르면(side null, 선수도 없음) 팀 골과 실점은 내지 않는다', () => {
    const unknown = { side: null, players: [] };
    expect(deriveMoments(feed(match(unknown)), feed(match({ ...unknown, h: 1, a: 1 })), NOW)).toEqual([]);
  });

  it('side가 null이면 선수 목록으로 우리 쪽을 짐작한다', () => {
    expect(ourSideOf(match({ side: null, players: players({ name: '김민재', side: 'away', g: 0 }) }))).toBe('away');
    expect(
      ourSideOf(match({ side: null, players: players({ name: 'A', side: 'away', g: 0 }, { name: 'B', side: 'home', g: 0 }) })),
    ).toBe('both');
    const guessed = { side: null, players: players({ name: '김민재', side: 'away', g: 0 }) };
    expect(deriveMoments(feed(match(guessed)), feed(match({ ...guessed, h: 1 })), NOW)).toMatchObject([{ kind: 'concede' }]);
  });
});

describe('우리 선수 골', () => {
  it('g가 오르면 팀 goal 다음에 player-goal("황희찬 골!")', () => {
    const out = deriveMoments(
      feed(match()),
      feed(match({ h: 1, players: players({ name: '황희찬', side: 'home', g: 1 }) })),
      NOW,
    );
    expect(out).toEqual([
      { id: 'm1:goal:h1', kind: 'goal', match: 'm1', at: NOW, text: '울버햄튼 골!' },
      { id: 'm1:pg:황희찬:1', kind: 'player-goal', match: 'm1', at: NOW, text: '황희찬 골!', player: '황희찬' },
    ]);
  });

  it('상대 팀에서 뛰는 우리 선수(더비)의 골도 player-goal', () => {
    const derby = { side: 'both' as const, players: players({ name: '손흥민', side: 'home', g: 0 }, { name: '이강인', side: 'away', g: 0 }) };
    const out = deriveMoments(
      feed(match(derby)),
      feed(match({ ...derby, a: 1, players: players({ name: '손흥민', side: 'home', g: 0 }, { name: '이강인', side: 'away', g: 1 }) })),
      NOW,
    );
    expect(out.find((m) => m.kind === 'player-goal')).toMatchObject({ text: '이강인 골!', player: '이강인' });
  });

  it('g가 내려가면 아무것도 없다', () => {
    const prev = feed(match({ h: 1, players: players({ name: '황희찬', side: 'home', g: 1 }) }));
    expect(deriveMoments(prev, feed(match({ h: 1 })), NOW)).toEqual([]);
  });

  it('축구: 경기 중에 처음 목록에 나타난 선수(대표팀 피드는 골, 도움이 나온 선수만 싣는다)는 0골에서 센다', () => {
    const prev = feed(match({ players: [] }));
    const out = deriveMoments(prev, feed(match({ h: 1, players: players({ name: '오현규', side: 'home', g: 1 }) })), NOW);
    expect(out).toMatchObject([
      { id: 'm1:goal:h1', kind: 'goal' },
      { id: 'm1:pg:오현규:1', kind: 'player-goal', text: '오현규 골!', player: '오현규' },
    ]);
    // 도움으로 먼저 실렸다가(g 0) 나중에 골을 넣어도 한 번
    const assisted = feed(match({ players: players({ name: '오현규', side: 'home', g: 0, a: 1 }) }));
    expect(ids(deriveMoments(prev, assisted, NOW))).toEqual([]);
    expect(ids(deriveMoments(assisted, feed(match({ h: 1, players: players({ name: '오현규', side: 'home', g: 1, a: 1 }) })), NOW))).toEqual([
      'm1:goal:h1',
      'm1:pg:오현규:1',
    ]);
    // 처음 나타날 때 g가 크면 최근 골부터 상한까지
    const many = deriveMoments(prev, feed(match({ h: 5, players: players({ name: '오현규', side: 'home', g: 4 }) })), NOW);
    expect(ids(many).filter((id) => id.includes(':pg:'))).toEqual(['m1:pg:오현규:2', 'm1:pg:오현규:3', 'm1:pg:오현규:4']);
  });

  it('처음 보는 경기는 선수 골이 있어도 조용하다', () => {
    const prev = feed(match({ id: 'other' }));
    expect(deriveMoments(prev, feed(match({ h: 1, players: players({ name: '오현규', side: 'home', g: 1 }) })), NOW)).toEqual([]);
  });

  it('야구: 경기 중에 처음 나타난 선수는 지금 값을 기준으로만 삼는다', () => {
    const bb = { sport: 'baseball' as const, players: [] };
    const prev = feed(match(bb));
    expect(deriveMoments(prev, feed(match({ ...bb, players: players({ name: '이정후', side: 'home', g: 1 }) })), NOW)).toEqual([]);
  });

  it('경기 전 목록에 없던 선수가 시작과 함께 골을 넣었으면 0에서 센다', () => {
    const prev = feed(match({ state: 'pre', h: null, a: null, players: [] }));
    const out = deriveMoments(prev, feed(match({ h: 1, players: players({ name: '황희찬', side: 'home', g: 1 }) })), NOW);
    expect(kinds(out)).toEqual(['kickoff', 'goal', 'player-goal']);
  });

  it('멀티골이 한 번에 오르면 골마다', () => {
    const out = deriveMoments(feed(match()), feed(match({ h: 2, players: players({ name: '황희찬', side: 'home', g: 2 }) })), NOW);
    expect(ids(out).filter((id) => id.includes(':pg:'))).toEqual(['m1:pg:황희찬:1', 'm1:pg:황희찬:2']);
  });
});

describe('야구', () => {
  const base = {
    sport: 'baseball' as const,
    home: { name: '자이언츠', score: 2 },
    away: { name: '다저스', score: 2 },
    clock: '5회말',
    players: players({ name: '이정후', side: 'home', g: 0 }),
  };

  it('홈런은 "이정후 홈런!", 득점은 몇 점이 나든 순간 하나', () => {
    const out = deriveMoments(
      feed(match(base)),
      feed(match({ ...base, home: { name: '자이언츠', score: 5 }, players: players({ name: '이정후', side: 'home', g: 1 }) })),
      NOW,
    );
    expect(out).toMatchObject([
      { id: 'm1:goal:h5', kind: 'goal', text: '자이언츠 3점 득점!' },
      { id: 'm1:pg:이정후:1', kind: 'player-goal', text: '이정후 홈런!', player: '이정후' },
    ]);
  });

  it('1점이면 "득점!", 실점은 "아쉬워요, 2실점"', () => {
    expect(deriveMoments(feed(match(base)), feed(match({ ...base, home: { name: '자이언츠', score: 3 } })), NOW)).toMatchObject([
      { kind: 'goal', text: '자이언츠 득점!' },
    ]);
    expect(deriveMoments(feed(match(base)), feed(match({ ...base, away: { name: '다저스', score: 4 } })), NOW)).toMatchObject([
      { id: 'm1:concede:a4', kind: 'concede', text: '아쉬워요, 2실점' },
    ]);
  });

  it('끝: 우리 점수를 앞에 두고 승패', () => {
    const out = deriveMoments(
      feed(match(base)),
      feed(match({ ...base, state: 'final', home: { name: '자이언츠', score: 2 }, away: { name: '다저스', score: 4 } })),
      NOW,
    );
    expect(out.at(-1)).toMatchObject({ kind: 'final', text: '경기 끝, 2:4 아쉬운 패배', result: 'loss' });
  });
});

describe('끝', () => {
  it('live -> final: 승리', () => {
    const out = deriveMoments(feed(match({ h: 2, a: 1 })), feed(match({ state: 'final', h: 2, a: 1 })), NOW);
    expect(out).toEqual([{ id: 'm1:final', kind: 'final', match: 'm1', at: NOW, text: '경기 끝, 2:1 승리!', result: 'win' }]);
  });

  it('무승부, 패배', () => {
    expect(deriveMoments(feed(match({ h: 1, a: 1 })), feed(match({ state: 'final', h: 1, a: 1 })), NOW)[0]).toMatchObject({
      text: '경기 끝, 1:1 무승부',
      result: 'draw',
    });
    expect(deriveMoments(feed(match({ h: 0, a: 1 })), feed(match({ state: 'final', h: 0, a: 1 })), NOW)[0]).toMatchObject({
      text: '경기 끝, 0:1 아쉬운 패배',
      result: 'loss',
    });
  });

  it('원정 승리는 우리 점수를 앞에', () => {
    const away = { side: 'away' as const };
    expect(deriveMoments(feed(match({ ...away, h: 1, a: 2 })), feed(match({ ...away, state: 'final', h: 1, a: 2 })), NOW)[0]).toMatchObject({
      text: '경기 끝, 2:1 승리!',
      result: 'win',
    });
  });

  it('더비는 결과 없이 홈:원정 점수만', () => {
    const out = deriveMoments(feed(match({ side: 'both', h: 2, a: 1 })), feed(match({ side: 'both', state: 'final', h: 2, a: 1 })), NOW);
    expect(out).toEqual([{ id: 'm1:final', kind: 'final', match: 'm1', at: NOW, text: '경기 끝, 2:1' }]);
  });

  it('점수를 모르면 "경기 끝!"', () => {
    const out = deriveMoments(feed(match({ h: null, a: null })), feed(match({ state: 'final', h: null, a: null })), NOW);
    expect(out).toMatchObject([{ id: 'm1:final', text: '경기 끝!' }]);
    expect(out[0]).not.toHaveProperty('result');
  });

  it('마지막 골과 종료가 한 번에 보이면 순서는 goal, player-goal, concede, final', () => {
    const out = deriveMoments(
      feed(match({ h: 1, a: 1 })),
      feed(match({ state: 'final', h: 2, a: 2, players: players({ name: '황희찬', side: 'home', g: 1 }) })),
      NOW,
    );
    expect(kinds(out)).toEqual(['goal', 'player-goal', 'concede', 'final']);
    expect(out.at(-1)).toMatchObject({ text: '경기 끝, 2:2 무승부', result: 'draw' });
  });
});

describe('여러 경기', () => {
  it('경기마다 따로 계산하고, 같은 id가 두 번 있으면 첫 번째만 본다', () => {
    const prev = feed(match({ id: 'a' }), match({ id: 'b', state: 'pre', h: null, a: null }));
    const next = feed(match({ id: 'a', h: 1 }), match({ id: 'b', state: 'live' }), match({ id: 'a', h: 3 }));
    expect(ids(deriveMoments(prev, next, NOW))).toEqual(['a:goal:h1', 'b:kickoff']);
  });

  it('사라졌다 다시 나타난 경기는 처음 보는 경기다', () => {
    const prev = feed(match({ id: 'other' }));
    expect(deriveMoments(prev, feed(match({ h: 1 })), NOW)).toEqual([]);
  });
});

describe('정정 횟수(epoch): 판독으로 점수가 내려간 뒤의 진짜 골', () => {
  it('점수가 내려가면 그 경기의 정정 횟수가 오르고, 같은 점수로 다시 들어간 골은 새 id(:e1)로 난다', () => {
    let epochs: Record<string, number> = {};
    const step = (prev: CheerFeed, next: CheerFeed) => {
      const r = deriveMomentsWithEpochs(prev, next, NOW, epochs);
      epochs = r.epochs;
      return ids(r.moments);
    };
    expect(step(feed(match()), feed(match({ h: 1 })))).toEqual(['m1:goal:h1']);
    expect(step(feed(match({ h: 1 })), feed(match({ h: 0 })))).toEqual([]); // 취소
    expect(epochs).toEqual({ m1: 1 });
    expect(step(feed(match({ h: 0 })), feed(match({ h: 1 })))).toEqual(['m1:goal:h1:e1']);
    expect(step(feed(match({ h: 1 })), feed(match({ h: 2 })))).toEqual(['m1:goal:h2:e1']);
    // 같은 비교를 다시 해도(재시도) 같은 id
    expect(deriveMomentsWithEpochs(feed(match({ h: 1 })), feed(match({ h: 2 })), NOW, epochs).moments.map((m) => m.id)).toEqual([
      'm1:goal:h2:e1',
    ]);
  });

  it('선수 g가 내려가도 정정으로 보고, 그 뒤 선수 골과 실점 id에도 붙는다', () => {
    const scored = feed(match({ h: 1, players: players({ name: '황희찬', side: 'home', g: 1 }) }));
    const r1 = deriveMomentsWithEpochs(scored, feed(match({ h: 1 })), NOW, {});
    expect(r1.moments).toEqual([]);
    expect(r1.epochs).toEqual({ m1: 1 });
    const r2 = deriveMomentsWithEpochs(
      feed(match({ h: 1 })),
      feed(match({ h: 2, a: 1, players: players({ name: '황희찬', side: 'home', g: 1 }) })),
      NOW,
      r1.epochs,
    );
    expect(ids(r2.moments)).toEqual(['m1:goal:h2:e1', 'm1:pg:황희찬:1:e1', 'm1:concede:a1:e1']);
  });

  it('취소와 새 골이 한 번에 보이면 새 골부터 새 횟수', () => {
    const r = deriveMomentsWithEpochs(feed(match({ h: 1 })), feed(match({ h: 0, a: 1 })), NOW, { m1: 2 });
    expect(ids(r.moments)).toEqual(['m1:concede:a1:e3']);
    expect(r.epochs).toEqual({ m1: 3 });
  });

  it('넘긴 epochs는 바꾸지 않고, 다른 경기 값은 그대로 둔다. null로 바뀐 점수는 정정이 아니다', () => {
    const given = Object.freeze({ other: 4 });
    const r = deriveMomentsWithEpochs(feed(match({ h: 1 })), feed(match({ h: 0 })), NOW, given);
    expect(given).toEqual({ other: 4 });
    expect(r.epochs).toEqual({ other: 4, m1: 1 });
    expect(deriveMomentsWithEpochs(feed(match({ h: 1 })), feed(match({ h: null })), NOW, {}).epochs).toEqual({});
    expect(deriveMomentsWithEpochs(null, feed(match()), NOW, { m1: 1 })).toEqual({ moments: [], epochs: { m1: 1 } });
  });
});
