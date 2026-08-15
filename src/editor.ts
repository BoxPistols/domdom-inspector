import { looksProjectRelative, normalizeSourcePath } from './source';
import type { Settings, SourceLocation } from './types';

// {file} は先頭スラッシュ込みで展開される (二重スラッシュ防止のため template 側に / を書かない)
const EDITOR_TEMPLATES: Record<Exclude<Settings['editor'], 'custom'>, string> = {
  vscode: 'vscode://file{file}:{line}:{column}',
  cursor: 'cursor://file{file}:{line}:{column}',
  // Antigravity IDE (com.google.antigravity-ide)。scheme は antigravity-ide://。
  // 素の antigravity:// は別アプリ (com.google.antigravity, ランチャ) が握るため IDE が開かない。
  antigravity: 'antigravity-ide://file{file}:{line}:{column}',
  webstorm: 'webstorm://open?file={file}&line={line}',
};

/** パスマッピング適用後の絶対パス (先頭スラッシュ 1 つに正規化) */
function absPath(settings: Settings, loc: SourceLocation): string {
  // オリジン限定付きマッピングの判定用。MAIN world では検査中のページのオリジン。
  // location が無い環境 (テスト等) では空 = 限定付きマッピングは適用されない
  const pageOrigin = typeof location !== 'undefined' ? location.origin : '';
  return '/' + normalizeSourcePath(loc.fileName, settings.pathMappings, pageOrigin).replace(/^\/+/, '');
}

/** 設定とソース位置からエディタ起動 URL を組み立てる (FR-08) */
export function buildEditorUrl(settings: Settings, loc: SourceLocation): string {
  const template =
    settings.editor === 'custom'
      ? settings.customUrlTemplate
      : EDITOR_TEMPLATES[settings.editor];
  const file = absPath(settings, loc);
  return template
    .replaceAll('{file}', file)
    .replaceAll('{line}', String(loc.lineNumber))
    .replaceAll('{column}', String(loc.columnNumber || 1));
}

/**
 * 人が読める「場所」の文字列 (`/src/App.tsx:42`)。
 * **エディタが開かなかったときのフォールバック**に使う: scheme の起動は投げっぱなしで
 * 成否が取れないため、開かなかったときに手で辿れる情報を渡せるようにしておく。
 */
export function formatSourceRef(settings: Settings, loc: SourceLocation): string {
  return `${absPath(settings, loc)}:${loc.lineNumber}`;
}

/**
 * 解決後のパスが**そのままでは開けない**か (プロジェクト相対のまま) を返す。
 *
 * エディタの scheme URL は絶対パスしか受けず、エディタが開いている作業フォルダは
 * 解決に使われない。相対のまま送ると必ず「このコンピューターに存在しません」になる。
 * 送る前に判定して、代わりに**何を設定すれば開くか**を出すために使う。
 */
export function needsPathMapping(settings: Settings, loc: SourceLocation): boolean {
  return looksProjectRelative(absPath(settings, loc));
}

/** 開けないときに提示する「解決後のパス」(利用者が対応表を書く手がかりになる) */
export function resolvedPath(settings: Settings, loc: SourceLocation): string {
  return absPath(settings, loc);
}
