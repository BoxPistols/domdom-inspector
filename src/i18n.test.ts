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
