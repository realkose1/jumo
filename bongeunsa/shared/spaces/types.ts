// 서버도 알아야 하는 공간 데이터. 3D, 소리, 화면 문구는 없다(그건 web의 SpaceDefinition).
export interface SharedWordList {
  adjectives: readonly string[];
  nouns: readonly string[];
}

export interface SharedActionDef {
  id: string;
  /** 말 없는 인사: 받는 사람에게 notice가 간다. 공간마다 정확히 하나 */
  greeting: boolean;
  /** 선물 동작이면 기기별 하루 제한(한국 시간 자정 기준으로 초기화) */
  gift?: { dailyLimit: number };
  /**
   * 이 동작에 변형(0 ~ variants-1)이 있다. 예: 메뉴 번호. 최대 16.
   * 서버는 `act.v`가 이 범위 안일 때만 받고(없으면 서버가 무작위로 정한다), 모두에게 같은 v를 전한다.
   * 변형이 없는 동작에 v가 오면 거절한다.
   */
  variants?: number;
  /** 같은 동작을 다시 할 수 있기까지(ms). 없으면 LIMITS.actCooldownMs. 화면은 이보다 조금 길게 잡아 서버가 먼저 거절하지 않게 한다 */
  cooldownMs?: number;
}

/** 사람마다 갖는 공간별 상태. 정수이고 min~max 안의 값만 받는다 */
export interface SharedStateDef {
  id: string;
  min: number;
  max: number;
}

export interface SharedSpace {
  id: string;
  capacityPerRoom: number;
  initialRoomCount: number;
  /** 방이 모두 차면 이 개수까지 방을 하나씩 더 연다. 없으면 initialRoomCount에서 늘리지 않는다 */
  maxRoomCount?: number;
  /**
   * 들어온 사람 이름 짓기. 기본은 '형용사 명사' 조합(ko, en).
   * list가 있으면 서버는 그 목록에서 한국어 이름만 통째로 고르고 en은 비운다(조합 단어는 list가 비었을 때만 쓴다).
   * list가 방에서 다 쓰이면 listAdjectives를 앞에 붙인다('조용한 OO'). 그것도 다 쓰여야 숫자를 붙인다.
   */
  nameWords: { ko: SharedWordList; en?: SharedWordList; list?: readonly string[]; listAdjectives?: readonly string[] };
  /** 앉을 수 있는 자리 id 전부. 화면의 SeatDef.id와 같아야 한다 */
  seatIds: readonly string[];
  /** 1, 2, 3 키 순서대로 */
  actions: readonly SharedActionDef[];
  greetingActionId: string;
  states: readonly SharedStateDef[];
}

/** 열 개씩 번호 붙인 자리 id를 만든다: seatRange('s', 3) -> s1, s2, s3 */
export function seatRange(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);
}
