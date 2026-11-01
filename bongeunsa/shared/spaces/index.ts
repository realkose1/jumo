// 서버가 아는 공간 목록. id로 찾는다. 새 공간은 여기에 한 줄 더한다.
import { bongeunsa } from './bongeunsa';
import { testRoom } from './test-room';
import type { SharedSpace } from './types';

export type {
  SharedActionDef,
  SharedSpace,
  SharedStateDef,
  SharedWordList,
} from './types';

export const SHARED_SPACES: Readonly<Record<string, SharedSpace>> = {
  'test-room': testRoom,
  bongeunsa,
};

export { bongeunsa, testRoom };
export { seatRange } from './types';

export function getSharedSpace(id: string): SharedSpace | undefined {
  return Object.hasOwn(SHARED_SPACES, id) ? SHARED_SPACES[id] : undefined;
}
