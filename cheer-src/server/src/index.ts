// Worker 입구. 경로를 나누고 방 Durable Object나 로비 Durable Object로 넘긴다.
//   GET /ws?space=<공간id>&room=<방번호>   WebSocket 업그레이드 (room을 빼면 서버가 사람이 적당히 있는 방을 고른다)
//   GET /rooms?space=<공간id>              방별 인원과 추천 방(JSON)
//   GET /health                            살아 있는지
import { getSpaceConfig, lobbyName, numberVar, roomName, type PresenceEnv } from './env';

export { Lobby } from './lobby';
export { Room } from './room';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extra },
  });
}

interface RoomsBody {
  space: string;
  capacity: number;
  rooms: Array<{ room: number; n: number }>;
  recommended: number | null;
  now: number;
}

// 같은 Worker 인스턴스 안에서 몇 초 동안만 들고 있는 방 현황
const roomsCache = new Map<string, { at: number; body: RoomsBody }>();

async function loadRooms(env: PresenceEnv, spaceId: string): Promise<RoomsBody | null> {
  const cfg = getSpaceConfig(env, spaceId);
  if (!cfg) return null;
  const ttl = numberVar(env.ROOMS_CACHE_MS, 3000, 0);
  const cacheKey = `${spaceId}:${cfg.roomCount}:${cfg.maxRooms}:${cfg.capacity}`;
  const hit = roomsCache.get(cacheKey);
  if (hit && Date.now() - hit.at < ttl) return hit.body;
  const lobby = env.LOBBY.get(env.LOBBY.idFromName(lobbyName(spaceId)));
  const snap = await lobby.snapshot(cfg.roomCount, cfg.capacity, undefined, cfg.maxRooms);
  const body: RoomsBody = { space: spaceId, capacity: cfg.capacity, rooms: snap.rooms, recommended: snap.recommended, now: Date.now() };
  if (ttl > 0) roomsCache.set(cacheKey, { at: Date.now(), body });
  return body;
}

function originAllowed(env: PresenceEnv, request: Request): boolean {
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0) return true;
  const origin = request.headers.get('Origin');
  return origin !== null && allowed.includes(origin);
}

export default {
  async fetch(request: Request, env: PresenceEnv): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === '/health') {
      return json({ ok: true, now: Date.now() }, 200, { 'Cache-Control': 'no-store' });
    }

    if (url.pathname === '/rooms') {
      if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
      const spaceId = url.searchParams.get('space') ?? '';
      if (!spaceId) return json({ error: 'space-required' }, 400);
      const body = await loadRooms(env, spaceId);
      if (!body) return json({ error: 'unknown-space' }, 404);
      const ttlSec = Math.floor(numberVar(env.ROOMS_CACHE_MS, 3000, 0) / 1000);
      return json(body, 200, { 'Cache-Control': ttlSec > 0 ? `public, max-age=${ttlSec}` : 'no-store' });
    }

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected a WebSocket upgrade', { status: 426 });
      }
      if (!originAllowed(env, request)) return new Response('Origin not allowed', { status: 403 });

      const spaceId = url.searchParams.get('space') ?? '';
      const cfg = getSpaceConfig(env, spaceId);
      if (!cfg) return new Response('Unknown space', { status: 404 });

      const roomParam = url.searchParams.get('room');
      let room: number;
      if (roomParam === null || roomParam === '') {
        // 방 번호가 없으면 사람이 적당히 있는 방으로 보낸다
        const lobby = env.LOBBY.get(env.LOBBY.idFromName(lobbyName(spaceId)));
        const snap = await lobby.snapshot(cfg.roomCount, cfg.capacity, undefined, cfg.maxRooms);
        // 갈 곳이 없으면 1번 방으로 보낸다: 방이 room-full(rec: null)로 '꽉 찼다'고 알린다
        room = snap.recommended ?? 1;
      } else {
        room = /^\d{1,5}$/.test(roomParam) ? Number(roomParam) : 0;
        if (room < 1 || room > cfg.maxRooms) return new Response('Unknown room', { status: 404 });
      }

      const stub = env.ROOM.get(env.ROOM.idFromName(roomName(spaceId, room)));
      const forwarded = new Request(request);
      forwarded.headers.set('X-Qs-Space', spaceId);
      forwarded.headers.set('X-Qs-Room', String(room));
      return stub.fetch(forwarded);
    }

    return json({ error: 'not-found' }, 404);
  },
} satisfies ExportedHandler<PresenceEnv>;
