import { resolveOriginalPosition, sourceMapUrlFrom, toLocalPath, type RawSourceMap } from './sourceMap';
import type { SourceLocation } from './types';

/**
 * dev サーバ経由でエディタを開く (FR-08 の本線)。
 *
 * **なぜスキーム (`cursor://file…`) ではなく dev サーバなのか。**
 * スキーム URL は**絶対パスしか受けず、エディタが開いている作業フォルダは解決に
 * 使われない**。一方ブラウザは「そのプロジェクトがディスクのどこにあるか」を原理的に
 * 知り得ない。この不一致のせいで、利用者に絶対パスを設定させる必要が生じ、実機では
 * 一度も成功しなかった (対応表の 1 段違い / `~` の非展開 / モノレポの root ズレ)。
 *
 * dev サーバは**自分がそのプロジェクト**なので、ルートを知っている。ブラウザは
 * 「`src/pages/X.tsx` の 28 行目を開いて」と**相対パスのまま**言えばよく、利用者の
 * 設定は要らなくなる。Vue DevTools / Nuxt DevTools / react-dev-inspector が
 * 常に動くのはこの方式だから。
 *
 * **通信はローカルの開発サーバに対してのみ**行う (呼び出し側が `looksLocalDev` で
 * 判定する)。送るのは「そのページ自身が生成したソースパス」だけで、ページ内容も
 * 利用者データも送らない。外部へは 1 バイトも出さない。
 */

/** 既知の launch-editor エンドポイント (フレームワークが dev サーバに載せているもの) */
export interface EditorEndpoint {
  /** 表示・記録用の名前 */
  name: string;
  /** origin と位置から要求 URL を組み立てる */
  url: (origin: string, loc: SourceLocation) => string;
}

/**
 * dev サーバへ渡すパス。**パスの対応表は適用しない** — サーバが欲しいのは
 * プロジェクト相対パスで、ローカル絶対パスへの書き換えはむしろ邪魔になる。
 * クエリ (Vite の `?t=`) だけ落とし、先頭スラッシュも落とす (相対で渡す慣例)。
 */
export function devServerPath(fileName: string): string {
  let path = fileName;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      /* URL として読めなければそのまま */
    }
  }
  path = path.replace(/[?#].*$/, '');
  // Vite が絶対パスを公開する形。サーバ側は絶対パスも受けるので prefix だけ外す
  if (path.startsWith('/@fs/')) path = path.slice('/@fs'.length);
  // 絶対パスはそのまま、相対パスは先頭スラッシュを落とす
  return path.startsWith('/') && !/^\/(?:Users|home|Volumes|opt|srv|data|workspace)\//.test(path)
    ? path.replace(/^\/+/, '')
    : path;
}

export const ENDPOINTS: EditorEndpoint[] = [
  {
    // Vite (launch-editor-middleware) / vite-plugin-vue-inspector / react-dev-inspector
    name: 'vite',
    url: (origin, loc) =>
      `${origin}/__open-in-editor?file=${encodeURIComponent(
        `${devServerPath(loc.fileName)}:${loc.lineNumber}:${loc.columnNumber || 1}`,
      )}`,
  },
  {
    // Next.js (dev overlay の「エディタで開く」が使っている経路)
    //
    // **パラメータ名は `line1` / `column1`** (2026-08-17 実測、Next 16.3.0)。
    // `lineNumber` / `column` は**無視され、必ず 1 行目が開く**。
    // 「開くけど該当箇所に飛ばない」の直接の原因がこれだった。
    // 旧版のために `lineNumber` / `column` も併記する (余分なクエリは無害)。
    name: 'next',
    url: (origin, loc) =>
      `${origin}/__nextjs_launch-editor?file=${encodeURIComponent(devServerPath(loc.fileName))}` +
      `&line1=${loc.lineNumber}&column1=${loc.columnNumber || 1}` +
      `&lineNumber=${loc.lineNumber}&column=${loc.columnNumber || 1}`,
  },
  {
    // Create React App (react-error-overlay)
    name: 'cra',
    url: (origin, loc) =>
      `${origin}/__open-stack-frame-in-editor?fileName=${encodeURIComponent(
        devServerPath(loc.fileName),
      )}&lineNumber=${loc.lineNumber}&colNumber=${loc.columnNumber || 1}`,
  },
];

/**
 * 応答が「エンドポイントが処理した」ものか。
 *
 * **200 だけでは判定できない。** SPA の history フォールバックは未知のパスにも
 * 200 で index.html を返すため、素朴に見ると「開いた」と誤答する (実測: 未知ルートは
 * `content-type: text/html` の 1673 バイト、launch-editor は content-type 無しの 0 バイト)。
 * HTML が返ってきたらフォールバックとみなす。
 */
export function handledByEditor(status: number, contentType: string | null): boolean {
  if (status < 200 || status >= 300) return false;
  return !/text\/html/i.test(contentType ?? '');
}

/** 直近に成功したエンドポイント (origin ごと)。2 回目以降の無駄な試行を省く */
const preferred = new Map<string, EditorEndpoint>();

/**
 * dev サーバにエディタ起動を依頼する。開けたら true。
 *
 * **ローカル開発オリジンでのみ呼ぶこと** (判定は呼び出し側の責務)。
 * 既知のエンドポイントを順に試し、最初に処理されたもので終わる。
 */
/**
 * **この拡張が発行する唯一のネットワーク要求。**
 * 監査 (`SECURITY.md` の grep) がここに必ず当たるよう、`fetch(` の形で 1 箇所に集める。
 * ラップせず既定引数に `fetch` を置くと `fetch(` の文字列が現れず、
 * 「送信 API は 0 件」という**嘘の監査結果**になる。
 */
function requestOpen(url: string): Promise<Response> {
  return fetch(url, { method: 'GET', credentials: 'omit', cache: 'no-store' });
}

export async function openViaDevServer(
  origin: string,
  loc: SourceLocation,
  request: (url: string) => Promise<Response> = requestOpen,
): Promise<boolean> {
  const order = [
    ...(preferred.has(origin) ? [preferred.get(origin)!] : []),
    ...ENDPOINTS.filter((e) => e !== preferred.get(origin)),
  ];
  for (const endpoint of order) {
    try {
      const res = await request(endpoint.url(origin, loc));
      if (handledByEditor(res.status, res.headers.get('content-type'))) {
        preferred.set(origin, endpoint);
        return true;
      }
    } catch {
      // 接続不可・CSP 等。次のエンドポイントへ (dev サーバが無いページなら全部失敗する)
    }
  }
  return false;
}

/**
 * **2 つ目のネットワーク要求**: バンドル出力の位置を元ソースへ戻すため、
 * ページ自身の dev サーバから source map を取る。
 *
 * なぜ要るか (2026-08-16 実測): React 19 は `_debugSource` を削除した。位置は
 * Owner Stacks から取れるが**バンドル後の座標**なので、そのままではエディタで開けない
 * (`isBundledSource` が正しく弾く)。source map を通すと元ファイルの**絶対パス**が
 * 得られ、パスの対応表も要らなくなる。
 *
 * 宛先はエディタ起動と同じ「利用者自身のローカル開発サーバ」だけ (呼び出し側が
 * `looksLocalDev` で判定する)。送るのはページが自分で配信している URL のみで、
 * ページ内容も利用者データも含まない。**送信 API をこのファイルに集約する方針**は
 * 変えない (監査の grep が 1 ファイルに当たる状態を保つ)。
 */
function requestText(url: string): Promise<Response> {
  return fetch(url, { method: 'GET', credentials: 'omit', cache: 'no-store' });
}

/** 同じ map を何度も取らない (実測で 288 KB あった)。origin ごとに保持 */
const sourceMapCache = new Map<string, RawSourceMap | null>();

/** テスト用に破棄できるようにする (キャッシュが検証を汚さないため) */
export function clearSourceMapCache(): void {
  sourceMapCache.clear();
}

async function loadSourceMap(
  scriptUrl: string,
  request: (url: string) => Promise<Response>,
): Promise<RawSourceMap | null> {
  const cached = sourceMapCache.get(scriptUrl);
  if (cached !== undefined) return cached;

  const attempt = async (): Promise<RawSourceMap | null> => {
    // 慣例の `<script>.map` を先に試す (実測の Next.js/Turbopack はこの形)。
    // 外れたときだけスクリプト本体を取って `sourceMappingURL` を読む
    for (const candidate of [`${scriptUrl}.map`, null]) {
      let mapUrl = candidate;
      if (mapUrl === null) {
        const res = await request(scriptUrl).catch(() => null);
        if (!res?.ok) return null;
        const body = await res.text().catch(() => '');
        // 末尾だけ見る (巨大なチャンク全文を正規表現に掛けない)
        mapUrl = sourceMapUrlFrom(scriptUrl, body.slice(-2000));
        if (!mapUrl || mapUrl.startsWith('data:')) return null;
      }
      const res = await request(mapUrl).catch(() => null);
      if (!res?.ok) continue;
      const json = (await res.json().catch(() => null)) as RawSourceMap | null;
      if (json && (json.mappings || json.sections)) return json;
    }
    return null;
  };

  const map = await attempt();
  sourceMapCache.set(scriptUrl, map);
  return map;
}

/**
 * 解決の結果。**失敗を 1 つの null に潰さない** — 理由ごとに利用者へ出す説明が違う:
 * - `no-map`: dev サーバが応答しない / map が無い → **サーバが落ちている**ことが多い
 * - `no-mapping`: map はあるがその位置の対応が無い
 * - `not-local`: 元ソースが仮想パス (`webpack://` 等) でディスク上の場所が分からない
 *
 * 潰すと「バンドル出力です」とだけ出て、**どの層で失敗したのか誰にも分からなくなる**
 * (実際にその状態で報告を受けた)。
 */
export type SourceMapOutcome =
  | { ok: true; loc: SourceLocation }
  | { ok: false; reason: 'no-map' | 'no-mapping' | 'not-local' | 'library' };

/** バンドル出力の位置を元ソースの位置へ戻す (**開けないものを開けると言わない**) */
export async function resolveViaSourceMap(
  loc: SourceLocation,
  request: (url: string) => Promise<Response> = requestText,
): Promise<SourceMapOutcome> {
  const map = await loadSourceMap(loc.fileName, request);
  if (!map) return { ok: false, reason: 'no-map' };
  const original = resolveOriginalPosition(map, loc.lineNumber, loc.columnNumber || 1);
  if (!original) return { ok: false, reason: 'no-mapping' };
  const path = toLocalPath(original.source);
  if (!path) return { ok: false, reason: 'not-local' };
  // **戻した後にも検査する。** バンドル名は正体を隠すので、マッピング前の除外だけでは
  // ライブラリの内部を素通りさせる。React は Owner Stack の実捕捉を先頭 1 万要素までに
  // 制限しており、超えると **React 内部で作った共有スタック**が入るため、素直に戻すと
  // `react-jsx-dev-runtime.development.js` が開く (2026-08-17 の実機報告)
  if (isLibraryPath(path)) return { ok: false, reason: 'library' };
  return {
    ok: true,
    loc: { fileName: path, lineNumber: original.line, columnNumber: original.column },
  };
}

/** 利用者が編集する対象ではないパス (依存パッケージ / フレームワークの実装) */
export function isLibraryPath(path: string): boolean {
  return /(?:^|[/\\])(?:node_modules|\.pnpm|\.yarn)[/\\]/.test(path);
}

/**
 * 候補を順に試し、**利用者のコードに当たった最初のもの**を返す。
 *
 * 1 つ目が当たりとは限らない (上記の共有スタック)。全部外れたら、最後に見た理由を返す。
 */
export async function resolveFirstAuthored(
  candidates: readonly SourceLocation[],
  request: (url: string) => Promise<Response> = requestText,
): Promise<SourceMapOutcome> {
  let last: SourceMapOutcome = { ok: false, reason: 'no-mapping' };
  for (const candidate of candidates) {
    const outcome = await resolveViaSourceMap(candidate, request);
    if (outcome.ok) return outcome;
    last = outcome;
  }
  return last;
}
