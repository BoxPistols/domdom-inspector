import { isMuiPath, isNodeModulesPath } from './source';
import type { Classification } from './types';

/**
 * コンポーネントを MUI / 自作 / サードパーティに分類する (FR-02)。
 * 優先順位: ソースパス (最も確実) > DOM の Mui* クラス > displayName ヒューリスティック。
 * classNames は Element 非依存のテスト容易性のため文字列配列で受ける。
 */
export function classify(
  name: string | null,
  sourcePath: string | null,
  classNames: readonly string[] = [],
): Classification {
  if (sourcePath) {
    if (isMuiPath(sourcePath)) return 'mui';
    if (isNodeModulesPath(sourcePath)) return 'third-party';
    return 'custom';
  }
  if (classNames.some((c) => /^Mui[A-Z]/.test(c))) return 'mui';
  // emotion/MUI の内部名 (Styled(...) 等) は MUI 寄りに判定
  if (name && /^(Mui|Styled\()/.test(name)) return 'mui';
  if (name) return 'custom';
  return 'third-party';
}
