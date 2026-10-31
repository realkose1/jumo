import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        // 시험에서는 /rooms를 캐시하지 않고, 위치 묶음을 빨리 보낸다.
        // Origin 제한은 끄고(시험 클라이언트는 Origin이 없다), 피드는 가짜 주소에서 빨리 받는다(시험이 fetch를 바꿔 끼운다).
        // 주막 방은 시험마다 따로 쓰도록 넉넉히 늘린다.
        bindings: {
          ROOMS_CACHE_MS: '0',
          MOVE_FLUSH_MS: '30',
          ALLOWED_ORIGINS: '',
          FEED_URL: 'https://feed.test/api/cheer-feed',
          FEED_POLL_MS: '150',
          SPACE_OVERRIDES: '{"jumak":{"rooms":100}}',
        },
      },
    }),
  ],
  test: {
    testTimeout: 20000,
    // 바깥 네트워크 대신 피드 주소를 '닫혀 있음'으로 막는다(test/setup.ts)
    setupFiles: ['./test/setup.ts'],
  },
});
