import { defineConfig } from 'vitest/config';

// e2e/ は Playwright 専用 (実行は `pnpm e2e`)。vitest のコミット前ゲートから除外する。
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
