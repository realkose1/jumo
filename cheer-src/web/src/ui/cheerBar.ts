// 왼쪽 위: 닫기 버튼(앱 안에서 열렸을 때만)과 "N명 응원 중" 알약.
import type { Engine } from '../engine/Engine';
import { h } from './dom';
import { icon } from './icons';
import { netPill } from './netText';
import { S } from './strings';

export interface CheerBarOptions {
  /** 앱 안(iframe)에서 열렸으면 닫기 버튼을 보여준다 */
  embedded: boolean;
  /** 닫기 버튼을 눌렀다 */
  onClose: () => void;
}

export interface CheerBarHandle {
  /** 개발용 데모처럼 서버 없이 인원을 보여줄 때. null이면 서버 값을 따른다 */
  setPeopleOverride(count: number | null): void;
  dispose(): void;
}

export function mountCheerBar(engine: Engine, parent: HTMLElement, options: CheerBarOptions): CheerBarHandle {
  const dot = h('span', { class: 'qs-people__dot', 'aria-hidden': true });
  const text = h('span', { class: 'qs-people__text' });
  const pill = h('div', { class: 'qs-people qs-glass', 'data-tone': 'solo', role: 'status' }, dot, text);
  const close = options.embedded
    ? h('button', { type: 'button', class: 'qs-close qs-glass', 'aria-label': S.cheer.close }, icon('close', 20))
    : null;
  const bar = h('div', { class: 'qs-topbar' }, close, pill);
  parent.appendChild(bar);
  close?.addEventListener('click', options.onClose);

  let override: number | null = null;
  const render = (): void => {
    const { status } = engine.getNetState();
    const view =
      override !== null ? netPill('online', override - 1) : netPill(status, engine.getPeerCount());
    text.textContent = view.text;
    pill.dataset.tone = view.tone;
  };
  render();
  const cleanups = [engine.on('net-status', render), engine.on('peer-count', render)];

  return {
    setPeopleOverride(count) {
      override = count;
      render();
    },
    dispose() {
      for (const off of cleanups) off();
      bar.remove();
    },
  };
}
