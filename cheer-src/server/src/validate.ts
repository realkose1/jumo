// 클라이언트 메시지 검사. 모양이 틀리면 null을 돌려주고, 통과한 것만 타입이 붙는다.
// 사용자 문자열을 다른 사람에게 전달하는 경로가 없도록, 문자열 필드는 모두 정해진 id와 대조한다.
import {
  DEVICE_ID_PATTERN,
  MAX_ACT_VARIANTS,
  MAX_COORD,
  MAX_MESSAGE_CHARS,
  type ClientMsg,
} from '../../shared/protocol';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function coord(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_COORD ? v : null;
}

function angle(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1000 ? v : null;
}

function id(v: unknown): string | null {
  return typeof v === 'string' && ID_PATTERN.test(v) ? v : null;
}

/** -π~π로 접고 소수 둘째 자리까지 */
export function normalizeAngle(r: number): number {
  const twoPi = Math.PI * 2;
  const folded = ((((r + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI;
  return Math.round(folded * 100) / 100;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type ParseResult = { ok: true; msg: ClientMsg } | { ok: false };

export function parseClientMessage(raw: string | ArrayBuffer): ParseResult {
  if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_CHARS) return { ok: false };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  if (!isRecord(data)) return { ok: false };

  switch (data.t) {
    case 'join': {
      const dev = typeof data.dev === 'string' && DEVICE_ID_PATTERN.test(data.dev) ? data.dev : null;
      const space = id(data.space);
      if (!dev || !space) return { ok: false };
      let room: number | undefined;
      if (data.room !== undefined) {
        if (typeof data.room !== 'number' || !Number.isInteger(data.room) || data.room < 1 || data.room > 10000) return { ok: false };
        room = data.room;
      }
      // 시작 위치는 틀려도 입장을 막지 않고 0으로 둔다
      const x = coord(data.x) ?? 0;
      const z = coord(data.z) ?? 0;
      const r = angle(data.r) ?? 0;
      return { ok: true, msg: { t: 'join', space, room, dev, x, z, r } };
    }
    case 'move': {
      const x = coord(data.x);
      const z = coord(data.z);
      const r = angle(data.r);
      if (x === null || z === null || r === null) return { ok: false };
      return { ok: true, msg: { t: 'move', x, z, r } };
    }
    case 'sit': {
      const seat = id(data.seat);
      return seat ? { ok: true, msg: { t: 'sit', seat } } : { ok: false };
    }
    case 'stand':
      return { ok: true, msg: { t: 'stand' } };
    case 'act': {
      const act = id(data.act);
      if (!act) return { ok: false };
      const msg: Extract<ClientMsg, { t: 'act' }> = { t: 'act', act };
      if (data.to !== undefined) {
        if (typeof data.to !== 'number' || !Number.isInteger(data.to) || data.to < 0) return { ok: false };
        msg.to = data.to;
      }
      // 변형 번호: 정수 0~15. 이 동작이 변형을 갖는지와 개수는 방(room.ts)이 공간 데이터로 확인한다
      if (data.v !== undefined) {
        if (typeof data.v !== 'number' || !Number.isInteger(data.v) || data.v < 0 || data.v >= MAX_ACT_VARIANTS) return { ok: false };
        msg.v = data.v;
      }
      return { ok: true, msg };
    }
    case 'state': {
      const key = id(data.key);
      if (!key || typeof data.val !== 'number' || !Number.isInteger(data.val)) return { ok: false };
      return { ok: true, msg: { t: 'state', key, val: data.val } };
    }
    case 'ping': {
      if (data.c !== undefined && (typeof data.c !== 'number' || !Number.isFinite(data.c))) return { ok: false };
      return { ok: true, msg: data.c === undefined ? { t: 'ping' } : { t: 'ping', c: data.c } };
    }
    default:
      return { ok: false };
  }
}
