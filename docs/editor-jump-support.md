# エディタジャンプの対応状況 (2026-08-16 実測)

`⌘/Ctrl+Click` と右クリックメニュー「ソースをエディタで開く」がどこまで動くか。
**推測ではなく実機で測った結果**を書く。ここが期待値の唯一の正。

## 結論

**v0.4.23 で転送方式を変えた。** dev サーバの launch-editor エンドポイントに頼む方式
(Vue DevTools と同じ) が本線になり、**利用者の設定は不要**になった。

| 環境 | 位置が取れるか | 利用者に起きること |
|------|--------------|------------------|
| **Vite dev + React 19** | **40/40 = 100%** (実測) | **設定ゼロで開く** (実機確認済み) |
| **Next.js dev (webpack)** | 取れる | 設定ゼロで開く (`/__nextjs_launch-editor`) |
| **Next.js dev (Turbopack)** | **0%** | 「バンドル出力」と表示。開けない |
| React の production ビルド | 0% | 「バンドル出力」と表示。開けない (原理) |
| 非 React (Express / 素の HTML) | 注釈属性があれば取れる | 属性が無ければ手がかりのコピー |
| dev サーバを持たない構成 | — | 従来のスキーム経路へ落ちる (対応表が要る) |

**パスの対応表・ルート候補・`~` の話は、すべて「dev サーバが無いとき」の話になった。**
本線ではブラウザが相対パスを渡し、サーバが自分のルートで解決する。

**この機能は本筋ではない。** 製品の芯は「本番サイトで自分のトークンと照合する」で、
本番ビルドではソースジャンプは原理的に不可能。デザイナーが本番を見る用途では最初から
使えない。dev で使える便利機能、という位置づけで止める (2026-08-16 に投資を打ち切り)。

## 前提: 利用者の環境は選べない

**この拡張は Web Store で配る。利用者は任意のサイトを見に来た他人でありうる。**
「Turbopack を切ってください」「アプリに `data-source` を出してください」は、
その人がそのアプリの開発者でない限り実行できない。**製品の案内としては出さない。**

上の表で「必要な設定」に書いてあるものは、**利用者自身のコードを自分の dev サーバで
見ている場合にだけ意味を持つ**。それ以外では設定を促さず、理由の説明と手がかりの
コピーに留める (`looksLocalDev` で分岐。localhost / ループバック / *.local / *.test /
プライベート IP のみ真)。

つまりこの機能が効く相手は「自分のコードを自分の dev サーバで開いている人」だけ。
そこを広げようとすると、相手の環境に注文を付けることになるので広げない。

## なぜ環境で差が出るのか

**React 19 は `_debugSource` を廃止した。** 実測 (dev-album / localhost:3000):

```
要素 1210 / Fiber あり 1207
_debugSource: 0
_debugStack : 1207   ← 位置はスタックの形でここに入っている
```

位置情報は**全要素にある**。取り出せるかはスタックのフレームが何を指すかで決まる。

- **Vite**: `at Navigation (http://localhost:3000/src/components/Navigation.tsx?t=…:248:35)`
  → 実ソースのパスと行が入っている。**取れる**
- **Next.js webpack**: `webpack-internal:///(app-pages-browser)/./src/app/page.tsx`
  → レイヤ名を剥がせば実ソース。**取れる**
- **Next.js Turbopack**: `/_next/static/chunks/_0wzpx8i._.js:4988:275`
  → 不透明なチャンク。元ソースの名前がどこにも無い。**取れない**

Turbopack を通すにはソースマップを読むしかなく、それには `fetch` が要る。
**送信経路ゼロが `SECURITY.md` / `PRIVACY.md` / `STORE_LISTING.md` / `PUBLISHING.md` と
CWS の Data usage 申告の土台**なので、ここは崩さない。

→ Turbopack のプロジェクトでは開けない。**これは受け入れる** (相手の dev サーバ構成に
注文を付けられないため)。自分のプロジェクトでたまたま選べる立場にあるなら webpack 側が
通る、という事実の記録に留める。

## 転送方式 — ここが全部の分かれ目

| | dev サーバ方式 (本線 v0.4.23〜) | スキーム方式 (フォールバック) |
|---|---|---|
| 渡すもの | 相対パス `src/App.tsx:28:21` | 絶対パス `/Users/…/src/App.tsx` |
| 解決する主体 | **dev サーバ** (自分がプロジェクト) | エディタ (作業フォルダは見ない) |
| 利用者の設定 | **不要** | 対応表が必須 |
| 通信 | localhost へ 1 要求 | 無し |

**200 だけで成功と判定してはいけない。** SPA の history フォールバックは未知パスにも
200 で index.html を返す。実測では launch-editor が `content-type` 無しの 0 バイト、
未知ルートが `text/html` の 1673 バイト。content-type で切り分ける。

## なぜ「パスの対応表」が要るのか (dev サーバが無いときの話)

Vite も Next も `/src/app/page.tsx` のように**プロジェクト相対**で位置を報告する。
一方 **エディタの scheme URL (`cursor://file…`) は絶対パスしか受けず、エディタが開いて
いる作業フォルダは解決に使われない**。だから相対のまま送ると必ず
「このコンピューターに存在しません」になる (実機で繰り返し発生した)。

**拡張はディスクを読めないので、絶対パスは原理的に分からない。** ページが漏らす
絶対パス (Vite の `/@fs/…`) からルート候補を推定して popup に出すところまでが限界で、
**最後の 1 回は人が確認する**。

候補は答えではない。実測では:

```
候補 (ページから推定): /Users/ai/dev/writing/dev-album
実際のソースの場所  : /Users/ai/dev/writing/dev-album/client/src/…
```

漏れるのは node_modules の位置 (= リポジトリのルート) で、Vite の root がその下に
ある構成では 1 段足りない。押した後に対応表のテキストを直す前提で作ってある。

## 解決の順序 (`Inspector.openEditorFor`)

1. React dev の `jumpTarget` (`_debugSource` / `_debugStack` 由来。行番号まで正確)
2. **ソース注釈属性** (`data-v-inspector` / `data-inspector-*` / `data-source` 系)。
   フレームワーク不問 — サーバーが出していれば Express でも行番号まで開く
3. その要素に cascade で勝っている**同一オリジンの外部 CSS** (行番号は CSSOM が
   公開しないので 1 行目)
4. どれも不可なら理由 + **検索の手がかりをコピー** (セレクタ / クラス / テキスト / CSS の所在)

**送る手前の門は 1 箇所だけ** (`Overlay.openEditor`)。ビルド出力とプロジェクト相対パスは
ここで止める。経路ごとに同じ判定を書いていた頃は、経路が増えるたびに書き忘れて
同じ症状 (「存在しません」) を 3 回出した。

## dev サーバは 200 を返すが、エディタは開かない (2026-08-16 実測)

**一番よく踏む失敗。拡張側は正常でも「何をやっても開かない」になる。**

### 何が起きているか

Vite の `launch-editor-middleware` はこう書かれている:

```js
launch(path.resolve(srcRoot, file), specifiedEditor, onErrorCallback);
res.end();   // ← launch の完了を待たない
```

`res.end()` が同期的に呼ばれるので、**起動に失敗しても 200 が返る**。
拡張はレスポンスからは成否を判別できない (これは実装の不足ではなく構造的な限界)。

失敗の理由は **dev サーバのログにだけ**出る:

```
Could not open vite.config.ts in the editor.
The editor process exited with an error: spawn code --wait ENOENT
  ('code --wait' command does not exist in 'PATH').
```

### 原因: `EDITOR="code --wait"`

`launch-editor` の `guessEditor()` は次の順に決める:

1. `process.env.LAUNCH_EDITOR`
2. 起動中のプロセスから推測 (`ps x -o comm=` を既知エディタの一覧と突き合わせ)
3. `process.env.VISUAL` → `process.env.EDITOR`

このうち **1 と 3 はシェル解釈しない** (`return [process.env.EDITOR]`)。
`EDITOR="code --wait"` は git のために置くことが多い一般的な設定だが、
この値は「`code --wait` という名前の実行ファイル」として spawn され、必ず ENOENT になる。

2 の推測も外れやすい。既知エディタの一覧は VS Code / Cursor / Sublime / JetBrains 等の
**アプリのパス決め打ち**で、一覧に無いエディタ (実測では Antigravity IDE) が起動中でも
何にも一致しない。

### 直し方 (利用者側)

dev サーバを起動するときに `LAUNCH_EDITOR` を**引数なしのコマンド名**で渡す:

```
LAUNCH_EDITOR=cursor pnpm dev
LAUNCH_EDITOR=code   pnpm dev
```

`EDITOR` / `VISUAL` を変えてもよいが、**引数を含めると必ず失敗する** (`code --wait` は不可)。
`LAUNCH_EDITOR` は他の用途に影響しないので、こちらを勧める。
**dev サーバの再起動が要る** (環境変数は起動時に固定される)。

### 無反応の経路は 2 つある (2026-08-16 実測)

`LAUNCH_EDITOR` を shim に向けた Vite を別ポートで立て、shim を記録用ラッパに差し替えて
実際に渡る引数を採取した。

```
実在するファイル → argc=3  [1] -r  [2] -g  [3] /Users/…/vite.config.ts:30:7
実在しないファイル → ラッパは**一度も呼ばれない**。それでも status=200
```

つまり `launch-editor` は `fs.existsSync` に失敗すると**黙って return する**。
エンドポイントは `res.end()` を先に呼んでいるので、どちらの場合も 200 が返る。

**無反応の原因は 2 つあり、拡張からは判別できない:**

1. エディタを起動できない (`LAUNCH_EDITOR` 未設定 / 一覧に無い名前 / 引数入りの値)
2. `path.resolve(devサーバのcwd, file)` が実在しない (モノレポで起動位置がズレている等)

したがって**トーストで原因を 1 つに断定してはいけない**。実際に送ったパスを表示し、
利用者がその場で見分けられるようにする (v0.4.31)。

### 一覧に無いエディタ (Antigravity IDE 等) の場合

`launch-editor` は**エディタ名で引数の形を決める**。`-r -g file:line:col` (VS Code 系) を
受け取れるのは basename が次のいずれかのときだけ:

```
code / Code / code-insiders / Code - Insiders / codium / trae / cursor / vscodium / VSCodium
```

実測 (2026-08-16): `antigravity` は launch-editor 内に **0 件**。よって
`LAUNCH_EDITOR=antigravity-ide` としても switch に当たらず、既定の分岐

```js
if (process.env.LAUNCH_EDITOR) return [fileName, lineNumber, columnNumber];
```

が選ばれる。つまり `antigravity-ide /path/File.tsx 276 36` と実行され、
**276 と 36 が別のファイル名として渡る**。開いても行には飛ばない。

**回避策**: `code` という名前の symlink を **PATH に載せないディレクトリ**に置き、
`LAUNCH_EDITOR` にその絶対パスを渡す。`path.basename()` で判定されるので
これで VS Code 系の引数形式が選ばれ、実体は任意のエディタでよい。

```sh
mkdir -p ~/.local/launch-editor
ln -sfn "/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide" \
        ~/.local/launch-editor/code
LAUNCH_EDITOR=$HOME/.local/launch-editor/code pnpm dev
```

PATH に載せないので、既存の `code` / `cursor` は一切影響を受けない。
Antigravity の CLI は `-g --goto <file:line[:character]>` に対応しており
(`--help` で確認)、この形で行・桁まで飛ぶ。

### 拡張側の対応 (v0.4.29)

**「開いた」と断定しない。** dev サーバは結果を返さないので、拡張は知りようがない。

以前は 200 を成功として扱っていたため、2 つの実害があった:

1. 実際には何も起きていないのに成功と表示していた (誤答)
2. **動くはずのスキーム起動へ二度と到達しなかった** — 成功扱いだと分岐が
   フォールバックへ落ちない。押しても何も起きず、理由も出ない状態になる

現在は「依頼しました。何も開かない場合、理由はサーバ側のログに出ています」と伝え、
**同じトーストに「直接開く」を置いて**スキーム起動へ逃げられるようにしてある。

---

## 踏んだ罠 (再発しやすいもの)

- **`isBundledSource` のハッシュ判定を字種でやらない。** Turbopack は base36
  (`_0wzpx8i._.js`) で、16 進前提だと取りこぼす。配信ディレクトリ (`_next/static` 等) で
  判定する
- **`tabs.query` は権限が無いと `url` を伏せる。** 候補提示をアクティブタブの URL に
  依存させると「候補はあるのに出ない」が起きる
- **テストの fixture に「実際には開けないパス」を使わない。** `overlayEditor.test.ts` の
  fixture が `/src/App.tsx` (相対) で、「URL を組み立てたか」しか見ておらず、報告された
  壊れ方をそのまま正常系として固定していた
