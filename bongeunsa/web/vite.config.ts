import { defineConfig } from 'vitest/config';

// 저장소 루트의 shared/ (화면과 서버가 같이 읽는 규약과 공간 데이터)
// (node 타입을 따로 설치하지 않으려고 URL로 경로를 만든다)
const pathOf = (relative: string): string => decodeURIComponent(new URL(relative, import.meta.url).pathname);
const sharedDir = pathOf('../shared');

export default defineConfig({
  // 사이트 루트에 놓인다. 바꾸면 index.html의 ASSETS(/assets/)도 같이 바꾼다
  base: '/',
  resolve: { alias: { '@shared': sharedDir } },
  server: {
    port: 5180,
    strictPort: true,
    // 개발 서버가 web/ 밖의 shared/도 내어 주게 한다
    fs: { allow: [pathOf('.'), sharedDir] },
  },
  preview: { port: 4190 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
