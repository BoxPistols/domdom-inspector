# 設計: 自分のトークンがこの画面のどこまで届いているかを見る (カバレッジ計測画面)

デプロイ済みの画面を開き、計測し、外れている値をページ上で指し、直す。この一連を
1 つの面で完結させるための設計。**結論と根拠を確定させた文書**で、実装はまだ (v0.4.0 時点)。

---

## 1. 何が難しいのか

この画面が出すのは**率**であり、率は文脈から切り離されて持ち出される。この事実がすべての
設計判断を決める。トークンとの一致を数えること自体は既に `src/coverage.ts` で動いている。
難しいのは「数えること」ではなく「数えた結果を、独り歩きしない形で置くこと」。

罠が 2 つある (先行事例と本リポジトリの実バグで確定):

- **罠 a — 分母の逃走**: 率は分母・母集団・但し書きを置き去りにして移動する。
  Fowler が ignorance-promoting dashboards と呼び、Dave House が「大きな組織のほとんどは
  自分たちがいくつのジャーニーを持っているか知らない = 100% が何を指すのか誰も知らない」と
  書いているのがこれ。**本リポジトリでは既に発生している**: `entrypoints/popup/main.ts:305-319`
  の `coverageCopy` は `formatCoverageMarkdown` の meta に `styleSource` を渡さないので、
  popup が「CSS-in-JS なので来歴は主張しない」と決めたページでも
  (`entrypoints/popup/main.ts:209-212`)、Markdown には `Written value, off token` が載る
  (`src/coverage.ts:267-275`)。**持ち出される側の出力の方が不誠実**。
- **罠 b — 誤った断定**: 計測できていないことを、計測して「悪い」と報告してしまう。
  commit 9332fb7 の実例 (MUI サイトで「ベタ書きだが一致 259 件 → 次のトークン変更に
  追従しません」と表示したが、`sx={{ p: 2 }}` は theme 由来でも出力は `padding: 16px`
  なので誤り)。この製品は `detectStyleSource` (`src/designScan.ts:73-82`) を足して
  この 1 経路だけを塞いだが、塞ぎ方は「来歴パネルを `<details>` の奥に置いたまま条件で消す」
  であり、構造ではなく配置に依存している。

素朴に作るとどうなるか。「準拠率 78%」を画面上部の大きな数字に置き、但し書きを
`<details>` に畳む。これは現行 popup がやっていることで、`entrypoints/popup/index.html:240-245`
の `<details id="coverageDetails">` (open 属性なし) の中に**最も行動につながる 3 ブロック**
(来歴 4 象限 / off-grid / Fix these first) が沈んでいる。結果、上に残るのは率だけになり、
罠 a が構造的に成立する。そして罠 b は、条件分岐を 1 箇所書き忘れた瞬間に復活する。

---

## 2. 決定

> **カバレッジ計測を side panel (`chrome.sidePanel`) へ移し、popup は入口と権限操作に縮小する。
> パネルは「率 → その率を作った要素をページ上で指す」検算ループを持ち、率は分母・母集団・
> 但し書きと同じ視野の外では描けない構造にする。**

検算ループを画面に内蔵するので、**罠 a は「持ち出す前に自分で確かめられる」ことで弱まり、
罠 b は但し書きを配置ではなくデータにすることで塞がる** (§4-1、§5-1)。

### なぜ side panel なのか (決定的な根拠)

popup には構造的な欠陥が 1 つあり、それが検算ループを原理的に不可能にする。

> "Popups automatically close when the user focuses on some portion of the browser
> outside of the popup." / "There is no way to keep the popup open after the user has
> clicked away."
> — Chrome 公式 `chrome.action` リファレンス

`entrypoints/popup/main.ts:128` の `let lastScan` は module 変数なので、popup が閉じれば
計測結果ごと消える。つまり popup では「数字を見ながら対象ページをスクロール・クリックする」
が成立しない。率の根拠を当人が実画面で確かめる手段が無い。

一方 side panel は公式に「タブを切り替えても開いたままにできる」と規定され、無効なタブでは
隠れて戻ると再表示される。Preply が `__PREPLY_DS_COVERAGE.runAndVisualize()` で DS 由来を
緑・それ以外を赤に塗って実画面に重ねたのと同じことが、ここで初めてできる。

**率の隣に「自分で確かめる手段」を置くのが、Goodhart 化への唯一の構造的な対策。**
文言を足しても人は読まないが、押した瞬間に自分の画面が答え合わせされるものは読み飛ばせない。

権限は増えない。公式 permissions-list で `sidePanel` は警告文を持たない
(`storage` / `activeTab` / `scripting` も同じ)。CWS の quality-guidelines が禁じているのは
「無関係な機能の抱き合わせ」であって面の数ではなく、`STORE_LISTING.md:104-112` の確定文言には
既に "element by element or **aggregated for the whole page**" が入っている。

### 案 B (popup のまま作り直す) を採らなかった理由

検討はした。`entrypoints/popup/index.html:56` の `width: 340px` を 380px にし、母集団と
トークン出所を `position: sticky` で固定し、`<details id="coverageDetails">` を撤去して
全部を常時可視に上げる案。**新規サーフェスゼロ・新規 permission ゼロ・`minimum_chrome_version`
に触れずに済む**ので、審査提出物の差分はスクリーンショットだけになる。技術的には成立するし、
工数は最小 (3 人日前後)。採らなかったのは次の 3 点。

1. **検算ループがどうやっても作れない。** 上記の公式仕様により、ハイライトを出しても
   確認する前に popup が閉じる。`browser.storage.session`
   (`entrypoints/popup/main.ts:409-428` の `sessionCalls` が前例) に `lastScan` を載せれば
   「開き直したら結果が残っている」までは作れるが、**offender を 1 件見るたびに popup を
   開き直す**動線になる。率を独り歩きさせないための装置が、最も摩擦の大きい操作になる。
2. **340→380px にしても情報が入らない。** 案 B のレイアウト試算は自己申告で約 830px 相当で、
   popup の高さ上限は 600px。結局スクロールするので、`<details>` を撤去して得た「常時可視」は
   スクロール位置に依存する見え方に戻る。§2 症状4 (重要導線を閉じた奥に置く) を
   「開いてはいるが画面外」に置き換えるだけになる。
3. **未描画資産の置き場所が足りない。** `distinctJudged`/`distinctHit`
   (`src/coverage.ts:194-198`)・`near`/`far` の実数・`TopOffender.label`/`origin`・
   `DesignScan.stats`・`statsTotals` (`src/designScan.ts:168-176`) は、いずれも算出済みで
   消費者ゼロ。340px に入らなかったから捨てられている。380px では 1〜2 件しか救えない。

**ただし案 B の「面を増やさない」「permission を増やさない」「審査提出物が動かない」という
利得は本物。** 加えて案 B が持ち込んだ「分母・母集団・トークン出所を sticky に固定して
率と同じ視野から出さない」という装置は、面の選択と無関係に正しい。→ §4-1 の情報序列 ① に
そのまま採用する。案 B を却下したのは配置の思想ではなく、器の高さと検算ループの一点。

### 案 C (ページ内オーバーレイに常駐パネルを描く) を採らなかった理由

検討はした。`src/overlay.ts:76` の closed Shadow DOM に 4 つ目のサーフェスを足し、
`src/overlay.ts:86` の `.render-canvas` (renderDebug を配線外しした結果、現在未使用) を
エビデンス描画に転用する案。**幅の制約が無い唯一の面**で、検算ループは最短距離で成立し、
「折りたたみピル + 枠を残したスクリーンショット」という成果物まで作れる。採らなかったのは 3 点。

1. **来歴の断定がページ上に実描画されて拡大する。** ガードは `detectStyleSource`
   (`src/designScan.ts:73-82`) 1 本で、実体は `style[data-emotion|data-styled|...]` の有無だけ。
   Tailwind の `p-4 → padding: 1rem`、SCSS 変数、CSS Modules、静的抽出した emotion は
   すべて素の `<style>`/`<link>` で出るので `styleSource='stylesheet'` と判定され、
   「ベタ書き = 次のトークン変更に追従しない」が断定形で出る。案 C はこれを画面の一等地に
   常設し、さらに該当要素をページ上に赤枠で描けるようにする。**罠 b をページに焼き付ける**。
2. **MAIN world 制約の支払いが大きい。** `browser.*` が使えないので、既存の `coverage*` 30 キーを
   `_locales` から `src/types.ts` の `DEFAULT_STRINGS` へ移送し、新規分と合わせて
   3 箇所同期する必要がある (地雷 1)。popup / side panel なら `browser.i18n` を直接呼べるので
   このコストはゼロ。
3. **モードになるので 4 点配線が要る。** `wxt.config.ts` commands / `entrypoints/background.ts:9`
   の `COMMANDS` / `entrypoints/bridge.content.ts` の `onMessage` / `entrypoints/inspector.content.ts`
   のハンドラ + Esc 中央ハンドラ (地雷 3)。加えて `entrypoints/background.ts:129` の
   `browser.tabs.sendMessage(tabId, { type: command })` は `frameId` を指定しないので、
   ショートカット経由だと**全 iframe に 1 枚ずつパネルが生える**。

**ただし案 C の「率を押すとその率が数えた要素がページ上に枠で出る」は本設計の中核そのもの。**
描画先をパネル本体ごとページに置くか、パネルは side panel に置いてページには枠だけ描くか、の
違いしかない。後者なら罠 b の露出面が減り、i18n も 4 点配線も要らない。→ §5-4 と §8。

---

## 3. 確定した制約 (一次情報つき)

| 制約 | 根拠 |
|------|------|
| popup は外側にフォーカスすると自動で閉じ、開いたままにする方法は無い | 公式 `chrome.action` リファレンス。`entrypoints/popup/main.ts:128` の `lastScan` は module 変数なので**計測結果ごと消える** |
| popup のサイズは 25x25〜800x600px | 公式 `chrome.action`。現行は `entrypoints/popup/index.html:56` で `width: 340px`。**縦 600px 上限は変えられない** |
| `sidePanel` permission に警告文は無い | 公式 permissions-list。`storage`/`activeTab`/`scripting` と同様。**ユーザーに見える権限文言は増えない** |
| `tabs` permission は "Read your browsing history." の警告が出る | 公式 permissions-list。全サイト許可は optional なので併記による免除は効かない。**足すと「権限は増えない」が崩れる** |
| `sidePanel.open()` は Chrome 116+、`onClosed` は 142+ | 公式 `chrome.sidePanel`。**142 を最低版にはできないので、パネル閉鎖は検知できない前提で設計する** |
| `matchOriginAsFallback` は Chrome 119+ | `@wxt-dev/browser@0.2.2` の `src/gen/index.d.ts:9970` が `@since Chrome 119` と明記。FR-13 で全注入箇所に付与済み。**`minimum_chrome_version` を決めるならこれが下限で、116 では足りない** |
| `sidePanel.open()` は user action 起点でのみ呼べる | 公式 `chrome.sidePanel`。`permissions.request` と同じ規律。**await を挟んだ後に呼ぶと無言で拒否される** |
| `tab.url` の取得には `tabs` 権限か当該ページの host permission が要る | 公式 `chrome.tabs`。`activeTab` は invocation 時の一時付与。**パネルはタブ切替のたびに invocation を受けないので、未許可オリジンでは URL が読めない** |
| `runtime.onMessage` から Promise を返しても Chrome では応答にならない | `entrypoints/bridge.content.ts:78-97` は `sendResponse` + `return true` で書かれている。**この経路を触るときは順序を崩さない** |
| `tabs.sendMessage` は全フレームに配信される | `entrypoints/popup/main.ts:279` が `{ frameId: 0 }` を明示。**指定しないと先に応答した iframe が勝つ** |
| `design-scan` の中継は 5 秒でタイムアウトして `null` を返す | `entrypoints/bridge.content.ts:82-85`。popup 側は `aiStatusScanFail` に落ちる。**「重すぎて時間切れ」と「失敗」が区別できない** |
| `extractDesignStyle` は `withOrigin` に関係なく `collectAuthoredInfo` を常に呼ぶ | `src/designStyle.ts:100-104`。`ORIGIN_BUDGET_MS = 1500` (`src/designScan.ts:68`) を超えてもコストは払い続け、結果だけ捨てる。**大規模ページで「遅い上に来歴が消える」二重損** |
| クロスオリジン CSS は `continue` でスキップされる | `src/cssVars.ts:136-139`。勝者宣言が読めないシートにあり下位に読める宣言があると、**その下位宣言が勝者として来歴判定される** = 欠測ではなく誤答 |
| `checkVisibility()` が無い環境ではガードで素通りする | `src/designScan.ts:114-119`。**その事実を申告するフラグが無い** |
| `src/coverage.ts` は境界契約の 2 つのリストどちらにも入っていない | `src/boundaries.test.ts` の `DESIGN_PATH` と `eslint.config.js` の `files`。現状 import は `tokenDict`/`tokenLint`/`types` のみでクリーンだが、**ロジックを足すなら塞ぐのが筋** |
| `wxt.config.ts` に `minimum_chrome_version` が無い | `docs/assessment-20260802-store-readiness.md:147` が指摘済み。`world:"MAIN"` / `matchOriginAsFallback` / `checkVisibility()` / `storage.session` に依存しているので**本来必要** |

---

## 4. 画面構成

### 4-1. 情報の順序 — 率を独り歩きさせない 7 つの装置

順序そのものが誠実性の装置になる。上から。

**① 対象と鮮度 (sticky header)** — `example.com · 2 分前 · 1,240 要素`。
パネルは popup と違い**開いたまま残る**ので、「この数字がどのページのいつのものか」を
失うと popup 版より不誠実になる。パネル化が新しく生む嘘なので最上段に固定する。
案 B の「分母を sticky にする」をここに採用する。ただし固定するのは母集団であって
どの率の分母でもないので、**各率は必ず自分の分母を自分の行に持つ** (装置 ②)。

**② stale バナー (条件付き)** — `stale-tokens` / `stale-navigation` / `stale-tab` の 3 種。
トークン編集・ページ遷移・タブ切替のいずれかで結果が対象から外れたら、数字を消さずに
dim + バナーで**視覚的に切り離し**、ページ上ハイライトを全部 disabled にする (別ページを
塗るため)。**`public/_locales/{en,ja}/messages.json:516` の `coverageStale` はここで初めて
配線される** (現在コードのどこからも参照されていないデッドキー)。消さないのは前の数字と
見比べたいから、dim にするのはそのまま信じさせないため。

**③ この計測が何をカバーしているか (数字より上)** — 打ち切り / 辞書の内訳と出所 /
CSS-in-JS / 来歴予算切れ / 辞書空。Preply が近似 2 点を自ら文書化し、WAVE が計測の上限を
UI 内で表明しているのと同じ型。ただし壁のような但し書きを上に積むと読み飛ばされるので、
**但し書きはデータにする**: `buildBasisNotes(scan): BasisNote[]` を新設し、各 note に
`affects: ('match' | 'durability' | 'grid')[]` を持たせて**影響先の数字の真横にも印を出す**。
原則は「**但し書きは、それが制限する数字と一緒に旅する。脚注だけにしない**」。
そしてこの配列を **パネル UI・`formatCoverageMarkdown`・`aiPrompt` の 3 者が共有する** ことで、
罠 a の実害 (コピー出力の方が不誠実) が構造的に消える。

**④ 一致 — ファミリ 4 行を 2 つの分母で** (`per element` / `per distinct value`)。
本設計の中核。`FamilyCoverage.distinctJudged`/`distinctHit` (`src/coverage.ts:194-198`) は
現在どこにも出ていない完全な死蔵指標で、要素加重の率が巨大コンポーネントに引っ張られる
問題への解毒剤。Preply (可視ピクセル面積) と Mews (DOM 要素数) が**同じ「準拠率」で違う分母を
選んで違う答えを出した**実証がある以上、単一分母を正解として出さない。
`near`/`far` の実数もテキストで出し (現在は積み上げバーの幅と `title` 属性にしかない)、
**色の意味を説明する凡例を新設する** (現在どこにも無い)。

**⑤ 総合率と判定カバー率 — ④ の直下に、意図的に小さく。**
「全体 78%」をヒーロー数字にしない。Chrome DevTools の Coverage パネルは各行を実数 +
積み上げバーで出し、百分率は最下部のステータスバーに 1 つだけ置く。SonarQube は
「overall code に対する条件を Quality Gate に追加することは推奨しない」と明言している。
既存の `coverageOverallNote` (色と font-size は全要素にあるので総合はその 2 つに引っ張られる)
はそのまま添える。

**⑥ Fix these first — 各行に「ページ上で示す」** — 率より「どこで崩れているか」を主役にする
zeroheight 型。**side panel でしか成立しない**動線で、これが本設計の存在理由。
行には `TopOffender.label` (現在 popup 未描画・どのプロパティか分からない) を出す。
`origin` の扱いは §6-1 の決着待ち。

**⑦ 天井の表明 (常時可視・折りたたまない)** — 「一致 = あなたのトークンと値が等しい。
デザインが正しいという意味ではない」。WAVE は合格バッジも点数も出さず
「The absence of errors DOES NOT mean your page is accessible or compliant」と UI 内で
明言している。既存の `coverageScopeNote` (iframe/shadow DOM/不可視は対象外) をここに統合。

以降は「調べに行く情報」なので折りたたむ: 値の一覧 (`DesignScan.stats` + `statsTotals`) /
判定閾値の開示 / Markdown コピー / トークン編集 / AI 監査 (既定 OFF・最後)。
**AI を決定論の結論より前に置かない** — commit b752b8a で独立させた
「カバレッジが AI 機能の付属物として埋没する」状態に戻さない。

### 4-2. 数字の表示規律 (実装済みのものを保存し、3 つ足す)

`src/coverage.ts` と `entrypoints/popup/main.ts` の `renderCoverage` が既に持っている規律
(a) 辞書が空なら率を 1 つも出さない (b) 丸めで嘘をつかない (c) 判定できないものを分母に
入れない (d) `noDict` と `far` を同じにしない (e) 判定件数 < 10 は `LOW_SAMPLE_THRESHOLD` で
添える (f) 打ち切りと来歴可否を申告する (g) 来歴は 1.5 秒予算で諦める — は全部保存する。

足すのは 3 つ。

- **率は単独で描けなくする。** `rateBlock(hit, judged, opts)` という単一のレンダラを通し、
  `{rate}% ({hit}/{judged})` と条件チップを必ず同じ行に出す。**呼び出し側から数字だけを
  描く経路をコードレベルで消す。** 文言を足すより強い。
- **丸めのクランプを開示する。** `ratePercent` (`src/coverage.ts:102-109`) の 99/1 クランプは
  「本当に 99%」と「10000 件中 1 件外れ」を潰す。`formatRate(n, d)` を追加してクランプ時は
  `>99%` / `<1%` と表記し、`title` に実数を出す。あわせて**すべての率は四捨五入である**と
  ⑧ (閾値の開示) に明記する — クランプ境界だけ丁寧にすると「それ以外の % は正確」という
  逆の含意が出る。
- **低サンプル保護を語彙軸にも当てる。** `LOW_SAMPLE_THRESHOLD = 10` (`src/coverage.ts:227`) は
  現在 `f.judged` (要素加重) にしか掛かっていない。`distinctJudged` は本質的に小さい数に
  なりやすい (色 41 種・spacing 36 種) ので、**新しく主役級に置く列にこそ規律が要る**。

### 4-3. 空状態を無言にしない (局所的だが効く)

`cov.top` が空 / `offGrid.total === 0` のとき、現行は要素が空文字のまま
(`entrypoints/popup/main.ts:252-260`)。**「野良値ゼロ」という良い知らせが「何も計測できて
いない」と区別できない。** Codecov が base/head のレポートが揃わないときは PR コメント自体を
出さない判断をしているのと同じ論点で、こちらは 1 行の追加で解ける。

ただし文言は実装に合わせること。`src/coverage.ts:177` の off 判定は
`verdict.outcome !== 'hit' && pxs.some(px => px % grid !== 0)` で、**トークン一致した値は
グリッド判定を免除される**。「全 N 件が 4px グリッド上にあります」と断言すると偽になりうるので、
`No spacing value is both off your tokens and off the {grid}px grid.` の形にする。

**率を主役にしないための最短の手段は、率を作った実数をその率より先に読ませることである。**

---

## 5. 拡張側に必要な変更

### 5-1. 集計側の欠陥修正 (面の選択と無関係に価値がある)

`src/coverage.ts` / `src/designScan.ts` / `src/designStyle.ts`。これらは**どの案を採っても
先に直すべき**もので、パネルを作らなくても単独でマージできる。

> **実装状況 (2026-08-06): Phase E 完了。** 下記 7 項目すべてを実装し、全ゲート green
> (lint / 269 unit / typecheck / build / e2e 10)。設計との差分は 3 点、いずれも
> 「より強い側」へ倒した:
> - **来歴ゲートを `meta.styleSource` ではなく `CoverageReport.originTrusted` に置いた。**
>   呼び出し側に条件を渡させると渡し忘れが起きる (それが罠 a の実害そのものだった)ので、
>   `buildCoverage(occ, dict, { originTrusted })` で 1 度だけ決めて report に載せた。
>   既定は `false` = **渡し忘れたら来歴を主張しない**側に転ぶ。`TopOffender.origins` は
>   信頼できないとき `null` になり、`formatCoverageMarkdown` は report だけを見る。
> - **§6-4 の推奨を Markdown にも適用した** (`first N of M elements` を廃止)。
>   popup の `coverageTruncated` は i18n 同期を伴うので Phase F/C 側で揃える。
> - **AI 入力 (`formatScanForPrompt`) にも打ち切りと辞書内訳を通した。** Markdown と同じ
>   罠 a が AI 経路にも存在した (部分計測を全体として講評させる)。
>
> 併せて §5-6 の境界契約に `coverage` を追加 (`src/boundaries.test.ts` + `eslint.config.js`)、
> popup に「拡張更新直後の古い content script が応答したときの正規化」を追加
> (新フィールド欠落で `Off the undefinedpx grid` になり得たため)。

- **offender を `label+value` でマージしてからランキングする。** `src/designScan.ts:130` の
  Occurrence キーは `` `${prop.label} ${prop.value} ${origin}` `` だが、`src/coverage.ts:184` は
  分裂したままの occurrences から積む。同じ `16px` が var 経由 30 件 + literal 40 件だと
  **2 行に分かれて count 70 の 1 行に負ける**。`Fix these first` は「件数降順」を名乗って
  いるので、**ランキングが嘘をついている状態でパネルの主役に据えられない**。
- **`formatCoverageMarkdown` の meta に `styleSource` を渡す。** `src/coverage.ts:237` の
  meta に `styleSource` が無く、`:267` は `originAvailable && originKnown > 0` だけで来歴
  セクションを出す。罠 a の実害そのもの。§4-1 ③ の basis notes 単一ソース化で構造的に塞ぐ。
  ついでに `offGrid` と `tokenCounts` を Markdown 側に足す (現在 UI にあって Markdown に無い)。
- **`matrix.excluded` を割る。** `src/coverage.ts:167-169` の else は `origin` が
  inherited/unknown の件だけでなく **noDict / unmeasurable も全部飲み込む**。表示文
  (`coverageOriginExcluded`) は「継承・ブラウザ既定・stylesheet が読めない」と言っており、
  「該当トークンが無い」を来歴の問題として提示している。分けるときは
  **「stylesheet が読めなかった」を必ず残す** — `src/cssVars.ts:136-139` で読めないシートを
  スキップした結果は `inherited` に落ちるため、この 3 つ目の理由は実在する。
- **`withOrigin: false` のとき `collectAuthoredInfo` を呼ばない。** `src/designStyle.ts:100-104`
  は `withOrigin` に関わらず常に呼ぶ。高価なのは `winningValue` の CSSOM 全走査
  (`src/cssVars.ts:130-147`: 全 styleSheet × 全 rule × `element.matches()`) なので、
  `ORIGIN_BUDGET_MS` は**予算として機能していない**。ただし単純にスキップすると v0.3.0 の
  CSS 変数名表示 (バッジ) が `varName` を失うので、`withVars` と `withOrigin` を分離する。
- **`truncated` の偽陽性を直す。** `src/designScan.ts:181` は
  `elementCount >= MAX_ELEMENTS && candidateCount > elementCount`。可視要素がちょうど 2000 で
  全走査を終えても true になる。判定は「ループを最後まで回せたか」に変える。
- **`tokenSources` を返り値に足す。** `tokenCounts` (`src/designScan.ts:186`) は貼り付けと
  MUI 自動取得の**併合後**の合計。`entrypoints/inspector.content.ts:55-56` は 2 辞書を
  既に持っているので渡すだけ。`mergeTokenDicts` (`src/tokenDict.ts:270-277`) は重複排除を
  しない単純連結なので、内訳を出すときは重複が含まれうる旨まで書く。
- **閾値定数を export する。** `COLOR_HIT = 3` / `COLOR_NEAR = 64` (`src/tokenDict.ts:289-290`)
  / `SIZE_HIT = 0.25` / `SIZE_NEAR = 4` (`:319-320`) は module private で、UI に説明が無い。
  Lighthouse が重み (FCP 10% / LCP 25% / TBT 30% …) と色境界を公開しているのと同じ扱いにする。
  副次効果として `entrypoints/popup/main.ts:256` の `grid: 4` リテラル埋め込みも消える。

### 5-2. 純関数のビューモデル (新規)

`docs/popup-ux-design.md` §3 の「導出は純関数に切り出して vitest で固め、UI は描くだけの
薄い層にする」を踏襲する。

- **新規 `src/panelState.ts`** — `derivePanelState({ target, measurement })` →
  `{ availability, freshness }`。`freshness` は `none | fresh | stale-tokens |
  stale-navigation | stale-tab`。**これが無いと、パネルは別ページの準拠率を堂々と表示する
  ツールになる。** パネル常駐が新しく生む唯一の嘘なので、最初に固める。
- **新規 `src/coverageView.ts`** — `formatRate(n, d)` / `buildBasisNotes(scan)` /
  `vocabularyRate(f)` / `emptyStateFor(section, report)`。
  **`familyRate` / `isDictEmpty` は再実装せず `src/coverage.ts` から必ず呼ぶ**
  (`entrypoints/popup/main.ts:161,171` が同名ロジックを再実装しており、現にドリフト源になっている)。
- **新規 `src/scanClient.ts`** — `requestScan(tabId)` を popup から抽出して共有。
  拡張ページ専用 (`browser.*` を使う) なので **design 経路の境界リストには入れない**旨を
  ヘッダコメントに明記する。

### 5-3. 面の配線

- `wxt.config.ts` — `minimum_chrome_version` を明示する (§3 の表より **119 以上**)。
  **`side_panel.default_path` と `permissions: ['sidePanel']` は手で書かない** — WXT 0.20 は
  `entrypoints/sidepanel/index.html` を検出すると自動で両方を manifest に入れる。手書きすると
  出力パスとズレたときに無言で片方が勝つ。
- **新規 `entrypoints/sidepanel/index.html` + `main.ts`**。
- `entrypoints/background.ts` — `sidePanel.setPanelBehavior({ openPanelOnActionClick: false })`
  を明示的に呼ぶ。`action.default_popup` と `openPanelOnActionClick` の優先順位は公式に記載が
  無いので、**その未定義に依存しない**。
- `entrypoints/popup/main.ts` — `#openPanel` の click ハンドラで **await を一切挟まず**
  `sidePanel.open({ tabId })` を呼ぶ (`permissions.request` と同じ gesture 規律。
  `handoff_notes.md` が「崩すと権限フローが無言で死ぬ (手戻り実績あり)」と警告している領域)。
  ただし `open()` 自体は await してから `window.close()` する — 呼び出し元フレームの破棄と
  IPC を競合させない。そもそもパネルが開けばフォーカスが移って popup は閉じるので、
  `window.close()` 自体が不要な可能性がある (§9 で実機確認)。
- 計測は**既存の design-scan 往復にそのまま乗る**。side panel も拡張ページなので
  `browser.tabs.sendMessage(tabId, { type: 'design-scan' }, { frameId: 0 })` が popup と同一に動く
  (`entrypoints/bridge.content.ts:78-97` → `entrypoints/inspector.content.ts:153-162`)。
  **新しいメッセージ型はハイライトの 1 経路だけ。**

CLAUDE.md 地雷 3 の「新モード = 4 点配線 + Esc」は、パネル自体には**不要**
(manifest command を持たず、popup / パネル内で完結するため。前例は Cmd/Ctrl+Click の
エディタジャンプ)。ただし §5-4 のハイライトは**ページに描画状態を残す**ので、
**Esc 中央ハンドラへの追加だけは必須**。実質「bridge + inspector の 2 点 + Esc」。

### 5-4. ページ上ハイライト (新規は 1 経路だけ)

`sidepanel → tabs.sendMessage('design-highlight' | 'design-highlight-clear', { frameId: 0 })
→ bridge → postMessage → inspector.content → 描画`。描画先は `src/overlay.ts:86` の
`.render-canvas` を転用する (renderDebug を v1 の配線から外した結果、現在未使用)。

本当の難所は矩形計算ではなく**要素の再発見**にある。`Occurrence` は
`{ label, value, count, origin }` しか持たず (`src/coverage.ts:23-28`)、`scanDesign` も
要素参照を残さない。よって `padding 13px` を光らせるには MAIN world で DOM を再走査して
`extractDesignStyle` を再実行し `label+value` を突き合わせるしかない。このとき
`shorten()` の 48 文字切り詰め (`src/designStyle.ts:30-33`) と `toHex()` の整形 (`:48-54`)、
`checkVisibility()` と `skip` と `MAX_ELEMENTS` の走査規約を**計測側と完全に一致させる**。

これを外すと `Highlighted 96 of 96` が計測時の `×96` と食い違う。
**数字の根拠を実画面で検算させることが本設計の存在理由なので、ここが 1 件でもずれると
製品の芯が壊れる。** 対策として走査述語を `visibleElements(root, { skip, max })` という
1 つの純関数に括り出し、`scanDesign` とハイライトの両方がそれを呼ぶ。

防御条件を仕様として明記する:

- **描画上限は必須** (200 程度)。数千要素を一斉に塗ると重い上に、部分表示を全体と誤読させる。
  上限に当たったら「N 件中 M 件を表示」と申告する。
- **要素への強参照を保持しない。** SPA の DOM 入れ替えでリークする。押すたびに再クエリする。
- **計測時の件数と再走査時の件数が違ったら両方出す** (`計測時 96 件 / 現在 91 件`)。
  0 件のときだけ拾う `highlightNone` では足りない。
- **`sidePanel.onClosed` は Chrome 142+ なので、パネル閉鎖でハイライトを消せない。**
  ハイライト自体に消すアフォーダンス (ページ上の小さな chip に Clear) を持たせる。
  これが無いと「勝手に画面が汚れて自力で戻せない」= 「押しても無反応」より悪い状態になる。

あわせて `src/inspector.ts:175-199` の `onKeyDown` に 1 行足す:
`if (this.overlay.containsTarget(event.target)) return;`。ArrowUp/Down を capture +
`stopImmediatePropagation()` で無条件に食っており、`onIntercept` にある同型のガードが
keydown には無い。**パネルの有無と無関係に、今日から存在する潜在バグ。**

### 5-5. i18n (地雷 1 と地雷 2)

CLAUDE.md 地雷 1 の「i18n は 3 箇所同期」= `src/types.ts` の `DEFAULT_STRINGS` +
`public/_locales/{en,ja}/messages.json` は、**MAIN world へ bridge が流す文字列の話**。
適用範囲を名指しで分ける:

| 対象 | 同期先 | 理由 |
|------|--------|------|
| パネル / popup の文字列 (大半) | `_locales` の **2 箇所のみ** | 拡張ページなので `browser.i18n` を直接呼べる。`DEFAULT_STRINGS` に入れると bridge が全キーを反復して全フレームへ postMessage するだけ無駄 |
| §5-4 のハイライトが overlay で出す文字列 (4 キー程度) | **3 箇所すべて** | MAIN world は `browser.*` 不可。共有 `strings` 経由でしか受け取れない |

`src/i18n.test.ts` が機械検知するのは 4 点: (a) `DEFAULT_STRINGS` の全キーが両 locale に
存在する (b) en と ja のキー集合が完全一致する (c) en の `message` に CJK が混入していない
(d) プレースホルダの集合が `DEFAULT_STRINGS`/en/ja で一致する。
**(b) が効くので、popup 専用キーでも en/ja 同時追加は必須。** locale 側の余剰キーは許される。

locale を触ったら **`pnpm wxt prepare`** (地雷 2)。`.wxt/types/i18n.d.ts` を再生成しないと
`msg()` の型が古いまま通ってしまう。

現行 en は 182 キー。新規キー案 (抜粋、既存 `coverage*` 30 キーは可能な限り再利用する):

```
--- 面と入口 ---
btnOpenPanel            "Open measurement panel"
hintOpenPanel           "Opens beside the page and stays open while you click around."
panelTitle              "Token coverage"
panelNotMeasured        "Nothing measured yet. Press Measure to read this page."
btnPanelMeasure / btnPanelRemeasure
--- ① header / ② stale ---
panelTargetOrigin       "Measuring {origin}"
panelMeasuredAgo        "measured {ago} ago"
panelStaleNavigation    "This page changed after the measurement…"
panelStaleTab           "You switched tabs. These numbers are from {origin}."
(既存 coverageStale をトークン変更用に流用 — 現在デッドキー)
--- ③ 基礎条件 (basis notes) ---
panelBasisTitle / panelBasisStopped / panelBasisTokenSplit /
panelBasisThemeInflates / panelBasisOriginBudget
(既存 coverageOriginCssInJs / coverageOriginUnavailable / coverageEmptyDict /
 coverageTruncated はここへ移設して再利用)
--- ④ 一致 + 凡例 ---
panelAxisElements "per element" / panelAxisValues "per distinct value"
panelFamilyBreakdown    "hit {hit} · close {near} · off {far}"
panelFamilyNotJudged    "{noDict} had no token of this kind · {unmeasurable} could not be parsed"
panelLegendHit / panelLegendNear / panelLegendFar
panelRateOver "over {rate}%" / panelRateUnder "under {rate}%"
--- ⑥ Fix these first / ハイライト ---
panelTopLineLabeled "{label} {value}" / panelTopEmpty
btnPanelShowOnPage / btnPanelClearHighlight
panelHighlightStatus    "Highlighted {shown} of {total} elements on the page."
panelHighlightDrift     "{measured} when measured, {found} now — the page has changed."
--- ⑦ 天井の表明・⑧ 閾値の開示 ---
panelCeiling / panelHowColor / panelHowSize / panelHowRounding / panelHowOrigin
--- 空状態 ---
panelGridClean "No spacing value is both off your tokens and off the {grid}px grid."
panelInventoryTotals "Showing {shown} of {unique} distinct values · {occurrences} uses"
```

**UI 文言は対外文面に近い。** `handoff_notes.md` の「可逆なことは聞かずに進め、不可逆・
対外的なことは見せてから進める」に従い、diff をオーナーに見せてから確定する。

### 5-6. 境界契約

`src/boundaries.test.ts` の `DESIGN_PATH` と `eslint.config.js` の `files` の**両方**に
`coverage` と新規 view モジュールを追加する。`coverage.ts` は design 経路そのものなのに
どちらのリストにも入っていない既知のギャップで、ここにロジックを足すなら塞ぐのが筋。

ただし実効性の限界も書いておく: `src/boundaries.test.ts:33-39` は `from './<mod>'` の
**直接 import のみ**を正規表現で見る。`src/panelState.ts` / `src/coverageView.ts` は
純ロジックなので実効的に守れるが、パネル本体は `browser.*` を使う拡張ページ側のコードなので
このリストの対象ではない。

---

## 6. 未解決の論点 (着手前に決着させる)

検証で出た指摘のうち、**設計として答えが確定していないもの**。実装より前にここを閉じる。

### 6-1. 来歴 (origin) を Fix these first に出してよいか [最重要]

`TopOffender.origin` は型に存在するのに popup も Markdown も使っておらず、「var 経由か
直書きか = 修正コストの見積り」として出す価値は高い。しかし 2 つの問題がある。

1. **CSS-in-JS ゲートが 1 箇所に閉じていない。** 現行 popup は来歴の主張を
   `coverageOrigin` ブロック 1 箇所に閉じ込めていた (`entrypoints/popup/main.ts:209-212`) ので
   構造的に守られていた。来歴を複数セクションに散らすなら、**ゲートは表示箇所ごとではなく
   `report` を作る段階に置く** (`originAvailable` / `styleSource` を見て `origins` をそもそも
   詰めない)。そうしないと罠 b が「Fix these first」という行動を促す場所で再発する。
2. **`count` は「修正箇所数」ではない。** `src/designScan.ts:132-133` の `count` は要素数。
   `.btn { padding: 13px }` が 42 個のボタンに効いていれば直す箇所は 1 つ。
   `42 places to change` は修正コストを 2 桁誤らせる。

**推奨: v1 では origin の分布だけを観測事実として出し、修正コストは言わない。**
`44 via variables · 140 written in` は言えるが `140 places to change` は言えない。
さらに単一の変数名 (`via --danger-500`) は出さない — `Occurrence` は `varName` を持たず、
同じ値が要素ごとに別の変数から来ている可能性がある。v0.3.0 で cssVars Tier2 を
「由来でない変数名を由来と誤提示 = 検証の誠実性に反する致命傷」として棄却したのと同じ誤りを、
集約レイヤで再導入することになる。

### 6-2. 未許可オリジンのタブで、パネルは何を表示するか [設計の穴]

`entrypoints/popup/main.ts:660-700` の `detectSite` と `:625-657` の `applyAvailability` は
`tab.url` から origin を取って `ok / notEnabled / notInspectable` を出し分けている。
popup は action 起点なので `activeTab` が付くが、**パネルはタブ切替のたびに invocation を
受けないので URL が読めない** (§3 の表)。つまり「http(s) だが未許可」と「chrome:// 等
そもそも不可」が区別できない。

`tabs` permission を足せば読めるが、**"Read your browsing history." の警告が出て
「権限は増えない」という本設計の売りが崩れる** (§3)。

**推奨: `tabs` は足さず、読めない前提で文言を倒す。** 「このページはまだ有効化されていません。
ツールバーのポップアップから有効化してください」の 1 本にし、区別できない事実を設計に
織り込む。これは commit 459db69 で潰した「理由が嘘」類型に片足を突っ込むので、
**文言が嘘にならない書き方をオーナーに見せて確定させる**。

### 6-3. stale 判定の粒度 — ページ内 DOM 変化をどう扱うか

`stale-tokens / stale-navigation / stale-tab` はいずれも外形イベント起点だが、パネルの
売り文句は「開いたまま横でクリックし続ける」であり、**モーダルを開く・アプリ内タブを切る・
ダークモードを切り替える、といったナビゲーションを伴わない画面転換が主要ケース**。
このときパネルは `fresh` のまま別画面の率を出す。

一方で MutationObserver を素朴に張ると、本番 SPA では計測直後 1 秒以内に必ず発火する
(lazy-load 画像・カルーセル・広告・遅延ハイドレーション)。**「いつも stale」か
「いつも嘘」の二択**になる。

**推奨: 二値の stale にせず、計測時の署名 (可視要素数 + 上位数値) をハイライト実行時に
取り直し、差が閾値を超えたときだけ `stale-dom` を出す。** 二値化とページ全体の常時監視は
どちらも採らない。ここは実装しながら実サイトで閾値を決める部分なので、
**設計としては「二値にしない」だけを確定させる。**

### 6-4. `visible of in DOM` を常時出すか

`candidateCount` は `root.querySelectorAll('*').length` (`src/designScan.ts:106-107`) で、
`<head>` 配下 (meta/script/style/link)・`display:none` 配下・SVG の `path`/`g` まで含む。
打ち切りが起きていないページでも `1,240 of 3,180` に見え、**毎回の計測が部分計測に見える**。
Mews が分母から除外するタグを明示列挙したのはこの理由。

**推奨: 母集団の開示は「可視かつ skip されなかった要素の総数」に対して行い、
`candidateCount` は打ち切りの申告にのみ使う。** 打ち切り時の文言も
`first {shown} of {total} elements` (異なる母集団の比較) をやめ、
「途中で打ち切ったため、このページの一部だけの数字です」と数を出さずに言う。
現行 `coverageTruncated` の「counts are exact for that part, not for the whole page」は
優秀なので保存する。

### 6-5. MUI 自動テーマ下で、spacing 一致率と 4px グリッド検査が同語反復になる

`MUI_SPACING_STEPS` (`src/tokenDict.ts:180-183`) は 0.25/0.5/0.75 + 1〜12 の 0.5 刻みで、
base 8px なら 2, 4, 6 と 8〜96 の 4px 刻みが全部トークンになる。`SIZE_NEAR = 4` なので
**8〜96px の範囲では `far` が構造的に発生しえない**。つまり spacing 行の hit/near 比は
「4 の倍数か否か」とほぼ同義で、その下の 4px グリッドは同じ事実の再掲になる。
バーの赤が消えることは「悪い値が無い」と読まれる。

**推奨: `panelBasisThemeInflates` を方向 (matches more easily) だけでなく
「自動テーマを使っているとき、この 2 つは独立した証拠ではない」と書く。** 指標を消すのではなく
従属関係を開示する。

### 6-6. `derivePanelState` を e2e で機械検証できない

既存 e2e は `chrome-extension://<id>/popup.html` を通常タブで開く方式
(`e2e/popup.spec.ts:32`)。同じ手で `sidepanel.html` も開けるが、**そのときパネルは
「普通のタブ」であって side panel ではない**ため、`tabs.onActivated` / windowId 解決 /
タブ切替をまたぐ生存 という stale 判定の本体は再現しない。Playwright に side panel を開く
API は無く、`sidePanel.open()` は user gesture 必須なので service worker からも呼べない。

つまり**本設計で最も壊してはいけない箇所が、唯一手動目視でしか守れない**。

**推奨: `derivePanelState` を純関数として `src/panelState.test.ts` で網羅し、
e2e は「パネルの HTML を通常タブで開いて、与えた state で正しく描くか」までに限定する。**
「パネル到達」と「タブ切替による stale」は §9 の実機手順に明示的に降ろす。

### 6-7. 既存の回帰ガードが弱くなる

`e2e/popup.spec.ts:48-58` は commit 459db69 (「押せるのに無反応が一番わかりにくい」) の
機械固定で、`#toggle` と **`#coverageMeasure` の両方**が disabled + 理由表示になることを
assert している。計測ボタンをパネルへ移すとこの assert の半分が消え、移設先では 6-6 の理由で
real side panel の e2e が書けない。

**推奨: `#openPanel` に同じ assert を移す。** パネルを開く導線自体が「未有効化・http(s) で
ない」ときに disabled + 理由になるなら、規律は移設先でも機械で守れる。

---

## 7. 残る失敗モードと対処

| 失敗 | 対処 |
|------|------|
| パネルが別ページの数字を新鮮な顔で表示する | §5-2 の `derivePanelState` + §4-1 ② の stale バナー。**本設計で最初に固める純関数** |
| クロスオリジン CSS で来歴が系統的に「ベタ書き寄り」に歪む | `src/cssVars.ts:136-139` の縮退が `inherited` に落ちるため、**var 経由の良い宣言だけが選択的に消える**。`originAvailable` は var/literal がゼロ件のときだけ false (`src/designScan.ts:139-141`) なので 5% しか読めなくても true。**対策: 読めた stylesheet 数 / `document.styleSheets.length` を basis note にし、未読比率が高いときは来歴を抑制する** |
| ビルド時に literal を吐く「トークン駆動」を直書きと断定する | 原理的に防げない (Tailwind / SCSS 変数 / CSS Modules はビルドで情報が消える)。**文言を予測から観測へ落とす**: 「配信された CSS には実値が書かれています。ソースがトークン由来かはページからは分かりません」。§6-1 と対 |
| ページ上ハイライトが消せなくなる | `sidePanel.onClosed` は Chrome 142+ で使えない。§5-4 の「ハイライト自体に Clear を持たせる」+ Esc 中央ハンドラ |
| ハイライト件数が計測件数と食い違う | §5-4 の `visibleElements` 共有述語。ずれたら両方の数を出す |
| ショートカット / background 経由で全 iframe に配信される | パネルは manifest command を持たないので該当しない。**将来コマンドを足すなら `entrypoints/background.ts:129` に `{ frameId: 0 }` が要る** (現在は無指定) |
| 大規模ページで `design-scan` が 5 秒でタイムアウトする | `entrypoints/bridge.content.ts:82-85`。§5-1 の `withOrigin` 分離で走査コストが落ちるが消えはしない。**「重すぎて時間切れ」を「失敗」と区別する状態を状態機械に持つ** |
| 面が 2 つになり同期先が増える | v1 で Tree を配線外ししたとき Touch Bar 側も直す必要があった前例と同型 (commit b80fabf / 9918187)。**popup から計測 UI を完全に抜く** (状態表示だけ残す) ことで、同じ数字を出す UI を 2 つ作らない |
| 400px 幅で 2 分母テーブルが溢れる | 320 / 400 / 560px の 3 断面で作り、**2 行ブロックを既定にする**。ビルド緑を根拠にしない。**③目視の確認項目** |
| 日本語 / 英語で折り返しが違う | 英語の方が長い箇所と日本語の方が長い箇所が両方ある。**③目視の確認項目 (両言語)** |

---

## 8. 将来: ページ内の常設パネル (任意)

§2 で却下した案 C の受け皿。安全性 (§5-1 の集計修正 + §6-1 のゲート一元化) をコードで
解決した後なら、ページ内に置くことは**安全のためではなく成果物のため**になる。

- 折りたたみピル + ハイライト残置 = 「このチェックアウト画面のトークン外れ余白はここ」という
  **注釈付きスクリーンショット**が 1 操作で作れる。デザイナーがステークホルダーに見せるのは
  まさにこれで、side panel のスクショでは作れない。
- ただし**ピルに率を出さない**こと。分母もトークン件数も部分計測フラグも落ちた `72%` が
  Slack と資料に流れるのは罠 a そのもの。実数と scope (`1,240 elem · 24+31 tokens · partial`)
  だけにする。
- ページ内に置くなら地雷 3 の 4 点配線 + Esc が要る。`entrypoints/background.ts:129` の
  frameId 無指定も同時に直す。

もう 1 つの将来: **CSS 変数の使用統計**。`DesignProp.varName` / `varNames` / `ambiguous` は
`collectAuthoredInfo` 経由で毎要素ぶん解決されている (`src/designStyle.ts:74-81`) のに、
`Occurrence` が `{ label, value, count, origin }` しか持たないため**その場で捨てられている**。
「ページ全体でどの CSS 変数がどれだけ使われているか」が実質タダで作れる状態にある。
**v1 では出さない** — これは「トークン準拠の検証」ではなく「変数の使用統計」で、
単一目的の説明を広げる。issue に落として v1.1 で判断する。

**明示的な非ゴール** (どれか 1 つでも入れた瞬間に単一目的の説明が広がる。tree/render を
外したのと同じ判断軸): 過去計測の履歴 / 複数ページのダッシュボード / トレンド / 前回比の
自動判定 / 共有 URL / クラウド保存 / AI チャット / 汎用 DevTools 代替。
Preply も Lighthouse も「率は日ごとに揺れる」「単一の数値ではなくスコアの分布として捉えよ」と
書いている。**1 画面 1 スナップショットに限定し、差分の自動判定を持たない。**

---

## 9. 実装工数とフェーズ

**合計 8〜11 人日。** 各フェーズ単体でコミット可能・全ゲート green を維持する。
順序は E → A → B → C → D。**集計側の型変更 (E) を描画 (C) より前に置く** — `origins` の
分布化・`notJudged` の分離・`tokenSources`・新しい `truncated` 判定はすべて E で作られる型なので、
逆順だと C は存在しないフィールドを描くことになる。

| Phase | 内容 | 主に触るファイル | 目安 |
|-------|------|-----------------|------|
| **E** ✅ | 集計側の欠陥修正 (§5-1) — **2026-08-06 完了** | `src/coverage.ts` / `src/designScan.ts` / `src/designStyle.ts` / `src/tokenDict.ts` / `src/tokenLint.ts` / `src/aiPrompt.ts` / `entrypoints/{inspector.content,popup/main}.ts` / 既存 3 テスト + `e2e/coverage.spec.ts` | 実績 0.5 日 |
| **A** | 面を立てる (空パネル + gesture-safe な open + 最低版) | `wxt.config.ts` / **新規** `entrypoints/sidepanel/{index.html,main.ts}` / `entrypoints/background.ts` / `entrypoints/popup/*` | 0.5 日 |
| **B** | 状態モデル (§5-2) ★最優先で固める | **新規** `src/panelState.ts` + `.test.ts` / `src/scanClient.ts` | 1 日 |
| **C** | 描画本体 (§4) — 14 セクション × 3 断面 × ダーク/ライト | **新規** `src/coverageView.ts` + `.test.ts` / `entrypoints/sidepanel/*` | 2.5〜3.5 日 |
| **D** | ページ上ハイライト (§5-4) | **新規** `src/overlayHighlight.ts` / `src/overlay.ts` / `src/overlayStyles.ts` / `src/inspector.ts` (1 行) / `entrypoints/{bridge,inspector}.content.ts` / `src/types.ts` | 1.5〜2 日 |
| **F** | i18n / e2e / 対外文書 | `public/_locales/{en,ja}/messages.json` / **新規** `e2e/sidepanel.spec.ts` / `e2e/popup.spec.ts` / `STORE_LISTING.md` / `SECURITY.md` / `PRIVACY.md` / `PUBLISHING.md` / `CLAUDE.md` / `docs/ROADMAP.md` | 1〜1.5 日 |
| — | popup の減量 (計測 UI 撤去・状態表示化) | `entrypoints/popup/{index.html,main.ts}` (892 行 / 392 行) | 0.5〜1 日 |

**既存テストが赤くなる変更を含む**: `src/coverage.test.ts` (197 行) は
`matrix.excluded` の意味変更と `TopOffender` の型変更で確実に落ちる。純関数なので修正は
機械的だが、事前に共有しておく。
→ 実績: 落ちたのは `coverage.test.ts` の 3 箇所と `aiPrompt.test.ts` の fixture 1 箇所のみ
(いずれも typecheck が先に検出)。E で unit は 250 → 269 (+19)、`e2e/coverage.spec.ts` の
assert も 5 本増やした (**来歴ゲートが過剰発火して数値が静かに消える**のを機械で防ぐため。
false に倒れた場合の症状は「エラーではなく欠測」なので、目視では気づけない)。

**先に片付けるブロッカー** (この作業の diff に混ぜない):
`PRIVACY.md` 冒頭と「Render report you copy yourself」節が **v1 に存在しない機能を宣言している**
(提出前ブロッカー。カバレッジ画面に Copy 導線を残す以上、この節は「カバレッジ計測の
Markdown コピー」として書き直しが同時に必要) / `STORE_LISTING.md:16-18` が自己申告している
`PUBLISHING.md §4-2` の未同期 / AI 既定 ON と掲載文 "Off until you configure a key" の食い違い。

**申告に足す 1 行** (2 箇所、英日): `STORE_LISTING.md` の Permission justification と
`SECURITY.md` の権限表に `sidePanel: 計測結果を対象ページと並べて表示するため。
ページへのアクセス権限は増えない`。Data usage 申告は変わらない — **送信経路を増やさない**
(AI 1 本のまま)。計測結果は**永続化しない** (メモリのみ) と決めることで、
`coverageScopeNote` の "Nothing is saved or sent." と `SECURITY.md:52-63` の grep 監査手順が
嘘にならない。コピー Markdown に URL もタイトルも入れない。

**コミット前ゲート**: `pnpm wxt prepare` → `pnpm lint && pnpm test && pnpm typecheck && pnpm build`
全 green。`pnpm e2e` は別ゲート。**ビルド緑 ≠ 正しい描画。**

---

## 10. 実装前に実機で確かめること

1. `pnpm build` → 拡張を ⟳ → `chrome://extensions/shortcuts` で既存バインドが壊れていないことを確認
2. popup の click ハンドラから `await sidePanel.open({ tabId })` → `window.close()` が
   本当に動くか。パネルが開けば popup は自動で閉じるはずなので、**`window.close()` が
   不要かどうか**まで見る (gesture 系は「崩すと無言で死ぬ」領域)
3. サイドパネルの既定幅・最小幅・ユーザーがドラッグでリサイズできるか (公式に記載が無い)。
   320 / 400 / 560px の 3 断面がどこに当たるかを実測で確定させる
4. `action.default_popup` + `setPanelBehavior({ openPanelOnActionClick: false })` で
   ツールバーが popup に固定されるか (優先順位は公式に記載が無い)
5. パネルから `browser.permissions.request` が通るか (AI 監査をパネルに置く場合。
   side panel からの実挙動は公式に記載が無い)
6. 未許可オリジンのタブに切り替えたとき、パネルが `tab.url` を読めるか / 読めないか (§6-2)
7. 大規模な本番 SPA で `design-scan` が 5 秒タイムアウトに当たるか。
   §5-1 の `withOrigin` 分離の前後で比較する
8. ハイライトの件数が計測時の `×N` と一致するか。SPA でスクロールしながら 60fps を保てるか
9. ダーク / ライト × 英日 × stale 3 種 × 320/400/560px の実描画

---

## 11. この設計で捨てたもの

正直に書いておく。

- **面が 2 つになる。** popup とパネルで同期先が増え、`e2e/popup.spec.ts` の assert を
  移設先へ付け替える必要がある。v1 で Tree を外したとき Touch Bar 側も直す必要があった
  前例と同じ構造で、次に何かを配線から外すときの手間が確実に増える。
- **`minimum_chrome_version` を背負う。** §3 の表より 119 以上。これ自体は
  `docs/assessment-20260802-store-readiness.md:147` が指摘済みの穴なので実質は前倒しだが、
  **数字を間違えると審査提出物に嘘が 1 個増える**。着手前に全 API の下限を洗って最大値を採る。
- **トークン欄の移設は既存利用者の学習をやり直させる。** 340px の textarea に長大 JSON を
  貼る苦痛は消えるが、「popup にあったはず」の迷子が出る。
- **MUI 自動テーマの内訳開示は、数字を「悪く」見せる方向に働く。** `12+386 sizes` と出せば、
  spacing の高い一致率が自動生成の密なラダーによるものだと分かってしまう。誠実さのために
  率の説得力を自分で削ぐ選択で、ステークホルダーに見せる場面では歓迎されない可能性がある。
  それでも出す — 出さないと**率の意味が変わっていることに誰も気づけない**。
- **2 分母 (要素 / 語彙) は認知負荷を上げる。** 数字を 2 つ渡すと「どっちが本当？」になる。
  列見出しと ⓘ で意味を書くが、1 つに絞る案より確実に読むのが重い。
  実ページでは語彙率が構造的に低く出る (一回きりの値のロングテール) ので、
  **乖離が閾値を超えたときだけ第 2 列を強調する**等の後追い調整が要るかもしれない。

**「数字が出ない」「率を出さない」は残る。ただし「計測していないことを、計測して悪いと
報告する」は原理的に消える。この交換が設計の核心。**
