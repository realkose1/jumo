// 개인 기록 저장소. 키는 bongeunsa:<공간id>:<항목>.
// 모든 읽기와 쓰기는 try/catch로 감싸고, 막혀 있으면 메모리로 대신한다.
export type StorageBackend = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const STORAGE_PREFIX = 'bongeunsa';

/** localStorage를 쓸 수 있으면 돌려주고, 막혀 있으면 null (접근만으로도 던질 수 있다) */
export function detectLocalStorage(): StorageBackend | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (!ls) return null;
    const probe = `${STORAGE_PREFIX}:__probe__`;
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

export class SpaceStorage {
  private readonly backend: StorageBackend | null;
  private readonly memory = new Map<string, string>();
  private persistent: boolean;

  /** backend 'auto'면 localStorage를 찾아 쓰고, null이면 처음부터 메모리만 쓴다. */
  constructor(
    private readonly spaceId: string,
    backend: StorageBackend | null | 'auto' = 'auto',
  ) {
    this.backend = backend === 'auto' ? detectLocalStorage() : backend;
    this.persistent = this.backend !== null;
  }

  key(item: string): string {
    return `${STORAGE_PREFIX}:${this.spaceId}:${item}`;
  }

  /** 마지막 읽기/쓰기가 실제 기기 저장소에 닿았는지 (UI가 안내할 때 쓸 수 있다) */
  isPersistent(): boolean {
    return this.persistent;
  }

  get<T>(item: string, fallback: T): T {
    const key = this.key(item);
    let raw: string | null = null;
    if (this.backend) {
      try {
        raw = this.backend.getItem(key);
      } catch {
        this.persistent = false;
      }
    }
    if (raw === null) raw = this.memory.get(key) ?? null;
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  /** 기기 저장소에 남겼으면 true, 메모리에만 남았으면 false */
  set(item: string, value: unknown): boolean {
    const key = this.key(item);
    let raw: string;
    try {
      raw = JSON.stringify(value);
    } catch {
      return false;
    }
    if (raw === undefined) return false;
    this.memory.set(key, raw);
    if (!this.backend) return false;
    try {
      this.backend.setItem(key, raw);
      this.persistent = true;
      return true;
    } catch {
      this.persistent = false;
      return false;
    }
  }

  remove(item: string): void {
    const key = this.key(item);
    this.memory.delete(key);
    if (!this.backend) return;
    try {
      this.backend.removeItem(key);
    } catch {
      this.persistent = false;
    }
  }
}
