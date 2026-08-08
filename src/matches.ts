/**
 * 既定の対象オリジン: 開発サーバのみ (v3.0 §14 権限最小化)。
 * 任意オリジンへの拡大は optional host permissions として Phase 2 で扱う。
 */
export const DEV_MATCHES = [
  'http://localhost/*',
  'https://localhost/*',
  'http://127.0.0.1/*',
  // 文書 (README / PRIVACY) は「localhost / 127.0.0.1 は自動対応」と無条件に書いている。
  // https の 127.0.0.1 だけ漏れていると、mkcert 等で https 開発しているユーザーにだけ
  // 「書いてあるのに動かない」が起きる (監査 2026-08-07)
  'https://127.0.0.1/*',
];
