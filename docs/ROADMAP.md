# 実装ロードマップ — Phase 2〜5 要件定義と計画

要件定義書 v3.0(FR-05〜FR-27)を、**現行アーキテクチャに接地した実装計画**へ落としたもの。
Phase 1(インスペクタ MVP)+ レンダーデバッグは実装済み。本書は以降の計画。

> **完了済み追記 — レンダープロファイリング v2(2026-07)**
> レンダー計測を React DevTools と同一基準に刷新済み:
> - 判定: `flags & PerformedWork` + alternate 差分走査(bailout サブツリーをスキップ)。
>   production ビルドでも回数・原因が正確(時間計測のみ dev/profiling ビルド必要)。
> - why-did-render: 原因分類 `mount / state(hook index 付き) / props(変化キー付き) / parent(無駄=memo 候補) / other`
>   (`src/renderCause.ts`)。統計パネルの行 hover で内訳表示。
> - Page vitals: LCP/CLS/INP/FCP/TTFB/LongTasks を PerformanceObserver で常時観測(`src/vitals.ts`)。
>   Closed 環境での Lighthouse 代替。
> - AI レポート: 記録スナップショット + vitals から Markdown 分析レポートを生成しクリップボードへ
>   (`src/report.ts`)。AI アシスタントに貼ってチューニング対話を始められる。
> - popup: darkmode ファースト + WCAG AA コントラスト + 職域スイッチ(designer/engineer、
>   `Settings.role`)でエンジニア専用 UI の表示を切替。
>
> **完了済み追記 — v0.4.0(2026-08-02, issue #3-#9 一括解決)**
> - **Phase 1 機能の再配線**(issue #4/#5): レンダープロファイリング v2 / コンポーネント
>   ツリー / Page Vitals を 4 点配線 + Esc 中央ハンドラで復活(7166b4f の逆適用)。
> - **FR-14 MUI テーマ自動取得**(issue #8): `src/muiTheme.ts`(Fiber から context 値を
>   ダックタイピング発見、DOM 後備つき)+ `tokenDict.parseMuiTheme`(純関数変換)。
>   手動貼り付け優先で併合、`Settings.autoTheme` で停止可。
> - **Phase 5 コア FR-24〜27**(issue #9): BYOK(OpenAI/Gemini、モデル ID は設定値)、
>   background から公式エンドポイントへ fetch、送信前プレビュー必須、AI 生成バッジ、
>   セッション上限 20、ハード無効化トグル。入力は `src/designScan.ts`(集計スタイル値のみ)。
>   PRIVACY/SECURITY 改訂済み。
> - 残: FR-15〜18(リントエンジン/パネル)、Phase 4(FR-19〜22)、FR-23。
>
> **v1 スコープ決定 第 2 弾(2026-08-06)— カバレッジ計測 / AI 監査 / 表示設定も外す**
> オーナー判断。popup の下半分 (トークンカバレッジ・AI 監査・表示設定) を v1 の配線から外した
> (実装は温存)。v1 = 「ホバーした要素を計測し、利用者のトークンと照合する」一本。
> - **カバレッジ**: popup では率の意味を保つ情報 (分母・母集団・但し書き・凡例) が入りきらず、
>   popup が外側クリックで必ず閉じるため検算ループも作れない。side panel として再導入する。
>   設計は `docs/design-coverage-screen.md` に確定済み (Phase E は 2026-08-06 完了) →
>   [#10](https://github.com/BoxPistols/domdom-inspector/issues/10)
> - **AI 監査**: これがあるだけで CWS の Data usage 申告に Website content と
>   Authentication information の 2 カテゴリが必要になる。外したことで**申告は「収集なし」に戻り**、
>   `fetch` の発生箇所が 0 件になった →
>   [#11](https://github.com/BoxPistols/domdom-inspector/issues/11)
> - **表示設定**: 「設定」ではなく**計測条件**。率の隣に出すべき情報だった →
>   [#12](https://github.com/BoxPistols/domdom-inspector/issues/12)
> - **トークン JSON 貼り付け**: オーナーが Figma を使わないため、使わない機能を popup の
>   一等地に見せていた。MUI テーマ自動検出があるので **MUI アプリでは設定ゼロで照合が動く** →
>   [#13](https://github.com/BoxPistols/domdom-inspector/issues/13)。
>   これに伴い照合辞書の供給元は MUI 自動検出のみになり、`_locales` の `extDescription`
>   (拡張カードに出る説明文) も MUI 軸へ書き換えた
> 外した結果、対外文書 4 点 (STORE_LISTING / PRIVACY / SECURITY / PUBLISHING) の単一目的と
> データ申告を同時に狭めた。再導入時は 4 文書を同時に広げること。

> **v1 スコープ決定(2026-08-03)— 上記「Phase 1 機能の再配線」を v1 では巻き戻す**
> コンポーネントツリー / レンダープロファイリング v2 / Page Vitals / Markdown レポートを
> **再び v1 の配線から外した。実装は温存(削除ではなく到達不能)** — `src/treeView.ts` /
> `src/tree.ts` / `src/renderDebug.ts` / `src/renderTracker.ts` / `src/renderCause.ts` /
> `src/vitals.ts` / `src/report.ts` はそのまま残っている。
> 理由(実機フィードバックと競合調査で確定):
> - production ビルドでは React がコンポーネント名を minify するため**原理的に判読不能**
>   (実機で `0e` / `je` / `Anonymous` が 1064 行並ぶツリーを確認)。
> - 開発ビルドなら React DevTools の方が優れる(同じ土俵で勝てない)。
> - レンダー可視化は react-scan の Chrome 拡張が既に同じ土俵にいる(約 7,000 ユーザー)。
> - 掲載文で「React 開発者向け」を名乗ると単一目的の説明が広がり、審査リスクが上がる
>   (`STORE_LISTING.md` の Single purpose を「計測 + トークン照合」に絞り直した)。
> - 製品の芯は「**本番画面 × 自分のトークンで準拠検証**」で、そこだけは競合が見つからなかった
>   (`docs/assessment-20260802-store-readiness.md`)。
>
> 復活させる場合: `CLAUDE.md` 地雷3 の **4 点配線 + Esc 中央ハンドラ**を戻す
> (wxt.config commands / background COMMANDS / bridge onMessage / inspector.content handler)。
> 設計と経緯の参照先は issue #4(レンダープロファイリング)/ #5(ツリー)だが、どちらも
> v0.4.0 で close 済みのため、再開する際は新しい issue を立てて追跡する。
> 再配線して掲載に戻すなら、単一目的の申告 (`STORE_LISTING.md` / `PUBLISHING.md` §4-2 /
> `PRIVACY.md`) も同時に広げること。
>
> **完了済み追記 — Figma デザイントークン照合(2026-07)** — Phase 3 FR-15 の
> 「テーマ取得に依存しない先行版」:
> - popup にトークン JSON 貼り付け(Figma Variables / W3C Design Tokens / Tokens Studio
>   を自動判別、`src/tokenDict.ts`)。storage → bridge → MAIN world へ配信。
> - ホバーバッジの色/余白/角丸チップに「一致トークン名(緑)/ 野良値 + 最近傍(黄)」を注釈。
>   色は常に照合、サイズはトークンに近い外れ値(≤4px)のみ警告(遠い値はレイアウト都合と
>   みなし沈黙)。トークン一致したラベルは 4px グリッド警告を抑制(トークンが正)。
> - production サイトでも動作(computed style ベース)。MUI テーマ自動取得(FR-14)は
>   この照合辞書を再利用して次段で載せる。

- 見積は 1 人日 = 集中作業 6h 換算の粗見積(±50%)
- 各項目に「再利用する既存モジュール」「新規モジュール」「受け入れ条件」を付す
- MoSCoW は v3.0 の優先度を踏襲

---

## 現行アーキテクチャの再利用資産

新機能はこれらの上に載せる(車輪の再発明をしない)。

| 資産 | 場所 | 提供するもの |
|------|------|-------------|
| DevTools フック | `src/hook.ts` | `onCommit(listener)` 購読 / `devMode` / `roots` / `renderers` |
| Fiber 解析 | `src/fiber.ts` | 名前/分類/owner チェーン/host 要素/ソース解決/props 要約 |
| 分類 | `src/classify.ts` | MUI / 自作 / third-party |
| Shadow DOM UI | `src/overlay.ts` | 隔離オーバーレイ・パネル・canvas・トースト・統計パネル |
| 設定/文字列注入 | `bridge.content.ts` → `postMessage` | MAIN world への設定・i18n 供給の一方向経路 |
| i18n | `public/_locales` + `UiStrings` | 英日、bridge 解決方式 |
| 純関数テスト基盤 | vitest + happy-dom | fiber/source/editor/classify/renderTracker |

> 重要な制約(全 Phase 共通): MAIN world は拡張 API 不可 → データ収集・保存・AI 通信は
> **必ず bridge(ISOLATED)/ background 側**で行い、MAIN world とは postMessage で往復する。

---

## Phase 2 — ビジュアルツリー・デザインモード・Storybook 対応

**目的**: 単一要素のインスペクトから、コンポーネント階層の俯瞰と閲覧専用モードへ。
**リリース**: ストア v1.x(現行 v1.0 の直接の続き)

### FR-05 ビジュアル・コンポーネントツリー 【Must】
- Fiber の論理階層をツリー描画。Portal をまたいで親子を保つ。
- 再利用: `getOwnerChain` / `getHostElementOfFiber` / `getFiberName` / `classify`。
- 新規: `src/tree.ts`(root からの Fiber ウォークでツリーモデル構築、`hook.roots` を起点)、
  `overlay.ts` にツリーパネル描画を追加。
- データ量対策: 遅延展開(ノード開閉時に子を構築)、仮想スクロール。

### FR-06 ツリーのノイズ抑制 【Must】
- HostComponent 折りたたみ、Provider / Styled / Fragment 非表示のフィルタ。
- 新規: `src/tree.ts` にフィルタ述語(`COMPONENT_TAGS` を流用 + 除外タグ集合)。

### FR-07 ツリー ⇔ DOM 双方向ハイライト連動 【Should】
- ツリーのノード hover → 実 DOM をハイライト(既存 `overlay.show` を流用)。
- 実 DOM の hover → ツリーの該当ノードへスクロール&強調。
- 再利用: `getFiberFromElement`、`overlay` のハイライト。

### FR-10 デザインモード(閲覧専用)【Should】
- クリック無効・props 表示とコピーに特化した非破壊モード。
- 再利用: `inspectElement`(props 要約)、`overlay` バッジ。`inspector.ts` にモードフラグ追加。

### FR-11 設定拡充(オリジン別有効化)【Should】
- `Settings` に `enabledOrigins` / オリジン別トグルを追加。bridge の `pushSettings` で判定。
- 既存の popup 設定 UI を拡張(タブ分けを検討)。

### FR-13 複数ルート・iframe(Storybook)・Portal 対応 【Should】
- `hook.roots` は複数 root を保持済み。ツリーを root ごとに束ねる。
- iframe: `all_frames: true` を content script に付与し、フレーム単位で hook を確立。
  親↔子フレームは postMessage 集約(bridge 側で frame 識別)。
- Portal: Fiber 上は親子が繋がるため論理ツリーは自然に対応。DOM ハイライトのみ座標に注意。

**新規モジュール**: `src/tree.ts`(+ `tree.test.ts`)、overlay へツリー/デザインパネル追加。
**受け入れ条件**: 1,000 ノード規模で展開が 60fps を割らない / Storybook の iframe 内コンポーネントを識別できる / デザインモードで対象ページを一切壊さない。
**見積**: 4〜6 人日。

---

## Phase 3 — デザインリント(テーマ辞書・トークン/マークアップ検出)

**目的**: 「見る」から「正す」へ。テーマ準拠の逸脱を検出しサジェスト。
**リリース**: v1.x

### FR-14 テーマ(デザイントークン)辞書の自動構築 【Must】
- `ThemeProvider` の Fiber を探し、React Context 値からテーマオブジェクトを取得。
- 再利用: Fiber ウォーク(`tree.ts`/`fiber.ts`)。MUI バージョン差はアダプタで吸収。
- フォールバック: `theme.vars` / `--mui-*` CSS 変数 → 既定テーマ近似(精度低下を UI 明示)。
- 新規: `src/theme/themeExtract.ts`(取得 + アダプタ)、`src/theme/tokenDict.ts`(照合辞書)。

### FR-15 トークン逸脱検出(野良/ハードコード)【Must】
- 3 系統併用: ①`memoizedProps` の `sx`/`style` 生値(最高精度、`summarizeProps` の拡張)
  ②CSSOM の `var(--mui-*)` 比率 ③`getComputedStyle` 突合(warning 上限)。
- 色は ΔE 近似距離、寸法は spacing スケール剰余で最近傍トークンをサジェスト(決定論・非 AI)。
- 新規: `src/lint/rules/`(`DL-COLOR-*`/`DL-SPACE-*`/`DL-TYPO-*`/`DL-SHAPE-*`)、`src/lint/engine.ts`。

### FR-16 マークアップ品質検出(Box 乱用・sx 過剰)【Must】
- `DL-BOX-001..004` / `DL-SX-001..003`。Fiber の props と親子構造から純関数で判定。
- 再利用: Fiber ツリー、`classify`。閾値は `Settings` で調整可能に。

### FR-17 テーマ未定義パターン検出 【Should】
- variant 化候補(反復 sx クラスタ)、再発明候補(自作モーダル等)をヒューリスティック検出。
- 非断定表現で提示(v3.0 §7)。

### FR-18 リントパネル(デザイナー向け)【Must】
- 重要度/ルール/コンポーネント別一覧、該当要素フォーカス、レビューコメント形式コピー、
  dismiss/ミュート永続化。デザイナー表示 ⇔ エンジニア表示の 2 モード。
- 再利用: `overlay` の統計パネル基盤を汎用化。永続化は `chrome.storage`(bridge 経由)。

**エンジン設計**: ルール = `(FiberNode + tokenDict + computedStyle) → Finding` の純関数(プラガブル)。
スキャンは `hook.onCommit` → `requestIdleCallback` で増分実行(NFR-01/NFR-04 準拠、既存 rAF 束ねの発展)。
**新規モジュール**: `src/theme/*`、`src/lint/*`(engine/rules/dictionary、各 `*.test.ts`)。
**受け入れ条件**: 1,000 Fiber を 2 秒以内(p95)/ 主要ルールの誤検知(dismiss)率 < 10% / テーマ取得失敗時もフォールバックで動作。
**見積**: 8〜12 人日(テーマ取得のバージョン差吸収が重い)。

---

## Phase 4 — セッションスキャン・アーキテクチャ抽出・レポート・Skills(非 AI)

**目的**: 現状を機械可読形式で外部化(AI 駆動開発・Skills の入力)。
**リリース**: v1.x

### FR-19 セッションスキャン 【Should】
- 画面遷移(SPA 含む)に追従して検出結果/コンポーネント統計を IndexedDB に蓄積。
- 収集対象は「レンダリング済み UI」限定を UI 明示。全削除を提供。
- 新規: `src/store/indexeddb.ts`(**bridge 側**、オリジン単位スキーマ。メタデータのみ、表示テキスト/入力値は保存しない)。SPA 遷移は history API フック(MAIN world)→ bridge 通知。

### FR-20 UI アーキテクチャ抽出 【Should】
- コンポーネントセンサス(頻度/自作↔MUI 対応)、トークンカバレッジ、構造メトリクス。
- 再利用: Phase 3 の検出結果 + `classify`。集計は純関数 `src/insight/census.ts`。

### FR-21 課題レポート生成(Markdown/JSON)【Must】
- サマリ→画面別→ルール別違反(ファイルパス/行/サジェスト付き)→推奨アクション(テンプレ、非 AI)。
- Claude Code 等へそのまま渡せる粒度(ファイルパス・行を含む)を受け入れ条件に。
- 新規: `src/insight/report.ts`(集計 → Markdown/JSON レンダラ、純関数でテスト容易)。

### FR-22 デザインルール Skills 生成 【Should】
- SKILL.md 雛形(frontmatter / トークン辞書 / してよい・悪い例 / コンポーネント選定規範)。
- テンプレ + 観測データ差し込みの非 AI 処理。新規: `src/insight/skills.ts`。

**新規モジュール**: `src/store/*`(IndexedDB)、`src/insight/*`(census/report/skills)。
**受け入れ条件**: レポートを追加説明なしで修正タスク指示書として使える / 保存はメタデータのみ(プライバシー)/ 生成物が決定論的(同入力→同出力)。
**見積**: 5〜7 人日。

---

## Phase 5 — AI アシスト(BYOK・オプション)+ ヒューリスティック評価

**目的**: 決定論的コアの上に、任意の自然言語講評レイヤを分離して載せる。
**リリース**: v2.0(データ送信を伴うためプライバシー申告更新 + 独立審査)

### FR-23 UI/UX ヒューリスティック評価 【Could】
- 決定論スコアリング: コントラスト比(WCAG)、タップターゲット、見出し階層、フォーカス可視性、
  4/8px グリッド、タイポスケール。**AI 不要**、Phase 3 リントエンジンの拡張。
- 新規: `src/lint/heuristics/*`(既存の静的辞書パターンを踏襲)。

### FR-24 BYOK 接続管理 【Should】
- OpenAI / Gemini、最安クラス既定 + 次点の 2 段。**モデル ID はハードコードせず設定値**。
- キーは `chrome.storage.local`(sync はオプトイン)。通信は **background(Service Worker)から
  公式エンドポイントへ直接 fetch**。optional host permissions(`api.openai.com` /
  `generativelanguage.googleapis.com`)。MV3 リモートコード禁止に適合(取得はデータのみ)。
- 新規: `src/ai/providers/*`、`entrypoints/background.ts` に AI 通信ハンドラ。

### FR-25 AI 適用範囲(必要なければ使わない)【Must(原則)】
- 検出/分類/最近傍照合/レポート・Skills 構造生成は **AI 不使用**。AI は講評・言語化のみ、
  **常にユーザーの明示ボタン操作起点**。バックグラウンド自動呼び出し禁止。

### FR-26 品質・表示 【Should】
- 「AI 生成」バッジで決定論結果と区別。送信は抽出済みメタデータのみ(生 DOM/スクショ/業務データ不可)。
  送信前プレビュー必須。

### FR-27 コスト・ガバナンス 【Should】
- 実行前に概算トークン/コスト表示、セッション呼び出し上限、**AI 全体ハード無効化トグル**
  (クライアント案件向け、設定エクスポートで配布可)。

**AI レイヤ分離の原則**: `src/ai/*` は完全に独立。失敗してもコア(A/B/C)に影響しない。
**新規モジュール**: `src/ai/*`(providers/prompt/preview/cost)、background の通信層、popup に BYOK 設定 UI。
**受け入れ条件**: キー未登録で全コア機能が動く / 送信内容がプレビューで確認できる / ハード無効化が効く / 1 講評の実コストが事前概算 ±30% 以内。
**見積**: 8〜10 人日。

---

## 横断タスク(各 Phase と並行)

- **E2E 互換マトリクス CI**: React 18/19 × MUI v5/v6/v7 × Vite/Next。テーマ取得アダプタの回帰検知。
- **ドキュメントサイト**: オンボーディング、ルールカタログ、パスマッピングガイド(日英)。
- **プライバシーポリシー更新**: Phase 5 のデータ送信に合わせて `PRIVACY.md` 改訂 + 再審査。
- **各 Phase 末のドッグフーディング**: 実務環境での試用を必須工程に。

---

## 優先順位の提案(次に着手するなら)

1. **Phase 2 の FR-05/06(ビジュアルツリー)** — 既存 Fiber 解析の素直な発展で価値が高く、リスク低。
2. **Phase 3 の FR-14(テーマ取得 PoC)** — ここがプロダクトの中核かつ最大の技術リスク。
   FR-15 以降の全機能が依存するため、**先に PoC で取得可否を検証**してから本実装に進む。
3. Phase 4 レポートは Phase 3 の検出結果があって初めて意味を持つ → Phase 3 の後。
4. Phase 5(AI)は最後。コアが AI なしで完結している状態を保つ。

> リスク先出しの指針: 「Phase 3 のテーマ取得」と「Phase 2 の iframe/Storybook」が二大不確実性。
> 本実装前に各々 0.5〜1 人日の PoC を切ることを推奨。
