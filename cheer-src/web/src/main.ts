import './style.css';
import { CheerController } from './cheer/controller';
import { isEmbedded, parseAppInset, postCloseToApp, postToApp } from './cheer/embed';
import { Engine } from './engine/Engine';
import { withRoom } from './engine/net/room';
import { parseRoute, stripBase } from './route';
import { DEFAULT_SPACE_ID, loadSpace } from './spaces';
import { mountUI, type UIHandle } from './ui';
import { lockPageScroll } from './ui/scrollLock';

const stage = document.getElementById('stage');
const uiRoot = document.getElementById('ui-root');

/**
 * 3D 화면을 열 수 없을 때(WebGL이 없거나 번들이 깨짐): 앱에 'error'를 알리고, 한 줄 안내와 버튼 하나를 전체 화면으로 띄운다.
 * 앱 안(iframe)이면 버튼이 닫기(앱에 close를 보낸다), 일반 웹 링크면 다시 열기다.
 */
function showFatal(text: string, embedded: boolean): void {
  postToApp('error');
  const el = document.createElement('div');
  el.className = 'fatal';
  el.setAttribute('role', 'alert');
  const msg = document.createElement('p');
  msg.textContent = text;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = embedded ? '닫기' : '다시 열기';
  button.addEventListener('click', () => (embedded ? postCloseToApp() : location.reload()));
  el.append(msg, button);
  document.body.appendChild(el);
}

/** 안내 문구를 읽을 시간을 준 뒤 추천 방으로 옮긴다 */
const ROOM_FULL_MOVE_DELAY_MS = 2800;

let engine: Engine | null = null;
let ui: UIHandle | null = null;
let cheer: CheerController | null = null;
let stopDemo: (() => void) | null = null;

async function boot(): Promise<void> {
  // 인앱 브라우저에서 조이스틱·화면을 끌 때 페이지가 끌려 내려가지 않게
  lockPageScroll();
  if (!stage || !uiRoot) return;
  // 주소의 공간 id는 배포 기준 경로(/cheer/) 다음 첫 마디다
  const route = parseRoute(stripBase(location.pathname, import.meta.env.BASE_URL), location.search, DEFAULT_SPACE_ID);
  const space = await loadSpace(route.spaceId);
  const embedded = isEmbedded(location.search);
  if (!space) {
    showFatal('이 주소의 공간을 찾지 못했어요', embedded);
    return;
  }
  document.title = space.title.ko;
  const params = new URLSearchParams(location.search);
  // iOS 웹뷰는 iframe 안에서 안전 영역(노치, 홈 바)을 0으로 알려 줘서, 앱이 주소(?sat, ?sab)로 알려 준 값을 쓴다
  const root = document.documentElement.style;
  const sat = parseAppInset(location.search, 'sat');
  const sab = parseAppInset(location.search, 'sab');
  if (sat > 0) root.setProperty('--jumo-sat', `${sat}px`);
  if (sab > 0) root.setProperty('--jumo-sab', `${sab}px`);
  // 개발 빌드의 ?demo=1: 서버 없이 가짜 경기와 가짜 사람들로 돌린다 (배포 빌드에서는 이 줄들이 통째로 빠진다)
  const demo = import.meta.env.DEV && params.get('demo') === '1';
  try {
    engine = new Engine({
      container: stage,
      space,
      room: route.room,
      presenceUrl: demo ? null : import.meta.env.VITE_PRESENCE_URL,
      timeOffsetMinutes: route.timeOffsetMinutes,
      quality: route.quality,
    });
  } catch (cause) {
    console.error('[engine] 3D 화면을 만들지 못했어요', cause);
    showFatal('3D 화면을 열 수 없어요', embedded);
    return;
  }
  // UI의 구독(로딩, 버튼, 설정)은 start() 전에 걸어야 한다. 불러오기 실패 안내는 로딩 화면이 맡는다.
  ui = mountUI(engine, uiRoot, { embedded, onClose: () => postCloseToApp() });
  // 경기 피드, 같이 모이는 순간, 남의 동작을 장면과 화면에 이어 준다 (engine.start() 전에 구독한다)
  // 간판 이름("이강인 응원 주막")이 바뀌면 문서 제목도 같이 바꾼다
  cheer = new CheerController({ engine, ui, focusMatchId: params.get('m'), onRoomName: (name) => (document.title = name) });
  cheer.start();
  engine.on('error', (e) => {
    console.error('[engine]', e.message, e.cause);
    postToApp('error'); // 장면을 못 불러왔다: 앱이 자기 안내를 띄운다 (로딩 화면의 '다시 해볼게요'도 그대로 있다)
  });
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
  // 화면이 떴다고 앱에 알린다. 앱은 이 소식이 12초 안에 안 오면 자기 오류 화면을 띄운다
  if (engine.isReady()) {
    (window as unknown as { __jumoCheerReady?: boolean }).__jumoCheerReady = true;
    postToApp('ready');
  }
  if (import.meta.env.DEV && demo) {
    const { startDemo } = await import('./cheer/demo');
    stopDemo = startDemo(engine, cheer, ui).stop;
  }
}

void boot();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopDemo?.();
    stopDemo = null;
    cheer?.dispose();
    cheer = null;
    ui?.dispose();
    ui = null;
    engine?.dispose();
    engine = null;
  });
}
