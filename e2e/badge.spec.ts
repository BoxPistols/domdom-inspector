import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type BrowserContext } from '@playwright/test';

/**
 * badge スモーク (P1): ビルド済み拡張を Chromium にロードし、
 * localhost ページで inspect モードが起動しデザインバッジが描画されることを確認する。
 * 事前条件: `pnpm build` 済みで .output/chrome-mv3 が存在すること。
 *
 * カバーするパス: inspector toggle → hover → overlay.show() → ensureMounted() → DOM 追加
 * 補助パス: tokenDict 注入 → 照合パスが例外なく完走することを確認
 */

const EXT_PATH = join(import.meta.dirname, '..', '.output', 'chrome-mv3');

// types.ts の BRIDGE_SOURCE と同値 ('domdom-inspector-bridge')。
// もし rename されたらこのテストも失敗する (意図的な回帰検知)。
const BRIDGE_SOURCE = 'domdom-inspector-bridge';

// extension が自動注入する localhost/* にマッチするオリジンで fixture を配信する。
// page.route() でインターセプトするため実際にサーバが必要ない。
const FIXTURE_ORIGIN = 'http://localhost:9901';

const FIXTURE_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>DomDom Badge E2E Fixture</title></head>
<body style="margin:0">
  <div
    id="target"
    style="
      width:200px;height:100px;
      background-color:#c62828;
      margin:16px;padding:8px;
      border-radius:8px;
      color:#fff;
      font-size:16px;
      font-family:sans-serif"
  >Inspect me</div>
</body>
</html>`;

let context: BrowserContext;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext(
    mkdtempSync(join(tmpdir(), 'ext-badge-')),
    {
      channel: 'chromium',
      args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
    },
  );
  // MV3 service worker の起動を確認 (拡張ロード完了の証拠)
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker');
  void sw;
});

test.afterAll(async () => {
  await context.close();
});

/** fixture ページを開き MAIN world content script の確立を待つ */
async function openFixture() {
  const page = await context.newPage();
  // localhost/* 宛てのリクエストを fixture HTML で応答 (サーバ不要)
  await page.route(`${FIXTURE_ORIGIN}/**`, (route) => {
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: FIXTURE_HTML });
  });
  await page.goto(`${FIXTURE_ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  // inspector.content.ts が document_start で設定する guard flag を待つ
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>)['__DOMDOM_INSPECTOR_LOADED__'],
    { timeout: 5000 },
  );
  return page;
}

/**
 * 核心パス: inspector active → hover → overlay custom element が DOM に現れる。
 * toggle 前は未存在、hover 後に出現という双方向で因果を確認する。
 * overlay は closed shadow DOM + fixed 子要素のためホスト要素の bounding box は 0 だが、
 * 「DOM に挿入された」という事実が ensureMounted() → body 追加まで到達した証拠。
 */
test('ホバーでデザインバッジが描画される', async () => {
  const page = await openFixture();

  // inspector を起動する前は overlay 要素が存在しないことを確認
  await expect(page.locator('domdom-inspector-overlay')).not.toBeAttached();

  // bridge → inspector の postMessage パスと同じ形式で toggle を送信
  await page.evaluate(
    (src) => window.postMessage({ source: src, type: 'toggle' }, '*'),
    BRIDGE_SOURCE,
  );

  await page.hover('#target');

  // overlay custom element が body 配下に追加される
  await expect(page.locator('domdom-inspector-overlay')).toBeAttached({ timeout: 3000 });

  await page.close();
});

/**
 * トークン照合パス: token dict 注入後も overlay が正常に描画される。
 * ペイロードは bridge が parseTokens で正規化した後の TokenDict 形状
 * (TokenColor {name,r,g,b,a} / TokenSize {name,px,category})。fixture の
 * background-color #c62828=rgb(198,40,40) と padding:8px が実際に照合 hit する値を渡すことで、
 * annotateProp → matchColor/matchSize の照合分岐を実データで通す。
 * shadow DOM (closed) のためバッジ文言は読めないが、照合が例外なく完走することを確認する。
 * 照合結果の正確性 (どの値がどのトークンに一致するか) は tokenDict.test.ts が担保。
 */
test('デザイントークンを注入してもバッジが正常に描画される', async () => {
  const page = await openFixture();

  // fixture の background-color (#c62828) と padding (8px) に一致するトークンを登録
  await page.evaluate(
    (src) =>
      window.postMessage(
        {
          source: src,
          type: 'tokens',
          payload: {
            colors: [{ name: 'color/error', r: 198, g: 40, b: 40, a: 1 }],
            sizes: [{ name: 'spacing/sm', px: 8, category: 'space' }],
          },
        },
        '*',
      ),
    BRIDGE_SOURCE,
  );

  await page.evaluate(
    (src) => window.postMessage({ source: src, type: 'toggle' }, '*'),
    BRIDGE_SOURCE,
  );

  await page.hover('#target');

  await expect(page.locator('domdom-inspector-overlay')).toBeAttached({ timeout: 3000 });

  await page.close();
});
