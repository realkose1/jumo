import { afterEach, describe, expect, it } from 'vitest';
import { SpaceStorage, detectLocalStorage, type StorageBackend } from './storage';

function memoryBackend(): StorageBackend & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const throwing: StorageBackend = {
  getItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
  removeItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
};

describe('SpaceStorage (사용 가능)', () => {
  it('키는 jumo-cheer:<공간id>:<항목>', () => {
    const backend = memoryBackend();
    const s = new SpaceStorage('test-room', backend);
    expect(s.key('visits')).toBe('jumo-cheer:test-room:visits');
    expect(s.set('visits', 3)).toBe(true);
    expect(backend.data.get('jumo-cheer:test-room:visits')).toBe('3');
    expect(s.get('visits', 0)).toBe(3);
    expect(s.isPersistent()).toBe(true);
  });

  it('값이 없으면 기본값, 깨진 값도 기본값', () => {
    const backend = memoryBackend();
    const s = new SpaceStorage('a', backend);
    expect(s.get('x', 'fallback')).toBe('fallback');
    backend.data.set('jumo-cheer:a:x', '{깨진');
    expect(s.get('x', 'fallback')).toBe('fallback');
  });

  it('객체와 지우기', () => {
    const s = new SpaceStorage('a', memoryBackend());
    s.set('obj', { n: 1, list: [1, 2] });
    expect(s.get('obj', null)).toEqual({ n: 1, list: [1, 2] });
    s.remove('obj');
    expect(s.get('obj', 'gone')).toBe('gone');
  });

  it('공간마다 따로 쌓인다', () => {
    const backend = memoryBackend();
    new SpaceStorage('one', backend).set('k', 1);
    expect(new SpaceStorage('two', backend).get('k', 0)).toBe(0);
  });
});

describe('SpaceStorage (막힌 경우)', () => {
  it('저장소가 없으면(null) 메모리로 대신한다', () => {
    const s = new SpaceStorage('a', null);
    expect(s.isPersistent()).toBe(false);
    expect(s.set('k', 'v')).toBe(false);
    expect(s.get('k', 'none')).toBe('v');
    s.remove('k');
    expect(s.get('k', 'none')).toBe('none');
  });

  it('읽기 쓰기가 모두 던져도 화면은 멈추지 않고 메모리로 동작한다', () => {
    const s = new SpaceStorage('a', throwing);
    expect(() => s.set('k', 1)).not.toThrow();
    expect(s.set('k', 2)).toBe(false);
    expect(s.get('k', 0)).toBe(2);
    expect(() => s.remove('k')).not.toThrow();
    expect(s.get('k', 0)).toBe(0);
    expect(s.isPersistent()).toBe(false);
  });

  it('쓰다가 용량이 차서 던져도 메모리에는 남는다', () => {
    const backend = memoryBackend();
    const s = new SpaceStorage('a', {
      ...backend,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    });
    expect(s.set('k', 5)).toBe(false);
    expect(s.get('k', 0)).toBe(5);
  });

  it('JSON으로 바꿀 수 없는 값은 false만 돌려준다', () => {
    const s = new SpaceStorage('a', memoryBackend());
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(s.set('c', circular)).toBe(false);
    expect(s.set('u', undefined)).toBe(false);
  });
});

describe('detectLocalStorage', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('localStorage가 아예 없으면 null', () => {
    expect(detectLocalStorage()).toBeNull();
  });

  it('접근만 해도 던지는 환경(사생활 보호 모드 등)이면 null', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    expect(detectLocalStorage()).toBeNull();
    const s = new SpaceStorage('a'); // 자동 감지: 메모리로 대체
    s.set('k', 1);
    expect(s.get('k', 0)).toBe(1);
    expect(s.isPersistent()).toBe(false);
  });

  it('쓰기 시험에서 던지면 null', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: throwing });
    expect(detectLocalStorage()).toBeNull();
  });

  it('정상이면 그 저장소를 쓴다', () => {
    const backend = memoryBackend();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: backend });
    expect(detectLocalStorage()).toBe(backend);
    const s = new SpaceStorage('a');
    expect(s.set('k', 1)).toBe(true);
    expect(backend.data.get('jumo-cheer:a:k')).toBe('1');
  });
});
