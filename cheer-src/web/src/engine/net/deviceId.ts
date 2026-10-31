// 기기 식별값: 기기에 한 번 무작위로 만들어 저장해 둔다. 서버가 같은 기기의 중복 입장과 하루 선물 횟수를 세는 데만 쓴다.
// 저장소가 막혀 있으면 이번 방문 동안만 쓰는 값으로 버틴다(화면은 정상 동작).
import { DEVICE_ID_PATTERN } from '@shared/protocol';
import { SpaceStorage } from '../storage';

const ITEM = 'id';
let memoryId: string | null = null;

/** 영문 숫자 32자 무작위 값 (8~64자 규칙 안) */
export function generateDeviceId(
  random: (bytes: Uint8Array<ArrayBuffer>) => void = (b) => void globalThis.crypto.getRandomValues(b),
): string {
  const bytes = new Uint8Array(new ArrayBuffer(16));
  try {
    random(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function getDeviceId(storage: SpaceStorage = new SpaceStorage('device')): string {
  const saved = storage.get<unknown>(ITEM, null);
  if (typeof saved === 'string' && DEVICE_ID_PATTERN.test(saved)) return saved;
  const fresh = memoryId ?? generateDeviceId();
  memoryId = fresh;
  storage.set(ITEM, fresh);
  return fresh;
}
