import { describe, expect, it } from 'vitest';
import { originAllowed } from '../src/index';
import type { PresenceEnv } from '../src/env';

const req = (url: string, origin: string | null) =>
  new Request(url, { headers: origin === null ? {} : { Origin: origin } });
const envWith = (allowed: string) => ({ ALLOWED_ORIGINS: allowed }) as unknown as PresenceEnv;

describe('웹소켓 Origin 허용', () => {
  it('목록이 비면 모두 받는다', () => {
    expect(originAllowed(envWith(''), req('https://a.workers.dev/ws', 'https://evil.example'))).toBe(true);
  });
  it('화면과 같은 주소(같은 Worker)에서 온 연결은 목록에 없어도 받는다', () => {
    expect(originAllowed(envWith('http://localhost:5180'), req('https://bongeunsa.x.workers.dev/ws', 'https://bongeunsa.x.workers.dev'))).toBe(true);
  });
  it('목록에 있는 주소는 받고, 다른 주소와 Origin 없는 연결은 막는다', () => {
    const env = envWith('http://localhost:5180');
    expect(originAllowed(env, req('https://b.workers.dev/ws', 'http://localhost:5180'))).toBe(true);
    expect(originAllowed(env, req('https://b.workers.dev/ws', 'https://evil.example'))).toBe(false);
    expect(originAllowed(env, req('https://b.workers.dev/ws', null))).toBe(false);
  });
});
