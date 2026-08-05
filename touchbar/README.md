# Touch Bar プリセット (BetterTouchTool)

Touch Bar から domdom-inspector を操作するための BTT ウィジェット群。
**Chrome が最前面のときだけ表示され、それ以外のアプリでは自分から消える。**

> **状態: 実機に導入済み・動作中。** このファイルは実機からエクスポートしたもの。

## 収録ボタン

| ボタン | 送るもの | 幅 |
|--------|----------|----|
| 🔍 Inspect | `⌃I` (`59,34`) | 104 |
| esc | ESC (`53`) | 76 |
| ⚙︎ | `⌃D` (`59,2`) — popup を開く | 76 |

キーはすべて **Chrome の実バインド** (`~/Library/Application Support/Google/Chrome/Default/Preferences`
の `extensions.commands`) に一致させてある。manifest の `suggested_key` は当てにならない。

**🌳 Tree / ⚡︎ Render は収録しない。** v1 では両モードを配線から外したため、送る先の
コマンドが存在しない (経緯は [`../docs/ROADMAP.md`](../docs/ROADMAP.md))。復活させるなら
`CLAUDE.md` の 4 点配線を戻したうえで、order 101 / 106 に足す。

記号だけのボタン (esc / ⚙) は **76px** の固定幅。Touch Bar は物理フィードバックが無く、
細いボタンはタップしづらいため。**Touch Bar を共有する 3 プロジェクトの下限は 70px**
(macenv / local-ui-builder は `max(70, 22 + 文字幅*8)` 相当)。以前の 62px はそこを下回る
唯一の値で、「押せない」という指摘を受けて 2026-08-06 に引き上げた。

## ▲ / ▼ (親子ナビ) を収録しない理由 (2026-08-06 に削除)

`↑` / `↓` を**素キーで送る**ため、インスペクトモードが OFF のときはページ側へ漏れる
(スクロール等が誤爆する)。親子ナビ自体は v1 で生きている機能なので「不要だから」ではなく
**送り方が安全でないから**外した。復活させるなら `DESIGN.md` の結論どおり、素キー送信を
やめて修飾キー必須の manifest command (`nav-parent` / `nav-child`) に昇格させてから
order 101 / 102 に足す。

代替として、要素を**右クリック**して「この要素を検査」を選べば、キーボードもホバーも
使わずに対象を選べる (2026-08-06 に拡張側へ実装)。

## 仕組み: なぜ Chrome のときだけ出るのか

**BTT のアプリ限定機能は使えない。** AppleScript (`add_new_trigger` / `update_trigger`) から
アプリスコープを設定する経路が存在しないことを実測で確認した (トリガー JSON に
`BTTBelongsToApp` を入れる / アプリコンテナごと渡す / 後から `update_trigger` する、
3 方法すべて `Global` になる)。

そこで **type 642 (シェルスクリプトウィジェット) の自前判定**を使っている。各ウィジェットは
2 秒ごとに次のインラインスクリプトを実行し、Chrome が最前面でなければ自分を隠す:

```bash
b=$(lsappinfo info -only bundleID "$(lsappinfo front)" 2>/dev/null)
case "$b" in
  *com.google.Chrome*) printf '{"text":"…","background_color":"…","font_color":"255,255,255,255","hidden":false}';;
  *)                   printf '{"text":"","hidden":true}';;
esac
```

外部スクリプトファイルに依存しないインライン方式にしてあるので、リポジトリを移動しても壊れない。

### この方式の限界

- **判定は更新間隔ぶん遅れる。** ボタンが見えている状態で Cmd+Tab して押すと、
  Chrome 向けのキーが新しい最前面アプリに飛ぶ。常時居座りは消えるが誤爆の完全な解ではない
- **CPU を食う。** `lsappinfo` の 2 回起動で 1 回 15ms。6 個 × 2 秒間隔で 45ms/s ≒ コアの 4.5%。
  インタプリタを挟むと桁が変わる (`python3 -c pass` だけで 47.5ms) ので、**判定は必ず
  インラインの bash に留める**こと。表示制御にしか使わないので間隔は 2 秒で十分
- **ネイティブの条件付き表示は使えない。** BTT には条件用の変数
  (`BTTActiveAppBundleIdentifier` 等) とトリガー側のキー (`BTTTriggerConditions*`) が実在するが、
  AppleScript から書いても保存されない (アプリ限定と同じ挙動)。「変数が真のときだけ表示」は
  `BTTMenuItemVisibleIfVariableIsTrue` = **Floating Menu 専用**で、Touch Bar に同等品は無い

## 手順

### 導入 (実機は導入済み)

```sh
open touchbar/domdom-inspector.bttpreset
```

**AppleScript で作った 642 ウィジェットは BTT を再起動するまで実行されない。**
`add_new_trigger` で入れた場合は再起動が要る (629 プレーンボタンは再起動不要)。

### 元に戻す

トリガーには `BTTNotes: "domdom-touchbar"` が入っているので、BTT の検索で絞って削除できる。
`cc-touchbar-*` は macenv セッションの管理下なので触らないこと。

### バックアップ

`export_preset` は AppleScript から引数を受け付けず**使えない**。DB をファイルごとコピーする:

```sh
cp ~/Library/Application\ Support/BetterTouchTool/btt_data_store.version_* ~/Desktop/BTT-backup/
```

## 実装上の罠 (実測で判明したもの)

- **`BTTPredefinedActionType: 264` (キー送信) を主アクションとして渡すと保存されず落ちる。**
  必ず `BTTActionsToExecute` のサブアクションとして持たせる
- **`BTTShellScriptWidgetGestureConfig` (`/bin/bash:::-c`) はトップレベルに置く。**
  `BTTTriggerConfig` の中に入れるとスクリプトが一切実行されず、エラーも出ない
- **サブアクションに `BTTTriggerClass` を入れない。** 保存はされるが実行されない
- **サブアクションには `BTTOrder` を明示する。** 省略すると逆順で保存される
- **幅キーは型ごとに別。** 629 は `BTTTouchBarButtonWidth` + `BTTTouchBarButtonUseFixedWidth`、
  642 は `BTTTBWidgetWidth`
- **`BTTAdditionalActions` は入力時の別名で、保存時に `BTTActionsToExecute` へ正規化される**
- **`BTTPredefinedActionType: 128` (アプリ指定でキー送信) を `update_trigger` で流し込むと
  BTT 本体が落ちる。** 2026-08-05 に実測。以後 `get_triggers` が `-609 接続が無効です` を返し、
  アプリが常駐しなくなる。復旧は `open -a BetterTouchTool` → 壊れたトリガを UUID で
  `delete_trigger`。**キー送信は 264 だけを使う**(アプリ限定はシェル側の表示判定で代替する)
- **`BTTOrder` はプロジェクト間で衝突する。** Touch Bar は order 順に並ぶので、別プロジェクトが
  同じ帯を使うとボタンが混ざる。現在の割り当ては **0–55 macenv / 100–105 domdom /
  200– local-ui-builder**。新しい帯を使うときは他プロジェクトに通告する

## 既知の制限

- **localhost 以外では無反応**: 拡張の既定注入先は `localhost` / `127.0.0.1` のみ。
  他のサイトは popup の「現在のサイトで有効化」で許可したときだけ動く。Touch Bar 側から
  オリジンは判別できないので、Chrome にいる限りボタンは出る
- **許可した直後はリロードが要る**: mid-page 注入でもデザイン計測は動くが、コンポーネント名の
  解決は React 読み込み前のフック設置が前提なので、リロードするまで出ない。
  詳細は [`../docs/popup-ux-design.md`](../docs/popup-ux-design.md)
- **親子ナビ (↑ / ↓) はホバーが前提**: `Inspector` は `pointermove` で選択要素を決めるため、
  モードを ON にした直後に ↑ を押しても何も起きない。[`DESIGN.md`](./DESIGN.md) の
  `seedSelection` を実装すれば解消する (Touch Bar のボタンとしては収録していない — 上記)

## 全マシンで使いたい場合

このプリセットはリポジトリ同梱 (プロジェクト固有の資産のため)。全 Mac に配りたい場合は
macenv (`~/dev/macenv`, chezmoi) 側で引き取る運用になる。
