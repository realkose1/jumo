// 화면 아래 가운데 동작 버튼 세 개. 숫자키로 실행돼도 'action' 이벤트를 받아 똑같이 눌린 듯 반응한다.
import type { Engine } from '../engine/Engine';
import { h } from './dom';
import { icon, resolveActionIcon } from './icons';
import { S } from './strings';

export function mountActionBar(engine: Engine, parent: HTMLElement): () => void {
  const { space } = engine;
  const timers = new Set<number>();
  const later = (fn: () => void, ms: number): number => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  };

  const buttons = space.actions.map((def, index) => {
    const isGreeting = def.id === space.greetingActionId;
    const picture = resolveActionIcon(def, space.greetingActionId);
    const pictureEl =
      picture.kind === 'svg'
        ? icon(picture.name, 24)
        : picture.kind === 'img'
          ? h('img', { class: 'qs-action__img', src: picture.src, alt: '', draggable: 'false' })
          : h('span', { class: 'qs-action__emoji', 'aria-hidden': true }, picture.text);
    const name = def.label.ko;
    const button = h(
      'button',
      {
        type: 'button',
        class: isGreeting ? 'qs-action qs-action--greeting' : 'qs-action',
        'data-action': def.id,
        'aria-label': isGreeting
          ? `${name}, ${S.actions.greeting}, ${S.actions.key(index + 1)}`
          : `${name}, ${S.actions.key(index + 1)}`,
      },
      h('span', { class: 'qs-action__icon', 'aria-hidden': true }, pictureEl),
      h('span', { class: 'qs-action__label', 'aria-hidden': true }, name),
      h('span', { class: 'qs-action__key', 'aria-hidden': true }, String(index + 1)),
    );
    button.addEventListener('click', () => {
      engine.runAction(def.id);
    });
    return button;
  });

  const bar = h('div', { class: 'qs-actions qs-glass', role: 'group', 'aria-label': S.actions.group }, ...buttons);
  parent.appendChild(bar);

  const unsubscribe = engine.on('action', (event) => {
    const button = buttons[event.index];
    if (!button) return;
    // 눌림 반응: 버튼을 눌렀을 때도, 숫자키로 실행됐을 때도 같다
    button.classList.remove('is-pop');
    void button.offsetWidth; // 같은 애니메이션을 다시 시작하려면 한 번 읽어 줘야 한다
    button.classList.add('is-pop');
    later(() => button.classList.remove('is-pop'), 420);
    // 쿨다운 동안 살짝 흐리게
    const cooldown = engine.getActionCooldownMs(event.actionId);
    if (cooldown > 0) {
      button.classList.add('is-cooling');
      later(() => button.classList.remove('is-cooling'), cooldown);
    }
  });

  return () => {
    unsubscribe();
    for (const id of timers) window.clearTimeout(id);
    timers.clear();
    bar.remove();
  };
}
