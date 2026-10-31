// 서버 소식을 화면 문구로 바꾸는 순수 함수들 (문구는 strings.ts)
import type { LocalizedName } from '@shared/protocol';
import { displayName } from '../engine/net/names';
import type { PresenceStatus } from '../engine/net/PresenceClient';
import type { ActionDef } from '../engine/types';
import { S } from './strings';

/** "OO님이 폴짝 인사했어요". 동작의 notice 문구가 있으면 그걸, 없으면 이름표로 `${이름표}했어요`를 만든다 */
export function greetedText(actions: readonly ActionDef[], actionId: string, from: LocalizedName): string {
  const name = displayName(from);
  const def = actions.find((a) => a.id === actionId);
  if (!def) return S.notice.greetedFallback(name);
  const phrase = def.notice?.ko ?? `${def.label.ko}했어요`;
  return S.notice.greeted(name, phrase);
}

export type NetPillTone = 'online' | 'pending' | 'solo';

/** 왼쪽 위 알약의 글자와 색조. peerCount는 나를 뺀 같은 방 사람 수 */
export function netPill(status: PresenceStatus, peerCount: number): { text: string; tone: NetPillTone } {
  switch (status) {
    case 'online':
      return { text: S.net.people(Math.max(0, peerCount) + 1), tone: 'online' };
    case 'connecting':
      return { text: S.net.connecting, tone: 'pending' };
    case 'reconnecting':
      return { text: S.net.reconnecting, tone: 'pending' };
    case 'full':
      return { text: S.net.full, tone: 'solo' };
    case 'denied':
      return { text: S.net.denied, tone: 'solo' };
    case 'replaced':
      return { text: S.net.replaced, tone: 'solo' };
    default:
      return { text: S.net.solo, tone: 'solo' };
  }
}
