// 이름 짓기: 이름 목록(list)과 꾸밈말(listAdjectives)에서 고르는 규칙. 시험 공간(test/fixtures.ts)으로 확인한다.
import { afterEach, describe, expect, it } from 'vitest';
import { SHARED_SPACES } from '../../shared/spaces';
import { MAX_NAME_CHARS, pickFromList, pickNames } from '../src/names';
import { FIXTURE_NAME_ADJECTIVES, FIXTURE_NAMES, fixture } from './fixtures';
import { TestClient, sleep } from './helpers';

/** 늘 같은 순서로 도는 가짜 난수 */
function seq(...values: number[]) {
  let i = 0;
  return () => values[i++ % values.length]!;
}

/** 시험 공간 규칙으로 n명을 한 방에 차례로 들인다 */
function fill(n: number): Set<string> {
  const used = new Set<string>();
  for (let i = 0; i < n; i++) {
    const name = pickNames(fixture.nameWords, used, new Set());
    expect(used.has(name.ko), name.ko).toBe(false);
    used.add(name.ko);
  }
  return used;
}

/** 14자 이하인 '꾸밈말 이름' 조합 전부 */
const COMBOS = FIXTURE_NAME_ADJECTIVES.flatMap((adj) => FIXTURE_NAMES.map((name) => `${adj} ${name}`)).filter(
  (combo) => [...combo].length <= MAX_NAME_CHARS,
);

describe('공간의 이름 설정', () => {
  it('목록이 있는 공간은 목록과 꾸밈말을 쓰고, 시험용 방은 단어 조합을 그대로 쓴다', () => {
    expect(SHARED_SPACES.fixture!.nameWords.list).toBe(FIXTURE_NAMES);
    expect(SHARED_SPACES.fixture!.nameWords.listAdjectives).toBe(FIXTURE_NAME_ADJECTIVES);
    expect(SHARED_SPACES['test-room']!.nameWords.list).toBeUndefined();
  });

  it('목록이 있는 모든 공간: 빈 이름, 겹치는 이름, 숫자가 없다', () => {
    for (const space of Object.values(SHARED_SPACES)) {
      const list = space.nameWords.list;
      if (!list) continue;
      const squashed = list.map((n) => n.replace(/\s/g, ''));
      expect(new Set(squashed).size, space.id).toBe(list.length);
      for (const name of [...list, ...(space.nameWords.listAdjectives ?? [])]) {
        expect(name.trim(), name).toBe(name);
        expect(name.length, name).toBeGreaterThan(0);
        // 숫자가 있으면 '연꽃 2' 같은 번호와 헷갈린다
        expect(name, name).not.toMatch(/\d/);
      }
    }
  });
});

describe('목록에서 이름 고르기', () => {
  it('방에 이미 있는 이름은 피한다', () => {
    const list = ['연꽃', '풍경', '작은 동자승'];
    const used = new Set(['연꽃', '작은 동자승']);
    for (const r of [0, 0.5, 0.99]) expect(pickFromList(list, ['조용한'], used, () => r)).toBe('풍경');
  });

  it('목록 크기만큼은 꾸밈말 없이 원래 이름만, 모두 다르게', () => {
    expect(fill(FIXTURE_NAMES.length)).toEqual(new Set(FIXTURE_NAMES));
  });

  it('목록이 다 쓰이면 꾸밈말을 붙인다: 조용한 연꽃, 느긋한 풍경 (숫자는 아직 없다)', () => {
    const used = fill(FIXTURE_NAMES.length + COMBOS.length);
    const extra = [...used].filter((n) => !FIXTURE_NAMES.includes(n));
    expect(extra).toHaveLength(COMBOS.length);
    const combos = new Set(COMBOS);
    for (const n of extra) {
      expect(combos.has(n), n).toBe(true);
      expect([...n].length, n).toBeLessThanOrEqual(MAX_NAME_CHARS);
      expect(n, n).not.toMatch(/\d/);
    }
  });

  it('꾸밈말은 앞에 붙고, 14자를 넘는 조합은 건너뛴다', () => {
    const list = ['연꽃', '아주 오래된 풍경'];
    const used = new Set(list);
    // '비 맞은 산 아주 오래된 풍경'은 16자라서 고를 수 없다
    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const n = pickFromList(list, ['조용한', '비 맞은 산'], used, () => 0.999);
      seen.add(n);
      used.add(n);
    }
    expect(seen).toEqual(new Set(['조용한 연꽃', '조용한 아주 오래된 풍경', '비 맞은 산 연꽃', '아주 오래된 풍경 2']));
  });

  it('조합까지 다 쓰여야 숫자를 붙인다: 연꽃 2, 연꽃 3', () => {
    const list = ['연꽃', '풍경'];
    const used = new Set<string>([...list, '조용한 연꽃', '조용한 풍경']);
    const a = pickFromList(list, ['조용한'], used, () => 0);
    expect(a).toBe('연꽃 2');
    used.add(a);
    expect(pickFromList(list, ['조용한'], used, () => 0)).toBe('연꽃 3');
    expect(pickFromList(list, ['조용한'], used, () => 0.9)).toBe('풍경 2');
  });

  it('꾸밈말이 없는 목록은 바로 숫자를 붙이고, 나간 번호는 다시 쓴다', () => {
    expect(pickFromList(['연꽃', '풍경'], [], new Set(['연꽃', '풍경']), () => 0)).toBe('연꽃 2');
    expect(pickFromList(['연꽃', '풍경'], [], new Set(['연꽃', '풍경', '연꽃 3']), () => 0)).toBe('연꽃 2');
  });

  it('목록이 있으면 한국어 이름만 주고 en은 비운다', () => {
    const n = pickNames(
      { list: ['연꽃'], ko: { adjectives: ['맑은'], nouns: ['연잎'] }, en: { adjectives: ['quiet'], nouns: ['roof tile'] } },
      new Set(),
      new Set(),
    );
    expect(n).toEqual({ ko: '연꽃' });
  });

  it('목록이 없거나 비었으면 단어 조합으로 돌아간다', () => {
    const words = { ko: { adjectives: ['맑은'], nouns: ['연잎'] }, en: { adjectives: ['quiet'], nouns: ['roof tile'] } };
    expect(pickNames(words, new Set(), new Set())).toEqual({ ko: '맑은 연잎', en: 'Quiet Roof Tile' });
    expect(pickNames({ ...words, list: [], listAdjectives: ['조용한'] }, new Set(), new Set())).toEqual({ ko: '맑은 연잎', en: 'Quiet Roof Tile' });
    expect(pickNames({ ...words, list: [] }, new Set(['맑은 연잎']), new Set(), seq(0))).toMatchObject({ ko: '맑은 연잎 2' });
  });
});

describe('이름 목록이 있는 공간의 방에 들어오면', () => {
  const open: Awaited<ReturnType<typeof TestClient.join>>[] = [];
  afterEach(async () => {
    for (const c of open.splice(0)) c.close();
    await sleep(50);
  });

  it('목록에 있는 서로 다른 이름을 받는다', async () => {
    for (let i = 0; i < 3; i++) open.push(await TestClient.join('fixture', 90));
    const names = open.map((c) => c.welcome.name);
    for (const n of names) {
      expect(FIXTURE_NAMES).toContain(n.ko);
      expect(n.en).toBeUndefined();
    }
    expect(new Set(names.map((n) => n.ko)).size).toBe(3);
  });
});
