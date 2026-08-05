import { extractPxValues } from './tokenLint';
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

/**
 * サイズトークンのカテゴリ。照合を「同カテゴリのトークンだけ」に絞るために持つ。
 * これが無いと font-size トークンが padding に一致してしまう (カテゴリ非区別バグ)。
 * 分類できない値 (lineHeight/fontWeight/opacity 等の非長さや、手がかりの無い裸の数値) は
 * そもそもサイズトークンとして登録しない (M3 の野良値検出を偽陰性で損なわないため)。
 */
export type SizeCategory = 'space' | 'radius' | 'font';

export interface TokenSize {
  name: string;
  px: number;
  category: SizeCategory;
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
  const m = t.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/i);
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

/**
 * トークンをサイズカテゴリに分類する。長さ (px 換算可能) かつ用途が判別できるものだけ
 * カテゴリを返し、それ以外 (色・非長さ・手がかり無し) は null で「サイズとして登録しない」。
 * - $type/type があればそれを一次シグナルにする (非長さ型は明示的に除外)
 * - 型注釈が無ければ名前のセグメント (/._- 区切り) から推定する
 */
function classifySize(type: string, name: string): SizeCategory | null {
  const t = type.toLowerCase();
  if (t) {
    if (t === 'borderradius' || t === 'radius') return 'radius';
    if (t === 'fontsize' || t === 'fontsizes') return 'font';
    if (t === 'dimension' || t === 'spacing' || t === 'space' || t === 'sizing' || t === 'size') {
      return 'space';
    }
    // 型注釈があるが非長さ (lineheight/fontweight/opacity/duration/boxshadow 等) は対象外
    return null;
  }
  const segs = name.toLowerCase().split(/[/._-]/);
  const has = (re: RegExp) => segs.some((s) => re.test(s));
  if (has(/^(border)?radius$|^corner$|^rounded?$/)) return 'radius';
  if (has(/^font-?sizes?$|^fontsizes?$/)) return 'font';
  if (has(/^(space|spacing|gap|inset|padding|margin|dimension|sizing|size)$/)) return 'space';
  return null;
}

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
    if (rawValue !== undefined) {
      if (typeof rawValue !== 'object' || rawValue === null) {
        const type = String(obj.$type ?? obj.type ?? '').toLowerCase();
        addLeaf(dict, path.join('/'), rawValue, type);
        return;
      }
      // 複合トークン (shadow / typography 等): $value がオブジェクト。
      // パスに $value/value を挟まず子要素を走査し、'typography/body/fontSize' の
      // 形で登録する (子は型注釈を持たないため値から推定される)。
      visit(rawValue, path, depth + 1);
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
  const t = type.toLowerCase();
  if (t === 'color') {
    const c = typeof rawValue === 'string' ? parseColor(rawValue) : null;
    if (c) dict.colors.push({ name, ...c });
    return;
  }
  // 型注釈なしの文字列は色を先に試す (#hex/rgb() なら色トークン)
  if (t === '' && typeof rawValue === 'string') {
    const c = parseColor(rawValue);
    if (c) {
      dict.colors.push({ name, ...c });
      return;
    }
  }
  // カテゴリが判別できる長さトークンのみサイズとして登録 (非長さ・裸の数値は捨てる)
  const category = classifySize(t, name);
  if (category) {
    const px = parseSizePx(rawValue);
    if (px !== null) dict.sizes.push({ name, px, category });
  }
}

/**
 * MUI テーマの spacing ラダー (spacing(k) を space トークン化する倍数)。
 * 0.25 刻み 3 段 + 0.5 刻み 1〜12 を並べる。飛びがあると spacing(3.5) のような
 * 正当な API 使用が「トークン近傍の野良値」と誤警告されるため、隙間を作らない。
 */
const MUI_SPACING_STEPS = [
  0.25, 0.5, 0.75,
  ...Array.from({ length: 23 }, (_, i) => 1 + i * 0.5),
];
/** テーマ由来の色トークン上限 (異常に巨大なカスタムテーマでの暴走防止) */
const MUI_MAX_COLORS = 300;

/**
 * MUI テーマオブジェクト (ThemeProvider の context 値) を照合辞書に変換する (FR-14)。
 * Fiber からの「発見」は muiTheme.ts が担い、ここは plain object → TokenDict の純関数。
 * - palette (または colorSchemes.<scheme>.palette) の色文字列 → color トークン
 * - spacing (関数 or 数値基準) → 代表倍数の space トークン (spacing(2) = 16px 等)
 * - shape.borderRadius → radius トークン
 * - typography.<variant>.fontSize → font トークン (rem は ×16)
 * 解釈できない値は黙ってスキップし、テーマ形でない入力は空辞書を返す。
 */
export function parseMuiTheme(theme: unknown): TokenDict {
  const dict: TokenDict = { colors: [], sizes: [] };
  if (!theme || typeof theme !== 'object') return dict;
  const t = theme as Record<string, unknown>;

  const collectColors = (node: unknown, path: string[], depth: number) => {
    if (depth > 3 || node === null || typeof node !== 'object') return;
    for (const [key, v] of Object.entries(node as Record<string, unknown>)) {
      if (dict.colors.length >= MUI_MAX_COLORS) return;
      if (typeof v === 'string') {
        const c = parseColor(v);
        if (c) dict.colors.push({ name: [...path, key].join('.'), ...c });
      } else if (v !== null && typeof v === 'object') {
        collectColors(v, [...path, key], depth + 1);
      }
    }
  };
  collectColors(t.palette, ['palette'], 0);
  if (t.colorSchemes !== null && typeof t.colorSchemes === 'object') {
    for (const [scheme, node] of Object.entries(t.colorSchemes as Record<string, unknown>)) {
      if (node !== null && typeof node === 'object') {
        collectColors((node as Record<string, unknown>).palette, [scheme, 'palette'], 0);
      }
    }
  }

  // spacing: v5 は関数 (spacing(1) → "8px")、数値なら単位 px として倍数展開
  const spacing = t.spacing;
  for (const k of MUI_SPACING_STEPS) {
    let px: number | null = null;
    if (typeof spacing === 'function') {
      try {
        px = parseSizePx((spacing as (n: number) => unknown)(k));
      } catch {
        px = null;
      }
    } else if (typeof spacing === 'number' && Number.isFinite(spacing)) {
      px = spacing * k;
    }
    if (px !== null && px > 0) dict.sizes.push({ name: `spacing(${k})`, px, category: 'space' });
  }

  if (t.shape !== null && typeof t.shape === 'object') {
    const radius = parseSizePx((t.shape as Record<string, unknown>).borderRadius);
    if (radius !== null && radius > 0) {
      dict.sizes.push({ name: 'shape.borderRadius', px: radius, category: 'radius' });
    }
  }

  if (t.typography !== null && typeof t.typography === 'object') {
    const typo = t.typography as Record<string, unknown>;
    // rem 基準は theme.typography.htmlFontSize (既定 16)。html { font-size } を
    // 変えているアプリでは 1rem ≠ 16px になるため、テーマの申告値に従う。
    const htmlFontSize =
      typeof typo.htmlFontSize === 'number' && typo.htmlFontSize > 0 ? typo.htmlFontSize : 16;
    for (const [variant, node] of Object.entries(typo)) {
      if (node === null || typeof node !== 'object') continue;
      const raw = (node as Record<string, unknown>).fontSize;
      let px = parseSizePx(raw);
      if (px !== null && typeof raw === 'string' && /rem\s*$/i.test(raw)) {
        px = (px / 16) * htmlFontSize; // parseSizePx は 16 固定で換算するため基準を補正
      }
      if (px !== null && px > 0) {
        dict.sizes.push({ name: `typography.${variant}.fontSize`, px, category: 'font' });
      }
    }
  }
  return dict;
}

/**
 * 手動貼り付け (primary) とテーマ由来 (secondary) の辞書を併合する。
 * 照合は「同距離なら配列で先のものが勝つ」ため、primary を先頭に置く = 手動優先。
 */
export function mergeTokenDicts(primary: TokenDict, secondary: TokenDict): TokenDict {
  if (!secondary.colors.length && !secondary.sizes.length) return primary;
  if (!primary.colors.length && !primary.sizes.length) return secondary;
  return {
    colors: [...primary.colors, ...secondary.colors],
    sizes: [...primary.sizes, ...secondary.sizes],
  };
}

/** RGB ユークリッド距離 (0..441)。アルファ差が大きい場合は不一致扱いに寄せる */
function colorDistance(
  a: { r: number; g: number; b: number; a: number },
  b: { r: number; g: number; b: number; a: number },
): number {
  const d = Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
  return d + Math.abs(a.a - b.a) * 255;
}

/**
 * 一致とみなす距離 (丸め誤差レベル) と、最近傍サジェストを出す距離の上限。
 * **export する理由**: 「一致」「近い」の定義を出力側 (パネル / Markdown / AI 入力) が
 * 開示できるようにするため。Lighthouse が重みと色境界を公開しているのと同じ扱い。
 * 定数を private にしたまま説明文を別に書くと、閾値を変えたとき説明だけが古くなる。
 */
export const COLOR_HIT = 3;
export const COLOR_NEAR = 64;

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
  // 完全透明は「色が無い」状態 (既定背景 or 意図的な透明化) なので照合・警告の対象外
  if (c.a === 0) return null;
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

/** サイズ (px) の一致許容と最近傍サジェストの上限。COLOR_* と同じ理由で export する */
export const SIZE_HIT = 0.25;
export const SIZE_NEAR = 4;

export interface SizeMatch {
  hit: string | null;
  nearest: string | null;
}

/** 指定カテゴリのトークンだけを候補に最近傍照合する (カテゴリ跨ぎの誤マッチを防ぐ) */
export function matchSize(dict: TokenDict, px: number, category: SizeCategory): SizeMatch | null {
  let best: TokenSize | null = null;
  let bestD = Infinity;
  for (const t of dict.sizes) {
    if (t.category !== category) continue;
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

// DesignProp.label → サイズカテゴリ (shadow/weight/lh は対象外なので不在)
const LABEL_SIZE_CATEGORY: Record<string, SizeCategory | undefined> = {
  padding: 'space',
  margin: 'space',
  gap: 'space',
  radius: 'radius',
  font: 'font',
};
const COLOR_LABELS = new Set(['color', 'bg']);

/** バッジのデザインチップ 1 つ分のトークン注釈 */
export type ChipToken =
  | { kind: 'hit'; names: string[] }
  | { kind: 'miss'; nearest: string | null }
  | null;

/**
 * DesignProp 1 件をトークン辞書と突合する。
 * - 色: 値そのものを照合。不一致は常に警告 (色は必ずデザイン上の意思決定のため)
 * - サイズ系: ラベルに対応するカテゴリのトークンだけを候補にし、値中の全 px を照合する。
 *   近い外れ値 (≤4px) が 1 つでもあれば miss として警告 (打ち間違い/野良値の疑い)。
 *   トークンから遠い値 (レイアウト都合の 100px 等) は判定保留とし、hit も出さない
 *   (= グリッド警告を残す)。全 px が一致したときだけ hit (トークン名を重複排除で列挙)。
 *   判定は px の並び順に依存しない。0 は常に許容。
 * - 負値 (負マージン等): 負トークンそのもの → 絶対値トークンの順で「一致のみ」拾う。
 *   near-miss 警告は出さない (負値はレイアウト意図が強く、警告はノイズになるため)。
 *   一致しない負値は遠い外れ値と同じく判定保留。
 * 辞書が空・対象外ラベル・該当カテゴリのトークンなし・px が取れない値は null (注釈なし)。
 */
export function annotateProp(prop: DesignProp, dict: TokenDict): ChipToken {
  if (COLOR_LABELS.has(prop.label)) {
    const m = matchColor(dict, prop.value);
    if (!m) return null;
    return m.hit ? { kind: 'hit', names: [m.hit] } : { kind: 'miss', nearest: m.nearest };
  }
  const category = LABEL_SIZE_CATEGORY[prop.label];
  if (!category) return null;
  const pxs = extractPxValues(prop.value).filter((px) => px !== 0);
  if (!pxs.length) return null;
  const names: string[] = [];
  let hasFar = false;
  for (const px of pxs) {
    if (px < 0) {
      const neg = matchSize(dict, px, category);
      const m = neg?.hit ? neg : matchSize(dict, Math.abs(px), category);
      if (m?.hit) {
        if (!names.includes(m.hit)) names.push(m.hit);
      } else {
        hasFar = true;
      }
      continue;
    }
    const m = matchSize(dict, px, category);
    if (!m) return null; // 該当カテゴリのトークンが 1 つも無い → 照合できない
    if (m.hit) {
      if (!names.includes(m.hit)) names.push(m.hit);
    } else if (m.nearest) {
      // 近い外れ値は順序に関わらず即警告 (どの near-miss を報告しても等価)
      return { kind: 'miss', nearest: m.nearest };
    } else {
      hasFar = true; // 遠い外れ値: 沈黙するが、hit とは言えないので記録
    }
  }
  // 遠い外れ値を含むなら hit を主張しない (グリッド警告を残すため)
  if (hasFar) return null;
  return names.length ? { kind: 'hit', names } : null;
}

/**
 * カバレッジ集計用の判定結果。**`noDict` (該当トークンが 0 件) と `far` (遠い値) を
 * 決して同じ値にしない** — この 2 つを混同すると「率を出してよいか」の判断が壊れる。
 * annotateProp はバッジ用に「遠い値は沈黙」とチューニング済みなので、集計はこちらを使う。
 */
export type AtomOutcome = 'hit' | 'near' | 'far' | 'noDict' | 'unmeasurable';

export interface AtomVerdict {
  outcome: AtomOutcome;
  token: string | null;
  nearest: string | null;
}

const UNMEASURABLE: AtomVerdict = { outcome: 'unmeasurable', token: null, nearest: null };
const NO_DICT: AtomVerdict = { outcome: 'noDict', token: null, nearest: null };

/** 色 atom 1 件を判定する (値は #hex / rgb() 形式) */
export function classifyColorAtom(dict: TokenDict, cssValue: string): AtomVerdict {
  if (!dict.colors.length) return NO_DICT;
  const c = parseColor(cssValue);
  // パース不能 (color-mix/oklch 等) と完全透明は「測れない」であって「外れ」ではない
  if (!c || c.a === 0) return UNMEASURABLE;
  let best: TokenColor | null = null;
  let bestD = Infinity;
  for (const t of dict.colors) {
    const d = colorDistance(c, t);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  if (!best) return UNMEASURABLE;
  if (bestD <= COLOR_HIT) return { outcome: 'hit', token: best.name, nearest: null };
  if (bestD <= COLOR_NEAR) return { outcome: 'near', token: null, nearest: best.name };
  return { outcome: 'far', token: null, nearest: null };
}

/** サイズ atom 1 件 (px 数値) を判定する。負値は near にしない (annotateProp の方針を踏襲) */
export function classifySizeAtom(dict: TokenDict, px: number, category: SizeCategory): AtomVerdict {
  if (!dict.sizes.some((t) => t.category === category)) return NO_DICT;
  if (!Number.isFinite(px) || px === 0) return UNMEASURABLE;
  if (px < 0) {
    const neg = matchSize(dict, px, category);
    const abs = matchSize(dict, Math.abs(px), category);
    const hit = neg?.hit ?? abs?.hit ?? null;
    return hit
      ? { outcome: 'hit', token: hit, nearest: null }
      : { outcome: 'far', token: null, nearest: null };
  }
  const m = matchSize(dict, px, category);
  if (!m) return NO_DICT;
  if (m.hit) return { outcome: 'hit', token: m.hit, nearest: null };
  if (m.nearest) return { outcome: 'near', token: null, nearest: m.nearest };
  return { outcome: 'far', token: null, nearest: null };
}

/**
 * 1 宣言 (label + value) を判定する。値が複数 px を含む shorthand は atom に分解し、
 * **全 hit なら hit / 1 つでも near なら near / 判定可能なら far** に畳む。
 * 判定可能な atom が 1 つも無ければ noDict または unmeasurable を返す。
 */
export function classifyDeclaration(prop: DesignProp, dict: TokenDict): AtomVerdict {
  if (COLOR_LABELS.has(prop.label)) return classifyColorAtom(dict, prop.value);
  const category = LABEL_SIZE_CATEGORY[prop.label];
  if (!category) return UNMEASURABLE;
  const pxs = extractPxValues(prop.value).filter((px) => px !== 0);
  if (!pxs.length) return UNMEASURABLE;
  const verdicts = pxs.map((px) => classifySizeAtom(dict, px, category));
  if (verdicts.every((v) => v.outcome === 'noDict')) return NO_DICT;
  const judged = verdicts.filter((v) => v.outcome !== 'noDict' && v.outcome !== 'unmeasurable');
  if (!judged.length) return UNMEASURABLE;
  const near = judged.find((v) => v.outcome === 'near');
  if (near) return { outcome: 'near', token: null, nearest: near.nearest };
  if (judged.every((v) => v.outcome === 'hit')) {
    const names = [...new Set(judged.map((v) => v.token).filter((n): n is string => !!n))];
    return { outcome: 'hit', token: names.join(', '), nearest: null };
  }
  return { outcome: 'far', token: null, nearest: null };
}

/** ラベル → ファミリ (表示単位)。色系と余白系はまとめ、角丸と文字サイズは独立させる */
export type Family = 'color' | 'spacing' | 'radius' | 'font';
export const LABEL_FAMILY: Record<string, Family | undefined> = {
  color: 'color',
  bg: 'color',
  padding: 'spacing',
  margin: 'spacing',
  gap: 'spacing',
  radius: 'radius',
  font: 'font',
};
