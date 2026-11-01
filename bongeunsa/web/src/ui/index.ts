// 3D 위에 겹치는 HTML/CSS 화면의 진입점. main.ts는 mountUI(engine, root) 하나만 부른다.
// engine.on 구독은 engine.start() 전에 걸어야 하므로, mountUI도 start() 전에 부른다.
import type { Engine } from '../engine/Engine';
import type { SpaceUiTheme } from '../engine/types';
import { mountActionBar } from './actionBar';
import { mountBubbles, type BubbleLayer } from './bubbles';
import { h } from './dom';
import { mountJoystick } from './joystick';
import { mountLoading } from './loading';
import { mountMuteButton } from './muteButton';
import { mountNetUI } from './net';
import { createNotice, type NoticeTone } from './notice';
import { mountSettings } from './settings';
import { mountTopBar } from './topBar';
import './ui.css';

export interface UIHandle {
  /** 위쪽에 한 줄 알림을 띄운다. 서버의 인사 알림도 여기로 온다. tone 'accent'는 강조색 면 */
  showNotice(text: string, durationMs?: number, tone?: NoticeTone): void;
  /** 3D 장면의 한 점에 붙는 말풍선 (사람의 말, 장면 속 인물의 대답) */
  readonly bubbles: BubbleLayer;
  dispose(): void;
}

/** 공간 정의의 theme 값을 CSS 변수(--qs-*)로 옮긴다. 없는 값은 ui.css의 기본값을 쓴다. */
export function applyTheme(host: HTMLElement, theme: SpaceUiTheme | undefined): void {
  if (!theme) return;
  for (const [key, value] of Object.entries(theme)) {
    if (typeof value !== 'string' || value.trim() === '') continue;
    host.style.setProperty(`--qs-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`, value);
  }
}

export function mountUI(engine: Engine, root: HTMLElement): UIHandle {
  const host = h('div', { class: 'qs-ui' });
  applyTheme(host, engine.space.theme);
  host.classList.toggle('qs-reduced', engine.getReducedMotion());
  host.classList.toggle('qs-ui--loading', !engine.isReady());
  root.appendChild(host);

  // 로딩 화면을 가장 먼저 걸어서 'ready'/'error' 순서가 안정적이게 한다
  const cleanups: Array<() => void> = [mountLoading(engine, host)];
  cleanups.push(
    engine.on('reduced-motion-change', ({ enabled }) => host.classList.toggle('qs-reduced', enabled)),
    engine.on('ready', () => host.classList.remove('qs-ui--loading')),
  );

  cleanups.push(mountActionBar(engine, host));
  // 터치 기기 왼쪽 아래 조이스틱. 보이면 host에 qs-ui--touch 를 달아 동작 버튼을 오른쪽 아래 세로 줄로 옮긴다
  cleanups.push(mountJoystick(engine, host));
  cleanups.push(mountMuteButton(engine, host));
  cleanups.push(mountSettings(engine, host));
  cleanups.push(mountTopBar(engine, host));

  const bubbles = mountBubbles(engine, host);
  cleanups.push(bubbles.dispose);

  const notice = createNotice(host);
  cleanups.push(notice.dispose);
  // 서버 소식: 인사 알림, 자리 안내, 사람 이름표 (서버가 없으면 조용히 혼자 모드)
  cleanups.push(mountNetUI(engine, host, { notice: (text, ms) => notice.show(text, ms) }));

  return {
    showNotice: (text, durationMs, tone) => notice.show(text, durationMs, tone),
    bubbles,
    dispose() {
      for (const fn of cleanups) fn();
      host.remove();
    },
  };
}
