// 주문: 누르면 말풍선에 메뉴 한 줄이 뜨고, 주모가 대답하고, 음식이 나온다.
// 메뉴 목록(글, 음식, 주모 대답)은 shared가 원본이라 방 모두가 같은 번호(v)로 같은 것을 본다.
import { ORDER_MENU, type OrderMenuItem } from '@shared/spaces/jumak';

/** 주문 뒤 주모가 대답하기까지 */
export const ORDER_REPLY_DELAY_MS = 1200;
/** 주문 뒤 음식이 나오기까지 (대답 다음) */
export const DISH_DELAY_MS = 1750;
/** 음식이 놓여 있는 시간 */
export const DISH_LIFE_MS = 40_000;
/** 음식이 한꺼번에 놓일 수 있는 수 */
export const MAX_DISHES = 8;
/** 말풍선이 떠 있는 시간 */
export const BUBBLE_MS = 3200;

/** v번째 메뉴. 번호가 없거나 범위 밖이면 첫 메뉴 (서버가 범위를 확인하니 정상이면 오지 않는다) */
export function menuFor(v: number | undefined): OrderMenuItem {
  const i = v !== undefined && Number.isInteger(v) && v >= 0 && v < ORDER_MENU.length ? v : 0;
  return ORDER_MENU[i]!;
}

/** 주모의 대답: 같은 주문에는 모두에게 같은 말이 가도록 (주문한 사람 번호, 메뉴 번호)로 고른다 */
export function pickReply(item: OrderMenuItem, senderId: number, v: number | undefined): string {
  const n = item.replies.length;
  return item.replies[Math.abs(senderId * 7 + (v ?? 0)) % n]!;
}
