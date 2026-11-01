import { describe, expect, it } from 'vitest';
import { DEVICE_ID_PATTERN } from '@shared/protocol';
import { SpaceStorage, type StorageBackend } from '../storage';
import { generateDeviceId, getDeviceId } from './deviceId';

function memoryBackend(): StorageBackend & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('기기 식별값', () => {
  it('서버가 받는 모양이다', () => {
    for (let i = 0; i < 20; i++) expect(DEVICE_ID_PATTERN.test(generateDeviceId())).toBe(true);
  });

  it('처음엔 만들어 저장하고, 다음부터는 같은 값', () => {
    const backend = memoryBackend();
    const a = getDeviceId(new SpaceStorage('device', backend));
    const b = getDeviceId(new SpaceStorage('device', backend));
    expect(a).toBe(b);
    expect(backend.data.get('bongeunsa:device:id')).toBe(JSON.stringify(a));
  });

  it('저장된 값이 모양에 맞지 않으면 새로 만든다', () => {
    const backend = memoryBackend();
    backend.data.set('bongeunsa:device:id', JSON.stringify('짧다'));
    const id = getDeviceId(new SpaceStorage('device', backend));
    expect(DEVICE_ID_PATTERN.test(id)).toBe(true);
  });

  it('저장소가 막혀 있어도 값을 준다', () => {
    const blocked: StorageBackend = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const id = getDeviceId(new SpaceStorage('device', blocked));
    expect(DEVICE_ID_PATTERN.test(id)).toBe(true);
  });
});
