// Touch Bar 設定の純粋ロジック。**I/O も console 出力もここに書かない**
// (install.mjs は import しただけで Chrome を読みに行っていたため、テストできなかった)。
//
// ここが静かに誤答すると「押せるのに無反応」になる。キーコード表を 1 つ間違えても
// トレースには `sent … rc=0` が並ぶだけで、症状が出るのは実機だけ。
// **既知の値でテストすること** (lib.test.mjs)。

// macOS の仮想キーコード。Chrome のキー名 → コード
export const KEYCODE = {
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

// Chrome の修飾子名 → BTT の修飾キーコード。
// **macOS では `Ctrl` は Command を指し、実 Control は `MacCtrl`** (Chrome 公式ドキュメント)。
// ここを取り違えると全部ズレる
export const MODCODE = { Ctrl: 55, Command: 55, Cmd: 55, MacCtrl: 59, Alt: 58, Option: 58, Shift: 56 }

/** "Alt+I" → "58,34" (修飾キーコードを降順に並べてから標準キーコード) */
export function toBttKeys(accel) {
  const parts = String(accel).split('+')
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

/** "mac:Alt+I" → { platform: "mac", accel: "Alt+I" } (前置が無ければ platform は "default") */
export function splitPlatform(entry) {
  const i = String(entry).indexOf(':')
  return i < 0
    ? { platform: 'default', accel: String(entry) }
    : { platform: entry.slice(0, i), accel: entry.slice(i + 1) }
}

// 12pt での推定値。全角 ≒ 12px / 半角 ≒ 7px / 半角空白 ≒ 3.3px。
// **推定なので、揃っているかの最終判定は実機の見た目でしか取れない**
export const SPACE_PX = 3.3
export const textPx = (s) =>
  [...String(s)].reduce((n, ch) => n + (ch === ' ' ? SPACE_PX : /[\x20-\x7e]/.test(ch) ? 7 : 12), 0)

// 空白 1 つずつ左右交互に足すので、揃え残りは必ず SPACE_PX 未満に収まる。
// 検算のしきい値はここから導く (定数を別々に決めると、パディングでは到達できない
// 厳しさを検算側が要求して「直しようのない NG」になる)
export const SPREAD_TOLERANCE_PX = SPACE_PX + 0.1

/**
 * 一番広いラベルに合わせて、短いものの左右へ空白を足す。
 * 幅を固定指定できない (hidden のとき枠だけ残って空のボタンになる) ため、
 * **表示幅を揃えることで幅を合わせる**。
 */
export function padToWidest(labels) {
  const target = Math.max(...Object.values(labels).map(textPx))
  const out = {}
  for (const [k, v] of Object.entries(labels)) {
    let t = v
    let left = true
    // 足したあとに target を SPACE_PX/2 より超えないところで止める
    while (textPx(t) + SPACE_PX <= target + SPACE_PX / 2) {
      t = left ? ` ${t}` : `${t} `
      left = !left
    }
    out[k] = t
  }
  return out
}

/** 3 つのラベルの推定表示幅の差 */
export const widthSpread = (labels) => {
  const w = Object.values(labels).map(textPx)
  return Math.max(...w) - Math.min(...w)
}

// 絵文字と異体字セレクタ。Touch Bar は物理フィードバックが無く、記号 1 文字は
// 意味も押せる範囲も読み取れない
export const EMOJI_RE = /\p{Extended_Pictographic}|[︎️]/u
export const hasEmoji = (s) => typeof s === 'string' && EMOJI_RE.test(s)
