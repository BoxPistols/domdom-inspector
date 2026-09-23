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
});

describe('parseAiResponse', () => {
  it('OpenAI: choices[0].message.content を取り出す', () => {
    expect(
      parseAiResponse('openai', { choices: [{ message: { content: 'report' } }] }),
    ).toBe('report');
  });

  it('形が合わない/空のレスポンスは null (throw しない)', () => {
    expect(parseAiResponse('openai', null)).toBeNull();
    expect(parseAiResponse('openai', {})).toBeNull();
    expect(parseAiResponse('openai', { choices: [{ message: { content: '' } }] })).toBeNull();
    expect(parseAiResponse('openai', 'text')).toBeNull();
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
    expect(migrateModelId('openai', 'gpt-5-nano')).toBe('gpt-6-luna');
    expect(migrateModelId('openai', 'gpt-5.6-luna')).toBe('gpt-6-luna');
    // Gemini時代の既定が保存値に残っていても既定へ戻る
    expect(migrateModelId('openai', 'gemini-2.5-flash-lite')).toBe('gpt-6-luna');
  });

  it('ユーザーが自分で入れた値は尊重して移行しない', () => {
    expect(migrateModelId('openai', 'o4-mini')).toBe('o4-mini');
  });

  it('未設定なら現在の既定', () => {
    expect(migrateModelId('openai', undefined)).toBe('gpt-6-luna');
    expect(migrateModelId('openai', '')).toBe('gpt-6-luna');
  });
});
