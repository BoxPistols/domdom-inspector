import type { PathMapping } from './types';

/**
 * パスマッピングのテキスト (1 行 1 件 `from=to`) を PathMapping[] にパースする。
 * `=` を含まない行は除外。値内に `=` を含む場合は最初の `=` でのみ分割。前後空白は trim。
 */
export function parseMappings(text: string): PathMapping[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return { from: line.slice(0, index), to: line.slice(index + 1) };
    });
}
