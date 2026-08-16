import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type BrowserContext } from '@playwright/test';

/**
 * side panel のスモーク (issue #10)。
 *
 * **ここで確認できることは限られている** (`docs/design-coverage-screen.md` §6-6):
 * Playwright に side panel を開く API は無く、`sidePanel.open()` は user gesture 必須で
 * service worker からも呼べない。`sidepanel.html` を**通常タブとして**開くことはできるが、
 * そのとき「パネル」ではないので、タブ切替をまたぐ生存や `tabs.onActivated` 起点の
 * stale 判定は再現しない。
 *
 * よってここは「与えられた状態で正しく描くか」に限定し、状態遷移そのものは
 * `src/panelState.test.ts` (純関数) が網羅する。実機確認の項目は設計文書 §10 に降ろす。
 */

const EXT_PATH = join(import.meta.dirname, '..', '.output', 'chrome-mv3');

/**
 * ページ内で解決したロケール文字列を取る。
 * **本体は `page.evaluate` に渡してブラウザ側で走らせる** (Node 側の関数はページから
 * 見えない)。e2e は Node の tsconfig で走るため `chrome` の型が無く、明示 cast する。
 */
const readMessage = (key: string): string => {
  const api = (globalThis as unknown as {
    chrome?: { i18n?: { getMessage(k: string): string } };
  }).chrome;
  return api?.i18n?.getMessage(key) ?? '';
};

let context: BrowserContext;
let extensionId: string;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ext-e2e-panel-')), {
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
  });
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker');
  extensionId = new URL(sw.url()).host;
});

test.afterAll(async () => {
  await context.close();
});

test('パネルが開き、主要 UI が描画される', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // **ロケールを決め打ちしない** (この環境の Chromium は ja で解決する)。
  // 見るのは「i18n が適用されたか」= HTML の既定文字列のままになっていないこと
  const title = await page.evaluate(readMessage, 'panelTitle');
  expect(title.length, 'panelTitle が空だと i18n の同期漏れ').toBeGreaterThan(0);
  await expect(page.locator('h1')).toHaveText(title);
  await expect(page.locator('#measure')).toBeVisible();
  // 計測前は結果ブロックを出さない (空の枠だけ見せない)
  await expect(page.locator('#result')).toBeHidden();

  await page.close();
});

test('計測できないページでも、押した結果を必ず言う (無反応にしない)', async () => {
  const page = await context.newPage();
  // 自分自身 (拡張ページ) が対象になる = content script が居ないので必ず失敗する経路。
  // **失敗を黙って飲み込まないこと**を固定する (commit 459db69 の「押せるのに無反応が
  // 一番わかりにくい」と同じ規律を、移設先のパネルでも守る)
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await page.locator('#measure').click();

  const banner = page.locator('#banner');
  await expect(banner).toBeVisible({ timeout: 8000 });
  const text = (await banner.textContent()) ?? '';
  expect(text.trim().length, 'バナーは空文字にしない').toBeGreaterThan(0);
  // 「計測できません」で終わらせず、次に何をすればよいかまで言う
  expect(text).toMatch(/enable|reload|有効化|再読み込み|再読込/i);

  await page.close();
});

test('バナーの文言は理由を断定しない (§6-2 — パネルは URL を読めないことがある)', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // 未許可オリジンと「そもそも検査できないページ」を区別できないのが事実なので、
  // どちらか一方だと断定する文言を出してはいけない。両方の可能性に触れているか見る
  const message = await page.evaluate(readMessage, 'panelTargetUnreadable');
  expect(message.length, '文言が空だと i18n の同期漏れ').toBeGreaterThan(0);
  expect(message).toMatch(/enable|有効化/i);
  expect(message, '検査できないページがある可能性にも触れる').toMatch(
    /cannot be inspected|settings|検査できない|設定ページ/i,
  );

  await page.close();
});
