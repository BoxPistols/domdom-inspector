import tseslint from 'typescript-eslint';

// 回帰防止体制の一部 (plans/20260717-worldclass-plan.plan.md §2)。
// recommended 全部でなく、CLAUDE.md 規約を機械強制する的を絞ったルールのみ。
// 境界契約 (design 経路 ↛ Fiber 結合) は src/boundaries.test.ts と二重防御。
export default tseslint.config(
  {
    ignores: [
      'node_modules',
      '.output',
      '.wxt',
      'dist',
      'coverage',
      'test-results',
      'stats*.html',
      'stats-*.json',
    ],
  },
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      // any 禁止 (CLAUDE.md 規約)。Fiber 内部のみ下の override で許容。
      '@typescript-eslint/no-explicit-any': 'error',
      // @ts-ignore / @ts-expect-error による型エラー黙殺の禁止
      '@typescript-eslint/ban-ts-comment': 'error',
      // console.log の commit 禁止 (warn/error は許容)。CI の grep をルールへ昇格。
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Fiber 内部は React バージョン依存で any 許容 (CLAUDE.md 地雷4)
    files: ['src/fiber.ts', 'src/tree.ts', 'src/renderTracker.ts', 'src/renderCause.ts', 'src/hook.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    // design 計測経路 (framework 非依存) は Fiber 結合モジュールを import しない (境界契約)
    files: [
      'src/designStyle.ts',
      'src/cssVars.ts',
      'src/tokenDict.ts',
      'src/tokenLint.ts',
      'src/classify.ts',
      'src/overlayFormat.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                './fiber',
                './hook',
                './tree',
                './treeView',
                './renderTracker',
                './renderCause',
                './renderDebug',
              ],
              message: 'design 経路は Fiber 結合を import しない (境界契約 = 今回のバグ類型の構造的予防)',
            },
          ],
        },
      ],
    },
  },
);
