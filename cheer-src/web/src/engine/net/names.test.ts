import { describe, expect, it } from 'vitest';
import { displayName, viewerLang } from './names';

describe('displayName', () => {
  const pond = { ko: '맑은 연잎', en: 'Quiet Lotus' };

  it('지금은 한국어', () => {
    expect(viewerLang()).toBe('ko');
    expect(displayName(pond)).toBe('맑은 연잎');
  });

  it('영어를 고르면 영어 이름, 영어 이름이 없는 공간이면 한국어로', () => {
    expect(displayName(pond, 'en')).toBe('Quiet Lotus');
    expect(displayName({ ko: '조용한 구름' }, 'en')).toBe('조용한 구름');
  });
});
