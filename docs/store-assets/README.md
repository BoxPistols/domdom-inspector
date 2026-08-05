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
| `01-badge-design-values.png` | ホバーした要素の計測値。**生値ではなく宣言された CSS 変数名** (`--brand-600`) を主表示し、4px グリッド外の値を警告 |
| `02-token-matching.png` | 一致したトークン名を緑で注釈 (`palette.primary.main`)、外れた値を黄で最近傍つきに (`13px ≠ token · near spacing(2)`) |
| `03-token-hit.png` | spacing / radius がトークンに一致している状態 |
| `04-any-styling.png` | ユーティリティクラス + 素の値のページ。**トークンを持たないサイトでも計測とグリッド検査は動く** |

`en/` = 既定の掲載言語 (manifest の `default_locale: en`)。`ja/` は日本語の掲載文を出すとき用。

## 実物一致について

Public 公開ではスクリーンショットが実物と一致していなければならない (合成・モックは不可)。
上の 4 枚はすべて**ビルド済み拡張が実際に描画したもの**で、撮影用に用意したのはデモ画面
(`scripts/store-screenshots.mjs` 内の HTML) だけ。バッジ・トークン注釈・野良値警告・
モードピルはいずれも本物の UI。

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
