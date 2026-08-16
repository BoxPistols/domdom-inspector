import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 文書が指す「温存実装の所在」が実在することを機械で保つ。
 *
 * なぜこれが要るか: issue #17 で温存実装を `src/` から `src/render-bundle/` へ移したとき、
 * README (ja/en) / ROADMAP / STORE_LISTING / CLAUDE.md が**旧パスを指したまま残った**。
 * 実害は「再配線しようとした人がファイルを探せない」だけでなく、**掲載文が実際の出荷物と
 * 食い違う**こと (STORE_LISTING は審査に出す文書)。ビルドもテストも通るので気づけない。
 *
 * **全 md の `src/*.ts` 参照を一律に実在チェックしない。** 設計文書には「これから作る
 * モジュール」(`src/coverageView.ts` 等) や、利用者側アプリの例示パス (`src/App.ts`) が
 * 正当に登場し、それらを落とすと検査が信用されなくなって無効化される。
 *
 * ここで見るのは 1 点だけ: **render-bundle にあるモジュールを `src/<名前>.ts` の形で
 * 参照している文書が無いこと。** 移動したのに文書を直し忘れた、という今回の失敗と
 * 1 対 1 で対応する。列挙ではなく走査なので、後からモジュールが増減しても効き続ける。
 */

const DOC_DIRS = ['.', 'docs', '.github'];
const BUNDLE_DIR = 'src/render-bundle';

/** md を集める (node_modules 等は掘らない — 対象は自分たちが書いた文書だけ) */
function collectDocs(): string[] {
  const files: string[] = [];
  for (const dir of DOC_DIRS) {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (!name.endsWith('.md')) continue;
      if (!statSync(path).isFile()) continue;
      files.push(path);
    }
  }
  return files;
}

/** render-bundle にある温存モジュールの名前 (テストファイルは除く) */
function bundleModules(): string[] {
  return readdirSync(BUNDLE_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => f.replace(/\.ts$/, ''));
}

/**
 * 送信経路の申告が文書間でズレていないこと。
 *
 * v0.4.23 で「エディタで開いて」とローカル dev サーバに頼む要求を 1 つ足したとき、
 * SECURITY / PRIVACY / STORE_LISTING / PUBLISHING の 4 文書は直したが、**README (ja/en) が
 * 「fetch/XHR/WebSocket/beacon の発生箇所が 0 件」のまま残った**。一番読まれるファイルに
 * 事実でない安全性の主張が残る、という最悪の形。ビルドもテストも通るので気づけない。
 *
 * 「第三者への送信はゼロ」は今も真なので禁止しない。**測れる数として 0 件を主張する
 * 書き方だけ**を弾く (実際の出現数は 1 で、`pnpm check:submission` が毎回測っている)。
 */
describe('送信経路の申告が実装とズレていない', () => {
  /**
   * 走査から外すもの。**「直しにくいから」ではなく「当時の記録として正しいから」**外す。
   * 外す先は必ず実在を assert する — 消えたファイルを黙って許し続けないため。
   */
  const HISTORICAL = [
    // 版ごとの記録。当時 0 件だったのは事実で、書き換えると履歴の改竄になる
    'CHANGELOG.md',
    // 日付つきの監査記録。「当時 0 件と申告していた」ことを含めて記録である
    'docs/audit-20260807-deep.md',
    // claude-memory-sync が生成する (マーカー内は毎プロンプト自動生成)。ここでは直せない
    'CLAUDE.local.md',
  ];

  it('走査から外した文書はすべて実在する (リストが腐っていないこと)', () => {
    const missing = HISTORICAL.filter((f) => !existsSync(f));
    expect(missing).toEqual([]);
  });

  const docs = collectDocs().filter((f) => !HISTORICAL.includes(f.replace(/^\.\//, '')));

  // 「fetch 等の出現が 0 件」という数の主張。今は 1 件あるので、どの文書にも書けない
  const FALSE_ZERO_CLAIMS = [
    /`?fetch`?[^\n]{0,80}(0 件|ゼロ件)/,
    /(0 件|ゼロ件)[^\n]{0,80}`?fetch`?/,
    /(zero|no)\s+(occurrences?|network requests?)[^\n]{0,80}(fetch|network request)/i,
    /never (makes|issues) any network request/i,
  ];

  it('「送信 API の出現が 0 件」と書いている文書が無い (実際は 1 経路ある)', () => {
    const offenders: string[] = [];
    for (const file of docs) {
      const body = readFileSync(file, 'utf8');
      for (const line of body.split('\n')) {
        if (FALSE_ZERO_CLAIMS.some((re) => re.test(line))) {
          offenders.push(`${file}: ${line.trim().slice(0, 90)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('文書が指す温存実装のパスが実在する', () => {
  const docs = collectDocs();
  const modules = bundleModules();

  it('検査対象が空でない (走査が成立していること)', () => {
    // 対象 0 件で緑になると「何も見ていないのに pass」になる
    expect(docs.length).toBeGreaterThan(5);
    expect(modules.length).toBeGreaterThan(5);
  });

  it('render-bundle のモジュールを src/<名前>.ts で参照している文書が無い', () => {
    const offenders: string[] = [];
    for (const file of docs) {
      const body = readFileSync(file, 'utf8');
      for (const mod of modules) {
        // `src/render-bundle/tree.ts` は "src/tree.ts" を含まないので誤検出しない
        if (new RegExp(String.raw`src/${mod}\.ts`).test(body)) {
          offenders.push(`${file}: src/${mod}.ts → src/render-bundle/${mod}.ts`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
