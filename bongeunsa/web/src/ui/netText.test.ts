import { describe, expect, it } from 'vitest';
import type { ActionDef } from '../engine/types';
import { greetedText, netPill } from './netText';

const actions: ActionDef[] = [
  { id: 'hop', label: { ko: '살짝 뛰기' }, motion: 'hop' },
  { id: 'greet', label: { ko: '폴짝 인사' }, notice: { ko: '폴짝 인사했어요' }, motion: 'hop-spin' },
  { id: 'tangerine', label: { ko: '귤 건네기' }, notice: { ko: '귤을 건넸어요' }, motion: 'hop' },
  { id: 'plain', label: { ko: '손 인사' }, motion: 'hop' },
];

describe('greetedText', () => {
  it('"OO님이 ~했어요"', () => {
    expect(greetedText(actions, 'greet', { ko: '조용한 구름' })).toBe('조용한 구름님이 폴짝 인사했어요');
    expect(greetedText(actions, 'tangerine', { ko: '새벽의 연필' })).toBe('새벽의 연필님이 귤을 건넸어요');
  });

  it('notice 문구가 없으면 이름표로 만든다', () => {
    expect(greetedText(actions, 'plain', { ko: '졸린 오리' })).toBe('졸린 오리님이 손 인사했어요');
  });

  it('모르는 동작이어도 문장은 자연스럽게', () => {
    expect(greetedText(actions, '없는동작', { ko: '졸린 오리' })).toBe('졸린 오리님이 인사를 건넸어요');
  });

  it('문구에 줄표가 없다', () => {
    for (const a of actions) expect(greetedText(actions, a.id, { ko: '이름' })).not.toMatch(/[\u2014\u2013]/);
  });
});

describe('netPill', () => {
  it('접속 중이면 나를 포함한 인원', () => {
    expect(netPill('online', 0)).toEqual({ text: '혼자 있어요', tone: 'online' });
    expect(netPill('online', 14)).toEqual({ text: '15명이 함께 있어요', tone: 'online' });
  });

  it('연결 상태마다 짧은 한국어 글자', () => {
    expect(netPill('offline', 0)).toEqual({ text: '혼자 있어요', tone: 'solo' });
    expect(netPill('idle', 0)).toEqual({ text: '혼자 있어요', tone: 'solo' });
    expect(netPill('connecting', 0).tone).toBe('pending');
    expect(netPill('reconnecting', 3).tone).toBe('pending');
  });
});
