# Chrome Web Store 提出用アセット

**手で編集しない。** `pnpm shots` (= `scripts/store-screenshots.mjs`) が
ビルド済み拡張を実 Chromium にロードして生成する。**UI を変えたら回し直す。**

```sh
pnpm build   # .output/chrome-mv3 を作る (同期も自動)
pnpm shots   # docs/store-assets/{en,ja}/ に 1280×800 × 4 枚
```

## 中身

| ファイル | 何を見せているか |
|---|---|
| `01-badge-design-values.png` | **テーマを持たないページ** (production の一般ケース)。計測値を出し、生値ではなく宣言された CSS 変数名 (`--brand-600`) を主表示し、4px グリッド外の値を警告 |
| `02-token-matching.png` | **同じ画面で、拡張がページの MUI テーマを自力で検出した状態**。一致したトークン名を緑で注釈 (`palette.primary.main`)、外れた値を黄で最近傍つきに (`13px 20px ≠ token · near spacing(1.5)`) |
| `03-token-hit.png` | 全項目がトークンに一致している要素 (色 / spacing / radius / font がすべて緑) |
| `04-any-styling.png` | ユーティリティクラス + 素の値のページ。**トークンを持たないサイトでも計測とグリッド検査は動く** |

`en/` = 既定の掲載言語 (manifest の `default_locale: en`)。`ja/` は日本語の掲載文を出すとき用。

## 実物一致について

Public 公開ではスクリーンショットが実物と一致していなければならない (合成・モックは不可)。
上の 4 枚はすべて**ビルド済み拡張が実際に描画したもの**で、撮影用に用意したのはデモ画面
(`scripts/store-screenshots.mjs` 内の HTML) だけ。バッジ・トークン注釈・野良値警告・
モードピルはいずれも本物の UI。

**辞書は注入していない** (issue #15 の修正 / 2026-08-07)。以前は 02 と 03 の 2 枚だけ、
bridge を騙った `tokens` postMessage で照合辞書を注入して撮っていた。その経路は
**利用者からは到達できない** (v1 に貼り付け UI は無く、辞書の供給元は MUI テーマの自動検出
だけ) ため、実物と一致しない画面を「実物一致」として出していた。

現在は撮影用ページに **ThemeProvider を持つ React ルートの断面**を置き、拡張が
**本番と同じコード** (`src/muiTheme.ts` の `findMuiThemeFromDom` → `parseMuiTheme`) で
テーマを自力に発見する。つまり写っているのは「デモアプリのテーマを拡張が読んで照合した結果」
であって、テスト用の裏口を通した表示ではない。

さらにスクリプトは**撮る前にバッジの文言を実測する** (`requireInBadge`)。
テーマ検出が壊れた状態で「トークン照合」の画像を静かに出さないためで、
一致トークン名が出ていなければ撮影は失敗する。

**popup の画像は含まない。** Playwright の各ページは別ウィンドウ扱いになるため、popup の
`tabs.query({active:true,currentWindow:true})` が常に自分自身を返し、CTA が disabled +
「このページでは有効化できません」の状態でしか撮れない (撮影方法の副作用)。
`chrome.tabs.query` を偽装すれば撮れるが、それは実物ではないので使わない。
必要なら実機で手撮りする — 手順は `PUBLISHING.md` §7。

## locale の強制について

拡張の i18n はブラウザの UI 言語に従うが、**macOS の Chromium は `--lang` も
`LANG` / `LC_ALL` / `LANGUAGE` も無視してシステムロケールを使う** (実測で確認)。
開発機が日本語だと英語の画像が撮れず、既定の掲載言語が en なので致命的になる。

そこでスクリプトは `_locales/<locale>/messages.json` の**実在する文字列**を実 UI 経路
(bridge の `i18n` postMessage / `chrome.i18n` の解決先) に流し込んでいる。
**文言を作っていない**ので「実物と一致」は損なわない。
