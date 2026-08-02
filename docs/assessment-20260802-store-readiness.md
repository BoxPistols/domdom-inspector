# 現状評価 (2026-08-02) — 4 観点の過不足とストア公開の可否

オーナーが示した価値の 4 観点で v0.4.0 を実地に棚卸しし、競合とストア審査も併せて調べた記録。
4 エージェント並列調査 (棚卸し / 最小実装パス / 審査リスク / 競合) の結果を統合。

---

## 結論 (先に)

1. **市場で本当に空白なのは観点 4 (トークンのハードコード) だけ。** ここが製品の重心。
2. **ただし現状の実装は観点 4 に答えていない。** 値の等価性しか見ておらず、
   来歴 (ハードコードか変数経由か) を判定していない。
3. **観点 2 (カバレッジ) は材料が既にあるのに UI が無い。** `designScan.ts` が全部計算済みで、
   出口が BYOK AI のプレビューしか無い。ここが最大のレバレッジ。
4. **観点 1・3 は現状 production で機能せず、競合が上を行く。** 掲載文で前面に出すと不利。
5. **ストア公開のブロッカーは 3 つとも「文書」。コードはポリシー的に健全。**

---

## 観点別の棚卸し

### 観点 4: トークンのハードコード — **最大の発見**

実装は要素単位で最も厚い (`tokenDict.annotateProp` + `tokenLint.lintSpacing` +
手動貼付 / MUI テーマ自動取得 / CSS 変数名表示)。**しかし決定的な穴がある。**

> `annotateProp` は `prop.value` しか受け取らない (`src/tokenDict.ts:373`)。
> つまり **`#1668d4` をベタ書きした要素と `var(--primary)` 経由の要素が、同じ「一致」になる。**

現行の「トークン一致」は「トークンを使っている」ことの証明になっていない。観点 4 の本題
(ハードコードか否か) を直接は判定していない。

判定材料は既にある。`designStyle.ts:74-80` が `DesignProp.varName` に変数名を載せている。
ところが:
- バッジは「変数があれば見せる」だけで、**「変数が無い = ハードコード」という警告にしていない**
  (`overlay.ts:202-210`)
- `scanDesign` は `label` と `value` しか読まず **`varName` を捨てている** (`designScan.ts:65-71`)。
  そのためページ全体の「変数経由 vs リテラル直書き」比率が今のデータ構造では出せない

他に未実装: `sx` / インライン `style` の生値系統 (FR-15 が最高精度と位置づけるもの。
`summarizeProps` が `sx`/`style` を除外している `fiber.ts:183`)、遠い外れ値の沈黙
(`tokenDict.ts:404-408` の `hasFar` 分岐で 100px のようなマジックナンバーは警告されない)。

### 観点 2: カバレッジ — 材料あり、UI なし

`scanDesign` (`src/designScan.ts:47`) が可視要素を最大 2000 件走査し、7 ラベルについて
「ユニーク値 → 使用数 / トークン一致 / 最近傍 / グリッド外」を集計済み。**率は一度も計算していない。**

さらに数字を出す前に直すべき欠陥が 3 つ:
- `designScan.ts:89-92` が **上位 20 値で切り捨て**。出力から割り算すると「高頻度 = 一致しやすい値」に
  偏り、カバレッジが実態より高く出る
- `MAX_ELEMENTS = 2000` の打ち切りを**返り値で申告していない** (`designScan.ts:38`)。
  大規模ページで部分計測を全体と誤認する
- `tokenDict` が「辞書が空」と「遠い値」を同じ `null` で返す (`:397`/`:408`)

到達経路も問題で、唯一の出口が popup の AI セクション。既定で閉じた `<details>` の中にあり、
`aiEnabled` が OFF だと収集ボタンごと disabled になる (`popup/main.ts:158-165`)。
**決定論的な計測結果が AI 機能の付属物として埋没している。**

### 観点 3: 野良コンポーネント — 実質ゼロ

分類 (`classify.ts`) はあるが**集計は一行も無い**。加えて production で成立しない:
`fiber.ts:206` の `safeModeInfo` が Mui* クラスを持たない要素を `custom` ではなく
**`third-party` に落とす**ため、「自作の野良」と「サードパーティ」が区別できない。
デザイナーが本番を見るという主用途で機能しない。

FR-17 の「反復 sx クラスタ」も材料が取れない (`summarizeProps` が sx を除外)。

### 観点 1: 設計状況 — 集計視点がない

ツリーは「1 本の木を羅列」するだけで、コンポーネント別出現数・構成比・ラッパ層の厚みといった
メトリクスが無い。1000 ノードで 1000 行が並ぶだけ。遅延展開・仮想スクロールも未実装。

**バグ**: `overlay.showChainPanel` (`overlay.ts:266`) は実装済みだが**呼び出し元が無い**
(到達不能)。にもかかわらず起動トーストは `Alt+Click: rendered-by tree` と案内している
(`types.ts:209`)。文言と実装が乖離。

---

## 競合 (実在を確認したもののみ)

| 観点 | 既に埋めている競合 |
|------|--------------------|
| 1 設計状況 | React DevTools / [Omlet](https://github.com/zeplin/omlet) (MIT・OSS) / [react-scanner](https://github.com/moroshko/react-scanner) |
| 2 カバレッジ | [zeroheight Measurement](https://zeroheight.com/measurement/) / [Preply visual-coverage](https://github.com/preply/design-system-visual-coverage) / Figma Library Analytics |
| 3 野良コンポーネント | Omlet / react-scanner / Figma Design Lint |
| **4 トークンのハードコード** | **見つからなかった** |

「**自分のトークン定義 × デプロイ済み実画面の computed style を突合して hit/miss を出す**」
ツールは調査範囲に存在しない。既存はすべて「抽出」(CSS Peeper / Superposition /
Design Token Extractor / Project Wallace) か「ビルド前のソース検査」(stylelint) か
「Figma 側の検査」。**「抽出 vs 照合」「ビルド前 vs 実行後」の 2 軸が対外説明の骨格になる。**

観点 2 の競合は「外から使えない」のが共通の弱点 (Preply は組み込み必須、zeroheight は
コード連携 SaaS)。**「URL を開くだけで準拠率が出る」は誰もやっていない。**

### 訴求の修正点

- **「React 非依存」は差別化にならない。** 抽出系ツールは全部最初から非依存
- 効いているのは **production の実画面 × あなたのトークン**の組合せだけ
- **レンダープロファイリングは掲載文から降ろす。**
  [react-scan の Chrome 拡張](https://chromewebstore.google.com/detail/react-scan/anmmhkomejbdklkhoiloeaehppaffmdf)
  が同じ土俵に既にいる (約 7,000 ユーザー)
- **MUI テーマ自動取得は競合が見つからなかった最強の初回体験。** 掲載文の第 2 文をここに割く価値がある

推す一文の案:
> Paste your design tokens — or let it read your MUI theme — then hover any live page,
> including production, to see which values match your system and which are rogue.

---

## ストア公開: ブロッカー 3 件 (すべて文書)

コード側は健全 (リモートコード無し、テレメトリ無し、送信は BYOK AI の 1 本のみで明示 2 段操作 +
全文プレビュー、AI 応答は `textarea.value` に入れるだけで `innerHTML` 無し)。

1. **`PUBLISHING.md:154` が「収集するユーザーデータ: なし」と申告するよう指示している。**
   v0.4.0 は BYOK AI で端末外送信し、API キーを保存する。これは虚偽申告になる。
   `STORE_LISTING.md:98-103` には正しい方針が書いてあるが「⚠️ 要ユーザー判断」のまま未決着で、
   2 文書が矛盾したまま提出導線に載っている
2. **`PRIVACY.md` の自己矛盾。** `:29` で API キー保存を明記しつつ `:41` で
   「認証情報は扱わない」と書いている。審査官はポリシーと申告フォームを突き合わせる
3. **単一目的が 3 者でバラバラ。** manifest description (React 開発ツールとしか読めない) /
   STORE_LISTING (デザイン計測) / 実装 (計測 + ツリー + レンダー + AI + エディタジャンプ)

**機能を削る必要は無い。単一目的を 1 段上げる**のが正解:

> web ページの UI 実装を検査する — デザイン値の計測、ユーザーのトークンとの照合、
> およびそれを生むコンポーネント構造とレンダー挙動の可視化

2026-08-01 施行の新ポリシー (収集データは開示済み単一目的に厳密に必要な範囲のみ) 下では、
単一目的を「デザイン計測」のままにすると Fiber の props / レンダー計測が目的外に見える。

### その他

- `PUBLISHING.md:96` の「本リポジトリは private のため」は**事実誤認** (public)。
  プライバシーポリシー URL は GitHub Pages 有効化だけで解決する
- 審査官が公開サイトで Alt+Shift+I を押しても無反応 (localhost 限定) →
  **審査担当者向けメモにテスト手順を必ず書く** (Yellow Magnesium の典型)
- `minimum_chrome_version` 未設定なのに `world: "MAIN"` / `match_origin_as_fallback` /
  `checkVisibility()` / `storage.session` に依存
- AI のハード ON/OFF が既定 ON。掲載文の "Off until you configure a key" と食い違って見えるので
  既定 false にすると主張がそのまま成立する

---

## 推奨する順番

**公開前 (約 3〜3.5 人日)**

1. **A0. `scanDesign` を「数字に耐える集計」に是正** — 切り捨て前の総数、打ち切りフラグ、
   `varName` の保持。これ無しで率を出すと数字が構造的に嘘になる
2. **A. 決定論のカバレッジパネル** — AI から切り離し、popup に「このページのトークン準拠率 +
   逸脱上位」を出す。**4 観点中 3 つがこれで埋まる**
3. **B. ハードコード判定を来歴ベースにする** — `varName` の有無を「一致」の条件に加える。
   観点 4 の本題に初めて答えることになる
4. **C. DS 識別子を設定可能にする** — `Mui` 決め打ちをやめ、クラス接頭辞 / data 属性を
   popup で 1 つ設定できるようにする。production で観点 3 が動き始める (0.5 人日)
5. 文書 3 ブロッカーの修正 + スクリーンショット 4 枚 + プライバシー URL + 開発者登録

**公開後**

- コンポーネントセンサス (dev 限定)、決定論 Markdown/JSON の書き出し (FR-21)、
  SPA 遷移をまたぐ集計 (FR-19)、色距離を OKLab/CIEDE2000 へ (現状は RGB ユークリッド距離で
  ROADMAP が謳う ΔE ではない)

---

## 最速で出したい場合の代替案

AI セクションをビルドから外して v0.4.x を出し、AI は v0.5.0 で独立審査に回す
(`PUBLISHING.md:182` が元々想定していた運用)。ブロッカー 1 と 2 が消え、単一目的も
「デザイン計測 + トークン照合」で通しやすくなる。
