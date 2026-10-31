// 서버가 붙여 준 이름(언어별)을 보는 사람의 언어로 고른다.
// 고궁은 한국어와 영어 이름을 한 쌍으로 받는다. 지금은 한국어만 보여주고, 영어를 켜는 자리만 열어 둔다.
import type { LocalizedName } from '@shared/protocol';

export type ViewerLang = 'ko' | 'en';

/** 보는 사람의 언어. 영어를 함께 제공하는 공간(고궁)을 만들 때 여기서 브라우저 언어나 설정을 읽는다 */
export function viewerLang(): ViewerLang {
  return 'ko';
}

export function displayName(name: LocalizedName, lang: ViewerLang = viewerLang()): string {
  return lang === 'en' && name.en ? name.en : name.ko;
}
