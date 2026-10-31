// 공간 등록은 이 목록 한 곳에서만 한다. 엔진은 여기를 모른다.
// 필요할 때만 불러와서(코드 분할) 첫 로딩을 가볍게 둔다.
// 정원, 이름 단어, 자리 id, 동작 id는 shared/spaces가 원본이고, 각 공간 모듈이 그걸 읽어 쓴다.
import { SHARED_SPACES, getSharedSpace } from '@shared/spaces';
import type { SpaceDefinition } from '../engine/types';

type SpaceModule = { default: SpaceDefinition };

const LOADERS: Record<string, () => Promise<SpaceModule>> = {
  jumak: () => import('./jumak'),
  // 엔진 시험용: 주소에 /test-room 을 붙이면 열린다
  'test-room': () => import('./test-room'),
};

/** 주소에 공간이 없을 때 열 공간 */
export const DEFAULT_SPACE_ID = 'jumak';

/** 화면이 만들어져 있는 공간 id 목록 */
export function listSpaceIds(): string[] {
  return Object.keys(LOADERS);
}

/** 서버와 화면이 함께 아는 공간 id 목록 (shared/spaces) */
export function listSharedSpaceIds(): string[] {
  return Object.keys(SHARED_SPACES);
}

export function hasSpace(id: string): boolean {
  return Object.hasOwn(LOADERS, id) && getSharedSpace(id) !== undefined;
}

export async function loadSpace(id: string): Promise<SpaceDefinition | null> {
  if (!hasSpace(id)) return null;
  const mod = await LOADERS[id]!();
  return mod.default;
}

/** 화면에 보여줄 공간 이름 (자료 정보 묶음 제목 등). 공간 모듈을 불러오지 않고도 쓸 수 있다. */
export const SPACE_LABELS: Readonly<Record<string, string>> = {
  jumak: '응원 주막',
  'test-room': '시험용 방',
};
