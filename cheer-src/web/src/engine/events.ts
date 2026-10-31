// 엔진과 UI가 주고받는 아주 작은 이벤트 버스
export type Unsubscribe = () => void;
export type Handler<T> = (payload: T) => void;

export class Emitter<E extends { [K in keyof E]: unknown }> {
  private listeners: { [K in keyof E]?: Set<Handler<E[K]>> } = {};

  on<K extends keyof E>(type: K, fn: Handler<E[K]>): Unsubscribe {
    const target = (this.listeners[type] ??= new Set<Handler<E[K]>>()) as Set<Handler<E[K]>>;
    target.add(fn);
    return () => {
      target.delete(fn);
    };
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.listeners[type];
    if (!set) return;
    // 구독자 하나가 터져도 나머지와 그리기 반복은 멈추지 않는다
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[events] handler for "${String(type)}" failed`, err);
      }
    }
  }

  clear(): void {
    this.listeners = {};
  }
}
