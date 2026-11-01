// 모든 시험의 기본: 시험 전용 공간(test/fixtures.ts)을 등록하고, 바깥 네트워크로는 나가지 않는다.
import { afterEach, beforeEach, vi } from 'vitest';
import { registerFixtures } from './fixtures';

registerFixtures();

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    throw new Error(`unexpected outbound fetch in test: ${url}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
