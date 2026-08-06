import { PROPS } from './designStyle';

/**
 * CSS カスタムプロパティ (var(--x)) の「宣言起源」を回収する層。
 *
 * ミッション: 「その UI がデザイン定義(トークン)に基づくか」の検証。ゆえに computed の
 * 生値ではなく、実装で実際に宣言された変数名 (var(--text) 等) を主表示したい。
 *
 * 方針は Tier1(authored)のみ (敵対的検証の結論):
 * - 要素にマッチする CSS ルール群から cascade 勝者の宣言を求め、その宣言に含まれる
 *   var(--x) を読む。実際に書かれた変数名なので曖昧性が原理的に無い。
 * - computed 値からの逆引き(Tier2)は継承変数が候補に混入し「由来でない変数名を由来と
 *   誤提示」しうる = 検証の誠実性に反するため採用しない。取れなければ生値表示に誠実に縮退。
 * - cross-origin stylesheet / :root 継承経由の宣言は Tier1 で読めず生値へ縮退する(既知)。
 *
 * ブラウザ CSSOM 依存の走査は本ファイルに閉じ込め、純ロジック(parseVarNames/specificity)は
 * happy-dom で単体テスト、CSSOM 走査(collectAuthoredVars)は実 Chrome の e2e で検証する。
 */

/** 1 デザインプロパティに対する変数マッチ結果 */
export interface VarMatch {
  /** 代表変数名 (先頭) */
  name: string;
  /** 検出した全変数名 (shorthand で side ごとに別変数の場合など) */
  names: string[];
  /** 変数が複数あり単一に絞れない (padding: var(--a) var(--b) 等) */
  ambiguous: boolean;
}

const VAR_RE = /var\(\s*(--[A-Za-z0-9_-]+)/g;

/**
 * authored 宣言値から var(--x) 名を抽出する純関数。無ければ null。
 * 例: "var(--text)" → {name:'--text'}, "var(--a) var(--b)" → 2 件 ambiguous,
 *     "calc(var(--x) + 2px)" → {name:'--x'}, "#fff" → null。
 */
export function parseVarNames(authoredValue: string): VarMatch | null {
  if (!authoredValue) return null;
  const names: string[] = [];
  for (const m of authoredValue.matchAll(VAR_RE)) {
    if (!names.includes(m[1])) names.push(m[1]);
  }
  if (!names.length) return null;
  return { name: names[0], names, ambiguous: names.length > 1 };
}

/**
 * 簡易 specificity を単一比較値に畳む純関数 (a*10000 + b*100 + c)。
 *
 * **`:where()` は仕様上 specificity 0** で、引数の中身も数えない。以前は
 * `:where(#hero)` を「id 1 + 疑似クラス 1」= 10100 と数えていたため、実際には
 * 効いていない `:where()` の宣言が本物のクラス宣言に勝ち、**由来でない CSS 変数名を
 * 「由来」として表示**していた (Tier2 を却下した理由と同じ誤りが Tier1 の中で起きていた)。
 *
 * `:is()` / `:not()` は引数のうち**最大の specificity** を採る (仕様どおり)。
 * 疑似要素・入れ子の完全な実装ではないが、勝者推定に効く支配的な要因はこの 2 点。
 */
export function specificity(selector: string): number {
  return specificityOf(selector.trim());
}

/** 関数型疑似クラスの引数リストを , で分割する (括弧の入れ子を数えて壊さない) */
function splitArgs(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of inner) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/**
 * 関数型疑似クラスを先に畳んでから数える。
 * - `:where(...)`  → 完全に除去 (0 を寄与)
 * - `:is(...)` / `:not(...)` / `:has(...)` → 引数の最大 specificity を加算し、本体からは除去
 */
function specificityOf(selector: string): number {
  let s = selector;
  let extra = 0;
  const FUNC = /:(where|is|not|has|matches|-webkit-any|-moz-any)\(/i;
  for (let guard = 0; guard < 32; guard += 1) {
    const m = FUNC.exec(s);
    if (!m) break;
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let i = open; i < s.length; i += 1) {
      if (s[i] === '(') depth += 1;
      else if (s[i] === ')') {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close < 0) break; // 閉じ括弧が無い = 壊れたセレクタ。以降は数えない
    const name = m[1].toLowerCase();
    const inner = s.slice(open + 1, close);
    if (name !== 'where') {
      // :is / :not / :has は引数の最大を採る
      extra += Math.max(0, ...splitArgs(inner).map((a) => specificityOf(a.trim())));
    }
    s = s.slice(0, m.index) + ' ' + s.slice(close + 1);
  }
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classesAttrsPseudo =
    (s.match(/\.[\w-]+/g) ?? []).length +
    (s.match(/\[[^\]]+\]/g) ?? []).length +
    (s.match(/(?<!:):(?!:)[\w-]+(?:\([^)]*\))?/g) ?? []).length;
  const stripped = s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|::?[\w-]+(?:\([^)]*\))?|[*>+~]/g, ' ');
  const types = (stripped.match(/[a-zA-Z][\w-]*/g) ?? []).length;
  return ids * 10000 + classesAttrsPseudo * 100 + types + extra;
}

/** ラベル → authored で読むべき CSS プロパティ列 (shorthand 親も見る)。既定は [prop]。 */
const AUTHORED_PROPS: Record<string, string[]> = {
  // background: var(--surface) という shorthand 宣言も拾う (Chrome は var 入り shorthand を
  // longhand 展開しないため background-color だけ見ると取りこぼす)
  bg: ['background-color', 'background'],
};

interface Cand {
  value: string;
  important: boolean;
  spec: number;
  order: number;
  /**
   * `@layer` の中の宣言か。**カスケードでは通常宣言は「レイヤ無し > 後のレイヤ > 前のレイヤ」**、
   * `!important` では逆順で「前のレイヤ > 後のレイヤ > レイヤ無し」になる。
   * 以前はレイヤを素通りして specificity と source order だけで勝者を決めていたため、
   * レイヤ内の高 specificity 宣言がレイヤ外の宣言に誤って勝っていた。
   */
  layered: boolean;
}

const INLINE_SPEC = 1_000_000; // inline style は全ルールより強い

function isStyleRule(r: CSSRule): r is CSSStyleRule {
  return 'selectorText' in r && 'style' in r;
}

/** @layer ブロックか (CSSLayerBlockRule が無い環境では cssText で判定) */
function isLayerBlock(rule: CSSRule): boolean {
  const Ctor = (globalThis as { CSSLayerBlockRule?: unknown }).CSSLayerBlockRule;
  if (typeof Ctor === 'function') return rule instanceof (Ctor as abstract new () => CSSRule);
  try {
    return /^\s*@layer\b/.test(rule.cssText ?? '');
  } catch {
    return false;
  }
}

function pushDecl(
  cands: Cand[],
  style: CSSStyleDeclaration,
  cssProp: string,
  spec: number,
  order: number,
  layered: boolean,
): void {
  const value = style.getPropertyValue(cssProp);
  if (!value) return;
  cands.push({
    value,
    important: style.getPropertyPriority(cssProp) === 'important',
    spec,
    order,
    layered,
  });
}

/**
 * ルール列を再帰走査し、element にマッチする宣言を**全プロパティ分まとめて**候補に積む。
 *
 * **1 プロパティずつ走査してはいけない。** 以前はラベルごとに全 styleSheet を走査していたため
 * ホバー 1 回で CSSOM を 10 周し、`element.matches()` も 10 倍呼んでいた
 * (実測: mui.com 規模で 60→27fps、大規模サイトでは 1 ホバー 500ms 超)。
 * マッチ判定はルールごとに 1 回で済むので、そこを共有するだけで支配的なコストが消える。
 */
function collectFromRules(
  rules: CSSRuleList,
  element: Element,
  cssProps: string[],
  out: Map<string, Cand[]>,
  counter: { n: number },
  layered: boolean,
): void {
  for (const rule of Array.from(rules)) {
    if (isStyleRule(rule)) {
      // カンマ区切りの各ブランチのうち element にマッチする最大 specificity を採用
      let best = -1;
      for (const branch of rule.selectorText.split(',')) {
        const b = branch.trim();
        if (!b) continue;
        try {
          if (element.matches(b)) best = Math.max(best, specificity(b));
        } catch {
          // 不正 or 未対応セレクタ (:has の一部等) は静かにスキップ
        }
      }
      if (best >= 0) {
        const order = counter.n++;
        for (const cssProp of cssProps) {
          pushDecl(out.get(cssProp)!, rule.style, cssProp, best, order, layered);
        }
      }
    }
    // グルーピング (@media/@supports/@layer) と CSS ネストは cssRules を持つ。条件付きは評価。
    const nested = (rule as CSSGroupingRule).cssRules;
    if (nested) {
      let ok = true;
      const media = (rule as CSSMediaRule).media;
      const cond = (rule as CSSSupportsRule).conditionText;
      try {
        if (media?.mediaText) ok = matchMedia(media.mediaText).matches;
        else if (cond) ok = CSS.supports(cond);
      } catch {
        ok = true; // 評価不能なら通す (取りこぼしより過検出を許容)
      }
      if (ok) collectFromRules(nested, element, cssProps, out, counter, layered || isLayerBlock(rule));
    }
  }
}

/**
 * 走査対象のスタイルシート。**document.styleSheets だけでは足りない**:
 * - `document.adoptedStyleSheets` (Constructable Stylesheets) は別配列。
 *   Lit / Stencil / 一部の設計トークン配布はここに入れるため、読まないと
 *   「宣言が無い」= 継承値と誤判定する
 * - element が shadow root の中にあるなら、その root の styleSheets / adoptedStyleSheets
 */
function sheetsFor(element: Element): CSSStyleSheet[] {
  const sheets: CSSStyleSheet[] = [];
  const push = (list: ArrayLike<CSSStyleSheet> | undefined) => {
    if (!list) return;
    for (const sheet of Array.from(list)) sheets.push(sheet);
  };
  push(document.styleSheets as unknown as ArrayLike<CSSStyleSheet>);
  push((document as unknown as { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets);
  const root = element.getRootNode?.();
  if (root && root !== document && 'host' in root) {
    const shadow = root as ShadowRoot & { adoptedStyleSheets?: CSSStyleSheet[] };
    push(shadow.styleSheets as unknown as ArrayLike<CSSStyleSheet>);
    push(shadow.adoptedStyleSheets);
  }
  return sheets;
}

/**
 * element の各 cssProp について cascade 勝者宣言を求める (勝者以外の var は絶対に拾わない)。
 * 全プロパティを 1 回の走査で解決する。
 */
function winningValues(element: Element, cssProps: string[]): Map<string, Cand> {
  const cands = new Map<string, Cand[]>();
  for (const p of cssProps) cands.set(p, []);
  const counter = { n: 0 };
  for (const sheet of sheetsFor(element)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin: 読めないので Tier1 は諦め、生値表示に縮退
    }
    if (!rules) continue;
    collectFromRules(rules, element, cssProps, cands, counter, false);
  }
  // inline style は最強 (specificity 上 rule を必ず上回る)
  const inlineStyle = 'style' in element ? (element as HTMLElement).style : null;
  if (inlineStyle) {
    for (const cssProp of cssProps) {
      const v = inlineStyle.getPropertyValue(cssProp);
      if (v) {
        cands.get(cssProp)!.push({
          value: v,
          important: inlineStyle.getPropertyPriority(cssProp) === 'important',
          spec: INLINE_SPEC,
          order: Number.MAX_SAFE_INTEGER,
          layered: false,
        });
      }
    }
  }
  const out = new Map<string, Cand>();
  for (const [cssProp, list] of cands) {
    if (!list.length) continue;
    list.sort(compareCascade);
    out.set(cssProp, list[list.length - 1]);
  }
  return out;
}

/**
 * cascade の強さ比較 (昇順ソート後の末尾が勝者)。
 * 通常宣言は「レイヤ無しが強い」、`!important` は「レイヤ付きが強い」(仕様どおり逆転する)。
 *
 * **shorthand と longhand もこの比較器で競わせる** (例: `.a { background-color: #fff }` と
 * `#id { background: var(--surface) }`)。プロパティ名の順で決めてしまうと、
 * 高 specificity の shorthand 宣言が負けて由来を取り違える。
 */
function compareCascade(a: Cand, b: Cand): number {
  return (
    (a.important === b.important ? 0 : a.important ? 1 : -1) ||
    (a.layered === b.layered ? 0 : a.important ? (a.layered ? 1 : -1) : a.layered ? -1 : 1) ||
    a.spec - b.spec ||
    a.order - b.order
  );
}

/**
 * 値の来歴。「トークンと一致しているか」(今の正しさ) とは直交する軸で、
 * 「トークンを変えたとき追従するか」(これからも正しくあり続けるか) を表す。
 * - var       : cascade 勝者の宣言が定義済みの var(--x) を含む
 * - literal   : 勝者宣言はあるが var を含まない = **この要素で書かれたハードコード**
 * - inherited : この要素にマッチする宣言が無い (継承値 / UA 既定)。literal と混ぜてはいけない
 * - unknown   : CSSOM を読めなかった (クロスオリジン CSS・例外・時間予算切れ)
 */
export type ValueOrigin = 'var' | 'literal' | 'inherited' | 'unknown';

export interface AuthoredInfo {
  origin: ValueOrigin;
  /** origin === 'var' のときのみ非 null */
  varMatch: VarMatch | null;
}

/**
 * 要素の各デザインプロパティについて、宣言された変数名と**来歴**を回収する。
 * CSSOM 走査全体を try/catch で包み、失敗しても呼び元は computed のみで縮退する。
 *
 * 継承値 (inherited) を literal と分けるのが要点。文字色は body に 1 回宣言して数千要素が
 * 継承するのが普通なので、混ぜると「継承した文字色が全部ハードコード」という壊れた
 * 集計になる。
 */
export function collectAuthoredInfo(element: Element): Map<string, AuthoredInfo> {
  const out = new Map<string, AuthoredInfo>();
  let cs: CSSStyleDeclaration | null = null;
  try {
    cs = getComputedStyle(element);
  } catch {
    cs = null;
  }
  // 全ラベル分の CSS プロパティを一度に解決する (CSSOM 走査は 1 回だけ)
  const allProps = [...new Set(PROPS.flatMap(({ prop, label }) => AUTHORED_PROPS[label] ?? [prop]))];
  let resolved: Map<string, Cand> | null = null;
  try {
    resolved = winningValues(element, allProps);
  } catch {
    resolved = null;
  }
  for (const { prop, label } of PROPS) {
    const props = AUTHORED_PROPS[label] ?? [prop];
    if (!resolved) {
      out.set(label, { origin: 'unknown', varMatch: null });
      continue;
    }
    // shorthand 親を含む複数候補は **cascade で競わせる** (プロパティ名の順で決めない)
    let winner: Cand | null = null;
    for (const p of props) {
      const w = resolved.get(p);
      if (w && (!winner || compareCascade(winner, w) < 0)) winner = w;
    }
    if (!winner) {
      // この要素にマッチする宣言が無い = 継承値 or UA 既定
      out.set(label, { origin: 'inherited', varMatch: null });
      continue;
    }
    const parsed = parseVarNames(winner.value);
    if (!parsed) {
      out.set(label, { origin: 'literal', varMatch: null });
      continue;
    }
    // 実際に定義されている変数のみ採用 (var(--undefined, fallback) の未定義名を弾く)
    const defined = cs
      ? parsed.names.filter((n) => cs.getPropertyValue(n).trim() !== '')
      : parsed.names;
    if (!defined.length) {
      // var は書かれているが未定義 → 実際に効いているのはフォールバックのリテラル
      out.set(label, { origin: 'literal', varMatch: null });
      continue;
    }
    out.set(label, {
      origin: 'var',
      varMatch: { name: defined[0], names: defined, ambiguous: defined.length > 1 },
    });
  }
  return out;
}

/**
 * 要素の各デザインプロパティについて「宣言された CSS 変数名」を回収する。
 * collectAuthoredInfo の var 分だけを取り出す薄いラッパ (バッジ表示の既存経路)。
 */
export function collectAuthoredVars(element: Element): Map<string, VarMatch> {
  const out = new Map<string, VarMatch>();
  for (const [label, info] of collectAuthoredInfo(element)) {
    if (info.varMatch) out.set(label, info.varMatch);
  }
  return out;
}
