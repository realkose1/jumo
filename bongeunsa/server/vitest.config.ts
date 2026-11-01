import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        // 시험에서는 /rooms를 캐시하지 않고, 위치 묶음을 빨리 보낸다.
        // Origin 제한은 끄고(시험 클라이언트는 Origin이 없다), 시험 공간(test/fixtures.ts) 방은 시험마다 따로 쓰도록 넉넉히 늘린다.
        bindings: {
          ROOMS_CACHE_MS: '0',
          MOVE_FLUSH_MS: '30',
          ALLOWED_ORIGINS: '',
          SPACE_OVERRIDES: '{"fixture":{"rooms":100}}',
        },
      },
    }),
  ],
  test: {
    testTimeout: 20000,
    // 시험 공간을 등록하고 바깥 네트워크를 막는다(test/setup.ts)
    setupFiles: ['./test/setup.ts'],
  },
});
