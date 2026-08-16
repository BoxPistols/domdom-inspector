# DomDom Inspector

[![CI](https://github.com/BoxPistols/domdom-inspector/actions/workflows/ci.yml/badge.svg)](https://github.com/BoxPistols/domdom-inspector/actions/workflows/ci.yml)

[English](./README.en.md) | **日本語**

**Hover any element to see its design values — and match them against your design tokens.**
A zero-config Chrome extension for design measurement on any website: MUI, Tailwind, CSS Modules, or plain CSS.

どんなサイトでも要素にホバーするだけで色・余白・角丸・タイポグラフィを計測し、デザイントークンと照合できる Chrome 拡張。

## Features / 機能

- **Inspect mode** (`Alt+Shift+I`, exit with `Esc`) — hover any element to see a floating badge with its computed design values: text color, background, spacing (margin/padding), border-radius, typography
- **Rogue-value detection** — spacing that is not a multiple of 4px is flagged (`tokenLint.ts`), making design-system drift visible at a glance
- **Design token matching (zero config)** — on MUI pages the theme is auto-detected from `ThemeProvider`; matched values are annotated with the token name, unmatched values flagged as rogue with the nearest token (`muiTheme.ts` / `tokenDict.ts`)
- **MUI theme auto-detection** — when the page uses MUI, the theme (palette / spacing / border radius / font sizes) is read from its `ThemeProvider` and merged into token matching automatically — no JSON pasting needed (pasted tokens take precedence; toggle in the popup)
- **CSS variable names** — when a value is declared with a CSS variable (`var(--text)`), the badge shows the variable name so you can verify the UI is built on your design tokens; toggle to raw values in the popup
- **Open in editor** (v0.4.23〜 設定ゼロ) — `⌘/Ctrl+Click` (または右クリックメニュー) で要素のソースをエディタで開く。**開発サーバの `/__open-in-editor` 経由**なので、エディタの選択もパスの対応表も設定不要 (Vite / Next.js / CRA。Vue DevTools と同じ方式)。dev サーバに届かない場合だけ従来のスキーム起動へフォールバックする。開発ビルドのみ / バンドル済み・minify されたソースは検出して抑止。**どの環境で実際に動くかは [`docs/editor-jump-support.md`](docs/editor-jump-support.md) に実測で書いてある**
- **Parent/child navigation** — `↑` moves to the parent element, `↓` back to the child; works on any site including plain HTML/CSS (DOM ancestry, not just React)
- **Works anywhere** — React apps (dev or production build) and non-React pages alike. When React is present, component names are shown as context (blue = MUI / green = your code / gray = other); design measurement itself never requires React
- **Bilingual** — English / Japanese UI, switches with the browser locale

> **v1 の対象外 / Not in v1** — コンポーネントツリーとレンダープロファイリング(+ Page Vitals・Markdown レポート)は **v1 の配線から外している**。実装は `src/render-bundle/` にそのまま温存してあるが、ショートカット・メッセージ経路を通していないため到達しない。v0.4.24 で**出荷される JS からも完全に外した**(到達不能なだけでなく 1 バイトも載らない。`pnpm check:submission` が出荷 JS を走査して毎回実測する)。理由: production ビルドでは React がコンポーネント名を minify するため原理的に判読できず、開発ビルドなら React DevTools の方が優れ、レンダー可視化は react-scan の拡張が同じ土俵にいるため。再配線の判断と手順は [`docs/ROADMAP.md`](./docs/ROADMAP.md)(復活時は `CLAUDE.md` の「4 点配線」を戻す)。

## Setup / セットアップ

```sh
pnpm install
pnpm dev        # 開発 (自動リロード付きで Chrome が起動)
pnpm build      # .output/chrome-mv3 に成果物 + 同期フォルダ (OneDrive 等) へ自動展開
pnpm build:only # 同期せずビルドだけ
pnpm sync       # 既存の成果物を同期フォルダへ展開するだけ
pnpm bump:patch # version を +0.0.1 (minor/major も可)。manifest/zip に自動反映
pnpm test       # ユニットテスト (vitest)
pnpm e2e        # popup スモーク (playwright、要 pnpm build)
```

手動読み込み: `pnpm build` 後、`chrome://extensions` → デベロッパーモード → 「パッケージ化されていない拡張機能を読み込む」→ `.output/chrome-mv3`

### 複数 PC で共有する (OneDrive 等) / Multi-PC dev sync

**`pnpm build` が同期フォルダへの展開まで自動で行う。** build 成果物を**実ファイルとしてコピー**し、複数 PC で同一の unpacked 拡張を共有できるようにする(symlink は OneDrive 同期で壊れるため実体コピー)。

- **内容が同じときは書かない**(OneDrive が毎ビルドで同じファイルを再アップロードしないため)
- **展開先が特定できない環境(CI・他人のクローン)では警告のみで build は成功する**
- 展開先の解決順: `EXT_SYNC_DIR` 環境変数 → `.env.local` の `EXT_SYNC_DIR` → macOS 自動検出(`~/Library/CloudStorage/OneDrive-*/Extensions`)→ Windows 自動検出(`%OneDrive%` 等)→ `~/OneDrive/Extensions`
- 別 PC / 別 OS では `.env.local` に `EXT_SYNC_DIR=/path/to/OneDrive/Extensions` を書く(`.env.local` は git 管理外)
- 展開後、各 PC で `chrome://extensions` → 「パッケージ化されていない拡張機能を読み込む」→ `<同期フォルダ>/domdom-inspector`。更新後は拡張の「更新」ボタン(⟳)で反映

## Using on deployed sites / デプロイ済みサイトでの利用

権限は最小化してある。既定で自動有効なのは `localhost` / `127.0.0.1` のみ:

1. 検査したいサイトを開き、拡張アイコン → **「現在のサイトで有効化」**を 1 回クリック
2. そのままインスペクトが始まる(以後そのオリジンでは permanent。取り消しも popup から)
3. 全サイト一括許可のトグルも popup にある(任意)

ページを読むだけで、ページ内容の保存もリモートコード実行もしない。**第三者への送信はゼロ**。発行するネットワーク要求は**2 種類**で、どちらも**利用者自身のローカル開発サーバ**宛て。(1) 「このファイルをエディタで開いて」と頼む要求 (2) バンドル後の位置を元ソースへ戻すための source map の取得 (React 19 が `_debugSource` を削除したため、位置は必ずバンドル座標で来る)。どちらも `looksLocalDev` が真のときだけ発行し、送るのはページ自身が配信している URL とソースパスだけ。 旧: エディタ起動要求だけで、`looksLocalDev` が真のとき (localhost / 127.0.0.1 / `*.local` / `*.test` 等) にしか出さず、送るのはページ自身が生成したソースパスだけ。詳細は [`SECURITY.md`](./SECURITY.md) (経路が 1 つであることは `pnpm check:submission` が毎回実測する)。

### エディタで開く — 1 回だけの設定 / One-time setup for "open in editor"

**設定は原則不要です。** `⌘/Ctrl+Click` でエディタが開きます。popup の「高度な設定」で
**使っているエディタを選ぶ**だけです (既定は Cursor)。

拡張は source map から**元ファイルの絶対パス**を解決するので、エディタの URL スキームで
直接開けます。開発サーバの設定も、パスの対応表も要りません。

**絶対パスが取れない構成のときだけ**、開発サーバ経由にフォールバックします
(source map が無い / React 18 以前で相対パスしか出ない場合)。そのときは開発サーバ側に
どのエディタを使うか教える必要があり、popup の「高度な設定」に**常設の
「設定コマンドをコピー」**があります。押して貼って実行し、
**開発サーバを起動し直せば終わり**です。以降は不要です。

なぜ拡張側で消せないのか: 開発サーバ (Vite / Next / CRA) がどのエディタを起動するかは
**サーバ側の環境変数でしか決まりません**。エンドポイントにエディタを指定する口が無く、
ブラウザからサーバの環境変数は変えられません。拡張にできるのは「正しい 1 行を、
考えなくていい形で渡すこと」までです。

| エディタ | 設定 |
|---|---|
| VS Code / Cursor / WebStorm | `export LAUNCH_EDITOR=code REACT_EDITOR=code`(または `cursor` / `webstorm`) |
| Antigravity IDE などそれ以外 | 下記の 3 行 (拡張の「設定コマンドをコピー」がこれを出します) |

```sh
mkdir -p ~/.local/launch-editor
ln -sfn "/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide" ~/.local/launch-editor/code
export LAUNCH_EDITOR="$HOME/.local/launch-editor/code"
export REACT_EDITOR="$HOME/.local/launch-editor/code"
```

> **環境変数は 2 つ要ります。** Vite / webpack 系は `LAUNCH_EDITOR` を、
> **Next.js は `REACT_EDITOR` しか見ません** (2026-08-17 に Next 16.3.0 で実測)。
> 片方だけだと、もう片方のフレームワークで黙って効きません。

`launch-editor` は**エディタ名で引数の形を決めます**。`code` / `cursor` / `codium` /
`trae` / `vscodium` のときだけ `-g file:line:column` を渡すため、一覧に無い名前
(Antigravity 等) では**行番号が別のファイル名として渡り、開いても該当箇所に飛びません**。
そこで `code` という名前だけを借ります。**PATH には載せない**ので既存の
`code` / `cursor` は影響を受けません。

> **開かない原因はもう 1 つあります。** 開発サーバは受け取ったパスを
> **自分の作業ディレクトリ基準**で解決します (`path.resolve(cwd, file)`)。
> モノレポ等でサーバの起動位置がプロジェクトルートと違うと、実在しないパスになり、
> `launch-editor` は**何も言わずに終了します** (それでも 200 が返ります)。
> 拡張のトーストには**実際に送ったパス**が出るので、それが違っていればこちらが原因です。
>
> 値に引数を含めると必ず失敗します (`LAUNCH_EDITOR="code --wait"` は不可)。
> `EDITOR="code --wait"` を設定している場合も同じ理由で開きません
> — `LAUNCH_EDITOR` の方が優先されるので、上記を設定すれば解決します。

詳細と実測は [`docs/editor-jump-support.md`](docs/editor-jump-support.md)。

## Shortcuts / ショートカット

- `Alt+Shift+I` — インスペクトモード切替(popup の「切替ショートカットを変更」から `chrome://extensions/shortcuts` で再割当可能)
- `⌘/Ctrl+Click` — 要素のソースをエディタで開く(dev ビルドのみ)
- `↑` / `↓` — 親子要素へ選択移動
- `Esc` — インスペクトモード解除

popup のショートカット表示は `chrome.commands.getAll()` の実バインドを OS 表記で出す(Mac は ⌥⇧I)。

## i18n

`chrome.i18n` で英語 (`default_locale`) と日本語に対応。ブラウザの UI 言語で自動切替。
- カタログ: `public/_locales/{en,ja}/messages.json`(単一の真実のソース)
- MAIN world は拡張 API を使えないため、bridge (ISOLATED) が `browser.i18n` で解決した文字列を postMessage で注入。英語をコード内の既定値として持ち、解決前でも動作する
- popup は `data-i18n` 属性で流し込み、ヘルプは UI 言語で英/日ブロックを出し分け

## Store distribution / ストア配信 (Chrome Web Store)

一般公開 (Public) + 全地域 前提。**公開手順の全ステップは [`PUBLISHING.md`](./PUBLISHING.md) に集約**。掲載文・権限説明の下書きは `STORE_LISTING.md`、プライバシーポリシー本文は `PRIVACY.md`。アイコンは `public/icon/{16,32,48,96,128}.png`。

配布用 zip は `pnpm zip`(→ `.output/domdom-inspector-<version>-chrome.zip`)。

## Architecture / アーキテクチャ

```
entrypoints/
  inspector.content.ts  MAIN world / document_start。フック確立 + インスペクタ本体
  bridge.content.ts     ISOLATED world。設定・トークン・トグル指示の中継 + i18n 注入
  background.ts         キーボードショートカット → タブへトグル指示
  popup/                サイト有効化・モード切替・エディタ設定・ヘルプ
src/
  hook.ts        __REACT_DEVTOOLS_GLOBAL_HOOK__ への piggyback (自分からは設置しない)
  fiber.ts       要素情報の解決 (design-only / safe / dev の 3 段フォールバック)
  designStyle.ts computed style からのデザイン値抽出 (純関数)
  tokenDict.ts   デザイントークン JSON の解析と照合 (純関数)
  tokenLint.ts   4px グリッド野良値検出 (純関数)
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
