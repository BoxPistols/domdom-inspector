#!/usr/bin/env node
// Touch Bar の 3 ウィジェットを定義し、(1) リポジトリ同梱の .bttpreset を書き出し、
// (2) 実機の BTT を同じ内容に作り直し、(3) 更新後の実機を読み直して検算する。
//
//   node touchbar/install.mjs --plan     何を消して何を作るか出すだけ (実機に触らない)
//   node touchbar/install.mjs            実機に反映
//   node touchbar/install.mjs --preset   .bttpreset の書き出しだけ
//   node touchbar/install.mjs --verify   実機の現状を期待値と突き合わせるだけ
//
// **定義をここ 1 箇所に置く理由**: 以前はプリセットが「実機からのエクスポート」で、
// 実機とリポジトリのどちらが正か決まっていなかった。実機もプリセットもここから作る。
//
// **update_trigger ではなく delete + add にした理由**: update_trigger は
// BTTActionsToExecute を空配列で上書きしても**旧サブアクションを消さない** (実測)。
// 旧 264 (キー送信) が残ると、押下時の front 再照合を素通りしてキーが直接飛ぶ。
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const HOME = homedir()
const BTT_DIR = join(HOME, '.claude', 'btt')
const MARKER = 'domdom-touchbar' // これが付いたトリガーだけを消す

// 幅は Auto (固定幅は隠したときに空の箱が残るので使えない)。**3 つのラベルの表示幅を
// 揃えることで幅を合わせる。** MAX_PX はラベル本文の上限で、ボタンは左右に約 22px の
// パディングが付くので 68px なら 90px 相当。共有 3 プロジェクトの下限 70px を上回る
const MAX_PX = 68
const GAP = 4
// 展開/畳みで列の長さが変わるため、**Touch Bar の最後尾に置く**。前に置くと
// 伸縮のたびに後続 (macenv 0〜55 / local-ui-builder 200〜201) が横へ動き、隣を踏む
const ORDER_BASE = 300

const BLUE = '22,104,212,255'
const GRAY = '74,81,99,255'

// ---------------------------------------------------------------------------
// Chrome の実バインドを読む
//
// **キーを固定値で持たない。** 拡張のショートカットは chrome://extensions/shortcuts で
// ユーザーが自由に変えられる。固定値で持つと、変えられた瞬間に「押せるのに誰も
// 聞いていないキーを送る」= 黙って無反応になる。2026-08-15 に実際に発生した
// (Touch Bar は ⌃I / ⌃D を送っていたが、実バインドは ⌥I / ⌥D だった)。
// ---------------------------------------------------------------------------
const CHROME_DIR = join(HOME, 'Library', 'Application Support', 'Google', 'Chrome')
const PROFILES = ['Default', 'Profile 1', 'Profile 2', 'Profile 3']

// macOS の仮想キーコード。Chrome のキー名 → コード
const KEYCODE = {
  A: 0, S: 1, D: 2, F: 3, H: 4, G: 5, Z: 6, X: 7, C: 8, V: 9, B: 11, Q: 12, W: 13,
  E: 14, R: 15, Y: 16, T: 17, O: 31, U: 32, I: 34, P: 35, L: 37, J: 38, K: 40,
  N: 45, M: 46,
  1: 18, 2: 19, 3: 20, 4: 21, 5: 23, 6: 22, 7: 26, 8: 28, 9: 25, 0: 29,
  Equal: 24, Minus: 27, RightBracket: 30, LeftBracket: 33, Quote: 39, Semicolon: 41,
  Backslash: 42, Comma: 43, Slash: 44, Period: 47, Grave: 50,
  Return: 36, Enter: 36, Tab: 48, Space: 49, Delete: 51, Backspace: 51, Escape: 53,
  Home: 115, PageUp: 116, End: 119, PageDown: 121,
  Left: 123, Right: 124, Down: 125, Up: 126,
}
// Chrome の修飾子名 → BTT の修飾キーコード。**macOS では `Ctrl` は Command を意味し、
// 実 Control は `MacCtrl`** (公式ドキュメント)。ここを取り違えると全部ズレる
const MODCODE = { Ctrl: 55, Command: 55, Cmd: 55, MacCtrl: 59, Alt: 58, Option: 58, Shift: 56 }

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

// unpacked の拡張 ID はパス由来なので、名前ではなく**パス**で引く
function findExtension() {
  for (const prof of PROFILES) {
    const sec = readJson(join(CHROME_DIR, prof, 'Secure Preferences'))
    const settings = sec?.extensions?.settings
    if (!settings) continue
    for (const [id, v] of Object.entries(settings)) {
      if (String(v?.path ?? '').includes('domdom-inspector')) return { profile: prof, id }
    }
  }
  return null
}

// "mac:Alt+I" → "58,34" (修飾キーコードを降順に並べてから標準キーコード)
function toBttKeys(accel) {
  const parts = accel.split('+')
  const keyName = parts.pop()
  const key = KEYCODE[keyName]
  if (key === undefined) throw new Error(`Chrome のキー名 "${keyName}" を仮想キーコードに変換できない (KEYCODE に足す)`)
  const mods = parts.map((m) => {
    const c = MODCODE[m]
    if (c === undefined) throw new Error(`Chrome の修飾子 "${m}" を解釈できない`)
    return c
  })
  return [...new Set(mods)].sort((a, b) => b - a).concat(key).join(',')
}

function chromeKeys() {
  const ext = findExtension()
  if (!ext) {
    throw new Error('Chrome の設定から domdom-inspector を見つけられない。\n' +
      '  拡張が読み込まれていないか、パスに "domdom-inspector" を含んでいない。\n' +
      '  chrome://extensions で unpacked が読み込まれているか確認する')
  }
  const prefs = readJson(join(CHROME_DIR, ext.profile, 'Preferences'))
  const commands = prefs?.extensions?.commands ?? {}
  const found = {}
  for (const [accel, v] of Object.entries(commands)) {
    if (v?.extension !== ext.id) continue
    const [platform, rest] = accel.includes(':') ? [accel.slice(0, accel.indexOf(':')), accel.slice(accel.indexOf(':') + 1)] : ['default', accel]
    if (platform !== 'mac' && platform !== 'default') continue
    found[v.command_name] = { accel: rest, keys: toBttKeys(rest) }
  }
  // **未割当は黙って通さない。** ここで落とさないと「押せるのに無反応」に戻る
  const missing = ['toggle-inspect', '_execute_action'].filter((c) => !found[c])
  if (missing.length) {
    throw new Error(`Chrome にショートカットが割り当てられていないコマンドがある: ${missing.join(' / ')}\n` +
      `  拡張 ${ext.id} (${ext.profile})\n` +
      '  chrome://extensions/shortcuts で割り当ててから流し直す')
  }
  return { ext, found }
}

const CHROME = chromeKeys()
console.log(`chrome  実バインド: ${CHROME.ext.id} (${CHROME.ext.profile})`)
for (const [cmd, v] of Object.entries(CHROME.found)) console.log(`          ${cmd.padEnd(16)} ${v.accel.padEnd(14)} -> ${v.keys}`)

// ---------------------------------------------------------------------------
// ラベル (ロケール別)
//
// **シェルスクリプトに直書きしない。** 日本語決め打ちだと英語環境で読めない。
// 拡張自体が en/ja を出し分けているのに Touch Bar だけ日本語、という不整合になる。
// ---------------------------------------------------------------------------
const LABELS = readJson(join(HERE, 'labels.json'))
if (!LABELS) throw new Error('touchbar/labels.json を読めない')

function pickLang() {
  if (process.env.DOMDOM_TB_LANG) return process.env.DOMDOM_TB_LANG
  try {
    const loc = execFileSync('/usr/bin/defaults', ['read', '-g', 'AppleLocale'], { encoding: 'utf8' }).trim()
    const lang = loc.split(/[_-]/)[0]
    if (LABELS[lang]) return lang
  } catch { /* システムのロケールが読めなければ en に落とす */ }
  return 'en'
}
const LANG = pickLang()
const RAW = LABELS[LANG]
if (!RAW) throw new Error(`labels.json に "${LANG}" が無い`)

// 全角 ≒ 12px / 半角 ≒ 7px / 半角空白 ≒ 3.3px (12pt)。**推定**なので、
// 実際に揃っているかの判定は実機の見た目でしか取れない
const textPx = (s) => [...s].reduce((n, ch) => n + (ch === ' ' ? 3.3 : /[\x20-\x7e]/.test(ch) ? 7 : 12), 0)

// **幅は固定指定ではなくラベルの表示幅で揃える** (固定幅は隠したときに空の箱が残る)。
// 短いラベルの両側に空白を足して一番広いものに寄せる。BTT は文字を中央に置くので
// 両側に均等に足す。日本語は全角 4 文字で元から一致するのでパディングは入らない
function padToWidest(labels) {
  const target = Math.max(...Object.values(labels).map(textPx))
  const out = {}
  for (const [k, v] of Object.entries(labels)) {
    let t = v
    while (textPx(t) + 6.6 <= target + 1.7) t = ` ${t} `
    out[k] = t
  }
  return out
}
const L = padToWidest(RAW)
console.log(`labels  ロケール: ${LANG} (DOMDOM_TB_LANG で上書きできる)`)

// keys は Chrome の実バインド由来。esc だけは拡張のコマンドではないので Escape 固定
//
// **interval はロールごとに変える。** 押した直後に展開が見えないと壊れて見えるので
// esc / prefs は速く回す。root は front を引くのに `lsappinfo` を 2 回起動する
// (実測 25.8ms/回) ので速くできない。esc / prefs は印を読むだけ (5.8 / 4.5ms)。
// `refresh_widget` で即時反映する案は **実測で無効**だった (20 回叩いてもスクリプトの
// 実行回数が増えない) ので、間隔を詰める以外に手が無い
//
// **並び順 = 配列順。`設定` を `検査終了` より左に置く。** `設定` は常設、`検査終了` は
// 展開時だけなので、`検査終了` を右端にすると増減が右の余白で起きて他のボタンが動かない。
// 逆順 (`要素検査`/`検査終了`/`設定`) だと展開・畳みのたびに `設定` が 94pt 横へ動き、
// `検査終了` を 2 回叩いたときの 2 回目が `設定` に当たる
const BUTTONS = [
  { role: 'root', uuid: 'CE20C5C7-E8E6-4B2C-A5A0-4219DE0415C3', label: L.root, color: BLUE, keys: CHROME.found['toggle-inspect'].keys, interval: 1 },
  // 常設。表示は root が書く front の印に従うだけなので、速く回す意味がない
  { role: 'prefs', uuid: '82EEC69E-B0F4-402C-A76E-446F2592830B', label: L.prefs, color: GRAY, keys: CHROME.found['_execute_action'].keys, interval: 1 },
  // 押した直後に出る必要があるのはこれだけ
  { role: 'esc', uuid: 'E883654B-F93C-4813-A512-7D1074B8FFD2', label: L.esc, color: GRAY, keys: String(KEYCODE.Escape), interval: 0.3 },
]

const trigger = (b, i) => ({
  BTTTriggerType: 642,
  BTTTriggerTypeDescriptionReadOnly: 'シェルスクリプト / タスクウィジェット',
  BTTTriggerTypeDescription: b.label,
  BTTTriggerClass: 'BTTTriggerTypeTouchBar',
  BTTUUID: b.uuid, // プリセット用。実機へ渡す前に落とす (BTT が採番する)
  // 137 = ターミナルコマンドを実行 (非同期)。264 を直接持たせると front 再照合の
  // 隙間が塞げない。**BTTShellScriptWidgetGestureConfig はトップレベル**に置く
  // (BTTTriggerConfig の中に入れるとスクリプトが一切実行されない)
  BTTPredefinedActionType: 137,
  BTTPredefinedActionName: 'ターミナルコマンドを実行（非同期、ノンブロッキング）',
  BTTTerminalCommand: `/bin/bash "$HOME/.claude/btt/domdom-press.sh" ${b.role}`,
  BTTShellScriptWidgetGestureConfig: '/bin/bash:::-c',
  BTTNotes: MARKER,
  BTTOrder: ORDER_BASE + i,
  BTTMergeIntoTouchBarGroups: 0,
  BTTWidgetName: b.label,
  BTTTriggerConfig: {
    BTTTouchBarButtonCornerRadius: 6,
    BTTTouchBarItemPlacement: 0,
    BTTTouchBarShellScriptString: `. "$HOME/.claude/btt/domdom-widget.sh" ${b.role}`,
    BTTTouchBarAlwaysShowButton: false,
    BTTTouchBarButtonFontSize: 12,
    // **固定幅 (BTTTouchBarButtonUseFixedWidth + BTTTouchBarButtonWidth) は使わない。**
    // 幅は揃うが、`hidden: true` を返したときに枠だけ残って**ラベルの無い空のボタン**が
    // 描かれる (実機の写真で 2 度発生)。隠れることの方が優先なので Auto に任せ、
    // **幅はラベルの表示幅を揃えることで合わせる** (labels.json / 下の検算)。
    // 固定幅を付けていない local-ui-builder の 200/201 は同じ条件で綺麗に消えている
    BTTTouchBarFreeSpaceAfterButton: GAP,
    BTTTouchBarScriptUpdateInterval: b.interval,
  },
  BTTBelongsToApp: 'Global',
})

const TRIGGERS = BUTTONS.map(trigger)

const osa = (script, ...args) =>
  execFileSync('/usr/bin/osascript',
    ['-e', `on run argv\ntell application "BetterTouchTool" to ${script}\nend run`, ...args],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()

// 保存用は "$HOME"、実機へ渡すときだけ実パスへ展開する (macenv の cc-provision と同じ作法)
const localize = (o) => JSON.parse(JSON.stringify(o).split('$HOME').join(HOME))

function liveTriggers() {
  const raw = osa('get_triggers "{}"')
  try {
    // get_triggers の JSON は生の制御文字などで壊れることがある。
    // 素朴な正規表現で直そうとすると別の場所を壊すので、直せたふりをしない
    return JSON.parse(raw)
  } catch (e) {
    throw new Error(`get_triggers の JSON を解釈できません: ${e.message}`)
  }
}

// 親トリガーと BTTActionsToExecute の子レコードが同列に返るので、
// BTTTriggerType の有無で親だけを取る
const mine = (all) => all.filter((t) => t.BTTTriggerType === 642 && t.BTTNotes === MARKER)

function writePreset() {
  const preset = {
    BTTPresetName: 'DomDom Inspector Touch Bar',
    BTTPresetColor: '22.000000, 104.000000, 212.000000, 255.000000',
    BTTPresetUUID: '5C0E4B1E-4F1A-4C64-9C1E-DOMDOM000001',
    BTTPresetContent: [{
      BTTAppBundleIdentifier: 'BT.G',
      BTTAppName: 'Global',
      BTTAppAutoInvertIcon: 1,
      BTTAppSpecificSettings: { BTTDisableGlobalTriggers: false },
      BTTTriggers: TRIGGERS.map((t) => ({ BTTTriggerBelongsToPreset: 'Default', ...t })),
    }],
    BTTPresetSnapAreas: [],
  }
  const out = join(HERE, 'domdom-inspector.bttpreset')
  writeFileSync(out, JSON.stringify(preset, null, 2) + '\n')
  console.log(`preset  書き出し: ${out}`)
}

// **必ず temp → rename で置く。** BTT は 1 秒ごとにこのファイルを source しているので、
// 直接上書きすると書き込み途中の半端なファイルを読む。読まれた瞬間の出力は空になり、
// Touch Bar には**ラベルの無い空のボタン**が出る (2026-08-15 に実機の写真で発生)。
// rename は同一ボリュームなら原子的なので、BTT は必ず新旧どちらか完全な方を読む
function placeAtomic(dest, write) {
  const tmp = `${dest}.tmp`
  write(tmp)
  chmodSync(tmp, 0o755)
  renameSync(tmp, dest)
  console.log(`script  配置: ${dest}`)
}

function installScripts() {
  mkdirSync(BTT_DIR, { recursive: true })
  for (const name of ['domdom-widget.sh', 'domdom-press.sh']) {
    placeAtomic(join(BTT_DIR, name), (tmp) => copyFileSync(join(HERE, name), tmp))
  }
  // 送るキー。domdom-press.sh はここだけを見る (シェルに直書きしない)
  placeAtomic(join(BTT_DIR, 'domdom.keys'),
    (tmp) => writeFileSync(tmp, BUTTONS.map((b) => `${b.role}=${b.keys}`).join('\n') + '\n'))
  // ラベル。domdom-widget.sh はここだけを見る (ロケール別なので直書きできない)
  placeAtomic(join(BTT_DIR, 'domdom.labels'),
    (tmp) => writeFileSync(tmp, BUTTONS.map((b) => `${b.role}=${b.label}`).join('\n') + '\n'))
}

function plan() {
  const found = mine(liveTriggers())
  console.log(`\n消す対象 (BTTNotes="${MARKER}" かつ 642 のみ): ${found.length} 件`)
  for (const t of found) {
    console.log(`  - ${String(t.BTTWidgetName).padEnd(10)} order=${String(t.BTTOrder).padEnd(4)} width=${t.BTTTriggerConfig?.BTTTBWidgetWidth} uuid=${t.BTTUUID}`)
  }
  console.log(`\n作るもの: ${TRIGGERS.length} 件`)
  for (const t of TRIGGERS) {
    console.log(`  + ${String(t.BTTWidgetName).padEnd(10)} order=${String(t.BTTOrder).padEnd(4)} width=${t.BTTTriggerConfig.BTTTBWidgetWidth} cmd=${t.BTTTerminalCommand}`)
  }
  return found
}

function push() {
  for (const t of plan()) {
    osa('delete_trigger (item 1 of argv)', t.BTTUUID)
    console.log(`btt     削除: ${t.BTTWidgetName} (${t.BTTUUID})`)
  }
  for (const t of TRIGGERS) {
    // add_new_trigger は BTTUUID を受け付けない (BTT が採番して返す)。
    // BTTActionsToExecute は付けない — 付けると旧来の 264 直送に戻る
    const { BTTUUID: _drop, ...body } = t
    const uuid = osa('add_new_trigger (item 1 of argv)', JSON.stringify(localize(body)))
    if (uuid.length !== 36) throw new Error(`${t.BTTWidgetName} の作成に失敗: ${uuid}`)
    console.log(`btt     作成: ${String(t.BTTWidgetName).padEnd(10)} -> ${uuid}`)
  }
}

function verify() {
  let all
  try {
    all = liveTriggers()
  } catch (e) {
    console.error(`NG  ${e.message}`)
    return 1
  }
  const live = new Map(mine(all).map((t) => [t.BTTWidgetName, t]))
  let bad = 0

  // **定義そのものの検査は実機の有無と無関係に先に回す。**
  // 実機の照合ループの中に入れると、ラベルを変えた回 (= 実機に同名が無く continue する回)
  // にちょうど素通りする。絵文字と幅の検査が一番効いてほしいのはその回
  const emoji = /\p{Extended_Pictographic}|[︎️]/u
  for (const want of TRIGGERS) {
    const name = want.BTTWidgetName
    if (emoji.test(name)) { console.error(`NG  ${name}: ラベルに絵文字が入っている (domdom-widget.sh の L_* を直す)`); bad++ }
    if (textPx(name) > MAX_PX) { console.error(`NG  ${name}: ラベルが長すぎる (推定 ${textPx(name)}px > ${MAX_PX}px)`); bad++ }
  }
  // **幅は固定指定ではなくラベルの表示幅で揃える。** ここがズレると実機で幅がバラつく
  const pxs = TRIGGERS.map((t) => [t.BTTWidgetName, textPx(t.BTTWidgetName)])
  const spread = Math.max(...pxs.map((p) => p[1])) - Math.min(...pxs.map((p) => p[1]))
  if (spread > 4) {
    console.error(`NG  ラベルの推定表示幅が揃っていない (差 ${spread.toFixed(1)}px): ` +
      pxs.map(([n, p]) => `${n}=${p.toFixed(1)}`).join(' / '))
    bad++
  } else {
    console.log(`labels  推定表示幅: ${pxs.map(([n, p]) => `${n}=${p.toFixed(1)}px`).join(' / ')} (差 ${spread.toFixed(1)}px)`)
  }

  for (const want of TRIGGERS) {
    const name = want.BTTWidgetName
    const got = live.get(name)
    if (!got) { console.error(`NG  ${name}: 実機に見つからない`); bad++; continue }
    const wantLocal = localize(want)
    const checks = [
      ['ラベル', got.BTTWidgetName, wantLocal.BTTWidgetName],
      ['order', got.BTTOrder, wantLocal.BTTOrder],
      ['アクション種別', got.BTTPredefinedActionType, wantLocal.BTTPredefinedActionType],
      ['実行コマンド', got.BTTTerminalCommand, wantLocal.BTTTerminalCommand],
      ['表示スクリプト', got.BTTTriggerConfig?.BTTTouchBarShellScriptString, wantLocal.BTTTriggerConfig.BTTTouchBarShellScriptString],
      ['gestureConfig(トップ)', got.BTTShellScriptWidgetGestureConfig, wantLocal.BTTShellScriptWidgetGestureConfig],
      ['更新間隔', got.BTTTriggerConfig?.BTTTouchBarScriptUpdateInterval, wantLocal.BTTTriggerConfig.BTTTouchBarScriptUpdateInterval],
    ]
    for (const [what, a, b] of checks) {
      if (a !== b) { console.error(`NG  ${name}: ${what} が ${JSON.stringify(a)} (期待 ${JSON.stringify(b)})`); bad++ }
    }
    // 264 のサブアクションが残っていると front 再照合を素通りしてキーが飛ぶ
    const subs = got.BTTActionsToExecute ?? []
    if (subs.length) { console.error(`NG  ${name}: 旧サブアクションが ${subs.length} 件残っている (front 再照合を素通りする)`); bad++ }
    // 表示スクリプトの側にも絵文字が紛れていないこと (旧構成はラベルを
    // インラインの printf に直書きしていたので、そこに残る形がありえた)
    const sh = got.BTTTriggerConfig?.BTTTouchBarShellScriptString
    if (typeof sh === 'string' && emoji.test(sh)) { console.error(`NG  ${name}: 表示スクリプトに絵文字が残っている: ${JSON.stringify(sh)}`); bad++ }
  }
  const extra = mine(all).filter((t) => !TRIGGERS.some((w) => w.BTTWidgetName === t.BTTWidgetName))
  for (const t of extra) { console.error(`NG  余計な domdom トリガーが残っている: ${t.BTTWidgetName} (${t.BTTUUID})`); bad++ }

  // 固定幅を残すと隠したときに空の箱が出る。消し忘れを機械で止める
  for (const t of mine(all)) {
    const c = t.BTTTriggerConfig ?? {}
    if (c.BTTTouchBarButtonUseFixedWidth) { console.error(`NG  ${t.BTTWidgetName}: 固定幅が残っている (隠したときに空の箱が出る)`); bad++ }
  }

  // 送るキーが Chrome の実バインドと一致しているか。**ここがこの道具の要**で、
  // ズレると「押せるのに無反応」という一番わかりにくい壊れ方をする
  const keysPath = join(BTT_DIR, 'domdom.keys')
  let keysText = ''
  try { keysText = readFileSync(keysPath, 'utf8') } catch { console.error(`NG  ${keysPath} が無い (node touchbar/install.mjs を流す)`); bad++ }
  const installed = Object.fromEntries(
    keysText.split('\n').filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
  for (const b of BUTTONS) {
    if (installed[b.role] !== b.keys) {
      console.error(`NG  ${b.label}: 送るキーが ${JSON.stringify(installed[b.role])} (Chrome の実バインドは ${b.keys})`)
      bad++
    }
  }
  // ラベルファイル。欠けるとウィジェットは (空表示ではなく) 隠れる
  const labPath = join(BTT_DIR, 'domdom.labels')
  let labText = ''
  try { labText = readFileSync(labPath, 'utf8') } catch { console.error(`NG  ${labPath} が無い`); bad++ }
  const labs = Object.fromEntries(labText.split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
  for (const b of BUTTONS) {
    if (labs[b.role] !== b.label) {
      console.error(`NG  ${b.role}: 配置済みラベルが ${JSON.stringify(labs[b.role])} (期待 ${JSON.stringify(b.label)})`)
      bad++
    }
  }

  if (bad) { console.error(`\n検算: NG ${bad} 件`); return 1 }
  console.log(`\n検算: OK — order ${ORDER_BASE}〜${ORDER_BASE + 2} / 固定幅なし / ラベル幅そろい / 絵文字なし / 旧サブアクションなし / キーとラベルは実バインドと labels.json に一致`)
  return 0
}

const argv = process.argv.slice(2)
if (argv.includes('--verify')) process.exit(verify())
if (argv.includes('--plan')) { plan(); process.exit(0) }
writePreset()
if (argv.includes('--preset')) process.exit(0)
installScripts()
push()
console.log('')
const rc = verify()
console.log('\n※ Shell Script Widget を作り直したので、Touch Bar の実描画には BTT の再起動が要る。')
process.exit(rc)
