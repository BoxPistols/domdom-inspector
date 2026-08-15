import type { PathMapping } from './types';

/**
 * パスマッピングのテキスト (1 行 1 件) を PathMapping[] にパースする。
 *
 *   /src=/Users/me/proj/src
 *   /src=/Users/me/proj/src @ localhost:3000
 *
 * ` @ ` 以降はオリジン限定 (部分一致)。`=` を含まない行は除外。値内に `=` を含む場合は
 * 最初の `=` でのみ分割。前後空白は trim。serializeMappings と往復で一致すること。
 */
export function parseMappings(text: string): PathMapping[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('='))
    .map((line) => {
      let origin = '';
      const at = line.lastIndexOf(' @ ');
      if (at >= 0) {
        origin = line.slice(at + 3).trim();
        line = line.slice(0, at).trim();
      }
      const index = line.indexOf('=');
      const m: PathMapping = { from: line.slice(0, index), to: line.slice(index + 1) };
      if (origin) m.origin = origin;
      return m;
    });
}

/** PathMapping[] を popup の編集テキストへ戻す (parseMappings と往復で一致すること) */
export function serializeMappings(mappings: PathMapping[]): string {
  return mappings
    .map((m) => `${m.from}=${m.to}${m.origin ? ` @ ${m.origin}` : ''}`)
    .join('\n');
}
