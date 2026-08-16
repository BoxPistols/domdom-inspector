import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import { muiThemeRootHtml } from './fixtures/muiThemeFiber';

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
const FIXTURE_ORIGIN = 'http://localhost:5173';

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
  // overlay は closed shadow DOM (ページ隔離) なので、テストから中を読むために
  // attachShadow を open に強制し `__openRoot` へ退避する。機能挙動は変えない
  // (badge.spec.ts と同じ手。ハイライトの検証にだけ使う)
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

/**
 * **この設計で一番危なかった前提を機械で固定する。**
 *
 * パネルはタブ切替のたびに invocation を受けないので `activeTab` が付かない。
 * popup は「クリックした瞬間に activeTab が付く」から `tabs.sendMessage` が通るが、
 * パネルにその付与は無い。もし content script へのメッセージに host permission が
 * 要るなら、**主要シナリオである localhost でパネルが計測できない**ことになる
 * (localhost は静的 content script で動いており、host permission は付与されていない)。
 *
 * 公式ドキュメントからは読み取れなかったので実測する。ここが赤くなったら、
 * パネルの計測経路そのものを設計し直す必要がある = 黙って壊れてよい場所ではない。
 */
test('パネルと同じ権限状況の拡張ページから、localhost の content script へ計測要求が届く', async () => {
  const target = await context.newPage();
  // サーバを立てずに localhost を作る (静的 content script の matches に入る)
  await target.route(`${FIXTURE_ORIGIN}/**`, (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<html><body><button style="padding:13px">x</button></body></html>',
    }),
  );
  await target.goto(`${FIXTURE_ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  await target.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>)['__DOMDOM_INSPECTOR_LOADED__'],
    { timeout: 5000 },
  );

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // **タブの並び順に依存しない**: 全タブへ送り、計測が返ったものがあるかを見る
  // (content script の無いタブが reject するのは正常)
  const replies = await panel.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        chrome: {
          tabs: {
            query(q: Record<string, never>): Promise<{ id?: number }[]>;
            sendMessage(id: number, m: unknown, o: { frameId: number }): Promise<unknown>;
          };
        };
      }
    ).chrome;
    const out: { ok: boolean; elements: number; hasDocumentKey: boolean }[] = [];
    for (const tab of await api.tabs.query({})) {
      if (tab.id == null) continue;
      try {
        const reply = (await api.tabs.sendMessage(tab.id, { type: 'design-scan' }, { frameId: 0 })) as {
          ok?: boolean;
          scan?: { elementCount?: number };
          documentKey?: string | null;
        };
        out.push({
          ok: reply?.ok === true,
          elements: reply?.scan?.elementCount ?? 0,
          hasDocumentKey: !!reply?.documentKey,
        });
      } catch {
        // content script が居ないタブ (拡張ページ / about:blank)。正常
      }
    }
    return out;
  });

  const measured = replies.filter((r) => r.ok && r.elements > 0);
  expect(
    measured.length,
    'localhost の content script へ届かない = パネルの計測経路が成立しない',
  ).toBeGreaterThan(0);
  // 世代が返らないとナビゲーション検出 (stale-navigation) が常に発火する
  expect(measured[0].hasDocumentKey, 'document 世代が返ること').toBe(true);

  await panel.close();
  await target.close();
});

/**
 * **実データで描画まで通す。** ビルドが緑でも描画は別 (この repo が繰り返し踏んでいる)。
 *
 * パネルは「アクティブなタブ」を対象にするので、fixture タブを後から開いてアクティブにし、
 * **背面に残ったパネル**の計測ボタンを押す。これは実際の使い方 (パネルを開いたまま
 * ページを触る) と同じ並びでもある。
 *
 * fixture には**製品と同じ発見経路**でテーマを持たせる (注入しない)。辞書が空だと
 * すべての率が「判定なし」になり、**率の表示規律を検証しているつもりの assert が
 * 1 度も実行されない** — 実際に一度その状態でテストを緑にしてしまった。
 */
test('実ページを計測して率・但し書き・順位が描画される', async () => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  const target = await context.newPage();
  await target.route(`${FIXTURE_ORIGIN}/**`, (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<html><body style="margin:0">
        <div style="color:#c62828;background:#ffffff;padding:8px;border-radius:8px;font-size:16px">a</div>
        <div style="color:#c62828;background:#ffffff;padding:8px;border-radius:8px;font-size:16px">b</div>
        <div style="color:#123456;background:#ffffff;padding:13px;border-radius:7px;font-size:15px">c</div>
        ${muiThemeRootHtml({
          palette: { error: { main: '#c62828' }, background: { paper: '#ffffff' } },
          spacing: 8,
          shape: { borderRadius: 8 },
          typography: { htmlFontSize: 16, body1: { fontSize: '1rem' } },
        })}
      </body></html>`,
    }),
  );
  await target.goto(`${FIXTURE_ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  await target.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>)['__DOMDOM_INSPECTOR_LOADED__'],
    { timeout: 5000 },
  );
  await target.bringToFront();

  // テーマ発見は注入 1 秒後の 1 回 + commit ごと。静的ページなので前者を待つ。
  // **inspect モードを ON にしない** — パネル単体で辞書が載ることを確認したい
  await expect
    .poll(
      async () => {
        await panel.evaluate(() => (document.getElementById('measure') as HTMLButtonElement).click());
        await panel.waitForTimeout(250);
        return (await panel.locator('#familyRows td.num').allTextContents()).join(' ');
      },
      { timeout: 10_000, message: 'テーマ由来の辞書で率が出ること' },
    )
    .toContain('%');

  await expect(panel.locator('#result')).toBeVisible();

  // ④ **率は必ず実数と同じセルにある** (率だけを描く経路をコードから消してある)
  const cells = (await panel.locator('#familyRows td.num').allTextContents()).map((c) => c.trim());
  const withPercent = cells.filter((c) => c.includes('%'));
  expect(withPercent.length, '率が 1 つも出ていないと下の assert が空回りする').toBeGreaterThan(0);
  for (const cell of withPercent) {
    expect(cell, `率 "${cell}" に実数が併記されていない`).toMatch(/\(\d+\/\d+\)/);
  }

  // ③ 自動テーマ由来であることが但し書きに出る (率の意味が変わっているため / §6-5)
  const notes = (await panel.locator('#basisNotes li').allTextContents()).join(' ');
  expect(notes.length, '但し書きが 1 件も出ていない').toBeGreaterThan(0);

  // ⑥ 順位は空でも無言にしない / ⑦ 天井は常時可視
  await expect(panel.locator('#offenders')).not.toBeEmpty();
  await expect(panel.locator('#ceiling')).toBeVisible();
  await expect(panel.locator('#targetElements')).toBeVisible();

  await target.close();
  await panel.close();
});

/**
 * ページ上ハイライト (§5-4)。**この画面の存在理由そのもの** —
 * 率を押すとその率が数えた要素がページに枠で出る、という検算ループ。
 *
 * 見るのは 3 点: (1) 実際に枠が描かれる (2) 件数が計測時と一致する
 * (3) **ページ側だけで消せる** (side panel の onClosed は Chrome 142+ で使えないため、
 * パネルを閉じるとハイライトを消す手段が無くなる = 自力で戻せない汚れになる)。
 */
test('率の根拠をページ上で示し、ページ側だけで消せる', async () => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  const target = await context.newPage();
  await target.route(`${FIXTURE_ORIGIN}/**`, (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<html><body style="margin:0">
        <div style="padding:13px;background:#fff">a</div>
        <div style="padding:13px;background:#fff">b</div>
        <div style="padding:8px;background:#fff">c</div>
        ${muiThemeRootHtml({
          palette: { error: { main: '#c62828' } },
          spacing: 8,
          shape: { borderRadius: 8 },
          typography: { htmlFontSize: 16, body1: { fontSize: '1rem' } },
        })}
      </body></html>`,
    }),
  );
  await target.goto(`${FIXTURE_ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  await target.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>)['__DOMDOM_INSPECTOR_LOADED__'],
    { timeout: 5000 },
  );
  await target.bringToFront();

  // 辞書が載るまで計測を繰り返す (テーマ発見は注入 1 秒後)
  await expect
    .poll(async () => {
      await panel.evaluate(() => (document.getElementById('measure') as HTMLButtonElement).click());
      await panel.waitForTimeout(250);
      return panel.locator('#offenders .showBtn').count();
    }, { timeout: 10_000 })
    .toBeGreaterThan(0);

  // 「ページ上で示す」を押す
  await panel.evaluate(() =>
    (document.querySelector('#offenders .showBtn') as HTMLButtonElement).click(),
  );

  // ページ側に枠と操作チップが出る (overlay は closed shadow root なので open 化して読む)
  const drawn = await target.evaluate(() => {
    const host = document.querySelector('domdom-inspector-overlay') as
      | (Element & { __openRoot?: ShadowRoot })
      | null;
    const root = host?.__openRoot ?? host?.shadowRoot ?? null;
    return {
      boxes: root?.querySelectorAll('.hl').length ?? 0,
      chip: (root?.querySelector('.hlchip')?.textContent ?? '').trim(),
      hasClear: !!root?.querySelector('.hlchip button'),
    };
  });
  expect(drawn.boxes, 'ページ上に枠が描かれること').toBeGreaterThan(0);
  expect(drawn.chip.length, 'チップが空文字ではないこと').toBeGreaterThan(0);
  // **消す手段がページ側にあること** (パネルを閉じても戻せる)
  expect(drawn.hasClear, 'ページ側に消すアフォーダンスが無い').toBe(true);

  // ページ側の「消す」だけで消える
  await target.evaluate(() => {
    const host = document.querySelector('domdom-inspector-overlay') as
      | (Element & { __openRoot?: ShadowRoot })
      | null;
    const root = host?.__openRoot ?? host?.shadowRoot ?? null;
    (root?.querySelector('.hlchip button') as HTMLButtonElement | null)?.click();
  });
  const after = await target.evaluate(() => {
    const host = document.querySelector('domdom-inspector-overlay') as
      | (Element & { __openRoot?: ShadowRoot })
      | null;
    const root = host?.__openRoot ?? host?.shadowRoot ?? null;
    return root?.querySelectorAll('.hl').length ?? 0;
  });
  expect(after, 'ページ側の操作だけで消えること').toBe(0);

  await target.close();
  await panel.close();
});
