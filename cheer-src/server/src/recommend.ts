// 방 추천: 텅 빈 방보다 사람이 적당히 있는 방.
export interface RoomCount {
  room: number;
  n: number;
}

/**
 * 규칙
 * 1. 정원의 60% 이하이면서 1명 이상인 방 가운데 사람이 가장 많은 방(그 방부터 채운다)
 * 2. 없으면 정원이 안 찬 방 가운데 가장 한산한 방(모두 60%를 넘었거나, 모두 비었을 때)
 * 같은 값이면 방 번호가 작은 쪽. 갈 곳이 없으면 null.
 */
export function recommendRoom(counts: readonly RoomCount[], capacity: number, exclude?: number): number | null {
  const open = counts.filter((c) => c.room !== exclude && c.n < capacity);
  if (open.length === 0) return null;
  const cozyMax = Math.ceil(capacity * 0.6);
  const cozy = open.filter((c) => c.n >= 1 && c.n <= cozyMax);
  const pick = (list: RoomCount[], better: (a: RoomCount, b: RoomCount) => boolean): number =>
    list.reduce((best, c) => (better(c, best) || (c.n === best.n && c.room < best.room) ? c : best)).room;
  if (cozy.length > 0) return pick(cozy, (a, b) => a.n > b.n);
  return pick(open, (a, b) => a.n < b.n);
}

/**
 * 지금 열어 둘 방들. counts는 1번부터 최대 개수까지의 방(번호 순).
 * 기본 base개를 열고, 그보다 큰 번호라도 사람이 있으면 그 방까지 연다.
 * 열린 방(exclude 빼고)이 모두 정원의 90% 이상이면 하나씩 더 연다(인원 집계가 몇 초 늦어도 넘치지 않게 미리).
 */
export function openRooms(counts: readonly RoomCount[], base: number, capacity: number, exclude?: number): RoomCount[] {
  let open = Math.min(base, counts.length);
  for (const c of counts) if (c.n > 0) open = Math.max(open, c.room);
  const busy = Math.max(1, Math.ceil(capacity * 0.9));
  const crowded = (n: number) => counts.slice(0, n).every((c) => c.room === exclude || c.n >= busy);
  while (open < counts.length && crowded(open)) open++;
  return counts.slice(0, open);
}
