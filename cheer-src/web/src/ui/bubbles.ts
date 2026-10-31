// 말풍선: 3D 장면의 한 점(머리 위)에 붙는 화면 말풍선. 글자가 늘 또렷하고(화면 픽셀 크기), 사람이 움직이면 따라간다.
// 주문한 사람 머리 위의 주문 한 줄, 주모의 대답이 여기로 뜬다. 한꺼번에 몇 개까지만 둔다.
import { Vector3 } from 'three';
import type { Engine } from '../engine/Engine';
import { h } from './dom';

export type BubbleKind = 'order' | 'jumo';

export interface BubbleRequest {
  /** 같은 key의 말풍선은 새 것으로 바뀐다 (한 사람이 연달아 말하면 하나만) */
  key: string;
  text: string;
  kind: BubbleKind;
  /** 붙을 3D 좌표. 모르게 되면(사람이 나감) null을 돌려주고, 그러면 말풍선도 거둔다 */
  anchor: (out: Vector3) => Vector3 | null;
  ms: number;
}

export interface BubbleLayer {
  show(req: BubbleRequest): void;
  clear(): void;
  /** 지금 떠 있는 말풍선 수 */
  readonly count: number;
  dispose(): void;
}

/** 한꺼번에 떠 있을 수 있는 말풍선 수 */
export const MAX_BUBBLES = 6;
const FADE_MS = 260;

interface Live {
  req: BubbleRequest;
  el: HTMLElement;
  until: number;
  closing: boolean;
}

export function mountBubbles(engine: Engine, parent: HTMLElement): BubbleLayer {
  const layer = h('div', { class: 'qs-bubbles', 'aria-hidden': true });
  parent.appendChild(layer);
  const live = new Map<string, Live>();
  const point = new Vector3();
  const screen = { x: 0, y: 0, visible: false };
  let raf = 0;

  const remove = (b: Live): void => {
    live.delete(b.req.key);
    b.el.remove();
  };

  const tick = (): void => {
    raf = 0;
    const now = performance.now();
    for (const b of [...live.values()]) {
      if (!b.closing && now >= b.until) {
        b.closing = true;
        b.el.classList.remove('is-on');
        b.until = now + FADE_MS;
        continue;
      }
      if (b.closing && now >= b.until) {
        remove(b);
        continue;
      }
      const at = b.req.anchor(point);
      if (!at) {
        remove(b);
        continue;
      }
      engine.projectToScreen(at, screen);
      b.el.style.transform = `translate(${Math.round(screen.x)}px, ${Math.round(screen.y)}px) translate(-50%, -100%)`;
      b.el.classList.toggle('is-off', !screen.visible);
    }
    if (live.size > 0) raf = requestAnimationFrame(tick);
  };
  const kick = (): void => {
    if (raf === 0 && live.size > 0) raf = requestAnimationFrame(tick);
  };

  return {
    show(req) {
      const old = live.get(req.key);
      if (old) remove(old);
      // 가득 차면 가장 오래된 것부터 거둔다
      while (live.size >= MAX_BUBBLES) {
        const first = live.values().next().value as Live | undefined;
        if (!first) break;
        remove(first);
      }
      const el = h('div', { class: 'qs-bubble', 'data-kind': req.kind }, req.text);
      layer.appendChild(el);
      const b: Live = { req, el, until: performance.now() + req.ms, closing: false };
      live.set(req.key, b);
      // 한 프레임 뒤에 켜야 나타나는 전환이 보인다
      requestAnimationFrame(() => el.classList.add('is-on'));
      kick();
    },
    clear() {
      for (const b of [...live.values()]) remove(b);
    },
    get count() {
      return live.size;
    },
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      for (const b of [...live.values()]) remove(b);
      layer.remove();
    },
  };
}
