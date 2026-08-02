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
| 🔍 Inspect | `⌃I` (キーコード `59,34`) | 常時。実機で domdom-inspector に割当済みを確認済み |
| 🌳 Tree | `⌃T` (`59,17`) | **要手動割当** (下記) |
| ⚡︎ Render | `⌃E` (`59,14`) | **要手動割当** (下記) |
| ▲ 親 | `↑` (`126`) | インスペクトモード ON かつ**要素をホバー済み**のときだけ |
| ▼ 子 | `↓` (`125`) | 同上 |
| esc | ESC アクション (`189`) | 常時 (モード解除) |

記録トグル (`R`) のボタンは意図的に入れていない。修飾キーが付かないため、レンダー可視化
モードが OFF のときに押すと素の `r` がページやアドレスバーに入力されてしまうため。
記録の開始/停止はレンダーモード中にページ内へ出る常設コントロールから行う。

## import 前にやること

### 1. 拡張を最新ビルドで再読込する

現在 Chrome にロードされている domdom-inspector のビルドには `toggle-tree` /
`toggle-render` コマンドが**入っていない** (v0.4.0 で再配線したもの)。先に:

```sh
pnpm build
```

して `chrome://extensions` で「更新」(⟳) する。

### 2. 古い unpacked コピーを整理する

Chrome には domdom-inspector が **2 つ**登録されている:

| 拡張 ID | 状態 | 押さえているキー |
|---------|------|------------------|
| `hflhefliijkmdaelmeeeahejefhggakf` | 現行 | `⌃I` = toggle-inspect / `⌃D` = ポップアップ |
| `elhekbmalpieelpdnmfinooegmcgfann` | 古いコピー | **`⌥⇧I` = toggle-inspect** |

古い方が `⌥⇧I` を握っているため、manifest の `suggested_key` (`Alt+Shift+I`) は現行の
拡張には割り当たらない。古い方を削除するか、`⌥⇧I` を使わない前提で運用する
(このプリセットは後者を採り `⌃I` を送る)。

### 3. Tree / Render のショートカットを割り当てる

`chrome://extensions/shortcuts` で domdom-inspector を開き:

- `toggle-tree` → `⌃T` (現在空き)
- `toggle-render` → `⌃E` (現在空き)

**`⌥⇧R` は使わないこと。** Screencastify (`mmeijimgabbpbgpdklnllpncmdofkcpn`) が
`toggle-start-stop` で予約済みで、無効化していても予約は残る。押すと画面録画が始まる。

割り当てたキーが上記と違う場合は、プリセット内の `BTTShortcutToSend` を合わせて直す
(キーコード表は `/Applications/BetterTouchTool.app/Contents/Resources/action-definitions.mdx`)。

### 4. 現在の BTT 設定をバックアップする

`.bttpreset` の import が「新規プリセット作成」か「現在のプリセットへのマージ」かは
**未確認**。既存の Claude Code 用 Touch Bar ボタンを壊さないため、先に退避する:

```sh
osascript -e 'tell application "BetterTouchTool" to export_preset "Default"' > ~/Desktop/BTT-Default-backup.bttpreset
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
