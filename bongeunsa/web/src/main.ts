import './style.css';
import { Engine } from './engine/Engine';
import { withRoom } from './engine/net/room';
import { parseRoute, stripBase } from './route';
import { DEFAULT_SPACE_ID, loadSpace } from './spaces';
import { mountUI, type UIHandle } from './ui';
import { lockPageScroll } from './ui/scrollLock';

const stage = document.getElementById('stage');
const uiRoot = document.getElementById('ui-root');

/** 3D 화면을 열 수 없을 때(WebGL이 없거나 공간을 못 불러옴): 한 줄 안내와 '다시 열기' 버튼을 전체 화면으로 띄운다 */
function showFatal(text: string): void {
  const el = document.createElement('div');
  el.className = 'fatal';
  el.setAttribute('role', 'alert');
  const msg = document.createElement('p');
  msg.textContent = text;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '다시 열기';
  button.addEventListener('click', () => location.reload());
  el.append(msg, button);
  document.body.appendChild(el);
}

/** 'same-origin'이면 화면을 내어 준 주소의 /ws (배포: 한 Worker가 화면과 실시간 서버를 같이 맡는다) */
function resolvePresenceUrl(value: string | undefined): string | undefined {
  if (value?.trim() !== 'same-origin') return value;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
}

/** 안내 문구를 읽을 시간을 준 뒤 추천 방으로 옮긴다 */
const ROOM_FULL_MOVE_DELAY_MS = 2800;

let engine: Engine | null = null;
let ui: UIHandle | null = null;
let detachSpace: (() => void) | null = null;

async function boot(): Promise<void> {
  // 인앱 브라우저에서 조이스틱·화면을 끌 때 페이지가 끌려 내려가지 않게
  lockPageScroll();
  if (!stage || !uiRoot) return;
  // 주소의 공간 id는 배포 기준 경로(vite base) 다음 첫 마디다
  const route = parseRoute(stripBase(location.pathname, import.meta.env.BASE_URL), location.search, DEFAULT_SPACE_ID);
  let space: Awaited<ReturnType<typeof loadSpace>>;
  try {
    space = await loadSpace(route.spaceId);
  } catch (cause) {
    console.error('[space] 공간을 불러오지 못했어요', cause);
    showFatal('공간을 불러오지 못했어요');
    return;
  }
  if (!space) {
    showFatal('이 주소의 공간을 찾지 못했어요');
    return;
  }
  document.title = space.title.ko;
  try {
    engine = new Engine({
      container: stage,
      space,
      room: route.room,
      presenceUrl: resolvePresenceUrl(import.meta.env.VITE_PRESENCE_URL),
      timeOffsetMinutes: route.timeOffsetMinutes,
      quality: route.quality,
    });
  } catch (cause) {
    console.error('[engine] 3D 화면을 만들지 못했어요', cause);
    showFatal('3D 화면을 열 수 없어요');
    return;
  }
  // UI의 구독(로딩, 버튼, 설정)은 start() 전에 걸어야 한다. 불러오기 실패 안내는 로딩 화면이 맡는다.
  ui = mountUI(engine, uiRoot);
  // 공간이 엔진 이벤트를 자기 장면 효과와 소리에 잇는다 (SpaceDefinition.attach)
  detachSpace = space.attach?.({ engine, ui }) ?? null;
  engine.on('error', (e) => console.error('[engine]', e.message, e.cause));
  // 서버가 정해 준 방을 주소에 반영한다: 새로고침해도, 링크를 나눠도 같은 방이다
  engine.on('room-change', ({ room }) => {
    try {
      history.replaceState(history.state, '', `${location.pathname}${withRoom(location.search, room)}${location.hash}`);
    } catch {
      /* 주소를 못 바꿔도 화면에는 문제가 없다 */
    }
  });
  // 정원이 찬 방이면 안내 문구(화면)를 잠깐 보여준 뒤 추천 방으로 옮긴다
  engine.on('room-full', ({ rec }) => {
    if (rec === null) return;
    window.setTimeout(() => {
      location.replace(`${location.pathname}${withRoom(location.search, rec)}${location.hash}`);
    }, ROOM_FULL_MOVE_DELAY_MS);
  });
  // 개발 모드에서만 열리는 디버그 핸들 (배포 빌드에서는 빠진다)
  if (import.meta.env.DEV) (window as unknown as { __engine?: Engine }).__engine = engine;
  await engine.start();
  // 화면이 떴다: index.html의 '번들을 못 불러옴' 안내가 더는 나오지 않게 한다
  if (engine.isReady()) (window as unknown as { __appReady?: boolean }).__appReady = true;
}

void boot();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    detachSpace?.();
    detachSpace = null;
    ui?.dispose();
    ui = null;
    engine?.dispose();
    engine = null;
  });
}
