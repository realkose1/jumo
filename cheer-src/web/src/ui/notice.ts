// 화면 위쪽 가운데에 한 줄 알림을 잠깐 띄우는 자리. 2단계에서 서버 notice를 showNotice(text)로 붙인다.
import { h } from './dom';

/** cheer: 노란 강조색 면(골 순간 같은 신나는 알림), quiet: 평소 면 */
export type NoticeTone = 'cheer' | 'quiet';

export interface Notice {
  show(text: string, durationMs?: number, tone?: NoticeTone): void;
  dispose(): void;
}

export const DEFAULT_NOTICE_MS = 3000;
const FADE_OUT_MS = 400;

export function createNotice(parent: HTMLElement): Notice {
  // 읽어 주는 영역은 미리 만들어 두고 글자만 바꿔야 화면 읽기 프로그램이 알려준다
  const el = h('div', { class: 'qs-notice qs-glass', role: 'status', 'aria-live': 'polite', 'aria-atomic': true });
  parent.appendChild(el);
  let hideTimer: number | undefined;
  let clearTimer: number | undefined;

  return {
    show(text, durationMs = DEFAULT_NOTICE_MS, tone = 'quiet') {
      window.clearTimeout(hideTimer);
      window.clearTimeout(clearTimer);
      el.textContent = text;
      el.dataset.tone = tone;
      el.classList.add('is-visible');
      hideTimer = window.setTimeout(() => {
        el.classList.remove('is-visible');
        clearTimer = window.setTimeout(() => {
          el.textContent = '';
        }, FADE_OUT_MS);
      }, durationMs);
    },
    dispose() {
      window.clearTimeout(hideTimer);
      window.clearTimeout(clearTimer);
      el.remove();
    },
  };
}
