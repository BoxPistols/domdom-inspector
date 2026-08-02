# Touch Bar プリセット (BetterTouchTool)

Touch Bar から domdom-inspector を操作するための BTT プリセット。
Chrome が最前面のときだけボタンが出る。

> **状態: ドラフト。まだ import しないこと。**
> 生成とスキーマ検証は済んでいるが、**実機での import・動作確認は未実施**。
> 下の「import 前にやること」を先に片付ける必要がある。
>
> このプリセットは**実機の Chrome 実バインドに一致**させてある
> (Inspect=⌃I / Tree=⌥⇧T / ⚙=⌃D)。`toggle-render` は未割当のため収録していない。
> 素キー (↑ / ↓) はまだ残っており、[`DESIGN.md`](./DESIGN.md) の
> 「素キー全廃 / 全操作を manifest command に昇格」は拡張側の対応後に反映する。
>
> **import が唯一のアプリ限定手段**: AppleScript (`add_new_trigger` / `update_trigger`) では
> アプリ限定を設定できないことを実測で確認した (トリガー JSON に `BTTBelongsToApp` を入れる /
> アプリコンテナごと渡す / 後から `update_trigger` する、の 3 方法すべて Global になる)。
> Chrome 限定にしたい場合は、この preset を import するか BTT UI で手動移動するしかない。

## 収録ボタン

| ボタン | 送るもの | 効くのはいつか |
|--------|----------|----------------|
| 🔍 Inspect | `⌃I` (キーコード `59,34`) | 常時 |
| 🌳 Tree | `⌥⇧T` (`58,56,17`) | 常時 |
| ▲ 親 | `↑` (`126`) | インスペクトモード ON かつ**要素をホバー済み**のときだけ |
| ▼ 子 | `↓` (`125`) | 同上 |
| esc | ESC アクション (`189`) | 常時 (モード解除) |
| ⚙︎ | `⌃D` (`59,2`) | 常時 (popup を開く)。効かないときの逃げ道 |

キーはすべて **Chrome の実バインド** (`Preferences` の `extensions.commands`) に一致させてある。
記号だけのボタン (▲ / ▼ / esc / ⚙) には 62px の固定幅を指定 — Touch Bar は物理フィードバックが
無く、細いボタンはタップしづらいため。

**⚡︎ Render は未収録。** `toggle-render` は ⌥⇧R を Screencastify が予約しているため Chrome が
割り当てておらず、送るキーが存在しない。`chrome://extensions/shortcuts` で ⌃E 等を割り当てれば
追加できる。

記録トグル (`R`) のボタンは意図的に入れていない。修飾キーが付かないため、レンダー可視化
モードが OFF のときに押すと素の `r` がページやアドレスバーに入力されてしまうため。
記録の開始/停止はレンダーモード中にページ内へ出る常設コントロールから行う。

## import 前にやること

### 1. 拡張を最新ビルドで配る (完了済み)

Chrome がロードしているのは `.output/chrome-mv3` ではなく **OneDrive の同期フォルダ**。
`pnpm build` だけでは反映されないので **`pnpm build:sync`** を使い、`chrome://extensions` で
「更新」(⟳) を押す。

### 2. 古い unpacked コピーを整理する

Chrome には domdom-inspector が **2 つ**登録されている:

| 拡張 ID | 状態 | 押さえているキー |
|---------|------|------------------|
| `hflhefliijkmdaelmeeeahejefhggakf` | 現行 | `⌃I` = toggle-inspect / `⌃D` = ポップアップ |
| `elhekbmalpieelpdnmfinooegmcgfann` | 古いコピー | **`⌥⇧I` = toggle-inspect** |

古い方が `⌥⇧I` を握っているため、manifest の `suggested_key` (`Alt+Shift+I`) は現行の
拡張には割り当たらない。古い方を削除するか、`⌥⇧I` を使わない前提で運用する
(このプリセットは後者を採り `⌃I` を送る)。

### 3. Render を使うならショートカットを割り当てる

`chrome://extensions/shortcuts` で `toggle-render` に **⌃E** 等 (空き) を割り当てる。

**`⌥⇧R` は使わないこと。** Screencastify (`mmeijimgabbpbgpdklnllpncmdofkcpn`) が
`toggle-start-stop` で予約済みで、無効化していても予約は残る。押すと画面録画が始まる。

割り当てたキーに合わせてプリセットへボタンを足す (キーコード表は
`/Applications/BetterTouchTool.app/Contents/Resources/action-definitions.mdx`)。

### 4. 現在の BTT 設定をバックアップする

`.bttpreset` の import が「新規プリセット作成」か「現在のプリセットへのマージ」かは
**未確認**。既存の Claude Code 用 Touch Bar ボタンを壊さないため、先に退避する。
**`export_preset` は AppleScript から引数を受け付けず使えない**ので、DB をファイルごとコピーする:

```sh
cp ~/Library/Application\ Support/BetterTouchTool/btt_data_store.version_* ~/Desktop/BTT-backup/
```

## import

```sh
open touchbar/domdom-inspector.bttpreset
```

BTT が起動していれば取り込みダイアログが出る。

## 元に戻す

BTT の設定 → プリセット一覧で `DomDom Inspector Touch Bar` を選択して削除するか、
「Select Active Presets」でチェックを外す。このプリセットのトリガーには
`BTTNotes: "domdom-touchbar"` が入っているので、検索して個別削除もできる。

## 既知の制限

- **localhost 以外では無反応**: 拡張の既定注入先は `localhost` / `127.0.0.1` のみ。
  他のサイトは popup の「現在のサイトで有効化」で許可したときだけ動く。Touch Bar 側から
  オリジンは判別できないので、ボタンは常に表示される。
- **▲ / ▼ はホバーが前提**: `Inspector` は `pointermove` で選択要素を決めるため、
  モードを ON にした直後に ▲ を押しても何も起きない (一度ページ上でマウスを動かす必要がある)。
- **記録キーを変えた場合**: popup で記録キーを既定の `R` から変えても、このプリセットには
  記録ボタンが無いので影響しない。
- ボタン名を変えるときは `BTTTouchBarButtonName` と `BTTTriggerTypeDescription` の両方を直す。

## 全マシンで使いたい場合

このプリセットはリポジトリ同梱 (プロジェクト固有の資産のため)。全 Mac に配りたい場合は
macenv (`~/dev/macenv`, chezmoi) 側で引き取る運用になる。
