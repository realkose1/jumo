// 왼쪽 위: 같은 방에 몇 명이 함께 있는지, 연결이 어떤지 보여주는 알약.
import type { Engine } from '../engine/Engine';
import { h } from './dom';
import { netPill } from './netText';

export function mountTopBar(engine: Engine, parent: HTMLElement): () => void {
  const dot = h('span', { class: 'qs-people__dot', 'aria-hidden': true });
  const text = h('span', { class: 'qs-people__text' });
  const pill = h('div', { class: 'qs-people qs-glass', 'data-tone': 'solo', role: 'status' }, dot, text);
  const bar = h('div', { class: 'qs-topbar' }, pill);
  parent.appendChild(bar);

  const render = (): void => {
    const view = netPill(engine.getNetState().status, engine.getPeerCount());
    text.textContent = view.text;
    pill.dataset.tone = view.tone;
  };
  render();
  const cleanups = [engine.on('net-status', render), engine.on('peer-count', render)];

  return () => {
    for (const off of cleanups) off();
    bar.remove();
  };
}
