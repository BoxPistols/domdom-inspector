# Privacy Policy — DomDom Inspector

_Last updated: 2026-08-06_

DomDom Inspector ("the extension") is an inspector for how a web page's UI is implemented:
it measures the design values (colors, spacing, border-radius, typography) of page elements
and matches them against the user's design tokens. On React pages it additionally labels an
element with the component that renders it, and can open that component's source file in the
user's editor. This policy explains what the extension does and does not do with your data.

**Single purpose**: the extension exists to measure the design values of a web page's UI
and check them against the design system that page is built on. Every feature serves that
one purpose, and no data is collected for any purpose at all.

## Summary

- **No telemetry, no analytics, no tracking.** The extension does not collect usage data.
- **Nothing is sent to us or to any third party.** The extension has no backend. It issues
  exactly **one kind** of network request: asking **your own local dev server** (localhost and
  similar) to open a file in your editor. It is never sent while you are on someone else's
  site, and it carries only a source file path and line number — no page content, no input,
  no usage data. **Nothing you inspect leaves your machine.**
- **All data stays local.** Your settings are stored only in your browser via
  `chrome.storage.local`. Nothing else is persisted.
- **Localhost works out of the box; other sites are opt-in.** The extension activates
  automatically on `localhost` / `127.0.0.1`. Any other site is inspected only after you
  explicitly enable it, and even then it only reads the page — page content is never stored.

## Data the extension stores

| Data | Where | Purpose |
|------|-------|---------|
| Settings (editor choice, path mappings) | `chrome.storage.local` on your device | Remember your preferences |

The extension reads the page's DOM and computed styles in memory to display design values.
When the page uses React, it also reads React's in-memory component tree to show component
names as context (and, if enabled, the MUI theme object to derive token names). This
information is used only to render the on-screen overlay and is **not stored, and not
transmitted**.

**Source path you copy yourself.** When "open in editor" cannot launch your editor, the
extension offers a **Copy path** button. It writes only the source file path and line
(e.g. `/src/App.tsx:42`) to **your clipboard** — nothing else, and only when you press it.

## Data the extension does NOT collect

- No page content, DOM, text, form input, or screenshots are stored or sent anywhere.
- No personal information and no browsing history.
- **Credentials of the sites you visit are never read.** The extension does not read login
  forms, passwords, cookies, or session tokens of any page it inspects, and it stores no
  authentication information of any kind.
- No analytics or crash reporting.

## Permissions

- `storage` — to save your settings locally.
- `activeTab` — to read the current tab's origin when you open the popup.
- `scripting` — to inject the inspector into origins you have enabled.
- `contextMenus` — to add "Inspect this element" / "Open source in editor" to the
  right-click menu. This grants no additional access to page content.
- Host access — `localhost` / `127.0.0.1` is covered by a static content script. Any other
  origin is covered by `optional_host_permissions` (`*://*/*`), which is **not granted by
  default** and is requested only when you click "Enable on current site" / "Enable on all
  sites".

The extension does not fetch or execute any remote code, and reads the page only to render
the on-screen overlay — page content is never stored, and never transmitted, on any origin.
The only request it ever issues goes to **your own machine** (a local dev server, to open a
file in your editor), so there is no outbound path for your data to leave your device.

## Contact

Questions or requests: open an issue at the project's repository, or email the developer.

---

# プライバシーポリシー — DomDom Inspector

_最終更新: 2026-08-06_

DomDom Inspector(以下「本拡張機能」)は、web ページの UI 実装を検査するツールです。
ページ上の要素のデザイン値(色・余白・角丸・タイポグラフィ)を計測し、利用者のデザイン
トークンと照合します。React ページでは、その要素を描画しているコンポーネント名を併記し、
そのソースファイルを利用者のエディタで開くこともできます。
本ポリシーは、本拡張機能がデータをどう扱うか(扱わないか)を説明します。

**単一目的**: 本拡張は「web ページ UI のデザイン値を計測し、そのページが依って立つ
デザインシステムと照合する」ためだけに存在します。全機能がこの 1 目的に奉仕し、
いかなる目的のためのデータ収集も行いません。

## 要約

- **テレメトリ・分析・トラッキングは一切なし。** 利用状況データを収集しません。
- **外部送信は一切ありません。** バックエンドを持ちません。拡張が発行する
  ネットワーク要求は**ただ 1 種類**で、それは「エディタでこのファイルを開いて」と
  **利用者自身のローカル開発サーバ (localhost 等) に頼む**要求だけです。
  他のサイトを見ているときは 1 バイトも送りません。送る内容はソースファイルの
  パスと行番号だけで、ページの内容・入力値・利用状況は含みません。
  **検査した内容が端末外へ出ることはありません。**
- **すべてのデータはローカルに留まります。** 保存するのは設定だけで、
  `chrome.storage.local` にのみ置きます。それ以外は永続化しません。
- **localhost は自動、その他のサイトはオプトインです。** `localhost` / `127.0.0.1` では自動で
  有効化されます。その他のサイトはあなたが明示的に「有効化」した時のみ検査対象になり、その場合も
  ページを読むだけです。ページ内容を保存することはありません。

## 本拡張機能が保存するデータ

| データ | 保存先 | 目的 |
|------|--------|------|
| 設定(エディタの選択・パスマッピング) | 端末の `chrome.storage.local` | 設定の記憶 |

デザイン値の表示のためにページの DOM と computed style をメモリ上で読み取ります。ページが
React を使用している場合は、コンポーネント名の補足表示のために React のメモリ上のコンポーネント
ツリーも読み取ります(有効時は MUI テーマオブジェクトからのトークン名導出にも使用)。これらは
画面オーバーレイの描画にのみ使用し、**保存しません。送信もしません。**

**あなた自身がコピーするソースパス**: 「エディタで開く」がエディタを起動できなかったとき、
**パスをコピー**ボタンを出します。**あなたのクリップボード**へ書き出すのは
ソースファイルのパスと行番号 (`/src/App.tsx:42` 等) だけで、それ以外は何も含みません。
あなたがボタンを押した時にのみ動作します。

## 収集しないもの

- ページの内容・DOM・テキスト・入力値・スクリーンショットの保存/送信は一切行いません。
- 個人情報・閲覧履歴を扱いません。
- **訪問先サイトのログイン情報や Cookie は読みません。** 検査対象ページのログインフォーム・
  パスワード・Cookie・セッショントークンを読み取ることはなく、**認証情報を一切保存しません。**
- 分析やクラッシュレポートを行いません。

## 権限

- `storage` — 設定をローカル保存するため。
- `activeTab` — ポップアップを開いた時に現タブの origin を取得するため。
- `scripting` — あなたが有効化したオリジンにインスペクタを注入するため。
- `contextMenus` — 右クリックメニューに「この要素を検査 / ソースをエディタで開く」を
  追加するため。ページ内容への追加アクセス権は生じません。
- ホストアクセス — `localhost` / `127.0.0.1` は静的コンテンツスクリプトで対応。その他の
  オリジンは `optional_host_permissions`(`*://*/*`)で対応しますが、これは **既定では未付与** で、
  「現在のサイトで有効化」(または「全サイトで許可」)を押した時のみ要求します。

リモートコードの取得・実行は行いません。ページの読み取りは画面オーバーレイの描画のためだけに行い、
ページ内容はどのオリジンでも保存・送信しません。発行する要求は**あなた自身の端末** (ローカルの
開発サーバにファイルを開いてもらう要求) 宛ての 1 種類だけなので、データが端末外へ出る経路そのものが
存在しません。

## お問い合わせ

質問・要望はリポジトリの Issue、または開発者へのメールでお願いします。
