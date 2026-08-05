#!/usr/bin/env node
// Chrome Web Store 提出用スクリーンショット (1280×800) を**実物から**生成する。
//
// なぜ自動化するか:
//   Public 公開では「スクリーンショットは実物と一致していなければならない」(合成・モックは不可)。
//   手で撮ると UI を変えるたびに古い画像が残り、掲載文と実装の不一致として審査で拾われる。
//   ビルド済み拡張を実 Chromium にロードして撮れば、要件を満たしたまま何度でも作り直せる。
//
// 出力: docs/store-assets/*.png (1280×800)
// 前提: pnpm build 済み (.output/chrome-mv3 が存在すること)

import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXT_PATH = join(ROOT, '.output', 'chrome-mv3');
const OUT_BASE = join(ROOT, 'docs', 'store-assets');
/**
 * 掲載言語ごとに撮る。既定 locale は en (manifest の default_locale) なので、
 * **英語版が主**。日本語版の掲載文を出すなら ja の画像も要る。
 * Chrome 拡張の i18n はブラウザ UI 言語に従うため、--lang と context locale で切り替える。
 */
const LOCALES = ['en', 'ja'];
const SIZE = { width: 1280, height: 800 };

// types.ts の BRIDGE_SOURCE と同値 (rename されたらここも直す)
const BRIDGE_SOURCE = 'domdom-inspector-bridge';
// 静的注入の対象オリジン (src/matches.ts)。撮影用ページはここで配信する
const ORIGIN = 'http://localhost:9910';

/**
 * 撮影用のデモ画面。**実際のプロダクト UI に近い体裁**にする (審査官が「何を計測して
 * いるのか」を 1 枚で理解できる必要があるため)。CSS 変数で宣言した値と、グリッドから
 * 外れた値 (13px) を意図的に混ぜてあり、拡張の主機能がそのまま画面に出る。
 */
const DEMO_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Acme Console</title>
<style>
  :root {
    --brand-600: #1668d4; --brand-50: #eaf2fd; --ink-900: #101828; --ink-500: #667085;
    --surface: #ffffff; --canvas: #f6f8fb; --line: #e4e7ec;
    --space-2: 8px; --space-4: 16px; --space-6: 24px; --radius-md: 8px;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 system-ui, sans-serif; color: var(--ink-900); background: var(--canvas); }
  header {
    display: flex; align-items: center; justify-content: space-between;
    padding: var(--space-4) var(--space-6); background: var(--surface);
    border-bottom: 1px solid var(--line);
  }
  .logo { font-weight: 700; font-size: 16px; color: var(--brand-600); }
  nav { display: flex; gap: var(--space-6); color: var(--ink-500); }
  main { display: grid; grid-template-columns: 220px 1fr; gap: var(--space-6); padding: var(--space-6); }
  aside { display: flex; flex-direction: column; gap: var(--space-2); }
  aside a { padding: var(--space-2) 12px; border-radius: var(--radius-md); color: var(--ink-500); text-decoration: none; }
  aside a.on { background: var(--brand-50); color: var(--brand-600); font-weight: 600; }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-4); }
  .card {
    background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-md);
    padding: var(--space-4);
  }
  .card h3 { margin: 0 0 var(--space-2); font-size: 13px; color: var(--ink-500); font-weight: 600; }
  .card .n { font-size: 28px; font-weight: 700; }
  .panel {
    margin-top: var(--space-6); background: var(--surface); border: 1px solid var(--line);
    border-radius: var(--radius-md); padding: var(--space-6);
  }
  /* 意図的な野良値: 13px はどのトークンにも一致せず 4px グリッドからも外れる */
  #cta {
    padding: 13px 20px; border: 0; border-radius: 10px; cursor: pointer;
    background: var(--brand-600); color: #fff; font-size: 14px; font-weight: 700;
  }
  .row { display: flex; gap: var(--space-4); align-items: center; margin-top: var(--space-4); }
  table { width: 100%; border-collapse: collapse; margin-top: var(--space-4); }
  th, td { text-align: left; padding: var(--space-2) 0; border-bottom: 1px solid var(--line); }
  th { color: var(--ink-500); font-weight: 600; font-size: 12px; }
</style></head>
<body>
  <header>
    <div class="logo">Acme Console</div>
    <nav><span>Overview</span><span>Reports</span><span>Team</span><span>Settings</span></nav>
  </header>
  <main>
    <aside>
      <a class="on" href="#">Dashboard</a>
      <a href="#">Customers</a>
      <a href="#">Invoices</a>
      <a href="#">Integrations</a>
    </aside>
    <section>
      <div class="cards">
        <div class="card"><h3>Active users</h3><div class="n">12,480</div></div>
        <div class="card"><h3>Conversion</h3><div class="n">4.8%</div></div>
        <div class="card"><h3>Churn</h3><div class="n">1.2%</div></div>
      </div>
      <div class="panel">
        <h2 style="margin:0;font-size:16px">Recent activity</h2>
        <table>
          <tr><th>Customer</th><th>Plan</th><th>Status</th></tr>
          <tr><td>Northwind</td><td>Business</td><td>Active</td></tr>
          <tr><td>Contoso</td><td>Starter</td><td>Trialing</td></tr>
          <tr><td>Fabrikam</td><td>Business</td><td>Active</td></tr>
        </table>
        <div class="row"><button id="cta">Create invoice</button><span style="color:var(--ink-500)">or import a CSV</span></div>
      </div>
    </section>
  </main>
</body></html>`;

/**
 * 「どんなスタイル手法でも動く」の証拠用。ユーティリティクラス + CSS 変数を使わない素の値。
 * デザイントークンを持たないページでも、計測とグリッド検査は動くことを 1 枚で示す。
 */
const UTILITY_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Marketing site</title>
<style>
  *{box-sizing:border-box} body{margin:0;font:16px/1.6 system-ui,sans-serif;color:#0f172a;background:#fff}
  .p-6{padding:24px} .p-5{padding:18px} .rounded-xl{border-radius:12px} .rounded-lg{border-radius:8px}
  .bg-slate-900{background:#0f172a} .text-white{color:#fff} .bg-indigo-600{background:#4f46e5}
  .text-slate-500{color:#64748b} .mt-8{margin-top:32px} .gap-6{gap:24px}
  .hero{display:grid;grid-template-columns:1.1fr .9fr;gap:48px;align-items:center;padding:64px 72px}
  h1{font-size:44px;line-height:1.15;margin:0 0 18px;letter-spacing:-0.02em}
  .cta{display:inline-flex;padding:14px 26px;border-radius:10px;background:#4f46e5;color:#fff;font-weight:700;border:0;font-size:16px}
  .mock{background:#0f172a;border-radius:12px;padding:24px;color:#cbd5e1;min-height:260px}
  .mock .bar{height:10px;background:#334155;border-radius:999px;margin-bottom:14px}
  .feat{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding:0 72px 64px}
  .feat .c{border:1px solid #e2e8f0;border-radius:12px;padding:18px}
  .feat h3{margin:0 0 6px;font-size:16px}
</style></head>
<body>
  <div class="hero">
    <div>
      <h1>Ship your design system,<br>not just your components.</h1>
      <p class="text-slate-500">Audit any deployed screen against the tokens you already have.</p>
      <button class="cta" id="cta2">Start free trial</button>
    </div>
    <div class="mock"><div class="bar" style="width:70%"></div><div class="bar" style="width:45%"></div><div class="bar" style="width:88%"></div><div class="bar" style="width:60%"></div></div>
  </div>
  <div class="feat">
    <div class="c"><h3>Any framework</h3><p class="text-slate-500">React, Vue, or plain HTML.</p></div>
    <div class="c"><h3>Any styling</h3><p class="text-slate-500">Utility classes, CSS Modules, or plain CSS.</p></div>
    <div class="c"><h3>Production ready</h3><p class="text-slate-500">Works on the deployed build.</p></div>
  </div>
</body></html>`;

/**
 * 掲載言語の UI を強制する。
 *
 * **なぜ必要か**: 拡張の i18n はブラウザの UI 言語に従うが、macOS の Chromium は
 * `--lang` も `LANG` / `LC_ALL` / `LANGUAGE` も無視してシステムロケールを使う (実測)。
 * 開発機が日本語だと英語の掲載画像が撮れない。既定の掲載言語は en なので致命的。
 *
 * **やっていること**: `_locales/<locale>/messages.json` の**実在する文字列**を、実際の
 * UI 経路に流し込むだけ。文言を作らないので「実物と一致」を損なわない。
 *   - ページ内オーバーレイ: bridge と同じ `i18n` postMessage (共有 strings を in-place 更新)
 *   - popup: `chrome.i18n.getMessage` / `getUILanguage` を同じ messages.json で解決させる
 */
function localeMessages(locale) {
  const raw = JSON.parse(readFileSync(join(ROOT, 'public', '_locales', locale, 'messages.json'), 'utf8'));
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.message]));
}

/** ページ内オーバーレイの文言を差し替える (bridge の 'i18n' と同じ経路) */
async function forceOverlayLocale(page, messages) {
  await page.evaluate(
    ({ src, payload }) =>
      new Promise((done) => {
        window.postMessage({ source: src, type: 'i18n', payload }, '*');
        setTimeout(done, 0);
      }),
    { src: BRIDGE_SOURCE, payload: messages },
  );
}

/** popup の i18n 解決先を指定 locale に固定する (ページ生成前に仕込む) */
async function forcePopupLocale(context, locale, messages) {
  await context.addInitScript(
    ({ msgs, lang }) => {
      const api = globalThis.chrome;
      if (!api?.i18n) return;
      api.i18n.getMessage = (key) => msgs[key] ?? '';
      api.i18n.getUILanguage = () => lang;
    },
    { msgs: messages, lang: locale === 'ja' ? 'ja-JP' : 'en-US' },
  );
}

/** インスペクトモードを ON にし、処理完了 (postMessage は task キュー) まで待つ */
async function activate(page) {
  await page.evaluate(
    (src) =>
      new Promise((done) => {
        window.postMessage({ source: src, type: 'toggle' }, '*');
        setTimeout(done, 0);
      }),
    BRIDGE_SOURCE,
  );
}

/** 照合辞書を注入する (v1 の実供給元 = MUI テーマ自動検出と同じ経路) */
async function injectTokens(page) {
  await page.evaluate(
    ({ src, dict }) =>
      new Promise((done) => {
        window.postMessage({ source: src, type: 'tokens', payload: dict }, '*');
        setTimeout(done, 0);
      }),
    {
      src: BRIDGE_SOURCE,
      dict: {
        colors: [
          { name: 'palette.primary.main', r: 0x16, g: 0x68, b: 0xd4, a: 1 },
          { name: 'palette.text.primary', r: 0x10, g: 0x18, b: 0x28, a: 1 },
          { name: 'palette.background.paper', r: 0xff, g: 0xff, b: 0xff, a: 1 },
        ],
        sizes: [
          { name: 'spacing(1)', px: 8, category: 'space' },
          { name: 'spacing(2)', px: 16, category: 'space' },
          { name: 'spacing(3)', px: 24, category: 'space' },
          { name: 'shape.borderRadius', px: 8, category: 'radius' },
          { name: 'typography.body2', px: 14, category: 'font' },
        ],
      },
    },
  );
}

async function shootLocale(locale) {
  const OUT_DIR = join(OUT_BASE, locale);
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`\n[${locale}]`);

  const context = await chromium.launchPersistentContext(
    mkdtempSync(join(tmpdir(), `ext-shots-${locale}-`)),
    {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
        `--lang=${locale === 'ja' ? 'ja' : 'en-US'}`,
      ],
      locale: locale === 'ja' ? 'ja-JP' : 'en-US',
      // popup は darkmode ファースト設計なので、その意図どおりの見た目で撮る
      colorScheme: 'dark',
      viewport: SIZE,
    },
  );
  const messages = localeMessages(locale);
  await forcePopupLocale(context, locale, messages);

  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker');
  const extensionId = new URL(sw.url()).host;

  const shots = [];
  const shoot = async (page, name, note) => {
    const file = join(OUT_DIR, name);
    await page.screenshot({ path: file }); // viewport のみ = 1280×800 固定
    shots.push({ name, note });
    console.log(`  ✓ ${name} — ${note}`);
  };

  // ---- ① デザイン値バッジ (辞書なし = CSS 変数名 + 野良値警告が主役) ----
  const page = await context.newPage();
  await page.setViewportSize(SIZE);
  await page.route(`${ORIGIN}/**`, (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: DEMO_HTML }),
  );
  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => '__DOMDOM_INSPECTOR_LOADED__' in window);
  await forceOverlayLocale(page, messages);
  await activate(page);
  await page.hover('#cta');
  // ホスト要素自体はレイアウトを持たない (closed shadow DOM) ので attached で待つ
  await page.waitForSelector('domdom-inspector-overlay', { state: 'attached' });
  // トーストは 4 秒表示。消えるまで待たないと掲載画像に注記が写り込む
  await page.waitForTimeout(4500);
  await page.hover('#cta');
  await page.waitForTimeout(300);
  await shoot(page, '01-badge-design-values.png', 'ホバーで計測値 + CSS 変数名 + 野良値警告');

  // ---- ② トークン照合 (一致トークン名が注釈される) ----
  await injectTokens(page);
  await page.hover('.card');
  await page.waitForTimeout(200);
  await page.hover('#cta');
  await page.waitForTimeout(400);
  await shoot(page, '02-token-matching.png', 'テーマ由来トークン名の注釈 + 最近傍サジェスト');

  // ---- ③ カード要素 (spacing/radius がトークン一致する例) ----
  await page.hover('.panel');
  await page.waitForTimeout(400);
  await shoot(page, '03-token-hit.png', 'トークンに一致した値 (spacing/radius) の表示');

  // ---- ④ どんなスタイル手法でも動く (ユーティリティクラス + 素の値のページ) ----
  //
  // **popup の画像は自動生成しない。** Playwright の各ページは別ウィンドウ扱いになるため
  // popup の tabs.query({active:true,currentWindow:true}) が常に自分自身を返し、
  // CTA が disabled + 「このページでは有効化できません」の状態でしか撮れない
  // (撮影方法の副作用)。chrome.tabs.query を偽装すれば撮れるが、それは「API を偽装した
  // 画面」であって実物ではないので提出物には使わない。popup が要るなら実機で手撮りする
  // (PUBLISHING.md §7 に手順)。
  const utility = await context.newPage();
  await utility.setViewportSize(SIZE);
  await utility.route(`${ORIGIN}/**`, (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: UTILITY_HTML }),
  );
  await utility.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  await utility.waitForFunction(() => '__DOMDOM_INSPECTOR_LOADED__' in window);
  await forceOverlayLocale(utility, messages);
  await activate(utility);
  await utility.hover('#cta2');
  await utility.waitForSelector('domdom-inspector-overlay', { state: 'attached' });
  await utility.waitForTimeout(4500);
  await utility.hover('#cta2');
  await utility.waitForTimeout(300);
  await shoot(utility, '04-any-styling.png', 'ユーティリティクラス / 素の CSS でも計測できる');
  await utility.close();
  await page.close();

  await context.close();
  console.log(`  → ${shots.length} 枚 (${SIZE.width}×${SIZE.height}) → ${OUT_DIR}`);
  return shots.length;
}

async function main() {
  let total = 0;
  for (const locale of LOCALES) total += await shootLocale(locale);
  console.log(`\n✓ 合計 ${total} 枚を ${OUT_BASE} に出力`);
  console.log('  CWS は 1280×800 を推奨。1 掲載言語あたり 1〜5 枚まで登録できる。');
  console.log('  既定の掲載言語は en (manifest の default_locale) なので en/ を主に使う。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
