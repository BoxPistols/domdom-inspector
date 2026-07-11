# 検証記録 — レンダープロファイリング v2 (2026-07-11)

実 Chromium (Playwright, xvfb) に built 拡張をロードし、React 18 の実アプリ
(dev / production 両ビルド、UMD) で end-to-end 検証した。テストアプリは
原因パターンを意図的に作る構成:
`App(useState×2)` → `Value(props変化)` / `Static(props同値=巻き込まれ)` /
`MemoStatic(React.memo)` / `SlowList(props変化)` → `SlowItem×20(busy 0.3ms, props同値)`。

## 結果 (すべて実測スクリーンショット・クリップボード実読で確認)

### 計測の正確性 (dev ビルド, 6クリック + テキスト入力1回 = 7 commits)

| Component | Renders | 原因内訳 | 直近変化 | 自己時間 |
|---|---|---|---|---|
| SlowItem | 140 (=20×7) | parent×140 (無駄) | — | 48.8ms (設計値 0.3ms×140 と一致) |
| App | 7 | state×7 | hooks: #1 (テキスト=第2 hook を正しく特定) | 1.1ms |
| SlowList | 7 | props×6 parent×1 | props: rev | 0.5ms |
| Static | 7 | parent×7 (無駄) | — | 0.2ms |
| Value | 7 | props×6 parent×1 | props: count | 0.1ms |

- `props×6 parent×1` の分離が正しい: テキスト入力だけのコミットでは
  `rev`/`count` が変わらないため、その 1 回だけ parent (無駄) になる。
- **MemoStatic は 0 回** (memo バイルアウトを誤検出しない)。
- フラッシュ対象も正確: `memo: fixed` 行だけ明滅せず、他はヒート色 (6回=黄) で明滅。
- 初回マウントの全画面フラッシュは抑制される (alternate.child null 判定)。

### production ビルド

- 回数・原因・無駄レンダーは dev と同一の正確さ (4クリック → SlowItem parent×80 等)。
- 時間列は「—」+ 「Production build: render counts and causes are exact,
  timings need a dev build」の注記。

### Page vitals / AI レポート

- vitals チップ: LCP / CLS / FCP / TTFB がレーティング色付きで表示 (localhost で全 good)。
- 「Copy AI report」→ クリップボードから Markdown レポートを実読で確認
  (サマリ / vitals 表 / 原因内訳表 / Memoization candidates: SlowItem 140/140,
  Static 7/7 / 10 バケットタイムライン / 分析観点 5 問)。

### UI / 職域

- Esc 1 回でパネル・コントロール・フラッシュ全消去 + 「Render viz OFF」トースト。
- 記録トグルは input フォーカス中の R を無視 (仕様) — その場合もコントロールの
  Stop ボタンで停止できる。
- popup: ダーク既定 / ライト両テーマ、designer 切替でレンダー計測・開発者設定が
  非表示になり engineer で復帰。ⓘ はラベル行内に表示。

## 既知の制限

- INP は 40ms 超のインタラクションが無いと観測されない (テスト環境では未観測)。
- 統計は同名コンポーネントを集約する (インスタンス別ではない)。
- StrictMode の二重 render は React 側の挙動どおり 1 コミット 1 回で数える。
