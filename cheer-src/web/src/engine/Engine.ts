// 공통 엔진: 렌더러, 장면, 그리기 반복, 입력, 캐릭터, 자리, 동작, 소리를 묶는다.
// 공간 이름은 모른다. SpaceDefinition 하나를 받아 그대로 돌린다.
//
// UI가 쓰는 공개 API (src/ui/ 에서 붙인다):
//   engine.space                       현재 공간 정의
//   engine.room / engine.clock / engine.storage
//   engine.runAction(actionId)         동작 실행 (1초 1회 제한), 실행했으면 true
//   engine.runActionByKey(1|2|3)
//   engine.getActionCooldownMs(id)     다시 쓸 수 있을 때까지 남은 ms
//   engine.sound                       소리 세 층 제어 (SoundMixer)
//   engine.getReducedMotion() / setReducedMotion(true|false|null)   null이면 기기 설정을 따름
//   engine.getReducedMotionPreference()   사용자가 직접 고른 값 (true | false | null=기기 설정 따르기)
//   engine.getQuality() / setQuality(tier)
//   engine.setInputEnabled(false)      설정 창이 열려 있는 동안 키/누르기 입력을 끈다
//   engine.setVirtualMove(x, y)        화면 조이스틱: 카메라 기준 방향과 세기 (x 오른쪽 +1, y 앞 +1, 길이 1 이하가 곧 빠르기). (0, 0)이면 멈춤
//   engine.isReady() / whenReady() / getLoadingProgress()
//   engine.getSeatId() / standUp()
//   engine.getNetState()               서버 연결 상태, 방 번호, 내 이름 (서버가 없으면 status 'idle'/'offline', 혼자 모드)
//   engine.getPeerCount()              같은 방의 다른 사람 수 ('peer-count' 이벤트로도 온다)
//   engine.getSceneApi<T>()            장면이 열어 준 기능 (SceneHandle.api)
//   engine.getHeadAnchor(who, out)     머리 위 좌표 (who: 'self' 또는 사람 번호). 이모지 같은 효과를 띄울 곳
//   engine.celebrateAll(maxDelay)      나와 방 사람 모두가 같은 순간에 '다 같이 신남' 몸짓을 한다
//   engine.isSeatTaken(id) / sitAtSeat(id)   자리가 찼는지, 그 자리로 걸어가 앉기
//   engine.getSpot(who)                서 있는 곳과 앉은 자리 (음식을 놓을 곳)
//   engine.projectToScreen(p, out)     3D 좌표 -> 화면 픽셀 (말풍선처럼 화면 요소를 3D 위치에 붙일 때)
//   engine.on(type, handler)           이벤트 구독, 해제 함수를 돌려준다 (아래 EngineEventMap)
import * as THREE from 'three';
import { ActionController, type ActionEvent } from './actions';
import { AVATAR_HEIGHT, Avatar, disposeAvatarResources } from './avatar';
import { CameraRig } from './camera';
import { Emitter, type Unsubscribe } from './events';
import { InputController } from './input';
import { NetSession, type NetEventMap } from './net/session';
import { getDeviceId } from './net/deviceId';
import { parseRoomNumber } from './net/room';
import type { PresenceStatus } from './net/PresenceClient';
import { PeerLabeler } from './peerLabel';
import { Player } from './player';
import {
  FrameMonitor,
  detectTier,
  lowerTier,
  qualitySettings,
  type QualitySettings,
  type QualityTier,
} from './quality';
import { LocalSeatArbiter, SeatManager, type SeatArbiter, type SeatDenial } from './seats';
import { SoundMixer, type SoundState } from './sound';
import { SpaceStorage } from './storage';
import { QuietClock } from './time';
import type { SceneContext, SceneHandle, SpaceDefinition } from './types';

export interface EngineEventMap extends NetEventMap {
  /** 장면 불러오는 중. progress는 0~1이고 줄어들지 않는다 */
  'loading-progress': { progress: number };
  /** 장면이 준비되어 조작할 수 있다 */
  ready: { space: SpaceDefinition };
  /** 동작이 실행됐다 (버튼 UI 표시, 나중에 서버 전송) */
  action: ActionEvent;
  /** 내가 앉았거나(자리 id) 일어났다(null) */
  'seat-change': { seatId: string | null };
  /** 앉지 못했다. occupied는 눌렀을 때 이미 누가 앉아 있던 경우(조용히 넘긴다), taken은 서버가 다른 사람에게 준 경우 */
  'seat-denied': { seatId: string; reason: SeatDenial };
  /** 같은 방의 다른 사람 수가 바뀌었다 (나는 빼고 센다) */
  'peer-count': { count: number };
  'reduced-motion-change': { enabled: boolean; source: 'system' | 'user' };
  /** 설정 창 등이 키/누르기 입력을 끄거나 켰다 (화면 조이스틱이 손을 놓은 것으로 돌아가는 데 쓴다) */
  'input-enabled': { enabled: boolean };
  'quality-change': { settings: QualitySettings; auto: boolean };
  'sound-change': SoundState;
  error: { message: string; cause?: unknown };
}

export interface EngineOptions {
  /** 캔버스를 넣을 요소 */
  container: HTMLElement;
  space: SpaceDefinition;
  /** ?room= 값. 서버에 들어갈 방 번호로 쓴다(숫자가 아니면 서버가 정한다) */
  room?: string | null;
  /** 실시간 서버 주소(예: ws://localhost:8797). 없거나 비어 있으면 서버 없이 혼자 모드 */
  presenceUrl?: string | null;
  /** ?timeOffset= (분) */
  timeOffsetMinutes?: number;
  /** 지정하면 고정(?quality=), 없으면 기기를 보고 정하고 느려지면 스스로 낮춘다 */
  quality?: QualityTier | null;
  /** 앉아도 되는지 판정하는 쪽. 기본은 이 기기 안에서만 판정 */
  seatArbiter?: SeatArbiter;
  storage?: SpaceStorage;
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const DEFAULT_FOCUS_HEIGHT = 0.6;
/** 머리 위 효과가 뜨는 곳: 머리 꼭대기에서 이만큼 위 */
const HEAD_ANCHOR_RISE = 0.2; // 갓 위로 띄운다
const WATCHDOG_MS = 500;

export class Engine {
  readonly space: SpaceDefinition;
  readonly room: string | null;
  readonly clock: QuietClock;
  readonly storage: SpaceStorage;
  readonly sound: SoundMixer;

  private readonly events = new Emitter<EngineEventMap>();
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly rig = new CameraRig();
  private readonly input: InputController;
  private readonly actions: ActionController;
  private readonly arbiter: SeatArbiter;
  private readonly frameMonitor = new FrameMonitor();
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly projectTmp = new THREE.Vector3();
  private readonly resizeObserver: ResizeObserver;
  private readonly motionQuery: MediaQueryList | null;
  private readonly cleanups: Array<() => void> = [];

  private seats: SeatManager | null = null;
  private net: NetSession | null = null;
  private labeler: PeerLabeler | null = null;
  private hoverPoint: { x: number; y: number } | null = null;
  private readonly presenceUrl: string | null;
  private player: Player | null = null;
  private sceneHandle: SceneHandle | null = null;
  private focusHeight = DEFAULT_FOCUS_HEIGHT;
  private peerCount = 0;

  private quality: QualitySettings;
  private qualityFixed: boolean;
  private systemReduced = false;
  private userReduced: boolean | null;

  private started = false;
  private disposed = false;
  private ready = false;
  private progress = 0;
  private lastTime: number | null = null;
  private lastFrameWall = 0;
  private watchdog: number | undefined;
  private elapsed = 0;
  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (reason: unknown) => void;

  constructor(options: EngineOptions) {
    this.space = options.space;
    this.room = options.room ?? null;
    this.container = options.container;
    this.presenceUrl = options.presenceUrl?.trim() ? options.presenceUrl.trim() : null;
    this.storage = options.storage ?? new SpaceStorage(options.space.id);
    this.arbiter = options.seatArbiter ?? new LocalSeatArbiter();
    this.clock = new QuietClock({ timeOffsetMinutes: options.timeOffsetMinutes ?? 0 });
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.readyPromise.catch(() => undefined);

    // 성능 등급
    this.qualityFixed = options.quality != null;
    this.quality = qualitySettings(options.quality ?? detectTier());

    // 렌더러
    this.renderer = new THREE.WebGLRenderer({ antialias: this.quality.antialias });
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute('aria-label', options.space.title.ko);
    this.renderer.domElement.tabIndex = -1;
    this.container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x0b0b0d); // 장면이 자기 밤하늘로 바꿔도 된다

    // 움직임 줄이기: 사용자가 정한 값이 있으면 그것, 없으면 기기 설정
    const saved = this.storage.get<boolean | null>('reducedMotion', null);
    this.userReduced = typeof saved === 'boolean' ? saved : null;
    this.motionQuery = typeof matchMedia === 'function' ? matchMedia(REDUCED_MOTION_QUERY) : null;
    this.systemReduced = this.motionQuery?.matches ?? false;
    const onMotionChange = () => {
      this.systemReduced = this.motionQuery?.matches ?? false;
      if (this.userReduced === null) this.applyReducedMotion();
    };
    this.motionQuery?.addEventListener('change', onMotionChange);
    this.cleanups.push(() => this.motionQuery?.removeEventListener('change', onMotionChange));
    this.rig.setReducedMotion(this.getReducedMotion());

    // 입력
    this.input = new InputController(this.renderer.domElement);
    this.input.on('tap', (e) => this.onTap(e.clientX, e.clientY));
    this.input.on('look', (e) => this.rig.rotate(e.dx, e.dy));
    this.input.on('zoom', (e) => this.rig.zoomBy(e.factor));
    this.input.on('actionKey', (e) => this.runActionByKey(e.key));
    this.input.on('hover', (e) => {
      this.hoverPoint = { x: e.clientX, y: e.clientY };
    });
    this.input.on('hoverEnd', () => {
      this.hoverPoint = null;
      this.labeler?.setHover(null);
    });

    // 동작
    this.actions = new ActionController({
      actions: this.space.actions,
      greetingActionId: this.space.greetingActionId,
      perform: (def) => {
        this.player?.avatar.playMotion(def.motion);
        if (def.soundId) this.sound.playEffect(def.soundId);
      },
    });
    this.actions.onAction((e) => {
      this.events.emit('action', e);
      this.net?.sendAction(e.actionId, e.variant); // 같은 방 모두에게 보이게 한다 (서버가 없으면 아무 일도 없다)
    });

    // 소리
    this.sound = new SoundMixer(this.space.sound, {
      storage: this.storage,
      resolveUrl: (p) => this.assetUrl(p),
    });
    this.sound.onChange((s) => this.events.emit('sound-change', s));

    // 크기, 탭 숨김
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') this.stopLoop();
      else this.startLoop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));

    this.applyQuality();
    this.resize();
  }

  // ---- 시작과 끝 ----

  /** 장면을 불러오고 그리기를 시작한다. 구독(on)을 다 걸어 둔 뒤에 부른다. */
  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    this.startLoop(); // 장면을 먼저 깔아 두고(로딩 화면 뒤로 비친다) 준비되면 조작을 연다
    // rAF가 멈춰 있는 환경(가려진 창, 내장 미리보기 등)에서도 화면이 비지 않게 지켜보는 장치
    this.watchdog = window.setInterval(() => {
      if (this.disposed || document.visibilityState === 'hidden') return;
      if (performance.now() - this.lastFrameWall >= WATCHDOG_MS) this.frame(performance.now());
    }, WATCHDOG_MS);
    this.sound.installGestureUnlock();
    try {
      const handle = await this.space.loadScene(this.createSceneContext());
      if (this.disposed) {
        handle.dispose();
        return;
      }
      this.sceneHandle = handle;
      this.applySceneCamera(handle);
      this.seats = new SeatManager(this.scene, this.space.seats);
      this.net = this.createNet();
      if (this.net) {
        this.labeler = new PeerLabeler(this.net.peers, (labels) => this.events.emit('peer-labels', labels));
        this.net.peers.setGroundHeight(handle.groundHeight ?? null);
      }
      const avatar = new Avatar({
        detail: 'self',
        outfit: this.space.avatarOutfit,
        reducedMotion: this.getReducedMotion(),
      });
      // 서버가 붙여 준 내 번호로 차림(갓, 상투 등)을 고른다. 남들 화면에서도 같은 차림이다
      this.cleanups.push(this.on('self-name', ({ id }) => { if (id !== undefined) avatar.setLookFromId(id); }));
      this.player = new Player(avatar, this.seats, this.net?.arbiter ?? this.arbiter, this.scene, {
        onSeatChange: (seatId) => {
          if (seatId) this.aimCameraFromSeat(seatId);
          this.events.emit('seat-change', { seatId });
        },
        onSeatDenied: (seatId, reason) => {
          this.seats?.markSeat(null);
          this.events.emit('seat-denied', { seatId, reason });
        },
      });
      this.player.setWalkArea(handle.bounds, handle.blockers);
      this.player.setGroundHeight(handle.groundHeight ?? null);
      this.player.setReducedMotion(this.getReducedMotion());
      this.player.teleport(handle.spawn.x, handle.spawn.z, handle.spawn.yaw);
      this.rig.resetBehind(handle.spawn.yaw);
      this.rig.setFollowTarget(handle.spawn.x, this.focusHeight, handle.spawn.z);
      this.rig.snapToTarget();
      this.applyQuality(); // 장면이 만든 조명에도 그림자 설정을 맞춘다
      this.startNet(); // 내가 선 자리가 정해진 뒤에 연결한다(join에 처음 위치를 싣는다)
      this.ready = true;
      this.setProgress(1);
      this.frame(performance.now()); // 첫 장면은 rAF를 기다리지 않고 바로 그린다
      this.events.emit('ready', { space: this.space });
      this.resolveReady();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '장면을 불러오지 못했어요';
      this.events.emit('error', { message, cause });
      this.rejectReady(cause);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopLoop();
    window.clearInterval(this.watchdog);
    this.resizeObserver.disconnect();
    for (const c of this.cleanups) c();
    this.input.dispose();
    this.sound.dispose();
    this.player?.dispose();
    this.net?.dispose();
    this.net = null;
    this.labeler?.clear();
    this.labeler = null;
    this.seats?.dispose();
    this.sceneHandle?.dispose();
    disposeAvatarResources();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.events.clear();
  }

  // ---- UI용 공개 API ----

  on<K extends keyof EngineEventMap>(type: K, handler: (payload: EngineEventMap[K]) => void): Unsubscribe {
    return this.events.on(type, handler);
  }

  isReady(): boolean {
    return this.ready;
  }

  /** 장면이 준비되면 풀린다 (이미 준비됐다면 바로) */
  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  getLoadingProgress(): number {
    return this.progress;
  }

  runAction(actionId: string): boolean {
    return this.actions.run(actionId);
  }

  runActionByKey(key: 1 | 2 | 3): boolean {
    return this.actions.runByKey(key);
  }

  getActionCooldownMs(actionId: string): number {
    return this.actions.cooldownRemaining(actionId);
  }

  getSeatId(): string | null {
    return this.player?.seatId ?? null;
  }

  standUp(): void {
    this.player?.standUp();
  }

  /** 같은 방의 다른 사람 수 (나는 빼고). 서버가 없으면 0 */
  getPeerCount(): number {
    return this.peerCount;
  }

  /** 장면이 열어 준 기능(SceneHandle.api). 아직 장면이 준비되지 않았으면 null. 타입은 부르는 쪽이 정한다 */
  getSceneApi<T>(): T | null {
    return (this.sceneHandle?.api as T | undefined) ?? null;
  }

  /** 머리 위에 효과를 띄울 좌표. who는 'self'(나) 또는 사람 번호. 나가는 중이거나 모르면 null */
  getHeadAnchor(who: 'self' | number, out: THREE.Vector3): THREE.Vector3 | null {
    if (who === 'self') {
      const p = this.player;
      if (!p) return null;
      return out.set(p.position.x, p.avatar.root.position.y + AVATAR_HEIGHT + HEAD_ANCHOR_RISE, p.position.z);
    }
    return this.net?.peers.labelAnchor(who, out) ?? null;
  }

  /** 그 사람이 서 있는 곳과 앉은 자리 (음식을 어디에 놓을지 정할 때). who는 'self' 또는 사람 번호 */
  getSpot(who: 'self' | number): { x: number; z: number; yaw: number; seatId: string | null } | null {
    if (who === 'self') {
      const p = this.player;
      return p ? { x: p.position.x, z: p.position.z, yaw: p.heading, seatId: p.seatId } : null;
    }
    const peers = this.net?.peers;
    const at = peers?.positionOf(who);
    if (!peers || !at || !peers.has(who)) return null;
    return { x: at.x, z: at.z, yaw: at.yaw, seatId: peers.seatIdOf(who) };
  }

  /** 3D 좌표를 화면(뷰포트) 픽셀로. 카메라 뒤이거나 화면 밖이면 visible이 false다 */
  projectToScreen(point: THREE.Vector3, out: { x: number; y: number; visible: boolean }): typeof out {
    const v = this.projectTmp.copy(point).project(this.rig.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    out.x = rect.left + ((v.x + 1) / 2) * rect.width;
    out.y = rect.top + ((1 - v.y) / 2) * rect.height;
    out.visible = v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
    return out;
  }

  /** 나와 방 사람 모두가 같은 몸짓을 한다. maxDelay초 안에서 조금씩 어긋나 자연스럽다(움직임 줄이기면 모두 바로) */
  celebrateAll(maxDelay = 0.15): void {
    const reduced = this.getReducedMotion();
    this.player?.avatar.playMotion('celebrate', reduced ? 0 : Math.random() * maxDelay);
    this.net?.peers.playMotionAll('celebrate', maxDelay);
  }

  /** 그 자리에 다른 사람이 앉아 있는지 (서버 현황 기준). 자리 id를 모르면 true */
  isSeatTaken(seatId: string): boolean {
    if (!this.seats?.get(seatId)) return true;
    if (this.getSeatId() === seatId) return false;
    return this.net ? this.net.peers.seatOwner(seatId) !== null : false;
  }

  /** 그 자리로 걸어가서 앉는다. 자리를 모르거나 아직 준비 전이면 false */
  sitAtSeat(seatId: string): boolean {
    const seat = this.seats?.get(seatId);
    if (!seat || !this.player) return false;
    this.player.sitAt(seat);
    return true;
  }

  /** 서버 연결 상태와 방 번호, 서버가 붙여 준 내 이름. 서버가 없으면 status는 'idle' */
  getNetState(): {
    status: PresenceStatus;
    room: number | null;
    name: { ko: string; en?: string } | null;
    /** 방 안에서 내 번호 (연결 전에는 null) */
    id: number | null;
    /** status가 'denied'일 때 서버가 닫은 코드 */
    deniedCode: number | null;
  } {
    const c = this.net?.client;
    return { status: c?.status ?? 'idle', room: c?.currentRoom ?? null, name: c?.myName ?? null, id: c?.myId ?? null, deniedCode: c?.deniedCode ?? null };
  }

  /** 설정 창이 열려 있는 동안 끄면 키보드와 누르기가 장면으로 가지 않는다 */
  setInputEnabled(on: boolean): void {
    this.input.setEnabled(on);
    this.events.emit('input-enabled', { enabled: on });
  }

  /**
   * 화면 조이스틱 입력. x 오른쪽 +1, y 앞 +1(카메라가 보는 쪽 기준)이고, 길이 1이 최대 빠르기다.
   * 길이가 곧 빠르기라서 (0.5, 0)이면 천천히 걷는다. 앉아 있으면 일어나 걷고, (0, 0)이면 멈춘다.
   * 입력이 꺼져 있는 동안(설정 창)에는 무시한다.
   */
  setVirtualMove(x: number, y: number): void {
    this.input.setVirtualMove(x, y);
  }

  getReducedMotion(): boolean {
    return this.userReduced ?? this.systemReduced;
  }

  /** 사용자가 직접 고른 값. null이면 기기 설정을 따르는 중 (getReducedMotion은 실제로 적용되는 값) */
  getReducedMotionPreference(): boolean | null {
    return this.userReduced;
  }

  /** true/false는 사용자가 직접 정한 값(기기에 기억), null이면 기기의 '동작 줄이기' 설정을 따른다 */
  setReducedMotion(value: boolean | null): void {
    this.userReduced = value;
    if (value === null) this.storage.remove('reducedMotion');
    else this.storage.set('reducedMotion', value);
    this.applyReducedMotion();
  }

  getQuality(): QualitySettings {
    return { ...this.quality };
  }

  setQuality(tier: QualityTier): void {
    this.qualityFixed = true;
    this.quality = qualitySettings(tier);
    this.applyQuality();
    this.events.emit('quality-change', { settings: this.getQuality(), auto: false });
  }

  // ---- 안쪽 ----

  private assetUrl(path: string): string {
    const base = import.meta.env.BASE_URL ?? '/';
    return `${base}assets/${this.space.id}/${path.replace(/^\/+/, '')}`;
  }

  private createSceneContext(): SceneContext {
    const manager = new THREE.LoadingManager();
    manager.onProgress = (_url, loaded, total) => {
      if (total > 0) this.setProgress((loaded / total) * 0.95);
    };
    return {
      spaceId: this.space.id,
      scene: this.scene,
      renderer: this.renderer,
      camera: this.rig.camera,
      clock: this.clock,
      loadingManager: manager,
      sound: this.sound,
      quality: this.getQuality(),
      isReducedMotion: () => this.getReducedMotion(),
      assetUrl: (p) => this.assetUrl(p),
      reportProgress: (f) => this.setProgress(Math.min(f, 0.99)),
    };
  }

  /** 앉으면 장면이 정한 점(TV 등)이 캐릭터 너머로 보이게 카메라를 돌린다 */
  private aimCameraFromSeat(seatId: string): void {
    const look = this.sceneHandle?.camera?.lookAt;
    const seat = this.seats?.get(seatId);
    if (!look || !seat) return;
    this.rig.aimYaw(Math.atan2(seat.x - look.x, seat.z - look.z));
  }

  private applySceneCamera(handle: SceneHandle): void {
    const c = handle.camera;
    if (!c) return;
    if (c.focusHeight !== undefined) this.focusHeight = c.focusHeight;
    this.rig.configure({
      minDistance: c.minDistance,
      maxDistance: c.maxDistance,
      minPitch: c.minPitch,
      maxPitch: c.maxPitch,
      initialDistance: this.container.clientWidth < this.container.clientHeight ? (c.portraitDistance ?? c.distance) : c.distance,
      initialPitch: c.pitch,
    });
  }

  private setProgress(value: number): void {
    const next = Math.min(1, Math.max(this.progress, value));
    if (next === this.progress) return;
    this.progress = next;
    this.events.emit('loading-progress', { progress: next });
  }

  private applyReducedMotion(): void {
    const enabled = this.getReducedMotion();
    this.rig.setReducedMotion(enabled);
    this.player?.setReducedMotion(enabled);
    this.net?.setReducedMotion(enabled);
    this.events.emit('reduced-motion-change', {
      enabled,
      source: this.userReduced === null ? 'system' : 'user',
    });
  }

  private applyQuality(): void {
    const q = this.quality;
    const shadowsChanged = this.renderer.shadowMap.enabled !== q.shadows;
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatioCap));
    this.scene.traverse((obj) => {
      const light = obj as THREE.Light & { shadow?: THREE.LightShadow };
      if (light.isLight && light.shadow && q.shadows) {
        const size = q.shadowMapSize;
        if (light.shadow.mapSize.x !== size) {
          light.shadow.mapSize.set(size, size);
          light.shadow.map?.dispose();
          light.shadow.map = null;
        }
      }
      if (shadowsChanged) {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) m.needsUpdate = true;
        }
      }
    });
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.rig.setAspect(w / h);
    // 크기를 바꾸면 캔버스가 비워지므로, 그리기 반복이 멈춰 있어도 바로 다시 그린다
    if (this.ready) this.renderer.render(this.scene, this.rig.camera);
  }

  private rayAt(clientX: number, clientY: number): THREE.Ray {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.rig.camera);
    return this.raycaster.ray;
  }

  private onTap(clientX: number, clientY: number): void {
    if (!this.player || !this.seats) return;
    const ray = this.rayAt(clientX, clientY);
    // 사람을 눌렀으면 이름만 잠깐 보여준다(걸어가지 않는다)
    const peerId = this.net?.peers.pick(ray) ?? null;
    if (peerId !== null) {
      this.labeler?.tap(peerId, performance.now());
      return;
    }
    const seat = this.seats.pick(ray);
    if (seat) {
      // 누른 방석에 마커를 띄운다(앉으면, 다른 곳을 누르면, 자리가 막히면 사라진다)
      this.seats.markSeat(seat);
      this.player.sitAt(seat);
      return;
    }
    if (ray.direction.y >= -1e-4) return; // 하늘을 눌렀다
    this.seats.markSeat(null);
    const t = -ray.origin.y / ray.direction.y;
    this.player.walkTo(ray.origin.x + ray.direction.x * t, ray.origin.z + ray.direction.z * t);
  }

  private createNet(): NetSession | null {
    const url = this.presenceUrl;
    if (!url || !this.seats) return null;
    try {
      return new NetSession({
        space: this.space,
        scene: this.scene,
        seats: this.seats,
        clock: this.clock,
        url,
        room: parseRoomNumber(this.room),
        deviceId: getDeviceId(),
        reducedMotion: this.getReducedMotion(),
        host: {
          emit: (type, payload) => this.events.emit(type, payload as never),
          getSelf: () => {
            const p = this.player;
            if (!p) return { x: 0, z: 0, yaw: 0, seatId: null };
            return { x: p.position.x, z: p.position.z, yaw: p.heading, seatId: p.seatId };
          },
          standUp: () => this.player?.standUp(),
          abortSeat: (seatId) => this.player?.abortSeatIntent(seatId),
        },
      });
    } catch (cause) {
      // 서버 쪽을 못 만들어도 화면은 혼자 모드로 돈다
      console.warn('[net] 실시간 연결을 준비하지 못했어요. 혼자 모드로 갈게요.', cause);
      return null;
    }
  }

  private startNet(): void {
    try {
      this.net?.start();
    } catch (cause) {
      console.warn('[net] 실시간 연결을 시작하지 못했어요. 혼자 모드로 갈게요.', cause);
    }
  }

  private trackPeerCount(): void {
    const count = this.net?.peers.activeCount ?? 0;
    if (count === this.peerCount) return;
    this.peerCount = count;
    this.events.emit('peer-count', { count });
  }

  /** 마우스를 올려 둔 곳에 사람이 있으면 이름표 대상으로 알린다 */
  private updateHover(): void {
    if (!this.net || !this.labeler || !this.hoverPoint) return;
    const ray = this.rayAt(this.hoverPoint.x, this.hoverPoint.y);
    this.labeler.setHover(this.net.peers.pick(ray));
  }

  private startLoop(): void {
    if (this.disposed || !this.started) return;
    this.lastTime = null;
    this.frameMonitor.reset();
    this.renderer.setAnimationLoop(this.frame);
  }

  private stopLoop(): void {
    this.renderer.setAnimationLoop(null);
  }

  private readonly frame = (time: number): void => {
    this.lastFrameWall = performance.now();
    const raw = this.lastTime === null ? 0 : (time - this.lastTime) / 1000;
    this.lastTime = time;
    const dt = Math.min(raw, 0.1);
    this.elapsed += dt;

    if (this.player) {
      this.player.update(dt, this.input.getMoveVector(), this.rig.yaw);
      // 방석 마커: 앉았거나(자리 id가 생김) 조이스틱·키로 걸어 나가면 거둔다
      const marked = this.seats?.markedSeatId ?? null;
      const mv = this.input.getMoveVector();
      if (marked && (this.player.seatId === marked || mv.x * mv.x + mv.y * mv.y > 0.01)) this.seats?.markSeat(null);
      this.seats?.update(dt, this.getReducedMotion());
      const p = this.player.position;
      // 평상 위나 자리에 앉았을 때는 캐릭터와 함께 시선도 올라간다
      this.rig.setFollowTarget(p.x, this.player.avatar.root.position.y + this.focusHeight, p.z);
    }
    this.net?.update(dt);
    this.trackPeerCount();
    this.sceneHandle?.update?.(dt, this.elapsed);
    this.rig.update(dt);
    if (this.player) {
      // 하늘을 보려고 시점을 낮추면 카메라가 내 머리 바로 뒤로 온다. 그때 내 갓이 화면을 가리며
      // 따라다니지 않게, 카메라가 머리 꼭대기 높이 근처까지 내려오면 내 화면에서만 갓을 감춘다
      const headTop = this.player.avatar.root.position.y + AVATAR_HEIGHT + 0.35;
      this.player.avatar.setTallHidden(this.rig.camera.position.y < headTop);
    }
    if (this.labeler) {
      this.updateHover();
      if (this.labeler.isActive()) {
        this.labeler.update(this.rig.camera, this.renderer.domElement.getBoundingClientRect(), performance.now());
      }
    }
    this.renderer.render(this.scene, this.rig.camera);

    // 느린 기기는 한 단계씩 스스로 낮춘다
    if (raw > 0.25) this.frameMonitor.reset(); // 멈췄다 돌아온 긴 간격은 느린 기기로 보지 않는다
    else if (!this.qualityFixed && this.ready && raw > 0 && this.frameMonitor.push(raw)) {
      const lower = lowerTier(this.quality.tier);
      if (lower) {
        this.quality = qualitySettings(lower);
        this.applyQuality();
        this.events.emit('quality-change', { settings: this.getQuality(), auto: true });
      }
    }
  };
}
