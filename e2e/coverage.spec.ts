import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type BrowserContext } from '@playwright/test';

/**
 * トークンカバレッジの end-to-end 検証。
 *
 * 純関数のテスト (src/coverage.test.ts) では「集計が正しいか」しか分からない。
 * ここで確かめるのは **実ブラウザで実際に数値が出るところまで繋がっているか**:
 *   popup の測定ボタン → tabs.sendMessage(design-scan) → bridge 中継 → MAIN world の
 *   scanDesign (実 computed style + 実 CSSOM) → popup の描画。
 * 途中のどこが切れても数値は出ないので、この 1 本が配線全体の担保になる。
 *
 * 事前条件: `pnpm build` 済みで .output/chrome-mv3 が存在すること。
 */

const EXT_PATH = join(import.meta.dirname, '..', '.output', 'chrome-mv3');

// types.ts の BRIDGE_SOURCE / PAGE_SOURCE と同値。rename されたらこのテストも落ちる (意図的)
const BRIDGE_SOURCE = 'domdom-inspector-bridge';
const PAGE_SOURCE = 'domdom-inspector-page';
const FIXTURE_ORIGIN = 'http://localhost:9903';

// 意図的に「トークン一致 / 野良値 / 変数経由 / ベタ書き」を作り分けた fixture。
// --brand は宣言済みなので var 経由、#c62828 はベタ書きの野良色になる。
const FIXTURE_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Coverage E2E</title>
<style>
  :root { --brand: #1668d4; }
  .via-var  { color: var(--brand); padding: 8px; }
  .literal  { color: #1668d4; padding: 8px; }
  .rogue    { color: #c62828; padding: 13px; }
</style></head>
<body style="margin:0">
  <div class="via-var">via var</div>
  <div class="via-var">via var 2</div>
  <div class="literal">literal but on token</div>
  <div class="rogue">rogue</div>
</body></html>`;

let context: BrowserContext;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ext-cov-')), {
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
  });
  // SW の起動を待つ = 拡張ロード完了の証拠 (extension id はこの spec では使わない)
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker');
  void sw;
});

test.afterAll(async () => {
  await context.close();
});

test('実ページの computed style と CSSOM からカバレッジ数値が出る', async () => {
  const page = await context.newPage();
  await page.route(`${FIXTURE_ORIGIN}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE_HTML }),
  );
  await page.goto(`${FIXTURE_ORIGIN}/`);
  await page.waitForFunction(() => '__DOMDOM_INSPECTOR_LOADED__' in window);
  await page.bringToFront();

  // 照合辞書は bridge の 'tokens' メッセージで注入する。
  // **storage 経由 (tokenDict) の中継は v1 の配線から外した** (issue #13 — 貼り付け UI が
  // 無いので書き込む側が存在しない)。MAIN world の受信経路は残っており、v1 の実際の供給元
  // (MUI テーマ自動検出) もこの経路で辞書を渡すので、ここを叩くのが実態に沿う。
  await page.evaluate(
    ({ bridge, dict }) =>
      new Promise<void>((resolve) => {
        window.postMessage({ source: bridge, type: 'tokens', payload: dict }, '*');
        setTimeout(resolve, 0);
      }),
    {
      bridge: BRIDGE_SOURCE,
      dict: {
        colors: [{ name: 'brand', r: 0x16, g: 0x68, b: 0xd4, a: 1 }],
        sizes: [{ name: 'space/2', px: 8, category: 'space' }],
      },
    },
  );

  // popup → tabs.sendMessage は tabs 権限が要る (テスト環境では未付与) ため、
  // bridge → MAIN world の往復をページ側から直接叩く。検証したいのは
  // 「実ブラウザの computed style と CSSOM で scanDesign が数値を出せるか」なので、
  // この経路で目的を満たす (popup 側の描画は unit/型で担保)。
  const scan = await page.evaluate(
    ({ bridge, pageSrc }) =>
      new Promise((resolve) => {
        const id = 'e2e-cov';
        const timer = setTimeout(() => resolve(null), 8000);
        window.addEventListener('message', function onMsg(event: MessageEvent) {
          const d = event.data;
          if (event.source !== window || !d || d.source !== pageSrc) return;
          if (d.type !== 'design-scan-result' || d.id !== id) return;
          clearTimeout(timer);
          window.removeEventListener('message', onMsg);
          resolve(d.payload ?? null);
        });
        window.postMessage({ source: bridge, type: 'design-scan', id }, '*');
      }),
    { bridge: BRIDGE_SOURCE, pageSrc: PAGE_SOURCE },
  );

  expect(scan, 'design-scan がトップフレームから返ること').toBeTruthy();
  const s = scan as {
    elementCount: number;
    truncated: boolean;
    originAvailable: boolean;
    styleSource: string;
    grid: number;
    coverage: {
      families: { family: string; judged: number; hit: number }[];
      matrix: { varHit: number; literalHit: number; literalMiss: number };
      overall: { judged: number; hit: number };
      originTrusted: boolean;
      top: {
        label: string;
        value: string;
        count: number;
        origins: { var: number; literal: number; other: number } | null;
      }[];
    };
  };

  expect(s.elementCount).toBeGreaterThan(0);
  expect(s.truncated).toBe(false);

  // 色ファミリが実際に判定できていること (computed style からの一致判定が生きている)
  const color = s.coverage.families.find((f) => f.family === 'color')!;
  expect(color.judged).toBeGreaterThan(0);
  expect(color.hit).toBeGreaterThan(0);

  // 来歴が実 CSSOM から取れていること = ハードコード検出の本体が動いている
  expect(s.originAvailable).toBe(true);
  expect(s.coverage.matrix.varHit, 'var(--brand) 経由の一致が拾えている').toBeGreaterThan(0);
  expect(s.coverage.matrix.literalHit, 'ベタ書きだが一致 が var と別に数えられている').toBeGreaterThan(0);
  expect(s.coverage.matrix.literalMiss, 'ベタ書きの野良値が拾えている').toBeGreaterThan(0);

  // 来歴ゲート (§6-1) が **過剰発火していない** こと。false に倒れると数値が静かに
  // 消えるだけで気づけないため、素の stylesheet で true になることを機械で固定する
  expect(s.styleSource).toBe('stylesheet');
  expect(s.coverage.originTrusted).toBe(true);

  // 野良値の来歴内訳が実 CSSOM から埋まっていること (13px はベタ書き)
  const rogue = s.coverage.top.find((t) => t.value === '13px');
  expect(rogue, '13px の padding が「直すと効く値」に出ている').toBeTruthy();
  expect(rogue?.origins?.literal, '13px がベタ書きとして数えられている').toBeGreaterThan(0);

  // グリッド刻み幅が結果に載っていること (popup がリテラルの 4 を書かないための前提)
  expect(s.grid).toBe(4);

  await page.close();
});
