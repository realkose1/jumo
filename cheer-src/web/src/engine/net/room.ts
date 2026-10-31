// 주소의 방 번호 다루기: ?room=3 읽기, 서버가 정해 준 방을 주소에 반영하기.

/** 서버가 받는 방 번호(1~10000 정수)만 돌려준다. 아니면 null(서버가 정하게 한다) */
export function parseRoomNumber(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!/^\d{1,5}$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= 10000 ? n : null;
}

/** 주소의 쿼리에서 room만 바꾼다. 다른 값(timeOffset, quality 등)은 그대로 둔다. search는 '?a=1' 꼴 */
export function withRoom(search: string, room: number): string {
  const params = new URLSearchParams(search);
  params.set('room', String(room));
  return `?${params.toString()}`;
}
