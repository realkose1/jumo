import { describe, expect, it } from 'vitest';
import { ActionController, type ActionEvent } from './actions';
import type { ActionDef } from './types';

const defs: ActionDef[] = [
  { id: 'one', label: { ko: '하나' }, motion: 'hop' },
  { id: 'two', label: { ko: '둘' }, motion: 'hop-double' },
  { id: 'greet', label: { ko: '인사' }, motion: 'hop-spin' },
];

function setup() {
  let t = 0;
  const performed: string[] = [];
  const events: ActionEvent[] = [];
  const ctl = new ActionController({
    actions: defs,
    greetingActionId: 'greet',
    now: () => t,
    perform: (a) => performed.push(a.id),
  });
  ctl.onAction((e) => events.push(e));
  return { ctl, performed, events, advance: (ms: number) => (t += ms) };
}

describe('ActionController', () => {
  it('처음에는 실행되고 이벤트를 낸다', () => {
    const { ctl, performed, events } = setup();
    expect(ctl.run('one')).toBe(true);
    expect(performed).toEqual(['one']);
    expect(events).toEqual([{ actionId: 'one', index: 0, isGreeting: false, at: 0 }]);
  });

  it('같은 동작은 1초에 한 번만: 999ms는 막고 1000ms부터 된다', () => {
    const { ctl, performed, events, advance } = setup();
    expect(ctl.run('one')).toBe(true);
    advance(999);
    expect(ctl.run('one')).toBe(false);
    expect(ctl.cooldownRemaining('one')).toBe(1);
    advance(1);
    expect(ctl.run('one')).toBe(true);
    expect(performed).toEqual(['one', 'one']);
    expect(events).toHaveLength(2);
  });

  it('막힌 연타는 이벤트도 내지 않고 시간을 늘리지도 않는다', () => {
    const { ctl, events, advance } = setup();
    ctl.run('one');
    for (let i = 0; i < 10; i++) {
      advance(90);
      expect(ctl.run('one')).toBe(false);
    }
    expect(events).toHaveLength(1);
    advance(100); // 처음 실행으로부터 1000ms
    expect(ctl.run('one')).toBe(true);
  });

  it('다른 동작은 서로 영향이 없다', () => {
    const { ctl } = setup();
    expect(ctl.run('one')).toBe(true);
    expect(ctl.run('two')).toBe(true);
    expect(ctl.run('greet')).toBe(true);
    expect(ctl.run('two')).toBe(false);
  });

  it('숫자키 1, 2, 3은 순서대로 연결되고 범위 밖은 무시한다', () => {
    const { ctl, performed } = setup();
    expect(ctl.runByKey(1)).toBe(true);
    expect(ctl.runByKey(2)).toBe(true);
    expect(ctl.runByKey(3)).toBe(true);
    expect(ctl.runByKey(4)).toBe(false);
    expect(ctl.runByKey(0)).toBe(false);
    expect(performed).toEqual(['one', 'two', 'greet']);
  });

  it('인사 동작은 isGreeting 표시가 붙는다', () => {
    const { ctl, events } = setup();
    ctl.runByKey(3);
    expect(events[0]).toMatchObject({ actionId: 'greet', index: 2, isGreeting: true });
  });

  it('모르는 동작은 false', () => {
    const { ctl, performed } = setup();
    expect(ctl.run('nope')).toBe(false);
    expect(performed).toEqual([]);
  });

  it('구독 해제 뒤에는 알리지 않는다', () => {
    const { ctl, advance } = setup();
    const seen: string[] = [];
    const off = ctl.onAction((e) => seen.push(e.actionId));
    ctl.run('one');
    off();
    advance(1000);
    ctl.run('one');
    expect(seen).toEqual(['one']);
  });
});

describe('ActionController: 동작마다 다른 다시 하기 간격과 변형', () => {
  const order: ActionDef = { id: 'order', label: { ko: '주문' }, motion: 'roar', variants: 8, cooldownMs: 5000 };

  function make(rand: () => number = () => 0.5) {
    let t = 0;
    const ctl = new ActionController({
      actions: [...defs, order],
      greetingActionId: 'greet',
      now: () => t,
      perform: () => undefined,
      random: rand,
    });
    const events: ActionEvent[] = [];
    ctl.onAction((e) => events.push(e));
    return { ctl, events, advance: (ms: number) => (t += ms) };
  }

  it('주문은 5초, 다른 동작은 1초', () => {
    const { ctl, advance } = make();
    expect(ctl.run('order')).toBe(true);
    expect(ctl.run('one')).toBe(true);
    advance(1100);
    expect(ctl.run('one')).toBe(true); // 1초 뒤 다시
    expect(ctl.run('order')).toBe(false); // 주문은 아직
    expect(ctl.cooldownRemaining('order')).toBeGreaterThan(3500);
    advance(4000);
    expect(ctl.run('order')).toBe(true);
  });

  it('변형이 있는 동작은 누를 때 번호를 하나 골라 이벤트에 싣는다', () => {
    const { ctl, events } = make(() => 0.5);
    ctl.run('order');
    expect(events[0]!.variant).toBe(4);
    const high = make(() => 0.999999);
    high.ctl.run('order');
    expect(high.events[0]!.variant).toBe(7);
    const low = make(() => 0);
    low.ctl.run('order');
    expect(low.events[0]!.variant).toBe(0);
  });

  it('변형이 없는 동작의 이벤트에는 번호가 없다', () => {
    const { ctl, events } = make();
    ctl.run('one');
    expect('variant' in events[0]!).toBe(false);
  });
});
