import type { DesignProp } from './types';

/**
 * デザイントークン辞書 (Figma Variables / W3C Design Tokens / Tokens Studio)。
 *
 * デザイナーの主目的「Figma のトークンと実装が一致しているかを、デプロイ済みサイト上で
 * 視覚的に確かめる」ための照合辞書。popup で JSON を貼り付け → 解析結果を storage 経由で
 * MAIN world に配り、ホバーバッジの各デザインチップに「一致トークン名 / 野良値 + 最近傍」を
 * 注釈する。全処理は純関数 (パース・照合とも) で production サイトでも動く。
 *
 * 対応フォーマット (いずれも自動判別):
 * - W3C Design Tokens: { color: { primary: { "$value": "#1668d4", "$type": "color" } } }
 * - Tokens Studio:     { global: { primary: { "value": "#1668d4", "type": "color" } } }
 * - フラット辞書:       { "primary/500": "#1668d4", "space/2": "8px" }
 * エイリアス参照 ("{color.primary}") など解決できない値は黙ってスキップする。
 */

export interface TokenColor {
  name: string;
  r: number;
  g: number;
  b: number;
  /** 0..1 */
  a: number;
}

export interface TokenSize {
  name: string;
  px: number;
}

export interface TokenDict {
  colors: TokenColor[];
  sizes: TokenSize[];
}

export const EMPTY_TOKEN_DICT: TokenDict = { colors: [], sizes: [] };

/** #rgb / #rrggbb / #rrggbbaa / rgb() / rgba() を {r,g,b,a} に正規化。非対応は null */
export function parseColor(value: string): { r: number; g: number; b: number; a: number } | null {
  const t = value.trim();
  const hex = t.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b, a] = hex.split('').map((c) => parseInt(c + c, 16));
      return { r, g, b, a: hex.length === 4 ? a / 255 : 1 };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      return { r, g, b, a };
    }
    return null;
  }
  const m = t.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (m) {
    return {
      r: Number(m[1]),
      g: Number(m[2]),
      b: Number(m[3]),
      a: m[4] === undefined ? 1 : parseFloat(m[4]),
    };
  }
  return null;
}

/** "8px" / "0.5rem" / 8 を px 数値に。非対応 (%, auto, calc…) は null */
export function parseSizePx(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^(-?\d+(?:\.\d+)?)(px|rem)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2] === 'rem' ? n * 16 : n;
}

// $type / type の値からサイズ系トークンとみなす種別 (Figma Variables/Tokens Studio の慣用)
const SIZE_TYPES = new Set([
  'dimension', 'spacing', 'sizing', 'size', 'space',
  'borderradius', 'radius', 'fontsize', 'fontsizes', 'lineheight',
]);

/**
 * トークン JSON (パース済みオブジェクト) を辞書に変換する。
 * ネストは深さ優先で辿り、$value/value を持つノードをリーフとして
 * 「パスを / で連結した名前」で登録する。型注釈が無ければ値から推定する。
 */
export function parseTokens(input: unknown): TokenDict {
  const dict: TokenDict = { colors: [], sizes: [] };
  const visit = (node: unknown, path: string[], depth: number) => {
    if (depth > 12 || node === null || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    const rawValue = '$value' in obj ? obj.$value : 'value' in obj ? obj.value : undefined;
    if (rawValue !== undefined && (typeof rawValue !== 'object' || rawValue === null)) {
      const type = String(obj.$type ?? obj.type ?? '').toLowerCase();
      addLeaf(dict, path.join('/'), rawValue, type);
      return;
    }
    for (const [key, child] of Object.entries(obj)) {
      if (key.startsWith('$')) continue; // $description 等のメタは辿らない
      if (typeof child === 'string' || typeof child === 'number') {
        // フラット辞書: { "primary/500": "#1668d4" }
        addLeaf(dict, [...path, key].join('/'), child, '');
      } else {
        visit(child, [...path, key], depth + 1);
      }
    }
  };
  visit(input, [], 0);
  return dict;
}

function addLeaf(dict: TokenDict, name: string, rawValue: unknown, type: string) {
  if (!name) return;
  if (type === 'color') {
    const c = typeof rawValue === 'string' ? parseColor(rawValue) : null;
    if (c) dict.colors.push({ name, ...c });
    return;
  }
  if (SIZE_TYPES.has(type)) {
    const px = parseSizePx(rawValue);
    if (px !== null) dict.sizes.push({ name, px });
    return;
  }
  // 型注釈なし: 値から推定 (色 → サイズの順)
  if (typeof rawValue === 'string') {
    const c = parseColor(rawValue);
    if (c) {
      dict.colors.push({ name, ...c });
      return;
    }
  }
  const px = parseSizePx(rawValue);
  if (px !== null) dict.sizes.push({ name, px });
}

/** RGB ユークリッド距離 (0..441)。アルファ差が大きい場合は不一致扱いに寄せる */
function colorDistance(
  a: { r: number; g: number; b: number; a: number },
  b: { r: number; g: number; b: number; a: number },
): number {
  const d = Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
  return d + Math.abs(a.a - b.a) * 255;
}

/** 一致とみなす距離 (丸め誤差レベル) と、最近傍サジェストを出す距離の上限 */
const COLOR_HIT = 3;
const COLOR_NEAR = 64;

export interface ColorMatch {
  /** 一致したトークン名 (距離 ≤ COLOR_HIT) */
  hit: string | null;
  /** 不一致時の最近傍トークン名 (距離 ≤ COLOR_NEAR)。それも無ければ null */
  nearest: string | null;
}

export function matchColor(dict: TokenDict, cssValue: string): ColorMatch | null {
  if (!dict.colors.length) return null;
  const c = parseColor(cssValue);
  if (!c) return null;
  let best: TokenColor | null = null;
  let bestD = Infinity;
  for (const t of dict.colors) {
    const d = colorDistance(c, t);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  if (!best) return null;
  if (bestD <= COLOR_HIT) return { hit: best.name, nearest: null };
  return { hit: null, nearest: bestD <= COLOR_NEAR ? best.name : null };
}

const SIZE_HIT = 0.25;
const SIZE_NEAR = 4;

export interface SizeMatch {
  hit: string | null;
  nearest: string | null;
}

export function matchSize(dict: TokenDict, px: number): SizeMatch | null {
  if (!dict.sizes.length) return null;
  let best: TokenSize | null = null;
  let bestD = Infinity;
  for (const t of dict.sizes) {
    const d = Math.abs(px - t.px);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  if (!best) return null;
  if (bestD <= SIZE_HIT) return { hit: best.name, nearest: null };
  return { hit: null, nearest: bestD <= SIZE_NEAR ? best.name : null };
}

// サイズ照合の対象にする DesignProp.label (shadow/weight/lh は対象外)
const SIZE_LABELS = new Set(['font', 'padding', 'margin', 'radius', 'gap']);
const COLOR_LABELS = new Set(['color', 'bg']);

/** バッジのデザインチップ 1 つ分のトークン注釈 */
export type ChipToken =
  | { kind: 'hit'; names: string[] }
  | { kind: 'miss'; nearest: string | null }
  | null;

/**
 * DesignProp 1 件をトークン辞書と突合する。
 * - 色: 値そのものを照合。不一致は常に警告 (色は必ずデザイン上の意思決定のため)
 * - サイズ系: 値中の全 px を照合し、全て一致なら hit (トークン名を重複排除で列挙)。
 *   外れた値は「トークンに近い (≤4px)」ときだけ miss として警告する —
 *   トークンから遠い値 (レイアウト都合の 100px 等) はデザイン逸脱と断定できず
 *   ノイズになるため沈黙する。0 は常に許容。
 * 辞書が空・対象外ラベル・px が取れない値は null (注釈なし)。
 */
export function annotateProp(prop: DesignProp, dict: TokenDict): ChipToken {
  if (COLOR_LABELS.has(prop.label)) {
    const m = matchColor(dict, prop.value);
    if (!m) return null;
    return m.hit ? { kind: 'hit', names: [m.hit] } : { kind: 'miss', nearest: m.nearest };
  }
  if (!SIZE_LABELS.has(prop.label) || !dict.sizes.length) return null;
  const pxs = [...prop.value.matchAll(/(-?\d+(?:\.\d+)?)px/g)]
    .map((m) => parseFloat(m[1]))
    .filter((px) => px !== 0);
  if (!pxs.length) return null;
  const names: string[] = [];
  for (const px of pxs) {
    const m = matchSize(dict, px);
    if (!m) return null;
    if (!m.hit) {
      // 近い外れ値だけ「打ち間違い/野良値の疑い」として警告。遠い値は判定保留
      return m.nearest ? { kind: 'miss', nearest: m.nearest } : null;
    }
    if (!names.includes(m.hit)) names.push(m.hit);
  }
  return { kind: 'hit', names };
}
