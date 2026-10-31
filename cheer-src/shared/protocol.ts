// 화면(web)과 서버(server)가 주고받는 메시지 규약.
// docs/engine.md 3장 '메시지 규약'과 같은 내용이다. 바꾸면 문서도 같이 고친다.
// 모든 메시지는 JSON 텍스트 한 덩어리이고, 종류는 `t` 필드로 구분한다.
// 사용자가 쓴 글자는 어느 방향에도 없다. 이름은 서버가 단어 목록에서 붙이고, 모든 문자열 필드는 정해진 id뿐이다.
// (feed, moment의 글자는 서버가 주모 경기 피드에서 만든 것이다. 사용자가 쓴 글자가 아니다.)
import type { CheerFeed, Moment } from './cheer';

export type { CheerFeed, Moment } from './cheer';

export const PROTOCOL_VERSION = 1;

/** 방 안에서 사람을 가리키는 번호. 서버가 들어온 순서대로 붙이고, 같은 방 안에서 다시 쓰지 않는다 */
export type PeerId = number;

/** 언어별 이름. ko는 항상 있고 en은 영어를 함께 제공하는 공간(고궁)에만 있다 */
export interface LocalizedName {
  ko: string;
  en?: string;
}

/** 방 안의 한 사람. x, z는 미터, r은 바라보는 방향(라디안, -π~π) */
export interface PeerInfo {
  id: PeerId;
  name: LocalizedName;
  x: number;
  z: number;
  r: number;
  /** 공간별 상태 값(예: 스탠드 켬 lamp=1). 값이 없으면 생략 */
  st?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// 클라이언트 → 서버
// ---------------------------------------------------------------------------

/** 연결 직후 5초 안에 첫 메시지로 보낸다. 이게 없거나 틀리면 서버가 닫는다 */
export interface JoinMsg {
  t: 'join';
  /** 주소의 공간 id와 같아야 한다 */
  space: string;
  /** 주소의 방 번호와 같아야 한다. 방 번호 없이 연결했다면 생략 */
  room?: number;
  /** 기기 식별값. 기기에 한 번 무작위로 만들어 저장해 둔다. 8~64자, 영문 숫자 - _ 만 */
  dev: string;
  /** 처음 서 있는 곳(장면의 spawn). 없으면 0 */
  x?: number;
  z?: number;
  r?: number;
}

/** 움직일 때만, 초당 최대 limits.moveHz번(4). 앉아 있는 중에 보내면 서버가 일어난 것으로 본다 */
export interface MoveMsg {
  t: 'move';
  x: number;
  z: number;
  r: number;
}

export interface SitMsg {
  t: 'sit';
  seat: string;
}

export interface StandMsg {
  t: 'stand';
}

export interface ActMsg {
  t: 'act';
  /** 공간 데이터(shared/spaces)의 동작 id */
  act: string;
  /** 인사 동작에서 받을 사람. 없으면 서버가 가장 가까운 사람을 고른다 */
  to?: PeerId;
  /**
   * 동작의 변형 번호(0~15). 변형이 있는 동작(shared의 SharedActionDef.variants)에서만 보낸다.
   * 예: 주문의 메뉴 번호. 모두가 같은 글을 보도록 보내는 쪽이 정해서 보내고, 서버는 범위만 확인해 그대로 전한다.
   */
  v?: number;
}

/** 공간별 상태 변화. key는 공간 데이터의 states id, val은 그 범위의 정수. 초당 최대 2번 */
export interface StateMsg {
  t: 'state';
  key: string;
  val: number;
}

/** c는 보낸 쪽 시각(ms)이고 pong에 그대로 돌아온다 */
export interface PingMsg {
  t: 'ping';
  c?: number;
}

export type ClientMsg = JoinMsg | MoveMsg | SitMsg | StandMsg | ActMsg | StateMsg | PingMsg;
export type ClientMsgType = ClientMsg['t'];

// ---------------------------------------------------------------------------
// 서버 → 클라이언트
// ---------------------------------------------------------------------------

/** 서버가 알려주는 제한. 화면도 이 값에 맞춰 보내야 버려지지 않는다 */
export interface Limits {
  moveHz: number;
  stateHz: number;
  actCooldownMs: number;
}

export interface WelcomeMsg {
  t: 'welcome';
  /** 내 번호와 이름 */
  id: PeerId;
  name: LocalizedName;
  space: string;
  room: number;
  capacity: number;
  /** 나를 뺀 지금 방 사람들 */
  peers: PeerInfo[];
  /** 앉아 있는 자리: 자리 id -> 앉은 사람(나는 아직 안 앉았다) */
  seats: Record<string, PeerId>;
  /** 서버 시각(ms, Date.now와 같은 기준). 시간 보정에 쓴다 */
  now: number;
  limits: Limits;
}

export interface PeerJoinMsg {
  t: 'peer-join';
  peer: PeerInfo;
}

export interface PeerLeaveMsg {
  t: 'peer-leave';
  id: PeerId;
}

/** 여러 사람의 위치를 모은 묶음. [id, x, z, r] 배열. 초당 5~10번. 움직임이 없으면 오지 않는다 */
export interface PeerMoveMsg {
  t: 'peer-move';
  now: number;
  p: Array<[PeerId, number, number, number]>;
}

/** id가 null이면 그 자리가 비었다 */
export interface SeatMsg {
  t: 'seat';
  seat: string;
  id: PeerId | null;
}

/** 누가 무슨 동작을 했는지. 보낸 사람에게도 돌아온다 */
export interface ActEventMsg {
  t: 'act';
  id: PeerId;
  act: string;
  /** 인사 동작이면 서버가 정한 받는 사람(없으면 생략) */
  to?: PeerId;
  /** 변형이 있는 동작이면 그 번호(보낸 사람이 안 보냈으면 서버가 정해서 모두에게 같은 값을 준다) */
  v?: number;
  /** 보낸 사람에게만: 선물 동작의 오늘 남은 횟수 */
  left?: number;
}

/** 인사 알림 한 줄을 띄우라는 신호. 받는 사람에게만 간다. 문장은 화면이 만든다("OO님이 ~했어요") */
export interface NoticeMsg {
  t: 'notice';
  kind: 'greeting';
  from: PeerId;
  name: LocalizedName;
  act: string;
}

/** 다른 사람의 상태가 바뀌었다 */
export interface StateEventMsg {
  t: 'state';
  id: PeerId;
  key: string;
  val: number;
}

/** 정원이 찼다. 이 메시지 뒤에 서버가 연결을 닫는다(코드 4002) */
export interface RoomFullMsg {
  t: 'room-full';
  /** 추천 방 번호. 갈 곳이 없으면 null */
  rec: number | null;
}

export interface PongMsg {
  t: 'pong';
  c?: number;
  /** 서버 시각(ms) */
  now: number;
}

export type ErrorCode =
  | 'bad-request' // 모양이나 값이 틀렸다(모르는 자리, 모르는 동작, 범위 밖 값)
  | 'rate-limited' // 너무 자주 보냈다. 그 메시지는 버려졌다
  | 'seat-taken' // 이미 다른 사람이 앉은 자리
  | 'daily-limit' // 오늘 보낼 수 있는 선물을 다 썼다
  | 'no-target'; // 받을 사람이 방에 없다

export interface ErrorMsg {
  t: 'error';
  code: ErrorCode;
  /** 어떤 메시지에 대한 답인지 */
  ref?: ClientMsgType;
}

/**
 * 주막 TV에 띄울 경기 피드(주모 /api/cheer-feed). 피드가 바뀔 때마다 방 모두에게,
 * 새로 들어온 사람에게는 welcome 바로 뒤에 한 번 온다. 피드를 쓰지 않는 공간에는 오지 않는다.
 */
export interface FeedMsg {
  t: 'feed';
  feed: CheerFeed;
}

/** 경기에서 일이 났다(시작, 골, 실점, 끝). 방 모두가 같은 순간(m.at, 서버 시각)에 반응한다. 같은 m.id는 한 번만 온다 */
export interface MomentMsg {
  t: 'moment';
  m: Moment;
}

export type ServerMsg =
  | WelcomeMsg
  | PeerJoinMsg
  | PeerLeaveMsg
  | PeerMoveMsg
  | SeatMsg
  | ActEventMsg
  | NoticeMsg
  | StateEventMsg
  | RoomFullMsg
  | PongMsg
  | ErrorMsg
  | FeedMsg
  | MomentMsg;

// ---------------------------------------------------------------------------
// 연결 닫기 코드 (WebSocket close code)
// ---------------------------------------------------------------------------

export const CLOSE = {
  /** 같은 기기가 같은 방에 다시 들어와서 이전 연결을 닫았다. 다시 연결하지 말 것 */
  replaced: 4001,
  /** 정원 초과(room-full을 먼저 보낸다) */
  roomFull: 4002,
  /** 같은 IP에서 이 방에 연 연결이 너무 많다 */
  tooManyFromIp: 4003,
  /** 첫 join이 없거나 틀렸다 */
  badJoin: 4004,
  /** 잘못된 메시지나 너무 잦은 메시지가 계속됐다 */
  abuse: 4005,
} as const;

// ---------------------------------------------------------------------------
// 공통 상수
// ---------------------------------------------------------------------------

/** 동작 변형 번호의 상한(0~15). 서버는 변형이 있는 동작이 선언한 개수 안의 값만 받는다 */
export const MAX_ACT_VARIANTS = 16;

export const LIMITS: Limits = { moveHz: 4, stateHz: 2, actCooldownMs: 1000 };

/** 메시지 한 개의 최대 길이(글자 수). 이보다 길면 버린다 */
export const MAX_MESSAGE_CHARS = 512;

/** 좌표 절댓값 상한(미터). 넘으면 무시한다 */
export const MAX_COORD = 500;

/** 기기 식별값 모양 */
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
