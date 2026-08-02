# Chrome Web Store Listing — DomDom Inspector

配信形態: **Unlisted(限定公開)** — 検索非掲載・リンク共有のみ。
このファイルは CWS デベロッパーダッシュボードに貼り付ける下書きです。

> ⚠️ **2026-08-03 改稿 — 提出前に要ユーザーレビュー(対外文面のため)。**
> ツリー/レンダープロファイリング/エディタジャンプ/MUI テーマ自動取得/BYOK AI 監査の
> 搭載に合わせて下書きを更新した。
> **「Single purpose」と「Data usage disclosure」は決着済み**(下記が確定文言)。
> `PUBLISHING.md` §4-2 / `PRIVACY.md` と三者同一の内容になっていること。文言を直す場合は
> 3 ファイルすべてを同時に直す。

---

## Listing (English — default)

**Name:** DomDom Inspector

**Summary (132 chars max):**
Hover any element to see its design values — colors, spacing, radius, typography — and match them against your design tokens.

**Category:** Developer Tools

**Detailed description:**
```
DomDom Inspector inspects how a web page's UI is implemented: it measures the
design values on screen, matches them against your design tokens, and shows the
components and re-renders behind them. Zero config, any website — MUI, Tailwind,
CSS Modules, or plain CSS.

INSPECT DESIGN VALUES (Alt+Shift+I)
- Turn on inspect mode and hover any element.
- A floating badge shows the element's computed design values: text color,
  background, spacing (margin/padding), border-radius, and typography.
- Rogue-value detection: spacing that falls outside a 4/8px grid is flagged,
  so design-system drift is visible at a glance.
- ↑/↓ move the selection to the parent / child element.

MATCH AGAINST YOUR DESIGN TOKENS
- Paste your design token JSON (Figma Variables export, W3C Design Tokens,
  or Tokens Studio) into the popup.
- Matched values are annotated with the token name (e.g. primary.main);
  unmatched values are flagged as rogue.
- Audit a deployed product against your design system without opening
  DevTools or reading CSS.

MUI THEME AUTO-DETECTION
- When the page uses MUI, the theme (palette / spacing / border radius /
  font sizes) is read from its ThemeProvider and merged into token matching
  automatically — no JSON pasting needed. Pasted tokens take precedence.

FOR REACT DEVELOPERS
- Component tree (Alt+Shift+T): browse the React component hierarchy;
  hover a node to highlight it on the page.
- Render profiling (Alt+Shift+R): accurate re-render counts and causes
  (state / props / wasted parent re-renders) using the same criterion as
  React DevTools — works on production builds too.
- Open in editor: Cmd/Ctrl+Click an element to jump to its source
  (dev builds only).

OPTIONAL AI DESIGN AUDIT (BYOK)
- Bring your own OpenAI or Gemini API key and get an AI-written audit of the
  page's aggregated style values (rogue values, consolidation, next steps).
- Off until you configure a key. Every call needs two explicit steps:
  Collect (builds a preview of exactly what will be sent) and Send.
- Only aggregated style values are sent — never URLs, text, or page content.
  A hard on/off switch disables all AI features.

WORKS ANYWHERE
- Any site, any styling method. React apps (dev or production build) and
  non-React pages alike. When React is present, component names are shown
  as extra context; design measurement itself never requires it.

PRIVACY
- No telemetry, no servers of our own, no tracking. Settings stay in local
  storage.
- Localhost dev servers work out of the box. Any other site is inspected only
  after you explicitly enable it ("Enable on current site"), and even then the
  extension only reads the page — it never stores page content or runs remote
  code, and sends nothing unless you explicitly use the optional BYOK AI audit
  (aggregated style values only, previewed before sending).
```

**Permission justification (for review):**
- `storage`: persist user settings (display options, pasted design tokens) locally.
- `activeTab`: read the current tab's origin from the popup when you open it.
- `scripting`: inject the inspector into origins you have enabled.
- `optional_host_permissions` (`*://*/*`): not granted by default; requested only when
  you click "Enable on current site" / "Enable on all sites" so deployed apps can be
  inspected. localhost is covered by a static content script. Access to
  `api.openai.com` / `generativelanguage.googleapis.com` is requested only when the
  user first presses "Send to AI" in the optional BYOK audit.
- No remote code. Nothing leaves the device except the opt-in BYOK AI audit:
  aggregated style values only, previewed before sending, to the official endpoint
  of the provider the user configured with their own key.

**Single purpose:** Inspect how a web page's UI is implemented — measure the design values
of page elements (colors, spacing, border-radius, typography), match them against the
user's own design tokens, and visualize the component structure and render behavior that
produce those values. Every feature serves that one purpose: the component tree and render
profiling explain *which component* produced a measured value and *how often* it is
re-rendered; "open in editor" jumps to the source of the inspected element; the optional
AI audit comments on the aggregated measurements. All inspection is local and read-only;
the only outbound data is the user-initiated AI commentary, sent with the user's own key.

**Data usage disclosure (CWS form):** — v0.4.0 は BYOK AI で端末外送信と API キー保存を
行う。**「収集なし」と申告してはならない**(虚偽申告)。以下をそのまま選択・記入する。

- **Website content — YES (collected).** The optional BYOK AI audit sends *aggregated
  style values* derived from the page (computed style values, usage counts, matched token
  names) to the AI provider the user configured. Sent only after two explicit user actions
  (Collect → Send), and only exactly what the preview shows. Never URLs, page text, DOM,
  class names, form input, or screenshots.
- **Authentication information — YES (collected).** The user's own AI provider API key is
  stored locally in `chrome.storage.local` and used only as the authentication header of
  that user's own API calls. Never synced, never sent anywhere else, never exposed to web
  pages. Credentials (logins, cookies, session tokens) of visited sites are never read.
- All other categories — **No**: personally identifiable information, health information,
  financial and payment information, personal communications, location, web history,
  user activity.
- Sold to third parties? No. Used for unrelated purposes? No. Used for creditworthiness? No.
- Data is used only for the disclosed single purpose, and is transferred to no one other
  than the AI provider the user themselves selected.
- Privacy policy URL: _(host PRIVACY.md at a public URL and paste it here — see
  `PUBLISHING.md` §2)_

---

## Listing (日本語)

**名前:** DomDom Inspector

**概要(132 文字以内):**
要素にホバーするだけで色・余白・角丸・タイポグラフィを計測し、デザイントークンと照合。どんなサイトでも動くデザイン検査ツール。

**カテゴリ:** デベロッパー ツール

**詳細説明:**
```
DomDom Inspector は、web ページの UI 実装を検査するツールです。画面上のデザイン値を
計測し、あなたのデザイントークンと照合し、それを生むコンポーネントと再レンダーまで
見せます。ゼロ設定でどんなサイトでも動作し、MUI / Tailwind / CSS Modules / 素の CSS を
問いません。

デザイン値のインスペクト (Alt+Shift+I)
- インスペクトモードを ON にして要素にホバー。
- 文字色・背景色・余白 (margin/padding)・角丸・タイポグラフィなどの
  computed デザイン値をバッジ表示。
- 野良値検出: 4/8px グリッドから外れた spacing に警告が付き、
  デザインシステムからの逸脱がひと目でわかります。
- ↑/↓ で親・子要素へ選択を移動。

デザイントークンとの照合
- Figma Variables のエクスポート / W3C Design Tokens / Tokens Studio の
  JSON をポップアップに貼り付け。
- 一致した値にはトークン名 (例: primary.main) が注釈され、
  一致しない値は「野良値」として警告されます。
- DevTools を開かず、CSS を読まずに、デプロイ済みプロダクトを
  デザインシステムと照合できます。

MUI テーマの自動検出
- ページが MUI を使っていれば、ThemeProvider からテーマ (palette / spacing /
  角丸 / フォントサイズ) を読み取り、JSON 貼り付けなしでトークン照合に
  自動併合します (貼り付けトークン優先)。

React 開発者向け
- コンポーネントツリー (Alt+Shift+T): React のコンポーネント階層をパネル表示。
  ノードにホバーすると実ページ上でハイライトされます。
- レンダープロファイリング (Alt+Shift+R): React DevTools と同一基準の正確な
  再レンダー回数と原因 (state / props / 親巻き込まれの無駄レンダー)。
  production ビルドでも動作します。
- エディタで開く: Cmd/Ctrl+クリックで要素のソースへジャンプ (開発ビルドのみ)。

任意の AI デザイン監査 (BYOK)
- 自分の OpenAI / Gemini API キーで、ページの集計スタイル値への AI 講評
  (野良値・統合候補・次の一手) を取得できます。
- キーを設定するまで無効。毎回「収集」(送信内容のプレビュー生成) と「送信」の
  2 段の明示操作が必要です。
- 送信されるのは集計済みスタイル値のみ — URL・テキスト・ページ内容は送信しません。
  AI 全体のハード OFF スイッチもあります。

どこでも動作
- サイト・スタイル手法を問いません。React アプリ (開発・本番ビルドとも) でも
  React を使わないページでも動作します。React がある場合はコンポーネント名も
  補足表示されます (デザイン計測自体は React 不要)。

プライバシー
- テレメトリ・独自サーバー・トラッキングなし。設定はローカル保存のみ。
- localhost の開発サーバはそのまま動作。その他のサイトは「現在のサイトで有効化」
  した時のみ検査対象になり、その場合もページを読むだけで、ページ内容の保存・
  リモートコード実行は行いません。外部送信は任意の BYOK AI 監査 (集計スタイル値
  のみ・送信前プレビュー必須) を明示的に使った時だけです。
```

**単一目的 (Single purpose — 上記英文の対訳。CWS への入力は英文):**
web ページの UI 実装を検査する — ページ要素のデザイン値 (色 / 余白 / 角丸 / タイポグラフィ)
を計測し、利用者自身のデザイントークンと照合し、それを生むコンポーネント構造とレンダー挙動を
可視化する。全機能がこの単一目的に奉仕する: コンポーネントツリーとレンダープロファイリングは
「計測値を生んだのはどのコンポーネントか」「それが何回再レンダーされているか」を説明し、
エディタジャンプは検査中の要素のソースを開き、任意の AI 監査は集計済み計測値に講評を付ける。
検査はすべてローカルの読み取り専用で、外部送信は利用者が起動する AI 講評 (利用者自身のキー)
のみ。

**データ利用の申告 (対訳):** Website content = **収集する** (BYOK AI 監査で集計スタイル値を
利用者設定のプロバイダへ送信。2 段の明示操作 + プレビュー必須。URL・テキスト・DOM・
クラス名・スクリーンショットは送らない)。Authentication information = **収集する**
(利用者自身の API キーを端末内保存し、本人の API 呼び出しの認証ヘッダにのみ使用。
訪問先サイトの認証情報は読まない)。その他のカテゴリはすべて「なし」。
「販売しない / 無関係な用途に使わない / 信用調査に使わない」の 3 つにチェック。

---

## Assets checklist (未作成)

- [ ] スクリーンショット 1280×800 または 640×400 を 1〜5 枚
      (インスペクト中のデザインバッジ / トークン照合の注釈 / 野良値警告 / 設定ポップアップ)
- [ ] 小さなプロモタイル 440×280 (任意)
- [x] アイコン 128×128 (`public/icon/128.png`)
- [ ] プライバシーポリシーを公開 URL でホスト (`PRIVACY.md`)

## 提出前チェック

- [x] `default_locale: en` + `_locales/en`, `_locales/ja`
- [x] アイコン 16/32/48/96/128
- [x] permissions は `storage`/`activeTab`/`scripting`(host は localhost 静的 + `optional_host_permissions: *://*/*` はユーザー明示許可時のみ)。正当化は SECURITY.md
- [ ] デベロッパー登録($5)・スクショ・プライバシーポリシー URL

## 将来機能 (このリスティングには含めない)

Phase 4 (セッションスキャン / UI アーキテクチャ抽出 / 課題レポート / Skills 生成) と
Phase 3 の残り (リントエンジン FR-15〜18) は `docs/ROADMAP.md` で管理し、搭載時に
リスティングを更新する。(旧 issue #4-#9 の機能は v0.4.0 で搭載済み → 上記本文に反映済み)
