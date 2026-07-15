# Chrome Web Store Listing — DomDom Inspector

配信形態: **Unlisted(限定公開)** — 検索非掲載・リンク共有のみ。
このファイルは CWS デベロッパーダッシュボードに貼り付ける下書きです。

---

## Listing (English — default)

**Name:** DomDom Inspector

**Summary (132 chars max):**
Hover any element to see its design values — colors, spacing, radius, typography — and match them against your design tokens.

**Category:** Developer Tools

**Detailed description:**
```
DomDom Inspector is a zero-config design measurement tool for any website —
MUI, Tailwind, CSS Modules, or plain CSS.

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

WORKS ANYWHERE
- Any site, any styling method. React apps (dev or production build) and
  non-React pages alike. When React is present, component names are shown
  as extra context; design measurement itself never requires it.

PRIVACY
- No telemetry, no servers, no tracking. Settings stay in local storage.
- Localhost dev servers work out of the box. Any other site is inspected only
  after you explicitly enable it ("Enable on current site"), and even then the
  extension only reads the page — it never sends, stores, or runs remote code.
```

**Permission justification (for review):**
- `storage`: persist user settings (display options, pasted design tokens) locally.
- `activeTab`: read the current tab's origin from the popup when you open it.
- `scripting`: inject the inspector into origins you have enabled.
- `optional_host_permissions` (`*://*/*`): not granted by default; requested only when
  you click "Enable on current site" / "Enable on all sites" so deployed apps can be
  inspected. localhost is covered by a static content script.
- No remote code; no data leaves the device.

**Single purpose:** Measure and display the design values (colors, spacing,
border-radius, typography) of page elements, and match them against the user's
design tokens — locally, read-only.

**Data usage disclosure (CWS form):**
- Does the item collect user data? **No.**
- Sold to third parties? No. Used for unrelated purposes? No. Used for creditworthiness? No.
- Privacy policy URL: _(host PRIVACY.md at a public URL and paste it here)_

---

## Listing (日本語)

**名前:** DomDom Inspector

**概要(132 文字以内):**
要素にホバーするだけで色・余白・角丸・タイポグラフィを計測し、デザイントークンと照合。どんなサイトでも動くデザイン検査ツール。

**カテゴリ:** デベロッパー ツール

**詳細説明:**
```
DomDom Inspector は、どんなサイトでも動くゼロ設定のデザイン計測ツールです。
MUI / Tailwind / CSS Modules / 素の CSS を問いません。

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

どこでも動作
- サイト・スタイル手法を問いません。React アプリ (開発・本番ビルドとも) でも
  React を使わないページでも動作します。React がある場合はコンポーネント名も
  補足表示されます (デザイン計測自体は React 不要)。

プライバシー
- テレメトリ・サーバー・トラッキングなし。設定はローカル保存のみ。
- localhost の開発サーバはそのまま動作。その他のサイトは「現在のサイトで有効化」
  した時のみ検査対象になり、その場合もページを読むだけで送信・保存・
  リモートコード実行は行いません。
```

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

レンダープロファイリング / コンポーネントツリー / エディタジャンプ / MUI テーマ自動取得 /
AI レポートは issue #4-#9 で管理し、搭載時にリスティングを更新する。
