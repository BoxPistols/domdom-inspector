import { describe, expect, it } from 'vitest';
import { buildAiRequest, migrateModelId, parseAiError, parseAiResponse } from './aiProviders';

describe('buildAiRequest', () => {
  it('OpenAI: chat/completions に system/user メッセージとキーを載せる', () => {
    const req = buildAiRequest('openai', 'gpt-5-nano', 'sk-test', 'SYS', 'USER');
    expect(req.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(req.headers.Authorization).toBe('Bearer sk-test');
    expect(req.body).toEqual({
      model: 'gpt-5-nano',
      messages: [
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'USER' },
      ],
    });
  });

  it('Gemini: generateContent にキーをヘッダで載せ、モデル名は URL エンコードする', () => {
    const req = buildAiRequest('gemini', 'gemini-2.5-flash-lite', 'g-key', 'SYS', 'USER');
    expect(req.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent',
    );
    expect(req.headers['x-goog-api-key']).toBe('g-key');
    expect(req.body).toEqual({
      systemInstruction: { parts: [{ text: 'SYS' }] },
      contents: [{ role: 'user', parts: [{ text: 'USER' }] }],
    });
    // パストラバーサル的なモデル名はエンコードされて URL 構造を壊さない
    expect(buildAiRequest('gemini', 'a/b?x=1', 'k', 's', 'u').url).toContain('a%2Fb%3Fx%3D1');
  });
});

describe('parseAiResponse', () => {
  it('OpenAI: choices[0].message.content を取り出す', () => {
    expect(
      parseAiResponse('openai', { choices: [{ message: { content: 'report' } }] }),
    ).toBe('report');
  });

  it('Gemini: candidates[0].content.parts の text を連結する', () => {
    expect(
      parseAiResponse('gemini', {
        candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }],
      }),
    ).toBe('ab');
  });

  it('形が合わない/空のレスポンスは null (throw しない)', () => {
    expect(parseAiResponse('openai', null)).toBeNull();
    expect(parseAiResponse('openai', {})).toBeNull();
    expect(parseAiResponse('openai', { choices: [{ message: { content: '' } }] })).toBeNull();
    expect(parseAiResponse('gemini', { candidates: [] })).toBeNull();
    expect(parseAiResponse('gemini', 'text')).toBeNull();
  });
});

describe('parseAiError', () => {
  it('OpenAI/Gemini 共通の error.message / error 文字列を取り出す', () => {
    expect(parseAiError({ error: { message: 'invalid key' } })).toBe('invalid key');
    expect(parseAiError({ error: 'rate limited' })).toBe('rate limited');
    expect(parseAiError({})).toBeNull();
    expect(parseAiError(null)).toBeNull();
  });
});

describe('migrateModelId — 既定の差し替えを保存済み設定に反映する', () => {
  it('旧既定のまま保存されていれば現在の既定へ移行する', () => {
    // 既定を変えても、一度でも AI 設定を触った利用者には反映されない問題への対処
    expect(migrateModelId('openai', 'gpt-5-nano')).toBe('gpt-5.6-luna');
  });

  it('ユーザーが自分で入れた値は尊重して移行しない', () => {
    expect(migrateModelId('openai', 'o4-mini')).toBe('o4-mini');
    expect(migrateModelId('gemini', 'gemini-3-pro')).toBe('gemini-3-pro');
  });

  it('未設定なら現在の既定', () => {
    expect(migrateModelId('openai', undefined)).toBe('gpt-5.6-luna');
    expect(migrateModelId('gemini', '')).toBe('gemini-2.5-flash-lite');
  });
});
