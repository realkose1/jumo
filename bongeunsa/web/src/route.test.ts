import { describe, expect, it } from 'vitest';
import { parseRoute, stripBase } from './route';

describe('parseRoute', () => {
  it('경로의 첫 마디가 공간 id', () => {
    expect(parseRoute('/test-room', '', 'x').spaceId).toBe('test-room');
    expect(parseRoute('/test-room/', '', 'x').spaceId).toBe('test-room');
    expect(parseRoute('/Some-Room', '', 'x').spaceId).toBe('some-room');
  });

  it('없으면 기본 공간', () => {
    expect(parseRoute('/', '', 'default-space').spaceId).toBe('default-space');
    expect(parseRoute('', '', 'default-space').spaceId).toBe('default-space');
  });

  it('?room=, ?timeOffset=, ?quality= 읽기', () => {
    const r = parseRoute('/test-room', '?room=3&timeOffset=50&quality=low', 'x');
    expect(r).toEqual({ spaceId: 'test-room', room: '3', timeOffsetMinutes: 50, quality: 'low' });
  });

  it('값이 없거나 이상하면 기본값', () => {
    const r = parseRoute('/test-room', '?room=&timeOffset=zz&quality=best', 'x');
    expect(r).toEqual({ spaceId: 'test-room', room: null, timeOffsetMinutes: 0, quality: null });
  });

  it('깨진 인코딩도 터지지 않는다', () => {
    expect(() => parseRoute('/%E0%A4%A', '', 'x')).not.toThrow();
  });
});

describe('stripBase', () => {
  it('배포 기준 경로를 떼면 공간 id가 첫 마디가 된다', () => {
    expect(stripBase('/temple/test-room', '/temple/')).toBe('/test-room');
    expect(parseRoute(stripBase('/temple/test-room', '/temple/'), '', 'x').spaceId).toBe('test-room');
    expect(stripBase('/temple/', '/temple/')).toBe('/');
    expect(stripBase('/temple', '/temple/')).toBe('/');
  });

  it('기준 경로가 아닌 비슷한 이름은 건드리지 않고, 기준이 / 이면 그대로', () => {
    expect(stripBase('/templeful', '/temple/')).toBe('/templeful');
    expect(stripBase('/x', '/')).toBe('/x');
  });
});
