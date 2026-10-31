// 주소 읽기: /<공간id>?room=<방>&timeOffset=<분>&quality=<등급>
import { parseTimeOffsetMinutes } from './engine/time';
import { parseTier, type QualityTier } from './engine/quality';

export interface Route {
  spaceId: string;
  room: string | null;
  timeOffsetMinutes: number;
  quality: QualityTier | null;
}

export function parseRoute(pathname: string, search: string, defaultSpaceId: string): Route {
  const first = pathname.split('/').find((part) => part.length > 0) ?? '';
  let spaceId = first;
  try {
    spaceId = decodeURIComponent(first);
  } catch {
    /* 깨진 주소는 그대로 둔다: 못 찾는 공간으로 처리된다 */
  }
  const params = new URLSearchParams(search);
  const room = params.get('room')?.trim();
  return {
    spaceId: spaceId === '' ? defaultSpaceId : spaceId.toLowerCase(),
    room: room ? room : null,
    timeOffsetMinutes: parseTimeOffsetMinutes(params),
    quality: parseTier(params.get('quality')),
  };
}

/** 배포 기준 경로(예: /cheer/)를 떼고 돌려준다. 공간 id는 그다음 첫 조각이다. 기준 경로가 없으면 그대로. */
export function stripBase(pathname: string, base: string): string {
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base;
  if (!prefix || !pathname.startsWith(prefix)) return pathname;
  const rest = pathname.slice(prefix.length);
  if (rest === '') return '/';
  return rest.startsWith('/') ? rest : pathname;
}
