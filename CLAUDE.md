# CLAUDE.md — DomDom Inspector 開発ガイド

全セッションの冒頭に読み込まれる。**新しい機能・保守を始める前に必ずここを読むこと。**

## プロダクト概要

React/MUI コンポーネントのインスペクタ Chrome 拡張 (WXT + TypeScript, MV3)。
- **コア(React 汎用)**: ホバー識別 / エディタジャンプ
  (ツリー / レンダーデバッグは実装を温存したまま v1 の配線から外した。下記「現状」)。
  スタイル手法(Tailwind/CSS/styled)非依存。React Fiber を読む。
- **MUI 固有**: 分類の「青=MUI」判別 + 将来のデザイントークン計測。
- **デザイナー向け production 対応**: デプロイ済み App でも computed-style デザイン検査
  (色/余白/角丸)+ 野良値検出が動く(M1/M2/M3)。
- ターゲットはエンジニアだけでなく**デザイナー/ステークホルダー**。localhost 前提にしない。

現状: **v0.4.3**。**v1 の配線は「ホバーした要素を計測し、利用者のトークンと照合する」一本**:
inspect (design バッジ + tokenDict 照合 + 野良値 + **CSS 変数名の優先表示** (`cssVars.ts` Tier1)
+ **⌘/Ctrl+Click / 右クリックメニュー からのエディタジャンプ** (dev の実ソースのみ /
minified は `isBundledSource` で抑制 / 開かなければパスのコピー導線) + **Alt+Click の描画元リスト**
+ **shadow DOM 貫通** (open root は最内要素まで / closed はホストで止まる)) /
**MUI テーマ自動取得** (`muiTheme.ts` が Fiber から発見 → `tokenDict.parseMuiTheme` が変換)。
**照合辞書の供給元はこれだけ** — トークン JSON 貼り付けは v1 の配線から外し
([#13](https://github.com/BoxPistols/domdom-inspector/issues/13))、
**MAIN world の `tokens` 受信も閉じた** (ページが辞書を注入して「一致」を偽装できた /
[#16](https://github.com/BoxPistols/domdom-inspector/issues/16))。e2e と撮影も実供給元
(テーマ自動検出) を使う = **テスト専用の裏口を持たない**。
**モードの ON/OFF は全フレームで 1 つ**: 変化したフレームが bridge → background に通知し、
background が全フレームへ冪等な `inspect-on`/`inspect-off` を配る。トグルはトップフレーム
(`frameId: 0`) だけに送り、ピルとトーストもトップだけが出す
([#14](https://github.com/BoxPistols/domdom-inspector/issues/14))。

**外部送信はゼロ** (`fetch`/XHR/WebSocket/beacon の発生箇所が 0 件)。この事実に
`SECURITY.md` / `PRIVACY.md` / `STORE_LISTING.md` / `PUBLISHING.md` の申告が依存しているので、
送信経路を足すときは 4 文書を同時に直す。

**トークンカバレッジ計測 / BYOK AI デザイン監査 / 表示設定 (3 つ) も v1 の配線から外した**
(2026-08-06。実装は `coverage.ts` / `designScan.ts` / `aiProviders.ts` / `aiPrompt.ts` /
`aiCost.ts` に温存)。カバレッジは popup では率の意味を保てず検算もできないため side panel として
再導入する (issues [#10](https://github.com/BoxPistols/domdom-inspector/issues/10) /
[#11](https://github.com/BoxPistols/domdom-inspector/issues/11) /
[#12](https://github.com/BoxPistols/domdom-inspector/issues/12))。

**コンポーネントツリー (旧 Alt+Shift+T) / レンダープロファイリング v2 (旧 Alt+Shift+R) /
Page Vitals / Markdown レポートは v1 の配線から外した**(実装は `treeView.ts` / `tree.ts` /
`renderDebug.ts` / `renderTracker.ts` / `renderCause.ts` / `vitals.ts` / `report.ts` に温存。
**削除ではなく到達不能**)。理由: production では React がコンポーネント名を minify するため
原理的に判読不能(実機で "0e" "je" "Anonymous" が並ぶ)/ dev なら React DevTools が優れる /
レンダー可視化は react-scan の Chrome 拡張が同じ土俵にいる / 掲載文で「React 開発者向け」を
名乗ると単一目的の説明が広がり審査リスクが上がる。製品の芯は「本番画面 × 自分のトークンで
準拠検証」。**モード系の復活時は本ファイル地雷3の 4 点配線を戻す**(エディタジャンプは click
ハンドラで mode ではないため 4 点配線不要)。
designer/engineer ロールトグルは機能差ゼロのため除去済み (`Settings.role` 型は dormant)。
詳細 `docs/ROADMAP.md` / 判断の根拠 `docs/assessment-20260802-store-readiness.md` / **監査の記録は `docs/audit-20260807-deep.md`** (12 エージェント監査の全 70 件、実測根拠つき。⬜ 未対応 0 件 — 残りは issue #17-#19 と「修正しない判断」4 件) / 提出可否は `docs/store-submission-readiness.md` (数字は `pnpm check:submission` が実測)。

## アーキテクチャ(2 world 構成 — 最重要)

```
background.ts (SW) ── commands/tab メッセージ中継
  │ tabs.sendMessage
bridge.content.ts (ISOLATED) ── browser.* 可。storage/i18n を解決
  │ window.postMessage (同一 window 内のみ)
inspector.content.ts (MAIN, document_start) ── ページ JS と同環境。browser.* 不可
  ├ hook.ts / fiber.ts / inspector.ts / overlay.ts
  └ (v1 配線外し・温存) tree.ts / treeView.ts / renderDebug.ts / vitals.ts
popup/ ── 設定 UI (browser.* 可)
```
**鉄則: MAIN world は `browser.*` を使えない。** 設定・i18n は bridge が解決して postMessage で
共有 `strings` オブジェクトを in-place 更新。

## 地雷(踏むと時間を溶かす)

1. **i18n は 3 箇所同期**: 文字列追加/変更は `src/types.ts` の `DEFAULT_STRINGS` +
   `public/_locales/{en,ja}/messages.json` を**同時に**。欠けると bridge が壊れる。`src/i18n.test.ts` が機械検知。
2. **locale/manifest を変えたら `pnpm wxt prepare`**(i18n 型と manifest 型を再生成)。
3. **新モード = 4点配線 + Esc**: wxt.config commands / background COMMANDS / bridge onMessage /
   inspector.content handler(+ new + Esc 中央ハンドラ)。規約 `enable/disable/toggle/onEscape/applySettings`、DI `(hookState, overlay, strings)`。
4. **Fiber 内部は React バージョン依存**。`type Fiber = any` は fiber/renderTracker/renderCause/tree/hook/muiTheme 内のみ許容。
   **production は `_debug*` 剥離** → `devMode=false` でセーフモード縮退。
5. **dev/production 二面性**: dev=全機能 / production=ソースジャンプ・自作名・レンダー時間 不可、
   computed-style デザイン検査(M2)+野良値(M3)のみ。両方壊さない。
6. **任意オリジン**: popup「有効化」で permissions.request + registerContentScripts(永続) +
   executeScript(即時)。executeScript の files は先頭スラッシュ必須。

## 規約

- **`any`/`@ts-ignore` 禁止**(例外: Fiber 内部のみ)。**`console.log` 非 commit**。
- **ユーザー可視文字列は必ず i18n**。テスト可能なロジックは純関数化(getter/mock で注入可能に)。
- コメント日本語、仕様 FR-xx/NFR-xx。命名 PascalCase/use-/UPPER_SNAKE_CASE。

## テスト戦略(①機械 / ③目視 の分離)

- **①機械(自動)**: 純ロジックは vitest+happy-dom。mock 手本は fiber/tree/renderTracker.test.ts。
  DOM 依存は `// @vitest-environment happy-dom`。数値は既知正解値で校正。
- **③目視(人間)**: 見た目/60fps/操作感/双方向連動/実権限フロー。勝手に PASS にしない。
- **実機確認を頼む前に patch を上げる** (`CHANGELOG.md` に追記)。版数が変わらないと、拡張カードを
  見ても ⟳ が効いたのか古いビルドを見ているのか区別できない。**Chrome が読むのは同期フォルダ側**
  (`scripts/sync-extension.mjs` の展開先) で、`pnpm build` が自動で展開する
  (内容が同じときは書かない / 展開先が無い環境では警告のみで build は成功する)。
  以前は build と同期が別コマンドで、3 日前のビルドを見せて「機能が出ない」と報告された実績がある。
  権限を追加した回は特に、同期していないと ⟳ を押しても manifest が古いままで絶対に動かない。
- **コミット前ゲート**: `pnpm lint && pnpm test && pnpm typecheck && pnpm build` 全 green(locale を触ったら先に `pnpm wxt prepare`)。ESLint は any 禁止(Fiber allowlist)/ @ts-ignore 禁止 / console.log 禁止 / design 経路の Fiber import 禁止(境界契約)を機械強制。e2e は `pnpm e2e`(別ゲート)。

## ワークフロー(fable-emu)

非自明な変更は `/plan`(scout→planner→計画ファイル→承認→EXECUTE→`/verify` 独立検証)。
1手が重い設計は `/bestof`。機械証拠(test/typecheck/build)を根拠にコミット。
メモリはネイティブ project memory 一本(repo に memory/ を作らない)。

## セキュリティ / リリース

- セキュリティ: `SECURITY.md`(要点: 読むが**送らない**。v1 は送信経路ゼロで、
  `fetch`/XHR/WebSocket/beacon の発生箇所が 0 件であることを grep で再現証明できる。
  リモートコード/ページ内容保存なし。**AI を再導入するなら API キーは aiConfig/aiKeys 専用
  ストレージキー — Settings に混ぜない** (settings は bridge → MAIN world へ流れるため))。
- 配布: `PUBLISHING.md`(A=ローカル zip / B=Chrome Web Store の2通り)。`pnpm zip` → 更新は version を上げる。

## 保留バックログ(次回以降 1つずつ)

- ~~フレームワーク非依存デザイン検査~~ ✅ 完了(inspectElement が Fiber 無し要素で isReact:false の design-only 情報を返す)
- ~~全サイト一度だけ許可モード~~ ✅ 完了(popup の toggle。permissions.request/remove + registerContentScripts *://*/* + executeScript 即時。bridge/inspector に二重注入ガード)
- ~~アプリ内セキュリティ開示~~ ✅ 完了(全サイト許可ボタン直下に `hintAllSites`「ページを読むだけ。外部送信・ページ内容保存・リモートコード実行なし」を配置。commit 6f095ea)
- ~~iframe 内対応 (FR-13)~~ ✅ 完了(allFrames + matchOriginAsFallback を静的登録・動的登録・executeScript 全箇所に適用。blob: iframe での動作確認済み。sandbox opaque origin は対象外)
- Phase 3 デザインリント(MUI テーマ取得)/ Phase 4 レポート / Phase 5 BYOK AI
