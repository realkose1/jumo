import { describe, expect, it } from 'vitest';
import type { ActionDef } from '../engine/types';
import { resolveActionIcon } from './icons';

const def = (over: Partial<ActionDef>): ActionDef => ({ id: 'x', label: { ko: 'x' }, motion: 'hop', ...over });

describe('resolveActionIcon', () => {
  it('아는 그림 이름이면 그대로', () => {
    expect(resolveActionIcon(def({ icon: 'hop-double' }), 'g')).toEqual({ kind: 'svg', name: 'hop-double' });
  });

  it('짧은 이모지는 글자로', () => {
    expect(resolveActionIcon(def({ icon: '🍊' }), 'g')).toEqual({ kind: 'text', text: '🍊' });
  });

  it('모르는 이름은 몸짓으로 고른다', () => {
    expect(resolveActionIcon(def({ icon: 'lamp', motion: 'hop-double' }), 'g')).toEqual({ kind: 'svg', name: 'hop-double' });
    expect(resolveActionIcon(def({ motion: 'hop' }), 'g')).toEqual({ kind: 'svg', name: 'hop' });
  });

  it('인사 동작은 아이콘을 안 줘도 하트', () => {
    expect(resolveActionIcon(def({ id: 'hello', motion: 'hop-spin' }), 'hello')).toEqual({ kind: 'svg', name: 'greet' });
  });
});
