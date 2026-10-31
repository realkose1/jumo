// 페이지 스크롤 잠금.
// 카카오톡·인스타그램 같은 인앱 브라우저(iOS 웹뷰)는 overscroll-behavior와 touch-action을 다 지키지 않아서,
// 조이스틱이나 화면을 끌면 페이지가 통째로 끌려 내려가거나 주소창이 접혔다 펴진다.
// 손가락 움직임(touchmove)의 기본 동작을 막아 페이지가 움직이지 않게 한다.
// 포인터 이벤트(조이스틱, 시점 끌기)는 그대로 온다. 설정 창처럼 스스로 스크롤하는 곳만 풀어 준다.

/** 안에서 손가락으로 스크롤해도 되는 곳 */
export const SCROLLABLE_SELECTOR = '.qs-panel';

interface ClosestTarget {
  closest(selector: string): unknown;
}

function isClosestTarget(t: unknown): t is ClosestTarget {
  return typeof t === 'object' && t !== null && typeof (t as ClosestTarget).closest === 'function';
}

/** 이 손가락 움직임의 기본 동작(페이지 스크롤, 확대)을 막아야 하는가 */
export function shouldBlockTouchMove(target: unknown, touches: number): boolean {
  if (touches > 1) return true; // 두 손가락 확대는 언제나 막는다
  return !(isClosestTarget(target) && target.closest(SCROLLABLE_SELECTOR));
}

interface LockTargets {
  doc: Pick<Document, 'addEventListener' | 'removeEventListener'>;
  win: Pick<Window, 'addEventListener' | 'removeEventListener' | 'scrollTo'> & { scrollX: number; scrollY: number };
}

/** 잠금을 건다. 돌려주는 함수를 부르면 푼다 */
export function lockPageScroll(targets: LockTargets = { doc: document, win: window }): () => void {
  const { doc, win } = targets;
  const onTouchMove = (e: Event): void => {
    const touches = (e as TouchEvent).touches?.length ?? 1;
    if (e.cancelable && shouldBlockTouchMove(e.target, touches)) e.preventDefault();
  };
  const onGesture = (e: Event): void => e.preventDefault(); // iOS 핀치 확대
  // 그래도 페이지가 밀렸으면(주소창이 접히며 밀리는 경우 등) 제자리로
  const onScroll = (): void => {
    if (win.scrollX !== 0 || win.scrollY !== 0) win.scrollTo(0, 0);
  };
  doc.addEventListener('touchmove', onTouchMove, { passive: false });
  doc.addEventListener('gesturestart', onGesture, { passive: false } as AddEventListenerOptions);
  win.addEventListener('scroll', onScroll, { passive: true });
  return () => {
    doc.removeEventListener('touchmove', onTouchMove);
    doc.removeEventListener('gesturestart', onGesture);
    win.removeEventListener('scroll', onScroll);
  };
}
