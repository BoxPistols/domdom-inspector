import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * 右クリックメニュー導線の検証。
 *
 * Chrome のネイティブメニュー自体は Playwright から開けない (OS レベルの UI) ため、
 * ここで確かめるのは **こちらが実装した半分**:
 *   contextmenu イベントで対象要素を控える → bridge のメッセージで
 *   inspect-at-context / open-editor-at-context を受ける → 対象要素に対して結果を出す。
 * background → bridge の残り半分はメッセージ型の文字列一致で繋がっており、
 * 型を変えると e2e ではなく grep/ビルドで気づく箇所 (src/inspector.test.ts が単体を担保)。
 *
 * この経路が重要な理由: メニュー項目を出しておいて無反応、が最悪の壊れ方であり、
 * 「モード OFF から 1 アクションで結果まで到達する」ことを機械で固定する必要がある。
 *
 * 事前条件: `pnpm build` 済みで .output/chrome-mv3 が存在すること。
 */

const EXT_PATH = join(import.meta.dirname, '..', '.output', 'chrome-mv3');

// types.ts の BRIDGE_SOURCE と同値。rename されたらこのテストも落ちる (意図的)
const BRIDGE_SOURCE = 'domdom-inspector-bridge';
const FIXTURE_ORIGIN = 'http://localhost:9905';

const FIXTURE_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>DomDom ContextMenu E2E</title></head>
<body style="margin:0">
  <div id="target" style="width:180px;height:80px;background-color:#c62828;padding:13px;color:#fff;font-size:16px">Right-click me</div>
  <div id="other" style="width:180px;height:80px;background-color:#1668d4;padding:8px">Not me</div>
</body></html>`;

let context: BrowserContext;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ext-ctx-')), {
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
  });
  // overlay は closed shadow DOM。テストから文言を読むため open に強制する (badge.spec と同手法)
  await context.addInitScript(() => {
    const orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit): ShadowRoot {
      const root = orig.call(this, { ...init, mode: 'open' });
      (this as Element & { __openRoot?: ShadowRoot }).__openRoot = root;
      return root;
    };
  });
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker');
  void sw;
});

test.afterAll(async () => {
  await context.close();
});

async function openFixture() {
  const page = await context.newPage();
  await page.route(`${FIXTURE_ORIGIN}/**`, (route) => {
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: FIXTURE_HTML });
  });
  await page.goto(`${FIXTURE_ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>)['__DOMDOM_INSPECTOR_LOADED__'],
    { timeout: 5000 },
  );
  return page;
}

/** 実際の右クリックで contextmenu を発火させ、その後 bridge のメッセージを流す */
async function rightClickThen(page: Page, selector: string, type: string) {
  await page.click(selector, { button: 'right' });
  await page.evaluate(
    ({ src, t }) =>
      new Promise<void>((resolve) => {
        window.postMessage({ source: src, type: t }, '*');
        setTimeout(resolve, 0);
      }),
    { src: BRIDGE_SOURCE, t: type },
  );
}

/** open 化した shadow root の textContent */
async function overlayText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const host = document.querySelector('domdom-inspector-overlay') as
      | (Element & { __openRoot?: ShadowRoot })
      | null;
    const root = host?.__openRoot ?? host?.shadowRoot ?? null;
    return root?.textContent ?? '';
  });
}

test('右クリックした要素が「この要素を検査」で選択される (モード OFF から 1 アクション)', async () => {
  const page = await openFixture();

  // トグル操作は一切していない = overlay はまだ存在しない
  await expect(page.locator('domdom-inspector-overlay')).not.toBeAttached();

  await rightClickThen(page, '#target', 'inspect-at-context');

  await expect(page.locator('domdom-inspector-overlay')).toBeAttached({ timeout: 3000 });
  const text = await overlayText(page);
  // 右クリックした要素の計測値が出ている (#c62828 / padding 13px)
  expect(text).toContain('#c62828');
  expect(text).toContain('13px');
  // 別要素の値は出ていない (contextmenu の target を使っている証拠)
  expect(text).not.toContain('#1668d4');

  await page.close();
});

test('別の要素を右クリックし直すと対象が切り替わる', async () => {
  const page = await openFixture();

  await rightClickThen(page, '#target', 'inspect-at-context');
  expect(await overlayText(page)).toContain('#c62828');

  await rightClickThen(page, '#other', 'inspect-at-context');
  const text = await overlayText(page);
  expect(text).toContain('#1668d4');
  expect(text).not.toContain('#c62828');

  await page.close();
});

test('「ソースをエディタで開く」は開けない要素でも理由を出す (無反応にしない)', async () => {
  const page = await openFixture();

  await rightClickThen(page, '#target', 'open-editor-at-context');

  // 素の DOM 要素 (React でない) なので、理由がトーストで出る。
  // ランナーの UI ロケールで en/ja のどちらが出るかが変わるため両方を許容する
  // (どちらかが出ること自体が「bridge が i18n を配信できている」証拠にもなる)
  await expect(page.locator('domdom-inspector-overlay')).toBeAttached({ timeout: 3000 });
  await expect
    .poll(async () => await overlayText(page), { timeout: 3000 })
    .toMatch(/not a React component|React コンポーネントではない/);

  await page.close();
});

/**
 * 【セキュリティ】ページが合成した contextmenu では対象を掴まない。
 *
 * MAIN world は同一信頼境界で、**ページ側の JS は bridge からの postMessage を偽装できる**
 * (source 文字列を真似るだけ)。`open-editor-at-context` を偽装されると、ページが自前で
 * 偽装した `__reactFiber$` の `_debugSource` を使って**ユーザーのエディタで任意のパスを
 * 開かせられる**。対象要素を「信頼済みの contextmenu 直後」に限ることで、
 * 合成イベントで仕込む経路を塞いでいる (isTrusted はページから付けられない)。
 */
test('ページが合成した contextmenu + 偽装メッセージでは何も起きない', async () => {
  const page = await openFixture();

  // ページ自身が contextmenu を合成して対象を仕込もうとする (isTrusted=false)
  await page.evaluate(() => {
    document
      .querySelector('#target')
      ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true }));
  });
  // そのうえで bridge を騙った postMessage を投げる
  await page.evaluate(
    (src) =>
      new Promise<void>((resolve) => {
        window.postMessage({ source: src, type: 'inspect-at-context' }, '*');
        window.postMessage({ source: src, type: 'open-editor-at-context' }, '*');
        setTimeout(resolve, 200);
      }),
    BRIDGE_SOURCE,
  );

  // 何も起きない = overlay が生成されない (toast も出ない)
  await expect(page.locator('domdom-inspector-overlay')).not.toBeAttached();

  // 対照: 本物の右クリックなら動く (テスト自体が無意味になっていないことの確認)
  await rightClickThen(page, '#target', 'inspect-at-context');
  await expect(page.locator('domdom-inspector-overlay')).toBeAttached({ timeout: 3000 });

  await page.close();
});
