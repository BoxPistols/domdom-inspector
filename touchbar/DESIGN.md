# 設計: ブラウザ閲覧中の「DomDom を見るモード」(Touch Bar)

閲覧中に「ここ見たい」と思ったら Touch Bar から入り、検査し、抜ける。この一連を
Touch Bar だけで完結させるための設計。**結論と根拠を確定させた文書**で、実装はまだ。

---

## 0. 2026-08-15 の改訂 — §2 の「条件付き表示を使わない」を部分的に撤回

**§2 以降は 8 ボタン構成 (グループ化 + 全コマンドの manifest 昇格) を前提に書いてある。
これは未実装で、v1 の実機は 3 ボタン構成。** 実際に入っているものは
[`README.md`](./README.md) が正で、定義の正本は [`install.mjs`](./install.mjs)。

実機からの指摘 (2026-08-15) は 3 点だった。

1. **絵文字と記号 1 文字は読み取れない** — `🔍 Inspect` / `esc` / `⚙︎` を
   `要素検査` / `検査終了` / `設定` に変更 (`esc` は単体では何の esc か読めないという
   追加指摘を受けて 2 度目の変更)
2. **幅は揃っていないと押し間違える** — 104/76/76 を全部 90px に統一
3. **使っていない時に出ているのが一番困る** — Chrome 前面でも、検査していないなら不要

3 番のために **条件付き表示を導入した**。§2 は「条件付き表示は罠 a (レース) と
罠 b (繰り上がり誤爆) を踏むから使わない」と結論していたが、両方とも塞げることが分かった。

| §2 が挙げた罠 | 今回の対処 |
|---|---|
| 罠 a — 判定と押下の間に最前面が変わる | ボタンの主アクションを `137` (シェル) にし、`domdom-press.sh` が**送る直前に front を引き直す**。ズレていれば送らずトレースに `skip` を残す |
| 罠 b — 列が詰まって隣を踏む | domdom を **Touch Bar の最後尾 (order 300〜302)** へ移した。伸縮が右の余白に向かうので、他プロジェクトのボタンは動かない |

**§2 の中核は「安全性を状態の推測に依存させない」ことで、そこは front 再照合という
コード側の手当てで取っている。**ただし「素キー送信を全廃」の方は**達成していない**。
`検査終了` は素の Escape (キーコード 53) を送る。

- 表示条件は `domdom.expanded` という **Touch Bar ローカルの推測**で、拡張の実際の
  モードではない。右クリックメニューやキーボードで抜けても Touch Bar は気づけない
- したがって、**モードが OFF のときに `検査終了` を押すと素の Escape がページへ届く**。
  開いているモーダルを閉じる / 全画面を抜ける / ファイル選択をキャンセルする、といった
  副作用がありうる。▲▼ を消した理由と同じ類型で、**Escape は影響が小さいから残している**
  という判断であって、原則を満たしているわけではない
- 恒久策は §5 の `exit-modes` (修飾キー必須の manifest command) に載せ替えること。
  そこまでやれば「素キー送信を全廃」が本当に成立する

ズレ自体は「Chrome を離れたら畳む」で溜めないようにしている (詳細は README)。

**§2 の理由 1 (中心ユースケースで必ず漏れる) は今も有効。** 拡張の注入状態は BTT から
判別できないので、`要素検査` は Chrome にいる限り出る。押しても無反応なサイトはありうる。

---

## 1. 何が難しいのか

BTT には**拡張のモード状態を知る手段が無い**。この事実がすべての設計判断を決める。

そのうえで Touch Bar 特有の罠が 2 つある (実測・議論で確定):

- **罠 a — レース**: 条件付き表示は「判定 → 描画 → 指が降りる」の間に状態が変わる。
  表示条件だけでは不十分で、送信直前の再判定が要る。
- **罠 b — 繰り上がり誤爆**: ボタンが消えるとレイアウトが詰まり、隣を押してしまう。
  物理フィードバックが無いぶん、無反応より悪い。

素朴に作ると「モードが OFF のときに `↑` や `r` を送ってページに漏れる」。これを
「BTT 側で状態を推測して隠す」で解こうとすると、罠 a と b の両方を踏む。

---

## 2. 決定

> **BTT に状態を持たせない。素キー送信を全廃し、すべての操作を拡張の manifest command
> (修飾キー必須) に昇格させる。Touch Bar は静的なボタン列のままにする。**

条件付き表示を使わないので、**罠 a と b がそもそも発生しない**。

### なぜこれで漏れが消えるのか (決定的な根拠)

Chrome の拡張コマンドは **Ctrl か Alt を必ず含まねばならない**。Shift 単独は拒否され、
裸の文字キーは構造的にコマンドになれない。

> `if (accelerator.IsShiftDown()) { return accelerator.IsCtrlDown() || accelerator.IsAltDown() || accelerator.IsCmdDown(); }`
> — Chromium `ui/base/accelerators/command.cc`
> 公式ドキュメントも "Extension command shortcuts must include either Ctrl or Alt."

つまり**コマンド経由にした時点で、文字入力にもスクロールにもなり得ない**。モードが
OFF でも、拡張が注入されていないサイトでも、押した結果は「何も起きない」に収束する。
状態を推測する必要が消える。

### 案 B (BTT に状態を持たせる) を採らなかった理由

検討はした。BTT 変数 + 条件付きアクティベーショングループ + 送信時 IF (`330`) で
二重化する案で、技術的には成立する。採らなかったのは次の 3 点。

1. **中心ユースケースで必ず漏れる。** 拡張の既定注入先は localhost のみで、他サイトは
   popup で許可したときだけ動く。BTT はこれを検知できないので、「デザイナーが production を
   見に行く」という本製品が最も想定する場面で、変数は ON なのに実際は OFF になり、
   `↑` が確定でページに漏れる。二重化で塞げるのはレースだけで、この**ズレ (drift) は塞げない**。
2. **真値を取る経路が現状すべて閉じている。** Chrome の「Apple Events からの JavaScript を許可」は
   OFF (実行して確認、エラー 12)、BTT の HTTP サーバも未起動。拡張がタイトルにマーカーを
   出す案 (`◆I ` を `document.title` に前置) なら成立するが、タブのタイトルが汚れる。
   デザイン検査でスクリーンショットを撮る用途と相性が悪い。
3. **プリセットが手書き・diff 不能になる。** 条件は NSKeyedArchiver の base64 として
   保存される (既存 CAG の predicate を復号して確認済み)。リポジトリ同梱の JSON として
   レビューできる利点を失う。

**ただし案 B の「列が 1 ボタンで済む」「状態が Touch Bar で見える」という UX 上の利得は本物。**
安全性をコードで解決した後なら、条件がズレても実害が無いので、見た目の整理として後から
軽く被せられる。→ §7 の将来案。

---

## 3. 確定した制約 (一次情報つき)

| 制約 | 根拠 |
|------|------|
| コマンド数に上限は無い。**`suggested_key` を持てるのは 4 つまで** | Chromium `commands_handler.cc` の `kMaxCommandsWithKeybindingPerExtension = 4`。超えると警告ではなく**マニフェスト解析エラーで拡張が読み込めない** |
| `suggested_key` 無しのコマンドは 4 の枠を消費しない | 同上。`VKEY_UNKNOWN` はカウントされない。ユーザーが `chrome://extensions/shortcuts` で手動割当できる |
| `_execute_action` (popup を開く) は枠を 1 つ消費する | 実機で `⌃D` が割当済み |
| **F1〜F24 はコマンドに割り当てられない** | `command.cc` の受理トークンに F キーが存在しない。Touch Bar → F キー → コマンド、という設計は不可能 |
| macOS で `Ctrl` は ⌘ に変換される。**実 Control は `MacCtrl`** | 公式ドキュメント。実機の Preferences に `mac:Ctrl+I` と `mac:Command+Shift+B` が別々に現れることが裏付け |
| ページが先にキーを受け取る。`preventDefault()` されるとコマンドは発火しない | Chromium `unhandled_keyboard_event_handler.cc` |
| コマンドは Chrome が前面のときだけ発火 (global 宣言時を除く) | `extension_keybinding_registry_views.cc` が window の FocusManager に登録 |
| 未注入オリジンでは**無言の no-op** | `entrypoints/background.ts` の `.catch(() => {})` |
| 矢印キーは OS に横取りされる | 実機の `com.apple.symbolichotkeys` で ⌃↑ (Mission Control) / ⌃↓ (App Exposé) 等が enabled。**矢印は使わない** |
| ⌥⇧R は Screencastify が予約 (無効化しても残る) | Chrome の `Preferences` の `extensions.commands` |
| 拡張に状態問い合わせの口が無い | grep 済み。これは BTT の制約ではなく**拡張側の欠落** |
| Touch Bar には既に 16 項目 (629×7, 642×9) がある | BTT の DB 実測。**フラットに 8 個足すのは非現実的 → グループは前提** |

---

## 4. ボタン構成

### ルート (Chrome 前面時、常設 1 個)

| ボタン | 動作 |
|--------|------|
| 🔍 **DomDom** | Touch Bar グループ `DomDom` を開く (BTT アクション `205`) + `inspect-on` を送る |

`inspect-on` は**冪等な ON** (トグルではない)。既に ON でも OFF に倒れない。
拡張には既にこのメッセージ経路がある (popup のサイト有効化で使用中) が、コマンドが
割り当てられていないだけ。

### グループ `DomDom` の中 (条件付き表示は使わない = 常に全部出る)

| 順 | ボタン | 送るコマンド | 備考 |
|----|--------|--------------|------|
| 0 | ✕ **抜ける** | `exit-modes` | 左端固定エリアに置き、絶対座標のアンカーにする。**無条件・冪等 OFF** |
| 1 | 🔍 Inspect | `inspect-on` | 冪等 ON。押し直しても OFF に倒れない |
| 2 | 🌳 Tree | `toggle-tree` | **v1 では無し** (モードを配線から外したため) |
| 3 | ⚡︎ Render | `toggle-render` | **v1 では無し** (同上) |
| 4 | ▲ 親 | `nav-parent` | モード OFF なら no-op |
| 5 | ▼ 子 | `nav-child` | 同上 |
| 6 | ● REC | `toggle-record` | **v1 では無し** (レンダー可視化に付随) |
| 7 | ⚙︎ 設定 | `_execute_action` (⌃D) | popup を開く。「効かないとき」の逃げ道 |

### タップ target の最小幅 (実機で判明した制約)

**記号 1〜2 文字のボタンは細くなりすぎて押しづらい。** Touch Bar は物理的なフィードバックが
無いぶん、指の着地点が視覚だけに依存するため、幅の狭いボタンは実用に耐えない。

対処は `BTTTriggerConfig` の固定幅指定 (`trigger-definitions.mdx:1305-1316` の Sizing & Layout):

```json
"BTTTouchBarButtonUseFixedWidth": 1,
"BTTTouchBarButtonWidth": 62
```

現行の ▲ / ▼ / esc / ⚙ には 62px を適用済み。絵文字 + 単語のボタン (🔍 Inspect) は
自動幅で十分な幅がある。**新しくボタンを足すときは、ラベルが記号だけなら固定幅を必ず付ける。**

この制約は「消えたボタンの隣を誤爆する」問題と地続きで、細いボタンが並ぶほど誤爆率が上がる。
条件付き表示を導入する場合は、固定幅とセットで考える。

**トグルではなく冪等な入口/出口にしたのが要点。** 「入る = 必ず ON」「抜ける = 必ず OFF」
なら、BTT が現在の状態を知らなくても結果が一意に決まる。トグルは状態を知らないと
結果が決まらないので、状態を持たない設計と噛み合わない。

---

## 5. 拡張側に必要な変更

### 5-1. コマンドの追加 (`wxt.config.ts`)

`suggested_key` は 4 枠しかないので、**配り方を決める**:

| コマンド | suggested_key | 理由 |
|----------|---------------|------|
| `toggle-inspect` | 既存のまま | キーボード派の既存導線。実機ではユーザーが ⌃I に手動割当済み |
| `toggle-tree` | `mac: MacCtrl+Shift+T` | 現在 Chrome 側未割当。`⌃T` は空き |
| `toggle-render` | `mac: MacCtrl+Shift+E` | **⌥⇧R は Screencastify 予約なので mac 分岐で必ず上書き**。`⌃R` は別拡張が使用中 |
| `exit-modes` | `mac: MacCtrl+Shift+X` | 非常口はキーボードからも押せるべき |
| `inspect-on` / `nav-parent` / `nav-child` / `toggle-record` | **無し** | 4 枠を超えるとマニフェストエラーで拡張ごと死ぬ。手動割当にする |

手動割当が 4 本必要になるのがこの設計の代償。§6 の doctor スクリプトで検出可能にする。

### 5-2. 配線 (既存の規約どおり)

- `entrypoints/background.ts` — `COMMANDS` の Set に 4 つ追加するだけ。中継ロジックは無変更
- `entrypoints/bridge.content.ts` — `onMessage` の分岐に追加。**`design-scan` の
  `return true` 経路は必ず後ろに残す** (非同期応答が壊れる)
- `entrypoints/inspector.content.ts` — メッセージ分岐を 4 本追加

CLAUDE.md 地雷 3 の「新モード = 4 点配線」は**不要**。モードではなくモード内操作なので、
`wxt.config` の commands と 3 箇所のハンドラで足りる。

### 5-3. ロジック (新規は 4 つだけ)

既存メソッドの公開化が主体で、新しく書くのは以下。

- **`Inspector.navigateOuter()` / `navigateInner()`** — `onKeyDown` の ↑↓ 本体を public に切り出す。
  先頭に `if (!this.enabled) return false;` を**明示的に**置く (キー経路はモード中しか
  リスナが張られないが、コマンドは任意のタイミングで来る)
- **`Inspector.seedSelection()`** — `currentElement` が無いときにビューポート中央の要素を選ぶ
  (`document.elementFromPoint(innerWidth/2, innerHeight/2)`、オーバーレイ自身は
  `overlay.containsTarget` で除外)。**これが無いと ▲ は「一度マウスを動かすまで無反応」のまま**で、
  Touch Bar だけで完結しない
- **`Inspector.firstInnerElement()`** — ▲ で遡っていなくても ▼ で降りられるようにする
- **`RenderDebugger.commandRecord()`** — `if (!this.enabled) return;` + `toggleRecording()`

**入口は 2 つ (キー / コマンド) でも実装は 1 つに保つ。** キー経路は薄いアダプタにする。

### 5-4. `exit-modes` の実装

```
for (let i = 0; i < 4 && closeTopmost(); i++);
```

`closeTopmost()` は既存の Esc チェーン (`inspector.onEscape() || renderDebugger.onEscape()
|| treeView.onEscape()`) を関数に括り出したもの。**回数上限は必須** — 将来 `onEscape()` が
状態を変えずに true を返す実装が混入すると無限ループになる。

これにより「実 Esc キーを送る」必要が無くなる。Esc は全画面・IME・モーダルを巻き込む
最大の副作用源なので、送らずに済むのは大きい。

### 5-5. i18n (地雷 1)

`cmdInspectOn` / `cmdNavParent` / `cmdNavChild` / `cmdToggleRecord` / `cmdExitModes` を
`public/_locales/{en,ja}/messages.json` の**両方**に追加。これらは manifest の `__MSG_` 参照で
`UiStrings` ではないので `src/types.ts` への追加は不要。`src/i18n.test.ts` が en/ja のキー集合
一致を機械検知するので、片方だけだと必ず落ちる。追加後は `pnpm wxt prepare` (地雷 2)。

---

## 6. 残る失敗モードと対処

| 失敗 | 対処 |
|------|------|
| ユーザーがキーを再割当 → BTT が古いキーを送り続ける | **`scripts/doctor-shortcuts.mjs`** を作る。Chrome の `Preferences` を読み取り専用でパースし、`.bttpreset` の `BTTShortcutToSend` と突き合わせてズレを非ゼロ終了で報告。BTT には拡張のバインドを読む手段が無いので、これが唯一の実効的な検出手段 |
| 未注入サイトで全ボタンが沈黙。理由がユーザーに伝わらない | ⚙︎ 設定ボタンで popup へ逃がす導線をグループ内に必ず置く |
| ページが `preventDefault()` でキーを飲む | 原理的に防げない。⚙︎ から popup 操作にフォールバック |
| 手動割当 4 本を忘れる | doctor スクリプト + `touchbar/README.md` の手順 |
| iframe への多重配信 | `background.ts` は `frameId` 無しで送るので全フレームに届く。↑↓ が window keydown からコマンドに変わると、複数フレーム同時 ON で挙動が変わりうる。**③目視の確認項目** |
| Touch Bar の面積 | 既存 16 項目 + 8 個はフラットに置けない。グループ化は選択肢ではなく前提 |

---

## 7. 将来: 見た目の整理を被せる (任意)

安全性をコードで解決した後なら、条件付き表示は**安全のためではなく見た目のため**になる。
多少ズレても実害が無いので、軽く作れる:

- グループ内で「今のモード」に応じて ▲▼ / ● REC を dim 表示にする
- そのときも **active 版と dim 版を同じ幅・同じ順で用意する**ペア方式にすれば、項目数が
  不変なので罠 b (繰り上がり) は原理的に起きない
- 条件付き項目を作るなら**順序は「常設を前、条件付きを後ろ」**。現行ドラフトの
  `▲=3 / ▼=4 / esc=5` は最悪の並びで、▲▼ が消えた瞬間に esc が 2 つ繰り上がる

---

## 8. 実装前に実機で確かめること

1. 旧 unpacked コピー `elhekbmalpieelpdnmfinooegmcgfann` を削除する (⌥⇧I を握っている)
2. `pnpm build` → 拡張を ⟳ → `chrome://extensions/shortcuts` で 4 コマンドの実バインドを確認
3. 手動割当 4 本 (`inspect-on` / `nav-parent` / `nav-child` / `toggle-record`)
4. `export_preset "Default"` で BTT 設定を退避してから import
5. Touch Bar グループが既存の Claude Code ボタン群と共存できるか目視
6. 複数 iframe のあるページで ▲▼ の挙動 (③目視)

---

## 9. この設計で捨てたもの

正直に書いておく。

- **Touch Bar 上に状態が出ない。** 今インスペクト中かはページを見て判断する
  (モードピル・常設コントロール・ツリーパネルが全モードにあるのでカバーはできている)
- **手動セットアップが増える。** `suggested_key` 4 枠の制約で、4 コマンドは手動割当
- **「押しても何も起きない」は残る。** ただし「押したら意図しない副作用が起きた」は
  原理的に消える。この交換が設計の核心
