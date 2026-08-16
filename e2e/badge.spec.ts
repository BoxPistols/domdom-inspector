import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { muiThemeRootHtml } from './fixtures/muiThemeFiber';

/**
 * badge スモーク (P1): ビルド済み拡張を Chromium にロードし、
 * localhost ページで inspect モードが起動しデザインバッジが描画されることを確認する。
 * 事前条件: `pnpm build` 済みで .output/chrome-mv3 が存在すること。
 *
 * テスト1: inspector toggle → hover → overlay.show() → ensureMounted() → DOM 追加 (因果)
 * テスト2: ページのテーマを拡張が自力で発見 → hover → バッジに実トークン名 (end-to-end)
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

/**
 * ThemeProvider を持つ React アプリの断面。**辞書は注入せず拡張が自力で発見する**
 * (v1 の実供給元と同じ経路 — issue #15 / #16)。テーマの値は fixture の実 CSS に合わせてある:
 * palette.error.main = #c62828 / spacing(1) = 8px / shape.borderRadius = 8px。
 */
const THEME_FIXTURE_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>DomDom Theme E2E Fixture</title></head>
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
  ${muiThemeRootHtml({
    palette: { error: { main: '#c62828' }, background: { paper: '#ffffff' } },
    spacing: 8,
    shape: { borderRadius: 8 },
    typography: { htmlFontSize: 16, body1: { fontSize: '1rem' } },
  })}
</body>
</html>`;

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

// カスケードの罠 fixture。**どちらも「勝者ではない宣言の変数名」を出しうるケース**:
//  ① :where() は specificity 0 なので、同じ (0,1,0) の .btn が source order で勝つ → --right
//  ② レイヤ無しの通常宣言はレイヤ内の宣言に勝つ (specificity に関係なく) → --unlayered
// 以前は :where の中身を id として数え、@layer を素通りしていたため両方で誤答していた。
const CASCADE_FIXTURE_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Cascade traps</title>
<style>
  :root { --wrong: #ff0000; --right: #00ff00; --layered: #0000ff; --unlayered: #ffff00; --same-green: #008000; }
  :where(#hero) .btn { color: var(--wrong); }
  .btn { color: var(--right); }
  @layer base { #panel .chip { background-color: var(--layered); } }
  .chip { background-color: var(--unlayered); }
  /* ③ 監査 (2026-08-07) が blocker 級として実測した形。**同じ色**に解決する 2 宣言で、
     レイヤ内の方が specificity が高い (0,2,0 > 0,1,0)。値が一致するので「変数名だけが嘘」
     になり、値の突き合わせでは気づけない。勝者は非レイヤの .only なので var 名は出ない */
  @layer base { .a.b { color: var(--same-green); } }
  .only { color: rgb(0, 128, 0); }
</style></head>
<body style="margin:0">
  <div id="hero"><button id="btn" class="btn">where trap</button></div>
  <div id="panel"><span id="chip" class="chip">layer trap</span></div>
  <p id="samecolor" class="a b only">layer trap (same value)</p>
</body></html>`;

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
 * 【a11y / issue #18】**分類を色だけで伝えない (SC 1.4.1)。**
 *
 * バッジ先頭の分類ドットは色に加えて形 (円 / 四角 / ひし形) でも 3 分類を示す。
 * ここで見るのは「形状クラスが実際に付いて、CSS 側に対応する定義がある」こと —
 * 形状クラスを付け忘れても色は出るので、目視では気づきにくい壊れ方になる。
 */
test('分類ドットに色以外の手がかり (形状) が付く', async () => {
  const page = await openFixture();

  await activate(page);
  await page.hover('#target');
  await expect(page.locator('domdom-inspector-overlay')).toBeAttached({ timeout: 3000 });

  const dot = await page.evaluate(() => {
    const host = document.querySelector('domdom-inspector-overlay') as
      | (Element & { __openRoot?: ShadowRoot })
      | null;
    const root = host?.__openRoot ?? host?.shadowRoot ?? null;
    const cdot = root?.querySelector('.badge .name .cdot') as HTMLElement | null;
    if (!cdot) return null;
    const style = getComputedStyle(cdot);
    return {
      classes: [...cdot.classList],
      // 形状は border-radius / transform で表現する。既定値のままなら
      // クラスは付いているが CSS 定義が無い = 見た目は変わっていない
      borderRadius: style.borderRadius,
      transform: style.transform,
      background: style.backgroundColor,
    };
  });

  expect(dot).not.toBeNull();
  const shape = dot!.classes.find((c) => ['circle', 'square', 'diamond'].includes(c));
  expect(shape).toBeDefined();
  // 色も従来どおり出ている (形は色の置き換えではなく追加)
  expect(dot!.background).not.toBe('rgba(0, 0, 0, 0)');
  // 形が実描画に効いていること: 円なら丸め、四角/ひし形なら丸め無し + 回転
  if (shape === 'circle') expect(dot!.borderRadius).toBe('50%');
  else if (shape === 'diamond') expect(dot!.transform).not.toBe('none');
  else expect(dot!.borderRadius).toBe('0px');

  await page.close();
});

/**
 * トークン照合パス (end-to-end)。**v1 の実供給元と同じ経路で辞書を得る**:
 * ページの React 内部から ThemeProvider のテーマを拡張が自力で発見し
 * (`src/muiTheme.ts` → `parseMuiTheme`)、fixture の background-color #c62828 /
 * padding 8px / border-radius 8px に一致するトークン名がバッジに出る。
 * hover → inspectElement → annotateProp → matchColor/matchSize → hit → バッジ描画 まで
 * 一気通貫で通る。照合ロジック単体の網羅は tokenDict.test.ts が担保。
 *
 * **以前は bridge を騙った `tokens` postMessage で注入していた** が、その経路は利用者から
 * 到達できず、かつページによる偽装の穴だったため閉じた (issue #15 / #16)。
 */
test('ページのテーマから自動検出したトークン名がバッジに描画される', async () => {
  const page = await openFixture(THEME_FIXTURE_HTML);

  await activate(page); // toggle の処理内で attemptThemeExtract が走る
  await page.hover('#target');

  await expect(page.locator('domdom-inspector-overlay')).toBeAttached({ timeout: 3000 });

  // palette.error.main (#c62828) / spacing(1) (8px) / shape.borderRadius (8px) が
  // テーマ由来の名前として注釈される。show() は同期だがテーマ発見は非同期なので poll する
  await expect
    .poll(async () => badgeText(page), { timeout: 5000 })
    .toContain('palette.error.main');
  const text = await badgeText(page);
  expect(text).toContain('spacing(1)');
  expect(text).toContain('shape.borderRadius');

  await page.close();
});

/**
 * 【セキュリティ / issue #16】**ページが注入した辞書で「一致」を偽装できない。**
 *
 * MAIN world はページと同一信頼境界なので、ページ側 JS は bridge を騙った postMessage を
 * 投げられる (source 文字列を真似るだけ)。以前は `{type:'tokens'}` を受理していたため、
 * ページが自前の辞書を注入して**バッジに好きなトークン名で「一致」を表示させられた**。
 * この製品の出力は「実装がデザイン定義に従っているか」の検証結果なので、
 * ページから検証結果を偽装できてはいけない。
 */
test('ページが postMessage で注入した辞書は無視される (偽装した一致が出ない)', async () => {
  const page = await openFixture(); // テーマを持たない fixture = 辞書は空のまま

  // fixture の実際の値 (#c62828 / 8px) にわざと一致させた偽の辞書を注入する
  await page.evaluate(
    (src) =>
      new Promise<void>((resolve) => {
        window.postMessage(
          {
            source: src,
            type: 'tokens',
            payload: {
              colors: [{ name: 'FORGED_COLOR_TOKEN', r: 198, g: 40, b: 40, a: 1 }],
              sizes: [{ name: 'FORGED_SIZE_TOKEN', px: 8, category: 'space' }],
            },
          },
          '*',
        );
        setTimeout(resolve, 0);
      }),
    BRIDGE_SOURCE,
  );

  await activate(page);
  await page.hover('#target');
  await expect(page.locator('domdom-inspector-overlay')).toBeAttached({ timeout: 3000 });

  // 計測自体は動いている (テストが「何も描かれていないから緑」になっていないことの確認)
  await expect.poll(async () => badgeText(page), { timeout: 3000 }).toContain('#c62828');
  const text = await badgeText(page);
  expect(text).not.toContain('FORGED_COLOR_TOKEN');
  expect(text).not.toContain('FORGED_SIZE_TOKEN');

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

/**
 * 【誤答の回帰】カスケードを取り違えて「由来でない CSS 変数名」を出さないこと。
 *
 * この製品は Tier2 (computed 値からの逆引き) を「由来でない変数名を由来と誤提示するのは
 * 検証の誠実性に反する」として却下している。ところが Tier1 の中で同じ誤りが起きていた:
 *  - `:where(#hero)` の中身を id として数えていた (仕様では :where は specificity 0)
 *  - `@layer` を素通りしていた (通常宣言はレイヤ無しが勝つ)
 * どちらも「実際には効いていない宣言の変数名」をバッジの主表示に出す = 看板機能の誤答。
 */
test('カスケードの勝者だけを由来として出す (:where / @layer)', async () => {
  const page = await openFixture(CASCADE_FIXTURE_HTML);
  await activate(page);

  await page.hover('#btn');
  await expect(page.locator('domdom-inspector-overlay')).toBeAttached({ timeout: 3000 });
  await expect.poll(() => badgeText(page), { timeout: 3000 }).toContain('--right');
  // :where() の中身を数えていた頃はこちらが出ていた
  expect(await badgeText(page)).not.toContain('--wrong');

  await page.hover('#chip');
  await expect.poll(() => badgeText(page), { timeout: 3000 }).toContain('--unlayered');
  // @layer を素通りしていた頃はこちらが出ていた
  expect(await badgeText(page)).not.toContain('--layered');

  // ③ **値が同じで変数名だけが嘘**になる形 (監査が blocker 級として実測したもの)。
  // レイヤ内の .a.b (0,2,0) が非レイヤの .only (0,1,0) より specificity は高いが、
  // 通常宣言はレイヤ無しが勝つ。勝者に var が無いので**変数名は出さず生値を出す**のが正しい
  await page.hover('#samecolor');
  await expect.poll(() => badgeText(page), { timeout: 3000 }).toContain('#008000');
  expect(
    await badgeText(page),
    '由来でない変数名 (--same-green) を由来として出してはいけない',
  ).not.toContain('--same-green');

  await page.close();
});

/**
 * 【他拡張との共存】React DevTools のグローバルフックを奪わないこと。
 *
 * RDT の installHook は `if (target.hasOwnProperty('__REACT_DEVTOOLS_GLOBAL_HOOK__')) return;`
 * で**丸ごと降りる**。こちらが document_start で先にシムを置くと **RDT が沈黙する**
 * (実測: RDT 7.0.1 で 6 試行中 4 回)。他拡張の中核機能を壊してよい理由は無いので、
 * グローバルの所有権は主張しない — それでも計測は DOM の Fiber から成立する。
 */
test('React DevTools のグローバルフックを自分から作らない', async () => {
  const page = await openFixture();

  const owns = await page.evaluate(() =>
    Object.prototype.hasOwnProperty.call(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__'),
  );
  expect(owns, '拡張がフックを設置していないこと').toBe(false);

  // フックが無くても計測は動く (Fiber は DevTools と無関係に DOM に付く)
  await activate(page);
  await page.hover('#target');
  await expect(page.locator('domdom-inspector-overlay')).toBeAttached({ timeout: 3000 });
  await expect.poll(() => badgeText(page), { timeout: 3000 }).toContain('#c62828');

  await page.close();
});

/**
 * 【セキュリティ / 誤答】ページからの不正 settings で計測が凍らないこと。
 *
 * MAIN world はページと同一信頼境界なので、防御の主目的は権限昇格ではなく
 * **「誤答させられないこと」**。以前は生 payload をそのまま overlay に渡していたため、
 * `payload:{}` を 1 回投げるだけで colors が消え、以後 show() が例外で落ちて
 * **どの要素をホバーしても前の要素の値を出し続ける**状態を外部から作れた (実測)。
 */
test('ページが投げた空の settings で計測が凍らない', async () => {
  const page = await openFixture(CASCADE_FIXTURE_HTML);
  await activate(page);

  await page.hover('#btn');
  await expect.poll(() => badgeText(page), { timeout: 3000 }).toContain('--right');

  // bridge を騙って空 payload を送る
  await page.evaluate(
    (src) =>
      new Promise<void>((resolve) => {
        window.postMessage({ source: src, type: 'settings', payload: {} }, '*');
        setTimeout(resolve, 50);
      }),
    BRIDGE_SOURCE,
  );

  // 別要素へ移ると、その要素の値が出る (前の要素の値で凍らない)
  await page.hover('#chip');
  await expect.poll(() => badgeText(page), { timeout: 3000 }).toContain('--unlayered');
  expect(await badgeText(page)).not.toContain('--right');

  await page.close();
});

/**
 * v1 で到達不能なサーフェス (render/tree) の実 DOM を作らないこと (監査 2026-08-07)。
 * 以前は mount のたびに canvas + 2D context / stats / rctl / tree の 4 要素を
 * 使われないままページごとに注入していた。遅延生成に変えた回帰を固定する。
 */
test('モード ON + ホバーでも到達不能なサーフェスの DOM を作らない', async () => {
  const page = await openFixture();
  await activate(page);
  await page.hover('#target');
  await expect(page.locator('domdom-inspector-overlay')).toBeAttached({ timeout: 3000 });

  const surfaces = await page.evaluate(() => {
    const host = document.querySelector('domdom-inspector-overlay') as
      | (Element & { __openRoot?: ShadowRoot })
      | null;
    const root = host?.__openRoot ?? host?.shadowRoot ?? null;
    if (!root) return null;
    return {
      canvas: root.querySelectorAll('.render-canvas').length,
      stats: root.querySelectorAll('.stats').length,
      rctl: root.querySelectorAll('.rctl').length,
      tree: root.querySelectorAll('.tree').length,
      // 生きているサーフェスは存在する (テストが「何も無いから 0」になっていない証拠)
      badge: root.querySelectorAll('.badge').length,
    };
  });
  expect(surfaces).toEqual({ canvas: 0, stats: 0, rctl: 0, tree: 0, badge: 1 });

  await page.close();
});

/**
 * ページ側 JS が overlay host ごと DOM から外しても、次の描画で**ピルごと**復元される
 * (以前はモード ON のまま終了導線 (ピル) だけが消えた — 監査 2026-08-07)。
 */
test('ページが overlay を外してもモードピルが復元される', async () => {
  const page = await openFixture();
  await activate(page);
  await page.hover('#target');
  await expect(page.locator('domdom-inspector-overlay')).toBeAttached({ timeout: 3000 });

  const pillVisible = () =>
    page.evaluate(() => {
      const host = document.querySelector('domdom-inspector-overlay') as
        | (Element & { __openRoot?: ShadowRoot })
        | null;
      const root = host?.__openRoot ?? host?.shadowRoot ?? null;
      return !!root?.querySelector('.inspect-pill.on');
    });
  expect(await pillVisible(), 'ON 直後はピルが出ている').toBe(true);

  // ページが host を丸ごと外す (仮想 DOM の巻き戻し・body 差し替え相当)
  await page.evaluate(() => document.querySelector('domdom-inspector-overlay')?.remove());
  await expect(page.locator('domdom-inspector-overlay')).not.toBeAttached();

  // 次のホバーで overlay が再マウントされ、ピルも一緒に戻る。
  // いったん #target の外 (素の body) へ動かして選択を変えないと、同一要素の
  // pointermove は早期 return して再描画が走らない
  await page.mouse.move(600, 400);
  await page.hover('#target');
  await expect(page.locator('domdom-inspector-overlay')).toBeAttached({ timeout: 3000 });
  await expect.poll(pillVisible, { timeout: 3000 }).toBe(true);

  await page.close();
});
