# Privacy Policy — DomDom Inspector

_Last updated: 2026-08-03_

DomDom Inspector ("the extension") is an inspector for how a web page's UI is implemented:
it measures the design values (colors, spacing, border-radius, typography) of page elements
and matches them against the user's design tokens. On React pages it additionally labels an
element with the component that renders it, and can open that component's source file in the
user's editor. This policy explains what the extension does and does not do with your data.

## Summary

- **No telemetry, no analytics, no tracking.** The extension does not collect usage data.
- **No remote servers of our own.** The extension has no backend. Nothing you inspect is
  transmitted off your machine, with one strictly opt-in exception: the optional
  BYOK AI audit, which sends **only aggregated style values** to the AI provider **you**
  configure, and only when **you** press Send (see "Optional AI design audit" below).
- **All data stays local.** Your settings, pasted design tokens, and (if you use the AI
  feature) your API key are stored only in your browser via `chrome.storage.local`.
- **Localhost works out of the box; other sites are opt-in.** The extension activates
  automatically on `localhost` / `127.0.0.1`. Any other site is inspected only after you
  explicitly enable it, and even then it only reads the page — page content is never
  stored, and nothing is sent beyond the opt-in AI audit noted above.

## Data the extension stores

| Data | Where | Purpose |
|------|-------|---------|
| Settings (display options, badge detail, editor, record key) | `chrome.storage.local` on your device | Remember your preferences |
| Design tokens you paste (JSON) | `chrome.storage.local` on your device | Annotate measured values with token names |
| AI settings and your API key (only if you use the AI feature) | `chrome.storage.local` on your device | Call the AI provider you configured. Never synced; never exposed to web pages |

The extension reads the page's DOM and computed styles in memory to display design values.
When the page uses React, it also reads React's in-memory component tree to show component
names as context (and, if enabled, the MUI theme object to derive token names). This
information is used only to render the on-screen overlay and is **not stored, and not
transmitted** — except the aggregated style summary you explicitly send in the optional
AI audit below.

**Measurement summary you copy yourself.** The popup has a "Copy measurement" button. The
Markdown it writes to **your clipboard** contains only aggregated numbers: match rates per
family, counts, the token names it matched, the values that were off (e.g. `13px`), and the
thresholds used to judge them. It contains **no URL, no page title, no page text, no class
names and no DOM**. It is never transmitted by the extension — it goes to your clipboard
only, and where you paste it is entirely your choice.

## Data the extension does NOT collect

- No page content, DOM, text, form input, or screenshots are stored or sent anywhere.
- No personal information and no browsing history.
- **Credentials of the sites you visit are never read.** The extension does not read login
  forms, passwords, cookies, or session tokens of any page it inspects. The only
  authentication information it ever stores is the AI provider API key that **you** paste
  yourself for the optional AI audit — kept locally on your device and used solely as the
  authentication header of your own API calls.
- No analytics or crash reporting.

## Permissions

- `storage` — to save your settings and pasted design tokens locally.
- `activeTab` — to read the current tab's origin when you open the popup.
- `scripting` — to inject the inspector into origins you have enabled.
- Host access — `localhost` / `127.0.0.1` is covered by a static content script. Any other
  origin is covered by `optional_host_permissions` (`*://*/*`), which is **not granted by
  default** and is requested only when you click "Enable on current site" / "Enable on all
  sites". Access to the AI provider endpoint (`api.openai.com` or
  `generativelanguage.googleapis.com`) is likewise requested only when you first press
  "Send to AI".

The extension does not fetch or execute any remote code, and reads the page only to render
the on-screen overlay — page content is never stored, and never transmitted, on any origin.
The only outbound request the extension can make is the opt-in AI audit described below,
which sends aggregated style values (never page content) after you preview and confirm them.

## Optional AI design audit (BYOK — off unless you configure it)

The popup offers an optional AI design audit using **your own API key** (OpenAI or Google
Gemini). It does nothing until you enter a key, and every call requires two explicit
actions: **Collect** (builds a preview) and **Send**.

- **What is sent**: only the aggregated style summary shown in the preview — style values
  (colors, sizes), usage counts, and token names. Never URLs, page text, DOM content,
  class names, or screenshots. The preview is exactly what is sent, byte for byte.
- **Where it goes**: directly from your browser to the official API endpoint of the
  provider **you** selected. There is no intermediary server.
- **Your key**: stored only in `chrome.storage.local` on your device; sent only as the
  authentication header of your own API calls.
- **Controls**: a hard on/off switch disables all AI features (for client work), and calls
  are capped per browser session. AI output is labeled "AI-generated".
- **Limited Use (Google APIs)**: if you choose Google Gemini as the provider, the
  extension's use of information received from Google APIs adheres to the
  [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
  including the Limited Use requirements.
- The provider's own privacy terms apply to data you send them.

## Contact

Questions or requests: open an issue at the project's repository, or email the developer.

---

# プライバシーポリシー — DomDom Inspector

_最終更新: 2026-08-03_

DomDom Inspector(以下「本拡張機能」)は、web ページの UI 実装を検査するツールです。
ページ上の要素のデザイン値(色・余白・角丸・タイポグラフィ)を計測し、利用者のデザイン
トークンと照合します。React ページでは、その要素を描画しているコンポーネント名を併記し、
そのソースファイルを利用者のエディタで開くこともできます。
本ポリシーは、本拡張機能がデータをどう扱うか(扱わないか)を説明します。

## 要約

- **テレメトリ・分析・トラッキングは一切なし。** 利用状況データを収集しません。
- **独自サーバーを持ちません。** バックエンドは存在せず、検査対象が端末外へ送信されることは
  ありません。唯一の例外は完全オプトインの BYOK AI 監査で、**あなたが設定した** AI プロバイダへ、
  **あなたが送信ボタンを押した時のみ**、**集計済みスタイル値だけ**を送ります
  (後述「任意の AI デザイン監査」参照)。
- **すべてのデータはローカルに留まります。** 設定・貼り付けたデザイントークン・(AI 機能を使う
  場合の) API キーは `chrome.storage.local` にのみ保存します。
- **localhost は自動、その他のサイトはオプトインです。** `localhost` / `127.0.0.1` では自動で
  有効化されます。その他のサイトはあなたが明示的に「有効化」した時のみ検査対象になり、その場合も
  ページを読むだけです。ページ内容を保存することはなく、上記のオプトイン AI 監査以外に送信も
  行いません。

## 本拡張機能が保存するデータ

| データ | 保存先 | 目的 |
|------|--------|------|
| 設定(表示オプション・バッジ詳細度・エディタ・記録キー) | 端末の `chrome.storage.local` | 設定の記憶 |
| 貼り付けたデザイントークン(JSON) | 端末の `chrome.storage.local` | 計測値へのトークン名注釈 |
| AI 設定と API キー(AI 機能を使う場合のみ) | 端末の `chrome.storage.local` | あなたが設定したプロバイダの呼び出し。同期されず、Web ページからも見えません |

デザイン値の表示のためにページの DOM と computed style をメモリ上で読み取ります。ページが
React を使用している場合は、コンポーネント名の補足表示のために React のメモリ上のコンポーネント
ツリーも読み取ります(有効時は MUI テーマオブジェクトからのトークン名導出にも使用)。これらは
画面オーバーレイの描画にのみ使用し、**保存しません。送信もしません** — 唯一の例外は、下記の
任意 AI 監査であなたが明示的に送信する集計済みスタイル要約です。

**あなた自身がコピーする計測サマリ**: ポップアップに「計測結果をコピー」ボタンがあります。
ここで**あなたのクリップボード**へ書き出す Markdown に含まれるのは集計値だけです —
カテゴリ別の一致率・件数・一致したトークン名・外れていた値 (`13px` 等)・判定に使った閾値。
**URL・ページタイトル・ページのテキスト・クラス名・DOM は一切含みません。**
本拡張機能がこれを送信することはありません — 出力先はクリップボードのみで、
どこに貼るかは完全にあなたの判断です。

## 収集しないもの

- ページの内容・DOM・テキスト・入力値・スクリーンショットの保存/送信は一切行いません。
- 個人情報・閲覧履歴を扱いません。
- **訪問先サイトのログイン情報や Cookie は読みません。** 検査対象ページのログインフォーム・
  パスワード・Cookie・セッショントークンを読み取ることはありません。本拡張機能が保存する
  唯一の認証情報は、任意の AI 監査のために **あなた自身が貼り付けた** AI プロバイダの API
  キーだけです。これは端末内にのみ保存し、あなた自身の API 呼び出しの認証ヘッダとしてのみ
  使用します。
- 分析やクラッシュレポートを行いません。

## 権限

- `storage` — 設定と貼り付けたデザイントークンをローカル保存するため。
- `activeTab` — ポップアップを開いた時に現タブの origin を取得するため。
- `scripting` — あなたが有効化したオリジンにインスペクタを注入するため。
- ホストアクセス — `localhost` / `127.0.0.1` は静的コンテンツスクリプトで対応。その他の
  オリジンは `optional_host_permissions`(`*://*/*`)で対応しますが、これは **既定では未付与** で、
  「現在のサイトで有効化」(または「全サイトで許可」)を押した時のみ要求します。AI プロバイダの
  エンドポイント(`api.openai.com` / `generativelanguage.googleapis.com`)へのアクセスも同様に、
  「AI に送信」を初めて押した時のみ要求します。

リモートコードの取得・実行は行いません。ページの読み取りは画面オーバーレイの描画のためだけに行い、
ページ内容はどのオリジンでも保存・送信しません。本拡張が行い得る唯一の外部リクエストは、下記の
オプトイン AI 監査(あなたがプレビューして確認した集計スタイル値のみ。ページ内容は含みません)です。

## 任意の AI デザイン監査(BYOK — 設定しない限り無効)

ポップアップには、**あなた自身の API キー**(OpenAI / Google Gemini)を使う任意の AI デザイン
監査があります。キーを入力するまで何も行わず、毎回の呼び出しに「収集」(プレビュー生成)と
「送信」の 2 段階の明示操作が必要です。

- **送信されるもの**: プレビューに表示される集計済みスタイル要約のみ — スタイル値(色・サイズ)・
  使用回数・トークン名。URL・ページテキスト・DOM 内容・クラス名・スクリーンショットは送信しません。
  プレビュー = 送信内容そのものです。
- **送信先**: あなたが選択したプロバイダの公式 API エンドポイントへ、ブラウザから直接。
  中間サーバーはありません。
- **キーの扱い**: 端末の `chrome.storage.local` にのみ保存し、あなた自身の API 呼び出しの
  認証ヘッダとしてのみ送信します。
- **制御**: AI 全体のハード OFF スイッチ(クライアント案件向け)と、セッションごとの呼び出し
  上限があります。AI 出力には「AI 生成」バッジが付きます。
- **Limited Use(Google API)**: プロバイダに Google Gemini を選んだ場合、本拡張機能による
  Google API から受け取った情報の利用は、
  [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
  の Limited Use 要件を含め、同ポリシーに準拠します。
- 送信したデータには、当該プロバイダのプライバシー条件が適用されます。

## お問い合わせ

質問・要望はリポジトリの Issue、または開発者へのメールでお願いします。
