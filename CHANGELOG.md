# 変更履歴

版数は `package.json` の `version` が正で、WXT が manifest に反映する。

**実機確認を頼む前に patch を上げる。** 版数が変わらないと、`chrome://extensions` の
拡張カードを見ても ⟳ が効いたのか、古いビルドを見ているのかが区別できない
(実際にそれで「右クリックが出ない」と報告された)。手順は
`pnpm build` (同期フォルダへの展開まで自動) → ⟳ → 拡張カードの版数を確認、の順。

CWS は同一バージョンの再アップロードを拒否するため、公開時も必ず上げる。

---

## 0.4.1 (2026-08-06)

### 追加

- **右クリックメニュー**「この要素を検査」「この要素のソースをエディタで開く」。
  モード OFF でも 1 アクションで結果まで到達する。`contextMenus` 権限を追加したが、
  ページへのアクセス権限は増えない。メニューは**実際に動作する範囲**
  (localhost + 許可済みオリジン) にのみ表示する
- **Web Components (shadow DOM) 対応**。open shadow root を貫通してカーソル直下の要素を
  計測する。以前はホスト要素の値を出しており、利用者に区別のつかない誤答だった。
  closed shadow root は仕様上辿れないためホストで止まる
- **Alt+Click の描画元リスト**を配線。行クリックでそのファイルをエディタで開く
- **エディタ設定の到達可能化**: パスマッピング (1 行 1 件 `from=to`) と
  カスタムエディタ URL。実装とテストはあったが UI が無く、パスが違う環境
  (Docker / リモート開発 / monorepo) で直す手段がなかった
- `minimum_chrome_version: 119` を宣言 (依存 API の下限の最大値 = `matchOriginAsFallback`)

### 修正

- **「表示はあるが実働していない」を 6 系統**。モード ON のトーストが案内していた
  `Click: editor` (実際は ⌘/Ctrl 必須) と `Alt+Click: rendered-by tree` (ハンドラ不在) を
  実装と一致させた。後者は preventDefault だけが効いて完全な無反応だった
- **⌘/Ctrl+Click が開けないときに理由を出す**。素の DOM / production ビルド /
  バンドル出力 / 位置不明 の 4 状態を区別する (以前は黙って何もしなかった)
- **コピー用 Markdown が画面より不誠実だった**のを構造で封鎖。来歴を主張してよいかの
  判定を `CoverageReport.originTrusted` に集約し、呼び出し側に条件を渡させない
- **カバレッジの理由文 3 件**: 「該当トークンなし」の誤用 (解析不能を含めていた) /
  来歴を出せない理由の取り違え (予算切れ と stylesheet 不読) / 打ち切りで母集団の違う
  2 数を並べていた
- **有効化直後のタブで UI 文言が英語に固定される**決定論バグ。bridge の初回 i18n 送信が
  inspector のリスナ登録前に飛んでいた (押し込み → 受け手主導の引き取りへ)
- **野良値ランキングが嘘をついていた**。同じ値が来歴 (var / 直書き) で 2 行に分裂し、
  件数降順を名乗りながら実際の最多を下に押しやっていた
- **来歴予算 (1.5 秒) が機能していなかった**。超過後も CSSOM 全走査を続けて結果だけ捨てていた
- **打ち切り判定の偽陽性**。計測対象外の要素が多いだけで「途中で打ち切った」と申告していた
- URL を返さないタブ (blob: 等) を「検査できない」と断定せず、注入を試す形に

### 内部

- **e2e が実は何も検証していなかった欠陥**を修正。バッジ読み取りが shadow root 全体の
  `textContent` を返しており、そこに overlay 自身の CSS が含まれるため、assert していた
  px 値はすべて CSS 側にも存在した (バッジが空でも通る)。検出力は敵対的に実証済み
- 判定閾値 (`COLOR_HIT` / `COLOR_NEAR` / `SIZE_HIT` / `SIZE_NEAR` / `DEFAULT_GRID_PX`) を
  export し、出力側で開示できるようにした
- 境界契約 (`boundaries.test.ts` + ESLint) に `coverage` を追加
- テスト: unit 250 → 284、e2e 8 → 15
- **`pnpm build` が同期フォルダへの展開まで自動で行う**ようになった (複数 PC で同じ unpacked
  拡張を共有する運用のため)。内容が同じときは書かない (OneDrive が毎ビルドで再アップロード
  しないように)。展開先が特定できない環境 (CI / 他人のクローン) では警告のみで build は成功する。
  Windows の `%OneDrive%` も自動検出する。同期だけしたいときは `pnpm sync`、
  同期せずビルドしたいときは `pnpm build:only`

### 対外文書

- **審査提出ブロッカーを解消**。`PUBLISHING.md` §5-0 の審査担当者向けメモが、v1 に存在しない
  機能 (component tree Alt+Shift+T / render profiling Alt+Shift+R) の操作手順を渡していた
- `PRIVACY.md` / `SECURITY.md` / `STORE_LISTING.md` / wiki 下書きから、存在しない機能の
  宣言を全廃。権限表に `contextMenus` を追記
- `docs/design-coverage-screen.md` (新規): カバレッジ計測を side panel へ移す設計と根拠
- `docs/manual-verification-20260806.md` (新規): 自動検証できない項目 20 件

### Touch Bar (BTT プリセット)

- ▲▼ を削除。↑↓ を素キーで送るため、モード OFF のときページへ漏れていた
  (機能自体は生きているので、復活は修飾キー必須の manifest command へ昇格させてから)
- esc / ⚙︎ を 62 → 76px (Touch Bar を共有する 3 プロジェクトの下限 70px を下回っていた)

---

## 0.4.0 (2026-08-02〜03)

- MUI テーマ自動取得 (FR-14) / BYOK AI デザイン監査 (FR-24〜27) / トークンカバレッジ集計
- **v1 スコープ決定**: コンポーネントツリー / レンダープロファイリング / Page Vitals /
  Markdown レポートを配線から外す (実装は温存)。production では React が名前を minify するため
  原理的に判読不能で、dev なら React DevTools が優れるため
- 詳細は `docs/ROADMAP.md`
