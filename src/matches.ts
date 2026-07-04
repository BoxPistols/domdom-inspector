/**
 * 既定の対象オリジン: 開発サーバのみ (v3.0 §14 権限最小化)。
 * 任意オリジンへの拡大は optional host permissions として Phase 2 で扱う。
 */
export const DEV_MATCHES = [
  'http://localhost/*',
  'https://localhost/*',
  'http://127.0.0.1/*',
];
