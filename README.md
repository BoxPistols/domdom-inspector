# DomDom Inspector

[![CI](https://github.com/BoxPistols/domdom-inspector/actions/workflows/ci.yml/badge.svg)](https://github.com/BoxPistols/domdom-inspector/actions/workflows/ci.yml)

**Hover any element to see its design values — and match them against your design tokens.**
A zero-config Chrome extension for design measurement on any website: MUI, Tailwind, CSS Modules, or plain CSS.

どんなサイトでも要素にホバーするだけで色・余白・角丸・タイポグラフィを計測し、デザイントークンと照合できる Chrome 拡張。

## Features / 機能

- **Inspect mode** (`Alt+Shift+I`, exit with `Esc`) — hover any element to see a floating badge with its computed design values: text color, background, spacing (margin/padding), border-radius, typography
- **Rogue-value detection** — spacing outside a 4/8px grid is flagged (`tokenLint.ts`), making design-system drift visible at a glance
- **Design token matching** — paste your Figma Variables / W3C Design Tokens / Tokens Studio JSON into the popup; matched values are annotated with the token name, unmatched values flagged as rogue (`tokenDict.ts`)
- **CSS variable names** — when a value is declared with a CSS variable (`var(--text)`), the badge shows the variable name so you can verify the UI is built on your design tokens; toggle to raw values in the popup
- **Open in editor** (v0.3.0) — `⌘/Ctrl+Click` an element to open its source in your editor (Cursor / VS Code / Antigravity IDE / WebStorm). Dev builds only; bundled/minified sources are detected and skipped
- **Parent/child navigation** — `↑` moves to the parent element, `↓` back to the child; works on any site including plain HTML/CSS (DOM ancestry, not just React)
- **Works anywhere** — React apps (dev or production build) and non-React pages alike. When React is present, component names are shown as context (blue = MUI / green = your code / gray = other); design measurement itself never requires React
- **Bilingual** — English / Japanese UI, switches with the browser locale

将来機能(レンダープロファイリング / コンポーネントツリー / MUI テーマ自動取得 / AI レポート)は [issue #4-#9](https://github.com/BoxPistols/domdom-inspector/issues) で管理。実装は同梱済みだが初回リリースでは到達不能化してある。

## Setup / セットアップ

```sh
pnpm install
pnpm dev        # 開発 (自動リロード付きで Chrome が起動)
pnpm build      # .output/chrome-mv3 に成果物
pnpm build:sync # build + 同期フォルダ (OneDrive 等) へ実体展開 (複数 PC 共有用)
pnpm bump:patch # version を +0.0.1 (minor/major も可)。manifest/zip に自動反映
pnpm test       # ユニットテスト (vitest)
pnpm e2e        # popup スモーク (playwright、要 pnpm build)
```

手動読み込み: `pnpm build` 後、`chrome://extensions` → デベロッパーモード → 「パッケージ化されていない拡張機能を読み込む」→ `.output/chrome-mv3`

### 複数 PC で共有する (OneDrive 等) / Multi-PC dev sync

`pnpm build:sync` は build 成果物を同期フォルダへ**実ファイルとしてコピー**し、複数 PC で同一の unpacked 拡張を共有できるようにする(symlink は OneDrive 同期で壊れるため実体コピー)。

- 展開先の解決順: `EXT_SYNC_DIR` 環境変数 → `.env.local` の `EXT_SYNC_DIR` → macOS 自動検出(`~/Library/CloudStorage/OneDrive-*/Extensions` が一意なら採用)
- 別 PC / 別 OS では `.env.local` に `EXT_SYNC_DIR=/path/to/OneDrive/Extensions` を書く(`.env.local` は git 管理外)
- 展開後、各 PC で `chrome://extensions` → 「パッケージ化されていない拡張機能を読み込む」→ `<同期フォルダ>/domdom-inspector`。更新後は拡張の「更新」ボタン(⟳)で反映

## Using on deployed sites / デプロイ済みサイトでの利用

権限は最小化してある。既定で自動有効なのは `localhost` / `127.0.0.1` のみ:

1. 検査したいサイトを開き、拡張アイコン → **「現在のサイトで有効化」**を 1 回クリック
2. そのままインスペクトが始まる(以後そのオリジンでは permanent。取り消しも popup から)
3. 全サイト一括許可のトグルも popup にある(任意)

ページを読むだけで、外部送信・ページ内容保存・リモートコード実行は一切ない。詳細は [`SECURITY.md`](./SECURITY.md)。

## Shortcuts / ショートカット

- `Alt+Shift+I` — インスペクトモード切替(popup の「切替ショートカットを変更」から `chrome://extensions/shortcuts` で再割当可能)
- `↑` / `↓` — 親子要素へ選択移動
- `Esc` — モード解除

popup のショートカット表示は `chrome.commands.getAll()` の実バインドを OS 表記で出す(Mac は ⌥⇧I)。

## i18n

`chrome.i18n` で英語 (`default_locale`) と日本語に対応。ブラウザの UI 言語で自動切替。
- カタログ: `public/_locales/{en,ja}/messages.json`(単一の真実のソース)
- MAIN world は拡張 API を使えないため、bridge (ISOLATED) が `browser.i18n` で解決した文字列を postMessage で注入。英語をコード内の既定値として持ち、解決前でも動作する
- popup は `data-i18n` 属性で流し込み、ヘルプは UI 言語で英/日ブロックを出し分け

## Store distribution / ストア配信 (Chrome Web Store)

限定公開 (Unlisted) 前提。**公開手順の全ステップは [`PUBLISHING.md`](./PUBLISHING.md) に集約**。掲載文・権限説明の下書きは `STORE_LISTING.md`、プライバシーポリシー本文は `PRIVACY.md`。アイコンは `public/icon/{16,32,48,96,128}.png`。

配布用 zip は `pnpm zip`(→ `.output/domdom-inspector-<version>-chrome.zip`)。

## Architecture / アーキテクチャ

```
entrypoints/
  inspector.content.ts  MAIN world / document_start。フック確立 + インスペクタ本体
  bridge.content.ts     ISOLATED world。設定・トークン・トグル指示の中継 + i18n 注入
  background.ts         キーボードショートカット → タブへトグル指示
  popup/                職域スイッチ・サイト有効化・トークン貼り付け・表示設定・ヘルプ
src/
  hook.ts        __REACT_DEVTOOLS_GLOBAL_HOOK__ シム (React 読み込み前に設置)
  fiber.ts       要素情報の解決 (design-only / safe / dev の 3 段フォールバック)
  designStyle.ts computed style からのデザイン値抽出 (純関数)
  tokenDict.ts   デザイントークン JSON の解析と照合 (純関数)
  tokenLint.ts   4/8px グリッド野良値検出 (純関数)
  classify.ts    MUI / 自作 / サードパーティ分類 (純関数)
  overlay.ts     Shadow DOM 隔離のハイライト / デザインバッジ
  inspector.ts   インスペクトモードの状態機械
```

要素情報は 3 段フォールバック: React 無し → computed style のみ(`isReact:false`)/ production React → クラス名推定 + デザイン値 / dev React → コンポーネント名も解決。**デザイン計測は React 非依存**。

### 既知の制約 / Known limitations

- production ビルドでは自作コンポーネント名は原理的に取得不可(デザイン計測は全ビルドで動作)
- RSC(Server Components)はクライアント側 Fiber が無いためコンポーネント名対象外
- sandbox iframe(opaque origin)は注入対象外(blob/srcdoc iframe は対応済み)

## Documents / ドキュメント

| 目的 | ファイル |
|------|---------|
| 開発ガイド(アーキテクチャ/規約/地雷/テスト戦略) | [`CLAUDE.md`](./CLAUDE.md) |
| セキュリティ(監査エビデンス/脅威モデル/権限正当化) | [`SECURITY.md`](./SECURITY.md) |
| 配布(A: ローカル zip / B: Chrome Web Store) | [`PUBLISHING.md`](./PUBLISHING.md) |
| 掲載文・プライバシー | [`STORE_LISTING.md`](./STORE_LISTING.md) / [`PRIVACY.md`](./PRIVACY.md) |
| フェーズ計画(将来機能) | [`docs/ROADMAP.md`](./docs/ROADMAP.md) |
