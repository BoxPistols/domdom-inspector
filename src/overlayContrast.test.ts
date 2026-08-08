import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OVERLAY_CSS } from './overlayStyles';
import { DEFAULT_SETTINGS } from './types';

/**
 * コントラスト比の**機械検証** (WCAG: 通常テキスト 4.5:1 / UI 部品の境界 3:1)。
 *
 * なぜテストにするか: コメントに「4.6:1」等と書いた数値が実測 (5.30:1) と食い違っていた
 * (監査 2026-08-07)。**手計算の数値をコメントに書いても誰も検算しない**ので、
 * 色定数そのものから毎回計算する。色を変えるとこのテストが弾く。
 *
 * 前提の置き方:
 * - overlay の背景は rgba(20,20,24,0.92)。**下のページの色は任意**なので、
 *   白ページ (最も明るく合成される = テキストに最も不利) を最悪ケースとして合成する。
 * - ハイライト枠は白ページ上に直接描かれるため、白との 3:1 を要求する。
 */

// ---- 色計算 (このテスト内で完結。実装コードには依存しない) -----------------

type Rgb = { r: number; g: number; b: number };

function hex(c: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) throw new Error(`hex 6 桁で書く: ${c}`);
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/** fg を alpha で bg に合成 */
function over(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  const mix = (a: number, b: number) => Math.round(a * alpha + b * (1 - alpha));
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b) };
}

function luminance({ r, g, b }: Rgb): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };

/** CSS 文字列から 1 つだけマッチする値を取り出す。見つからなければ**失敗させる** */
function extract(css: string, re: RegExp, what: string): string {
  const m = re.exec(css);
  if (!m) throw new Error(`${what} が CSS から見つからない (rename されたら正規表現も直す)`);
  return m[1];
}

// ---- overlay (バッジ / トースト) --------------------------------------------

describe('overlay のコントラスト (白ページ上に合成した最悪ケース)', () => {
  // 背景 rgba(20,20,24,0.92) を白ページに合成
  const bgAlpha = extract(OVERLAY_CSS, /background: rgba\(20, 20, 24, (0\.\d+)\)/, 'バッジ背景');
  const badgeBg = over({ r: 20, g: 20, b: 24 }, Number(bgAlpha), WHITE);
  // チップ背景 rgba(255,255,255,0.08) をバッジ背景に合成
  const chipBg = over(WHITE, 0.08, badgeBg);

  it('チップのプロパティ名 (.lb) は AA (4.5:1) を満たす', () => {
    const o = Number(extract(OVERLAY_CSS, /\.badge \.chip \.lb \{ opacity: ([\d.]+)/, '.lb'));
    expect(contrast(over(WHITE, o, chipBg), chipBg)).toBeGreaterThanOrEqual(4.5);
  });

  it('変数名優先時の生値 (.raw) は AA を満たす', () => {
    const o = Number(extract(OVERLAY_CSS, /\.badge \.chip \.raw \{ opacity: ([\d.]+)/, '.raw'));
    expect(contrast(over(WHITE, o, chipBg), chipBg)).toBeGreaterThanOrEqual(4.5);
  });

  it('エディタ操作ヒント (.ehint) は AA を満たす', () => {
    const o = Number(
      extract(OVERLAY_CSS, /\.badge \.file \.ehint \{ opacity: ([\d.]+)/, '.ehint'),
    );
    expect(contrast(over(WHITE, o, badgeBg), badgeBg)).toBeGreaterThanOrEqual(4.5);
  });

  it('メタ行 (.meta) は AA を満たす', () => {
    const o = Number(extract(OVERLAY_CSS, /\.badge \.meta \{ opacity: ([\d.]+)/, '.meta'));
    expect(contrast(over(WHITE, o, badgeBg), badgeBg)).toBeGreaterThanOrEqual(4.5);
  });

  it('トークン注釈 (緑/黄) と変数名 (紫) は AA を満たす', () => {
    for (const [name, re] of [
      ['tk.ok', /\.badge \.chip \.tk\.ok \{ color: (#[0-9a-f]{6})/i],
      ['tk.ng', /\.badge \.chip \.tk\.ng \{ color: (#[0-9a-f]{6})/i],
      ['var', /\.badge \.chip \.var \{ color: (#[0-9a-f]{6})/i],
    ] as const) {
      const c = hex(extract(OVERLAY_CSS, re, name));
      expect(contrast(c, chipBg), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('操作可能トーストのボタン枠は UI 部品の 3:1 を満たす (実測 2.5:1 だった)', () => {
    const o = Number(
      extract(
        OVERLAY_CSS,
        /\.toast\.interactive button \{[^}]*border: 1px solid rgba\(255,255,255,([\d.]+)\)/s,
        'toast ボタン枠',
      ),
    );
    expect(contrast(over(WHITE, o, badgeBg), badgeBg)).toBeGreaterThanOrEqual(3);
  });

  it('ハイライト枠の既定 3 色は白ページ上で 3:1 を満たす (緑 2.78:1 / グレー 2.68:1 だった)', () => {
    for (const [name, value] of Object.entries(DEFAULT_SETTINGS.colors)) {
      expect(contrast(hex(value), WHITE), name).toBeGreaterThanOrEqual(3);
    }
  });
});

// ---- popup ------------------------------------------------------------------

describe('popup のコントラスト (index.html の CSS トークンから計算)', () => {
  const html = readFileSync(
    join(import.meta.dirname, '..', 'entrypoints', 'popup', 'index.html'),
    'utf8',
  );
  /** :root ブロック (ダーク既定) と light ブロックからトークンを引く */
  const dark = html.slice(0, html.indexOf('@media (prefers-color-scheme: light)'));
  const light = html.slice(html.indexOf('@media (prefers-color-scheme: light)'));
  const token = (block: string, name: string) =>
    hex(extract(block, new RegExp(`--${name}: (#[0-9a-f]{6})`, 'i'), `--${name}`));

  it('主ボタン (accent-bg × on-accent) は両テーマで AA を満たす', () => {
    expect(contrast(token(dark, 'accent-bg'), token(dark, 'on-accent'))).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(
      contrast(token(light, 'accent-bg'), token(light, 'on-accent')),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('入力欄の枠 (border-input × surface) は両テーマで 3:1 を満たす (実測 1.36:1 だった)', () => {
    expect(
      contrast(token(dark, 'border-input'), token(dark, 'surface')),
    ).toBeGreaterThanOrEqual(3);
    expect(
      contrast(token(light, 'border-input'), token(light, 'surface')),
    ).toBeGreaterThanOrEqual(3);
  });

  it('本文 (text × bg) と補足 (muted × bg) は両テーマで AA を満たす', () => {
    for (const block of [dark, light]) {
      expect(contrast(token(block, 'text'), token(block, 'bg'))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(block, 'muted'), token(block, 'bg'))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
