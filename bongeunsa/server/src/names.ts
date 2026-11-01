// 이름 배정: 공간이 정한 단어나 이름 목록에서만 뽑고, 같은 방 안에서 겹치지 않게 한다.
import type { LocalizedName } from '../../shared/protocol';
import type { SharedSpace, SharedWordList } from '../../shared/spaces';

export type Rng = () => number;

function titleCase(text: string): string {
  return text.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** base가 방에 이미 있으면 뒤에 2, 3, ... 가운데 안 쓰인 가장 작은 숫자를 붙인다 */
function withNumber(base: string, used: ReadonlySet<string>): string {
  for (let n = 2; ; n++) {
    const name = `${base} ${n}`;
    if (!used.has(name)) return name;
  }
}

/**
 * 한 언어의 이름 하나. '형용사 명사' 조합 가운데 아직 안 쓰인 것을 무작위로 고른다.
 * 조합이 모두 쓰였으면(시험용 방처럼 단어가 적을 때) 뒤에 숫자를 붙인다: '맑은 연잎 2'.
 */
export function pickName(words: SharedWordList, used: ReadonlySet<string>, lang: 'ko' | 'en', rng: Rng = Math.random): string {
  const free: string[] = [];
  for (const adj of words.adjectives) {
    for (const noun of words.nouns) {
      const name = lang === 'en' ? titleCase(`${adj} ${noun}`) : `${adj} ${noun}`;
      if (!used.has(name)) free.push(name);
    }
  }
  if (free.length > 0) return free[Math.floor(rng() * free.length)]!;

  const adj = words.adjectives[Math.floor(rng() * words.adjectives.length)]!;
  const noun = words.nouns[Math.floor(rng() * words.nouns.length)]!;
  return withNumber(lang === 'en' ? titleCase(`${adj} ${noun}`) : `${adj} ${noun}`, used);
}

/** 꾸밈말을 붙인 이름의 최대 길이(띄어쓰기 포함 글자 수). 넘는 조합은 건너뛴다 */
export const MAX_NAME_CHARS = 14;

/**
 * 통째로 정해 둔 이름 목록에서 하나. 방에서 아직 안 쓰인 것 가운데 무작위로 고른다.
 * 모두 쓰였으면 꾸밈말을 앞에 붙인 조합 가운데 안 쓰인 것을 고르고('조용한 연꽃', MAX_NAME_CHARS 이하만),
 * 그것까지 다 쓰였으면 아무 이름 뒤에 숫자를 붙인다: '연꽃 2'. list는 비어 있지 않아야 한다.
 */
export function pickFromList(
  list: readonly string[],
  adjectives: readonly string[],
  used: ReadonlySet<string>,
  rng: Rng = Math.random,
): string {
  const free = list.filter((name) => !used.has(name));
  if (free.length > 0) return free[Math.floor(rng() * free.length)]!;

  const combos: string[] = [];
  for (const adj of adjectives) {
    for (const name of list) {
      const combo = `${adj} ${name}`;
      if ([...combo].length <= MAX_NAME_CHARS && !used.has(combo)) combos.push(combo);
    }
  }
  if (combos.length > 0) return combos[Math.floor(rng() * combos.length)]!;

  return withNumber(list[Math.floor(rng() * list.length)]!, used);
}

/**
 * 언어별 이름 한 쌍. usedKo / usedEn은 방에 이미 있는 이름들.
 * 공간에 이름 목록(list)이 있으면 거기서 한국어 이름만 고르고 en은 비운다. 없거나 비었으면 단어 조합으로 짓는다.
 */
export function pickNames(
  words: SharedSpace['nameWords'],
  usedKo: ReadonlySet<string>,
  usedEn: ReadonlySet<string>,
  rng: Rng = Math.random,
): LocalizedName {
  if (words.list && words.list.length > 0) return { ko: pickFromList(words.list, words.listAdjectives ?? [], usedKo, rng) };
  const name: LocalizedName = { ko: pickName(words.ko, usedKo, 'ko', rng) };
  if (words.en) name.en = pickName(words.en, usedEn, 'en', rng);
  return name;
}
