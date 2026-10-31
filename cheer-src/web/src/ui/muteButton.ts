// 오른쪽 위 설정 버튼 바로 왼쪽의 스피커 버튼: 누르면 주막 소리를 모두 끄고, 다시 누르면 켠다.
// 층마다의 켜짐·크기(설정 창 '소리')는 그대로 두고 맨 끝에서만 막는다(SoundMixer.setMuted). 값은 기억한다.
import type { Engine } from '../engine/Engine';
import { h } from './dom';
import { icon } from './icons';
import { S } from './strings';

export function mountMuteButton(engine: Engine, parent: HTMLElement): () => void {
  const mixer = engine.sound;
  const button = h('button', { type: 'button', class: 'qs-mute-btn qs-glass', 'aria-label': S.sound.muteAll, 'aria-pressed': 'false' });
  let shown: boolean | null = null;
  const render = (muted: boolean, supported: boolean): void => {
    button.hidden = !supported;
    if (shown === muted) return;
    shown = muted;
    button.setAttribute('aria-pressed', String(muted));
    button.classList.toggle('is-muted', muted);
    button.replaceChildren(icon(muted ? 'sound-off' : 'sound', 22));
  };
  // 첫 누르기라면 화면 전체의 '소리 열기'가 먼저 돌고(capture), 이어서 여기서 끄고 켠다
  button.addEventListener('click', () => mixer.setMuted(!mixer.isMuted()));
  parent.appendChild(button);
  const state = mixer.getState();
  render(state.muted, state.supported);
  const off = mixer.onChange((s) => render(s.muted, s.supported));
  return () => {
    off();
    button.remove();
  };
}
