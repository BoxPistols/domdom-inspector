import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type BrowserContext } from '@playwright/test';

// popup スモーク (ST-4): ビルド済み拡張を実 Chromium にロードし、
// popup が開いて主要 UI (inspect ボタン / トークン欄) が描画されることを確認する。
// 事前条件: `pnpm build` 済みで .output/chrome-mv3 が存在すること。

const EXT_PATH = join(import.meta.dirname, '..', '.output', 'chrome-mv3');

let context: BrowserContext;
let extensionId: string;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ext-e2e-')), {
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
  });
  // MV3 の service worker から拡張 ID を得る (未起動なら起動を待つ)
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker');
  extensionId = new URL(sw.url()).host;
});

test.afterAll(async () => {
  await context.close();
});

test('popup が開き主要 UI が描画される', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  // モード切替: inspect のみ (tree/render は v1 の配線から外した)
  await expect(page.locator('#toggle')).toBeVisible();
  await expect(page.locator('#toggleTree')).toHaveCount(0);
  await expect(page.locator('#toggleRender')).toHaveCount(0);

  // デザイントークン貼り付け欄 (中核機能) が存在する
  await expect(page.locator('#tokensJson')).toBeVisible();

  // i18n が解決されボタンに文言が入っている (生キーや空でない)
  const label = (await page.locator('#toggle').textContent())?.trim() ?? '';
  expect(label.length).toBeGreaterThan(0);
  expect(label).not.toContain('popupToggleInspect');
});
