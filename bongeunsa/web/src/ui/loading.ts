// 로딩 화면: 3D 장면을 먼저 흐리게 깔아 두고 그 위에 진행 표시와 손장난을 얹는다.
// 'ready'가 오면 부드럽게 걷어내고, 움직임 줄이기면 바로 걷어낸다.
import type { Engine } from '../engine/Engine';
import { h } from './dom';
import { S } from './strings';

const FADE_MS = 800;

interface Toy {
  el: HTMLElement;
  press(reduced: boolean): void;
}

/** 작은 동그라미가 고리를 한 바퀴 도는 손장난. 1단계 임시이고, 공간마다 TOYS에 등록해 갈아 끼운다. */
function createOrbitToy(label: string): Toy {
  const dot = h('span', { class: 'qs-toy__dot' });
  const orbit = h('span', { class: 'qs-toy__orbit' }, dot);
  const el = h('button', { type: 'button', class: 'qs-toy', 'aria-label': S.loading.toyHint(label) }, orbit);
  let timer: number | undefined;
  return {
    el,
    press(reduced) {
      window.clearTimeout(timer);
      el.classList.remove('is-go', 'is-lit');
      void el.offsetWidth;
      // 움직임 줄이기: 도는 대신 불빛만 잠깐 켜진다
      el.classList.add(reduced ? 'is-lit' : 'is-go');
      timer = window.setTimeout(() => el.classList.remove('is-go', 'is-lit'), reduced ? 500 : 1100);
    },
  };
}

type ToyFactory = (label: string) => Toy;
/** loadingToy.id별 손장난. 없는 id는 동그라미 손장난을 쓴다. */
const TOYS: Record<string, ToyFactory> = {
  bubbles: createOrbitToy,
};

export function mountLoading(engine: Engine, parent: HTMLElement): () => void {
  if (engine.isReady()) return () => undefined;

  const { space } = engine;
  const makeToy = Object.hasOwn(TOYS, space.loadingToy.id) ? TOYS[space.loadingToy.id]! : createOrbitToy;
  const toy = makeToy(space.loadingToy.label.ko);
  toy.el.addEventListener('click', () => toy.press(engine.getReducedMotion()));

  const fill = h('i', { class: 'qs-bar__fill' });
  const bar = h(
    'div',
    {
      class: 'qs-bar',
      role: 'progressbar',
      'aria-label': S.loading.progress,
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-valuenow': 0,
    },
    fill,
  );
  const status = h('p', { class: 'qs-loading__status', 'aria-live': 'polite' }, S.loading.preparing);
  const retry = h('button', { type: 'button', class: 'qs-button', hidden: true }, S.loading.retry);
  retry.addEventListener('click', () => location.reload());
  const caption = h('p', { class: 'qs-loading__caption', 'aria-hidden': true }, space.loadingToy.label.ko);

  const overlay = h(
    'div',
    { class: 'qs-loading', 'aria-busy': true },
    h(
      'div',
      { class: 'qs-loading__box' },
      h('p', { class: 'qs-loading__title' }, space.title.ko),
      bar,
      status,
      h('div', { class: 'qs-loading__toy' }, toy.el, caption),
      retry,
    ),
  );
  parent.appendChild(overlay);

  const setProgress = (p: number): void => {
    const clamped = Math.min(1, Math.max(0, p));
    fill.style.transform = `scaleX(${clamped})`;
    bar.setAttribute('aria-valuenow', String(Math.round(clamped * 100)));
  };
  setProgress(engine.getLoadingProgress());

  let removeTimer: number | undefined;
  const unsubscribers = [
    engine.on('loading-progress', ({ progress }) => setProgress(progress)),
    engine.on('ready', () => {
      setProgress(1);
      status.textContent = S.loading.ready;
      overlay.setAttribute('aria-busy', 'false');
      if (engine.getReducedMotion()) {
        overlay.remove();
        return;
      }
      overlay.classList.add('is-done'); // 부드럽게 걷히는 동안에도 아래 장면을 누를 수 있다
      removeTimer = window.setTimeout(() => overlay.remove(), FADE_MS + 100);
    }),
    engine.on('error', () => {
      overlay.classList.add('is-error');
      overlay.setAttribute('aria-busy', 'false');
      status.textContent = S.loading.failed;
      status.setAttribute('role', 'alert');
      retry.hidden = false;
      retry.focus();
    }),
  ];

  return () => {
    for (const off of unsubscribers) off();
    window.clearTimeout(removeTimer);
    overlay.remove();
  };
}
