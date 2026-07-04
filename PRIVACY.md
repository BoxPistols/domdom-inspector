# Privacy Policy — MUI Design Inspector

_Last updated: 2026-07-04_

MUI Design Inspector ("the extension") is a developer tool that identifies React/MUI
components on a page and links them to their source code. This policy explains what the
extension does and does not do with your data.

## Summary

- **No telemetry, no analytics, no tracking.** The extension does not collect usage data.
- **No remote servers.** The extension has no backend. Nothing you inspect is transmitted
  off your machine.
- **All data stays local.** Your settings are stored only in your browser via
  `chrome.storage.local`.
- **Runs only on localhost.** The extension activates only on `localhost` and `127.0.0.1`
  development servers.

## Data the extension stores

| Data | Where | Purpose |
|------|-------|---------|
| Settings (editor choice, custom URL template, MUI-skip flag, path mappings) | `chrome.storage.local` on your device | Remember your preferences |

The extension reads the page's React component tree in memory to display component names,
props, and source locations. This information is used only to render the on-screen overlay
and is **not stored or transmitted**.

## Data the extension does NOT collect

- No page content, DOM, text, form input, or screenshots are stored or sent anywhere.
- No personal information, credentials, or browsing history.
- No analytics or crash reporting.

## Permissions

- `storage` — to save your settings locally.
- Host access to `localhost` / `127.0.0.1` — to inject the inspector content script into
  your local development server only.

The extension does not fetch or execute any remote code.

## Future AI features (not in this version)

A future version may offer an optional "bring your own key" (BYOK) AI assist. If and when
that ships, it will be opt-in, will send only extracted metadata to the AI provider **you**
configure, and will require explicit action each time. This policy will be updated before
any such feature is released.

## Contact

Questions or requests: open an issue at the project's repository, or email the developer.

---

# プライバシーポリシー — MUI Design Inspector

_最終更新: 2026-07-04_

MUI Design Inspector(以下「本拡張機能」)は、ページ上の React/MUI コンポーネントを識別し、
ソースコードに結びつける開発者向けツールです。本ポリシーは、本拡張機能がデータをどう扱うか
(扱わないか)を説明します。

## 要約

- **テレメトリ・分析・トラッキングは一切なし。** 利用状況データを収集しません。
- **サーバーを持ちません。** バックエンドは存在せず、検査対象が端末外へ送信されることは
  ありません。
- **すべてのデータはローカルに留まります。** 設定は `chrome.storage.local` にのみ保存します。
- **localhost でのみ動作します。** `localhost` / `127.0.0.1` の開発サーバでのみ有効化されます。

## 本拡張機能が保存するデータ

| データ | 保存先 | 目的 |
|------|--------|------|
| 設定(エディタ選択・カスタム URL・MUI スキップ・パスマッピング) | 端末の `chrome.storage.local` | 設定の記憶 |

コンポーネント名・props・ソース位置の表示のためにページの React ツリーをメモリ上で読み取り
ますが、これは画面オーバーレイの描画にのみ使用し、**保存も送信もしません**。

## 収集しないもの

- ページの内容・DOM・テキスト・入力値・スクリーンショットの保存/送信は一切行いません。
- 個人情報・認証情報・閲覧履歴を扱いません。
- 分析やクラッシュレポートを行いません。

## 権限

- `storage` — 設定をローカル保存するため。
- `localhost` / `127.0.0.1` へのホストアクセス — ローカル開発サーバにのみコンテンツ
  スクリプトを注入するため。

リモートコードの取得・実行は行いません。

## 将来の AI 機能(本バージョンには含まれません)

将来、任意の BYOK(自前 API キー)AI アシストを提供する可能性があります。提供時はオプトイン
とし、**利用者が設定した** プロバイダへ抽出済みメタデータのみを、毎回の明示操作で送信します。
該当機能のリリース前に本ポリシーを更新します。

## お問い合わせ

質問・要望はリポジトリの Issue、または開発者へのメールでお願いします。
