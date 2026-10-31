// docs/engine.md 1장의 SpaceDefinition과 관련 타입.
// 공간마다 src/spaces/<id>/index.ts에서 SpaceDefinition 하나를 내보내면 엔진이 그대로 돌린다.
import type * as THREE from 'three';
import type { QualitySettings } from './quality';
import type { SoundMixer } from './sound';
import type { QuietClock } from './time';

export interface Localized {
  ko: string;
  en?: string;
}

export interface WordList {
  adjectives: readonly string[];
  nouns: readonly string[];
}

/** 1인 1석 자리. 좌표는 미터, 바닥이 y=0 */
export interface SeatDef {
  id: string;
  x: number;
  z: number;
  /** 앉는 면의 높이. 기본 0.42 */
  y?: number;
  /** 앉았을 때 바라보는 방향(yaw, 라디안). 0이면 +z를 본다 */
  facing: number;
  /** 걸어가서 멈추는 자리. 기본은 바라보는 쪽으로 0.75m 앞 */
  approach?: { x: number; z: number };
  /** 'chair'면 엔진이 기본 의자를 놓는다. 장면이 직접 그리면 'none' */
  visual?: 'chair' | 'none';
}

/**
 * 동작 때 캐릭터가 하는 몸짓. 캐릭터에는 팔이 없어서 뛰기, 기울이기, 늘어나기로 표현한다.
 * clap 잔 뜀박질(박수), toast 고개를 들어 기울이기(건배), roar 뒤로 젖히며 늘어나기(외치기: 주문),
 * celebrate 다 같이 신나게 뛰며 흔들기(골 순간)
 */
export type ActionMotion = 'hop' | 'hop-double' | 'hop-spin' | 'clap' | 'toast' | 'roar' | 'celebrate';

export interface ActionDef {
  id: string;
  label: Localized;
  /**
   * 다른 사람이 인사를 받았을 때 알림에 붙는 말("OO님이 ~"의 뒷부분). 예: '폴짝 인사했어요'.
   * 없으면 이름표를 써서 `${label}했어요`로 만든다(이름표가 '인사' 같은 명사일 때 자연스럽다).
   */
  notice?: Localized;
  motion: ActionMotion;
  /** 버튼에 쓸 그림 이름(src/ui/icons.ts의 ActionIconName)이나 이모지. 없으면 몸짓에 맞는 기본 그림 */
  icon?: string;
  /** 효과음 층에서 같이 낼 소리 id (파일이 없으면 무시) */
  soundId?: string;
  /**
   * 변형(0 ~ variants-1)이 있는 동작이면 개수. 누를 때 하나를 무작위로 골라 ActionEvent.variant로 알리고
   * 서버에 함께 보내서 방 모두가 같은 것을 본다 (주문의 메뉴). shared/spaces의 variants와 같아야 한다
   */
  variants?: number;
  /** 같은 동작을 다시 할 수 있기까지(ms). 없으면 기본 1초. 서버의 값(shared cooldownMs)보다 조금 길게 잡는다 */
  cooldownMs?: number;
}

/** 한 층의 소리 파일. loop는 계속 도는 소리, oneShots는 한 번 나는 소리 */
export interface SoundLayerDef {
  loop?: string;
  oneShots?: Record<string, string>;
  /** 파일 없이 장면이 WebAudio로 직접 소리를 만든다(SceneContext.sound로 연결). 설정 창이 '소리 없음'으로 보지 않게 한다 */
  synth?: boolean;
  /** 처음 소리를 켤 수 있게 되면 이 층을 바로 켠다. 기본은 꺼짐. 사용자가 직접 정한 값이 있으면 그걸 따른다 */
  defaultOn?: boolean;
  /** 기기에 저장된 값이 없을 때의 크기(0~1). 기본 0.7 */
  defaultVolume?: number;
}

export interface SoundLayers {
  ambient: SoundLayerDef;
  shared: SoundLayerDef;
  effects: SoundLayerDef;
}

export type ScheduleTrigger =
  | { type: 'minute-of-hour'; minute: number }
  | { type: 'time-of-day'; hour: number; minute: number }
  | { type: 'sunrise'; offsetMinutes?: number }
  | { type: 'sunset'; offsetMinutes?: number };

/** 한국 시간 기준 공동 순간 */
export interface ScheduleEvent {
  id: string;
  trigger: ScheduleTrigger;
  label?: Localized;
  /** 공동 소리 층에서 낼 소리 id */
  soundId?: string;
}

/** 나에게만 보이는 누적 */
export interface CounterDef {
  id: string;
  label: Localized;
  unit?: Localized;
}

/** 로딩 중 손장난. 그리는 건 UI 쪽이고, 엔진은 id만 전한다 */
export interface LoadingToyDef {
  id: string;
  label: Localized;
}

/**
 * 화면(UI) 모양을 공간마다 바꾸는 값. 모두 선택 항목이고, 없으면 UI의 기본값(밝은 톤)을 쓴다.
 * 값은 CSS 변수가 된다: accent -> --qs-accent, accentInk -> --qs-accent-ink. 자세한 규칙은 docs/design.md
 */
export interface SpaceUiTheme {
  /** 강조색: 인사 버튼 면, 켜진 스위치, 진행 막대, 선택 표시. 글자색으로는 직접 쓰지 않는다 */
  accent?: string;
  /** 강조색 면 위에 올리는 글자와 그림 색. accent와 4.5:1 이상이어야 한다 */
  accentInk?: string;
  /** 반투명 면(버튼 막대, 설정 버튼) */
  surface?: string;
  /** 블러를 못 쓰는 브라우저에서 대신 쓰는 더 진한 면 */
  surfaceSolid?: string;
  /** 설정 창 같은 큰 면 */
  surfaceStrong?: string;
  ink?: string;
  inkSoft?: string;
  line?: string;
  /** 모서리 둥글기. 예: '18px' */
  radius?: string;
  /** 뒤 배경 블러 세기. 예: '14px' */
  blur?: string;
  /** 설정 창 안의 카드와 보조 버튼 면 */
  card?: string;
  cardHover?: string;
  /** 설정 창 뒤를 덮는 막 */
  scrim?: string;
  /** 로딩 화면 바탕 */
  loadingBg?: string;
  /** 면의 그림자 */
  shadow?: string;
}

/** 걸을 수 있는 직사각형 영역 (x, z 범위) */
export interface WalkRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface SceneContext {
  readonly spaceId: string;
  readonly scene: THREE.Scene;
  readonly renderer: THREE.WebGLRenderer;
  /** 지금 장면을 보는 카메라 (읽기용: 카메라 가까이에 뜨는 효과를 줄이는 데 쓴다) */
  readonly camera: THREE.PerspectiveCamera;
  readonly clock: QuietClock;
  /** 이 매니저로 불러오면 로딩 진행률이 자동으로 반영된다 */
  readonly loadingManager: THREE.LoadingManager;
  /** 시작할 때의 성능 설정. 그림자 해상도 등에 쓴다 (나중에 바뀌면 엔진이 조명에 직접 반영) */
  readonly quality: QualitySettings;
  isReducedMotion(): boolean;
  /** 소리 섞는 곳. 장면이 파일 없이 WebAudio로 만든 소리를 층(환경음, 공동 소리, 효과음)에 이을 때 쓴다 */
  readonly sound: SoundMixer;
  /** 이 공간의 자산 경로를 만든다: assetUrl('a.glb') -> /assets/<공간id>/a.glb */
  assetUrl(path: string): string;
  /** 0~1. 직접 보고하고 싶을 때 (loadingManager와 같이 써도 된다) */
  reportProgress(fraction: number): void;
}

/** 장면이 정하는 기본 카메라(선택). 빠진 값은 엔진 기본값 */
export interface SceneCameraSettings {
  distance?: number;
  /** 세로로 긴 화면(휴대폰)에서 처음 잡을 거리. 좌우가 좁아서 더 물러나야 TV가 다 들어온다 */
  portraitDistance?: number;
  pitch?: number;
  minDistance?: number;
  maxDistance?: number;
  minPitch?: number;
  maxPitch?: number;
  /** 따라가는 점의 높이. 캐릭터가 서 있는 바닥(또는 앉은 자리)에서 위로 이만큼 */
  focusHeight?: number;
  /** 앉으면 카메라가 이 점(예: TV)이 캐릭터 너머로 보이는 쪽으로 부드럽게 돌아간다 */
  lookAt?: { x: number; z: number };
}

export interface SceneHandle {
  spawn: { x: number; z: number; yaw: number };
  bounds: WalkRect;
  /** 지나갈 수 없는 상자들 (선택) */
  blockers?: WalkRect[];
  /** (x, z)에서 서 있는 바닥 높이. 평상 위를 걸을 때 캐릭터가 올라가게 한다. 없으면 모두 0 */
  groundHeight?(x: number, z: number): number;
  camera?: SceneCameraSettings;
  /** 장면이 화면(UI)이나 컨트롤러에게 열어 주는 기능. 모양은 공간마다 다르고 Engine.getSceneApi()로 꺼낸다 */
  api?: unknown;
  update?(dt: number, elapsed: number): void;
  dispose(): void;
}

export interface SpaceDefinition {
  id: string; // 엔진에 공간 이름을 하드코딩하지 않는다
  title: Localized;
  capacityPerRoom: number;
  initialRoomCount: number;
  nameWords: { ko: WordList; en?: WordList };
  avatarOutfit: string;
  seats: SeatDef[];
  actions: [ActionDef, ActionDef, ActionDef]; // 1, 2, 3 키
  greetingActionId: string;
  sound: SoundLayers;
  schedule: ScheduleEvent[];
  personalCounters: CounterDef[];
  loadingToy: LoadingToyDef;
  /** 화면(UI) 색과 크기. 없으면 기본값 */
  theme?: SpaceUiTheme;
  loadScene(ctx: SceneContext): Promise<SceneHandle>;
}
