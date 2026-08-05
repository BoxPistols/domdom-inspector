import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_STRINGS } from './types';

// i18n の 3 箇所同期 (DEFAULT_STRINGS + _locales/en + _locales/ja) を機械強制する。
// bridge は全 DEFAULT_STRINGS キーを反復するため、locale に欠けがあると実行時に壊れる。
// vitest の cwd はプロジェクトルート。
const loadLocale = (locale: string): Record<string, unknown> =>
  JSON.parse(readFileSync(`public/_locales/${locale}/messages.json`, 'utf8'));

describe('i18n locale coverage', () => {
  const stringKeys = Object.keys(DEFAULT_STRINGS);

  for (const locale of ['en', 'ja'] as const) {
    it(`${locale}: DEFAULT_STRINGS の全キーが _locales に存在する`, () => {
      const msgs = loadLocale(locale);
      const missing = stringKeys.filter((k) => !(k in msgs));
      expect(missing).toEqual([]);
    });
  }

  it('en と ja のメッセージキー集合が完全一致する (どちらかの追加漏れを検知)', () => {
    const en = Object.keys(loadLocale('en')).sort();
    const ja = Object.keys(loadLocale('ja')).sort();
    expect(ja).toEqual(en);
  });

  // en ロケールへの CJK 混入 (和文の書き忘れ・貼り間違い) を機械検知する。
  // description フィールドは審査者向けメモのため対象は message のみ。
  it('en: message に CJK 文字が混入していない', () => {
    const en = loadLocale('en');
    const cjk = /[　-ヿ㐀-鿿！-｠]/;
    const offenders = Object.entries(en)
      .filter(([, v]) => cjk.test((v as { message: string }).message))
      .map(([k]) => k);
    expect(offenders).toEqual([]);
  });

  // 文言の一括置換で {n} / {key} / {origin} 等の置換アンカーを壊すと実行時に
  // 生プレースホルダが表示される。集合一致を機械強制して置換破壊を検知する。
  it('プレースホルダの集合が DEFAULT_STRINGS / en / ja で一致する', () => {
    const placeholders = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort();
    const messageOf = (msgs: Record<string, unknown>, key: string) =>
      (msgs[key] as { message: string }).message;
    const en = loadLocale('en');
    const ja = loadLocale('ja');
    for (const key of Object.keys(en)) {
      expect({ key, ph: placeholders(messageOf(ja, key)) }).toEqual({
        key,
        ph: placeholders(messageOf(en, key)),
      });
    }
    for (const key of stringKeys as (keyof typeof DEFAULT_STRINGS)[]) {
      expect({ key, ph: placeholders(messageOf(en, key)) }).toEqual({
        key,
        ph: placeholders(DEFAULT_STRINGS[key]),
      });
    }
  });
});

/**
 * popup の `data-i18n` / `data-i18n-title` が指すキーが両 locale に実在すること。
 *
 * これが無いと、キー名を打ち間違えた/リネームした時に `browser.i18n.getMessage` が空を返し、
 * **HTML に書いた英語のフォールバックが日本語 UI でも出る**という形で静かに壊れる
 * (applyI18n は空なら textContent を書き換えないため、エラーにならない)。
 * v1 のスコープ整理で popup のセクションを削除した際、参照だけ残る事故も防ぐ。
 */
describe('popup の data-i18n キーは両 locale に実在する', () => {
  const html = readFileSync('entrypoints/popup/index.html', 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-title)?="([A-Za-z0-9_]+)"/g)].map((m) => m[1]);

  it('参照キーを 1 つ以上検出できている (正規表現が壊れていないことの確認)', () => {
    expect(keys.length).toBeGreaterThan(10);
  });

  it.each(['en', 'ja'])('%s に全キーが存在する', (locale) => {
    const messages = JSON.parse(
      readFileSync(`public/_locales/${locale}/messages.json`, 'utf8'),
    ) as Record<string, { message: string }>;
    const missing = [...new Set(keys)].filter((k) => !messages[k]);
    expect(missing).toEqual([]);
  });
});
