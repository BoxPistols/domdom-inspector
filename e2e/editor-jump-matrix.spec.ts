import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * **エディタジャンプの環境マトリクス。**
 *
 * この機能は環境ごとに「ソース位置がどこから来るか」が違い、実装があることと動くことは
 * 別だった (2026-08 に 20 版以上かけて実証してしまった)。よって断面ごとに、
 * **拡張が実際に何を開こうとしたか**を実ブラウザで採取して固定する。
 *
 * 観測の仕方: エディタ起動は `a[href="<scheme>://…"]` の click、dev サーバ経由は
 * fetch。両方を横取りして記録する。
 */

const EXT_PATH = join(import.meta.dirname, '..', '.output', 'chrome-mv3');
const ORIGIN = 'http://localhost:5173';
const BRIDGE_SOURCE = 'domdom-inspector-bridge';

let context: BrowserContext;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ext-matrix-')), {
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
  });
  await context.addInitScript(() => {
    const orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit): ShadowRoot {
      const root = orig.call(this, { ...init, mode: 'open' });
      (this as Element & { __openRoot?: ShadowRoot }).__openRoot = root;
      return root;
    };
    // エディタ起動を横取りして記録する (実際にアプリを起動させない)
    const w = window as unknown as { __editorHrefs?: string[] };
    w.__editorHrefs = [];
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      w.__editorHrefs?.push(this.href);
    };
  });
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker');
  void sw;
});

test.afterAll(async () => {
  await context.close();
});

/** dev サーバ経由の要求も記録する (launch-editor の応答形をまねる) */
async function openFixture(body: string) {
  const page = await context.newPage();
  const devServerRequests: string[] = [];
  // **登録順に注意**: Playwright は後から登録した route が先に評価される。
  // 先に catch-all を置き、あとから dev サーバの口を上書きする
  await page.route(`${ORIGIN}/**`, (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body }),
  );
  await page.route(/\/__(open-in-editor|nextjs_launch-editor|open-stack-frame-in-editor)/, (route) => {
    devServerRequests.push(route.request().url());
    // launch-editor の応答形: 200 / content-type 無し / 0 バイト
    route.fulfill({ status: 200, body: '' });
  });
  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>)['__DOMDOM_INSPECTOR_LOADED__'],
    { timeout: 5000 },
  );
  await page.evaluate(
    (src) =>
      new Promise<void>((resolve) => {
        window.postMessage({ source: src, type: 'toggle' }, '*');
        setTimeout(resolve, 0);
      }),
    BRIDGE_SOURCE,
  );
  return { page, devServerRequests };
}

/** 対象を ⌘Click し、拡張が何を開こうとしたかを返す */
async function cmdClick(page: Page, selector: string) {
  await page.hover(selector);
  await page.waitForTimeout(150);
  await page.click(selector, { modifiers: ['Meta'] });
  await page.waitForTimeout(1200);
  return page.evaluate(() => {
    const w = window as unknown as { __editorHrefs?: string[] };
    const host = document.querySelector('domdom-inspector-overlay') as
      | (Element & { __openRoot?: ShadowRoot })
      | null;
    const root = host?.__openRoot ?? host?.shadowRoot ?? null;
    return {
      hrefs: w.__editorHrefs ?? [],
      toast: (root?.querySelector('.toast')?.textContent ?? '').trim(),
    };
  });
}

const page$ = (inner: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>#t{padding:13px;background:#fff}</style></head><body style="margin:0">${inner}</body></html>`;

test('Vue / Nuxt: data-v-inspector から位置を取り、dev サーバへ渡す', async () => {
  // vite-plugin-vue-inspector が出す形。**パスはプロジェクト相対**なので、
  // ディスク上の位置は dev サーバにしか解決できない
  const { page, devServerRequests } = await openFixture(
    page$('<div id="t" data-v-inspector="src/components/Card.vue:42:7">card</div>'),
  );
  const result = await cmdClick(page, '#t');

  const asked = devServerRequests.join(' ');
  expect(asked, 'dev サーバへ要求していない').toContain('__open-in-editor');
  expect(decodeURIComponent(asked)).toContain('src/components/Card.vue:42:7');
  expect(result.toast, '渡した内容を伝える').toContain('src/components/Card.vue:42');
  await page.close();
});

test('react-dev-inspector: パスと行が別属性でも読む', async () => {
  const { page, devServerRequests } = await openFixture(
    page$(
      '<div id="t" data-inspector-relative-path="src/App.tsx" data-inspector-line="9" data-inspector-column="4">x</div>',
    ),
  );
  await cmdClick(page, '#t');
  expect(decodeURIComponent(devServerRequests.join(' '))).toContain('src/App.tsx:9:4');
  await page.close();
});

test('Express / サーバ描画: 汎用の data-source を読む', async () => {
  const { page, devServerRequests } = await openFixture(
    page$('<div id="t" data-source="views/home.ejs:8">home</div>'),
  );
  await cmdClick(page, '#t');
  expect(decodeURIComponent(devServerRequests.join(' '))).toContain('views/home.ejs:8');
  await page.close();
});

test('React 18 相当: _debugSource の絶対パスはスキームで直接開く (設定ゼロ)', async () => {
  const { page, devServerRequests } = await openFixture(page$('<div id="t">x</div>'));
  // production 剥離前の dev ビルドの断面を作る
  await page.evaluate(() => {
    const el = document.getElementById('t') as unknown as Record<string, unknown>;
    const owner = {
      tag: 0,
      type: function App() {},
      _debugOwner: null,
      _debugSource: { fileName: '/Users/me/app/src/App.tsx', lineNumber: 21, columnNumber: 5 },
    };
    el.__reactFiber$test = { tag: 5, stateNode: el, return: owner };
  });
  const result = await cmdClick(page, '#t');

  expect(result.hrefs.join(' '), 'スキームで直接開く').toContain(
    '/Users/me/app/src/App.tsx:21:5',
  );
  expect(devServerRequests, '絶対パスなら dev サーバへは出さない').toEqual([]);
  await page.close();
});

test('素の HTML/CSS: 開けるものが無ければ、間違ったものを開かず手がかりを出す', async () => {
  const { page, devServerRequests } = await openFixture(page$('<div id="t">plain</div>'));
  const result = await cmdClick(page, '#t');

  // **一番大事なのは「間違ったものを開かない」こと。** 生成物や存在しないパスを
  // エディタへ送ると「存在しません」で終わり、利用者は原因に辿り着けない
  expect(result.hrefs, 'エディタへは何も投げない').toEqual([]);
  expect(devServerRequests, 'dev サーバへも出さない').toEqual([]);
  // 黙って終わらせない
  expect(result.toast.length, 'トーストが空').toBeGreaterThan(0);
  await page.close();
});
