// 1단계 시험용 공간. web/src/spaces/test-room/index.ts의 값과 맞춘다.
import type { SharedSpace } from './types';

export const testRoom: SharedSpace = {
  id: 'test-room',
  capacityPerRoom: 50,
  initialRoomCount: 10,
  nameWords: {
    ko: {
      adjectives: ['조용한', '포근한', '느긋한', '말랑한', '차분한', '졸린'],
      nouns: ['회색곰', '구름', '두부', '조약돌', '오리', '찻잔'],
    },
  },
  seatIds: ['a1', 'a2', 'a3', 'b1', 'b2', 'c1'],
  actions: [
    { id: 'hop-small', greeting: false },
    { id: 'hop-twice', greeting: false },
    { id: 'hop-greet', greeting: true },
  ],
  greetingActionId: 'hop-greet',
  states: [],
};
