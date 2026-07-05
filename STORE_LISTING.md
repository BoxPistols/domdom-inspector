# Chrome Web Store Listing — MUI Design Inspector

配信形態: **Unlisted(限定公開)** — 検索非掲載・リンク共有のみ。
このファイルは CWS デベロッパーダッシュボードに貼り付ける下書きです。

---

## Listing (English — default)

**Name:** MUI Design Inspector

**Summary (132 chars max):**
Inspect any React app: identify components on hover, jump to source, visualize re-renders. MUI-aware, works with any styling.

**Category:** Developer Tools

**Detailed description:**
```
MUI Design Inspector is a zero-config developer tool for React + MUI apps.

INSPECT
- Turn on inspect mode (Alt+Shift+I) and hover any element.
- See the component name, key props, and source file:line in a floating badge.
- Color-coded: blue = MUI, green = your code, gray = other libraries.
- Click to open the exact source line in VS Code, Cursor, Antigravity, WebStorm,
  or a custom editor URL.
- Alt+Click shows the owner tree (who rendered it). ↑/↓ move between parent and
  child components — great for grabbing a Card when you're hovering its content.
- "Skip MUI internals" jumps to YOUR JSX instead of library files.

RENDER / PERFORMANCE DEBUG (Alt+Shift+R)
- Re-rendered elements flash on screen, colored as a heatmap of re-render frequency
  (blue = few, red = many).
- Press R to record, interact, then R again to see a per-component ranking of
  re-render count and self time. A lighter-weight alternative to the React DevTools
  Profiler for spotting what re-renders and how often.

PRIVACY
- No telemetry, no servers, no tracking. Settings stay in local storage.
- Runs only on localhost / 127.0.0.1 dev servers.

Requires a React development build. On production builds it falls back to a
name-only safe mode.
```

**Permission justification (for review):**
- `storage`: persist user settings (editor choice, path mappings) locally.
- Host access `localhost` / `127.0.0.1`: inject the inspector into local dev servers only.
- No remote code; no data leaves the device.

**Single purpose:** Inspect and debug the design/rendering of React + MUI UIs during
local development.

**Data usage disclosure (CWS form):**
- Does the item collect user data? **No.**
- Sold to third parties? No. Used for unrelated purposes? No. Used for creditworthiness? No.
- Privacy policy URL: _(host PRIVACY.md at a public URL and paste it here)_

---

## Listing (日本語)

**名前:** MUI Design Inspector

**概要(132 文字以内):**
あらゆる React アプリを検査: ホバーで識別・ソースへジャンプ・再描画を可視化。MUI 判別対応、任意のスタイルで動作する軽量インスペクタ。

**カテゴリ:** デベロッパー ツール

**詳細説明:**
```
MUI Design Inspector は React + MUI アプリ向けのゼロ設定な開発者ツールです。

インスペクト
- インスペクトモード (Alt+Shift+I) を ON にして要素にホバー。
- コンポーネント名・主要 props・ソース file:行 をバッジ表示。
- 色分け: 青 = MUI / 緑 = 自作 / グレー = その他ライブラリ。
- クリックで VS Code / Cursor / Antigravity / WebStorm / カスタム URL の
  該当行を直接オープン。
- Alt+クリックで owner ツリー(誰が描画したか)。↑/↓ で親子コンポーネントを移動
  — Card の中身にホバーした状態から Card 本体を掴むのに便利。
- 「MUI 内部スキップ」で、ライブラリ内部ではなく自分の JSX へジャンプ。

レンダー / パフォーマンスデバッグ (Alt+Shift+R)
- 再描画された要素が画面上で明滅。色は再描画頻度のヒートマップ(青=少 → 赤=多)。
- R で記録 → 操作 → R で停止すると、コンポーネント別の再描画回数・自己時間
  ランキングを表示。React DevTools Profiler より軽量に「どこが何回再描画したか」を確認。

プライバシー
- テレメトリ・サーバー・トラッキングなし。設定はローカル保存のみ。
- localhost / 127.0.0.1 の開発サーバでのみ動作。

React の development ビルドが必要です。production ビルドでは名前推定のみの
セーフモードになります。
```

---

## Assets checklist (未作成)

- [ ] スクリーンショット 1280×800 または 640×400 を 1〜5 枚
      (インスペクト中のバッジ / owner ツリー / レンダーヒートマップ / 記録ランキング / 設定ポップアップ)
- [ ] 小さなプロモタイル 440×280 (任意)
- [x] アイコン 128×128 (`public/icon/128.png`)
- [ ] プライバシーポリシーを公開 URL でホスト (`PRIVACY.md`)

## 提出前チェック

- [x] `default_locale: en` + `_locales/en`, `_locales/ja`
- [x] アイコン 16/32/48/96/128
- [x] 本番 permissions は `storage` のみ(host は localhost)
- [ ] デベロッパー登録($5)・スクショ・プライバシーポリシー URL
