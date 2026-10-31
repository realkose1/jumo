// 주막 응원방. 모두가 한 공간(jumak)에 들어오고, 방이 차면 로비가 다음 방으로 나눈다.
// 평상 넷(a~d)에 방석 여섯씩. 자리의 3D 위치는 화면(web/src/spaces/jumak)이 정한다.
// 동작은 박수·건배·주문 셋뿐이고, 글자 대화는 없다. 건배가 인사 동작이다.
import { seatRange, type SharedSpace } from './types';
import { JUMAK_NAME_ADJECTIVES, JUMAK_NAMES } from './jumak-names';

/** 주문 메뉴. v번째 메뉴의 말풍선 글과 나오는 음식. 서버는 개수(8)만 알고, 글과 음식은 화면이 이 목록으로 그린다 */
export interface OrderMenuItem {
  /** 음식 모양 id (web/src/spaces/jumak/dishes.ts) */
  dish: string;
  /** 주문하는 사람 머리 위 말풍선 */
  line: string;
  /** 주모가 대답하는 말 (두 가지 중 하나) */
  replies: readonly [string, string];
}

export const ORDER_MENU: readonly OrderMenuItem[] = [
  { dish: 'gukbap', line: '주모! 여기 국밥 한 그릇 주쇼!', replies: ['뜨끈하게 말아 줄게요~', '네~ 국밥 갑니다!'] },
  { dish: 'pajeon', line: '주모! 파전 하나 부쳐 주쇼!', replies: ['바삭하게 부쳐 드릴게요~', '네~ 금방 부쳐요!'] },
  { dish: 'makgeolli', line: '주모! 막걸리 한 주전자 더!', replies: ['시원하게 한 주전자 갑니다~', '네~ 금방 나가요!'] },
  { dish: 'sundae', line: '주모! 순대 한 접시요!', replies: ['김이 폴폴 나는 걸로요~', '네~ 한 접시 갑니다!'] },
  { dish: 'kimchijeon', line: '주모! 여기 김치전 하나요!', replies: ['잘 익은 김치로 부칠게요~', '네~ 지글지글 갑니다!'] },
  { dish: 'dotorimuk', line: '주모! 도토리묵 한 접시 주쇼!', replies: ['탱탱한 묵으로 드릴게요~', '네~ 양념 듬뿍이요!'] },
  { dish: 'dubukimchi', line: '주모! 두부김치 하나 내주쇼!', replies: ['따끈한 두부 올려요~', '네~ 볶음김치도 듬뿍!'] },
  { dish: 'bindaetteok', line: '주모! 빈대떡 한 장 부쳐 줘요!', replies: ['노릇하게 부쳐 줄게요~', '네~ 금방 나가요!'] },
];


export const jumak: SharedSpace = {
  id: 'jumak',
  capacityPerRoom: 24,
  initialRoomCount: 5,
  maxRoomCount: 12, // 다 차면 방을 더 연다(24명 x 12 = 288명). SPACE_OVERRIDES의 maxRooms로 바꾼다
  nameWords: {
    // 이름은 축구 선수 이름 말장난 목록에서 고른다('한반두', '디에고 말아도나'). 다 쓰이면 '화난 한반두'.
    list: JUMAK_NAMES,
    listAdjectives: JUMAK_NAME_ADJECTIVES,
    // 아래 '형용사 명사' 단어는 list가 비었을 때만 쓴다. 화면 쪽 타입도 이 단어를 받는다.
    ko: {
      // 따뜻하고 신나는 말만. 놀리거나 깎아내리는 말은 넣지 않는다.
      adjectives: [
        '신난', '목청 큰', '들뜬', '설레는', '의리 있는',
        '흥 많은', '씩씩한', '든든한', '다정한', '반가운',
        '기운 찬', '해맑은', '뜨거운', '두근대는', '유쾌한',
        '듬직한', '싱글벙글', '부지런한', '넉살 좋은', '정 많은',
        '웃음 많은', '힘찬', '열띤', '훈훈한', '박수 치는',
        '노래하는', '어깨춤 추는', '눈 반짝이는', '마음 넓은', '한결같은',
      ],
      nouns: [
        '파전', '막걸리', '도토리묵', '주전자', '응원단',
        '빈대떡', '동동주', '국밥', '두부김치', '사발',
        '호롱불', '평상', '꽹과리', '북채', '징',
        '깃발', '응원봉', '골뱅이', '메밀전', '감자전',
        '누룽지', '식혜', '수정과', '보름달', '장독대',
        '나그네', '단골손님', '꽃게', '군고구마', '떡꼬치',
      ],
    },
  },
  // 평상 a~d, 방석 1~6
  seatIds: [...seatRange('a', 6), ...seatRange('b', 6), ...seatRange('c', 6), ...seatRange('d', 6)],
  actions: [
    { id: 'clap', greeting: false }, // 박수
    { id: 'toast', greeting: true }, // 건배: 가장 가까운 사람에게 한 줄 알림
    // 주문: 주모에게 "여기 국밥 한 그릇 주쇼!" 하고 외친다. 메뉴는 아래 ORDER_MENU의 번호(v)로 모두에게 같다
    { id: 'order', greeting: false, variants: 8, cooldownMs: 4500 },
  ],
  greetingActionId: 'toast',
  states: [],
  feed: true,
};
