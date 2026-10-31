// 설정 창의 '소리' 구역: 환경음, 공동 소리, 효과음의 켜기/끄기와 크기, 다른 탭에서 계속 듣기.
import type { Engine } from '../engine/Engine';
import { SOUND_LAYER_IDS, type SoundLayerId, type SoundState } from '../engine/sound';
import { h } from './dom';
import { S } from './strings';

interface Row {
  toggle: HTMLButtonElement;
  slider: HTMLInputElement;
  value: HTMLElement;
  row: HTMLElement;
  noFiles: HTMLElement;
}

function makeSwitch(labelledBy: string): HTMLButtonElement {
  return h(
    'button',
    { type: 'button', class: 'qs-switch', role: 'switch', 'aria-checked': 'false', 'aria-labelledby': labelledBy },
    h('span', { class: 'qs-switch__track', 'aria-hidden': true }, h('span', { class: 'qs-switch__thumb' })),
  );
}

export function buildSoundPanel(engine: Engine): { el: HTMLElement; dispose: () => void } {
  const mixer = engine.sound;
  const rows = {} as Record<SoundLayerId, Row>;
  const note = h('p', { class: 'qs-note', role: 'status' });
  const items: HTMLElement[] = [note];

  for (const id of SOUND_LAYER_IDS) {
    const text = S.sound[id];
    const titleId = `qs-sound-${id}`;
    const toggle = makeSwitch(titleId);
    const slider = h('input', {
      type: 'range',
      class: 'qs-range',
      min: 0,
      max: 100,
      step: 1,
      'aria-label': S.sound.volume(text.label),
    });
    const value = h('span', { class: 'qs-sound__value', 'aria-hidden': true });
    const noFiles = h('p', { class: 'qs-sound__nofiles', hidden: true }, S.sound.noFiles);
    const row = h(
      'section',
      { class: 'qs-sound', role: 'group', 'aria-labelledby': titleId },
      h(
        'div',
        { class: 'qs-sound__head' },
        h('div', {}, h('h3', { class: 'qs-sound__title', id: titleId }, text.label), h('p', { class: 'qs-sound__hint' }, text.hint)),
        toggle,
      ),
      noFiles,
      h('div', { class: 'qs-sound__volume' }, slider, value),
    );
    toggle.addEventListener('click', () => {
      const on = mixer.isEnabled(id);
      if (!mixer.setEnabled(id, !on)) {
        // 아직 켤 수 없는 상태: 안내 문구를 한 번 깜빡여 알려 준다
        note.classList.remove('is-nudge');
        void note.offsetWidth;
        note.classList.add('is-nudge');
      }
    });
    slider.addEventListener('input', () => mixer.setVolume(id, Number(slider.value) / 100));
    rows[id] = { toggle, slider, value, row, noFiles };
    items.push(row);
  }

  const keepToggle = makeSwitch('qs-sound-keep');
  keepToggle.addEventListener('click', () => mixer.setKeepPlayingInBackground(!mixer.isKeepPlayingInBackground()));
  items.push(
    h(
      'section',
      { class: 'qs-sound qs-sound--keep' },
      h(
        'div',
        { class: 'qs-sound__head' },
        h(
          'div',
          {},
          h('h3', { class: 'qs-sound__title', id: 'qs-sound-keep' }, S.sound.keepPlaying.label),
          h('p', { class: 'qs-sound__hint' }, S.sound.keepPlaying.hint),
        ),
        keepToggle,
      ),
    ),
    h('p', { class: 'qs-footnote' }, S.sound.startsOff),
  );

  const render = (state: SoundState): void => {
    const blocked = !state.supported || !state.unlocked;
    note.textContent = !state.supported ? S.sound.unsupported : !state.unlocked ? S.sound.locked : '';
    note.hidden = !blocked;
    for (const id of SOUND_LAYER_IDS) {
      const layer = state.layers[id];
      const r = rows[id];
      const percent = Math.round(layer.volume * 100);
      r.toggle.setAttribute('aria-checked', String(layer.enabled));
      r.toggle.setAttribute('aria-disabled', String(blocked));
      if (Number(r.slider.value) !== percent) r.slider.value = String(percent);
      r.slider.setAttribute('aria-valuetext', S.sound.percent(percent));
      r.slider.style.setProperty('--qs-fill', `${percent}%`);
      r.value.textContent = S.sound.percent(percent);
      r.row.classList.toggle('is-off', !layer.enabled);
      r.row.classList.toggle('is-empty', !layer.hasFiles);
      r.noFiles.hidden = layer.hasFiles;
    }
    keepToggle.setAttribute('aria-checked', String(state.keepPlayingInBackground));
  };
  render(mixer.getState());
  const dispose = mixer.onChange(render);

  return { el: h('div', { class: 'qs-stack' }, ...items), dispose };
}
