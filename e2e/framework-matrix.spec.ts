import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * framework マトリクスの e2e (回帰防止体制): デザイン計測は React 非依存であるべき、を
 * framework 別の実 fixture で固定する。直近バグ (a7346c5 = 非React サイトで ↑ 親ナビが
 * 効かない) が「非React × 親ナビ」セルの欠落だったため、そのセルを最優先で機械充足する。
 * 事前条件: `pnpm build` 済みで .output/chrome-mv3 が存在すること。
 */

const EXT_PATH = join(import.meta.dirname, '..', '.output', 'chrome-mv3');
const BRIDGE_SOURCE = 'domdom-inspector-bridge';
const ORIGIN = 'http://localhost:9902';

// 非React: 入れ子 DOM (span → div(10px) → div(20px))。↑↓ で DOM 祖先/子を辿れることの回帰。
const PLAIN_DOM = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0">
  <div id="outer" style="padding:20px;background:#111">
    <div id="mid" style="padding:10px">
      <span id="target" style="color:#fff">deep</span>
    </div>
  </div>
</body></html>`;

// MUI production 相当: React なし・Mui*-root クラスのみ (fiber なし = _debug* 剥離相当)。
const MUI_CLASS = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0">
  <button id="target" class="MuiButton-root MuiButton-contained" style="padding:6px 16px;border-radius:4px;background:#1976d2;color:#fff">Save</button>
</body></html>`;

// Tailwind 風: ユーティリティクラス + それに対応する computed style。framework 非依存計測の証拠。
const TAILWIND = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>.p-4{padding:16px}.rounded-lg{border-radius:8px}.bg-slate-800{background:#1e293b}.text-white{color:#fff}</style></head>
<body style="margin:0">
  <div id="target" class="p-4 rounded-lg bg-slate-800 text-white">card</div>
</body></html>`;

// Web Components (open shadow root): ホストは padding 24px / 内部 button は 7px。
// shadow 境界を貫通できていなければ、カーソルは button の上なのに 24px が出てしまう。
const WEB_COMPONENT = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0">
  <my-card id="host"></my-card>
  <script>
    class MyCard extends HTMLElement {
      constructor() {
        super();
        const root = this.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent =
          ':host{display:block;padding:24px;background:#123456}' +
          'button{padding:7px;background:#abcdef;color:#000;border:0}';
        const button = document.createElement('button');
        button.id = 'inner';
        button.textContent = 'inner';
        root.append(style, button);
      }
    }
    customElements.define('my-card', MyCard);
  </script>
</body></html>`;

let context: BrowserContext;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ext-fw-')), {
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
  });
  // closed shadow をテストから読めるよう open 強制 (badge.spec と同手法)
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

async function open(html: string) {
  const page = await context.newPage();
  await page.route(`${ORIGIN}/**`, (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }),
  );
  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>)['__DOMDOM_INSPECTOR_LOADED__'],
    { timeout: 5000 },
  );
  return page;
}

/** inspect を起動し toggle 処理完了を待つ (順序依存排除) */
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

function badgeText(page: Page): Promise<string> {
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
 * 【回帰・最重要】非React サイトで ↑ が DOM 親へ、↓ が子へ遡れる。
 * span(target) → div#mid(padding:10px) → div#outer(padding:20px) を padding 値で識別する。
 */
test('非React: ↑↓ で DOM 親子を辿れる (a7346c5 回帰)', async () => {
  const page = await open(PLAIN_DOM);
  await activate(page);
  await page.hover('#target');

  await expect(page.locator('domdom-inspector-overlay')).toBeAttached({ timeout: 3000 });
  // 初期選択は span
  await expect.poll(() => badgeText(page), { timeout: 3000 }).toContain('<span>');

  // **この spec の前提の自己検査**: badgeText が overlay の CSS を拾っていないこと。
  // 拾うと 'pointer-events' 等の CSS 語が混ざり、px 値の assert が「CSS 側に同じ値がある
  // から通る」偽陽性になる (実際に 10px/20px/4px/8px/16px はすべて CSS に存在する)
  expect(await badgeText(page)).not.toContain('pointer-events');

  // ↑ → 親 div#mid (padding 10px)
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => badgeText(page), { timeout: 3000 }).toContain('10px');

  // ↑ → 祖父 div#outer (padding 20px)
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => badgeText(page), { timeout: 3000 }).toContain('20px');

  // ↓ → div#mid へ戻る (padding 10px)
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => badgeText(page), { timeout: 3000 }).toContain('10px');

  await page.close();
});

/** MUI production 相当 (React なし・Mui*-root クラス): バッジと design 値が出る */
test('MUI クラス (production 相当): バッジに design 値が出る', async () => {
  const page = await open(MUI_CLASS);
  await activate(page);
  await page.hover('#target');

  await expect(page.locator('domdom-inspector-overlay')).toBeAttached({ timeout: 3000 });
  // border-radius:4px が design チップに出る (framework 非依存計測)
  await expect.poll(() => badgeText(page), { timeout: 3000 }).toContain('4px');

  await page.close();
});

/** Tailwind 風ユーティリティ: framework 非依存の computed-style 計測が動く */
test('Tailwind 風ユーティリティ: design 値が出る', async () => {
  const page = await open(TAILWIND);
  await activate(page);
  await page.hover('#target');

  await expect(page.locator('domdom-inspector-overlay')).toBeAttached({ timeout: 3000 });
  // p-4 (padding:16px) と rounded-lg (border-radius:8px) が計測される
  await expect.poll(() => badgeText(page), { timeout: 3000 }).toContain('16px');
  expect(await badgeText(page)).toContain('8px');

  await page.close();
});

/**
 * Web Components (open shadow root): shadow 境界を貫通してカーソル直下の要素を計測する。
 *
 * 貫通していないと document.elementFromPoint が返すホスト (<my-card>) の値が出る。
 * これは「値が出ない」ではなく「**別の要素の値を出す**」= 利用者に区別のつかない誤答なので、
 * 内部 button の値が出ることと、ホストの値が出ないことの両方を assert する。
 * (closed shadow root で host に留まる挙動は src/inspector.test.ts が担保。この spec は
 * addInitScript で attachShadow を open 強制しているため closed を再現できない)
 */
test('Web Components: open shadow root の内部要素を計測する', async () => {
  const page = await open(WEB_COMPONENT);
  await activate(page);
  // Playwright のセレクタは open shadow root を貫通する
  await page.hover('#inner');

  await expect(page.locator('domdom-inspector-overlay')).toBeAttached({ timeout: 3000 });
  // 内部 button の値 (padding 7px / background #abcdef)
  await expect.poll(() => badgeText(page), { timeout: 3000 }).toContain('7px');
  const text = await badgeText(page);
  expect(text).toContain('#abcdef');
  // ホスト (<my-card> padding:24px / #123456) の値ではない
  expect(text).not.toContain('24px');
  expect(text).not.toContain('#123456');

  await page.close();
});
