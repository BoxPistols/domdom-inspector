/**
 * source map から「バンドル後の位置 → 元ファイルの位置」を解決する純ロジック。
 *
 * **なぜ要るか** (2026-08-16 実測): React 19 は `_debugSource` を削除した。現行の
 * ソースジャンプはこれ 1 本に頼っていたため、**React 19 のアプリでは位置が 1 つも
 * 取れない** (Next.js 16 の実機で 25 世代すべて 0 件)。代わりに Owner Stacks
 * (`fiber._debugStack`) が入っており、そこにはバンドル後の座標がある。
 * 元ファイルへ戻すのがこの module。
 *
 * 実測した経路 (Next.js 16 + Turbopack):
 *   `_debugStack` の `…/_next/static/chunks/_1dffrib._.js:1921:245`
 *     → source map (indexed, 35 sections)
 *     → `/Users/…/components/input/SampleBrowser.tsx:68` = 対象の `<img>` の行
 *
 * **絶対パスが得られる**ので、対応表 (パスマッピング) は要らなくなる。
 */

const VLQ_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VLQ_INDEX = new Map<string, number>();
for (let i = 0; i < VLQ_CHARS.length; i += 1) VLQ_INDEX.set(VLQ_CHARS[i], i);

/**
 * Base64 VLQ の 1 セグメントを数値列にする。
 * 未知の文字が来たら**途中までを返さず空を返す** — 壊れた map で誤った位置を出すより
 * 「解決できない」に倒す (この製品の失敗類型は欠測ではなく誤答)。
 */
export function decodeVlq(segment: string): number[] {
  const out: number[] = [];
  let shift = 0;
  let value = 0;
  for (const ch of segment) {
    const digit = VLQ_INDEX.get(ch);
    if (digit === undefined) return [];
    const cont = digit & 32;
    value += (digit & 31) << shift;
    if (cont) {
      shift += 5;
    } else {
      const negative = value & 1;
      const magnitude = value >> 1;
      out.push(negative ? -magnitude : magnitude);
      value = 0;
      shift = 0;
    }
  }
  return out;
}

/** source map の最小形 (必要なフィールドだけ) */
export interface RawSourceMap {
  version?: number;
  sources?: string[];
  mappings?: string;
  sourceRoot?: string;
  /** indexed source map (Turbopack / webpack の分割出力で使われる) */
  sections?: { offset: { line: number; column: number }; map: RawSourceMap }[];
}

export interface OriginalPosition {
  /** 元ファイル。実測では `file:///abs/path.tsx` の形で入っている */
  source: string;
  /** 1 起点 */
  line: number;
  /** 1 起点 */
  column: number;
}

/**
 * 生成位置 (1 起点) から元の位置を引く。
 *
 * **同じ行で「対象列を超えない最大の列」を選ぶ** — mappings は生成列の昇順に並ぶので、
 * 対象列以下で最も右のものがその位置を含む区間になる。近い方を適当に選ぶと
 * 隣の式の行を指してしまう。
 */
export function resolveOriginalPosition(
  map: RawSourceMap,
  generatedLine: number,
  generatedColumn: number,
): OriginalPosition | null {
  type Best = { genColumn: number; position: OriginalPosition };
  // クロージャ内で代入するため、**プロパティに持たせる** (ローカル変数だと
  // TypeScript が never へ狭めて型エラーになる)
  const state: { best: Best | null } = { best: null };

  const scan = (section: RawSourceMap, lineOffset: number, columnOffset: number) => {
    const sources = section.sources ?? [];
    const mappings = section.mappings ?? '';
    // 差分符号なのでセクションごとに状態を持つ
    let sourceIndex = 0;
    let sourceLine = 0;
    let sourceColumn = 0;
    const lines = mappings.split(';');
    for (let gl = 0; gl < lines.length; gl += 1) {
      let genColumn = 0;
      for (const segment of lines[gl].split(',')) {
        if (!segment) continue;
        const fields = decodeVlq(segment);
        if (fields.length === 0) continue;
        genColumn += fields[0];
        if (fields.length < 4) continue;
        sourceIndex += fields[1];
        sourceLine += fields[2];
        sourceColumn += fields[3];
        // 1 起点へ。**セクションの列オフセットは 0 行目にしか効かない**
        const absLine = lineOffset + gl + 1;
        const absColumn = (gl === 0 ? columnOffset + genColumn : genColumn) + 1;
        if (absLine !== generatedLine || absColumn > generatedColumn) continue;
        if (state.best && absColumn <= state.best.genColumn) continue;
        const source = sources[sourceIndex];
        if (source === undefined) continue;
        const found: Best = {
          genColumn: absColumn,
          position: {
            source: withRoot(source, section.sourceRoot ?? map.sourceRoot),
            line: sourceLine + 1,
            column: sourceColumn + 1,
          },
        };
        state.best = found;
      }
    }
  };

  if (map.sections?.length) {
    for (const section of map.sections) {
      scan(section.map, section.offset.line, section.offset.column);
    }
  } else {
    scan(map, 0, 0);
  }
  return state.best ? state.best.position : null;
}

/** sourceRoot が付いていれば繋ぐ (絶対パス / URL のときはそのまま) */
function withRoot(source: string, root: string | undefined): string {
  if (!root) return source;
  if (/^(?:[a-z][a-z0-9+.-]*:)?\//i.test(source)) return source;
  return `${root.replace(/\/$/, '')}/${source}`;
}

/**
 * `file:///abs/path` や `webpack://…` を、エディタに渡せるローカル絶対パスにする。
 * **戻せない形 (webpack:// の仮想パス等) は null** — 開けないものを開けると言わない。
 */
export function toLocalPath(source: string): string | null {
  if (source.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(source).pathname);
    } catch {
      return null;
    }
  }
  if (source.startsWith('/')) return source;
  return null;
}

/** `//# sourceMappingURL=` を読み、スクリプト URL からの絶対 URL にする */
export function sourceMapUrlFrom(scriptUrl: string, scriptTail: string): string | null {
  const match = /[#@]\s*sourceMappingURL=([^\s'"]+)/.exec(scriptTail);
  if (!match) return null;
  const raw = match[1];
  // data: URI に埋め込まれている場合はそのまま返す (呼び出し側が判別する)
  if (raw.startsWith('data:')) return raw;
  try {
    return new URL(raw, scriptUrl).toString();
  } catch {
    return null;
  }
}
