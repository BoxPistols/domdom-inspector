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
 * 厳密仕様 (:where/:is/@layer 等) は近似だが、cascade 勝者の推定には十分。
 */
export function specificity(selector: string): number {
  const s = selector.trim();
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classesAttrsPseudo =
    (s.match(/\.[\w-]+/g) ?? []).length +
    (s.match(/\[[^\]]+\]/g) ?? []).length +
    (s.match(/(?<!:):(?!:)[\w-]+(?:\([^)]*\))?/g) ?? []).length;
  const stripped = s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|::?[\w-]+(?:\([^)]*\))?|[*>+~]/g, ' ');
  const types = (stripped.match(/[a-zA-Z][\w-]*/g) ?? []).length;
  return ids * 10000 + classesAttrsPseudo * 100 + types;
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
}

const INLINE_SPEC = 1_000_000; // inline style は全ルールより強い

function isStyleRule(r: CSSRule): r is CSSStyleRule {
  return 'selectorText' in r && 'style' in r;
}

function pushDecl(cands: Cand[], style: CSSStyleDeclaration, cssProp: string, spec: number, order: number): void {
  const value = style.getPropertyValue(cssProp);
  if (!value) return;
  cands.push({ value, important: style.getPropertyPriority(cssProp) === 'important', spec, order });
}

/** ルール列を再帰走査し、element にマッチする cssProp 宣言を候補に積む */
function collectFromRules(
  rules: CSSRuleList,
  element: Element,
  cssProp: string,
  cands: Cand[],
  counter: { n: number },
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
      if (best >= 0) pushDecl(cands, rule.style, cssProp, best, counter.n++);
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
      if (ok) collectFromRules(nested, element, cssProp, cands, counter);
    }
  }
}

/** element の cssProps について cascade 勝者宣言を求める (勝者以外の var は絶対に拾わない) */
function winningValue(element: Element, cssProps: string[]): { value: string; important: boolean } | null {
  const cands: Cand[] = [];
  const counter = { n: 0 };
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin: 読めないので Tier1 は諦め、生値表示に縮退
    }
    if (!rules) continue;
    for (const cssProp of cssProps) collectFromRules(rules, element, cssProp, cands, counter);
  }
  // inline style は最強 (specificity 上 rule を必ず上回る)
  const inlineStyle = 'style' in element ? (element as HTMLElement).style : null;
  if (inlineStyle) {
    for (const cssProp of cssProps) {
      const v = inlineStyle.getPropertyValue(cssProp);
      if (v) {
        cands.push({
          value: v,
          important: inlineStyle.getPropertyPriority(cssProp) === 'important',
          spec: INLINE_SPEC,
          order: Number.MAX_SAFE_INTEGER,
        });
      }
    }
  }
  if (!cands.length) return null;
  // 昇順ソート後の末尾 = (important, specificity, source order) 最優先 = cascade 勝者
  cands.sort(
    (a, b) =>
      (a.important === b.important ? 0 : a.important ? 1 : -1) ||
      a.spec - b.spec ||
      a.order - b.order,
  );
  const w = cands[cands.length - 1];
  return { value: w.value, important: w.important };
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
  for (const { prop, label } of PROPS) {
    const props = AUTHORED_PROPS[label] ?? [prop];
    let winner: { value: string; important: boolean } | null = null;
    let failed = false;
    try {
      winner = winningValue(element, props);
    } catch {
      failed = true;
    }
    if (failed) {
      out.set(label, { origin: 'unknown', varMatch: null });
      continue;
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
