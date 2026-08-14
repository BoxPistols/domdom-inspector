// Touch Bar 設定の純粋ロジックの検算。
//
// **既知の値で当てること**が要点。ここが誤ってもトレースには `sent … rc=0` が並ぶだけで、
// 症状は「押せるのに無反応」という一番わかりにくい形でしか出ない (実際に 1 度出した)。
import { describe, expect, it } from 'vitest'
import {
  KEYCODE, MODCODE, SPACE_PX, SPREAD_TOLERANCE_PX,
  hasEmoji, padToWidest, splitPlatform, textPx, toBttKeys, widthSpread,
} from './lib.mjs'

describe('toBttKeys', () => {
  // 実機で確認済みの 2 件 (2026-08-15 の Chrome の実バインド)
  it('実機の実バインドを変換できる', () => {
    expect(toBttKeys('Alt+I')).toBe('58,34')
    expect(toBttKeys('Alt+D')).toBe('58,2')
  })

  // **manifest の既定はこの 2 修飾キーの経路。** 実機のユーザーが ⌥I に再割当していた
  // ため一度も通っていなかった。降順 (option 58 → shift 56) で並ぶこと
  it('修飾キー 2 つを降順に並べる', () => {
    expect(toBttKeys('Alt+Shift+I')).toBe('58,56,34')
    expect(toBttKeys('MacCtrl+Shift+X')).toBe('59,56,7')
    expect(toBttKeys('Ctrl+Alt+Shift+K')).toBe('58,56,55,40')
  })

  it('macOS の Ctrl は Command、実 Control は MacCtrl', () => {
    expect(toBttKeys('Ctrl+Comma')).toBe('55,43')
    expect(toBttKeys('MacCtrl+Comma')).toBe('59,43')
    expect(MODCODE.Ctrl).toBe(MODCODE.Command)
    expect(MODCODE.MacCtrl).not.toBe(MODCODE.Ctrl)
  })

  it('修飾キー無しも通る', () => {
    expect(toBttKeys('Escape')).toBe('53')
    expect(String(KEYCODE.Escape)).toBe('53')
  })

  // 静かに誤答させない。知らないキーは変換せず落とす
  it('知らないキー名・修飾子は例外にする', () => {
    expect(() => toBttKeys('Alt+F13')).toThrow(/F13/)
    expect(() => toBttKeys('Hyper+I')).toThrow(/Hyper/)
  })
})

describe('splitPlatform', () => {
  it('前置を分ける', () => {
    expect(splitPlatform('mac:Alt+I')).toEqual({ platform: 'mac', accel: 'Alt+I' })
    expect(splitPlatform('windows:Alt+I')).toEqual({ platform: 'windows', accel: 'Alt+I' })
    expect(splitPlatform('Alt+I')).toEqual({ platform: 'default', accel: 'Alt+I' })
  })
})

describe('textPx', () => {
  it('全角 12 / 半角 7 / 空白 3.3 で数える', () => {
    expect(textPx('要素検査')).toBe(48)
    expect(textPx('Inspect')).toBe(49)
    expect(textPx('  Exit  ')).toBeCloseTo(41.2, 5)
  })
  // 許容差は SPACE_PX から導いているので、定数だけ変えても幅の検査は緑のまま通る。
  // 推定値を動かしたことに気づけるよう、値そのものを固定する
  it('推定の定数が変わっていない', () => {
    expect(SPACE_PX).toBe(3.3)
    expect(textPx(' ')).toBe(SPACE_PX)
  })
})

describe('padToWidest', () => {
  it('日本語は全角 4 文字で元から揃うのでパディングしない', () => {
    const out = padToWidest({ root: '要素検査', prefs: '拡張設定', esc: '検査終了' })
    expect(out).toEqual({ root: '要素検査', prefs: '拡張設定', esc: '検査終了' })
    expect(widthSpread(out)).toBe(0)
  })

  it('英語は空白で寄せて許容差に収める', () => {
    const raw = { root: 'Inspect', prefs: 'Settings', esc: 'Exit' }
    expect(widthSpread(raw)).toBeGreaterThan(SPREAD_TOLERANCE_PX) // 揃っていないことを先に確認
    const out = padToWidest(raw)
    expect(widthSpread(out)).toBeLessThanOrEqual(SPREAD_TOLERANCE_PX)
    expect(out.prefs).toBe('Settings') // 一番広いものは触らない
    expect(out.esc.trim()).toBe('Exit') // 中身は変えない
  })

  // **パディングの刻みと検算のしきい値が食い違うと、直しようのない NG が出る。**
  // 刻み (SPACE_PX) から導くこと
  it('どんな組み合わせでも許容差に収まる', () => {
    const cases = [
      { a: 'A', b: 'Settings', c: '要素検査' },
      { a: '設定', b: 'Inspect', c: 'Exit' },
      { a: 'abc要素', b: 'W', c: '検査終了' },
      { a: 'x', b: 'y', c: 'z' },
    ]
    for (const c of cases) {
      expect(widthSpread(padToWidest(c))).toBeLessThanOrEqual(SPREAD_TOLERANCE_PX)
    }
  })
})

describe('hasEmoji', () => {
  it('過去に実機で使っていた絵文字を検出する', () => {
    expect(hasEmoji('🔍 Inspect')).toBe(true)
    expect(hasEmoji('⚙︎')).toBe(true) // 異体字セレクタつき
    expect(hasEmoji('⚙')).toBe(true)
  })
  it('通常のラベルは通す', () => {
    for (const s of ['要素検査', '拡張設定', '検査終了', 'Inspect', 'Settings', '  Exit  ']) {
      expect(hasEmoji(s)).toBe(false)
    }
  })
})
