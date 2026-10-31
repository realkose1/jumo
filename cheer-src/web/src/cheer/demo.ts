// 개발용 데모(?demo=1, 개발 빌드에서만): 서버 없이 가짜 경기 피드와 순간을 돌려 가며
// 응원 주막의 모든 반응(TV, 건배, 주문, 색종이, 이모지, 소리)을 한 번에 볼 수 있게 한다.
// 배포 빌드에는 들어가지 않는다(main.ts에서 import.meta.env.DEV로 감싸 부른다).
import type { CheerFeed, CheerMatch, Moment } from '@shared/cheer';
import type { LocalizedName } from '@shared/protocol';
import type { Engine } from '../engine/Engine';
import { RemotePeers } from '../engine/RemotePeers';
import { SeatManager } from '../engine/seats';
import { groundHeight, seatPreferenceOrder } from '../spaces/jumak/layout';
import type { JumakStage } from '../spaces/jumak/stage';
import type { UIHandle } from '../ui';
import type { CheerController } from './controller';

const CROWD_SIZE = 15;
const LOOP_MS = 46_000;
const NAMES = ['신난 파전', '목청 큰 막걸리', '들뜬 호롱불', '의리 있는 국밥', '흥 많은 징', '씩씩한 평상', '든든한 사발', '다정한 깃발', '반가운 꽹과리', '기운 찬 도토리묵', '해맑은 주전자', '뜨거운 응원봉', '두근대는 북채', '유쾌한 누룽지', '듬직한 수정과'];

const team = (name: string, score: number | null) => ({ name, score });

function feedAt(step: number, now: number): CheerFeed {
  // step: 0 킥오프 전, 1 킥오프, 2 첫 골(우리), 3 선수 골, 4 실점, 5 종료
  const scoreA = step >= 4 ? [2, 1] : step >= 3 ? [2, 0] : step >= 2 ? [1, 0] : [0, 0];
  const final = step >= 5;
  const m1: CheerMatch = {
    id: 'demo-1',
    sport: 'soccer',
    comp: '프리미어리그',
    home: team('울버햄튼', step >= 1 ? scoreA[0]! : null),
    away: team('토트넘', step >= 1 ? scoreA[1]! : null),
    side: 'home',
    state: step === 0 ? 'pre' : final ? 'final' : 'live',
    clock: step === 0 ? '19:30 시작' : final ? '종료' : `${[1, 12, 38, 63, 81][Math.min(step - 1, 4)]}'`,
    ko: now,
    players: [
      { name: '황희찬', side: 'home', g: step >= 3 ? 1 : 0 },
      { name: '임시 선수', side: 'home', g: 0 },
    ],
  };
  const m2: CheerMatch = {
    id: 'demo-2',
    sport: 'soccer',
    comp: '분데스리가',
    home: team('마인츠', 1),
    away: team('볼프스부르크', 1),
    side: 'home',
    state: 'live',
    clock: `${58 + step * 6}'`,
    ko: now - 3_600_000,
    players: [{ name: '이재성', side: 'home', g: 1 }],
  };
  const m3: CheerMatch = {
    id: 'demo-3',
    sport: 'baseball',
    comp: 'MLB',
    home: team('샌디에이고', null),
    away: team('LA 다저스', null),
    side: 'away',
    state: 'pre',
    clock: '11:10 시작',
    ko: now + 3_600_000,
    players: [],
  };
  return { v: 1, now, matches: [m1, m2, m3], next: null };
}

export interface DemoHandle {
  stop(): void;
}

/** 엔진이 준비되면 가짜 사람들과 가짜 경기를 돌리기 시작한다 */
export function startDemo(engine: Engine, controller: CheerController, ui: UIHandle): DemoHandle {
  let stopped = false;
  const timers = new Set<number>();
  const later = (fn: () => void, ms: number): void => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (!stopped) fn();
    }, ms);
    timers.add(id);
  };
  let crowd: RemotePeers | null = null;
  let loop = 0;
  let momentSeq = 0;
  const peerIds: number[] = [];

  const motionOf = (actionId: string) => engine.space.actions.find((a) => a.id === actionId)?.motion ?? 'hop';

  const peerAct = (id: number, actionId: string): void => {
    crowd?.playMotion(id, motionOf(actionId));
    // 주문은 메뉴 번호(v)를 실어 보낸다 (서버가 있을 때와 같다)
    controller.handlePeerAct(id, actionId, actionId === 'order' ? Math.floor(Math.random() * 8) : undefined);
  };

  const randomAct = (): string => engine.space.actions[Math.floor(Math.random() * 3)]!.id;

  /** 한꺼번에 여러 명이 외친다 (골 직후) */
  const mash = (count: number, spanMs: number): void => {
    for (let i = 0; i < count; i++) {
      later(() => {
        const id = peerIds[Math.floor(Math.random() * peerIds.length)];
        if (id !== undefined) peerAct(id, Math.random() < 0.5 ? 'toast' : randomAct());
      }, Math.random() * spanMs);
    }
  };

  const emit = (kind: Moment['kind'], step: number, extra: Partial<Moment> = {}): void => {
    const now = Date.now();
    controller.handleFeed(feedAt(step, now));
    momentSeq += 1;
    controller.handleMoment({ id: `demo-${loop}-${momentSeq}`, kind, match: 'demo-1', at: now, text: '', ...extra });
  };

  const runLoop = (): void => {
    if (stopped) return;
    loop += 1;
    momentSeq = 0;
    controller.handleFeed(feedAt(0, Date.now()));
    later(() => emit('kickoff', 1, { text: '킥오프! 울버햄튼 대 토트넘' }), 2_000);
    later(() => {
      emit('goal', 2, { text: '울버햄튼 선제골!' });
      mash(14, 3_000);
    }, 9_000);
    later(() => {
      emit('player-goal', 3, { text: '황희찬 골!', player: '황희찬' });
      mash(20, 4_500);
    }, 20_000);
    later(() => emit('concede', 4, { text: '' }), 31_000);
    later(() => {
      emit('final', 5, { text: '', result: 'win' });
      mash(8, 2_500);
    }, 38_000);
    later(runLoop, LOOP_MS);
  };

  const idleChatter = (): void => {
    const id = peerIds[Math.floor(Math.random() * peerIds.length)];
    if (id !== undefined && Math.random() < 0.8) peerAct(id, randomAct());
    later(idleChatter, 500 + Math.random() * 1_300);
  };

  const populate = (mySeat: string | null): void => {
    if (crowd) return;
    const s = engine.getSceneApi<JumakStage>();
    if (!s) return;
    const seats = new SeatManager(s.scene, engine.space.seats);
    crowd = new RemotePeers(s.scene, { seats, outfit: engine.space.avatarOutfit, reducedMotion: engine.getReducedMotion(), capacity: 24 });
    crowd.setGroundHeight(groundHeight);
    s.addTicker((dt) => crowd?.update(dt));
    const order = seatPreferenceOrder(engine.space.seats).filter((id) => id !== mySeat);
    // 앞쪽 자리부터 채우되 군데군데 비운다
    const chosen = order.filter((_, i) => i % 5 !== 3).slice(0, CROWD_SIZE);
    chosen.forEach((seatId, i) => {
      later(() => {
        const def = seats.get(seatId);
        if (!def || !crowd) return;
        const id = 101 + i;
        const name: LocalizedName = { ko: NAMES[i % NAMES.length]! };
        crowd.add({ id, name, x: def.x, z: def.z + 1.5, r: def.facing });
        crowd.setSeat(seatId, id);
        peerIds.push(id);
        ui.setPeopleOverride(peerIds.length + 1);
      }, 300 + i * 160);
    });
    // 머리 위 좌표, 모두 같이 신나게, 이름은 데모 쪽 사람들로
    controller.anchorOf = (who, out) => (who === 'self' ? engine.getHeadAnchor('self', out) : (crowd?.labelAnchor(who, out) ?? null));
    controller.spotOf = (who) => {
      if (who === 'self' || !crowd) return null;
      const at = crowd.positionOf(who);
      return at ? { x: at.x, z: at.z, yaw: at.yaw, seatId: crowd.seatIdOf(who) } : null;
    };
    controller.celebrate = (maxDelay) => {
      engine.celebrateAll(maxDelay);
      crowd?.playMotionAll('celebrate', maxDelay);
    };
    later(idleChatter, 3_000);
    later(runLoop, 1_500);
  };

  const offs: Array<() => void> = [];
  offs.push(
    engine.on('seat-change', ({ seatId }) => {
      if (seatId) populate(seatId);
    }),
  );
  // 자리를 못 잡아도(예: 방이 가득) 몇 초 뒤에는 시작한다
  const kick = (): void => later(() => populate(engine.getSeatId()), 4_000);
  if (engine.isReady()) kick();
  else offs.push(engine.on('ready', kick));

  return {
    stop() {
      stopped = true;
      for (const t of timers) window.clearTimeout(t);
      timers.clear();
      for (const off of offs) off();
      crowd?.dispose();
      crowd = null;
    },
  };
}
