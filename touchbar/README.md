# Touch Bar プリセット (BetterTouchTool)

Touch Bar から domdom-inspector を操作するための BTT ウィジェット群。
**平常時は 1 個だけ。検査を始めたときだけ 3 個に展開し、Chrome を離れると全部消える。**

> **状態: 実機に導入済み・動作中。** 定義の正本は [`install.mjs`](./install.mjs) で、
> 実機もこの `.bttpreset` もそこから生成する。実機を手で触ったら `install.mjs` を
> 流し直すこと (実機からのエクスポートで上書きしない)。

## 収録ボタン

| 順 | ラベル | 送るもの | 出る条件 |
|----|--------|----------|----------|
| 300 | `要素検査` | `⌥I` (`58,34`) — inspect をトグル | Chrome が最前面 |
| 301 | `拡張設定` | `⌥D` (`58,2`) — popup を開く | Chrome が最前面 (常設) |
| 302 | `検査終了` | `ESC` (`53`) — モード解除 | 上に加えて **`要素検査` を押したあと** |

**`設定` が常設で、`検査終了` が右端なのには理由がある。** 拡張は localhost 以外では
popup で許可するまで動かないので、許可していないサイトでは `要素検査` が無反応になる。
その状態から抜ける手段 (`設定` → 現在のサイトで有効化) が展開の奥にあると、
**押して無反応を見てからでないと直せない**。だから `設定` は常設にした。
増減するのは `検査終了` だけで、それを**右端**に置くと伸縮が右の余白で起きるので
他のボタンが動かない。`要素検査`/`検査終了`/`設定` の順にすると展開・畳みのたびに
`設定` が 94pt 動き、`検査終了` を 2 回叩いたときの 2 回目が `設定` に当たる。

### 幅の揃え方 — 固定幅は使わない

**`BTTTouchBarButtonUseFixedWidth` は使えない。** 幅は揃うが、`hidden: true` を返したときに
**枠だけ残って、ラベルの無い空のボタンが描かれる**。実機の写真で 2 度発生した
(空箱の色が指定した灰色ではなく BTT の既定色だったので、BTT が枠だけ描いていると分かる)。
固定幅を付けていない local-ui-builder の 200/201 は同じ条件で綺麗に消えている。

そこで幅は **Auto** に任せ、**3 つのラベルの表示幅を揃えることで**合わせる。
`install.mjs` が短いラベルの両側に空白を足して一番広いものへ寄せ、推定表示幅の差が
4px を超えたら検算で落とす。日本語は全角 4 文字で元から一致するのでパディングは入らない。

> 推定値 (全角 12px / 半角 7px / 空白 3.3px @12pt) なので、**揃っているかの最終判定は
> 実機の見た目でしか取れない**。en を実際に使うときは目視確認する。

### ラベル

**出所は [`labels.json`](./labels.json) 1 箇所。** `install.mjs` がシステムのロケールで
1 つ選び (`DOMDOM_TB_LANG` で上書き可)、`~/.claude/btt/domdom.labels` へ書き出す。
`domdom-widget.sh` はそこだけを見る。**シェルにも .mjs にも直書きしない。**

| | ja | en |
|---|---|---|
| root | 要素検査 | Inspect |
| prefs | 拡張設定 | Settings |
| esc | 検査終了 | Exit |

規約は 3 つ。

- **絵文字・記号 1 文字は使わない。** Touch Bar は物理フィードバックが無いので、
  `🔍` や `⚙` は意味も押せる範囲も読み取れない
- **単体で意味が通ること。** `esc` は「何の esc か分からない」と実機で指摘を受けた
- **日本語決め打ちにしない。** 拡張自体は en/ja を出し分けているので、Touch Bar だけ
  日本語だと英語環境で読めない

**ラベルが取れないときウィジェットは隠れる** (空文字で表示しない)。設定漏れを
「押せるのに何のボタンか分からない空の箱」ではなく「見えない」で表明するため。

### 送るキーは Chrome から読む (直書きしない)

拡張のショートカットは `chrome://extensions/shortcuts` でユーザーが自由に変えられる。
Touch Bar 側に固定値で持つと、変えられた瞬間に**押せるのに誰も聞いていないキーを送る**
= 黙って無反応になる。**2026-08-15 に実際に起きた**: Touch Bar は `⌃I` / `⌃D` を送っていたが、
実バインドは `⌥I` / `⌥D` だった。トレースには `sent … rc=0` が並ぶので、送信は成功していて
気づけない。しかも `要素検査` は Touch Bar の展開だけは起こるため、**効いているように見える**。

そこで `install.mjs` が Chrome の `Preferences` の `extensions.commands` を読み、
実バインドを BTT のキーコードへ変換して `~/.claude/btt/domdom.keys` に書く。
`domdom-press.sh` はそこだけを見る。**未割当のコマンドがあれば install は失敗する**
(黙って既定値に落ちない)。

拡張の ID は unpacked だとパス由来で変わるので、名前ではなく **`Secure Preferences` の
`path` に `domdom-inspector` を含むもの**として引く。

macOS の表記に注意: Chrome の `Ctrl` は **Command** を指し、実 Control は `MacCtrl`。
`Alt` は Option。manifest の `suggested_key` (`Alt+Shift+I`) は当てにならない
(ユーザーが再割当していれば別のキーになる)。

## 平常時 1 個 / 使用中 3 個 (2026-08-15)

Touch Bar は物理幅が約 1000pt しかないのに、3 プロジェクト合計の要求幅は 2695pt ある。
**使っていない拡張が常時 268pt を占めるのは割に合わない**、という指摘を受けての構成。

```
Chrome 以外が最前面   (なし)                            0pt
Chrome が最前面       [ 要素検査 ][ 設定 ]            188pt
要素検査 を押したあと [ 要素検査 ][ 設定 ][ 検査終了 ] 282pt
```

畳む契機は 2 つ。**`検査終了` を押す**か、**Chrome を離れる**。

### なぜ「拡張が ON のときだけ出す」にできないのか

**BTT には拡張のモード状態を知る手段が無い** ([`DESIGN.md`](./DESIGN.md) §1)。
本製品は送信経路ゼロが提出の土台なので、拡張から localhost へ知らせる経路も作れない
(`SECURITY.md` / `PRIVACY.md` / `STORE_LISTING.md` / `PUBLISHING.md` の 4 文書が
`fetch`/XHR/WebSocket/beacon が 0 件であることに依存している)。

そこで**展開状態は Touch Bar 側だけの状態**として持つ。`~/.claude/btt/domdom.expanded`
が空でなければ展開 (`検査終了` が出る)。これは拡張のモードそのものではないので、**ズレる (drift) 前提で扱う**:

- 右クリックメニューや ⌥I (キーボード) で抜けても Touch Bar は気づけない
- そのため **Chrome を離れた時点で必ず印を回収する** (`domdom-widget.sh` の root)。
  ズレが残り続けて「使っていないのに 3 個出たまま」になるのを防ぐのが目的
- 逆に、検査中に Chrome を離れて戻ると畳まれた状態から始まる。ここで `要素検査` を押すと
  拡張側は OFF に倒れる (toggle-inspect はトグルなので)。**その場合は `検査終了` を押せば元に戻る**

## 誤爆を潰す仕組み (押下時の front 再照合)

表示判定はポーリングなので最大 1 ティックぶん古い。判定と指が降りる瞬間の間に最前面が
変わると、Chrome 向けのキーが別アプリに着弾する (1.5 秒間隔で 2 回叩いて 2 個目が別アプリに
着弾する事象を実測済み)。

そこでボタンの主アクションを **`137` (ターミナルコマンドを実行)** にして、
[`domdom-press.sh`](./domdom-press.sh) が**送る直前に front を引き直す**。

キー送信そのものは **BTT に投げ返す** (`trigger_action` に 264 の JSON を渡す)。
System Events 経由だと呼び出し元プロセスに Accessibility 権限が要るが、BTT 経由なら
BTT の権限で送られるので追加の許可が要らない。

**トレースは必ず書く** (`~/.claude/btt/domdom.trace`)。BTT はスクリプトの stdout を
捨てるので、これが無いと「実行されていない」と「実行されたが送信を見送った」が
どちらも同じ『何も起きない』に見える。

```
2026-08-15 06:19:31 sent [root] keys=58,34 rc=0 expanded=on
2026-08-15 06:19:31 no-key [root] …/domdom.keys に定義が無い (node touchbar/install.mjs を流し直す)
2026-08-15 04:06:46 skip [esc] front="CFBundleIdentifier"="com.googlecode.iterm2" want=com.google.chrome
```

## 仕組み: なぜ Chrome のときだけ出るのか

**BTT のアプリ限定機能は使えない。** AppleScript (`add_new_trigger` / `update_trigger`) から
アプリスコープを設定する経路が存在しないことを実測で確認した (トリガー JSON に
`BTTBelongsToApp` を入れる / アプリコンテナごと渡す / 後から `update_trigger` する、
3 方法すべて `Global` になる)。

そこで **type 642 (シェルスクリプトウィジェット) の自前判定**を使う。各ウィジェットは
1 秒ごとに [`domdom-widget.sh`](./domdom-widget.sh) を **source** し、
`{"text":…,"hidden":bool}` を返す。

**`lsappinfo` を呼ぶのは root (`要素検査`) だけ。** 他の 2 つは印のファイルを読むだけで、
使うのは bash の組み込み (read / test / printf) に限る。

**更新間隔はロールごとに変えてある。** 押した直後に展開が見えないと壊れて見えるので、
`検査終了` / `設定` は速く回す。root は front を引くのに `lsappinfo` を 2 回起動するので
速くできない。

| ロール | 1 回のコスト (実測) | 間隔 | 理由 |
|--------|--------------------|------|------|
| root (`要素検査`) | 25.8ms | 1 秒 | `lsappinfo` を 2 回起動するので速くできない |
| prefs (`設定`) | 4.5ms | 1 秒 | 常設なので root と同じ粒度で足りる |
| esc (`検査終了`) | 5.8ms | **0.3 秒** | **押した直後に出る必要があるのはこれだけ** |

合計 **約 49.6ms/s ≒ コアの 5.0%**。全部 1 秒なら 3.6% で済むが、押してから `検査終了` が
出るまで最大 1 秒かかり「効いていない」と読まれる。0.3 秒を BTT が実際に守ることは
心拍で実測した (3.2 回/秒。小数を受け付ける)。

**front を引くのは root だけ**で、結果を `~/.claude/btt/domdom.front` に書いて他の 2 つへ
渡す。3 個とも `lsappinfo` を呼ぶと 25.8ms × 3 が毎ティック走る。

> 以前この節に「16ms/s ≒ 1.6%」と書いていたのは誤り。`lsappinfo` のぶんしか数えておらず、
> `bash -c` の起動コスト (約 4ms) を落としていた。**コストは実測で出す。**

`/bin/bash <file>` ではなく **source** なのは、bash が 2 プロセスになるのを避けるため
(macenv の cc-widget.sh が実測 3.7ms → 7.0ms の倍増を確認している)。

### この方式の限界

- **判定は更新間隔ぶん遅れる** (最大 1 秒)。押下側は front 再照合で塞いであるが、
  表示のちらつきは残る
- **ネイティブの条件付き表示は使えない。** BTT には条件用の変数
  (`BTTActiveAppBundleIdentifier` 等) とトリガー側のキー (`BTTTriggerConditions*`) が実在するが、
  AppleScript から書いても保存されない (アプリ限定と同じ挙動)。「変数が真のときだけ表示」は
  `BTTMenuItemVisibleIfVariableIsTrue` = **Floating Menu 専用**で、Touch Bar に同等品は無い

## なぜ order 300〜302 (最後尾) なのか

**展開/畳みで列の長さが変わるから。** 前に置くと伸縮のたびに後続のボタンが横へ動き、
隣を踏む (`DESIGN.md` の「罠 b — 繰り上がり誤爆」)。最後尾なら伸縮は右の余白に向かう。

2026-08-15 に **100〜105 から 300〜302 へ移した**。Touch Bar を共有する帯の割り当ては
**0–55 macenv / 200–201 local-ui-builder / 300–302 domdom** になった
(旧: 0–55 / 100–105 / 200–201)。

## 手順

### 導入・更新 (このマシン)

```sh
node touchbar/install.mjs --plan   # 何を消して何を作るか出すだけ
node touchbar/install.mjs          # スクリプト配置 + トリガー作り直し + 検算
node touchbar/install.mjs --verify # 実機の現状を期待値と突き合わせるだけ
```

`install.mjs` は `domdom-widget.sh` / `domdom-press.sh` を `~/.claude/btt/` へ配置し、
同じディレクトリに 2 つの生成ファイルを書く。

- `domdom.keys` — Chrome の実バインドから変換した送信キー (`role=キーコード`)
- `domdom.uuids` — 押下直後に展開を反映させるための UUID。**作成後の実値**で書く

**Chrome の設定を読むので、拡張が読み込まれていないと install は失敗する。** これは仕様で、
黙って古いキーを使い続けるより早く気づけるため。

**642 ウィジェットは作り直すと BTT を再起動するまで実行されない。**

### 他のマシン

```sh
open touchbar/domdom-inspector.bttpreset
```

プリセットのシェル文字列は `$HOME` 表記なので、`~/.claude/btt/` に 2 本の `.sh` を
置けばそのまま動く (`install.mjs` を流すのが確実)。

### 元に戻す

トリガーには `BTTNotes: "domdom-touchbar"` が入っている。`install.mjs` はこの印が付いた
642 だけを消す。`cc-touchbar-*` (macenv) と `web-touchbar` (local-ui-builder) は
別セッションの管理下なので触らないこと。

### バックアップ

`export_preset` は AppleScript から引数を受け付けず**使えない**。全トリガーの JSON を退避する:

```sh
osascript -e 'tell application "BetterTouchTool" to get_triggers "{}"' > btt-backup.json
```

## 実装上の罠 (実測で判明したもの)

- **`update_trigger` は `BTTActionsToExecute` を空配列で上書きしても旧サブアクションを消さない。**
  2026-08-15 に実測。旧 264 (キー送信) が残ると押下時の front 再照合を素通りしてキーが直接飛ぶ。
  **消したいときは `delete_trigger` → `add_new_trigger` で作り直す**
- **`add_new_trigger` は `BTTUUID` を受け付けない** (BTT が採番して 36 文字で返す)。
  UUID を前提にした設定ファイル (`domdom.uuids` 等) は**作成後の実値**で書く
- **`BTTPredefinedActionType: 264` (キー送信) を主アクションとして渡すと保存されず落ちる。**
  サブアクションにするか、`137` からスクリプト経由で `trigger_action` に渡す
- **`BTTShellScriptWidgetGestureConfig` (`/bin/bash:::-c`) はトップレベルに置く。**
  `BTTTriggerConfig` の中に入れるとスクリプトが一切実行されず、エラーも出ない
- **サブアクションに `BTTTriggerClass` を入れない。** 保存はされるが実行されない
- **サブアクションには `BTTOrder` を明示する。** 省略すると逆順で保存される
- **`BTTTBWidgetWidth` は BTT のドキュメントに存在しないキー。** `update_trigger` で書けて
  `get_triggers` でも読めるので効いているように見えるが、**描画には効かない**。642 ウィジェットでも
  描画に効くのは `BTTTouchBarButtonUseFixedWidth: 1` + `BTTTouchBarButtonWidth`
  (`trigger-definitions.mdx` の「Sizing & Layout」。既定は Auto = 文字数で伸縮)。
  2026-08-15 に実機の写真で「設定」だけ細いことから判明。**JSON が保存できたことは
  描画に効いた証拠にならない**
- **`refresh_widget` は何もしない。** 押下直後に展開を反映させるために使っていたが、実 UUID に
  20 回投げてもウィジェットのスクリプト実行回数が他と変わらない (= 1 回も再実行されない)。
  戻り値は常に `missing value` なので、**呼べたことは効いた証拠にならない**。
  即時反映の手段は無く、更新間隔を詰めるしかない
- **`BTTTouchBarScriptUpdateInterval` は小数を受ける** (0.3 で実測 3.2 回/秒)。
- **ウィジェットのスクリプトは temp → rename で置き換える。** BTT は毎秒 source しているので、
  直接上書きすると書き込み途中の半端なファイルを読みうる。同一ボリュームの rename は原子的
  なので、BTT は必ず新旧どちらか完全な方を読む。
  (**空のボタンの原因はこれではなかった**。スクリプトを 4500 回叩いても空出力は 0 件で、
  空箱は固定幅指定を外したら消えた。それでも原子的な置き換えは正しいので残す)
- **BTT は `hidden: true` を返したウィジェットもポーリングし続ける** (心拍で実測)。
  一度隠れたら戻らない、という心配は要らない
- **`BTTAdditionalActions` は入力時の別名で、保存時に `BTTActionsToExecute` へ正規化される**
- **`BTTPredefinedActionType: 128` (アプリ指定でキー送信) を `update_trigger` で流し込むと
  BTT 本体が落ちる。** 2026-08-05 に実測。以後 `get_triggers` が `-609 接続が無効です` を返し、
  アプリが常駐しなくなる。復旧は `open -a BetterTouchTool` → 壊れたトリガを UUID で
  `delete_trigger`。**キー送信は 264 だけを使う**
- **`get_triggers` は親トリガーと `BTTActionsToExecute` の子レコードを同列に返す。**
  棚卸しで件数を数えると二重に数える。`BTTTriggerType` の有無で親子を分ける
- **押下の再現は `execute_assigned_actions_for_trigger <UUID>`。** `trigger_action <UUID>` では
  実行されない (どちらも `missing value` を返すので戻り値では区別できない)。
  137 は**非同期**なので、トレースを読む前に少し待つこと

## 既知の制限

- **localhost 以外では無反応**: 拡張の既定注入先は `localhost` / `127.0.0.1` のみ。
  他のサイトは popup の「現在のサイトで有効化」で許可したときだけ動く。Touch Bar 側から
  オリジンは判別できないので、Chrome にいる限り `要素検査` は出る
- **ページがキーを横取りすることがある**: Chrome の拡張コマンドはページが
  `preventDefault()` すると発火しない。実例として、local-ui-builder が
  `if (!(e.metaKey || e.ctrlKey)) return` で Ctrl を Cmd の別名として受けており、
  `設定` の `⌃D` がテーマ切替に化けていた (2026-08-15 に先方で修正済み。
  同じ書き方は広く見かけるので、他の Web アプリでも起こりうる)。
  Touch Bar 側では防げないので、無反応のときはページ側の実装を疑う
- **許可した直後はリロードが要る**: mid-page 注入でもデザイン計測は動くが、コンポーネント名の
  解決は React 読み込み前のフック設置が前提なので、リロードするまで出ない。
  詳細は [`../docs/popup-ux-design.md`](../docs/popup-ux-design.md)
- **`▲` / `▼` (親子ナビ) は収録しない**: `↑` / `↓` を**素キーで送る**ため、インスペクトモードが
  OFF のときページ側へ漏れる。復活させるなら素キー送信をやめ、修飾キー必須の manifest command
  (`nav-parent` / `nav-child`) に昇格させてから足す (`CLAUDE.md` 地雷 3 の 4 点配線)。
  代替として、要素を**右クリック**して「この要素を検査」を選べる

## 全マシンで使いたい場合

このプリセットはリポジトリ同梱 (プロジェクト固有の資産のため)。全 Mac に配りたい場合は
macenv (`~/dev/macenv`, chezmoi) 側で引き取る運用になる。
