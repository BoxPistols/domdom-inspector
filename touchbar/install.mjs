#!/usr/bin/env node
// Touch Bar の 3 ウィジェットを定義し、(1) 実機の BTT を作り直し、(2) 読み直して検算する。
//
//   node touchbar/install.mjs --plan     何を消して何を作るか出すだけ (実機に触らない)
//   node touchbar/install.mjs            実機に反映
//   node touchbar/install.mjs --verify   実機の現状を期待値と突き合わせるだけ
//   node touchbar/install.mjs --preset   同梱 .bttpreset を書き出すだけ
//
// **定義をここ 1 箇所に置く理由**: 以前はプリセットが「実機からのエクスポート」で、
// 実機とリポジトリのどちらが正か決まっていなかった。実機もプリセットもここから作る。
//
// **update_trigger ではなく delete + add にした理由**: update_trigger は
// BTTActionsToExecute を空配列で上書きしても**旧サブアクションを消さない** (実測)。
// 旧 264 (キー送信) が残ると、押下時の front 再照合を素通りしてキーが直接飛ぶ。
//
// **純粋ロジックは lib.mjs に置く。** このファイルは import しただけでは何もしない
// (以前は module 読み込み時に Chrome を読みに行っていて、テストも --preset もできなかった)。
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  KEYCODE, SPREAD_TOLERANCE_PX, hasEmoji, padToWidest, splitPlatform, textPx, toBttKeys, widthSpread,
} from './lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const HOME = homedir()
const BTT_DIR = join(HOME, '.claude', 'btt')
const MARKER = 'domdom-touchbar' // これが付いたトリガーだけを消す
const SCRIPTS = ['domdom-widget.sh', 'domdom-press.sh']

// 幅は Auto (固定幅は隠したときに空の箱が残るので使えない)。**3 つのラベルの表示幅を
// 揃えることで幅を合わせる。** MAX_PX はラベル本文の上限で、ボタンは左右に約 22px の
// パディングが付くので 68px なら 90px 相当。共有 3 プロジェクトの下限 70px を上回る
const MAX_PX = 68
const GAP = 4
// 展開/畳みで列の長さが変わるため、**Touch Bar の最後尾に置く**。前に置くと
// 伸縮のたびに後続 (macenv 0〜55 / local-ui-builder 200〜201) が横へ動き、隣を踏む
const ORDER_BASE = 300

const CHROME_DIR = join(HOME, 'Library', 'Application Support', 'Google', 'Chrome')

// ロールの定義。UUID はプリセット用の固定値 (実機は BTT が採番する)。
// `required: false` は「Chrome 側に割当が無ければそのボタンを作らない」の意味
const ROLES = [
  { role: 'root', uuid: 'CE20C5C7-E8E6-4B2C-A5A0-4219DE0415C3', command: 'toggle-inspect', required: true, interval: 1 },
  // 常設。表示は root が書く front の印に従うだけなので、速く回す意味がない
  { role: 'prefs', uuid: '82EEC69E-B0F4-402C-A76E-446F2592830B', command: '_execute_action', required: false, interval: 1 },
  // 押した直後に出る必要があるのはこれだけ。Escape は拡張のコマンドではないので固定
  { role: 'esc', uuid: 'E883654B-F93C-4813-A512-7D1074B8FFD2', fixedKeys: String(KEYCODE.Escape), interval: 0.3 },
]

const readJson = (path) => {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}
const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12)

const osa = (script, ...args) =>
  execFileSync('/usr/bin/osascript',
    ['-e', `on run argv\ntell application "BetterTouchTool" to ${script}\nend run`, ...args],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()

// ---------------------------------------------------------------------------
// Chrome の実バインドを読む
//
// **キーを固定値で持たない。** 拡張のショートカットは chrome://extensions/shortcuts で
// ユーザーが自由に変えられる。固定値で持つと、変えられた瞬間に「押せるのに誰も
// 聞いていないキーを送る」= 黙って無反応になる。2026-08-15 に実際に発生した
// (Touch Bar は ⌃I / ⌃D を送っていたが、実バインドは ⌥I / ⌥D だった)。
// ---------------------------------------------------------------------------

// プロファイル名は決め打ちにしない (Profile 4 以降に入れている人を「読み込まれていない」
// と誤って突き放す)。`Secure Preferences` を持つディレクトリを全部見る
function listProfiles() {
  try {
    return readdirSync(CHROME_DIR).filter((d) => {
      try { return statSync(join(CHROME_DIR, d, 'Secure Preferences')).isFile() } catch { return false }
    })
  } catch { return [] }
}

// unpacked の拡張 ID はパス由来なので、名前ではなく**パス**で引く。
// **先勝ちにしない。** `.output/chrome-mv3` も同じ語をパスに含むので、両方を
// unpacked で読み込んでいると「どちらのキーを書くか」が実行順で決まってしまう
function findExtensions() {
  const hits = []
  for (const prof of listProfiles()) {
    const settings = readJson(join(CHROME_DIR, prof, 'Secure Preferences'))?.extensions?.settings
    if (!settings) continue
    for (const [id, v] of Object.entries(settings)) {
      const path = String(v?.path ?? '')
      if (path.includes('domdom-inspector')) hits.push({ profile: prof, id, path, enabled: v?.state !== 0 })
    }
  }
  return hits
}

function chromeKeys() {
  const hits = findExtensions()
  if (hits.length === 0) {
    throw new Error('Chrome の設定から domdom-inspector を見つけられない。\n' +
      `  見たプロファイル: ${listProfiles().join(', ') || '(なし)'}\n` +
      '  chrome://extensions で unpacked が読み込まれているか確認する')
  }
  if (hits.length > 1) {
    // ここで黙って 1 つ選ぶと、別コピーのキーを書き込んで「押せるのに無反応」に戻る
    throw new Error('domdom-inspector が複数見つかった。どれのキーを使うか決められない。\n' +
      hits.map((h) => `  - ${h.id} (${h.profile}${h.enabled ? '' : ', 無効'}) ${h.path}`).join('\n') +
      '\n  chrome://extensions で使わない方を削除してから流し直す')
  }
  const ext = hits[0]
  const commands = readJson(join(CHROME_DIR, ext.profile, 'Preferences'))?.extensions?.commands ?? {}
  const found = {}
  for (const [entry, v] of Object.entries(commands)) {
    if (v?.extension !== ext.id) continue
    const { platform, accel } = splitPlatform(entry)
    if (platform !== 'mac' && platform !== 'default') continue
    // **mac が default に勝つ。** 後勝ちにすると、順序次第で mac 以外の割当を拾う
    const prev = found[v.command_name]
    if (prev && prev.platform === 'mac' && platform !== 'mac') continue
    found[v.command_name] = { platform, accel, keys: toBttKeys(accel) }
  }
  return { ext, found }
}

// ---------------------------------------------------------------------------
// ラベル (ロケール別)
//
// **シェルスクリプトに直書きしない。** 日本語決め打ちだと英語環境で読めない。
// 拡張自体が en/ja を出し分けているのに Touch Bar だけ日本語、という不整合になる。
// ---------------------------------------------------------------------------
function pickLang(labels) {
  if (process.env.DOMDOM_TB_LANG) return process.env.DOMDOM_TB_LANG
  try {
    const loc = execFileSync('/usr/bin/defaults', ['read', '-g', 'AppleLocale'], { encoding: 'utf8' }).trim()
    const lang = loc.split(/[_-]/)[0]
    if (labels[lang]) return lang
  } catch { /* システムのロケールが読めなければ en に落とす */ }
  return 'en'
}

// ---------------------------------------------------------------------------
// 定義の組み立て
// ---------------------------------------------------------------------------
function build() {
  const labels = readJson(join(HERE, 'labels.json'))
  if (!labels) throw new Error('touchbar/labels.json を読めない')
  const lang = pickLang(labels)
  const raw = labels[lang]
  if (!raw) throw new Error(`labels.json に "${lang}" が無い`)

  const chrome = chromeKeys()
  const notes = []

  const buttons = []
  for (const r of ROLES) {
    let keys = r.fixedKeys
    if (!keys) {
      const hit = chrome.found[r.command]
      if (!hit) {
        // **未割当を黙って既定値で埋めない** (それが「押せるのに無反応」の作り方)。
        // 必須なら止める / 任意ならボタンごと作らない
        const how = `chrome://extensions/shortcuts で "${r.command}" に割り当ててから流し直す`
        if (r.required) throw new Error(`Chrome に "${r.command}" のショートカットが無い。\n  拡張 ${chrome.ext.id} (${chrome.ext.profile})\n  ${how}`)
        notes.push(`注意: "${r.command}" が未割当なので ${r.role} のボタンを作らない。${how}`)
        continue
      }
      keys = hit.keys
    }
    buttons.push({ ...r, keys, rawLabel: raw[r.role] })
  }
  if (buttons.some((b) => b.rawLabel === undefined)) {
    throw new Error(`labels.json の "${lang}" に足りないロールがある: ` +
      buttons.filter((b) => b.rawLabel === undefined).map((b) => b.role).join(' / '))
  }

  // 幅は「表示幅を揃える」ことで合わせるので、実際に作るボタンだけで揃える
  const padded = padToWidest(Object.fromEntries(buttons.map((b) => [b.role, b.rawLabel])))
  for (const b of buttons) b.label = padded[b.role]

  return { lang, chrome, buttons, notes }
}

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
    // 描かれる (実機の写真で 2 度発生)。隠れることの方が優先なので Auto に任せる
    BTTTouchBarFreeSpaceAfterButton: GAP,
    BTTTouchBarScriptUpdateInterval: b.interval,
  },
  BTTBelongsToApp: 'Global',
})

// 保存用は "$HOME"、実機へ渡すときだけ実パスへ展開する (macenv の cc-provision と同じ作法)
const localize = (o) => JSON.parse(JSON.stringify(o).split('$HOME').join(HOME))

// 親トリガーと BTTActionsToExecute の子レコードが同列に返るので、
// BTTTriggerType の有無で親だけを取る
const mine = (all) => all.filter((t) => t.BTTTriggerType === 642 && t.BTTNotes === MARKER)

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

// ---------------------------------------------------------------------------
// 定義そのものの検査。**実機を触る前に回す。**
// verify() の中だけに置くと、押し込んだ後にしか NG が出ない = 壊れた設定が実機に載る
// ---------------------------------------------------------------------------
function checkDefinitions(buttons) {
  let bad = 0
  for (const b of buttons) {
    if (hasEmoji(b.label)) { console.error(`NG  ${b.role}: ラベルに絵文字が入っている (labels.json を直す): ${JSON.stringify(b.label)}`); bad++ }
    if (textPx(b.label) > MAX_PX) { console.error(`NG  ${b.role}: ラベルが長すぎる (推定 ${textPx(b.label)}px > ${MAX_PX}px)`); bad++ }
  }
  const map = Object.fromEntries(buttons.map((b) => [b.role, b.label]))
  const spread = widthSpread(map)
  if (spread > SPREAD_TOLERANCE_PX) {
    console.error(`NG  ラベルの推定表示幅が揃っていない (差 ${spread.toFixed(1)}px > 許容 ${SPREAD_TOLERANCE_PX}px): ` +
      buttons.map((b) => `${b.label.trim()}=${textPx(b.label).toFixed(1)}`).join(' / '))
    bad++
  } else {
    console.log(`labels  推定表示幅: ${buttons.map((b) => `${b.label.trim()}=${textPx(b.label).toFixed(1)}px`).join(' / ')} (差 ${spread.toFixed(1)}px)`)
  }
  return bad
}

// ---------------------------------------------------------------------------
function writePreset(triggers) {
  const preset = {
    BTTPresetName: 'DomDom Inspector Touch Bar',
    BTTPresetColor: '22.000000, 104.000000, 212.000000, 255.000000',
    // 実在する 16 進の UUID にする (以前の値は O / M を含んでいて UUID として不正だった)
    BTTPresetUUID: '5C0E4B1E-4F1A-4C64-9C1E-D0D0D0000001',
    BTTPresetContent: [{
      BTTAppBundleIdentifier: 'BT.G',
      BTTAppName: 'Global',
      BTTAppAutoInvertIcon: 1,
      BTTAppSpecificSettings: { BTTDisableGlobalTriggers: false },
      BTTTriggers: triggers.map((t) => ({ BTTTriggerBelongsToPreset: 'Default', ...t })),
    }],
    BTTPresetSnapAreas: [],
  }
  const out = join(HERE, 'domdom-inspector.bttpreset')
  writeFileSync(out, JSON.stringify(preset, null, 2) + '\n')
  console.log(`preset  書き出し: ${out}`)
}

// **必ず temp → rename で置く。** BTT は毎秒このファイルを source しているので、
// 直接上書きすると書き込み途中の半端なファイルを読みうる。
// rename は同一ボリュームなら原子的なので、BTT は必ず新旧どちらか完全な方を読む
function placeAtomic(dest, write) {
  const tmp = `${dest}.tmp`
  write(tmp)
  chmodSync(tmp, 0o755)
  renameSync(tmp, dest)
  console.log(`script  配置: ${dest}`)
}

const kv = (pairs) => pairs.join('\n') + '\n'

function installScripts(buttons) {
  mkdirSync(BTT_DIR, { recursive: true })
  for (const name of SCRIPTS) {
    placeAtomic(join(BTT_DIR, name), (tmp) => copyFileSync(join(HERE, name), tmp))
  }
  // 送るキー。domdom-press.sh はここだけを見る (シェルに直書きしない)
  placeAtomic(join(BTT_DIR, 'domdom.keys'), (tmp) => writeFileSync(tmp, kv(buttons.map((b) => `${b.role}=${b.keys}`))))
  // ラベル。domdom-widget.sh はここだけを見る (ロケール別なので直書きできない)
  placeAtomic(join(BTT_DIR, 'domdom.labels'), (tmp) => writeFileSync(tmp, kv(buttons.map((b) => `${b.role}=${b.label}`))))
}

function plan(triggers) {
  const found = mine(liveTriggers())
  console.log(`\n消す対象 (BTTNotes="${MARKER}" かつ 642 のみ): ${found.length} 件`)
  for (const t of found) {
    console.log(`  - ${String(t.BTTWidgetName).padEnd(10)} order=${String(t.BTTOrder).padEnd(4)} uuid=${t.BTTUUID}`)
  }
  console.log(`\n作るもの: ${triggers.length} 件`)
  for (const t of triggers) {
    console.log(`  + ${String(t.BTTWidgetName).padEnd(10)} order=${String(t.BTTOrder).padEnd(4)} 間隔=${t.BTTTriggerConfig.BTTTouchBarScriptUpdateInterval}秒 cmd=${t.BTTTerminalCommand}`)
  }
  return found
}

function push(triggers) {
  for (const t of plan(triggers)) {
    osa('delete_trigger (item 1 of argv)', t.BTTUUID)
    console.log(`btt     削除: ${t.BTTWidgetName} (${t.BTTUUID})`)
  }
  for (const t of triggers) {
    // add_new_trigger は BTTUUID を受け付けない (BTT が採番して返す)。
    // BTTActionsToExecute は付けない — 付けると旧来の 264 直送に戻る
    const { BTTUUID: _drop, ...body } = t
    const uuid = osa('add_new_trigger (item 1 of argv)', JSON.stringify(localize(body)))
    if (uuid.length !== 36) {
      // 途中で落ちるとボタンが欠けた状態で残る。何が起きたかを名指しで出す
      throw new Error(`${t.BTTWidgetName} の作成に失敗: ${uuid}\n` +
        '  ここで止まると Touch Bar のボタンが欠けたままになる。BTT を再起動して流し直す')
    }
    console.log(`btt     作成: ${String(t.BTTWidgetName).padEnd(10)} -> ${uuid}`)
  }
}

function verify({ buttons, triggers }) {
  let bad = checkDefinitions(buttons)
  let all
  try {
    all = liveTriggers()
  } catch (e) {
    console.error(`NG  ${e.message}`)
    return bad + 1
  }
  const found = mine(all)
  // **件数を先に見る。** 名前でひくだけだと、同名の重複が Map に潰されて OK と出る
  if (found.length !== triggers.length) {
    console.error(`NG  実機の domdom トリガーが ${found.length} 件 (期待 ${triggers.length} 件)`)
    for (const t of found) console.error(`      ${t.BTTWidgetName} (${t.BTTUUID})`)
    bad++
  }
  const live = new Map(found.map((t) => [t.BTTWidgetName, t]))

  for (const want of triggers) {
    const name = want.BTTWidgetName
    const got = live.get(name)
    if (!got) { console.error(`NG  ${name}: 実機に見つからない`); bad++; continue }
    const wantLocal = localize(want)
    const checks = [
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
    if (hasEmoji(got.BTTTriggerConfig?.BTTTouchBarShellScriptString)) { console.error(`NG  ${name}: 表示スクリプトに絵文字が残っている`); bad++ }
    // 固定幅を残すと隠したときに空の箱が出る。消し忘れを機械で止める
    if (got.BTTTriggerConfig?.BTTTouchBarButtonUseFixedWidth) { console.error(`NG  ${name}: 固定幅が残っている (隠したときに空の箱が出る)`); bad++ }
  }
  for (const t of found) {
    if (!triggers.some((w) => w.BTTWidgetName === t.BTTWidgetName)) {
      console.error(`NG  余計な domdom トリガーが残っている: ${t.BTTWidgetName} (${t.BTTUUID})`); bad++
    }
  }

  // **配置済みのスクリプトがリポジトリと同じか。** ここを見ないと、.sh を直して
  // install を流し忘れたまま「検算: OK」と出る (ふるまいの大半はこの 2 本にある)
  for (const name of SCRIPTS) {
    let live8 = null
    try { live8 = sha(readFileSync(join(BTT_DIR, name))) } catch { /* 無い */ }
    const repo8 = sha(readFileSync(join(HERE, name)))
    if (live8 !== repo8) {
      console.error(`NG  ${name}: 配置済み(${live8 ?? '無し'}) がリポジトリ(${repo8}) と違う (install を流し直す)`)
      bad++
    }
  }

  // 送るキーとラベル。ズレると「押せるのに無反応」「空のボタン」になる
  for (const [file, key] of [['domdom.keys', 'keys'], ['domdom.labels', 'label']]) {
    const path = join(BTT_DIR, file)
    let text = ''
    try { text = readFileSync(path, 'utf8') } catch { console.error(`NG  ${path} が無い (install を流す)`); bad++ }
    const got = Object.fromEntries(text.split('\n').filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
    if (Object.keys(got).length && Object.keys(got).length !== buttons.length) {
      console.error(`NG  ${file}: ${Object.keys(got).length} 行 (期待 ${buttons.length} 行)`); bad++
    }
    for (const b of buttons) {
      if (got[b.role] !== b[key]) {
        console.error(`NG  ${file}: ${b.role} が ${JSON.stringify(got[b.role])} (期待 ${JSON.stringify(b[key])})`); bad++
      }
    }
  }

  if (bad) { console.error(`\n検算: NG ${bad} 件`); return bad }
  console.log(`\n検算: OK — ${triggers.length} 個 / order ${ORDER_BASE}〜${ORDER_BASE + triggers.length - 1} / 固定幅なし / ラベル幅そろい / 絵文字なし / 旧サブアクションなし / 配置済みスクリプトとキーとラベルが一致`)
  return 0
}

// ---------------------------------------------------------------------------
function main(argv) {
  const { lang, chrome, buttons, notes } = build()
  const triggers = buttons.map(trigger)

  console.log(`chrome  実バインド: ${chrome.ext.id} (${chrome.ext.profile})`)
  for (const [cmd, v] of Object.entries(chrome.found)) {
    console.log(`          ${cmd.padEnd(16)} ${`${v.platform}:${v.accel}`.padEnd(18)} -> ${v.keys}`)
  }
  console.log(`labels  ロケール: ${lang} (DOMDOM_TB_LANG で上書きできる)`)
  for (const n of notes) console.log(`        ${n}`)

  if (argv.includes('--verify')) return verify({ buttons, triggers }) ? 1 : 0
  if (argv.includes('--plan')) { checkDefinitions(buttons); plan(triggers); return 0 }
  // **プリセットは明示したときだけ書く。** ラベルはロケール由来なので、install の
  // ついでに書くと英語環境で流した人が追跡対象のファイルに意図しない差分を作る
  if (argv.includes('--preset')) { writePreset(triggers); return 0 }

  // 実機を触る前に定義を検算する。押し込んだ後に NG を出しても手遅れ
  if (checkDefinitions(buttons)) {
    console.error('\n定義が不正なので実機には触っていない。labels.json を直して流し直す。')
    return 1
  }
  installScripts(buttons)
  push(triggers)
  console.log('')
  const rc = verify({ buttons, triggers }) ? 1 : 0
  console.log('\n※ Shell Script Widget を作り直したので、Touch Bar の実描画には BTT の再起動が要る。')
  console.log('※ プリセットを更新するなら `node touchbar/install.mjs --preset`。')
  return rc
}

try {
  process.exit(main(process.argv.slice(2)))
} catch (e) {
  console.error(`\n${e.message}`)
  process.exit(1)
}
