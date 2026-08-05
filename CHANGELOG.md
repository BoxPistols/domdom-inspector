# 変更履歴

版数は `package.json` の `version` が正で、WXT が manifest に反映する。

**実機確認を頼む前に patch を上げる。** 版数が変わらないと、`chrome://extensions` の
拡張カードを見ても ⟳ が効いたのか、古いビルドを見ているのかが区別できない
(実際にそれで「右クリックが出ない」と報告された)。手順は
`pnpm build` (同期フォルダへの展開まで自動) → ⟳ → 拡張カードの版数を確認、の順。

CWS は同一バージョンの再アップロードを拒否するため、公開時も必ず上げる。

---

## 0.4.9 (2026-08-06)

### CI — 今の主張を毎 push で検証する

CI は lint / test / typecheck / build / e2e を回していたが、**このセッションで追加した申告
(送信経路ゼロ・スクリーンショットの寸法・版数の一致・掲載文の文字数) は検証していなかった。**
対外文書 4 点の申告がコードとずれても CI は緑のままだった。

- verify ジョブに **`pnpm zip` + `pnpm check:submission`** を追加。
  Data usage「収集しない」の根拠 (`fetch`/XHR/WebSocket/beacon が 0 件) が崩れたら落ちる
- e2e ジョブに **`pnpm shots` のスモーク**を追加。スクリーンショット生成ハーネスが
  セレクタ変更等で壊れる退行を止める。
  **ピクセル比較は載せない** — フォント描画がマシン依存で、macOS で作った画像と Ubuntu の
  描画は一致しないため偽の失敗になる。見るのは「撮れるか」だけ
- `check:submission` は CI では「未 push」判定をスキップする。PR の checkout は merge commit で
  origin/main より必ず先に進むため、常に非ゼロになり偽の失敗になる (ローカル公開手順の項目)

---

## 0.4.8 (2026-08-06)

### 追加 — 提出前チェックを実測する

- **`pnpm check:submission`** (`scripts/submission-check.mjs`): 20 項目を実測して PASS/FAIL を
  出す。未達があれば exit 1。
  - **なぜスクリプトにしたか**: 判定を文書に数字で書くと即座に古くなる。実際に「対象版
    v0.4.6」「未 push 17 件」と書いた直後に自分のコミットで古くなった。**古い判定書は旧 zip を
    アップロードする事故を生む**
  - 測るもの: 版数の一致 (package.json ↔ manifest) / 提出 zip が今の版で存在 (`.output` に
    旧 zip が残るので取り違え検知) / permissions / optional_host_permissions /
    minimum_chrome_version / default_locale / commands / アイコン 5 サイズ / _locales /
    description と Summary の文字数 / **送信 API の発生箇所が 0 件** (Data usage 申告の根拠) /
    成果物に外部エンドポイントが残っていない / **スクリーンショットの実寸を PNG ヘッダから
    読んで 1280×800 か** / 旧画像の残骸 / **未 push のコミット**
  - 現状 **19/20 pass**。唯一の未達は「未 push のコミット」= 人間の操作待ち
- `docs/store-submission-readiness.md` を「数字を書く」から「スクリプトで測る」に変更

---

## 0.4.7 (2026-08-06)

### 提出準備 — 可否を実測で確定

- **`docs/store-submission-readiness.md` (新規)**: 何が機械で確認済みで、あと何を人手で
  やれば送信できるかを 1 枚に。実測値つき (unit 295 / e2e 16 / zip 19 ファイル 60.6 kB /
  Summary 文字数 / 送信経路 0 件 など)
- **順序依存を発見**: `PRIVACY.md` を GitHub Pages で公開すると **GitHub 上の `main` の内容が
  配信される**。このセッションの 17 コミットが未 push のため、先に Pages を有効化すると
  **AI デザイン監査の節が残った古いポリシー**が公開され、「Data usage = 収集しない」の申告と
  食い違う。`push → Pages` の順序を提出手順の手順 0 として明記した
- `PUBLISHING.md` §0 のチェックリストを実測値に更新 (テスト件数・版数の記述が古かった) +
  「未 push のコミットが無い」を項目として追加

---

## 0.4.6 (2026-08-06)

### セキュリティ

- **右クリック経由のエディタ起動に、ページからの偽装で任意パスを開かせられる穴があった。**
  MAIN world は同一信頼境界で、ページ側の JS は bridge からの postMessage を偽装できる
  (source 文字列を真似るだけ)。`open-editor-at-context` を偽装すると、ページが自前で偽装した
  `__reactFiber$` の `_debugSource` を使って**ユーザーのエディタで任意のパスを開かせられた**。
  - 対象要素を「**信頼済み** の contextmenu 直後 (15 秒) に観測したもの」に限定した。
    ページが `dispatchEvent` で合成した contextmenu は `isTrusted === false` で無視する
    (合成イベントに isTrusted は付けられないため構造的に閉じる)
  - e2e に**偽装の試行**と**本物の右クリックの対照**を両方入れた (片方だけだとテストが
    無意味になっていることに気づけない)
  - `SECURITY.md` の脅威モデルに記載

### 審査準拠の確認 (機械で実測)

- 掲載文の文字数: Summary en 125 / ja 63 文字 (上限 132) — OK
- manifest description: en 110 / ja 76 文字 (上限 132) — OK
- 掲載文ブロック内の**競合名・誇張表現なし** (react-scan / React DevTools / best / 最高 /
  No.1 等を機械検索。Public では掲載文の品質が審査対象)

### ドキュメント

- `docs/manual-verification-20260806.md` を現状に更新 (25 項目):
  - **B7**: エディタが開かないときのフォールバック (存在しないスキームで試す手順)
  - **E2**: v1 の配線から外した UI が popup に出ていないこと
  - **E3**: MUI サイトでテーマ自動検出による照合が動くこと
  - **G0**: 合成イベント + 偽装メッセージで何も起きないこと

---

## 0.4.5 (2026-08-06)

### 修正

- **モード ON トーストの文言が嘘だった。** production ビルドで
  「no dev build detected, safe mode (**names only**)」と出していたが、実際は**デザイン値・
  CSS 変数名・トークン照合・野良値警告はすべて出る**。出ないのは自作コンポーネント名と
  ソースジャンプだけ。スクリーンショットを撮って初めて気づいた (画像がその証拠だった)。
  「production build: no component names or source jump, but design values and token
  matching work」に修正 (i18n 3 箇所同期)

### 追加 — Chrome Web Store 提出物の自動生成

- **`pnpm shots`** (`scripts/store-screenshots.mjs`): ビルド済み拡張を実 Chromium に
  ロードして 1280×800 の提出用スクリーンショットを生成する。出力
  `docs/store-assets/{en,ja}/` × 4 枚。**提出ブロッカーだった「スクリーンショット撮影」が
  ユーザー作業から外れた**
  - Public 公開では**実物一致が必須** (合成・モック不可)。手撮りだと UI を変えるたびに
    古い画像が残り、掲載文と実装の不一致として審査で拾われる。自動化すれば何度でも作り直せる
  - **locale の強制**: 拡張の i18n はブラウザ UI 言語に従うが、macOS の Chromium は
    `--lang` も `LANG`/`LC_ALL`/`LANGUAGE` も**無視してシステムロケールを使う** (実測)。
    開発機が日本語だと英語の画像が撮れないため、`_locales/<locale>/messages.json` の
    **実在する文字列**を実 UI 経路に流し込んでいる (文言は作らない)
  - **popup は自動生成に含めない**: Playwright の各ページは別ウィンドウ扱いになるため
    popup の `tabs.query({active:true,currentWindow:true})` が常に自分自身を返し、
    CTA が disabled の状態でしか撮れない。`chrome.tabs.query` を偽装すれば撮れるが、
    それは実物ではないので使わない (要るなら実機で手撮り。`PUBLISHING.md` §7)
- `docs/store-assets/README.md`: 各画像の意図と再生成手順、実物一致の根拠

### 対外文書

- `PUBLISHING.md` §7 を「撮り方」から「自動生成」に書き換え。未完ブロッカーから
  スクリーンショットを削除 (残るユーザー作業は 4 件 → **3 件 + ③目視**)

---

## 0.4.4 (2026-08-06)

### 変更 — トークン JSON 貼り付けを外した (オーナー判断)

→ [#13](https://github.com/BoxPistols/domdom-inspector/issues/13)。実装は温存。

- オーナーは Figma を使わないため、**使わない機能を popup の一等地に毎回見せていた**
- **MUI テーマ自動検出があるので、MUI アプリでは設定ゼロでトークン照合が動く。**
  貼り付けが必要なのは Figma / W3C / Tokens Studio の JSON を持っている人だけだった
- 非 MUI ページでも動き続けるもの: computed デザイン値 / **宣言された CSS 変数名の優先表示** /
  4px グリッド外の野良値検出 (いずれも辞書不要)
- **storage の `tokenDict` 中継も外した** (`bridge.content.ts`)。書き込む側が無いのに読むと
  「UI から見えない古い辞書でバッジが注釈される」状態になりうるため。
  MAIN world 側の `tokens` 受信は残してある (e2e が照合エンジンを検証している)
- 永続化するものが**ユーザー設定だけ**になった (ページ由来のデータをゼロに)

### 対外文書

- **`_locales` の `extDescription`** (拡張カードとストアに出る説明文) を MUI 軸へ:
  「どのページでも色・余白・角丸・文字サイズを計測。**MUI ならテーマを自動検出して**
  トークン名と照合。」— 貼り付け UI が無いのに「あなたのトークンと照合」と言うと
  非 MUI サイトで嘘になるため
- `STORE_LISTING.md`: 掲載文 (en/ja) の「MATCH AGAINST YOUR DESIGN TOKENS」を
  「— ZERO CONFIG」に書き換え、貼り付け手順を削除。Single purpose も
  「利用者のトークン」→「そのページが依拠するデザインシステム」へ
- `PRIVACY.md`: 保存データ表から「貼り付けたデザイントークン」の行を削除。
  **保存するのは設定だけ**になった
- `SECURITY.md`: 永続化キーを settings / popupDevOpen のみに更新
- `PUBLISHING.md`: 審査官メモの貼り付け手順を MUI 自動検出の説明に差し替え。
  スクリーンショット推奨カットも更新
- `README.md` / `README.en.md` / `CLAUDE.md` / `docs/ROADMAP.md` も同期

### 内部

- e2e: `#tokensJson` が復活していないことを assert (issue #13)。
  `coverage.spec.ts` は storage seed から **bridge の `tokens` メッセージ注入**へ変更
  (storage 中継を外したため。実際の供給元である MUI 自動検出と同じ経路になった)

---

## 0.4.3 (2026-08-06)

### 変更 — v1 のスコープを絞る (オーナー判断)

popup の下半分を v1 の配線から外した。**実装は温存** (削除ではなく到達不能) で、
次期リリースのアイデアストックとして issue に積んである。

- **トークンカバレッジ計測**を外した →
  [#10](https://github.com/BoxPistols/domdom-inspector/issues/10)。
  popup (340×600px) では率の意味を保つ情報 (分母・母集団・但し書き・凡例) が入りきらず、
  popup は外側クリックで必ず閉じるため「率 → その率を作った要素をページ上で指す」検算ループも
  作れない。side panel として再導入する (設計は `docs/design-coverage-screen.md` に確定済み)
- **BYOK AI デザイン監査**を外した →
  [#11](https://github.com/BoxPistols/domdom-inspector/issues/11)。
  **これがあるだけで CWS の Data usage 申告に Website content と Authentication information の
  2 カテゴリが必要**になり、審査が重くなる。キーが無ければ何もしない機能で初回体験にも寄与しない
- **表示設定 3 つ** (CSS 変数名優先 / MUI テーマ自動検出 / バッジの情報量) を外した →
  [#12](https://github.com/BoxPistols/domdom-inspector/issues/12)。
  既定値は据え置きなので**動作は変わらない**。これらは「設定」ではなく**計測条件**で、
  率の隣に出すべき情報だった
- **`background.ts` から AI 中継 (fetch) を外した。** これが拡張内で唯一の `fetch` 発生源
  だったため、**`fetch`/XHR/WebSocket/beacon の発生箇所が 0 件**になった (grep で再現証明可能)

### 対外文書 — 単一目的とデータ申告を同時に狭めた

コードだけ狭めて文書を放置すると「存在しない機能を宣言している」状態になるため、4 文書を同時に直した。

- **Data usage 申告が「収集なし」に戻った** (全カテゴリ未チェック)。以前は Website content と
  Authentication information を YES で申告する必要があった
- `STORE_LISTING.md`: 掲載文 (en/ja) からカバレッジと AI のブロックを削除 / Single purpose から
  「aggregated for the whole page」と AI 節を削除 / 権限正当化から AI エンドポイントを削除
- `PRIVACY.md`: AI 節を全削除 (en/ja)。**AI の言及がゼロ**になった。保存データ表から API キーの行を
  削除、「認証情報を一切保存しない」に変更。クリップボード経路は実在するもの (エディタが開かなかった
  ときのパスコピー) に差し替え
- `SECURITY.md`: TL;DR / 脅威モデル / 監査手順 / 権限表を更新。**grep 手順を実際に回して 0 件を確認**
  してから申告を書いた
- `PUBLISHING.md`: §4-2 のデータ申告を全カテゴリ未チェックに / 審査官メモから AI 行を削除 /
  「データを収集しない拡張ではない」という注記を反転
- `README.md` / `README.en.md` / `CLAUDE.md` / `docs/ROADMAP.md` も同期

### 内部

- e2e に「外した UI が復活していないこと」の assert を追加 (`#coverageMeasure` /
  `#aiSection` / `#badgeDetail` の count 0)。掲載文と申告を戻さずに UI だけ生えると
  単一目的の宣言と食い違うため、機械で止める
- 既存の回帰ガード (`#coverageMeasure` が disabled) は `#enableSite` へ移した
  (`docs/design-coverage-screen.md` §6-7 が予告していた通り)
- 成果物サイズ 167 kB → 148 kB (AI/カバレッジ経路が tree-shake された)

---

## 0.4.2 (2026-08-06)

### 修正

- **エディタが開かなかったときのフォールバックが無かった。** scheme の起動
  (`a[href="cursor://…"].click()`) は投げっぱなしで成否が取れないのに、直後のトーストが
  「開いています…」と**成功を主張していた**。エディタ未インストール / URL スキーム未登録では
  何も起きず、押しても無反応の最悪形になっていた
  - トーストを「送りました: `/src/App.tsx:42`」に変え、**成功を主張しない**。パスと行は
    常に見せる (開かなかったときに手で辿れるように)
  - 外部アプリが起動すればページは blur するので、**1.2 秒の猶予内に blur も
    visibilitychange も来なければ**「開かなかった」と見なし、理由 + **パスをコピー**する
    操作可能トーストを出す。判定は遅延側で状態を読み直さず、イベントで捕まえたフラグで行う
  - パスはパスマッピング適用後の実パス (Docker / リモート開発でそのまま辿れる)
  - popup のヒントに「選んだエディタがインストールされている必要がある / 何も開かなければ
    パスをコピーする導線を出す」を明記 (en/ja)
- 検出力は敵対的に実証済み (フォールバックを殺すと 5 件中 2 件のテストが落ちる)

### 内部

- `formatSourceRef` を `src/editor.ts` に追加 (パス:行 の純関数。unit 3 本)
- 操作可能トースト `Overlay.toastAction` を追加 (既定の toast は `pointer-events: none` なので
  class で切り替える)。`toast()` は毎回 interactive を落として残骸を消す
- テスト: unit 284 → 292 (`src/overlayEditor.test.ts` 新規 5 本 + editor 3 本)

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
