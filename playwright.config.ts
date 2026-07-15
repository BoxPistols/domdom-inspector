import { defineConfig } from '@playwright/test';

// E2E スモークはコミット前ゲート (pnpm test) には混ぜない。実行は `pnpm e2e`。
// 拡張のロードに persistent context が必要なため spec 側で chromium.launchPersistentContext を使う。
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // 拡張ロードは profile ディレクトリを占有するため並列させない
  workers: 1,
  reporter: 'list',
});
