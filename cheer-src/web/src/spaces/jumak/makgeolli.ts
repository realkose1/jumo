// 건배 그림: 막걸리 사발. 이모지에는 막걸리가 없어서(🍻는 맥주) 직접 그린 그림을 쓴다.
// 동작 버튼(<img>), 머리 위 터지는 그림(캔버스 텍스처), TV 응원 합계(캔버스)가 같은 그림을 쓴다.
// 외부 파일 없이 SVG 글자로 들고 다닌다.

/** 64x64 SVG: 뽀얀 막걸리가 찰랑이는 흙빛 사발과 튀어 오른 방울 */
export const MAKGEOLLI_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">' +
  '<defs>' +
  '<linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c98e55"/><stop offset="1" stop-color="#7d4f2b"/></linearGradient>' +
  '<radialGradient id="m" cx="0.45" cy="0.4" r="0.7"><stop offset="0" stop-color="#fffdf6"/><stop offset="1" stop-color="#e6dcc4"/></radialGradient>' +
  '</defs>' +
  // 튀어 오른 막걸리 방울
  '<g fill="#f7f1e2" stroke="#a88a5c" stroke-width="1.2">' +
  '<circle cx="22" cy="14" r="3.4"/><circle cx="33" cy="8" r="4.2"/><circle cx="44" cy="15" r="3"/>' +
  '<path d="M27 24c0-5 3-8 5-12 2 4 5 7 5 12z"/>' +
  '</g>' +
  // 굽
  '<path d="M23 53h18l-2 6H25z" fill="#6e4425"/>' +
  // 사발 몸통 (위가 넓고 아래로 둥글게 모인다)
  '<path d="M5 30h54c0 13-11 24-27 24S5 43 5 30z" fill="url(#b)" stroke="#5b3a1f" stroke-width="1.6" stroke-linejoin="round"/>' +
  // 분청 무늬 띠
  '<path d="M10 39c7 3 37 3 44 0" fill="none" stroke="#e9d3ad" stroke-width="2" stroke-linecap="round" opacity="0.8"/>' +
  // 막걸리 면과 입술
  '<ellipse cx="32" cy="30" rx="27" ry="7.5" fill="#d8b98e" stroke="#5b3a1f" stroke-width="1.6"/>' +
  '<ellipse cx="32" cy="30.6" rx="23" ry="5.4" fill="url(#m)"/>' +
  '</svg>';

/** <img src>나 CSS에 바로 쓰는 주소 */
export const MAKGEOLLI_ICON = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(MAKGEOLLI_SVG)}`;

let image: HTMLImageElement | null = null;
const waiting = new Set<() => void>();

/**
 * 캔버스에 그릴 그림. 처음 부르면 불러오기 시작하고, 다 불러오기 전에는 null을 준다.
 * onReady는 다 불러왔을 때 한 번 불린다(이미 불러왔으면 부르지 않는다).
 */
export function makgeolliImage(onReady?: () => void): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null;
  if (!image) {
    image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      for (const fn of waiting) fn();
      waiting.clear();
    };
    image.src = MAKGEOLLI_ICON;
  }
  if (image.complete && image.naturalWidth > 0) return image;
  if (onReady) waiting.add(onReady);
  return null;
}
