import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';

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

  // v1 の配線から外したブロックが復活していないこと (実装は温存しているので、
  // 掲載文と申告を戻さずに UI だけ生えると単一目的の宣言と食い違う)
  await expect(page.locator('#coverageMeasure')).toHaveCount(0); // issue #10
  await expect(page.locator('#aiSection')).toHaveCount(0); // issue #11
  await expect(page.locator('#badgeDetail')).toHaveCount(0); // issue #12
  await expect(page.locator('#tokensJson')).toHaveCount(0); // issue #13

  // 権限導線と開発者向け設定が残っている (v1 の popup はこの 2 つ + モードだけ)
  await expect(page.locator('#enableSite')).toBeVisible();
  await expect(page.locator('#devSection')).toBeAttached();

  // i18n が解決されボタンに文言が入っている (生キーや空でない)
  const label = (await page.locator('#toggle').textContent())?.trim() ?? '';
  expect(label.length).toBeGreaterThan(0);
  expect(label).not.toContain('popupToggleInspect');
});

test('未有効化のページではモード切替と有効化が disabled になる', async () => {
  // 「押せるのに何も起きない」を防ぐ設計 (動かない機能は disabled + 理由を表示)。
  // popup 単体で開くと対象タブが http(s) でないため、判定は notInspectable 側に落ちる。
  // 以前は #coverageMeasure も assert していたが、カバレッジ UI は v1 の配線から外した
  // (issue #10)。規律は残る 2 つの導線で機械的に守る
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.locator('#toggle')).toBeDisabled();
  await expect(page.locator('#enableSite')).toBeDisabled();
  const notice = page.locator('#modeUnavailable');
  await expect(notice).toBeVisible();
  expect((await notice.textContent())?.trim().length ?? 0).toBeGreaterThan(0);
  await page.close();
});

/**
 * エディタ関連の設定が到達可能で、選べない設定は見せないこと。
 *
 * これらは Settings 型と src/mappings.ts に実装がありながら popup に UI が無く、
 * **設定できない = 到達不能**だった (パスが違う環境ではエディタ起動が外れるのに直せない)。
 * あわせて「custom を選んだのに URL 入力欄が無い」を作らないことを機械で固定する。
 */
test('エディタ設定: パスマッピングが編集でき、custom URL 欄は選択時だけ出る', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  // 開発者向けセクションを開く。**click ではなく open を直接立てる**:
  // 開閉状態は storage に保存されるため、click だと 2 回目に閉じてしまう (テストが不安定)
  await openDevSection(page);

  await expect(page.locator('#pathMappings')).toBeVisible();
  // 既定 (cursor) では custom URL 欄は隠れている
  await expect(page.locator('#customTemplateRow')).toBeHidden();

  await page.locator('#editor').selectOption('custom');
  await expect(page.locator('#customTemplateRow')).toBeVisible();
  await expect(page.locator('#customTemplate')).toBeVisible();

  // 保存されて復元されること (パスマッピングは 1 行 1 件のテキストで往復する)
  await page.locator('#pathMappings').fill('/app=/Users/me/project');
  await page.locator('#pathMappings').blur();
  await page.reload();
  await openDevSection(page);
  await expect(page.locator('#pathMappings')).toHaveValue('/app=/Users/me/project');
  // エディタ種別も復元され、URL 欄が出たままであること
  await expect(page.locator('#editor')).toHaveValue('custom');
  await expect(page.locator('#customTemplateRow')).toBeVisible();

  await page.close();
});

/** 開発者向け details を冪等に開く (開閉状態が永続化されるので click は使わない) */
async function openDevSection(page: Page) {
  await page.locator('#devSection').evaluate((el) => {
    (el as HTMLDetailsElement).open = true;
  });
}

/**
 * Chrome の action popup は 600px を超えるとスクロールバーが出る。
 * 既定表示 (details 閉) は**最も長い locale (ja)** でも 600px 未満に収める
 * (実測で ja 604px に膨らんで超えていた — 監査 2026-08-07)。
 * ランナーの UI 言語に依存しないよう、ja の実文字列を chrome.i18n に流し込んで測る。
 */
test('既定表示の高さが ja でも 600px 未満 (popup のスクロールバーを出さない)', async () => {
  const { readFileSync } = await import('node:fs');
  const raw = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'public', '_locales', 'ja', 'messages.json'), 'utf8'),
  ) as Record<string, { message: string }>;
  const messages = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.message]));

  const page = await context.newPage();
  await page.addInitScript(
    ({ msgs }) => {
      const api = (globalThis as unknown as { chrome?: { i18n?: Record<string, unknown> } }).chrome;
      if (!api?.i18n) return;
      api.i18n.getMessage = (key: string) => msgs[key] ?? '';
      api.i18n.getUILanguage = () => 'ja-JP';
    },
    { msgs: messages },
  );
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForTimeout(200);

  // 既定 = details 閉。同一 context の前のテストが「開発者向け」を開いた状態を
  // storage (popupDevOpen) に残すので、測る前に既定状態へ明示的に戻す
  const height = await page.evaluate(() => {
    for (const d of document.querySelectorAll('details')) d.open = false;
    return document.body.scrollHeight;
  });
  expect(height, 'details 閉の既定表示').toBeLessThan(600);

  await page.close();
});
