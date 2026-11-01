// Worker와 Durable Object가 함께 쓰는 환경 타입, 설정 읽기.
import { getSharedSpace, type SharedSpace } from '../../shared/spaces';
import type { Lobby } from './lobby';
import type { Room } from './room';

export interface PresenceEnv {
  ROOM: DurableObjectNamespace<Room>;
  LOBBY: DurableObjectNamespace<Lobby>;
  MAX_CONN_PER_IP?: string;
  SPACE_OVERRIDES?: string;
  ALLOWED_ORIGINS?: string;
  ROOMS_CACHE_MS?: string;
  /** 위치 묶음을 보내는 간격(ms). 기본 120(초당 약 8번) */
  MOVE_FLUSH_MS?: string;
}

declare global {
  namespace Cloudflare {
    interface Env extends PresenceEnv {}
    // 시험에서 `exports.default.fetch(...)`로 Worker를 부를 때 쓰는 타입
    interface GlobalProps {
      mainModule: typeof import('./index');
      durableNamespaces: 'Room' | 'Lobby';
    }
  }
}

export interface SpaceConfig {
  space: SharedSpace;
  capacity: number;
  /** 늘 열어 두는 방 개수 */
  roomCount: number;
  /** 다 차면 이 개수까지 방을 더 연다(roomCount 이상) */
  maxRooms: number;
}

function toInt(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}

function parseOverrides(raw: string | undefined): Record<string, { capacity?: number; rooms?: number; maxRooms?: number }> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as never) : {};
  } catch {
    return {};
  }
}

/** 공간 id의 정원과 방 개수. 모르는 공간이면 null */
export function getSpaceConfig(env: PresenceEnv, spaceId: string): SpaceConfig | null {
  const space = getSharedSpace(spaceId);
  if (!space) return null;
  const all = parseOverrides(env.SPACE_OVERRIDES);
  const override = Object.hasOwn(all, spaceId) ? all[spaceId] : undefined;
  const roomCount = toInt(override?.rooms, 1, 1000) ?? space.initialRoomCount;
  const maxRooms = toInt(override?.maxRooms, 1, 1000) ?? space.maxRoomCount ?? roomCount;
  return {
    space,
    capacity: toInt(override?.capacity, 1, 1000) ?? space.capacityPerRoom,
    roomCount,
    maxRooms: Math.max(roomCount, maxRooms),
  };
}

export function numberVar(raw: string | undefined, fallback: number, min = 0): number {
  const n = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

export function lobbyName(spaceId: string): string {
  return `lobby:${spaceId}`;
}

export function roomName(spaceId: string, room: number): string {
  return `${spaceId}:${room}`;
}
