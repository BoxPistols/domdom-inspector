import { describe, expect, it, vi } from 'vitest';
import { ENDPOINTS, devServerPath, handledByEditor, openViaDevServer } from './openInEditor';

const LOC = { fileName: '/src/pages/DesignSystem.tsx?t=1786', lineNumber: 28, columnNumber: 21 };

describe('devServerPath', () => {
  it('dev サーバ URL からクエリを落として相対パスにする', () => {
    expect(devServerPath('http://localhost:3000/src/App.tsx?t=1786807702679')).toBe('src/App.tsx');
  });

  it('先頭スラッシュを落とす (サーバはプロジェクト相対で受ける)', () => {
    expect(devServerPath('/src/pages/DesignSystem.tsx')).toBe('src/pages/DesignSystem.tsx');
  });

  it('ディスク上の絶対パスは絶対のまま渡す (launch-editor は両方受ける)', () => {
    expect(devServerPath('/Users/me/proj/src/App.tsx')).toBe('/Users/me/proj/src/App.tsx');
  });

  it('Vite の /@fs/ prefix を外す', () => {
    expect(devServerPath('http://localhost:5173/@fs/Users/me/proj/src/A.tsx')).toBe(
      '/Users/me/proj/src/A.tsx',
    );
  });

  it('**パスの対応表を適用しない** (サーバはローカル絶対パスを求めていない)', () => {
    // ここが対応表を通ると、スキーム方式と同じ「1 段ズレ」を再発させる
    expect(devServerPath('/src/App.tsx')).toBe('src/App.tsx');
  });
});

describe('エンドポイントの URL 組み立て', () => {
  it('Vite: file=path:line:col', () => {
    const url = ENDPOINTS[0].url('http://localhost:3000', LOC);
    // 実機で 200 (content-length 0) を返した形と一致すること
    expect(url).toBe(
      'http://localhost:3000/__open-in-editor?file=src%2Fpages%2FDesignSystem.tsx%3A28%3A21',
    );
    expect(decodeURIComponent(url)).toContain('src/pages/DesignSystem.tsx:28:21');
  });

  it('Next: file / lineNumber / column を分けて渡す', () => {
    const url = ENDPOINTS[1].url('http://localhost:3001', LOC);
    expect(url).toContain('/__nextjs_launch-editor?file=');
    expect(url).toContain('&lineNumber=28&column=21');
  });

  it('CRA: fileName / lineNumber / colNumber', () => {
    const url = ENDPOINTS[2].url('http://localhost:3000', LOC);
    expect(url).toContain('/__open-stack-frame-in-editor?fileName=');
    expect(url).toContain('&lineNumber=28&colNumber=21');
  });

  it('列が 0 でも 1 に落として送る (0 を渡すエディタ側の未定義動作を避ける)', () => {
    const url = ENDPOINTS[1].url('http://x', { ...LOC, columnNumber: 0 });
    expect(url).toContain('&column=1');
  });
});

describe('handledByEditor — SPA フォールバックと区別する', () => {
  it('launch-editor の応答 (content-type 無し) は成功', () => {
    expect(handledByEditor(200, null)).toBe(true);
  });

  it('**SPA の history フォールバック (200 + text/html) は失敗扱い**', () => {
    // 200 だけ見ると「開いた」と誤答する。実測: 未知ルートは text/html 1673 バイト
    expect(handledByEditor(200, 'text/html; charset=utf-8')).toBe(false);
  });

  it('404 / 500 は失敗', () => {
    expect(handledByEditor(404, null)).toBe(false);
    expect(handledByEditor(500, null)).toBe(false);
  });
});

describe('openViaDevServer', () => {
  const ok = () =>
    Promise.resolve({ status: 200, headers: new Headers() } as unknown as Response);
  const html = () =>
    Promise.resolve({
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
    } as unknown as Response);

  it('最初に処理されたエンドポイントで止まる', async () => {
    const request = vi.fn().mockImplementation(ok);
    expect(await openViaDevServer('http://localhost:3000', LOC, request)).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('SPA フォールバックなら次のエンドポイントを試す', async () => {
    const request = vi
      .fn()
      .mockImplementationOnce(html)
      .mockImplementationOnce(ok);
    expect(await openViaDevServer('http://localhost:4001', LOC, request)).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('全部だめなら false (呼び出し側が従来経路へ落とせる)', async () => {
    const request = vi.fn().mockImplementation(html);
    expect(await openViaDevServer('http://localhost:4002', LOC, request)).toBe(false);
    expect(request).toHaveBeenCalledTimes(ENDPOINTS.length);
  });

  it('接続不可 (dev サーバが無い) でも例外を投げない', async () => {
    const request = vi.fn().mockRejectedValue(new Error('failed to fetch'));
    expect(await openViaDevServer('http://localhost:4003', LOC, request)).toBe(false);
  });

  it('2 回目は成功したエンドポイントを先に試す (無駄な要求を出さない)', async () => {
    const request = vi
      .fn()
      .mockImplementationOnce(html) // 1 回目: vite が外れ
      .mockImplementationOnce(ok); // next が当たり
    await openViaDevServer('http://localhost:4004', LOC, request);
    request.mockClear();
    request.mockImplementation(ok);
    await openViaDevServer('http://localhost:4004', LOC, request);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toContain('__nextjs_launch-editor');
  });
});
