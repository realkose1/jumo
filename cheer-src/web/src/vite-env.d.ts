/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 실시간 서버 주소 (예: ws://localhost:8797). 비어 있으면 서버 없이 혼자 모드 */
  readonly VITE_PRESENCE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
