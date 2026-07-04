# MUI Design Inspector

React / MUI コンポーネントをブラウザ上でホバー識別し、ソースコードへワンクリックでジャンプする Chrome 拡張機能。
要件定義書 v3.0 の **Phase 1: インスペクタ MVP**(FR-01〜04, 08, 09, 12)実装。

## 機能

- **インスペクトモード** — `Alt+Shift+I` またはポップアップから切替、`Esc` で解除。有効中はページへのクリックを遮断(誤操作防止)
- **ホバーハイライト** — MUI = 青 / 自作 = 緑 / サードパーティ = グレーの 3 分類で枠表示
- **フローティングバッジ** — コンポーネント名 + 主要 props + ソースファイル:行。MUI 内部の styled スロット名 (例: `MuiCardContentRoot`) はユーザーが JSX に書いたセマンティック名 (例: `CardContent`) に解決して表示
- **親子ナビゲーション** — `↑` で親コンポーネントへ、`↓` で子へ戻る(ホバー困難な入れ子でもキーボードで往来可能)
- **クリックでエディタジャンプ** — VS Code / Cursor / Antigravity / WebStorm / カスタム URL スキーム対応
- **MUI スキップ** — MUI 内部実装を飛ばし、自作コードの JSX callsite へジャンプ(設定で切替可)
- **Alt+クリック** — owner チェーン(誰がレンダリングしたか)のパネル表示、各行からジャンプ可能
- **Production セーフモード** — dev ビルド未検出時は `Mui*` クラス由来の名前表示のみに自動縮退
- **レンダー可視化 / パフォーマンスデバッグ** (`Alt+Shift+R`) — 各コミットで再描画した要素を Shadow DOM 上の canvas でヒートマップ明滅(青=低頻度→赤=高頻度)。`R` で記録開始→停止でコンポーネント別の再描画回数・自己時間ランキングを表示。React DevTools Profiler より軽量で「どこが何回・どの順で再描画したか」を画面上で直接確認できる

## セットアップ

```sh
pnpm install
pnpm dev        # 開発 (自動リロード付きで Chrome が起動)
pnpm build      # .output/chrome-mv3 に成果物
pnpm test       # ユニットテスト
```

手動読み込み: `pnpm build` 後、`chrome://extensions` → デベロッパーモード → 「パッケージ化されていない拡張機能を読み込む」→ `.output/chrome-mv3`

対象オリジンは `localhost` / `127.0.0.1` のみ(権限最小化)。

## 多言語 (i18n)

`chrome.i18n` で英語 (`default_locale`) と日本語に対応。ブラウザの UI 言語で自動切替します。
- カタログ: `public/_locales/{en,ja}/messages.json`(単一の真実のソース)
- MAIN world の inspector/overlay/renderDebug は拡張 API を使えないため、bridge (ISOLATED) が `browser.i18n` で解決した文字列を postMessage で流し込む。英語をコード内の既定値として持ち、解決前でも動作する
- popup は `data-i18n` 属性を `browser.i18n.getMessage` で流し込み、ヘルプは UI 言語に応じて英/日ブロックを出し分け

## ストア配信 (Chrome Web Store)

限定公開 (Unlisted) 前提。掲載文・権限説明の下書きは `STORE_LISTING.md`、プライバシーポリシーは `PRIVACY.md`(公開 URL でホストが必要)。アイコンは `public/icon/{16,32,48,96,128}.png`。残: スクリーンショット、デベロッパー登録、プライバシーポリシーの公開ホスティング。

## アーキテクチャ

```
entrypoints/
  inspector.content.ts  MAIN world / document_start。DevTools フック確立 + インスペクタ本体
  bridge.content.ts     ISOLATED world。chrome.storage / background ↔ MAIN world の中継
  background.ts         キーボードショートカット → タブへトグル指示
  popup/                設定 UI (エディタ・MUI スキップ・パスマッピング)
src/
  hook.ts        __REACT_DEVTOOLS_GLOBAL_HOOK__ シム (React 読み込み前に設置)
  fiber.ts       Fiber 解析 (名前・分類・owner チェーン・ソース解決)
  source.ts      パス正規化 + React 19 _debugStack のスタック解析 (純関数)
  classify.ts    MUI / 自作 / サードパーティ分類 (純関数)
  editor.ts      エディタ URL 生成 (純関数)
  overlay.ts     Shadow DOM 隔離のハイライト / バッジ / owner パネル / レンダー明滅 canvas / 統計パネル
  inspector.ts   インスペクトモードの状態機械
  renderTracker.ts  コミット走査による再描画検出・集計 (純関数寄り、self 時間で祖先を除外)
  renderDebug.ts    レンダー可視化モードの制御 (commit 購読 → 明滅 / 記録 → ランキング)
```

### レンダー可視化の仕組み

`onCommitFiberRoot` を購読し、コミットごとに Fiber ツリーを走査。`actualDuration`(dev ビルドの Profiler タイマ)から子の分を差し引いた「自己時間」が正の fiber のみを「自分が再描画した」とみなすことで、再描画した子を持つだけの祖先の過剰報告を防ぐ。走査は `requestAnimationFrame` でコミットを束ねて実行し、対象ページのフレーム落ちを避ける。production ビルドでは `actualDuration` が無いため明滅のみ(時間計測不可)。

### ソース位置解決の多層戦略

1. `fiber._debugSource` — React ≤18 dev ビルド(`@babel/plugin-transform-react-jsx-source`)
2. `fiber._debugStack` — React 19 dev ビルド(owner stacks)。スタックから node_modules / React 内部を除いた最初のフレームを採用
3. どちらも無い場合はバッジに `source unavailable` を表示しジャンプ不可

### 既知の制約

- production ビルドではセーフモード(名前推定のみ、ジャンプ不可)
- RSC(Server Components)はクライアント側 Fiber が無いため対象外
- iframe(Storybook)・Portal 対応、ビジュアルツリーは Phase 2
