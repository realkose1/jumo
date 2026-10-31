import { describe, expect, it } from 'vitest';
import { parseRoomNumber, withRoom } from './room';

describe('parseRoomNumber', () => {
  it('양의 정수만 받는다', () => {
    expect(parseRoomNumber('3')).toBe(3);
    expect(parseRoomNumber(' 12 ')).toBe(12);
    expect(parseRoomNumber(7)).toBe(7);
  });

  it('이상한 값은 null: 서버가 방을 정하게 한다', () => {
    for (const v of ['', 'abc', '0', '-1', '1.5', '1e3', '99999', '10001', null, undefined, '3번']) {
      expect(parseRoomNumber(v), String(v)).toBeNull();
    }
  });
});

describe('withRoom', () => {
  it('방 번호가 없던 주소에 붙인다', () => {
    expect(withRoom('', 4)).toBe('?room=4');
  });

  it('다른 값은 그대로 두고 방만 바꾼다', () => {
    expect(withRoom('?timeOffset=30&room=2&quality=low', 9)).toBe('?timeOffset=30&room=9&quality=low');
  });
});
