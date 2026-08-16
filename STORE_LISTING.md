# Chrome Web Store Listing — DomDom Inspector

配信形態: **Public(一般公開)+ 全地域** — 2026-08-06 にオーナーが決定 (旧: Unlisted)。
このファイルは CWS デベロッパーダッシュボードに貼り付ける下書きです。

> **Public は掲載文の品質が審査対象**になる。誇張表現・競合の名指し・未実装機能の予告を
> 書かない。スクリーンショットは実物と一致していなければならない (合成・モックは不可)。

> ⚠️ **提出前に要ユーザーレビュー(対外文面のため)。**
>
> **v1 の掲載範囲 = 「ホバーした要素のデザイン値を計測し、利用者のトークンと照合する」。**
> 次のものは v1 の配線から外してある(実装は温存 = 到達不能)ので、掲載文・単一目的・
> データ申告のいずれにも含めない:
> - コンポーネントツリー / レンダープロファイリング (2026-08-03)。production では React が
>   名前を minify するため原理的に判読不能 / dev なら React DevTools が優れる /
>   react-scan の拡張が同じ土俵にいる
> - **トークンカバレッジ計測 (ページ全体の集計) — 2026-08-06。**
>   popup では率の意味を保つ情報が入りきらず、検算ループも作れない。side panel として
>   再導入する → https://github.com/BoxPistols/domdom-inspector/issues/10
> - **BYOK AI デザイン監査 — 2026-08-06。** これがあるだけで Data usage 申告に
>   Website content と Authentication information の 2 カテゴリが必要になり審査が重くなる。
>   外した結果、**申告は「収集なし」に戻った** →
>   https://github.com/BoxPistols/domdom-inspector/issues/11
>
> **「Single purpose」と「Data usage disclosure」は下記が確定文言。**
> `PUBLISHING.md` §4-2 / `PRIVACY.md` / `SECURITY.md` と**四者同一**であること。
> 文言を直すときは 4 ファイルすべてを同時に直す (2026-08-06 に同期を確認済み)。

---

## Listing (English — default)

**Name:** DomDom Inspector

**Summary (132 chars max):**
Hover any element to see its design values — colors, spacing, radius, typography — and match them against your design tokens.

**Category:** Developer Tools

**Detailed description:**
```
DomDom Inspector inspects how a web page's UI is implemented: it measures the
design values on screen and matches them against your own design tokens — on
deployed production sites, not just localhost. Zero config, any website — MUI,
Tailwind, CSS Modules, or plain CSS.

INSPECT DESIGN VALUES (Alt+Shift+I)
- Turn on inspect mode and hover any element.
- A floating badge shows the element's computed design values: text color,
  background, spacing (margin/padding), border-radius, and typography.
- Rogue-value detection: spacing that is not a multiple of 4px is flagged,
  so design-system drift is visible at a glance.
- ↑/↓ move the selection to the parent / child element.
- Or right-click any element and choose "Inspect this element" — no keyboard needed.
- Open in editor: Cmd/Ctrl+Click an element (or use the right-click menu) to jump
  to its source (React dev builds only).

MATCH AGAINST YOUR DESIGN TOKENS — ZERO CONFIG
- When the page uses MUI, the theme (palette / spacing / border radius /
  font sizes) is read from its ThemeProvider automatically. Nothing to set up.
- Matched values are annotated with the token name (e.g. primary.main);
  unmatched values are flagged as rogue with the nearest token.
- Audit a deployed product against its own design system without opening
  DevTools or reading CSS.
- On pages without a theme, the badge still shows the declared CSS variable
  name behind each value, plus off-grid spacing warnings.

WORKS ANYWHERE
- Any site, any styling method. React apps (dev or production build) and
  non-React pages alike. When React is present, component names are shown
  as extra context; design measurement itself never requires it.

PRIVACY
- No telemetry, no servers of our own, no tracking. Settings stay in local
  storage.
- Nothing is sent to us or to any third party. The extension has no backend. The one
  request it makes goes to your own local dev server, to open a file in your editor.
- Localhost dev servers work out of the box. Any other site is inspected only
  after you explicitly enable it ("Enable on current site"), and even then the
  extension only reads the page — it never stores page content or runs remote code.
```

**Permission justification (for review):**
- `storage`: persist the user's own settings (editor choice, path mappings) locally.
- `activeTab`: read the current tab's origin from the popup when you open it.
- `scripting`: inject the inspector into origins you have enabled.
- `contextMenus`: add "Inspect this element" / "Open this element's source in my editor"
  to the right-click menu. This grants no additional access to pages, and the items are
  shown only where the inspector actually runs (localhost plus origins you enabled).
- `sidePanel`: show the coverage result **next to** the page being measured, so the user can
  check a number against the page itself without the panel closing. This grants no additional
  access to pages (the permission carries no user-facing warning), and the panel is opened
  only from the popup.
- `optional_host_permissions` (`*://*/*`): not granted by default; requested only when
  you click "Enable on current site" / "Enable on all sites" so deployed apps can be
  inspected. localhost is covered by a static content script.
- No remote code. Exactly one network request exists: "open this file in my editor",
  sent to the user's own local dev server and only when the page is a local dev origin
  (`looksLocalDev`). It carries a source path and line number, nothing else.
  Nothing is sent to the developer or to any third party.

**Single purpose:** Measure the design values of a web page's UI and check them against the
design system that page is built on — read the values of the element the user points at
(colors, spacing, border-radius, typography) and match them against the design tokens found
on the page. Every feature serves that one purpose: MUI theme auto-detection builds the
token dictionary from the page itself; the right-click menu and "open in editor" reach the
element and its source while it is being measured (React dev builds only).
All inspection is local and read-only, and the extension sends nothing anywhere.

**Data usage disclosure (CWS form):** — v1 は**第三者への送信を一切持たない**
(BYOK AI 監査を v1 の配線から外したため。issue #11)。以下をそのまま選択・記入する。

- **すべてのカテゴリを「収集しない」** — website content / personally identifiable
  information / authentication information / health / financial and payment /
  personal communications / location / web history / user activity。
  拡張はページの DOM と computed style を**メモリ内で読むだけ**で、保存も送信もしない。
  保存するのは利用者自身の設定のみ (`chrome.storage.local`、端末内)。
- **第三者への送信を一切行わない。** 発行するネットワーク要求は「利用者自身の
  ローカル開発サーバへ、ソースをエディタで開くよう頼む / source map を取得する」2 種類のみで、宛先は
  localhost 等に限定される (`SECURITY.md` の監査手順で再現証明できる)。
  ページの内容・入力値・利用状況は送らない。
- Sold to third parties? No. Used for unrelated purposes? No. Used for creditworthiness? No.
- Privacy policy URL: _(host PRIVACY.md at a public URL and paste it here — see
  `PUBLISHING.md` §2)_

> **AI 監査を再導入するときは、この申告を必ず戻すこと**
> (Website content = YES / Authentication information = YES)。
> https://github.com/BoxPistols/domdom-inspector/issues/11

---

## Listing (日本語)

**名前:** DomDom Inspector

**概要(132 文字以内):**
要素にホバーするだけで色・余白・角丸・タイポグラフィを計測し、デザイントークンと照合。どんなサイトでも動くデザイン検査ツール。

**カテゴリ:** デベロッパー ツール

**詳細説明:**
```
DomDom Inspector は、web ページの UI 実装を検査するツールです。画面上のデザイン値を
計測し、あなたのデザイントークンと照合します。localhost だけでなくデプロイ済みの本番
サイトでも動作。ゼロ設定でどんなサイトでも動作し、MUI / Tailwind / CSS Modules /
素の CSS を問いません。

デザイン値のインスペクト (Alt+Shift+I)
- インスペクトモードを ON にして要素にホバー。
- 文字色・背景色・余白 (margin/padding)・角丸・タイポグラフィなどの
  computed デザイン値をバッジ表示。
- 野良値検出: 4px の倍数でない spacing に警告が付き、
  デザインシステムからの逸脱がひと目でわかります。
- ↑/↓ で親・子要素へ選択を移動。
- 要素を右クリック →「この要素を検査」でも開始できます (キーボード不要)。
- エディタで開く: Cmd/Ctrl+クリック (または右クリックメニュー) で要素のソースへ
  ジャンプ (React の開発ビルドのみ)。

デザイントークンとの照合 — 設定ゼロ
- ページが MUI を使っていれば、ThemeProvider からテーマ (palette / spacing /
  角丸 / フォントサイズ) を自動で読み取ります。設定は不要です。
- 一致した値にはトークン名 (例: primary.main) が注釈され、一致しない値は
  最近傍トークン付きで「野良値」として警告されます。
- DevTools を開かず、CSS を読まずに、デプロイ済みプロダクトをそのプロダクト自身の
  デザインシステムと照合できます。
- テーマが無いページでも、値の背後で宣言されている CSS 変数名と、
  グリッド外の余白警告は表示されます。

どこでも動作
- サイト・スタイル手法を問いません。React アプリ (開発・本番ビルドとも) でも
  React を使わないページでも動作します。React がある場合はコンポーネント名も
  補足表示されます (デザイン計測自体は React 不要)。

プライバシー
- テレメトリ・独自サーバー・トラッキングなし。設定はローカル保存のみ。
- 外部送信は一切ありません。 バックエンドを持たず、第三者へのネットワークリクエストを
  1 つも発行しません。
- localhost の開発サーバはそのまま動作。その他のサイトは「現在のサイトで有効化」
  した時のみ検査対象になり、その場合もページを読むだけで、ページ内容の保存・
  リモートコード実行は行いません。
```

**単一目的 (Single purpose — 上記英文の対訳。CWS への入力は英文):**
web ページの UI のデザイン値を計測し、そのページが依拠するデザインシステムと照合する —
利用者が指した要素の値 (色 / 余白 / 角丸 / タイポグラフィ) を読み取り、ページから
見つけたデザイントークンと照合する。全機能がこの単一目的に奉仕する: MUI テーマ自動取得は
ページ自身からトークン辞書を組み立て、右クリックメニューとエディタジャンプは計測中の
要素とそのソースへ到達する (React の開発ビルドのみ)。
検査はすべてローカルの読み取り専用で、外部への送信は一切ない。

**データ利用の申告 (対訳):** **全カテゴリを「収集しない」**。v1 は第三者への送信を持たず
(BYOK AI 監査は v1 の配線から外した — issue #11)、ページの DOM と computed style は
メモリ内で読むだけで保存も送信もしない。端末内に保存するのは利用者自身の設定
(エディタの選択・パスマッピング) のみ。
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
- [x] permissions は `storage`/`activeTab`/`scripting`/`contextMenus`/`sidePanel`(host は localhost 静的 + `optional_host_permissions: *://*/*` はユーザー明示許可時のみ)。正当化は SECURITY.md
- [ ] デベロッパー登録($5)・スクショ・プライバシーポリシー URL

## 将来機能 (このリスティングには含めない)

Phase 4 (セッションスキャン / UI アーキテクチャ抽出 / 課題レポート / Skills 生成) と
Phase 3 の残り (リントエンジン FR-15〜18) は `docs/ROADMAP.md` で管理し、搭載時に
リスティングを更新する。

**v1 の配線から外してあるもの** (実装は温存 = 到達不能)。掲載文・単一目的・データ申告・
スクリーンショットのいずれにも含めないこと。再配線して掲載に戻すときは、単一目的と
データ申告も同時に広げる必要がある (審査リスクは上がる):

- コンポーネントツリー / レンダープロファイリング / Page Vitals
  (`src/render-bundle/` 一式) — v0.4.24 以降は**出荷 JS にも含まれない**
  (到達不能なだけでなく 1 バイトも載らない。`pnpm check:submission` が実測する)
- トークンカバレッジ計測 (`src/coverage.ts` / `src/designScan.ts`) —
  https://github.com/BoxPistols/domdom-inspector/issues/10
- BYOK AI デザイン監査 (`src/aiProviders.ts` / `src/aiPrompt.ts` / `src/aiCost.ts`) —
  https://github.com/BoxPistols/domdom-inspector/issues/11

**搭載しているもの**: ホバーバッジ (デザイン値 + トークン照合注釈 + 野良値警告) /
右クリックメニュー / エディタジャンプ / ↑↓ 親子ナビ / MUI テーマ自動取得 /
判断の根拠は `docs/assessment-20260802-store-readiness.md` と
`docs/ROADMAP.md`。
