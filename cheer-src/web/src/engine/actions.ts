// 동작 세 개 실행. 같은 동작은 1초에 1번만.
import { Emitter, type Unsubscribe } from './events';
import type { ActionDef } from './types';

export const ACTION_COOLDOWN_MS = 1000;

export interface ActionEvent {
  actionId: string;
  /** 0, 1, 2 (숫자키 1, 2, 3에 대응) */
  index: number;
  isGreeting: boolean;
  /** 실행한 순간 (ActionController의 now() 값) */
  at: number;
  /** 변형이 있는 동작이면 이번에 고른 번호 (ActionDef.variants) */
  variant?: number;
}

export interface ActionControllerOptions {
  actions: readonly ActionDef[];
  greetingActionId: string;
  /** 실제 몸짓을 내는 함수 */
  perform: (action: ActionDef) => void;
  cooldownMs?: number;
  now?: () => number;
  /** 변형 번호를 고르는 함수(0 이상 1 미만). 시험에서 바꿔 끼운다 */
  random?: () => number;
}

export class ActionController {
  private readonly events = new Emitter<{ action: ActionEvent }>();
  private readonly lastRun = new Map<string, number>();
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(private readonly options: ActionControllerOptions) {
    this.cooldownMs = options.cooldownMs ?? ACTION_COOLDOWN_MS;
    this.now = options.now ?? (() => performance.now());
    this.random = options.random ?? Math.random;
  }

  /** 실행했으면 true, 모르는 동작이거나 다시 하기 간격(기본 1초, 동작마다 다를 수 있다)이 안 지났으면 false */
  run(actionId: string): boolean {
    const index = this.options.actions.findIndex((a) => a.id === actionId);
    if (index < 0) return false;
    const action = this.options.actions[index]!;
    const t = this.now();
    if (this.cooldownRemaining(actionId) > 0) return false;
    this.lastRun.set(actionId, t);
    this.options.perform(action);
    const event: ActionEvent = {
      actionId,
      index,
      isGreeting: actionId === this.options.greetingActionId,
      at: t,
    };
    if (action.variants && action.variants > 0) event.variant = Math.min(action.variants - 1, Math.floor(this.random() * action.variants));
    this.events.emit('action', event);
    return true;
  }

  /** 숫자키 1, 2, 3 */
  runByKey(key: number): boolean {
    const action = this.options.actions[key - 1];
    return action ? this.run(action.id) : false;
  }

  /** 다시 쓸 수 있을 때까지 남은 ms. 쓸 수 있으면 0 */
  cooldownRemaining(actionId: string): number {
    const last = this.lastRun.get(actionId);
    if (last === undefined) return 0;
    const own = this.options.actions.find((a) => a.id === actionId)?.cooldownMs;
    return Math.max(0, (own ?? this.cooldownMs) - (this.now() - last));
  }

  /** 동작이 실행될 때마다 알려준다 (버튼 UI, 나중에 서버 전송) */
  onAction(handler: (event: ActionEvent) => void): Unsubscribe {
    return this.events.on('action', handler);
  }
}
