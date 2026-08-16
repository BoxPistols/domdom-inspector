# 深掘り監査 — 2026-08-07

Chrome Web Store の Public 公開直前に実施した監査の記録。**12 エージェント (6 観点 × 反証役)**、
実 Chromium プローブつきで **70 件** (所見 48 + 反証役が拾った見落とし 22)。

観点: 操作列で壊れる状態機械 / パフォーマンス / アクセシビリティとコントラスト /
CWS ポリシー準拠 / 出荷物の中身 / i18n の質。

**この表が唯一の記録。** ワークフローの出力は一時ファイルにしか残らないため、ここへ写した。
`✅` は修正済み (版数)。**全 70 件に状態がつき、⬜ 未対応は 0 件**。issue 化した 3 件 (#17 #18 #19) は v0.4.24 で閉じたので、未修正で残るものは「判断済み (修正しない)」(理由つき) だけ。

> 監査の設計上の要点: 各観点の finder に「**動かない**より**誤答する**を優先して探せ」と
> 「読んだだけなら measured: false と書け」を課し、別エージェントが**反証**に回った。
> 実際に finder の severity が 8 件下げられ、反証役が finder より重い問題を 22 件見つけた
> (`:where`/`@layer` の誤答はここから出た)。**単一のレビューでは出なかった。**

**2026-08-07 追記**: high 3 件 (issue
[#14](https://github.com/BoxPistols/domdom-inspector/issues/14) /
[#15](https://github.com/BoxPistols/domdom-inspector/issues/15) /
[#16](https://github.com/BoxPistols/domdom-inspector/issues/16)) は v0.4.13 で修正した。
いずれも修正を戻すと落ちることを確認した回帰テストつき (`e2e/iframe-sync.spec.ts` /
`e2e/badge.spec.ts` / `scripts/store-screenshots.mjs` の撮影前実測)。

**2026-08-08 追記**: 残っていた medium 10 件 + low/missed の大半を v0.4.14 で一括修正した。
未修正で残るのは issue 化した 3 件 (#17 bundle 分離 / #18 分類の非色手がかり /
#19 選択中の live 追従) と「判断済み (修正しない)」4 件のみ。

**2026-08-16 追記**: 残っていた issue 3 件を v0.4.24 で閉じた。**未修正で残るのは
「判断済み (修正しない)」4 件のみ**。いずれも修正を戻すと落ちることを実測で確認した検査つき:
- #17 → 温存実装を `src/render-bundle/` へ分離 + 描画を `OverlayDebugSurfaces` へ切り出し。
  inspector.js 60,908 B → 48,508 B (分離のみの差分)。`pnpm check:submission` が出荷 JS を
  走査して毎回実測する (目印を本体へ 1 つ戻したら赤になることを確認)
- #18 → 分類ドットを形 (円/四角/ひし形) でも区別。`e2e/badge.spec.ts` が実描画の
  computed style で検証 (形状クラスを外すと赤)
- #19 → 選択中の要素に MutationObserver + ResizeObserver。150ms でまとめる。
  `src/inspector.test.ts` が追従・throttle・OFF 後の停止・DOM 離脱を固定 (配線を外すと 4 件赤)

---

## 未対応の一覧 (着手順の候補)


v0.4.14 の一括対応で **medium 10 件はすべて修正済み**。low / missed の未対応は
各項目の「状態」行に判断を書いた (修正しない判断をしたものは理由つき)。
**issue 化していた 3 件は v0.4.24 で対応済み** (残りは「修正しない判断」のみ):

| issue | 内容 | 対応 |
|---|---|---|
| [#17](https://github.com/BoxPistols/domdom-inspector/issues/17) | 到達不能コードの bundle 排除 (温存実装の分離ビルド) | ✅ v0.4.24 — `src/render-bundle/` へ分離 + `OverlayDebugSurfaces` 切り出し (-12,400 B) |
| [#18](https://github.com/BoxPistols/domdom-inspector/issues/18) | 分類 (青=MUI 等) の非色手がかり (SC 1.4.1) | ✅ v0.4.24 — ドットを形 (● ■ ◆) でも区別。popup 凡例にも同じ形 |
| [#19](https://github.com/BoxPistols/domdom-inspector/issues/19) | ホバー中の同一要素のスタイル変化にバッジが追従しない | ✅ v0.4.24 — MutationObserver + ResizeObserver、150ms throttle |

---

## 全件 (重大度順)

### [blocker] popup のヘルプが「存在しない貼り付け欄に Figma トークン JSON を貼れ」と en/ja 両方で指示している (実描画で確認)

- 状態: **✅ v0.4.10** / 観点: `bundle` / 反証: `—` / 実測
- 根拠: `entrypoints/popup/index.html:269 — `<p><b>Design tokens</b>: paste your Figma Variables / W3C / Tokens Studio JSON above.``
- 影響: ユーザーが製品の看板機能 (トークン照合) について製品自身から誤った手順を教えられる。「上の欄」の実体はエディタのパス対応 textarea なので、指示に従うと Figma のトークン JSON をパス対応欄に貼り込む。v1 は MUI テーマ自動検出のみなので「貼り付ければ照合される」自体が偽。STORE_LISTING.md:58 の `MATCH AGAINST YOUR DESIGN TOKENS — ZERO CONFIG` / 「テーマは自動検出」とも製品内で矛盾しており、CWS 審査官が popup を開けば掲載文と製品内説明の食い違いとして見える。「存在しない機能の宣言」は
- 再現: 実測済み。playwright で `.output/chrome-mv3` をロードし `chrome-extension://<id>/popup.html` を開き、全 `<details>` を open にして `[data-help]` を dump した結果:
- `data-help="en"` が hidden:false / visible:true。本文に `Design tokens: paste your Figma Variables / W3C / Tokens Studio JSON above.` と `with names resolved against 
- 直し方: index.html:264 と 269 の 2 文、286 と 291-293 の 2 文を書き換える。264/286 は「pasted design tokens / 貼り付けたデザイントークン」→「the MUI theme detected on the page / ページから自動検出した MUI テーマ」。269/291 の段落は「paste ... above」を落として「MUI を使うページならテーマを自動検出して照合する。4px グリッド外の野良値には警告が付く」に置換。併せて index.html のヘルプ本文を i18n.test.ts の検査対象に入れる (data-h

### [blocker] 出荷済み popup と権限正当化が「存在しないトークン貼り付け欄」を宣言している (v0.4.4 で外した機能の残骸)

- 状態: **✅ v0.4.10** / 観点: `cws-policy` / 反証: `—` / 実測
- 根拠: `entrypoints/popup/index.html:269 — en ヘルプ: 'Design tokens: paste your Figma Variables / W3C / Tokens Studio JSON above.'`
- 影響: (1) 出荷物のヘルプが存在しない UI を指すため、利用者は照合が動かない理由を特定できず、誤って別機能の欄に貼って設定を壊す。(2) `*://*/*` を要求する拡張で最も精査される Permission justification 欄に、実装に無い機能 (pasted design tokens) が書かれている。CWS の典型的却下理由「説明と機能の不一致」に直接該当し、PUBLISHING.md:261-262 が自ら挙げている類型。
- 再現: 実測: `unzip -p .output/domdom-inspector-0.4.7-chrome.zip popup.html | grep 'paste your Figma Variables'` → 1 件ヒット。同 popup.html 内の `<textarea>` は `id="pathMappings"` の 1 個のみ (`grep -o '<textarea[^>]*>'`)。ユーザー再現: popup → How to use を開く → 指示どおり「上の欄」を探すとパスマッピング欄しかない → そこへトークン JSON を貼ると `=` を含む行が偽マッピングとして
- 直し方: popup ヘルプ 3 箇所 (index.html:264 / 269 / 291-293) から貼り付け前提の記述を削り「照合は MUI テーマ自動検出のみ (テーマの無いページは CSS 変数名 + グリッド検査)」に書き換える。STORE_LISTING.md:84 の storage 正当化を 'persist user settings (editor choice, path mappings)' に、:185 / :224 から貼り付け記述を削除。ヘルプ本文は HTML 直書きで機械検査が無いので、i18n.test.ts に「popup HTML に paste/貼り付け 等

### [blocker] 非 React ページで「本番ビルドだから出ない」と嘘の理由を出す (実測: 素の HTML で確認)

- 状態: **✅ v0.4.10** / 観点: `i18n-quality` / 反証: `—` / 実測
- 根拠: `src/inspector.ts:105`
- 影響: 掲載文が主力として売っている「どんなサイトでも動く / React 以外のページでも動く」経路で、最初に出る文言がユーザーのページを本番 React ビルドだと誤って断定する。さらに (1) トークン照合が動くと約束するが、非 MUI・非 React ページには v1 に辞書の供給路が無く実際は 1 件も照合されない (同じ実測でバッジは生値のみ) (2) 非 React でも動く ↑↓ 親子ナビ (e2e/framework-matrix.spec.ts:131 で機械固定済み) に触れないため、動く機能が隠れる。同じクラスのバグはクリック経路では既に解決済み (inspector.ts:2
- 再現: ビルド済み拡張を実 Chromium にロードし、React を一切含まない素の HTML (localhost) でインスペクトを ON にする。トースト実測値: 「インスペクト ON — 本番ビルド: コンポーネント名とソースジャンプは出ませんが、デザイン値とトークン照合は動きます。Esc で終了」(en は同義の inspectOnSafe)。原因は inspector.ts:105 が hookState.devMode だけで分岐しており、devMode は hook.ts:38 の renderer.bundleType===1 でしか true にならないため「React が無い
- 直し方: 文言のみで直す (ロジック変更なし = 提出直前でも安全)。3 箇所同期: src/types.ts:234-235 / en:231 / ja:231。en 案: 'Inspect ON — design values and CSS variable names work here. Component names and source jump need a React dev build. ↑↓: parent/child · Esc to exit' / ja 案: 「インスペクト ON — デザイン値と CSS 変数名は表示できます。コンポーネント名とソースジャンプには React

### [blocker] スクロール直後の ⌘Click が「スクロール前にホバーしていた要素」のソースを開く (誤答・100% 再現)

- 状態: **✅ v0.4.10** / 観点: `ux-breakage` / 反証: `—` / 実測
- 根拠: `src/inspector.ts:269-275 — onScroll は hideHighlight / currentElement=null / navStack / keyboardNav を落とすが currentInfo を落としていない`
- 影響: この製品の最悪の壊れ方 (誤答) が、最も日常的な操作列「対象を画面内に入れるため少しスクロール → ⌘Click」で起きる。開くファイル・行が違うのに「エディタに送りました: <パス>」と断定表示するため利用者は誤りに気づけない。Alt+Click の owner パネルと、非 React↔React をまたいだ場合の「この要素にはソースがありません」等の理由文言も同じ経路で誤答する (currentInfo が別要素のため)。
- 再現: 実測 (probe1 [A1]-[A4] / probe3 [G1]-[G3])。localhost の React dev ページで #a(120px) の下に #b を置く → ⌥⇧I で ON → (100,60) にカーソルを置いて #a をホバー (バッジ `<CardA> A.tsx:42`) → **マウスを一切動かさず**ホイールで 120px スクロール (CDP mouseWheel のみ送出、mouseMoved なし) → この時点で elementFromPoint(100,60)=#b、枠とバッジは非表示 (box display:none) → そのまま ⌘Cli
- 直し方: 最小: src/inspector.ts:269 の onScroll に `this.currentInfo = null;` を追加 (枠を隠したのに情報だけ生き残る状態を作らない)。併せて onIntercept の click 分岐先頭で対象を再解決する — `const hit = document.elementFromPoint(me.clientX, me.clientY); if (hit) { const el = drillToInnermost(hit, me.clientX, me.clientY); if (el !== this.currentElement) t

### [high] 出荷 _locales に BYOK AI 監査の文言 21 キーが丸ごと残り、CWS Data usage 申告「収集しない / ネットワークリクエストを 1 つも発行しない」と正面から矛盾する

- 状態: **✅ v0.4.10** / 観点: `bundle` / 反証: `—` / 実測
- 根拠: `public/_locales/en/messages.json — `sectionAi` = "AI design audit (BYOK)" / `btnAiSend` = "Send to AI" / `labelAiKey` = "API key" / `hintAiPrivacy` = "Only aggregated style values are sent (colors, sizes, counts, token names)…" / `aiStatusSending` = "Asking the AI…" / `aiEstimateLine` = "≈ {tokens} input tokens · {n}/{cap} AI calls this session…" (計 21 キー。ja も同数)`
- 影響: 申告と提出物の文言が食い違う。CWS の privacy 申告不一致は差し戻し 1 ラウンドを生む典型で、しかも `optional_host_permissions: ["*://*/*"]` + `scripting` を持つ拡張は元から精査対象。逆方向の検査が無いため今後も孤児は増え続ける。削除コストはほぼゼロなので、このリスクを抱えて出す理由が無い。ユーザーへの誤答は無い (popup は markup にある data-i18n キーしか流し込まないので孤児は描画されない — 実測)
- 再現: 実測済み。196 キーそれぞれについて src/ entrypoints/ e2e/ scripts/ wxt.config.ts の全 .ts/.html/.mjs を 1 本に連結して識別子トークン集合を作り、一度も現れないキーを抽出 → **91/196 キー (46%) が孤児**。en 9164 B / ja 11064 B。うち AI 監査 21 キー、トークンカバレッジ 36 キー、tree/render 系 (cmdToggleTree / popupToggleRender / hintTreeWhat 等) 12 キー、貼り付けトークン UI 7 キー。
審査官視点の再現:
- 直し方: 孤児 91 キーを en/ja 両方から削除する (キー集合は en=ja で一致しているので同じリストで消せる)。さらに src/types.ts の DEFAULT_STRINGS 69 キーのうち v1 実配線で未参照の 35 キー (renderOn / treeOn / statsTitle / vitalsTitle / cause* / changed*Hint / panelClose 等) も落とすと計 126 キーが消えて 70 キーになり、_locales は 43.11 kB → 14.69 kB (実験ビルドで実測)。恒久策として src/i18n.test.ts に

### [high] 審査担当者向けテスト手順 (§5-0) の step 3 が inspect を OFF にする — 「動かない」判定の経路

- 状態: **✅ v0.4.10** / 観点: `cws-policy` / 反証: `—` / 実測
- 根拠: `PUBLISHING.md:236-240 — step 2 で「Enable on current site」→ step 3 で 'In the popup, press "Toggle inspect mode" (or Alt+Shift+I), then hover any element — a badge shows…'`
- 影響: CWS 審査で最も多い却下理由「機能が確認できない/動作しない」を、こちらが用意した必須メモ自身が誘発する。モードピルが消える視覚フィードバックがあるため回復可能だが、提出物の中で最も高レバレッジな文面がユーザー (審査官) を非動作状態へ導くのは提出前に直す価値がある。
- 再現: コード経路で確定 (ブラウザ実行は未実施)。手順: 任意の公開サイト → popup →「Enable on current site」→ 許可 (ここで inspect ON + モードピル表示) → popup を開いて「Toggle inspect mode」→ OFF → ホバーしてもバッジが出ない。審査官が §5-0 の文面どおりに操作するとこの状態になる。
- 直し方: §5-0 の step 2 の末尾に「有効化した時点でインスペクトは既に ON になり、右下にモードピルが出る」を追記し、step 3 を『hover any element right away — a badge shows…(the toggle button / Alt+Shift+I is only needed to turn it back on after Esc)』に書き換える。

### [high] ページが postMessage で照合辞書を注入でき、バッジがページ提供のトークン名で「一致」と表示する (監査結果の偽装経路)

- 状態: **✅ v0.4.13** (`tokens` 受信を廃止。e2e/撮影も実供給元 (テーマ自動検出) に切替 / SECURITY.md に残る限界を明記) / 実測
- 根拠: `entrypoints/inspector.content.ts:172-179 — `data.type === 'tokens'` を受けて `pastedTokens` を差し替え `pushMergedTokens()`。検証は colors/sizes が配列かの shape チェックのみで、送信元は同一 window の任意ページ`
- 影響: この製品の中核主張は「UI がデザイン定義に基づくかを検証する」。監査対象は自分が制御しないデプロイ済みサイトなので、ページ側が「全部トークン準拠」に見せられることは誤答そのもの。正規の供給元 (MUI テーマ自動検出) は MAIN world 内で完結し postMessage を使わないので、このハンドラは現状 e2e/撮影専用の攻撃面。SECURITY.md の脅威モデル記述も実態より狭い。
- 再現: 実測: 上記ハンドラと screenshots スクリプトの evaluate が同一の postMessage 契約 (`{source:'domdom-inspector-bridge', type:'tokens', payload:{colors,sizes}}`) を使っていることをコードで確認。任意ページで同じ postMessage を発行すれば、自ページの生値に任意のトークン名注釈 (例: `palette.primary.main`) を付けさせられる。ブラウザでの実行は未実施。
- 直し方: `tokens` 受信ハンドラを本番ビルドから外す (最小: `import.meta.env.MODE`/dev ガード、または e2e 専用の別 message type + `__DOMDOM_E2E__` フラグで門を作る)。撮影スクリプトは実 MUI テーマを持つデモページに切り替えれば同経路を不要にできる。あわせて SECURITY.md:20-22 に「偽装で照合注釈を書き換えられる経路は塞いだ」旨を反映する。

### [high] 提出スクリーンショット 4 枚中 2 枚が、ユーザーが到達できない経路で注入した辞書に依存している (自称「実物一致」を満たさない)

- 状態: **✅ v0.4.13** (撮影ページに ThemeProvider の断面を置き自動検出で撮る + 撮影前にバッジ文言を実測) / 実測
- 根拠: `scripts/store-screenshots.mjs:204-229 — injectTokens() が `palette.primary.main` / `spacing(1..3)` / `shape.borderRadius` / `typography.body2` を手書きで postMessage 注入 (コメントは『v1 の実供給元 = MUI テーマ自動検出と同じ経路』と説明するが、同じなのは伝送路だけで供給元ではない)`
- 影響: 掲載画像が「どんなサイトでもトークン名が出る」と読める。実際にトークン照合が働くのは MUI テーマを持つページのみで、掲載文 (STORE_LISTING.md:58-66) の条件付き記述より画像が広い。審査官が再現を試みて一致しない場合、Public 特有の「misleading imagery / 説明と機能の不一致」に触れる。ユーザー側にも期待外れ (低評価) として跳ね返る。
- 再現: 実測: スクリプトを読み、撮影順が activate → injectTokens → shoot(02) → shoot(03) であることと、DEMO_HTML に react/mui の記述が一切無いことを確認。ユーザー再現: 同じ素 HTML ページで拡張を使っても 01 の状態 (CSS 変数名 + 野良値警告) までしか出ず、02/03 のトークン名注釈は出ない。
- 直し方: 撮影用デモを実 MUI アプリ (ThemeProvider + テーマ、production ビルドでも可) に差し替え、injectTokens を廃止して自動検出で注釈を出す。当面それが重いなら 02/03 を en 掲載から外し、01 (CSS 変数名 + 野良値) と 04 の 2 枚 + MUI 実アプリでの手撮り 1 枚に置き換える。docs/store-assets/README.md の「実物一致」記述も実態に合わせる。

### [high] 提出 zip の _locales に、BYOK AI 送信機能の UI 文言 21 キーが残っている (データ申告「収集なし」と矛盾する記述を同梱)

- 状態: **✅ v0.4.10** / 観点: `cws-policy` / 反証: `—` / 実測
- 根拠: `public/_locales/en/messages.json:155 — `hintAiPrivacy`: 'Only aggregated style values are sent (colors, sizes, counts, token names) — never URLs, text, or page content. Nothing is sent until you press Send.'`
- 影響: 『データを外部に送る機能』を説明する利用者向け文字列が、データ申告を「一切収集しない」で出すパッケージに同梱されている。Public 審査はパッケージ内容と申告の突合が厳しく、未開示機能の疑いとして質問・保留の起点になりやすい (齟齬は停止理由になりやすいと PUBLISHING.md:55-56 自身が書いている)。実害の本体は審査リスクで、ユーザー影響は無い。
- 再現: 実測: `unzip -p .output/domdom-inspector-0.4.7-chrome.zip _locales/en/messages.json` を parse → 総 196 キー中 `ai*` 系が 21 キー、`hintAiPrivacy` の本文がそのまま含まれる。一方 `grep -roiE 'openai|apiKey|generativelanguage' *.js chunks/*.js content-scripts/*.js` は 0 件 = コードは無く文言だけが残っている。
- 直し方: 配線外しの未参照キー (実測で約 90 キー。`extName`/`extDescription`/`cmdToggleInspect` は manifest の `__MSG_` 参照なので残す) を _locales/{en,ja} から削除し、`statsCopy`/`statsCopied` 等 DEFAULT_STRINGS 側の未到達キーも src/types.ts と同時に落とす (i18n.test.ts が 3 箇所同期を強制するので必ず 3 箇所)。再導入時に戻せるよう、削除分は issue #10/#11/#13 に貼っておく。

### [high] popup ヘルプ (en/ja 両方) が v1 に存在しない「トークン JSON 貼り付け欄」への操作を指示している

- 状態: **✅ v0.4.10** / 観点: `i18n-quality` / 反証: `—` / 実測
- 根拠: `entrypoints/popup/index.html:269-271`
- 影響: v1 の唯一のトークン供給路 (MUI テーマ自動検出) にヘルプが一言も触れず、代わりに存在しない欄を案内する。MUI 以外のページでトークン名が出ないのを「自分が貼り付けていないから」と誤解し、存在しない欄を探し続ける。docs/store-submission-readiness.md:63 は「v1 に無い機能の宣言 = 全廃 (…トークン貼り付け)」と申告しているが実物に残っており、判定書が現物より新しい状態になっている。
- 再現: popup を開き「使い方ヘルプ」を展開する。en: 'Design tokens: paste your Figma Variables / W3C / Tokens Studio JSON above.' / ja: 「デザイントークン: 上の欄に … JSON を貼り付けると」。index.html に textarea#tokens は存在せず (data-i18n="sectionTokens"/"labelTokens" の参照も 0)、main.ts:57-59 が「トークン JSON 貼り付けは v1 の配線から外した」と明記している。ホバー節も en 'names resol
- 直し方: index.html:269-271 の en を差し替え: '<b>Design tokens</b>: when the page uses MUI, the theme (palette / spacing / radius / font sizes) is read from its ThemeProvider automatically — nothing to set up. Matched values show the token name, and off-token values are flagged with the nearest one. On pages with

### [high] 出荷 zip の _locales に未参照 91 キーが残り、うち AI 21 キーが「API キーをプロバイダに送信」と明記 — 「収集しない」申告と読み合わせると審査で照会される

- 状態: **✅ v0.4.10** / 観点: `i18n-quality` / 反証: `—` / 実測
- 根拠: `public/_locales/en/messages.json:128-190`
- 影響: CWS の Data usage 申告は全カテゴリ「収集しない」+「ネットワークリクエスト 0」。審査者が zip の _locales (整形済み JSON で最も読まれるファイル) を開くと、外部プロバイダへの送信・API キー・送信プレビューを説明する UI 文言が一式出てくる。コードには送信経路が無いので最終的には通るはずだが、申告と文言の食い違いは照会 (追加説明の要求) の現実的な引き金で、公開が数日〜数週ずれる。副次的に en 9,363B + ja 11,368B = 20.7KB (両 locale 43,107B の 48%、zip 60.6KB の約 34% 相当のソース
- 再現: 出荷 zip を直接開いて実測 (unzip -p .output/domdom-inspector-*-chrome.zip _locales/en/messages.json)。en 196 キー中 91 キーがソース全体 (DEFAULT_STRINGS / data-i18n / __MSG_x__) から 1 度も参照されない。内訳: カバレッジ 36 / 表示設定 tip・label 36 / AI 21 / トークン貼り付け 7 / ツリー・レンダー 8 (重複あり)。zip 内 en の実文例: sectionAi 'AI design audit (BYOK)' / btnA
- 直し方: 提出前に 91 キーを両 locale から削除する (温存が要るなら docs/ 側にスニペットで退避。再導入時は issue #10-#13 の PR で書き戻す)。同時に src/i18n.test.ts へ逆方向の検査を足して再発を機械で止める: 'it("_locales に参照の無いキーが無い")' — 各キーが DEFAULT_STRINGS / index.html の data-i18n / wxt.config.ts の __MSG_x__ のいずれかから参照されることを assert。判定ロジックは私が使った 3 条件をそのまま移植すればよい (lookbehind は 

### [high] 掲載文 4 箇所が「4/8px グリッド」と書くが実装は 4px 固定 — 8px 系のユーザーに沈黙の見逃しを与える

- 状態: **✅ v0.4.10** / 観点: `i18n-quality` / 反証: `—` / 実測
- 根拠: `STORE_LISTING.md:51`
- 影響: 8px グリッドのデザインシステムを持つ利用者 (この製品の主要顧客像) が「グリッド外は警告される」と読み、12px/20px が無警告なのを準拠の証拠と受け取る = 掲載文起因の誤答。加えて 4/6/8/12 のような一般的な角丸スケールでは 6px が常に野良値扱いされる (MUI テーマを検出できたページでは overlay.ts:244 のトークン一致フィルタで抑制されるが、テーマの無いページでは抑制されない)。Public は掲載文の正確さが審査対象なので、実装より広い能力を書いている点も是正対象。
- 再現: src/overlay.ts:21 は const SPACING_GRID = 4 の固定値で、設定にもトークンにも出ていない。tokenLint.ts:35 は px % 4 !== 0 のみを警告にする。実 Chromium で padding:13px 5px / margin:7px / border-radius:6px の要素をホバーした実測バッジ: 「⚠ 内余白 13/5px(4px の倍数外) · 外余白 7px(4px の倍数外) · 角丸 6px(4px の倍数外)」。掲載文の 'a 4/8px grid' が示唆する 8px 判定は存在せず、12px・20px は 8p
- 直し方: 実装を変えず文言を実装に合わせる (グリッド可変化は v1 後)。STORE_LISTING.md:51 → '- Off-token value detection: spacing and border-radius that are not multiples of 4px are flagged, so design-system drift is visible at a glance.' / :143 → 「- 野良値検出: 4px の倍数でない余白と角丸に警告が付き、デザインシステムからの逸脱がひと目でわかります。」。README.md:15 / README.en.md:13 

### [high] CWS に貼る permission justification が存在しない「貼り付けたトークン」の保存を申告し、ja 対訳だけ PRIVACY.md と矛盾する

- 状態: **✅ v0.4.10** / 観点: `i18n-quality` / 反証: `—` / 実測
- 根拠: `STORE_LISTING.md:84`
- 影響: 審査者が読む storage の正当化根拠に、存在しない機能で保存すると書いてある。permission justification は実物と突き合わされる項目なので、公開されるプライバシーポリシー (PRIVACY.md) と食い違うと照会になる。さらに en (設定のみ) と ja (設定 + 貼り付けトークン JSON) で保存物の申告が言語間で違い、判定書 docs/store-submission-readiness.md:60 の「単一目的の四者同一」も実際には成立していない。
- 再現: STORE_LISTING.md:84 (審査へ提出する en 本文) = '`storage`: persist user settings (display options, pasted design tokens) locally.'。同 :185 (ja 対訳) = 「端末内に保存するのは利用者自身の設定と、利用者が貼り付けたデザイントークン JSON のみ。」。一方 PRIVACY.md の保存データ表 (en:24-26 / ja 対応節) は 'Settings (editor choice, path mappings)' の 1 行だけで、貼り付けトークンに言及しない。実装
- 直し方: STORE_LISTING.md:84 → '`storage`: persist the user's own settings (editor choice, custom editor URL, path mappings) locally. Nothing derived from page content is stored.'。:185 → 「端末内に保存するのは利用者自身の設定 (エディタの選択・カスタム URL・パスマッピング) のみ。」。PRIVACY.md の表と同じ語 (editor choice, path mappings) を使って 4 文書の表現を実際に一致させる

### [high] ホバー 1 回で CSSOM を 11 周する — mui.com 規模で 60→27fps、Tailwind 規模で 14.5fps、GitHub 規模で 1 ホバー 532ms

- 状態: **✅ v0.4.11** / 観点: `performance` / 反証: `CONFIRMED` / 実測
- 根拠: `src/inspector.ts:153-161 (pointermove ごとに rAF 1 本 → select、間引きは 1 フレーム 1 回のみ)`
- 影響: v1 の主機能 (ホバーで変数名つきバッジ) を使っている間だけ、対象ページのフレームレートが半分〜1/4 になる。ターゲットである MUI/Tailwind アプリがちょうど直撃レンジ (3k-6k ルール)。GitHub 規模 (約 40k ルール) では 1 ホバー 0.5 秒でカーソルに追従できず、体感はフリーズ。スクロール後は src/inspector.ts:269-275 が currentElement を捨てるので同じ要素でも再走査になり、キャッシュも無い。CWS 審査は止まらないが「入れると重い拡張」評価の直接原因になる。
- 再現: 実測スクリプト (ビルド済み .output/chrome-mv3 を実 Chromium にロードし、実サイトと同じルール数の合成ページで pointermove を投げる):
1) pnpm build:only
2) node /private/tmp/claude-502/-Users-ai-dev-domdom-inspector/2fe7d5de-f034-43c7-9516-d64dd5a4ea8e/scratchpad/hover-cost-raw.mjs
   → 1 ホバー (pointermove→2rAF) の中央値。OFF はいずれも 33.3ms (= 2 フレーム
- 直し方: winningValue を「プロパティ別に 11 周」から「ルール列 1 周で 11 プロパティ同時収集」に変える (cands を Map<cssProp, Cand[]> にして collectFromRules で 1 回の element.matches からすべて積む) + matchMedia を mediaText キーでメモ化。効果は実測済み: node .../scratchpad/single-pass.mjs で 6,200 rules・同一要素あたり 65.74ms → 5.41ms (12.1 倍)。加えて (a) 走査結果を element 単位でメモ化して同一要

### [high] hook シムが __REACT_DEVTOOLS_GLOBAL_HOOK__ を先取りすると React DevTools が沈黙する (実物 7.0.1 で 6 試行中 4 回再現)

- 状態: **✅ v0.4.12** / 観点: `performance` / 反証: `CONFIRMED` / 実測
- 根拠: `entrypoints/inspector.content.ts:34 (document_start / MAIN / allFrames で installHook)`
- 影響: 開発者/デザイナーの実機は React DevTools が入っている前提。ページ単位のレースなので「たまに Components タブが React を検出しない」という最も切り分けにくい壊れ方になり、原因が DomDom だと気づかれないまま両方に低評価が付く。しかも本プロダクトは自ら「dev なら React DevTools が優れる」と説明しており、その導線を自分で塞いでいる。CWS 審査は止まらない。
- 再現: 1) CWS から実物を取得して展開 (scratchpad/rdt = React DevTools 7.0.1)
2) node /private/tmp/claude-502/-Users-ai-dev-domdom-inspector/2fe7d5de-f034-43c7-9516-d64dd5a4ea8e/scratchpad/rdt-coexist.mjs
   (両方を実 Chromium にロードし、React 18 UMD の実ページで window.__REACT_DEVTOOLS_GLOBAL_HOOK__ の持ち主を判定)
   結果 (同居 6 試行): hookOw
- 直し方: v1 では hook から取っているものが 3 つだけで、すべて DOM 側の代替が既にある: (a) devMode → src/fiber.ts:239 が既に _debugOwner/_debugSource で判定しているので inspector.ts:105 のトースト分岐もそれに寄せる、(b) roots → findMuiThemeFromDom (src/muiTheme.ts:81) が後備として実装済み、(c) onCommit → テーマ再取得のトリガでしかないので、注入時 + inspect ON + 一定間隔の再試行で代替できる。結論として「既存フックがあれば pig

### [high] iframe を含むページで Esc を 1 回押すと親子フレームが逆位相になり、ショートカットで二度と全解除できない (iframe 内のクリックが死んだまま残る)

- 状態: **✅ v0.4.13** (冪等 ON/OFF を全フレームへ配布 + トグルはトップフレームのみ + 告知はトップのみ) / 実測
- 根拠: `entrypoints/background.ts:185 — commands.onCommand が frameId 未指定で tabs.sendMessage → 全フレームの bridge に配信 (同ファイル 173-175 の contextMenus は frameId を明示しているのに、こちらは未指定)`
- 影響: 広告・埋め込み・プレビュー iframe を持つ実サイト (allFrames + *://*/* 許可なので全フレームに注入される) で、利用者が Esc で「終了した」と思った後も iframe 内のリンク・ボタンが一切押せない。復帰手段はリロードか、その iframe にフォーカスして Esc / その iframe 内の pill ✕ をクリックするしかなく、小さい iframe や視界外の iframe では終了導線が見えない。ショートカット連打では逆位相のまま解決しない。
- 再現: 実測 (probe2 [B1]-[B7])。localhost に 600x400 の同一オリジン iframe を持つ親ページを開く → SW から `chrome.tabs.sendMessage(tabId,{type:'toggle-inspect'})` (⌥⇧I と同一経路) → [B1] 親・子ともに pill ON (ピルが 2 個、トーストも 2 個)。[B2] iframe 内クリックは握り潰され子の click カウンタは 0。→ 親にフォーカスして Esc → [B3] 親 pill OFF / **子 pill は ON のまま**、[B4] iframe 内クリック
- 直し方: 冪等 OFF を作って全フレームへ配る。(1) Inspector に `disableOnly()` (ON のときだけ disable) を追加、(2) bridge の onMessage に `inspect-off` を追加、(3) MAIN world の Esc ハンドラで消費できた時に bridge 経由で background へ 1 本投げ、background が `tabs.sendMessage(tabId,{type:'inspect-off'})` (frameId 未指定=全フレーム) で配る。toggle も「どこか 1 フレームでも ON なら全フレーム O

### [high] 選択要素が DOM から消えても枠とバッジが残り、いま同じ位置にある別要素を囲んだまま消えた要素の値を表示し続ける (⌘Click も消えた要素のソースを開く)

- 状態: **✅ v0.4.10** / 観点: `ux-breakage` / 反証: `—` / 実測
- 根拠: `src/inspector.ts:130-138 — select は currentElement/currentInfo を保持するだけで、以後の生存確認 (isConnected) をどこにも持たない`
- 影響: 対象が React SPA なので、選択したまま数百 ms で DOM が差し替わるのは日常。デザイナーが「枠の中の要素の色/余白」としてバッジを読む・スクリーンショットを取る前提が崩れ、別要素の値をレビュー根拠にしてしまう。カーソルを動かせば自己修復するため、気づかないまま誤情報だけが残る。
- 再現: 実測 (probe1 [E1]-[E3])。#a(赤 #c62828, 120px) の下に #b(青 #1565c0) を置いた localhost ページで ON → (100,60) で #a をホバー (バッジ `<CardA> 背景色#c62828`) → **カーソルを動かさずに** `document.getElementById('a').remove()` を実行 (SPA のリスト更新・スケルトン→本体差し替え相当) → 枠は display:block / top:0 / height:136px のまま、バッジも `<CardA> … 背景色#c62828` のまま。こ
- 直し方: 上記 blocker と同じ再解決 3 行 (click 時に elementFromPoint から引き直す) で ⌘Click の誤答は消える。表示側は select 時の要素を覚えて rAF もしくは軽い間隔で `currentElement.isConnected` を確認し、外れていたら hideHighlight + currentInfo=null に落とす (追従までやるなら ResizeObserver ではなく「消えたら隠す」で十分)。

### [medium] overlay バッジの「生値」と「プロパティ名」が AA 未達 (実測 3.17:1 / 4.31:1) — v1 では無効化する UI が無い

- 状態: **✅ v0.4.14** (不透明度を引き上げ、overlayContrast.test.ts が色定数から毎回計算して機械検証) / 観点: `a11y-contrast` / 反証: `DOWNGRADED` / 実測 / finder の申告: high
- 根拠: `src/overlayStyles.ts:56 — `.badge .chip .raw { opacity: 0.5; font-size: 11px; }``
- 影響: `.raw` = **3.17:1 (ページ白) / 3.66:1 (ページ黒)** で、どんなページ背景でも 4.5:1 に届かない。`.lb` = 4.31:1 (白) / 5.15:1 (黒) で明るいページのみ未達。`.raw` は「CSS 変数名を優先表示したときの実測値そのもの」= この製品が存在する理由の出力で、既定 (showVarNames: true) かつ v1 に切替 UI が無いため利用者側で回避できない。entrypoints/popup/index.html:9 の「全色は WCAG AA (通常テキスト 4.5:1 以上) を満たすトークンで管理する」という宣言
- 再現: 実 Chromium (playwright 1.61.1 / chromium-1228) で src/overlayStyles.ts の OVERLAY_CSS をそのまま shadow root に注入し、overlay.ts:206-222 と同じ入れ子 (.badge > .design > .chip > span.raw) を構築。各段に `background: currentColor` の 60x60 ブロックを差してスクリーンショットのピクセルを canvas.getImageData で実測した (合成後の実色を取るため)。結果: chip 背景 = rgb(55,5
- 直し方: `opacity` は入れ子で乗算されるので (実例: `.badge .file` 0.95 × `.ehint` 0.55 = 実効 0.5225) 生値に opacity を使うのをやめ、`.lb`/`.raw` に明示色を置くのが恒久策。最小修正なら両方 `opacity: 0.72` (実測 4.83:1 / 5.92:1)。4.5:1 の閾値は実測で opacity ≥ 0.681 (ページ白)。`.lb` と `.raw` は同色・同背景なので 1 つの閾値で両方直る。

### [medium] inspector.js の 34% (18.8 kB) が到達不能。成果物全体では 49.4 kB / 33.5% が削れる (実験ビルド差分で実測)

- 状態: **✅ 一部 v0.4.14** (design-scan 撤去で 6.1 kB 削減 + 未到達サーフェスの遅延生成。残り (温存実装の分離ビルド) は issue #17) / 観点: `bundle` / 反証: `—` / 実測
- 根拠: `src/overlay.ts:405 flashRenders / 422 drawFlashes / 456 clearRenderFlashes / 470 showRenderStats / 574 causeTooltip / 604 copyText / 628 hideRenderStats / 636 showRenderControl / 655 hideRenderControl / 663 showTree / 705 hideTree / 709 isTreeOpen / 714 scrollTreeTo — いずれも src/inspector.ts と entrypoints/inspector.content.ts から一度も呼ばれない (呼ばれるのは containsTarget/hideAll/hideChainPanel/hideHighlight/hideModePill/isChainPanelOpen/openEditor/show/showChainPanel/showModePill/toast/updateSettings/updateTokens の 13 個だけ)`
- 影響: inspector.js は `all_frames: true` + `world: MAIN` で document_start に注入されるので、iframe の数だけ 54.8 kB を parse する。到達不能分がその 1/3。審査面としても、`.stats`/`.rctl`/`.tree` の CSS と showRenderStats/showTree の本体が成果物に残っていると、審査官が読んだ機能面と単一目的の宣言 (STORE_LISTING.md:95 「Measure the design values of a web page's UI…」) が一致しない。Ove
- 再現: 実測済み。リポジトリを scratchpad にコピーして段階的に剥がし、毎回 `wxt build` してサイズを取った (baseline はバイト単位で本物と一致: inspector.js 54805 B / Σ 147.17 kB)。
1. baseline: inspector.js 54.81 kB / Σ 147.17 kB
2. design-scan ハンドラを除去 (下記の別所見): 49.10 kB (−5.71)
3. overlay.ts:404-721 の死んだメソッド群を除去: 47.96 kB (−6.85)
4. 2+3: 42.26 kB
5. + ove
- 直し方: 温存しつつ成果物から出すには、overlay.ts:404-721 のメソッド群を別モジュール (例 src/overlayRenderPanels.ts) に「Overlay を引数に取る関数」として切り出し、renderDebug.ts / treeView.ts からだけ import する。クラスのメソッドでなくなれば Rollup が落とせる。対応する CSS も同モジュールから export し、パネル生成時に注入する形にする (overlayStyles.ts:121-243 を移す)。popup の死んだ CSS 26 行は素直に削除。復活は CLAUDE.md 地雷3 の 4

### [medium] design-scan だけ配線の両端が残っており (送信側は不在)、designScan.ts + coverage.ts 5.7 kB を bundle に引き込むうえ、ページからの postMessage 偽装で全文書走査を起動できる

- 状態: **✅ v0.4.14** (bridge 中継 + MAIN world 受信を撤去 (issue #10 に復元手順)。coverage e2e も撤去) / 観点: `bundle` / 反証: `—` / 実測
- 根拠: `entrypoints/inspector.content.ts:204 — `if (data.type === 'design-scan' && typeof data.id === 'string') {` → :208 `scanDesign(document, currentTokens(), {...})` → :215-218 結果を `window.postMessage({..., type:'design-scan-result', payload: scan}, '*')``
- 影響: ユーザーに届く機能が 1 つも無い経路のために 5.71 kB を全フレームに配り、かつページ側から叩ける入口を 1 つ余分に開けている。エディタ起動の postMessage 偽装は `freshContextTarget()` で塞いだのに、同じリスナのこの分岐は塞がれていない (対策の非対称)。e2e/coverage.spec.ts が緑なので、配線が切れていることが gate から見えない — これが 5.7 kB が生き残った直接の原因
- 再現: 配線の欠落は実測 (grep 全数)。走査の起動可能性は未確認 (コード読みのみ): inspect が有効なタブでページ script が `window.postMessage({source:'domdom-inspector-bridge', type:'design-scan', id:'x'}, '*')` を投げると :204 が成立し scanDesign が走る。返り値は `'*'` でページに返るが、v1 は貼り付けトークン UI が無く辞書はページ自身の MUI テーマ由来なので、ページが自分の持っていない情報を得るわけではない (= 情報漏洩ではない)。残るのは CPU
- 直し方: entrypoints/inspector.content.ts:202-219 と entrypoints/bridge.content.ts:87-107 を削除する (2 箇所だけ。src/designScan.ts / coverage.ts はディスク温存で issue #10 の復活に足りる)。e2e/coverage.spec.ts は削除するか `test.skip` にして doc コメントの「popup の測定ボタン →」を実態に合わせる (到達不能な経路を緑にしていると復活時に壊れていても気づけない)。src/coverage.test.ts (26) / designS

### [medium] overlay が inspect 起動ごとに到達不能な 4 サーフェスを実 DOM に作る (canvas.render-canvas + 2D context / div.stats / div.rctl / div.tree) — 実 Chromium で確認

- 状態: **✅ v0.4.14** (canvas/stats/rctl/tree を遅延生成に変更。e2e が「ホバー後も DOM に無い」を固定) / 観点: `bundle` / 反証: `—` / 実測
- 根拠: `src/overlay.ts:94-96 — `this.canvas = el('canvas', 'render-canvas'); this.ctx = this.canvas.getContext('2d');` (flashRenders/drawFlashes は到達不能なので一度も描画されない)`
- 影響: 透明・pointer-events:none・未描画なので見た目と操作は壊れない。実害は「inspect したフレームごとに無駄な DOM 4 個と 2D canvas context 1 個を確保する」こと。all_frames なので iframe が N 個あるページでは N 倍。ユーザーの見た目には出ないが、ページに要素を注入する拡張として最小主義から外れる (審査官が DevTools で shadow root を開けば、単一目的の宣言に無い stats/rctl/tree の器が見える)
- 再現: 実測済み。playwright で拡張をロードし localhost fixture で `attachShadow` を open 強制、`{source:'domdom-inspector-bridge', type:'inspect-on'}` を postMessage して要素を hover。closed shadow root の子要素を列挙した結果:
`[style, canvas.render-canvas, div.box, div.badge, div.panel, div.stats, div.rctl, div.tree, div.inspect-pill on, di
- 直し方: 上の overlay 切り出し (別所見) と同じ 1 手で消える。ensureMounted (src/overlay.ts:80-111) から canvas / statsPanel / renderControl / treePanel の生成と append を外し、パネル側モジュールが自分で lazy に作って root へ append する形にする。box / badge / panel / inspect-pill / toast / style の 6 個だけが v1 の器

### [medium] DEFAULT_STRINGS 69 キーのうち 35 が死んでおり、bridge が全フレームで全 69 キーを MAIN world (= ページが読める側) へ postMessage('*') している

- 状態: **✅ v0.4.10** / 観点: `bundle` / 反証: `—` / 実測
- 根拠: `entrypoints/bridge.content.ts:47-50 — `for (const key of Object.keys(DEFAULT_STRINGS) as (keyof UiStrings)[]) { resolved[key] = browser.i18n.getMessage(key) || DEFAULT_STRINGS[key]; }` → `window.postMessage({source: BRIDGE_SOURCE, type:'i18n', payload: resolved}, '*')` — 全キーを無条件に送る`
- 影響: 機密ではない (UI 文言のみ) が、bridge.js / inspector.js の両方に inline され、フレームごとに ja で 4.8 kB を postMessage する。半分が到達不能な文言。CLAUDE.md が API キーを Settings に混ぜないと定めている理由 (settings は MAIN world = ページへ流れる) と同じ経路で、送る量を最小に保つ意味がある
- 再現: 実測済み。DEFAULT_STRINGS の 69 キーを en/ja の messages.json の実文言で JSON 化してバイト数を測った:
- en: 現状 69 キー 3801 B → v1 実配線のみ 34 キー 1848 B (差 1953 B)
- ja: 現状 69 キー 4802 B → 34 キー 2357 B (差 2445 B)
これが bridge から MAIN world へ、`all_frames: true` なので**フレームごとに 1 回**飛ぶ。bridge.js 8.69 kB のうち DEFAULT_STRINGS のフォールバック文言が en
- 直し方: 35 キーを src/types.ts の DEFAULT_STRINGS / UiStrings 型 / _locales 両方から落とす (孤児 locale キーの所見と同時に 1 回で片付く)。復活時に必要な文言は git 履歴にある。より根本的には bridge が「MAIN world が実際に使うキー」だけを送るようにする案もあるが、v1 の規模では型から落とすだけで十分

### [medium] 掲載文の「4/8px グリッド」が実装 (4px 固定) と一致せず、同時提出のスクショ文言とも矛盾

- 状態: **✅ v0.4.10** / 観点: `cws-policy` / 反証: `CONFIRMED` / 実測
- 根拠: `STORE_LISTING.md:51 — 'spacing that falls outside a 4/8px grid is flagged'`
- 影響: 8px グリッド運用のデザインシステムを想定した利用者が「4px の値が野良値として出ない」ことを不具合と受け取る。掲載文と同梱スクショが同じ提出物内で食い違っており、審査での「説明と機能の不一致」指摘の材料にもなる。
- 再現: 実測: tokenLint.ts の定数と唯一の判定式を確認し、`grep -rn 'lintSpacing(' src entrypoints` で grid 引数を渡す呼び出しが無いことを確認。8px グリッド (例: padding 4px) は警告されない。
- 直し方: 掲載文 en:51 / ja:143 を '4px grid' / 『4px グリッド』に直す (実装表示と一致させる)。8px も見たいなら grid を設定化してから掲載文を広げる (issue 化)。

### [medium] 「fetch 発生箇所 0 件」の監査手順が src 限定 — 提出 zip には Vite の modulepreload polyfill 由来の `fetch(` が 1 件ある

- 状態: **✅ v0.4.14** (vite modulePreload polyfill を無効化して出荷 JS から除去 + check:submission と SECURITY.md に bundle 側 grep を追加) / 観点: `cws-policy` / 反証: `—` / 実測
- 根拠: `SECURITY.md:8-10 — 『fetch / XMLHttpRequest / WebSocket / sendBeacon / EventSource の発生箇所が 1 つも無いことを grep で再現証明できる』`
- 影響: 外部送信は実際に無いので申告は正しいが、こちらが指定した監査手順を zip に対して実行した第三者 (審査官・企業の IT) には『0 件』が再現しない。製品の最大の売り (送信経路ゼロ) の証明手順が、提示する成果物の上で崩れる。
- 再現: 実測: `unzip -p .output/domdom-inspector-0.4.7-chrome.zip chunks/popup-B21RLllI.js | grep -c 'fetch('` → 1。前後を読むと Vite の modulepreload polyfill (`link[rel=modulepreload]` の href を fetch = chrome-extension:// 内リソース) で外部送信ではない。ソース側 grep は確かに 0 件 (`grep -rniE 'fetch\(|XMLHttpRequest|WebSocket|sendBeacon|
- 直し方: 最短: wxt.config に `vite: () => ({ build: { modulePreload: { polyfill: false } } })` を足して polyfill を落とす (popup は minimum_chrome_version 119 なので不要)。合わせて SECURITY.md の監査手順に『zip 展開後の *.js にも同じ grep をかける』を追記し、残る場合の説明を書く。

### [medium] popup の既定表示が ja 604px で Chrome の action popup 上限 600px を超える (en は 592px で残り 8px)

- 状態: **✅ v0.4.14** (余白を圧縮し en 564px / ja 576px (実測)。e2e が ja の実文字列で 600px 未満を固定) / 観点: `i18n-quality` / 反証: `—` / 実測
- 根拠: `entrypoints/popup/index.html:56-57`
- 影響: 初回起動 = サイト未有効化 = まさに文言が一番多い状態で、ja だけポップアップ内スクロールが出て「全サイトで許可」の説明や下部のヘルプ導線が見切れる。en も余裕 8px しかないため、今後 1 行足すだけで両言語が超える (長さの回帰を検知する仕掛けが無い)。
- 再現: ビルド済み拡張を実 Chromium にロードし chrome-extension://<id>/popup.html を 420×900 で開き、locale を fetch して applyI18n と同じ差し替えを行い document.body.scrollHeight を実測 (初回状態 = サイト未有効化なので siteStatus と modeUnavailable が可視、details は閉じ)。結果: en 592px / ja 604px。最大の消費者は hintAllSites (両言語で 6 行 99px)。横溢れは en/ja とも 0 件 (body は 340p
- 直し方: hintAllSites を 2 行短縮する。実測で ja 604→588px / en 592→576px になり両言語が上限内に収まる。ja 案: 「多くのサイトを次々に検査するとき用です。Chrome は「すべてのサイトを読み取れる」と警告します (任意のページを検査する以上避けられません)。都度「現在のサイトで有効化」でも機能は同じです。解除は同じボタン。開いているタブは 1 回リロードしてください。」/ en 案: 'For inspecting many sites in a row. Chrome will warn that the extension can read all

### [medium] blob: タブで全サイト許可が無いとき「http/https 以外だから有効化できない」と誤った理由を出し、直下の解決策から遠ざける

- 状態: **✅ v0.4.14** (siteBlobNeedsAllSites キーを新設し「全サイト許可があれば使える」と正しい解決策を出す) / 観点: `i18n-quality` / 反証: `—` / 実測
- 根拠: `entrypoints/popup/main.ts:216-221`
- 影響: 実際には親が https で、同じ popup 内の直下にある「全サイトで許可(一度だけ)」を押せば executeScript 経路で有効化できる (main.ts:264-283 がその専用パスを持っている)。それを「このページでは無理」と断定するので、解決可能な状態でユーザーを諦めさせる。理由が誤りである点は inspector.ts:217-219 で確立した原則 (理由を実状態から選ぶ) の未適用箇所。
- 再現: blob:https://<origin>/<uuid> をトップレベルタブで開き (プレビューを新規タブで開く導線)、全サイト許可を与えていない状態で popup を開く。main.ts:196-208 で isBlobTab=true・siteOrigin=親の https origin が解決されているのに、:218-221 は btn.disabled=true にして siteUnavailable を出す。文言は en 'This page (non-http/https or unknown URL) can't be enabled.' / ja 「このページ(http/htt
- 直し方: 専用キーを 1 つ追加して撃ち分ける (i18n 3 箇所同期は不要 = popup 専用なので en/ja の 2 箇所)。en: 'This is a blob: preview of {origin}. Chrome cannot grant access to a blob: page by itself — use "Enable on all sites (once)" above, then press this button.' / ja: 「これは {origin} の blob: プレビューです。Chrome は blob: ページ単体に許可を出せません — 上の「全サイト

### [medium] トークン非準拠値の呼び方が掲載文・ヘルプ・UI で三者バラバラ (en: rogue / stray / off token / ≠ token、ja: 野良値 / 外れた値 / トークン外 / ベタ書き)

- 状態: **✅ v0.4.14** (en=rogue value / ja=野良値 に統一 (popup ヘルプ 3 箇所を修正。バッジの ≠ token 記号は幅の制約で維持)) / 観点: `i18n-quality` / 反証: `—` / 実測
- 根拠: `STORE_LISTING.md:51`
- 影響: 掲載文とヘルプで 'rogue value' / 「野良値」を学んだユーザーが、バッジで '≠ token' / 「≠ トークン」を見ても同じものだと結び付かない (v1 で可視な範囲だけでも用語が 1 つズレている)。加えて 'rogue value' は「野良値」の直訳で、英語圏のデザインシステム語彙では off-token / hardcoded / one-off が通用語なので、既定 en の掲載文としては不自然に読まれる。残り 4 通りは dormant なので今は害が無いが、カバレッジ画面を再配線した時点でそのまま出荷される。
- 再現: 全 en メッセージを機械走査した実測: 'rogue' はヘルプ本文 (index.html:271) の 1 箇所と掲載文 (STORE_LISTING.md:51) のみで、UI 文言には 0 箇所。UI が実際に出すのは tokenNear/tokenNone の '≠ token' と offGridWarn の '(not on the 4px grid)'。dormant なキーには 'stray' (hintTokens) / 'off token' (coverageOriginVarMiss, coverageOriginLiteralMiss) / 'literal' (
- 直し方: 用語表を今のうちに 1 つに決める。en = 'off-token value' に統一 (rogue / stray / literal miss を廃止)、ja = 「野良値」に統一 (外れた値 / トークン外 を廃止、「ベタ書き」は origin 軸の別概念なので残してよい)。バッジの '≠ token' / 「≠ トークン」は幅の制約があるので変えず、散文側で橋渡しする: index.html:271 → 'unmatched values are flagged as off-token (shown as ≠ token on the badge)' / ja 対応節 → 「一致し

### [medium] モードを一度も ON にしていなくても、MUI テーマ発見時に overlay をページ DOM へ注入してトーストを出す

- 状態: **✅ v0.4.14** (OFF 中は通知を保留し (DOM 注入もしない)、次の ON で 1 度だけ出す) / 観点: `performance` / 反証: `CONFIRMED` / 実測
- 根拠: `entrypoints/inspector.content.ts:105 (hookState.onCommit で常時購読。inspector.enabled を見ていない)`
- 影響: サイトを 1 度許可すれば以降そのドメインの全ページ読み込みで発火し、テーマ差し替え (ダーク切替等) ごとに再発する。ユーザーから見ると「何も押していないのに拡張が喋る」「サイト自身の通知と紛らわしい」挙動で、常駐型拡張として最も嫌われる型。全サイト許可モードだと被害範囲がブラウジング全体になる。
- 再現: node /private/tmp/claude-502/-Users-ai-dev-domdom-inspector/2fe7d5de-f034-43c7-9516-d64dd5a4ea8e/scratchpad/off-state.mjs (モードは一切 ON にしない)
  注入直後: overlayHosts=0 (ここは健全)
  合成 Fiber ツリーに MUI テーマ形の context 値を置いて commit → 2.3 秒後:
  overlayHosts=1 / 可視テキスト "MUI テーマを検出 — 色 1 件 / サイズ 28 件をトークンに追加"
  = 拡張が
- 直し方: トーストは inspector が有効なときだけ出す (テーマ辞書の更新自体は静かに続けてよい)。OFF 中に採用したテーマは「次に ON にしたとき 1 度だけ知らせる」に寄せる。ensureMounted まで遅延させれば OFF 中はページ DOM を一切触らない状態を維持できる (注入直後 overlayHosts=0 の健全さを壊さない)。

### [medium] ウィンドウ resize / ページズームで枠が旧サイズのまま残り、同じ要素の中でマウスを動かしても直らない

- 状態: **✅ v0.4.10** / 観点: `ux-breakage` / 反証: `CONFIRMED` / 実測
- 根拠: `src/inspector.ts:95-102 — enable が張るのは pointermove / click 系 / keydown / scroll のみ。resize リスナは無い (src・entrypoints に 'resize' の grep ヒット 0 件)`
- 影響: 「どの領域を測っているか」を示す枠が実寸と食い違う。スクロールは隠す実装があるのに resize/ズームは無処理なので、ウィンドウ幅を変えながらブレークポイントを見る使い方 (デザイナーの主用途) でズレが残る。値そのものは選択時点の要素のもので正しいので誤答ではないが、枠が指す領域が誤りになる。
- 再現: 実測 (probe1 [F1]-[F4])。900x700 で ON → 全幅の #a をホバー → 枠 width:900px。→ ビューポートを 500x700 に変更 (ウィンドウ幅を変える = Figma と横並びにする典型操作) → [F2] 枠は width:900px のまま (実際の #a は 500px: [F4] で実測) でビューポート外に 400px はみ出す。→ 同じ #a の中で (410,65) にマウスを動かす → [F3] やはり 900px のまま。別要素へカーソルを移すまで直らない。
- 直し方: enable/disable で `window.addEventListener('resize', this.onScroll, true)` を対に張る (onScroll は「一旦隠して次の pointermove で出し直す」処理なので resize にもそのまま使える。名前は hideUntilNextMove 等に変えるとよい)。併せて 159 行の早期 return を「同一要素でも rect が変わっていれば positionBox し直す」に緩めると、動かした時に追従する。

### [medium] ページからの不正 settings payload で計測が凍り、以後どこをホバーしても前の要素の値を出し続ける (tokens は検証済みなのに settings は素通し)

- 状態: **✅ v0.4.12** / 観点: `ux-breakage` / 反証: `—` / 実測
- 根拠: `entrypoints/inspector.content.ts:164-169 — settings 受信で applySettings (DEFAULT_SETTINGS と merge) を呼んだ直後に `overlay.updateSettings(data.payload)` で**生 payload を上書き**している。165 行の applySettings が既に src/inspector.ts:81-84 で merged 済みを overlay に渡しているので 166 行は不要かつ有害`
- 影響: MAIN world はページと同一信頼境界なので防御の主目的は権限昇格ではなく「誤答させられないこと」。空 payload を 1 回投げるだけで、以後ずっと別要素の色・余白を表示し続ける状態を外部から作れる (悪意なくても、同名の source 文字列を使う別スクリプトや将来の部分 payload 送信で同じ経路に入る)。BRIDGE_SOURCE は配布バンドル内の平文文字列。
- 再現: 実測 (probe1 [D1]-[D3])。ON にして #a をホバー (バッジ `<div> 背景色#c62828`) → ページ側 JS で `window.postMessage({source:'domdom-inspector-bridge',type:'settings',payload:{}},'*')` → 別要素 #b (青) にカーソルを移す → [D2] 枠・バッジは #a のまま (背景色#c62828 を表示し続ける)、[D3] pageerror に `TypeError: Cannot read properties of undefined (reading 
- 直し方: entrypoints/inspector.content.ts:166 の `overlay.updateSettings(data.payload)` を削除する (165 の applySettings が merged を配っている)。残すなら tokens と同様に payload を検証し、少なくとも `{...DEFAULT_SETTINGS, ...payload}` に正規化してから渡す。

### [medium] インスペクト中は ↑↓ が常に preventDefault され、ページのキーボードスクロールが死ぬ。しかもスクロール直後は ↑ が完全に無反応 (理由も出ない)

- 状態: **✅ v0.4.14** (選択なし/履歴なしはページへ返す + 編集要素・修飾キーは奪わない。unit で固定) / 観点: `ux-breakage` / 反証: `—` / 実測
- 根拠: `src/inspector.ts:242-247 — ArrowUp は preventDefault / stopImmediatePropagation を**先に**実行し、その後 `if (!this.currentElement) return;` で黙って抜ける (toast も無し)`
- 影響: 長いページを検査する主用途で、モード ON のまま矢印キーでスクロールできない (PageUp/Down・スペースは生きるので余計に気づきにくい)。加えて直近で潰した「押しても無反応」類型がここに残っている: スクロール直後の ↑ は何も起きず理由も言わない。
- 再現: 実測 (probe3 [3][4])。ON → #a をホバー → ホイールで 120px スクロール (scrollY=120) → ↑ を押す → scrollY は 120 のまま (ページスクロールを奪う) かつ枠もトーストも出ない (state: box=none, 新規トースト無し)。続けて ↓ も scrollY 120 のまま無反応。ホバーし直せば ↑ は親へ動くので、症状は「スクロール直後だけ死ぬ」。入力欄にフォーカスがある場合にキャレット移動を奪う点はコード上そう読めるが未計測。
- 直し方: preventDefault / stopImmediatePropagation を「実際に処理した時だけ」に移す (currentElement が無い・navStack が空なら素通しさせてページのスクロールを殺さない)。↑ を押したのに選択が無い場合は既存の strings.noOuterComponent とは別に「先に要素をホバーしてください」相当のトーストを出す。併せて `event.target` が入力要素なら早期 return する。

### [low] 半透明な computed 色のスウォッチがバッジ背景の上で合成され、実際とかけ離れた色に見える (ΔRGB=331)

- 状態: **✅ v0.4.14** (スウォッチを市松 (2 層背景) の上に描画) / 観点: `a11y-contrast` / 反証: `DOWNGRADED` / 実測 / finder の申告: high
- 根拠: `src/overlay.ts:209-214 — `// 色値は hex 文字列だけでは読めないため実色スウォッチを前置 (半透明もそのまま描画)` → `sw.style.background = p.value``
- 影響: MUI の `alpha()` 由来トークン (action.hover 0.04 / action.selected 0.08 / divider 0.12 等) は「青=MUI」を主対象に据えたこの製品で日常的に出る。明るいページで `rgba(0,0,0,0.04)` = 実際はほぼ白 (rgb 245) の色が、バッジではほぼ黒 (rgb 53) のチップとして描かれる。デザイナーがスウォッチを見て色を判断する導線なので視覚チャンネルでの誤答。blocker にしなかった根拠: 隣に生値テキストが出るので文字を読めば訂正できる。ただしその生値テキストが上記所見1で 3.17:1 なので
- 再現: 実 Chromium で OVERLAY_CSS を注入し、overlay.ts:206-214 と同じ chip (CSS 既定の inline-flex) 内に `.sw` を作って `style.background` に MUI が実際に使う半透明値を入れ、同じ値をページ実背景 (白 / #111111) の上に置いた比較ブロックと並べてピクセル実測。ページ白での結果 — `rgba(0,0,0,0.04)`: バッジ内 rgb(53,53,56) / ページ実際 rgb(245,245,245) Δ=331。`rgba(0,0,0,0.12)`: rgb(49,49,52) / rg
- 直し方: 半透明値のときだけスウォッチの下にチェッカーボードを敷いて「半透明であること」を伝える (`.sw { background-image: conic-gradient(#fff 0 25%, #999 0 50%, #fff 0 75%, #999 0) ; background-size: 6px 6px; }` を下地にし `background-color` を重ねる)。より正確にするなら要素の実背景 (祖先を辿った不透明な backdrop) の上に合成して見せる。少なくとも不透明値と同じ見え方で出すのをやめる。

### [low] SC 1.4.11 (非テキストコントラスト) が一度も検算されていない — popup の入力枠 1.36–1.41:1、toast ボタン枠 2.50:1

- 状態: **✅ v0.4.14** (--border-input (3:1) を新設し入力欄に適用 + toast ボタン枠 0.45。overlayContrast.test.ts が両テーマを検算) / 観点: `a11y-contrast` / 反証: `DOWNGRADED` / 実測 / finder の申告: medium
- 根拠: `entrypoints/popup/index.html:9 — AA 主張は「通常テキスト 4.5:1」だけで非テキスト (3:1) に言及なし`
- 影響: 「開発者向け」を開いたときのエディタ select / カスタム URL input / パスマッピング textarea は、枠も塗りも地とほぼ同輝度なので低視力ユーザーには入力欄の存在と範囲が見えない (可視ラベルはあるので免除の余地はあるが、3:1 を満たしていないのは確定)。overlay の「コピー」トーストボタンも枠 2.50:1 で押せる要素だと気づきにくく、これはエディタが開かなかったときの唯一の復帰導線。text 側だけを AA で管理し非テキスト側を見ていない、という抜けが構造。
- 再現: 実 Chromium で file:// から entrypoints/popup/index.html を開き、colorScheme=dark / light を切替えて `getComputedStyle` の borderTopColor / backgroundColor を読み、WCAG 式で比を計算。dark: 枠 rgb(42,47,61) vs 地 rgb(15,17,22) = **1.41:1**、塗り rgb(23,26,33) vs 地 = **1.08:1**。light: 枠 rgb(215,221,231) vs rgb(255,255,255) = **1.3
- 直し方: コントロール専用の境界トークンを切って `.section` の装飾区切りとは分ける (区切り線は薄くていい)。実測で 3:1 を満たす値: dark `#5f6884` (地 3.42:1 / 塗り 3.15:1)、light `#8b95ab` (地 3.01:1)。toast ボタンは `border` を `rgba(255,255,255,0.5)` にすると 4.86:1 / 5.31:1 (0.40 でも 3.65:1 / 3.83:1 で 3:1 は満たす)。

### [low] モードピルの ✕ ボタンの accessible name が "✕" — ローカライズ済みラベルが title に置かれ Chromium が SUPERSEDED 扱いにしている

- 状態: **✅ v0.4.14** (aria-label にローカライズ済みラベルを明示) / 観点: `a11y-contrast` / 反証: `DOWNGRADED` / 実測 / finder の申告: medium
- 根拠: `src/overlay.ts:118-119 — `const btn = el('button', undefined, '✕'); btn.title = closeLabel;``
- 影響: v1 で唯一到達可能な overlay のボタン (モードピルの閉じる) が、スクリーンリーダーには「✕ ボタン」としか読まれる。ローカライズした 'Exit inspect mode' / 'インスペクトモードを終了' は AT に一切届かない (WCAG 4.1.2)。Esc で代替できるので致命ではないが、v1 配線外の stats/tree では aria-label を付けてあるのに v1 で実際に使う 1 個だけ抜けている非対称。
- 再現: 実 Chromium で overlay.ts:114-125 と同じ構築 (button の textContent = '✕'、title = 'Exit inspect mode') を行い、CDP `Accessibility.getPartialAXTree` で計算済み accessible name とその source を取得。結果: `role=button accessibleName="✕"`、source 内訳 `contents="✕"` が採用され `attribute[title]="Exit inspect mode"` は **SUPERSEDED** と明示
- 直し方: src/overlay.ts:119 を `btn.setAttribute('aria-label', closeLabel)` に変える (title は hover ツールチップとして残してよい)。i18n 3 箇所同期は既存の `inspectPillClose` をそのまま使うので不要。

### [low] インスペクト中の ↑↓ が編集要素・修飾キーを問わず window capture で潰される — 同じファイルの pointer 経路にはあるガードが key 経路に無い

- 状態: **✅ v0.4.14** (isEditableTarget + 修飾キー除外 (medium の ↑↓ 対応と同時)) / 観点: `a11y-contrast` / 反証: `DOWNGRADED` / 実測 / finder の申告: medium
- 根拠: `src/inspector.ts:101 — `window.addEventListener('keydown', this.onKeyDown, true)` (capture)`
- 影響: インスペクト中はページ側の textarea / select / listbox / combobox / コードエディタ (Monaco, CodeMirror) で ↑↓ のキャレット移動・選択移動が効かない。`stopImmediatePropagation` を window capture で撃つのでページ側ハンドラも道連れ。Shift+↑ (行選択) や Cmd+↓ (末尾へ) といった修飾キー付きも同じく親コンポーネント移動に化ける。↑↓ をモードキーにするのはヘルプに書いてある意図的挙動なので、欠陥は「編集可能な対象への例外がない」点に限定される。Esc で復帰できる。
- 再現: grep による不在証明: `grep -n 'contentEditable|isContentEditable|INPUT|TEXTAREA|closest(|altKey|metaKey|ctrlKey|shiftKey|event.target' src/inspector.ts` は 141/166/167/176/181 (すべて pointer 経路) にしかヒットせず、242-266 の onKeyDown 内には 1 件も無い。実ブラウザでの挙動再現 (テキストエリアにフォーカスして ↑↓ を押す) は**未確認** — 拡張のロードを伴うため。コードの事実 (ガード不在) 
- 直し方: onKeyDown の先頭に (a) 修飾キー付きは素通し (`if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;`)、(b) 編集可能・自前でキーを扱う対象は素通し (`const t = event.target; if (t instanceof HTMLElement && (t.isContentEditable || t.closest('input, textarea, select, [role="listbox"], [role="combobox"], [role="me

### [low] overlay の owner パネルがキーボード到達不能、トーストが AT に届かない (role/aria-live 無し・9 秒で消える)

- 状態: **✅ v0.4.14** (jumpable 行を tabindex=0 + role=button + Enter/Space 対応、トーストに role=status + aria-live=polite) / 観点: `a11y-contrast` / 反証: `DOWNGRADED` / 実測 / finder の申告: medium
- 根拠: `src/overlay.ts:300-320 — owner 行は `el('div', 'row')` に `row.addEventListener('click', ...)` のみ。tabindex / role="button" / keydown ハンドラ無し`
- 影響: Alt+Click の描画元リストは行クリックでエディタへ飛ぶ唯一の導線だが div + click なのでキーボードから起動できない (SC 2.1.1)。トーストは「エディタに送った先」「production セーフモード」「MUI テーマ検出」「グリッド外警告」などの全フィードバック経路なのに live region ではないので AT には何も通知されない。操作可能トーストのボタンは closed shadow DOM 内で Tab 順の最後尾にあり、しかも 9 秒で消えるため実質キーボードでは押せない。製品全体がホバー主体なので前提として視覚・ポインタ依存だが、パネルとトーストは既存
- 再現: コード読解 + grep。`grep -n 'aria|role=|setAttribute|tabIndex|tabindex' src/overlay.ts` のヒットは 368 (data-domdom-editor)、478/479/492 (stats)、614 (readonly)、670/671/677 (tree) のみ。v1 で到達可能な panel / toast / badge には 1 件も無い。実 AT (VoiceOver) での読み上げ確認は未確認。
- 直し方: (1) owner 行を `el('button', 'row')` にして `all: unset` 系のスタイル調整 + Enter/Space を native に任せる、または `tabindex="0"` + `role="button"` + keydown。(2) panel に `role="dialog"` + `aria-label`(既存 `ownerPanelTitle`) を付ける。(3) toast のコンテナに `role="status"` `aria-live="polite"` を 1 度だけ設定 (overlay.ts:92 の生成時)。(4) toast

### [low] コード内コントラスト値のコメントが実測と不一致 (4.6:1 と書いて実測 5.30:1) — 数値を機械検証する仕組みが 0 件

- 状態: **✅ v0.4.14** (コメントの数値を撤去し「テストが計算する」に置換 (overlayContrast.test.ts)) / 観点: `a11y-contrast` / 反証: `CONFIRMED` / 実測
- 根拠: `entrypoints/popup/index.html:41 — `--accent-bg: #1668d4;  /* ライトでは濃青地 + 白文字 (4.6:1) */``
- 影響: 実際の値はコメントより良いのでユーザー被害は無い。ただし数値が一度も検算されていない証拠であり、これが所見1 (overlay の 3.17:1) と所見3 (非テキスト 1.36:1) を通した根本原因。CLAUDE.md のコミット前ゲート (lint/test/typecheck/build) にコントラストの門が無いため、次にトークンを触ったときも同じ形で破れる。
- 再現: `grep -rln 'contrast|wcag|WCAG|luminance|axe' src/ e2e/ scripts/` → **ヒット 0 件**。コントラスト比を守るテストもリンタも存在しない。実測は python の WCAG 相対輝度実装 + 実 Chromium の computed style で行い、#ffffff on #1668d4 = **5.30:1** (コメントの 4.6:1 と不一致)、#0b1220 on #8ec2ff = 10.08:1。
- 直し方: コメントの 4.6:1 を 5.30:1 に直す。加えて WCAG 相対輝度を実装した純関数 + トークン表を vitest に置き、`(fg, bg, 必要比)` の表を回帰テストにする (Fiber も DOM も要らないので既存の純ロジックテスト方針にそのまま乗る)。overlay の合成色 (rgba 重ね) は既存の e2e (実 Chrome) 側でピクセル実測する分担が適切 — happy-dom では合成できない。

### [low] popup に到達不能な CSS が 20 セレクタ以上残っている (.cov-* / .ai-badge / .q / #coverageTop / .help code など)

- 状態: **✅ v0.4.14** (.cov-*/.ai-badge/#coverageTop/.q/.hc-* と --hc-* 変数を削除 (再導入時は git から)) / 観点: `a11y-contrast` / 反証: `CONFIRMED` / 実測
- 根拠: `entrypoints/popup/index.html:123-128 — `.q` (「tabindex 0 でキーボードからも読める」というコメント付きだが markup に `class="q"` が無い)`
- 影響: 審査もユーザー体験も止めない。ただし (a) 提出パッケージに v1 で外した機能 (カバレッジ / AI 監査) の痕跡が残る、(b) `.q` は「ⓘ でキーボードから設定の意味が読める」という**実在しない a11y 配慮**をコメントで主張している、(c) `.hint` 内の `<code>from=to</code>` は意図されたチップ装飾 (背景 + 角丸) が当たらず素のテキストで出る (可読性自体は 8.18:1 / 6.60:1 で問題なし)。次に a11y を見る人が「ⓘ があるはず」と誤解する。
- 再現: body 部 (178-301 行) の `class=` 属性を実際に列挙: `hint`(9) `section`(4) `secondary`(2) `legend lg-third`(2) `legend lg-mui`(2) `legend lg-custom`(2) `help`(2) の 7 種だけ。CSS 部 (54-176 行) が宣言するクラス/ID セレクタは 26 種。差分がそのまま死んでいる。`grep -c 'createElement|innerHTML' entrypoints/popup/main.ts` = **0** なので TS 側が動的に付けている可能
- 直し方: v1 で使わないセレクタと `--hc-*` トークンを削除 (issue #10/#11/#12 で再導入するときに戻す)。残すなら `/* v1 未配線 — issue #10 で復帰 */` と明記して「実装済みの a11y 配慮」と読み違えられないようにする。`.help code` は `.hint code, .help code` に広げれば 233 行の `<code>` が意図どおり装飾される。

### [low] 成果物に fetch( が 1 件ある (Vite の modulePreload polyfill)。PRIVACY.md「ネットワークリクエストを 1 つも発行しない」と grep 上で衝突する

- 状態: **✅ v0.4.14** (modulePreload polyfill 無効化で除去。check:submission が出荷 JS を毎回 grep) / 観点: `bundle` / 反証: `—` / 実測
- 根拠: `.output/chrome-mv3/chunks/popup-B21RLllI.js:1 — `function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}` (Vite の modulepreload polyfill)`
- 影響: 実行されないので機能・プライバシーの実害はゼロ。ただし審査官が提出 zip に `fetch(` を grep すると 1 件当たり、その隣で PRIVACY.md が「1 つも発行しない」と言っている。自前のチェックがこの 1 件を見ていない (src だけ grep している) ので、申告の根拠が成果物では測られていない
- 再現: 実測済み。`grep -ro 'fetch(' .output/chrome-mv3` = 1 件 (chunks/popup-B21RLllI.js)。src/entrypoints 側は submission-check と同条件の grep で 0 件。実行されないことも確認: polyfill 冒頭が `let e=document.createElement('link').relList; if(e&&e.supports&&e.supports('modulepreload'))return;` で、Chrome (min 119) は modulepreload を suppo
- 直し方: wxt.config.ts に `vite: () => ({ build: { modulePreload: { polyfill: false } } })` を足して polyfill を落とす (成果物の fetch( が 0 件になる)。併せて scripts/submission-check.mjs:118-129 の送信 API grep を `.output/chrome-mv3` に対しても走らせる (fetch(/XMLHttpRequest/WebSocket/sendBeacon/EventSource/eval(/new Function/importScripts)

### [low] 到達不能コードを守るテストが 295 件中 112 件 (38%) あり、v1 の品質根拠として数えられる形になっている

- 状態: **判断済み (修正しない)** — テストは温存実装 (issue #4/#5/#10-13 で再導入予定) の回帰を守る資産として意図的に残す。「v1 の品質根拠」として件数を文書に書かないことは store-submission-readiness から数字を全廃して担保した
- 根拠: ``pnpm test` 実測 = 26 files / 295 tests。うち到達不能モジュール: coverage.test.ts 26 / tree.test.ts 16 / renderCause.test.ts 14 / renderTracker.test.ts 12 / aiProviders.test.ts 9 / designScan.test.ts 8 / vitals.test.ts 8 / aiPrompt.test.ts 7 / recordKey.test.ts 6 / report.test.ts 5 / aiCost.test.ts 1 = 112 件`
- 影響: 「295 tests green」を v1 の担保として読むと 38% が誰も到達できないコードの担保。温存の方針自体は正しい (issue #10-#13 で戻すときに壊れていないことを保証する) が、v1 の gate と温存コードの gate が同じ数字に混ざっているため、今回の「配線が切れているのに緑」を誰も疑わなかった
- 再現: 実測済み。`pnpm test` の per-file 件数を集計。到達可能性は値 import のみを辿るスクリプトで機械計算し、grep (buildTree / summarizeTimeline / largest-contentful-paint / longtask / PerformanceObserver / api.openai.com / generativelanguage = 全て成果物 0 件) と実験ビルド差分で裏を取った
- 直し方: 温存コードのテストは消さない。vitest の名前空間で分ける (例 `describe('[dormant] …')` か `src/dormant/` へ移す) か、README/CLAUDE.md に「v1 実配線を守るのは 183 件、温存コードが 112 件」と内訳を書く。加えて submission-check.mjs に 2 項目を足すと再発しない: ①_locales の孤児キーが 0 件、②成果物に到達不能モジュールの特徴文字列 (.stats/.rctl/.tree セレクタ、'Component tree'、'Re-render ranking') が 0 件

### [low] PUBLISHING.md §4-2 の単一目的「要旨」に配線外しの『ページ全体の集計』が残り、readiness の「四者同一 ✅」が成立していない

- 状態: **✅ v0.4.14** (要旨を確定文言 (要素単位のみ) に揃え、集計が v1 に無いことを注記) / 観点: `cws-policy` / 反証: `DOWNGRADED` / 実測 / finder の申告: medium
- 根拠: `PUBLISHING.md:186-188 — 『…ユーザーのデザイントークンと要素単位およびページ全体の集計で突合する。』`
- 影響: 単一目的の申告が実装より広くなると、2026-08-01 施行の「開示済み単一目的に厳密に必要な範囲」ルールに対して自ら齟齬を作る。また readiness 判定書の ✅ が機械確認でなく実際には不一致なので、提出前チェックが機能していない。
- 再現: 実測: 4 ファイルの単一目的文を並べて比較。PUBLISHING.md §4-2 のみ『ページ全体の集計』を含み、:208-209 は文として壊れている。ダッシュボード入力は §4-2 を手順書として使う運用 (PUBLISHING.md:329 の対応表) なので、operator が要旨側を貼ると申告が実装より広くなる。
- 直し方: PUBLISHING.md:186-188 の要旨から『およびページ全体の集計』を削除し STORE_LISTING の英文と同義にする。:208-209 の破損文を『保存するのは端末内の利用者設定のみ』に直す。readiness の『四者同一』は目視主張をやめ、scripts/submission-check.mjs に 4 ファイルの単一目的文の差分チェックを足して機械化する。

### [low] 詳細説明の Markdown 強調 `**…**` が CWS のプレーンテキスト欄でアスタリスクとして表示される

- 状態: **✅ v0.4.14** (en/ja の説明文コードブロックから ** を除去) / 観点: `cws-policy` / 反証: `CONFIRMED` / 実測
- 根拠: `STORE_LISTING.md:76 — 説明本文 (貼り付け用コードブロック内) に '- **Nothing is sent anywhere.** The extension has no backend…'`
- 影響: Public 掲載で最も目に付く箇所の表記崩れ。ポリシー違反ではないが、掲載文の品質が審査対象になる版で不要な減点材料。
- 再現: 実測: 該当行が掲載用コードブロックの内側にあることを確認。CWS の Description 欄は Markdown を解釈しないので、貼るとアスタリスクがそのまま出る。
- 直し方: 掲載用ブロック内の `**…**` を外す (見出しの大文字体裁は維持して問題ない)。

### [low] 公開するプライバシーポリシーの権限一覧が contextMenus を落としている (en/ja 両方)

- 状態: **✅ v0.4.14** (en/ja 両方に追記 (追加のページアクセス権は生じない旨も)) / 観点: `i18n-quality` / 反証: `DOWNGRADED` / 実測 / finder の申告: medium
- 根拠: `PRIVACY.md:47-56`
- 影響: CWS に提出するプライバシーポリシー URL の中身が、要求している権限の 1 つを説明していない。en/ja の食い違いではなく両方の欠落なので、審査で権限一覧と突き合わされたときに「開示漏れ」として照会されうる。実害は無い権限 (右クリック項目の追加のみ) なので、書けば済む。
- 再現: manifest の permissions は [storage, activeTab, scripting, contextMenus] の 4 つ。PRIVACY.md の '## Permissions' (:47) と '## 権限' (:112) はいずれも storage / activeTab / scripting / ホストアクセスの 4 項目で、contextMenus が無い。STORE_LISTING.md:87 の justification には contextMenus がある。
- 直し方: PRIVACY.md:47 の en リストに '- `contextMenus` — to add "Inspect this element" / "Open this element's source in my editor" to the right-click menu. It grants no additional access to pages.' を、:112 の ja に「- `contextMenus` — 右クリックメニューに「この要素を検査」「この要素のソースをエディタで開く」を追加するため。ページへの追加のアクセス権は生じません。」を追加する。

### [low] en の細部: 引用符スタイル混在 / 単複非対応で「1 colors」が出る / 「13/5px」と読める警告 / 直書きフォールバック 3 箇所が locale と別文

- 状態: **✅ 一部 v0.4.14** (引用符を \" に統一 / 「1 colors」は形式変更で解消 / 「13/5px」は 13px / 5px に。残りは可視文言に無し) / 観点: `i18n-quality` / 反証: `—` / 実測
- 根拠: `public/_locales/en/messages.json:56-58`
- 影響: (a)(b)(c) はいずれも既定言語である en の仕上がりの品質。Public は掲載文とスクリーンショットが審査対象で、UI の粗さは印象に効く。(c) は複数値の余白で「どの値が px か」を一瞬迷わせる (実測で必ず起きる)。(d) は将来の文言修正が locale だけに入って HTML 側が取り残される温床。
- 再現: (a) 引用符を機械走査すると、20 キー中 18 キーが直線引用符 (element's/can't/"Enable on current site") なのに ctxOpenInEditor:57 だけカーリー ’、hintTarget:213 だけカーリー “ ”。前者はユーザーに見える右クリック項目。(b) themeTokensLoaded:429 は 'MUI theme detected — {colors} colors / {sizes} sizes added as tokens' で単複の切り替えが無い (Chrome i18n に複数形機能は無い)。件数 1 の到達性は
- 直し方: (a) ctxOpenInEditor:57 を 'Open this element's source in my editor' (直線)、hintTarget:213 を \"Use on this site\" (直線) に揃える。(b) types.ts:305 / en:429 を 'MUI theme detected — tokens added: {colors} colors, {sizes} sizes' のように数と名詞を切り離す (ja は現状「色 {colors} 件 / サイズ {sizes} 件」で問題なし)。(c) overlay.ts:255 を f.off

### [low] ja の細部: editorHint だけ「Click」が英語のまま + で重複、可視文言と dormant 文言で敬体/常体が分かれている

- 状態: **✅ 一部 v0.4.14** (editorHint を「⌘/Ctrl+クリックでエディタを開く」に。dormant キーの敬体/常体は到達不能のため対応しない (再導入時に直す)) / 観点: `i18n-quality` / 反証: `—` / 実測
- 根拠: `public/_locales/ja/messages.json:254-256`
- 影響: 同一機能の同一操作が数秒差で「クリック」と「Click」で提示される。文体の割れは今は dormant 側だけなので可視の害は無いが、表示設定やツールチップを再配線した時点で敬体と常体が同じ popup に並ぶ。「検査」と「インスペクト」の併用 (inspectOn の 1 文に両方) は、モード名=インスペクト・動作=検査の使い分けとして読めるため実害は薄いと判断した (無理に統一する必要は無い)。
- 再現: editorHint (ja:255) = 「⌘/Ctrl+Click でエディタで開く」。同じセッションで先に出る inspectOn (ja:228) は「⌘/Ctrl+クリック: エディタで開く」、hintEditorUsage (ja:571) も「⌘/Ctrl+クリック」。つまりトーストは「クリック」、その直後にホバーしたバッジの file 行は「Click」で、修飾キー記法も掲載文 (STORE_LISTING.md:157) では「Cmd/Ctrl+クリック」と 3 通りある。editorHint は「Click で」+「エディタで開く」で助詞「で」が重複。文体は、v1 で可視な
- 直し方: ja:255 を 「⌘/Ctrl+クリックでエディタを開く」に (「Click」を排し「で」の重複も解消)。修飾キー記法は「⌘/Ctrl+クリック」を UI の唯一形とし、掲載文だけ絵文字なしの「Cmd/Ctrl+クリック」を許すと決めて STORE_LISTING に注記する。dormant な tip* は再配線より前に敬体へ寄せておく (例 :198 → 「要素クリックでソース位置をエディタで開きます。開発ビルド専用です — 本番サイト(公開ビルド)ではコード位置が取れないため効果がありません。」)。

### [low] 世界公開を en/ja だけで出すのは妥当 (機能欠損は無い)。追加するなら UI 文言限定で、権限・プライバシー文は en 据え置きにすべき

- 状態: **判断済み (修正しない)** — 助言であり欠陥ではない。追加言語は UI 文言限定・権限/プライバシー文は en 据え置き、という方針をそのまま採用する
- 根拠: `wxt.config.ts:7`
- 影響: 現状の en/ja のままで Public 全地域に出して問題は無い。追加言語の費用対効果は「popup の 19 ラベル + overlay の約 30 文言」で済むので低いが、翻訳者不在で機械翻訳を入れると危険な箇所が特定できる: hintAllSites (Chrome の全サイト警告の意味と「都度許可でも機能は同じ」という代替提示)、hintEditorUsage (開発ビルド限定という制約)、PRIVACY.md 全体。ここを誤訳すると権限の意味とプライバシー上の約束が言語ごとに変わり、審査でも信頼でも損になる (en が正であることを担保できない)。
- 再現: default_locale: en (wxt.config.ts:7) なので ja 以外の全ロケールは en にフォールバックし、機能欠損は生じない。popup のヘルプ本文は main.ts:27-31 で getUILanguage().startsWith('ja') の二値判定なので、非 ja は必ず en 本文が出る (欠落しない)。翻訳品質の実測: ja 196 キー中、en と同一なのは extName (ブランド名) の 1 件のみ、CJK を 1 文字も含まない ja エントリは 0 件 = ja は全訳済み。PRIVACY.md は en + ja の二本立てで公開でき
- 直し方: v1 は en/ja で出す。追加は v1 後に 1 言語 1 PR で、優先は Chrome の利用者規模と開発者ツール需要から pt-BR → es-419 → zh-CN → de → fr → ko。運用ルールを 3 つ決める: (1) 翻訳対象は UI ラベルと短い hint に限り、hintAllSites・hintEditorUsage・PRIVACY.md は翻訳せず en を出す (CWS は掲載文の言語を強制しない)、(2) 機械翻訳を初稿にするのは可、ただしネイティブ 1 名のレビューを PR の必須条件にする、(3) 追加ロケールも i18n.test.ts のキー集合

### [low] roots Set を刈らないので unmount 済み FiberRoot を GC 不能に保持し、2 秒ごとのテーマ探索コストが root 数に比例して増える

- 状態: **✅ v0.4.14** (findMuiTheme が isConnected===false の root を捨てる。unit で固定) / 観点: `performance` / 反証: `DOWNGRADED` / 実測 / finder の申告: medium
- 根拠: `src/hook.ts:41-51 (notifyCommit が state.roots.add(root) するだけ。削除経路が無い)`
- 影響: createRoot/unmount を繰り返す環境 (Storybook のストーリー切替、HMR、ウィジェット単位の root 生成) では、拡張が有効な間ずっと detached な fiber/DOM グラフが解放されず、同時に「モード OFF でも 2 秒ごとに走る探索」が root 数に比例して重くなる。MUI テーマが見つからないページ (= 非 MUI の React アプリ) は毎回全 root を最後まで舐めるので最悪ケースに当たる。実 React の unmount 後にどれだけのグラフが root から到達可能かはアプリ依存 (未計測)。
- 再現: 1) 保持の確定 (WeakRef + 実 gc): node /private/tmp/claude-502/-Users-ai-dev-domdom-inspector/2fe7d5de-f034-43c7-9516-d64dd5a4ea8e/scratchpad/roots-leak.mjs (--js-flags=--expose-gc)
   hook.onCommitFiberRoot に渡した root → onCommitFiberUnmount 後に参照を捨てて gc 5 回でも hookRootRetained=true。hook に渡していない同型オブジェクトは cont
- 直し方: roots を WeakSet 相当にするか、onCommitFiberUnmount / 探索時に root.current が null もしくは containerInfo が document から切れている root を落とす。加えて findMuiTheme に「全 root 合計の訪問上限」を入れ、1 root あたり 5000 × root 数 で伸びないようにする。テーマ採用後は探索自体を止める (現状は signature 一致でも毎回フル走査してから捨てている: entrypoints/inspector.content.ts:86-96)。

### [low] ページ側が overlay ホストを外すと、モードは ON のままモードピル (マウスでの終了導線) だけが消える

- 状態: **✅ v0.4.14** (ピル状態を保持し再マウント時に復元。e2e が host 除去 → 復元を固定) / 観点: `ux-breakage` / 反証: `—` / 実測
- 根拠: `src/overlay.ts:80-111 — ensureMounted は `host?.isConnected` が false なら host と全サーフェスを作り直す (pill も空の新規要素になる)`
- 影響: マウスだけで終了する導線 (ST-5 として意図的に用意したもの) が消え、Esc かショートカットを知らない利用者は「クリックが効かないページ」に取り残される。トリガは限定的 (ページが documentElement の未知要素を掃除する場合) なので実発生頻度は低い。
- 再現: 実測 (probe4 [1]-[3])。ON → ホバーして pill 表示を確認 (`インスペクト中 — Esc で終了 ✕`) → ページ側 JS で `document.querySelector('domdom-inspector-overlay').remove()` (documentElement を掃除するページ・他拡張相当) → 別要素をホバー → overlay は再マウントされて枠は出る ([2] box=block) が pill は `on` クラスなし・中身空。[3] クリックは依然握り潰されており (カウンタ 0) モードは ON のまま。
- 直し方: ensureMounted が新規マウントした時に、直近の pill 引数 (label/closeLabel/onClose) を Overlay 側で覚えて再構築する。もしくは Inspector が enable 中フラグを持ち、show/toast の後に `if (this.enabled) this.overlay.showModePill(...)` を再要求する (showModePill は冪等)。

### [missed] [medium] ハイライト枠の分類色が明るいページで 3:1 未達 (SC 1.4.11) + 分類が色相のみ (SC 1.4.1) — この製品の第一出力を finder は測っていない。src/overlay.ts:143-152 p

- 状態: **✅ 一部 v0.4.14** (既定 3 色を 3:1 以上に変更 (テストで機械検証) + バッジ名は白文字 + 色ドットに分離。色相のみの分類伝達 (1.4.1) は issue #18) / 観点: `a11y-contrast (missed)` / 反証: `MISSED` / —
- 影響: [medium] ハイライト枠の分類色が明るいページで 3:1 未達 (SC 1.4.11) + 分類が色相のみ (SC 1.4.1) — この製品の第一出力を finder は測っていない。src/overlay.ts:143-152 positionBox が borderColor に分類色を直接入れる。既定は src/types.ts:118-121 の mui #2196f3 / custom #4caf50 / thirdParty #9e9e9e。実 Chromium で 2px 枠を描いてピクセル採取 + WCAG 式で実測: 白ページ 3.12 / 2.78 / 2.68、MUI 既定の grey 地 #f5f5f5 では 2.87 / 2.55 / 2.46 → **明るいページでは 3 色すべて 3:1 未達**(暗ページは 6.04 / 6.79 / 7.05 で問

### [missed] [medium] popup ヘルプが「存在しない貼り付け欄」に JSON を貼れと指示している (直近潰したはずの『存在しない機能の宣言』の再発) — entrypoints/popup/index.html:269 "Design to

- 状態: **✅ v0.4.10** (ヘルプ本文を v1 実態 (自動検出のみ) に書き換え済み。現 index.html に貼り付けの記述ゼロを確認) / 観点: `a11y-contrast (missed)` / 反証: `MISSED` / —
- 影響: [medium] popup ヘルプが「存在しない貼り付け欄」に JSON を貼れと指示している (直近潰したはずの『存在しない機能の宣言』の再発) — entrypoints/popup/index.html:269 "Design tokens: paste your Figma Variables / W3C / Tokens Studio JSON above." / :291-292「上の欄に Figma Variables / W3C / Tokens Studio の JSON を貼り付けると」/ :264 "your pasted design tokens" / :286「貼り付けたデザイントークンと照合した名前が併記されます」。しかし貼り付け UI は v1 で外してある (entrypoints/popup/main.ts:57-59「トークン JSON 貼り付けは 

### [missed] [low] entrypoints/popup/main.ts:35 の内部コメント「render/tree は issue #4/#5 で再配線済み」が v1 スコープ (tree/render は配線外し = 到達不能) と矛盾する。ユ

- 状態: **✅ v0.4.14** (コメントを v1 実態 (配線外し) に修正) / 観点: `a11y-contrast (missed)` / 反証: `MISSED` / —
- 影響: [low] entrypoints/popup/main.ts:35 の内部コメント「render/tree は issue #4/#5 で再配線済み」が v1 スコープ (tree/render は配線外し = 到達不能) と矛盾する。ユーザー可視ではないが、次に触る人が到達可能だと誤解して 4 点配線の復活手順 (CLAUDE.md 地雷3) を飛ばす risk がある。

### [missed] **[blocker 級 / 実測] バッジが「由来でない CSS 変数名を由来として表示する」— この製品が Tier2 を却下した理由そのものが Tier1 の中で起きている。** 実 Chromium + 実拡張 (.output/c

- 状態: **✅ v0.4.11** (cssVars の @layer/specificity 修正 (compareCascade) で解消済み。監査と同じ「同値でレイヤ内が高 specificity」の形を e2e (badge.spec の #samecolor) に追加し、比較器を壊すと落ちることを確認) / 観点: `bundle (missed)` / 反証: `MISSED` / —
- 影響: **[blocker 級 / 実測] バッジが「由来でない CSS 変数名を由来として表示する」— この製品が Tier2 を却下した理由そのものが Tier1 の中で起きている。** 実 Chromium + 実拡張 (.output/chrome-mv3) + localhost fixture で計測した実際のバッジ描画: (a) `@layer base { .a.b { color: var(--wrong-color) } }` と非レイヤの `.only { color: rgb(0,128,0) }` を両方当てた要素 → ground truth `getComputedStyle().color = rgb(0,128,0)` (非レイヤ宣言が全レイヤに勝つ) なのに、バッジは `文字色 --wrong-color = #008000` と描画。--wrong-colo

### [missed] **[medium / 実測] ホバー状態の値を「その要素のデザイン値」として無警告で表示する。** 同じ実拡張プローブで `.btn { color: var(--rest); padding: 8px } .btn:hover { co

- 状態: **✅ v0.4.14** (popup ヘルプに「:hover の値を測っている」注意を明記 (en/ja)。監査自身の推奨する最小手当て。hover 抑制した再計測は将来課題) / 観点: `bundle (missed)` / 反証: `MISSED` / —
- 影響: **[medium / 実測] ホバー状態の値を「その要素のデザイン値」として無警告で表示する。** 同じ実拡張プローブで `.btn { color: var(--rest); padding: 8px } .btn:hover { color: var(--hov); padding: 12px }` を計測 → バッジは `文字色 --hov = #c8c8c8` / `内余白 12px`。インスペクトはホバーで起動するので `:hover` 宣言が常に cascade に参加し、**対話要素では常時 hover バリアントの値しか見えない**。computed style と一致するので誤りではないが、「このボタンは正しい余白トークンを使っているか」を確かめる用途では静かに別の答えを返す。頻度はボタン/リンクの 100%。最小の手当ては popup ヘルプ 1 行の明示 (現在の 

### [missed] **[low / finder の measured 主張の反証] finder は「probe の spec ファイルは削除済みで git status は clean・git diff は空」と書いているが、実際の repo には pr

- 状態: **判断済み (修正しない)** — finder の自己申告の反証記録であり、製品の欠陥ではない (作業手順の教訓として本文を保持)
- 影響: **[low / finder の measured 主張の反証] finder は「probe の spec ファイルは削除済みで git status は clean・git diff は空」と書いているが、実際の repo には probe の残骸が置かれたままだった**: ルートに `__ph.mjs` `__ph2.mjs` `__ds.mjs`、さらに `src/__drift.test.ts` (07:48 作成、untracked)。後者は `console.log` を含み `pnpm test` に載って実走する (私の実行で 295 → 296 tests になった原因)。CLAUDE.md のコミット前ゲートは `pnpm lint` で no-console を機械強制しているので、これを取り込むとゲートが落ちる。出荷物 (.output → zip) には入らな

### [missed] **@layer / :where を無視した近似 specificity が「由来でない CSS 変数名」を提示する (medium, 実 Chromium で実測)** — 看板機能そのものの誤答。src/cssVars.ts:129-

- 状態: **✅ v0.4.11** / 観点: `cws-policy (missed)` / 反証: `MISSED` / —
- 影響: **@layer / :where を無視した近似 specificity が「由来でない CSS 変数名」を提示する (medium, 実 Chromium で実測)** — 看板機能そのものの誤答。src/cssVars.ts:129-167 winningValue は候補を (important, specificity, source order) で並べるだけで、@layer の優先度を一切扱わない (:112-125 は CSSLayerBlockRule を media/conditionText 無しの grouping rule として素通しし、レイヤー所属の情報を捨てる)。実測: Chromium (playwright) で `:root{--new:24px;--legacy:4px} .card{padding:var(--new)} @layer base{.

### [missed] **提出判定書が旧版 (v0.4.7) の zip をアップロードさせる手順になっている (medium, 実測)** — docs/store-submission-readiness.md:3『対象版: v0.4.7』/ :37 / :

- 状態: **✅ v0.4.10** / 観点: `cws-policy (missed)` / 反証: `MISSED` / —
- 影響: **提出判定書が旧版 (v0.4.7) の zip をアップロードさせる手順になっている (medium, 実測)** — docs/store-submission-readiness.md:3『対象版: v0.4.7』/ :37 / :44 / :123『.output/domdom-inspector-0.4.7-chrome.zip をアップロード』。しかし package.json は 0.4.9 で、.output には 0.4.0/0.4.4/0.4.6/0.4.7/0.4.8/0.4.9 の 6 個が並んでいる (pnpm check:submission が『△ .output に旧版の zip が残っている 6 個』と実測)。文面どおりに操作すると 22 コミット分古いビルドを提出する。同じ文書の :16-18 が『古い判定書は旧 zip をアップロードする事故を生む』

### [missed] **PRIVACY.md に単一目的の記述が存在しない (low, 実測)** — grep '単一目的|Single purpose|single purpose' の結果は SECURITY.md:82 のみ。docs/store-su

- 状態: **✅ v0.4.14** (en/ja 両方に Single purpose 段落を追加) / 観点: `cws-policy (missed)` / 反証: `MISSED` / —
- 影響: **PRIVACY.md に単一目的の記述が存在しない (low, 実測)** — grep '単一目的|Single purpose|single purpose' の結果は SECURITY.md:82 のみ。docs/store-submission-readiness.md:45 が『✅ 単一目的の四者同一 STORE_LISTING.md / PUBLISHING.md §4-2 / PRIVACY.md / SECURITY.md』と主張しているが、4 者のうち 1 者は比較対象の文を持っていない。finder の finding 7 は『§4-2 だけが広い』と書いていて、この構造的な欠落には触れていない。

### [missed] 【出荷 js に fetch( が 1 件残っており「送信経路ゼロ、grep で再現可能」という申告が出荷物に対しては成立しない】 severity: low。STORE_LISTING.md:110-111 と docs/store-su

- 状態: **✅ v0.4.14** (modulePreload polyfill 無効化 + check:submission の出荷 JS grep) / 観点: `i18n-quality (missed)` / 反証: `MISSED` / —
- 影響: 【出荷 js に fetch( が 1 件残っており「送信経路ゼロ、grep で再現可能」という申告が出荷物に対しては成立しない】 severity: low。STORE_LISTING.md:110-111 と docs/store-submission-readiness.md:62 は「送信経路 **ゼロ** — fetch/XHR/WebSocket/beacon の発生箇所が 0 件 (grep で再現可能)」と申告し、Data usage は全カテゴリ「収集しない」+「ネットワークリクエストを一切行わない」。しかし出荷物を自分で grep すると .output/chrome-mv3/chunks/popup-B21RLllI.js に `fetch(` が 1 件ある (background.js / content-scripts/bridge.js / content-s

### [missed] 【公開するプライバシーポリシーと README が「localhost / 127.0.0.1 は静的 content script で自動対応」と書くが、https://127.0.0.1 は対象外】 severity: low。src/

- 状態: **✅ v0.4.14** (DEV_MATCHES に https://127.0.0.1/* を追加 (文書側でなくコード側を主張に合わせた)) / 観点: `i18n-quality (missed)` / 反証: `MISSED` / —
- 影響: 【公開するプライバシーポリシーと README が「localhost / 127.0.0.1 は静的 content script で自動対応」と書くが、https://127.0.0.1 は対象外】 severity: low。src/matches.ts:5-9 の DEV_MATCHES は http://localhost/* / https://localhost/* / http://127.0.0.1/* の 3 つで、**https://127.0.0.1/* が無い**。出荷 manifest でも確認した (.output/chrome-mv3/manifest.json の content_scripts[].matches = [http://127.0.0.1/*, http://localhost/*, https://localhost/*] ×2)。一方 

### [missed] 【popup ヘルプの色凡例が、非 React ページでは全要素を「グレー = その他ライブラリ」と説明することになる】 severity: low。src/classify.ts:9-23 は sourcePath も name も MU

- 状態: **✅ v0.4.14** (凡例を「グレー = その他ライブラリ / 素の DOM」(en: or plain DOM) に修正) / 観点: `i18n-quality (missed)` / 反証: `MISSED` / —
- 影響: 【popup ヘルプの色凡例が、非 React ページでは全要素を「グレー = その他ライブラリ」と説明することになる】 severity: low。src/classify.ts:9-23 は sourcePath も name も MUI クラス名も無い場合 :23 で `return 'third-party'` に落ち、src/overlayFormat.ts:12-18 の colorFor はこれを colors.thirdParty (グレー) に写す。素の HTML ページでは全要素が name=null / sourcePath=null なので、枠は常にグレーになる。ところが index.html:259-263 (en) / :281-285 (ja) の凡例は「gray = other libraries」「グレー = その他ライブラリ」と断定しており、React 

### [missed] 【i18n.test.ts の逆方向検査は所見 3 の指摘に加えて data-i18n 側も守れていない (今は違反ゼロ)】 severity: low (予防のみ)。src/i18n.test.ts の 8 検査は「en/ja のキー集合

- 状態: **✅ v0.4.14** (data-i18n 検査は導入済みだったため、main.ts の msg() 参照キー検査と DEFAULT_STRINGS↔en 本文一致検査を追加 (typo 注入で赤を確認)) / 観点: `i18n-quality (missed)` / 反証: `MISSED` / —
- 影響: 【i18n.test.ts の逆方向検査は所見 3 の指摘に加えて data-i18n 側も守れていない (今は違反ゼロ)】 severity: low (予防のみ)。src/i18n.test.ts の 8 検査は「en/ja のキー集合一致」と「DEFAULT_STRINGS ⊆ locale」方向だけで、entrypoints/popup/index.html の data-i18n キーが locale に存在するかを見ていない。現時点で 19 キーすべて en/ja に存在することは機械確認済み (欠落 0) なので**今は無害**だが、欠けた場合 applyI18n (main.ts:14-19) は getMessage が falsy なら textContent を書き換えないため、ja 環境で直書きの英文がそのまま出る (= サイレントに未翻訳が混入し、テストも lin

### [missed] 【誤答・high 相当】:where() を specificity に数えているため、実際には効いていない宣言の変数名をバッジが「由来」として出す。src/cssVars.ts:51-61 の regex をそのまま実行すると speci

- 状態: **✅ v0.4.11** / 観点: `performance (missed)` / 反証: `MISSED` / —
- 影響: 【誤答・high 相当】:where() を specificity に数えているため、実際には効いていない宣言の変数名をバッジが「由来」として出す。src/cssVars.ts:51-61 の regex をそのまま実行すると specificity(':where(#hero)')=10100 / specificity('.card')=100 (仕様では :where は 0)。実測 (v2/where.mjs, 実拡張): `:where(#hero){color:var(--brand)}` + `.card{color:#ff0000}` のページで computed は rgb(255,0,0) なのにバッジは「文字色 --brand #ff0000」。:where() は「上書きされるためにある」ので、負ける側に var 宣言がある構図が普通に起きる。:is() も誤り 

### [missed] 【誤答・high 相当】@layer をカスケードに反映していない。src/cssVars.ts:112-125 はレイヤブロックの cssRules を素通しで降り、以後 specificity/source order だけで勝者を決め

- 状態: **✅ v0.4.11** / 観点: `performance (missed)` / 反証: `MISSED` / —
- 影響: 【誤答・high 相当】@layer をカスケードに反映していない。src/cssVars.ts:112-125 はレイヤブロックの cssRules を素通しで降り、以後 specificity/source order だけで勝者を決めるが、レイヤ付き宣言は specificity に関係なく非レイヤ宣言に負ける。実測 (v2/layer.mjs): `@layer base{#hero{color:var(--brand)}}` + `.card{color:#ff0000}` で computed は rgb(255,0,0)、バッジは「文字色 --brand #ff0000」。Tailwind v4 は出力全体を @layer に入れ、MUI も enableCssLayer で @layer mui を使うため、狙っているスタックが該当する。specificity 同点なら s

### [missed] 【機能欠落・medium 相当】document.adoptedStyleSheets と shadow root のスタイルシートを一切読まない。src/cssVars.ts:133 は document.styleSheets のみを走

- 状態: **✅ v0.4.11** / 観点: `performance (missed)` / 反証: `MISSED` / —
- 影響: 【機能欠落・medium 相当】document.adoptedStyleSheets と shadow root のスタイルシートを一切読まない。src/cssVars.ts:133 は document.styleSheets のみを走査する。実測 (v2/adopted.mjs, 実拡張): 同一の宣言でも <style> 経由は「文字色 --brand / 内余白 --sp」と出るのに、document.adoptedStyleSheets 経由は「#1976d2 / 12px」だけ、shadow root 内 (adoptedStyleSheets) の要素も生値だけ。v1 では生値への縮退 (誠実な欠測) だが、drillToInnermost (src/inspector.ts:46-57) で shadow 内をわざわざ選択する設計なので、看板機能が構造的に効かない経路があ

### [missed] 上記 3 件は src/*.test.ts / e2e/ / docs/*.md を grep しても 'where(' / '@layer' / 'adoptedStyleSheets' が 0 件で、既知・許容ではなく未対処。

- 状態: **✅ v0.4.11** / 観点: `performance (missed)` / 反証: `MISSED` / —
- 影響: 上記 3 件は src/*.test.ts / e2e/ / docs/*.md を grep しても 'where(' / '@layer' / 'adoptedStyleSheets' が 0 件で、既知・許容ではなく未対処。

### [missed] 参考 (finder の notes 4 の裏取り): designScan の来歴予算は誠実に働いている (src/designScan.ts:166-169 で originBudgetExceeded→originAvailable=

- 状態: **判断済み (修正しない)** — 欠陥ではない (誠実に働いていることの裏取り記録)。v0.4.14 で design-scan 自体を配線から外した
- 影響: 参考 (finder の notes 4 の裏取り): designScan の来歴予算は誠実に働いている (src/designScan.ts:166-169 で originBudgetExceeded→originAvailable=false、:197-200 で originTrusted に伝播) が、1 要素 48-86ms × 予算 1500ms なので実質 20-30 要素で打ち切られ、実サイト規模では来歴軸が常に出せない状態になる。ただし v1 の popup (entrypoints/popup/main.ts) は design-scan もカバレッジも一切送っておらず到達不能なので、提出判断には影響しない。

### [missed] 【medium・#4 の真の根本原因】同一要素のスタイル変化に対する無効化が一切無い (src/inspector.ts:159 の `if (element === this.currentElement) return;` + obse

- 状態: **✅ 一部 v0.4.14** (クリック時は同一要素でも必ず再計測するよう変更 (⌘Click の古い値での誤答を閉じる)。ホバー静止中の live 追従は issue #19) / 観点: `ux-breakage (missed)` / 反証: `MISSED` / —
- 影響: 【medium・#4 の真の根本原因】同一要素のスタイル変化に対する無効化が一切無い (src/inspector.ts:159 の `if (element === this.currentElement) return;` + observer 0 件)。finder は resize の「枠のズレ」だけを medium で挙げているが、実測すると**値そのものが古いブレークポイント/古いテーマのまま可視で残る**: (a) @media 跨ぎの resize でバッジが「背景色#c62828 内余白16px 角丸12px」→ computed は #2e7d32 / 5px / 3px、野良値警告 (4px 外の 5px/3px) も出ない。(b) JS で element.style.backgroundColor='#6a1b9a'; padding='7px' に変えて 2px

### [missed] 【low〜medium・1 行修正】disable() が pending rAF を cancel しない (src/inspector.ts:113-128 に cancelAnimationFrame が無い / :153-161 で

- 状態: **✅ v0.4.14** (disable() で cancelAnimationFrame。unit が OFF 後の show 復活ゼロを固定) / 観点: `ux-breakage (missed)` / 反証: `MISSED` / —
- 影響: 【low〜medium・1 行修正】disable() が pending rAF を cancel しない (src/inspector.ts:113-128 に cancelAnimationFrame が無い / :153-161 で rafId に積む)。pointermove → (rAF 未発火) → Esc の順に噛むと、disable の hideAll の**後**に rAF が select→overlay.show() を実行し、モード OFF (toast「インスペクト OFF」/ pill 消滅 / クリックは素通り) なのに枠とバッジが display:block で**リロードまで永久に残る** (リスナは解除済みなのでマウスを動かしても更新も消去もされない)。実測: 同一タスクで pointermove→Escape を合成すると 1/1 で再現 (box=

### [missed] 【low〜medium・第一印象を壊す】全フレーム配信 (background.ts:185 / popup/main.ts の frameId 未指定) の副作用として、モード ON でフレーム数だけモードピルとトーストが重複する。実測:

- 状態: **✅ v0.4.13** (告知 (ピル/トースト) をトップフレーム限定に。e2e (iframe-sync) が重複ゼロを固定) / 観点: `ux-breakage (missed)` / 反証: `MISSED` / —
- 影響: 【low〜medium・第一印象を壊す】全フレーム配信 (background.ts:185 / popup/main.ts の frameId 未指定) の副作用として、モード ON でフレーム数だけモードピルとトーストが重複する。実測: 同一オリジン iframe 1 つのページで pill が 2 個 (親子とも pillOn=true)。トーストも各フレームの Inspector.enable (src/inspector.ts:104-107) が自フレームの overlay に出すので同数出る。広告/埋め込みを多数持つ実サイトでは初回 ON で「ピルとトーストが画面のあちこちに湧く」= 壊れて見える。#2 と根は同じだが、Esc を押す前の**最初の 1 操作**で見える症状なので別途潰す価値がある (子フレームでは pill/toast を出さず top のみ、が最小)。

### [missed] 【low】ホバー前の Alt+Click が完全に無反応。src/inspector.ts:176-178 は currentInfo が null だと preventDefault だけして黙って return する。実測: モード O

- 状態: **✅ v0.4.14** (クリック時の resync で対象を取得。それでも取れない場合は理由をトーストで出す (unit で固定)) / 観点: `ux-breakage (missed)` / 反証: `MISSED` / —
- 影響: 【low】ホバー前の Alt+Click が完全に無反応。src/inspector.ts:176-178 は currentInfo が null だと preventDefault だけして黙って return する。実測: モード ON 直後にホバーせず Alt+Click → トーストも パネルも出ず box は一度も表示されない。ON トースト (public/_locales/ja/messages.json:228) は「Alt+クリック: 描画元を見る」と明示的に案内しているので、案内した操作が無反応 = 直近で潰したはずの類型がここにも残っている (#6 の ↑ と同型)。「先に要素をホバーしてください」相当のトースト 1 行で閉じる。

