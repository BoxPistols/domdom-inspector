import type { PathMapping, SourceLocation } from './types';

/**
 * バンドラ由来の fileName をローカルパスへ正規化する。
 * - dev サーバ URL (http://localhost:3000/src/App.tsx?t=123) → /src/App.tsx
 * - Vite の /@fs/абс パス → 絶対パス
 * - webpack-internal:///./src/App.tsx → /src/App.tsx
 * 出力は先頭スラッシュ有りに揃える (バンドラ間でパスマッピングの prefix 一致を安定させるため)。
 * 最後にユーザー定義のパスマッピング (prefix 置換) を適用する。
 */
export function normalizeSourcePath(fileName: string, mappings: PathMapping[] = []): string {
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

  // Vite が絶対パスを公開する /@fs/ prefix
  if (path.startsWith('/@fs/')) {
    path = path.slice('/@fs'.length);
  }

  for (const { from, to } of mappings) {
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
