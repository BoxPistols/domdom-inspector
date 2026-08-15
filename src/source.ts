import type { PathMapping, SourceLocation } from './types';

/**
 * バンドラ由来の fileName をローカルパスへ正規化する。
 * - dev サーバ URL (http://localhost:3000/src/App.tsx?t=123) → /src/App.tsx
 * - Vite の /@fs/абс パス → 絶対パス
 * - webpack-internal:///./src/App.tsx → /src/App.tsx
 * - Next.js (webpack) のレイヤ `(app-pages-browser)/./src/...` → /src/...
 * - Turbopack の `[project]/src/...` → /src/...
 * 出力は先頭スラッシュ有りに揃える (バンドラ間でパスマッピングの prefix 一致を安定させるため)。
 * 最後にユーザー定義のパスマッピング (prefix 置換) を適用する。
 *
 * pageOrigin は「今見ているページのオリジン」。オリジン限定付きのマッピングは、
 * これに部分一致するときだけ適用する — /src のようなプロジェクト相対 prefix は
 * どのプロジェクトにもあるため、無条件の対応表だと別プロジェクトの検査で誤爆する。
 */
export function normalizeSourcePath(
  fileName: string,
  mappings: PathMapping[] = [],
  pageOrigin = '',
): string {
  let path = fileName;

  const webpackInternal = path.match(/^webpack-internal:\/{3}(?:\.\/)?(.*)$/);
  if (webpackInternal) {
    // URL 経路 (pathname は先頭スラッシュ有り) と揃える
    path = '/' + webpackInternal[1].replace(/^\/+/, '');
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      // URL として解釈不能な場合はそのまま扱う
    }
  }

  // クエリ・ハッシュ除去 (Vite の ?t= キャッシュバスター等)
  path = path.replace(/[?#].*$/, '');

  // Next.js (webpack) のレイヤ名 `(app-pages-browser)` `(rsc)` 等と Turbopack の
  // `[project]` は**ビルド内部の名前空間で、ファイルシステムに存在しない**。
  // 残したままエディタへ送ると「パスが存在しません」になる (Antigravity で実発生)。
  // 先頭セグメントだけを剥がす — Next のルートグループ `app/(marketing)/page.tsx` は
  // 実在するディレクトリだが、パスの途中にしか現れないので巻き込まない
  path = path.replace(/^\/?\([\w-]+\)(?=\/)/, '').replace(/^\/?\[project\](?=\/)/, '');
  // レイヤを剥いだ後などに残る `./` セグメントを潰す (`/(x)/./src/...` → `/src/...`)
  path = path.replace(/\/\.(?=\/)/g, '');

  // 相対パス (ソース注釈属性の `views/index.ejs` 等) も先頭スラッシュに揃える。
  // 揃えないとマッピングの from (慣例的に `/views` と書く) が黙って一致しない
  if (!path.startsWith('/')) path = '/' + path;

  // Vite が絶対パスを公開する /@fs/ prefix
  if (path.startsWith('/@fs/')) {
    path = path.slice('/@fs'.length);
  }

  for (const { from, to, origin } of mappings) {
    // オリジン限定付きは、ページのオリジンが分かっていて一致するときだけ使う。
    // 不明なとき (テストや将来の呼び出し漏れ) に適用してしまうと誤爆に戻る
    if (origin && !(pageOrigin && pageOrigin.toLowerCase().includes(origin.toLowerCase()))) {
      continue;
    }
    if (from && path.startsWith(from)) {
      path = to + path.slice(from.length);
      break;
    }
  }
  return path;
}

const NOISE_PATTERNS = [
  /node_modules/,
  /webpack\/runtime/,
  /react-dom/,
  /react-server-dom/,
  /chrome-extension:\/\//,
  /<anonymous>/,
];

/**
 * Error.stack (React 19 の _debugStack 等) から最初の「アプリコード」フレームの位置を抽出する。
 * React 内部・node_modules のフレームは読み飛ばす。
 */
export function parseStackLocation(stack: string): SourceLocation | null {
  for (const rawLine of stack.split('\n')) {
    // "at App (http://localhost:3000/src/App.tsx?t=1:10:5)" (Chrome) /
    // "App@http://.../App.tsx:10:5" (Firefox) の双方から位置部分だけを取り出す
    let line = rawLine.trim();
    const paren = line.match(/\((.*)\)$/);
    if (paren) line = paren[1];
    else if (line.includes('@')) line = line.slice(line.indexOf('@') + 1);
    else if (line.startsWith('at ')) line = line.slice(3);

    const match = line.match(/^(.*?):(\d+):(\d+)$/);
    if (!match) continue;
    const [, file, lineNo, colNo] = match;
    if (NOISE_PATTERNS.some((p) => p.test(file))) continue;
    // stack 先頭の "Error" 行などファイルらしくないものを除外
    if (!/[/.]/.test(file)) continue;
    return {
      fileName: file,
      lineNumber: Number(lineNo),
      columnNumber: Number(colNo),
    };
  }
  return null;
}

/** ソースパスが node_modules 配下 (= ライブラリ内部) かどうか */
export function isNodeModulesPath(fileName: string): boolean {
  return /node_modules[\\/]/.test(fileName);
}

/** ソースパスが MUI パッケージ配下かどうか */
export function isMuiPath(fileName: string): boolean {
  return /node_modules[\\/]@mui[\\/]/.test(fileName);
}

/**
 * ソースパスがバンドラのハッシュ付きチャンク (本番/preview ビルド出力) かどうか。
 * 例: `_31ecaab0._-.js` / `main.a1b2c3d4.js` / `assets/index-4f2a.js` / `*.chunk.js`。
 * これらは実ソースでなくエディタで開いても無意味なため、file:line 表示とジャンプを抑制する。
 * dev サーバ (vite dev 等) の実ソースパス (`/src/App.tsx`) は false。
 */
export function isBundledSource(fileName: string): boolean {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  return (
    // **配信ディレクトリで判定するのを先に置く。** ハッシュの字種はバンドラごとに違い
    // (Turbopack は base36 で `_0wzpx8i._.js`)、16 進前提の判定では取りこぼす。
    // 取りこぼすと**コンパイル済みチャンクのパスをそのままエディタへ送る**ことになり、
    // 「このコンピューターに存在しません」で終わる (実機で発生)
    BUNDLE_DIRS.test(fileName) ||
    /[-_.][0-9a-f]{6,}(?:[-_.]|\.[cm]?jsx?$)/i.test(base) || // 埋め込みハッシュ (16 進)
    /\.(chunk|bundle)\.[cm]?jsx?$/i.test(base) // *.chunk.js / *.bundle.js
  );
}

/** バンドラが出力を置く配信パス。ここに入っているものは実ソースではない */
const BUNDLE_DIRS =
  /(^|\/)(?:_next\/static|\.next|static\/chunks|static\/js|assets|\.vite\/deps|_nuxt|build\/static)\//;

/**
 * 「プロジェクト相対パス」に見えるか (= ディスク上の絶対パスになっていない)。
 *
 * Next.js (webpack) は `(app-pages-browser)/./src/app/page.tsx` のように**プロジェクト
 * 相対**でソース位置を報告する。レイヤ名を剥がすと `/src/app/page.tsx` になるが、
 * これはディスク上には存在しない。**エディタの scheme URL は絶対パスしか受けず、
 * エディタが開いている作業フォルダは解決に使われない**ため、そのまま送ると必ず失敗する。
 *
 * 判定は「先頭セグメントがプロジェクト内の慣例ディレクトリか」。Docker の `/app` の
 * ように実在する絶対パスを誤判定することはあるが、その場合も対処 (パスマッピングの
 * 追加) は同じなので、案内として誤らない。
 */
const PROJECT_DIRS = new Set([
  'src', 'app', 'pages', 'components', 'lib', 'views', 'styles', 'css', 'public',
  'packages', 'apps', 'server', 'client', 'routes', 'layouts', 'templates',
]);

export function looksProjectRelative(path: string): boolean {
  const first = path.replace(/^\/+/, '').split('/')[0] ?? '';
  return PROJECT_DIRS.has(first.toLowerCase());
}

/**
 * 追加すべきパスマッピングの 1 行を組み立てる (利用者がそのまま貼れる形)。
 * 「開けません」で終わらせず、**何をどこに書けば開くようになるか**まで渡す。
 */
export function suggestMapping(path: string, host = ''): string {
  const first = path.replace(/^\/+/, '').split('/')[0] ?? '';
  const scope = host ? ` @ ${host}` : '';
  return `/${first}=<プロジェクトの絶対パス>/${first}${scope}`;
}
