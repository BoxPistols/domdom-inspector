import { describe, expect, it, vi } from 'vitest';
import type { DesignScan } from './designScan';
import { requestScan } from './scanClient';

/**
 * 失敗の理由を潰さないことを固定する。以前は「重すぎて時間切れ」も「未有効化で
 * content script が居ない」も同じ `null` で返っており、**利用者に出す説明が
 * 原理的に書けなかった** (どちらも「計測できませんでした」になる)。
 */

const scan = { elementCount: 3 } as unknown as DesignScan;

describe('requestScan', () => {
  it('成功したら scan と documentKey を返す', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, scan, documentKey: 'doc-1' });
    await expect(requestScan(7, send)).resolves.toEqual({
      ok: true,
      scan,
      documentKey: 'doc-1',
    });
  });

  it('**frameId: 0 を必ず指定する** (指定しないと先に応答した iframe が勝つ)', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, scan, documentKey: null });
    await requestScan(7, send);
    expect(send).toHaveBeenCalledWith(7, { type: 'design-scan' }, { frameId: 0 });
  });

  it('bridge のタイムアウトは timeout として区別する', async () => {
    const send = vi.fn().mockResolvedValue({ ok: false, reason: 'timeout' });
    await expect(requestScan(7, send)).resolves.toEqual({ ok: false, reason: 'timeout' });
  });

  it('sendMessage が reject したら unreachable (未有効化のページ)', async () => {
    const send = vi.fn().mockRejectedValue(new Error('Could not establish connection'));
    await expect(requestScan(7, send)).resolves.toEqual({ ok: false, reason: 'unreachable' });
  });

  it('応答が無い (undefined/null) なら unreachable', async () => {
    for (const value of [undefined, null]) {
      const send = vi.fn().mockResolvedValue(value);
      await expect(requestScan(7, send)).resolves.toEqual({ ok: false, reason: 'unreachable' });
    }
  });

  it('応答はあるが scan が空なら empty (unreachable と混ぜない)', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, scan: null, documentKey: 'doc-1' });
    await expect(requestScan(7, send)).resolves.toEqual({ ok: false, reason: 'empty' });
  });

  it('documentKey が無い応答でも成功として扱う (null で返す)', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, scan });
    await expect(requestScan(7, send)).resolves.toEqual({
      ok: true,
      scan,
      documentKey: null,
    });
  });
});
