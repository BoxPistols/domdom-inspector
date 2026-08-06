import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Frame, type Page } from '@playwright/test';

/**
 * iframe を含むページでのモード同期 (issue #14)。
 *
 * content script は全フレームに注入されるため、モードの ON/OFF がフレームごとに独立して
 * いた。その結果 **Esc を親で押しても iframe は ON のまま残り、iframe 内のクリックが
 * 死んだまま**になっていた (インスペクタは click / pointerdown を capture で握りつぶす)。
 * さらにショートカットを押すと親子で位相が反転し、何度押しても両方 OFF にできない。
 *
 * ここで確かめるのは**実際の配布経路**: MAIN world → bridge → background →
 * tabs.sendMessage (frameId 未指定 = 全フレーム) → 各フレームの冪等 ON/OFF。
 * 途中のどこが切れても「クリックが復活しない」ので、この 1 本が配線全体の担保になる。
 *
 * 事前条件: `pnpm build` 済みで .output/chrome-mv3 が存在すること。
 */

const EXT_PATH = join(import.meta.dirname, '..', '.output', 'chrome-mv3');
const BRIDGE_SOURCE = 'domdom-inspector-bridge';
const FIXTURE_ORIGIN = 'http://localhost:9906';

/** 子フレーム: クリックが実際にページへ届いたかを数える (モード ON なら握りつぶされる) */
const CHILD_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>child</title></head>
<body style="margin:0;background:#eef">
  <button id="hit" style="padding:8px;margin:16px">click me</button>
  <script>
    window.__clicks = 0;
    document.getElementById('hit').addEventListener('click', function () {
      window.__clicks += 1;
    });
  </script>
</body></html>`;

const PARENT_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>parent</title></head>
<body style="margin:0">
  <button id="top-target" style="padding:16px;background:#c62828;color:#fff;border:0">top frame</button>
  <iframe id="f1" src="/child" style="width:400px;height:200px;border:0"></iframe>
  <script>
    window.__clicks = 0;
    document.getElementById('top-target').addEventListener('click', function () {
      window.__clicks += 1;
    });
  </script>
</body></html>`;

let context: BrowserContext;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ext-iframe-')), {
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
  });
  // overlay は closed shadow DOM。ピルの有無を読むため open に強制する (badge.spec と同手法)
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
    const isChild = new URL(route.request().url()).pathname.startsWith('/child');
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: isChild ? CHILD_HTML : PARENT_HTML,
    });
  });
  await page.goto(`${FIXTURE_ORIGIN}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => '__DOMDOM_INSPECTOR_LOADED__' in window);
  // 子フレームにも content script が入るのを待つ (入っていなければ同期の検証にならない)
  const child = await childFrame(page, '#f1');
  await child.waitForFunction(() => '__DOMDOM_INSPECTOR_LOADED__' in window);
  return { page, child };
}

/** iframe 要素に対応する Frame を取る */
async function childFrame(page: Page, selector: string): Promise<Frame> {
  const handle = await page.waitForSelector(selector);
  const frame = await handle.contentFrame();
  if (!frame) throw new Error(`contentFrame が取れない: ${selector}`);
  return frame;
}

/**
 * トグルを**トップフレームにだけ**送る。background の実装と同じ形
 * (`tabs.sendMessage(..., {frameId: 0})`) を再現している。全フレームに送ると各フレームが
 * 独立に反転するため、この 1 点が逆位相を防いでいる。
 */
async function toggleTopFrame(page: Page) {
  await page.evaluate(
    (src) =>
      new Promise<void>((resolve) => {
        window.postMessage({ source: src, type: 'toggle' }, '*');
        setTimeout(resolve, 0);
      }),
    BRIDGE_SOURCE,
  );
}

/**
 * トップフレームで Esc を発火する。**どのフレームが受けたかを曖昧にしないため**に
 * page.keyboard ではなく明示的な dispatch を使う (実キーの経路は③目視 QA が担保)。
 * Esc ハンドラは isTrusted を要求しないので、フレーム経路の検証としては等価。
 */
async function escapeInTopFrame(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        setTimeout(resolve, 0);
      }),
  );
}

/** そのフレームでモードピルが出ているか (トップだけが出す) */
async function pillVisible(target: Page | Frame): Promise<boolean> {
  return target.evaluate(() => {
    const host = document.querySelector('domdom-inspector-overlay') as
      | (Element & { __openRoot?: ShadowRoot })
      | null;
    const root = host?.__openRoot ?? host?.shadowRoot ?? null;
    return !!root?.querySelector('.inspect-pill.on');
  });
}

/** そのフレームのボタンを押し、ページへ届いた累計回数を返す (ON なら増えない) */
async function clickButton(target: Page | Frame, selector: string): Promise<number> {
  await target.click(selector, { force: true });
  return target.evaluate(() => (window as unknown as { __clicks: number }).__clicks);
}

const clickChildButton = (child: Frame) => clickButton(child, '#hit');
const clickTopButton = (page: Page) => clickButton(page, '#top-target');

test('モード ON はトップだけに送っても iframe へ伝わる (計測が iframe 内でも効く)', async () => {
  const { page, child } = await openFixture();

  await toggleTopFrame(page);

  // 子フレームにも ON が配られている = 子でホバーすると子の overlay が生える
  await child.hover('#hit');
  await expect
    .poll(async () => child.locator('domdom-inspector-overlay').count(), { timeout: 3000 })
    .toBeGreaterThan(0);

  // 子フレームのクリックは握りつぶされる (= 確かに ON。次のテストの対照になる)
  expect(await clickChildButton(child)).toBe(0);

  await page.close();
});

test('トップで Esc を押すと iframe 内のクリックが復活する (親だけ OFF にならない)', async () => {
  const { page, child } = await openFixture();

  await toggleTopFrame(page);
  await child.hover('#hit');
  await expect
    .poll(async () => child.locator('domdom-inspector-overlay').count(), { timeout: 3000 })
    .toBeGreaterThan(0);
  expect(await clickChildButton(child), 'ON の間は握りつぶされる').toBe(0);

  // **トップフレームだけで Esc**。以前はここで親しか OFF にならず、
  // iframe 内は永久にクリックできないままだった
  await escapeInTopFrame(page);

  await expect
    .poll(async () => clickChildButton(child), { timeout: 3000 })
    .toBeGreaterThan(0);

  // **押したフレーム自身も OFF のままであること。** 配った OFF が戻ってきて再び ON に
  // なる (冪等でない受け側) と、親のクリックだけが死ぬ別の壊れ方になる
  expect(await clickTopButton(page), 'Esc を押した親フレームでもクリックが通る').toBeGreaterThan(0);

  await page.close();
});

test('後から挿入した iframe があってもトグルで逆位相にならない', async () => {
  const { page, child } = await openFixture();

  await toggleTopFrame(page); // 全フレーム ON

  // **ここで本当に ON になっていることを先に確かめる。** これが無いと「最初から誰も ON に
  // ならない」壊れ方でもこのテストが緑になる (最後に全フレームでクリックが通るため)
  await expect.poll(async () => clickChildButton(child), { timeout: 3000 }).toBe(0);

  // **モード ON の後に iframe を増やす**。この子は OFF で始まるため、以前はここで
  // トグルを押すと「親 OFF / 新しい子 ON」の逆位相ができ、何度押しても揃わなかった
  await page.evaluate(
    (origin) =>
      new Promise<void>((resolve) => {
        const f = document.createElement('iframe');
        f.id = 'f2';
        f.src = `${origin}/child?late=1`;
        f.style.cssText = 'width:400px;height:200px;border:0';
        f.addEventListener('load', () => resolve());
        document.body.appendChild(f);
      }),
    FIXTURE_ORIGIN,
  );
  const late = await childFrame(page, '#f2');
  await late.waitForFunction(() => '__DOMDOM_INSPECTOR_LOADED__' in window);

  await toggleTopFrame(page); // トップは OFF になる → 全フレームへ OFF が配られる

  // 3 フレームすべてでクリックが通る = 全部 OFF (どこかが ON なら 0 のまま)
  await expect.poll(async () => clickChildButton(child), { timeout: 3000 }).toBeGreaterThan(0);
  await expect.poll(async () => clickChildButton(late), { timeout: 3000 }).toBeGreaterThan(0);
  expect(await clickTopButton(page), 'トップフレームでもクリックが通る').toBeGreaterThan(0);

  await page.close();
});

test('モードピルはトップフレームだけに出る (iframe の数だけ重複しない)', async () => {
  const { page, child } = await openFixture();

  await toggleTopFrame(page);
  // 子でもホバーして overlay を生成させる (ピルが無いのは「未生成だから」ではない)
  await child.hover('#hit');
  await expect
    .poll(async () => child.locator('domdom-inspector-overlay').count(), { timeout: 3000 })
    .toBeGreaterThan(0);

  await expect.poll(async () => pillVisible(page), { timeout: 3000 }).toBe(true);
  expect(await pillVisible(child), '子フレームにピルを出さない').toBe(false);

  await page.close();
});
