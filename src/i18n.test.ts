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
});
