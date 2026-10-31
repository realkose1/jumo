// 서버와 이어진 소식을 화면에 올린다: 인사 알림, 자리 안내, 사람 이름표.
// 서버가 없어도(혼자 모드) 조용히 돌고, 말은 모두 '~해요' 체다.
// (몇 명이 응원 중인지는 왼쪽 위 알약이 보여준다: cheerBar.ts)
import type { Engine } from '../engine/Engine';
import { displayName } from '../engine/net/names';
import { h } from './dom';
import { greetedText } from './netText';
import { S } from './strings';

export interface NetUiOptions {
  notice: (text: string, durationMs?: number) => void;
}

export function mountNetUI(engine: Engine, parent: HTMLElement, options: NetUiOptions): () => void {
  const cleanups: Array<() => void> = [];

  // ---- 알림 ----
  cleanups.push(
    engine.on('greeted', ({ name, actionId }) => {
      options.notice(greetedText(engine.space.actions, actionId, name));
    }),
    engine.on('seat-denied', ({ reason }) => {
      // 눌렀을 때 이미 앉아 있던 자리(occupied)는 이름표가 대신 말해 주니 조용히 넘긴다
      if (reason === 'taken') options.notice(S.notice.seatTaken, 2200);
      else if (reason === 'failed') options.notice(S.notice.seatFailed, 2200);
    }),
    engine.on('daily-limit', () => options.notice(S.notice.dailyLimit, 2600)),
    // 서버가 들이지 않는다(같은 IP 연결 초과, 잘못된 입장, 너무 잦은 메시지): 다시 연결하지 않는다
    engine.on('net-status', ({ status }) => {
      if (status === 'denied') options.notice(S.notice.denied, 8000);
    }),
    engine.on('room-full', ({ rec }) => {
      if (rec !== null) options.notice(S.notice.roomFullMove(rec), 3600);
      else options.notice(S.notice.roomFullWait, 8000);
    }),
  );

  // ---- 사람 이름표 ----
  const label = h('div', { class: 'qs-peer-label', 'aria-hidden': true });
  parent.appendChild(label);
  cleanups.push(
    engine.on('peer-label', (state) => {
      if (!state) {
        label.classList.remove('is-visible');
        return;
      }
      label.textContent = displayName(state.name); // 보는 사람의 언어 선택은 displayName()에 열어 두었다
      label.style.transform = `translate(${state.x}px, ${state.y}px) translate(-50%, -100%)`;
      label.classList.add('is-visible');
    }),
    () => label.remove(),
  );

  return () => {
    for (const fn of cleanups) fn();
  };
}
