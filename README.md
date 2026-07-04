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

## セットアップ

```sh
pnpm install
pnpm dev        # 開発 (自動リロード付きで Chrome が起動)
pnpm build      # .output/chrome-mv3 に成果物
pnpm test       # ユニットテスト
```

手動読み込み: `pnpm build` 後、`chrome://extensions` → デベロッパーモード → 「パッケージ化されていない拡張機能を読み込む」→ `.output/chrome-mv3`

対象オリジンは `localhost` / `127.0.0.1` のみ(権限最小化)。

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
  overlay.ts     Shadow DOM 隔離のハイライト / バッジ / owner パネル
  inspector.ts   インスペクトモードの状態機械
```

### ソース位置解決の多層戦略

1. `fiber._debugSource` — React ≤18 dev ビルド(`@babel/plugin-transform-react-jsx-source`)
2. `fiber._debugStack` — React 19 dev ビルド(owner stacks)。スタックから node_modules / React 内部を除いた最初のフレームを採用
3. どちらも無い場合はバッジに `source unavailable` を表示しジャンプ不可

### 既知の制約

- production ビルドではセーフモード(名前推定のみ、ジャンプ不可)
- RSC(Server Components)はクライアント側 Fiber が無いため対象外
- iframe(Storybook)・Portal 対応、ビジュアルツリーは Phase 2
