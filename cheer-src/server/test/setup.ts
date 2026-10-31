// 모든 시험의 기본: 바깥 네트워크로 나가지 않는다.
// 주막 방은 사람이 있으면 피드(FEED_URL=https://feed.test/...)를 받으러 가므로, 기본으로는 '닫혀 있음'(503)을 돌려준다.
// 피드를 시험하는 파일(feed-room.test.ts)은 자기 beforeEach에서 이걸 덮어쓴다.
import { afterEach, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith('https://feed.test/')) return new Response('no feed in this test', { status: 503 });
    throw new Error(`unexpected outbound fetch in test: ${url}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
