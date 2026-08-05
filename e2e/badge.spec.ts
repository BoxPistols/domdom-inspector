import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * badge スモーク (P1): ビルド済み拡張を Chromium にロードし、
 * localhost ページで inspect モードが起動しデザインバッジが描画されることを確認する。
 * 事前条件: `pnpm build` 済みで .output/chrome-mv3 が存在すること。
 *
 * テスト1: inspector toggle → hover → overlay.show() → ensureMounted() → DOM 追加 (因果)
 * テスト2: 正規化済み TokenDict を注入 → hover → バッジに実トークン名が描画される (end-to-end)
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
  // 拡張は overlay を closed shadow DOM で作る (ページ隔離)。テストからバッジ文言を
  // 読めるよう attachShadow を open に強制し、host に __openRoot として退避する。
  // 拡張の MAIN world content script と同じ realm で Element.prototype を共有するため
  // このパッチが効く。attachShadow は hover 時に初めて呼ばれるので、document 生成時に
  // 仕込むこの init script が先行する。機能挙動は不変で、テストからの可視性だけを上げる。
  await context.addInitScript(() => {
    const orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit): ShadowRoot {
      const root = orig.call(this, { ...init, mode: 'open' });
      (this as Element & { __openRoot?: ShadowRoot }).__openRoot = root;
      return root;
    };
  });
  // MV3 service worker の起動を確認 (拡張ロード完了の証拠)
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker');
  void sw;
});

test.afterAll(async () => {
  await context.close();
});

// CSS 変数で宣言した要素 (color/bg/padding が var(--x) 由来)。変数名優先表示の検証用。
const VAR_FIXTURE_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>DomDom Var E2E Fixture</title>
<style>
  :root { --text: #eaedf4; --surface: #212a3c; --sp-2: 8px; }
  .card { color: var(--text); background: var(--surface); padding: var(--sp-2); font-size: 14px; }
</style></head>
<body style="margin:0"><div id="target" class="card">Var me</div></body>
</html>`;

/** fixture ページを開き MAIN world content script の確立を待つ */
async function openFixture(html: string = FIXTURE_HTML) {
  const page = await context.newPage();
  // localhost/* 宛てのリクエストを fixture HTML で応答 (サーバ不要)
  await page.route(`${FIXTURE_ORIGIN}/**`, (route) => {
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
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
 * inspect モードを起動し、toggle ハンドラの実行完了を待つ。
 * postMessage は task キューに載るため、後段に setTimeout(0) を積んで解決することで
 * 「toggle が処理済み」を保証し、後続の hover との順序依存 (フレーク) を排除する。
 */
async function activate(page: Page) {
  await page.evaluate(
    (src) =>
      new Promise<void>((resolve) => {
        window.postMessage({ source: src, type: 'toggle' }, '*');
        setTimeout(resolve, 0);
      }),
    BRIDGE_SOURCE,
  );
}

/** open 化した shadow root (無ければ通常の shadowRoot) の textContent を返す */
async function badgeText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const host = document.querySelector('domdom-inspector-overlay') as
      | (Element & { __openRoot?: ShadowRoot })
      | null;
    const root = host?.__openRoot ?? host?.shadowRoot ?? null;
    // **バッジ要素だけ**を読む。shadow root 全体の textContent には overlay 自身の CSS
    // (<style> のテキスト) が含まれ、'8px' 等の px 値が CSS 側に多数あるため、
    // バッジが空でも px の assert が通ってしまう (偽陽性でテストが無意味になる)
    return root?.querySelector('.badge')?.textContent ?? '';
  });
}

/**
 * 核心パス: inspector active → hover → overlay custom element が DOM に現れる。
 * toggle 前は未存在、hover 後に出現という双方向で因果を確認する。
 */
test('ホバーでデザインバッジが描画される', async () => {
  const page = await openFixture();

  // inspector を起動する前は overlay 要素が存在しないことを確認
  await expect(page.locator('domdom-inspector-overlay')).not.toBeAttached();

  await activate(page);
  await page.hover('#target');

  // overlay custom element が body 配下に追加される
  await expect(page.locator('domdom-inspector-overlay')).toBeAttached({ timeout: 3000 });

  await page.close();
});

/**
 * トークン照合パス (end-to-end): bridge が parseTokens で正規化した後の TokenDict 形状
 * (TokenColor {name,r,g,b,a} / TokenSize {name,px,category}) を注入し、fixture の
 * background-color #c62828=rgb(198,40,40) と padding:8px に一致するトークンを与える。
 * hover → inspectElement → annotateProp → matchColor/matchSize → hit → バッジ描画 まで
 * 一気通貫で通り、バッジの shadow textContent に実トークン名が出ることを検証する。
 * 照合ロジック単体の網羅は tokenDict.test.ts が担保 (ここは配線の疎通確認)。
 */
test('注入したトークン名がバッジに描画される', async () => {
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

  await activate(page);
  await page.hover('#target');

  await expect(page.locator('domdom-inspector-overlay')).toBeAttached({ timeout: 3000 });

  // バッジに color hit (color/error) と size hit (spacing/sm) の両トークン名が描画される。
  // show() は ensureMounted→buildBadge を同期実行するが、微小タイミングに備え poll する。
  await expect
    .poll(async () => badgeText(page), { timeout: 3000 })
    .toContain('color/error');
  expect(await badgeText(page)).toContain('spacing/sm');

  await page.close();
});

/**
 * CSS 変数名優先 (既定): color/bg/padding が var(--x) 由来なら、生値でなく宣言変数名を主表示。
 * 実 Chrome の CSSOM 挙動 (matched-rule walk / var 入り shorthand 非展開) をここで固定する。
 */
test('宣言された CSS 変数名がバッジに主表示される', async () => {
  const page = await openFixture(VAR_FIXTURE_HTML);

  await activate(page);
  await page.hover('#target');

  await expect(page.locator('domdom-inspector-overlay')).toBeAttached({ timeout: 3000 });

  // color→--text / background→--surface / padding→--sp-2 の全変数名が出る
  await expect
    .poll(async () => badgeText(page), { timeout: 3000 })
    .toContain('--text');
  const text = await badgeText(page);
  expect(text).toContain('--surface');
  expect(text).toContain('--sp-2');

  await page.close();
});

/**
 * showVarNames=false の時は生値 (#hex) を主表示し変数名は出さない (トグルの疎通確認)。
 */
test('showVarNames=false で生値表示に切り替わる', async () => {
  const page = await openFixture(VAR_FIXTURE_HTML);

  // settings 経路で変数名優先を OFF にする (既存 settings 配線に相乗り)。
  // bridge は常に完全な settings ({...DEFAULT_SETTINGS,...stored}) を送るため、
  // overlay が参照する colors も含めて実契約に忠実な payload を渡す。
  await page.evaluate(
    (src) =>
      window.postMessage(
        {
          source: src,
          type: 'settings',
          payload: {
            showVarNames: false,
            badgeDetail: 'normal',
            colors: { mui: '#2196f3', custom: '#4caf50', thirdParty: '#9e9e9e' },
          },
        },
        '*',
      ),
    BRIDGE_SOURCE,
  );

  await activate(page);
  await page.hover('#target');

  await expect(page.locator('domdom-inspector-overlay')).toBeAttached({ timeout: 3000 });

  // color の生値 #eaedf4 が出て、変数名 --text は出ない
  await expect
    .poll(async () => badgeText(page), { timeout: 3000 })
    .toContain('#eaedf4');
  expect(await badgeText(page)).not.toContain('--text');

  await page.close();
});
