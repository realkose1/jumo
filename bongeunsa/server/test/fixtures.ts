// 시험 전용 공간. 실제 공간 데이터(shared/spaces)에 기대지 않고 서버의 규칙을 모두 확인하려고 만든다:
// 변형이 있는 동작, 동작별 다시 하기 간격, 선물(인사 선물과 그냥 선물), 상태 키, 이름 목록, 방 더 열기.
// test/setup.ts가 SHARED_SPACES에 넣어 두므로 서버(Worker, Durable Object)도 이 공간을 안다.
import { SHARED_SPACES, seatRange, type SharedSpace } from '../../shared/spaces';

export const FIXTURE_NAMES: readonly string[] = ['연꽃', '풍경', '동자승', '다람쥐', '단풍', '목탁'];
export const FIXTURE_NAME_ADJECTIVES: readonly string[] = ['조용한', '느긋한', '아주 오래 기다린'];

export const fixture: SharedSpace = {
  id: 'fixture',
  capacityPerRoom: 24,
  initialRoomCount: 5,
  maxRoomCount: 12,
  nameWords: {
    list: FIXTURE_NAMES,
    listAdjectives: FIXTURE_NAME_ADJECTIVES,
    ko: { adjectives: ['맑은'], nouns: ['연잎'] },
  },
  seatIds: seatRange('s', 4),
  actions: [
    { id: 'wave', greeting: false },
    // 인사이면서 선물: 받을 사람이 있을 때만 하루 제한에서 하나 쓴다
    { id: 'bow', greeting: true, gift: { dailyLimit: 2 } },
    // 변형 8개, 다시 하기 4.5초
    { id: 'pick', greeting: false, variants: 8, cooldownMs: 4500 },
    // 인사가 아닌 선물: 늘 하루 제한에서 하나 쓴다
    { id: 'lantern', greeting: false, gift: { dailyLimit: 2 } },
  ],
  greetingActionId: 'bow',
  states: [
    { id: 'lamp', min: 0, max: 1 },
    { id: 'pose', min: 0, max: 3 },
  ],
};

/** SHARED_SPACES에 시험 공간을 넣는다(여러 번 불러도 같다) */
export function registerFixtures(): void {
  (SHARED_SPACES as Record<string, SharedSpace>)[fixture.id] = fixture;
}
