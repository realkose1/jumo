import { describe, expect, it, vi } from 'vitest';
import { isEmbedded, parseAppInset, postCloseToApp, postToApp } from './embed';

describe('isEmbedded', () => {
  it('최상위 창이면 아니다', () => {
    const win = {} as Window;
    const w = { parent: win, self: win } as unknown as Window;
    expect(isEmbedded('', w)).toBe(false);
  });

  it('부모 창이 따로 있으면 앱 안(iframe)이다', () => {
    const w = { parent: {} as Window, self: {} as Window } as unknown as Window;
    expect(isEmbedded('', w)).toBe(true);
  });

  it('?from=app이면 앱 안으로 본다', () => {
    const win = {} as Window;
    const w = { parent: win, self: win } as unknown as Window;
    expect(isEmbedded('?from=app', w)).toBe(true);
    expect(isEmbedded('?from=web', w)).toBe(false);
  });
});

describe('postCloseToApp', () => {
  it("부모에게 { type: 'jumo-cheer', action: 'close' }를 보낸다", () => {
    const postMessage = vi.fn();
    postCloseToApp({ parent: { postMessage } } as unknown as Window);
    expect(postMessage).toHaveBeenCalledWith({ type: 'jumo-cheer', action: 'close' }, '*');
  });

  it('보내다 실패해도 던지지 않는다', () => {
    expect(() => postCloseToApp({ parent: { postMessage: () => { throw new Error('x'); } } } as unknown as Window)).not.toThrow();
  });
});

describe('postToApp (ready, error)', () => {
  it("ready와 error도 { type: 'jumo-cheer', action }으로 부모에게 간다", () => {
    const postMessage = vi.fn();
    const win = { parent: { postMessage } } as unknown as Window;
    postToApp('ready', win);
    postToApp('error', win);
    expect(postMessage).toHaveBeenNthCalledWith(1, { type: 'jumo-cheer', action: 'ready' }, '*');
    expect(postMessage).toHaveBeenNthCalledWith(2, { type: 'jumo-cheer', action: 'error' }, '*');
  });
});

describe('parseAppInset (?sat, ?sab)', () => {
  it('정수를 0~80으로', () => {
    expect(parseAppInset('?sat=47&sab=34', 'sat')).toBe(47);
    expect(parseAppInset('?sat=47&sab=34', 'sab')).toBe(34);
    expect(parseAppInset('?sat=999', 'sat')).toBe(80);
    expect(parseAppInset('?sat=-5', 'sat')).toBe(0);
  });

  it('없거나 이상하면 0', () => {
    expect(parseAppInset('', 'sat')).toBe(0);
    expect(parseAppInset('?sat=', 'sat')).toBe(0);
    expect(parseAppInset('?sat=abc', 'sat')).toBe(0);
    expect(parseAppInset('?sat=Infinity', 'sat')).toBe(0);
  });

  it('소수는 반올림', () => {
    expect(parseAppInset('?sab=33.6', 'sab')).toBe(34);
  });
});
