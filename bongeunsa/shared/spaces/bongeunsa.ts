// 봉은사: 서울 강남 한복판, 빌딩 숲 사이의 절 마당을 함께 거니는 공간.
// 진여문으로 들어와 법왕루 아래를 지나 대웅전 앞마당에 이르고, 서쪽에는 미륵대불, 동쪽에는 범종각이 있다.
// 자리: 대웅전 앞 방석(d1~d12), 미륵대불 앞 방석(m1~m8), 범종각 옆 나무 의자(b1~b6). 3D 위치는 화면(web/src/spaces/bongeunsa)이 정한다.
// 동작은 합장(인사), 목탁, 연등 셋. 글자 대화는 없다.
import { seatRange, type SharedSpace } from './types';

/** 연등 색 가짓수. 연등 동작의 변형(v)이 색 번호다(화면의 LANTERN_COLORS와 같은 개수) */
export const LANTERN_VARIANTS = 6;

export const bongeunsa: SharedSpace = {
  id: 'bongeunsa',
  capacityPerRoom: 40,
  initialRoomCount: 5,
  maxRoomCount: 20,
  nameWords: {
    ko: {
      // 고요하고 따뜻한 말만
      adjectives: [
        '고요한', '맑은', '느긋한', '다정한', '포근한',
        '차분한', '평온한', '은은한', '산뜻한', '너그러운',
        '향기로운', '반가운', '정겨운', '해맑은', '온화한',
        '사뿐한', '단정한', '수수한', '싱그러운', '따스한',
      ],
      nouns: [
        '연등', '풍경', '목탁', '연꽃', '동자',
        '은행잎', '솔방울', '다람쥐', '까치', '산새',
        '초롱', '죽비', '염주', '찻잔', '솔바람',
        '석등', '범종', '보리수', '단청', '새벽달',
      ],
    },
  },
  // 대웅전 앞 방석 12, 미륵대불 앞 방석 8, 범종각 옆 나무 의자 6
  seatIds: [...seatRange('d', 12), ...seatRange('m', 8), ...seatRange('b', 6)],
  actions: [
    { id: 'hapjang', greeting: true }, // 합장: 두 손을 모으고 고개 숙여 인사. 가장 가까운 사람에게 한 줄 알림
    { id: 'moktak', greeting: false }, // 목탁: 똑똑똑
    // 연등: 머리 위로 등 하나가 떠올라 하늘로 오른다. 색은 v번(0~5)으로 방 모두에게 같다
    { id: 'lantern', greeting: false, variants: LANTERN_VARIANTS, cooldownMs: 4000 },
  ],
  greetingActionId: 'hapjang',
  states: [],
};
