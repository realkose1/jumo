import { describe, expect, it } from 'vitest';
import { LIMITS, MAX_ACT_VARIANTS } from '../../shared/protocol';
import { SHARED_SPACES } from '../../shared/spaces';
import { pickName, pickNames } from '../src/names';
import { RateWindow } from '../src/ratelimit';
import { openRooms, recommendRoom } from '../src/recommend';
import { kstDay } from '../src/time';
import { normalizeAngle, parseClientMessage } from '../src/validate';
import { getSpaceConfig } from '../src/env';

describe('공간 데이터', () => {
  for (const space of Object.values(SHARED_SPACES)) {
    it(`${space.id}: 모양이 맞다`, () => {
      expect(new Set(space.seatIds).size).toBe(space.seatIds.length);
      expect(space.actions.length).toBeGreaterThan(0);
      expect(space.actions.filter((a) => a.greeting)).toHaveLength(1);
      expect(space.actions.find((a) => a.greeting)?.id).toBe(space.greetingActionId);
      expect(new Set(space.actions.map((a) => a.id)).size).toBe(space.actions.length);
      for (const a of space.actions) {
        if (a.variants === undefined) continue;
        expect(a.variants).toBeGreaterThan(0);
        expect(a.variants).toBeLessThanOrEqual(MAX_ACT_VARIANTS);
      }
      expect(new Set(space.states.map((st) => st.id)).size).toBe(space.states.length);
      expect(space.capacityPerRoom).toBeGreaterThan(0);
      expect(space.initialRoomCount).toBeGreaterThan(0);
      for (const lang of [space.nameWords.ko, space.nameWords.en]) {
        if (!lang) continue;
        expect(new Set(lang.adjectives).size).toBe(lang.adjectives.length);
        expect(new Set(lang.nouns).size).toBe(lang.nouns.length);
      }
    });
  }

  it('시험용 방의 값이 화면 쪽 값과 같다', () => {
    const tr = SHARED_SPACES['test-room']!;
    expect(tr.seatIds).toHaveLength(6);
    expect([tr.capacityPerRoom, tr.initialRoomCount]).toEqual([50, 10]);
    expect(tr.nameWords.ko.adjectives).toHaveLength(6);
    expect(tr.nameWords.ko.nouns).toHaveLength(6);
    expect(tr.nameWords.en).toBeUndefined();
  });

  it('설정 덮어쓰기: SPACE_OVERRIDES로 정원과 방 개수를 바꾼다', () => {
    const env = { SPACE_OVERRIDES: '{"test-room":{"rooms":60,"capacity":20}}' } as never;
    expect(getSpaceConfig(env, 'test-room')).toMatchObject({ roomCount: 60, capacity: 20 });
    expect(getSpaceConfig({ SPACE_OVERRIDES: '{"test-room":{"rooms":-3}}' } as never, 'test-room')).toMatchObject({ roomCount: 10, capacity: 50 });
    expect(getSpaceConfig({ SPACE_OVERRIDES: '깨진 값' } as never, 'test-room')).toMatchObject({ roomCount: 10 });
    expect(getSpaceConfig({} as never, 'nope')).toBeNull();
    expect(getSpaceConfig({} as never, '__proto__')).toBeNull();
  });
});

describe('이름 뽑기', () => {
  it('쓰인 이름은 피하고, 조합이 바닥나면 숫자를 붙인다', () => {
    const words = { adjectives: ['a'], nouns: ['x', 'y'] };
    const used = new Set<string>();
    const names = [1, 2, 3, 4].map(() => {
      const n = pickName(words, used, 'ko');
      used.add(n);
      return n;
    });
    expect(new Set(names).size).toBe(4);
    expect(names.filter((n) => /\d$/.test(n))).toHaveLength(2);
  });

  it('영어는 단어 첫 글자를 대문자로', () => {
    const n = pickNames({ ko: { adjectives: ['맑은'], nouns: ['연잎'] }, en: { adjectives: ['quiet'], nouns: ['roof tile'] } }, new Set(), new Set());
    expect(n).toEqual({ ko: '맑은 연잎', en: 'Quiet Roof Tile' });
  });
});

describe('방 추천', () => {
  const counts = (ns: number[]) => ns.map((n, i) => ({ room: i + 1, n }));
  it('모두 비었으면 1번', () => expect(recommendRoom(counts([0, 0, 0]), 50)).toBe(1));
  it('적당히 찬 방 중 가장 많은 방', () => expect(recommendRoom(counts([0, 5, 20, 40]), 50)).toBe(3));
  it('모두 60%를 넘으면 가장 한산한 방', () => expect(recommendRoom(counts([45, 38, 49]), 50)).toBe(2));
  it('찬 방과 제외한 방은 뺀다', () => {
    expect(recommendRoom(counts([50, 3, 50]), 50)).toBe(2);
    expect(recommendRoom(counts([50, 3, 50]), 50, 2)).toBeNull();
    expect(recommendRoom(counts([5, 5]), 50, 1)).toBe(2);
  });
});

describe('속도 제한', () => {
  it('종류별로 1초에 정해진 횟수까지', () => {
    const r = new RateWindow();
    const t = 10_000;
    const results = Array.from({ length: 12 }, () => r.take('move', t));
    expect(results.filter(Boolean)).toHaveLength(LIMITS.moveHz);
    expect(r.take('move', t + 1000)).toBe(true); // 다음 창
    expect(r.take('state', t + 1000)).toBe(true);
  });

  it('state는 초당 2번', () => {
    const r = new RateWindow();
    expect([r.take('state', 5000), r.take('state', 5100), r.take('state', 5200)]).toEqual([true, true, false]);
    expect(r.take('state', 6000)).toBe(true);
  });

  it('같은 동작은 쿨다운 안에서 막는다', () => {
    const r = new RateWindow();
    expect(r.takeAct('a', 1000, 1000)).toBe(true);
    expect(r.takeAct('a', 1999, 1000)).toBe(false);
    expect(r.takeAct('b', 1500, 1000)).toBe(true);
    expect(r.takeAct('a', 2000, 1000)).toBe(true);
  });
});

describe('한국 시간 날짜', () => {
  it('UTC 15:00에 날짜가 바뀐다', () => {
    expect(kstDay(Date.parse('2026-10-31T14:59:59Z'))).toBe('2026-10-31');
    expect(kstDay(Date.parse('2026-10-31T15:00:00Z'))).toBe('2026-11-01');
    expect(kstDay(Date.parse('2026-12-31T15:00:00Z'))).toBe('2027-01-01');
  });
});

describe('메시지 검사', () => {
  const ok = (v: unknown) => parseClientMessage(JSON.stringify(v)).ok;
  it('올바른 메시지', () => {
    expect(ok({ t: 'join', space: 'test-room', dev: 'abcdefgh1234' })).toBe(true);
    expect(ok({ t: 'move', x: 1, z: -2.5, r: 3 })).toBe(true);
    expect(ok({ t: 'sit', seat: 'a1' })).toBe(true);
    expect(ok({ t: 'stand' })).toBe(true);
    expect(ok({ t: 'act', act: 'hop-small', to: 3 })).toBe(true);
    expect(ok({ t: 'state', key: 'lamp', val: 1 })).toBe(true);
    expect(ok({ t: 'ping' })).toBe(true);
  });
  it('틀린 메시지', () => {
    expect(ok({ t: 'join', space: 'test-room', dev: 'short' })).toBe(false);
    expect(ok({ t: 'join', space: 'test room', dev: 'abcdefgh1234' })).toBe(false);
    expect(ok({ t: 'join', space: 'x', dev: 'abcdefgh1234', room: 1.5 })).toBe(false);
    expect(ok({ t: 'move', x: 501, z: 0, r: 0 })).toBe(false);
    expect(ok({ t: 'move', x: 0, z: 0 })).toBe(false);
    expect(ok({ t: 'sit', seat: '../../x' })).toBe(false);
    expect(ok({ t: 'act', act: 'a', to: -1 })).toBe(false);
    expect(ok({ t: 'state', key: 'lamp', val: 0.5 })).toBe(false);
    expect(ok({ t: 'ping', c: 'x' })).toBe(false);
    expect(ok(null)).toBe(false);
    expect(parseClientMessage(new ArrayBuffer(8)).ok).toBe(false);
  });
  it('join의 시작 위치가 틀려도 입장은 막지 않는다', () => {
    const r = parseClientMessage(JSON.stringify({ t: 'join', space: 'test-room', dev: 'abcdefgh1234', x: 1e9, z: 'a' }));
    expect(r.ok && r.msg.t === 'join' && r.msg.x === 0 && r.msg.z === 0).toBe(true);
  });
  it('각도는 -π~π로 접는다', () => {
    expect(normalizeAngle(Math.PI * 2)).toBe(0);
    expect(normalizeAngle(-Math.PI * 3)).toBeCloseTo(-3.14, 2);
    expect(normalizeAngle(1)).toBe(1);
  });
});

describe('방 더 열기 (openRooms)', () => {
  const counts = (...ns: number[]) => ns.map((n, i) => ({ room: i + 1, n }));

  it('기본 개수만 열고, 모두 90% 이상 차면 하나씩 더 연다(최대까지)', () => {
    expect(openRooms(counts(3, 0, 0, 0, 0, 0, 0), 5, 24)).toHaveLength(5);
    expect(openRooms(counts(22, 24, 23, 22, 24, 0, 0), 5, 24)).toHaveLength(6);
    expect(openRooms(counts(24, 24, 24, 24, 24, 22, 0), 5, 24)).toHaveLength(7);
    expect(openRooms(counts(24, 24, 24, 24, 24, 24, 24), 5, 24)).toHaveLength(7);
  });

  it('기본보다 큰 번호라도 사람이 있으면 계속 보인다', () => {
    expect(openRooms(counts(3, 0, 0, 0, 0, 0, 2), 5, 24)).toHaveLength(7);
  });

  it('추천: 새로 연 빈 방으로, 정말 다 찼으면 null(꽉 찼어요)', () => {
    expect(recommendRoom(openRooms(counts(24, 23, 24, 22, 24, 0), 5, 24), 24)).toBe(6);
    // 꽉 찬 방에서 거절당한 사람(exclude)은 자기 방을 빼고 본다
    expect(recommendRoom(openRooms(counts(24, 23, 24, 22, 24, 0), 5, 24, 1), 24, 1)).toBe(6);
    const full = counts(...Array(12).fill(24));
    expect(recommendRoom(openRooms(full, 5, 24), 24)).toBeNull();
  });

  it('maxRoomCount가 있는 공간은 그 수까지 늘리고(시험 공간: 5개에서 12개), SPACE_OVERRIDES의 maxRooms로 바꾼다', () => {
    expect(getSpaceConfig({} as never, 'fixture')).toMatchObject({ roomCount: 5, maxRooms: 12, capacity: 24 });
    expect(getSpaceConfig({ SPACE_OVERRIDES: '{"fixture":{"maxRooms":20}}' } as never, 'fixture')).toMatchObject({ maxRooms: 20 });
    // 기본 개수보다 작게는 안 된다. 상한이 없는 공간은 늘리지 않는다
    expect(getSpaceConfig({ SPACE_OVERRIDES: '{"fixture":{"rooms":8,"maxRooms":3}}' } as never, 'fixture')).toMatchObject({ roomCount: 8, maxRooms: 8 });
    expect(getSpaceConfig({} as never, 'test-room')).toMatchObject({ roomCount: 10, maxRooms: 10 });
  });
});
