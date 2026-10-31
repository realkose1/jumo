// 주모 앱 안에서 iframe으로 열렸는지, 그렇다면 앱에 닫아 달라고 알리는 법.
/** 앱 안(iframe)이거나 주소에 ?from=app이 있으면 true */
export function isEmbedded(search: string, win: Pick<Window, 'parent'> & { self?: Window } = window): boolean {
  if (new URLSearchParams(search).get('from') === 'app') return true;
  try {
    return win.parent !== (win.self ?? win);
  } catch {
    return true; // 부모를 읽는 것조차 막혀 있으면 다른 출처의 iframe이다
  }
}

/** 앱(부모 창)에 보내는 소식: close 닫아 주세요, ready 화면이 떴어요, error 화면을 열지 못했어요 */
export type AppMessage = 'close' | 'ready' | 'error';

export function postToApp(action: AppMessage, win: Window = window): void {
  try {
    win.parent.postMessage({ type: 'jumo-cheer', action }, '*');
  } catch {
    /* 부모에게 못 보내도 화면에는 문제가 없다 */
  }
}

/** 앱(부모 창)에 "닫아 주세요"를 알린다. 앱이 이 메시지를 받아 화면을 닫는다 */
export function postCloseToApp(win: Window = window): void {
  postToApp('close', win);
}

/** 앱이 알려 주는 안전 영역(상단 노치, 하단 홈 바)의 최대 크기(CSS px). 이보다 크면 잘못된 값으로 본다 */
export const MAX_APP_INSET = 80;

/** 주소의 정수 값(?sat=, ?sab=)을 0~80으로. 없거나 숫자가 아니면 0 */
export function parseAppInset(search: string, key: 'sat' | 'sab'): number {
  const raw = new URLSearchParams(search).get(key);
  if (raw === null || raw.trim() === '') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_APP_INSET, Math.max(0, Math.round(n)));
}
