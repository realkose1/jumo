// 서버와 이어진 소식을 화면에 올린다: 인사 알림, 자리 안내, 사람 이름표.
// 서버가 없어도(혼자 모드) 조용히 돌고, 말은 모두 '~해요' 체다.
// (몇 명이 함께 있는지는 왼쪽 위 알약이 보여준다: topBar.ts)
import type { PeerId } from '@shared/protocol';
import type { Engine } from '../engine/Engine';
import { displayName } from '../engine/net/names';
import { h } from './dom';
import { greetedText } from './netText';
import { S } from './strings';

/** 이름표 한 줄의 높이(px). 겹침을 볼 때 쓴다 (ui.css .qs-peer-label 과 맞춘다) */
const LABEL_H = 22;
/** 이름표가 화면 가장자리에서 떨어지는 최소 거리(px) */
const EDGE_GAP = 4;

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
  // 손님들 머리 위에 늘 이름을 띄운다(내 이름표는 노란 테두리). 엔진이 또렷한 사람(마우스를 올린·누른 사람) 먼저,
  // 그다음 나, 그다음 가까운 순으로 알려 주면 그 순서대로 자리를 잡고, 앞의 이름표와 겹치는 것은 이번에는 감춘다.
  const layer = h('div', { class: 'qs-peer-labels', 'aria-hidden': true });
  parent.appendChild(layer);
  const tags = new Map<PeerId, { el: HTMLElement; text: string; focus: boolean; self: boolean; width: number }>();
  cleanups.push(
    engine.on('peer-labels', (labels) => {
      const seen = new Set<PeerId>();
      const placed: Array<{ left: number; right: number; top: number }> = [];
      for (const label of labels) {
        seen.add(label.id);
        let tag = tags.get(label.id);
        if (!tag) {
          tag = { el: h('div', { class: 'qs-peer-label' }), text: '', focus: false, self: false, width: 0 };
          layer.appendChild(tag.el);
          tags.set(label.id, tag);
        }
        const text = displayName(label.name); // 보는 사람의 언어 선택은 displayName()에 열어 두었다
        if (tag.text !== text || tag.focus !== label.focus || tag.self !== label.self) {
          if (tag.text !== text) tag.el.textContent = text;
          tag.el.classList.toggle('is-focus', label.focus);
          tag.el.classList.toggle('is-self', label.self);
          tag.text = text;
          tag.focus = label.focus;
          tag.self = label.self;
          tag.width = tag.el.offsetWidth; // 이름이나 모양이 바뀔 때만 잰다
        }
        // 화면 가장자리에 걸친 사람의 이름은 잘리지 않게 안쪽으로 붙잡는다
        const half = tag.width / 2;
        const x = Math.min(Math.max(label.x, half + EDGE_GAP), Math.max(half + EDGE_GAP, layer.clientWidth - half - EDGE_GAP));
        const box = { left: x - half, right: x + half, top: label.y - LABEL_H };
        const covered = !label.focus && !label.self && placed.some((p) => box.left < p.right && box.right > p.left && Math.abs(box.top - p.top) < LABEL_H);
        if (!covered) placed.push(box);
        tag.el.style.transform = `translate(${x}px, ${label.y}px) translate(-50%, -100%)`;
        tag.el.style.opacity = covered ? '0' : String(label.opacity);
      }
      for (const [id, tag] of tags) {
        if (seen.has(id)) continue;
        tag.el.remove();
        tags.delete(id);
      }
    }),
    () => layer.remove(),
  );

  return () => {
    for (const fn of cleanups) fn();
  };
}
