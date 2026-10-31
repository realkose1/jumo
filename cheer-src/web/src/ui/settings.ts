// 오른쪽 위 설정 버튼과 설정 창(모달). 구역 셋: 소리, 조작, 움직임 줄이기.
// 열려 있는 동안 엔진 입력을 끄고, Esc로 닫고, 포커스를 가두고, 닫으면 설정 버튼으로 되돌린다.
import type { Engine } from '../engine/Engine';
import { h, trapTab } from './dom';
import { displayName } from '../engine/net/names';
import { icon } from './icons';
import { buildSoundPanel } from './soundPanel';
import { S } from './strings';

type TabId = 'sound' | 'controls' | 'motion';
const TAB_IDS: readonly TabId[] = ['sound', 'controls', 'motion'];
const CLOSE_MS = 200;

function keycap(text: string): HTMLElement {
  return h('kbd', { class: 'qs-kbd' }, text);
}

function buildControlsPanel(): HTMLElement {
  const group = (title: string, rows: ReadonlyArray<{ how: readonly string[]; also?: readonly string[]; what: string }>) =>
    h(
      'section',
      { class: 'qs-controls__group' },
      h('h3', { class: 'qs-controls__heading' }, title),
      h(
        'dl',
        { class: 'qs-controls__list' },
        ...rows.flatMap((row) => [
          h(
            'dt',
            {},
            ...row.how.map(keycap),
            row.also ? h('span', { class: 'qs-controls__or' }, '또는') : null,
            ...(row.also ?? []).map(keycap),
          ),
          h('dd', {}, row.what),
        ]),
      ),
    );
  return h(
    'div',
    { class: 'qs-stack' },
    group(S.controls.desktop, S.controls.rows.desktop),
    group(S.controls.phone, S.controls.rows.phone),
  );
}

function buildMotionPanel(engine: Engine): { el: HTMLElement; dispose: () => void } {
  const options: Array<{ value: 'system' | 'on' | 'off'; pref: boolean | null }> = [
    { value: 'system', pref: null },
    { value: 'on', pref: true },
    { value: 'off', pref: false },
  ];
  const inputs = new Map<string, HTMLInputElement>();
  const status = h('p', { class: 'qs-note', role: 'status' });
  const cards = options.map(({ value, pref }) => {
    const text = S.motion[value];
    const input = h('input', { type: 'radio', name: 'qs-motion', value, class: 'qs-radio__input' });
    input.addEventListener('change', () => {
      if (input.checked) engine.setReducedMotion(pref);
    });
    inputs.set(value, input);
    return h(
      'label',
      { class: 'qs-radio' },
      input,
      h('span', { class: 'qs-radio__mark', 'aria-hidden': true }),
      h('span', { class: 'qs-radio__text' }, h('span', { class: 'qs-radio__label' }, text.label), h('span', { class: 'qs-radio__hint' }, text.hint)),
    );
  });
  const render = (): void => {
    const pref = engine.getReducedMotionPreference();
    inputs.get(pref === null ? 'system' : pref ? 'on' : 'off')!.checked = true;
    status.textContent = engine.getReducedMotion() ? S.motion.nowOn : S.motion.nowOff;
  };
  render();
  const dispose = engine.on('reduced-motion-change', render);
  return {
    el: h(
      'div',
      { class: 'qs-stack' },
      h('p', { class: 'qs-footnote' }, S.motion.intro),
      h('div', { class: 'qs-radios', role: 'radiogroup', 'aria-label': S.motion.group }, ...cards),
      status,
    ),
    dispose,
  };
}

export function mountSettings(engine: Engine, parent: HTMLElement): () => void {
  const cleanups: Array<() => void> = [];

  // 버튼
  const openButton = h(
    'button',
    {
      type: 'button',
      class: 'qs-settings-btn qs-glass',
      'aria-label': S.settings.open,
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
    },
    icon('sliders', 22),
  );
  parent.appendChild(openButton);

  // 구역
  const sound = buildSoundPanel(engine);
  const motion = buildMotionPanel(engine);
  cleanups.push(sound.dispose, motion.dispose);
  const bodies: Record<TabId, HTMLElement> = {
    sound: sound.el,
    controls: buildControlsPanel(),
    motion: motion.el,
  };

  const tabs = new Map<TabId, HTMLButtonElement>();
  const panels = new Map<TabId, HTMLElement>();
  for (const id of TAB_IDS) {
    const tab = h(
      'button',
      {
        type: 'button',
        class: 'qs-tab',
        role: 'tab',
        id: `qs-tab-${id}`,
        'aria-controls': `qs-panel-${id}`,
        'aria-selected': 'false',
        tabindex: '-1',
      },
      S.settings.tabs[id],
    );
    tab.addEventListener('click', () => select(id));
    tabs.set(id, tab);
    panels.set(
      id,
      h('div', { class: 'qs-panel', role: 'tabpanel', id: `qs-panel-${id}`, 'aria-labelledby': `qs-tab-${id}`, tabindex: '0', hidden: true }, bodies[id]),
    );
  }

  const closeButton = h('button', { type: 'button', class: 'qs-icon-btn', 'aria-label': S.settings.close }, icon('close', 20));
  // 창 위쪽 작은 글씨: 서버가 오늘 붙여 준 내 이름 (연결돼 있을 때만)
  const nameLine = h('p', { class: 'qs-modal__name', hidden: true });
  const renderName = (): void => {
    const { status, name } = engine.getNetState();
    const show = status === 'online' && name !== null;
    nameLine.hidden = !show;
    nameLine.textContent = show ? S.net.todayName(displayName(name)) : '';
  };
  renderName();
  cleanups.push(engine.on('self-name', renderName), engine.on('net-status', renderName));
  const tabList = h('div', { class: 'qs-tabs', role: 'tablist', 'aria-label': S.settings.tabsLabel }, ...tabs.values());
  const dialog = h(
    'div',
    { class: 'qs-modal qs-glass', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'qs-settings-title', tabindex: '-1' },
    h(
      'header',
      { class: 'qs-modal__head' },
      h('div', { class: 'qs-modal__titles' }, h('h2', { class: 'qs-modal__title', id: 'qs-settings-title' }, S.settings.title), nameLine),
      closeButton,
    ),
    tabList,
    ...panels.values(),
  );
  const backdrop = h('div', { class: 'qs-backdrop', hidden: true }, dialog);
  parent.appendChild(backdrop);

  let current: TabId = 'sound';
  function select(id: TabId, focus = false): void {
    current = id;
    for (const tabId of TAB_IDS) {
      const on = tabId === id;
      const tab = tabs.get(tabId)!;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      panels.get(tabId)!.hidden = !on;
    }
    if (focus) tabs.get(id)!.focus();
  }
  select('sound');

  tabList.addEventListener('keydown', (e) => {
    const index = TAB_IDS.indexOf(current);
    const last = TAB_IDS.length - 1;
    const next =
      e.key === 'ArrowRight' ? (index + 1) % TAB_IDS.length
      : e.key === 'ArrowLeft' ? (index + last) % TAB_IDS.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : -1;
    if (next < 0) return;
    e.preventDefault();
    select(TAB_IDS[next]!, true);
  });

  // 열기와 닫기
  let isOpen = false;
  let closeTimer: number | undefined;
  const inerted: HTMLElement[] = [];

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else {
      trapTab(e, dialog);
    }
  };

  function open(): void {
    if (isOpen) return;
    isOpen = true;
    window.clearTimeout(closeTimer);
    engine.setInputEnabled(false);
    // 뒤쪽 버튼들은 키보드와 화면 읽기에서 잠시 빼 둔다
    for (const child of [...parent.children] as HTMLElement[]) {
      if (child !== backdrop && !child.inert) {
        child.inert = true;
        inerted.push(child);
      }
    }
    openButton.setAttribute('aria-expanded', 'true');
    backdrop.hidden = false;
    void backdrop.offsetWidth;
    backdrop.classList.add('is-open');
    document.addEventListener('keydown', onKeyDown, true);
    tabs.get(current)!.focus();
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    document.removeEventListener('keydown', onKeyDown, true);
    engine.setInputEnabled(true);
    for (const el of inerted) el.inert = false;
    inerted.length = 0;
    openButton.setAttribute('aria-expanded', 'false');
    backdrop.classList.remove('is-open');
    openButton.focus();
    const done = (): void => {
      if (!isOpen) backdrop.hidden = true;
    };
    if (engine.getReducedMotion()) done();
    else closeTimer = window.setTimeout(done, CLOSE_MS);
  }

  openButton.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close();
  });

  cleanups.push(() => {
    window.clearTimeout(closeTimer);
    document.removeEventListener('keydown', onKeyDown, true);
    if (isOpen) engine.setInputEnabled(true);
    for (const el of inerted) el.inert = false;
    openButton.remove();
    backdrop.remove();
  });

  return () => {
    for (const fn of cleanups) fn();
  };
}
