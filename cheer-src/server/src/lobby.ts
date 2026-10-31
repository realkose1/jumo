// 공간별 '로비' Durable Object (이름 `lobby:<공간id>`). 방들의 현재 인원과 하루 선물 횟수를 모아 둔다.
// 방 Durable Object가 인원이 바뀔 때 report로 알리고, GET /rooms와 방 추천은 여기서 읽는다.
import { DurableObject } from 'cloudflare:workers';
import type { PresenceEnv } from './env';
import { openRooms, recommendRoom, type RoomCount } from './recommend';
import { kstDay } from './time';

/** 이 시간 동안 방에서 소식이 없으면 그 방의 인원을 0으로 본다(방이 비정상으로 끝난 경우 대비). 방은 10분마다 알린다 */
export const STALE_AFTER_MS = 25 * 60 * 1000;

interface RoomEntry {
  n: number;
  t: number;
}

export interface RoomsSnapshot {
  rooms: RoomCount[];
  recommended: number | null;
}

export class Lobby extends DurableObject<PresenceEnv> {
  private counts = new Map<number, RoomEntry>();

  constructor(ctx: DurableObjectState, env: PresenceEnv) {
    super(ctx, env);
    for (const [key, value] of ctx.storage.kv.list<RoomEntry>({ prefix: 'r:' })) {
      this.counts.set(Number(key.slice(2)), value);
    }
  }

  /** 방이 지금 인원을 알린다 */
  report(room: number, n: number): void {
    if (!Number.isInteger(room) || room < 1 || !Number.isInteger(n) || n < 0) return;
    const entry = { n, t: Date.now() };
    this.counts.set(room, entry);
    this.ctx.storage.kv.put(`r:${room}`, entry);
  }

  /**
   * 지금 열린 방들의 인원과 추천 방. 기본 roomCount개이고, 모두 거의 차면 maxRooms개까지 하나씩 더 연다.
   * 갈 곳이 정말 없으면(모든 방이 다 참) recommended는 null.
   */
  snapshot(roomCount: number, capacity: number, exclude?: number, maxRooms = roomCount): RoomsSnapshot {
    const now = Date.now();
    const all: RoomCount[] = [];
    for (let room = 1; room <= Math.max(roomCount, maxRooms); room++) {
      const e = this.counts.get(room);
      all.push({ room, n: e && now - e.t <= STALE_AFTER_MS ? e.n : 0 });
    }
    const rooms = openRooms(all, roomCount, capacity, exclude);
    return { rooms, recommended: recommendRoom(rooms, capacity, exclude) };
  }

  /**
   * 선물 동작 하나를 쓴다. 기기별로 한국 시간 하루에 limit번까지.
   * 쓸 수 있으면 오늘 남은 횟수(0 이상)를, 이미 다 썼으면 -1을 돌려준다.
   * 방이 아니라 공간 단위로 세서, 방을 옮겨 다녀도 제한이 이어진다.
   */
  consumeGift(dev: string, actId: string, limit: number): number {
    const now = Date.now();
    const today = kstDay(now);
    const key = `g:${dev}:${actId}`;
    const entry = this.ctx.storage.kv.get<[string, number]>(key);
    const used = entry && entry[0] === today ? entry[1] : 0;
    if (used >= limit) return -1;
    this.ctx.storage.kv.put(key, [today, used + 1]);
    this.sweepOldGifts(today);
    return limit - used - 1;
  }

  /** 지난 날짜 기록을 하루에 한 번 지운다 */
  private sweepOldGifts(today: string): void {
    const kv = this.ctx.storage.kv;
    if (kv.get<string>('sweep') === today) return;
    kv.put('sweep', today);
    const old: string[] = [];
    for (const [key, value] of kv.list<[string, number]>({ prefix: 'g:' })) {
      if (value[0] !== today) old.push(key);
    }
    for (const key of old) kv.delete(key);
  }
}
