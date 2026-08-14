import { defineConfig } from 'vitest/config';

// e2e/ は Playwright 専用 (実行は `pnpm e2e`)。vitest のコミット前ゲートから除外する。
export default defineConfig({
  test: {
    // touchbar/ は拡張のビルドに入らないが、キーコード変換のような「静かに誤答する」
    // 純粋ロジックを持つのでコミット前ゲートに載せる
    include: ['src/**/*.test.ts', 'touchbar/**/*.test.mjs'],
  },
});
