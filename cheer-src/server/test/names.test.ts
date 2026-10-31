// 이름 짓기: 주막의 축구 선수 말장난 목록(JUMAK_NAMES)과 목록에서 고르는 규칙
import { afterEach, describe, expect, it } from 'vitest';
import { SHARED_SPACES } from '../../shared/spaces';
import { JUMAK_NAME_ADJECTIVES, JUMAK_NAMES } from '../../shared/spaces/jumak-names';
import { MAX_NAME_CHARS, pickFromList, pickNames } from '../src/names';
import { TestClient, sleep } from './helpers';

/** 늘 같은 순서로 도는 가짜 난수 */
function seq(...values: number[]) {
  let i = 0;
  return () => values[i++ % values.length]!;
}

/** 주막 규칙으로 n명을 한 방에 차례로 들인다 */
function fillJumak(n: number): Set<string> {
  const used = new Set<string>();
  for (let i = 0; i < n; i++) {
    const name = pickNames(SHARED_SPACES.jumak!.nameWords, used, new Set());
    expect(used.has(name.ko), name.ko).toBe(false);
    used.add(name.ko);
  }
  return used;
}

/** 14자 이하인 '꾸밈말 이름' 조합 전부 */
const JUMAK_COMBOS = JUMAK_NAME_ADJECTIVES.flatMap((adj) => JUMAK_NAMES.map((name) => `${adj} ${name}`)).filter(
  (combo) => [...combo].length <= MAX_NAME_CHARS,
);

describe('JUMAK_NAMES', () => {
  it('100개 이상이고, 빈 이름 없이 띄어쓰기 포함 10자 이하다', () => {
    expect(JUMAK_NAMES.length).toBeGreaterThanOrEqual(100);
    for (const name of JUMAK_NAMES) {
      expect(name.trim(), name).toBe(name);
      expect(name.length, name).toBeGreaterThan(0);
      expect([...name].length, name).toBeLessThanOrEqual(10);
      expect(name, name).not.toMatch(/\s{2}/);
      // 숫자가 있으면 '한반두 2' 같은 번호와 헷갈린다
      expect(name, name).not.toMatch(/\d/);
    }
  });

  it('겹치는 이름이 없다(띄어쓰기만 다른 것도)', () => {
    expect(new Set(JUMAK_NAMES).size).toBe(JUMAK_NAMES.length);
    const squashed = JUMAK_NAMES.map((n) => n.replace(/\s/g, ''));
    expect(new Set(squashed).size).toBe(JUMAK_NAMES.length);
  });

  it('꾸밈말: 사용자가 말한 셋(화난, 부상당한, 득점왕)이 있고, 겹치지 않고 숫자가 없다', () => {
    expect(JUMAK_NAME_ADJECTIVES.length).toBeGreaterThanOrEqual(30);
    expect(JUMAK_NAME_ADJECTIVES).toEqual(expect.arrayContaining(['화난', '부상당한', '득점왕']));
    expect(new Set(JUMAK_NAME_ADJECTIVES).size).toBe(JUMAK_NAME_ADJECTIVES.length);
    for (const adj of JUMAK_NAME_ADJECTIVES) {
      expect(adj.trim(), adj).toBe(adj);
      expect(adj.length, adj).toBeGreaterThan(0);
      expect(adj, adj).not.toMatch(/\d/);
    }
  });

  it('꾸밈말 조합은 원래 이름과 겹치지 않고, 대부분 14자 안에 들어간다', () => {
    const base = new Set(JUMAK_NAMES);
    expect(new Set(JUMAK_COMBOS).size).toBe(JUMAK_COMBOS.length);
    for (const combo of JUMAK_COMBOS) expect(base.has(combo), combo).toBe(false);
    expect(JUMAK_COMBOS.length).toBeGreaterThan(JUMAK_NAMES.length * JUMAK_NAME_ADJECTIVES.length * 0.9);
  });

  it('주막은 이 목록과 꾸밈말을 쓰고, 다른 공간은 단어 조합을 그대로 쓴다', () => {
    expect(SHARED_SPACES.jumak!.nameWords.list).toBe(JUMAK_NAMES);
    expect(SHARED_SPACES.jumak!.nameWords.listAdjectives).toBe(JUMAK_NAME_ADJECTIVES);
    expect(SHARED_SPACES['test-room']!.nameWords.list).toBeUndefined();
  });
});

describe('목록에서 이름 고르기', () => {
  it('방에 이미 있는 이름은 피한다', () => {
    const list = ['한반두', '필레', '조선 루니'];
    const used = new Set(['한반두', '조선 루니']);
    for (const r of [0, 0.5, 0.99]) expect(pickFromList(list, ['화난'], used, () => r)).toBe('필레');
  });

  it('목록 크기만큼은 꾸밈말 없이 원래 이름만, 모두 다르게', () => {
    expect(fillJumak(JUMAK_NAMES.length)).toEqual(new Set(JUMAK_NAMES));
  });

  it('목록이 다 쓰이면 꾸밈말을 붙인다: 화난 한반두, 부상당한 필레 (숫자는 아직 없다)', () => {
    const used = fillJumak(JUMAK_NAMES.length + 300);
    const extra = [...used].filter((n) => !JUMAK_NAMES.includes(n));
    expect(extra).toHaveLength(300);
    const combos = new Set(JUMAK_COMBOS);
    for (const n of extra) {
      expect(combos.has(n), n).toBe(true);
      expect([...n].length, n).toBeLessThanOrEqual(MAX_NAME_CHARS);
      expect(n, n).not.toMatch(/\d/);
    }
  });

  it('꾸밈말은 앞에 붙고, 14자를 넘는 조합은 건너뛴다', () => {
    const list = ['한반두', '데이비드 백설기'];
    const used = new Set(list);
    // '막걸리 마신 데이비드 백설기'는 15자라서 고를 수 없다
    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const n = pickFromList(list, ['화난', '막걸리 마신'], used, () => 0.999);
      seen.add(n);
      used.add(n);
    }
    expect(seen).toEqual(new Set(['화난 한반두', '화난 데이비드 백설기', '막걸리 마신 한반두', '데이비드 백설기 2']));
  });

  it('조합까지 다 쓰여야 숫자를 붙인다: 한반두 2, 한반두 3', () => {
    const list = ['한반두', '필레'];
    const used = new Set<string>([...list, '화난 한반두', '화난 필레']);
    const a = pickFromList(list, ['화난'], used, () => 0);
    expect(a).toBe('한반두 2');
    used.add(a);
    expect(pickFromList(list, ['화난'], used, () => 0)).toBe('한반두 3');
    expect(pickFromList(list, ['화난'], used, () => 0.9)).toBe('필레 2');
  });

  it('꾸밈말이 없는 목록은 바로 숫자를 붙이고, 나간 번호는 다시 쓴다', () => {
    expect(pickFromList(['한반두', '필레'], [], new Set(['한반두', '필레']), () => 0)).toBe('한반두 2');
    expect(pickFromList(['한반두', '필레'], [], new Set(['한반두', '필레', '한반두 3']), () => 0)).toBe('한반두 2');
  });

  it('목록이 있으면 한국어 이름만 주고 en은 비운다', () => {
    const n = pickNames(
      { list: ['한반두'], ko: { adjectives: ['맑은'], nouns: ['연잎'] }, en: { adjectives: ['quiet'], nouns: ['roof tile'] } },
      new Set(),
      new Set(),
    );
    expect(n).toEqual({ ko: '한반두' });
  });

  it('목록이 없거나 비었으면 단어 조합으로 돌아간다', () => {
    const words = { ko: { adjectives: ['맑은'], nouns: ['연잎'] }, en: { adjectives: ['quiet'], nouns: ['roof tile'] } };
    expect(pickNames(words, new Set(), new Set())).toEqual({ ko: '맑은 연잎', en: 'Quiet Roof Tile' });
    expect(pickNames({ ...words, list: [], listAdjectives: ['화난'] }, new Set(), new Set())).toEqual({ ko: '맑은 연잎', en: 'Quiet Roof Tile' });
    expect(pickNames({ ...words, list: [] }, new Set(['맑은 연잎']), new Set(), seq(0))).toMatchObject({ ko: '맑은 연잎 2' });
  });
});

describe('주막 방에 들어오면', () => {
  const open: Awaited<ReturnType<typeof TestClient.join>>[] = [];
  afterEach(async () => {
    for (const c of open.splice(0)) c.close();
    await sleep(50);
  });

  it('목록에 있는 서로 다른 이름을 받는다', async () => {
    for (let i = 0; i < 3; i++) open.push(await TestClient.join('jumak', 90));
    const names = open.map((c) => c.welcome.name);
    for (const n of names) {
      expect(JUMAK_NAMES).toContain(n.ko);
      expect(n.en).toBeUndefined();
    }
    expect(new Set(names.map((n) => n.ko)).size).toBe(3);
  });
});
