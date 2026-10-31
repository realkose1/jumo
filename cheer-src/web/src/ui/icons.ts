// 직접 그린 선 그림 (24x24). 외부 아이콘 폰트나 출처를 모르는 그림은 쓰지 않는다.
import type { ActionDef } from '../engine/types';

const BODY = {
  sliders:
    '<path d="M4 7h8.4M17.6 7H20M4 17h2.4M11.6 17H20"/><circle cx="15" cy="7" r="2.6"/><circle cx="9" cy="17" r="2.6"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  hop: '<circle cx="12" cy="9.5" r="4"/><path d="M8.5 19.5h7"/>',
  'hop-double':
    '<path d="M3.5 19c1.2-6.2 6.8-6.2 8 0 1.2-6.2 6.8-6.2 8 0"/><circle cx="7.5" cy="8.5" r="1.7" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.7" fill="currentColor" stroke="none"/>',
  greet: '<path d="M12 19.5s-7-4.3-7-9.6a3.9 3.9 0 0 1 7-2.3 3.9 3.9 0 0 1 7 2.3c0 5.3-7 9.6-7 9.6z"/>',
  external: '<path d="M13.5 5H19v5.5M19 5l-8 8M17.5 14v3.5a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 17.5V8a1.5 1.5 0 0 1 1.5-1.5H10"/>',
} as const;

export type IconName = keyof typeof BODY;
/** ActionDef.icon에 쓸 수 있는 그림 이름 */
export type ActionIconName = 'hop' | 'hop-double' | 'greet';

const ACTION_ICONS: readonly string[] = ['hop', 'hop-double', 'greet'];

export function icon(name: IconName, size = 24): SVGElement {
  const host = document.createElement('div');
  host.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${BODY[name]}</svg>`;
  return host.firstElementChild as SVGElement;
}

export type ActionIcon = { kind: 'svg'; name: ActionIconName } | { kind: 'text'; text: string } | { kind: 'img'; src: string };

/**
 * 동작 버튼의 그림을 고른다.
 * 1) def.icon이 우리 그림 이름이면 그것, data:image/ 주소면 그 그림, 2) 짧은 이모지 같은 글자면 그대로,
 * 3) 없으면 인사는 하트, 나머지는 몸짓(motion)에 맞는 그림.
 */
export function resolveActionIcon(def: ActionDef, greetingActionId: string): ActionIcon {
  const given = def.icon?.trim();
  if (given) {
    if (ACTION_ICONS.includes(given)) return { kind: 'svg', name: given as ActionIconName };
    // 직접 그린 그림 (data: 주소만. 바깥 주소는 쓰지 않는다)
    if (given.startsWith('data:image/')) return { kind: 'img', src: given };
    if (!/^[a-z][a-z0-9-]*$/i.test(given) && [...given].length <= 4) return { kind: 'text', text: given };
  }
  if (def.id === greetingActionId) return { kind: 'svg', name: 'greet' };
  return { kind: 'svg', name: def.motion === 'hop' ? 'hop' : 'hop-double' };
}
