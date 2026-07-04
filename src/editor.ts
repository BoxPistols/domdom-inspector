import { normalizeSourcePath } from './source';
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

/** 設定とソース位置からエディタ起動 URL を組み立てる (FR-08) */
export function buildEditorUrl(settings: Settings, loc: SourceLocation): string {
  const template =
    settings.editor === 'custom'
      ? settings.customUrlTemplate
      : EDITOR_TEMPLATES[settings.editor];
  const file = '/' + normalizeSourcePath(loc.fileName, settings.pathMappings).replace(/^\/+/, '');
  return template
    .replaceAll('{file}', file)
    .replaceAll('{line}', String(loc.lineNumber))
    .replaceAll('{column}', String(loc.columnNumber || 1));
}
