// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Overlay } from './overlay';
import { DEFAULT_SETTINGS, DEFAULT_STRINGS } from './types';

/**
 * エディタ起動のフォールバック。
 *
 * scheme の起動 (`a[href="cursor://…"].click()`) は**投げっぱなしで成否が取れない**。
 * エディタが未インストール / scheme 未登録なら何も起きず、以前は「開いています…」という
 * 成功を主張するトーストだけが残っていた (押しても何も起きない、の最悪形)。
 * 外部アプリが起動すればページは blur するので、猶予時間内に blur が来なければ
 * 「開かなかった」と見なしてパスのコピー導線を出す。
 */

const LOC = { fileName: 'http://localhost:5173/src/App.tsx', lineNumber: 42, columnNumber: 7 };

/** closed shadow DOM の中身をテストから読むため open を強制する (e2e と同じ手法) */
function patchShadow() {
  const orig = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit): ShadowRoot {
    const root = orig.call(this, { ...init, mode: 'open' });
    (this as Element & { __openRoot?: ShadowRoot }).__openRoot = root;
    return root;
  };
  return () => {
    Element.prototype.attachShadow = orig;
  };
}

function toastEl(): HTMLElement | null {
  const host = document.querySelector('domdom-inspector-overlay') as
    | (Element & { __openRoot?: ShadowRoot })
    | null;
  const root = host?.__openRoot ?? host?.shadowRoot ?? null;
  return root?.querySelector('.toast') as HTMLElement | null;
}

let restoreShadow: () => void;

beforeEach(() => {
  document.body.replaceChildren();
  document.querySelector('domdom-inspector-overlay')?.remove();
  restoreShadow = patchShadow();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  restoreShadow();
});

describe('Overlay.openEditor — 開かなかったときのフォールバック', () => {
  it('送った直後は「送った」だけを言い、成功を主張しない', () => {
    const overlay = new Overlay(DEFAULT_SETTINGS, DEFAULT_STRINGS);
    overlay.openEditor(LOC);

    const text = toastEl()?.textContent ?? '';
    // パス:行 を必ず見せる (開かなかったときに手で辿れるように)
    expect(text).toContain('/src/App.tsx:42');
    expect(text).not.toContain(DEFAULT_STRINGS.editorNotOpened);
    // まだコピーボタンは出さない
    expect(toastEl()?.querySelector('button')).toBeNull();
  });

  it('猶予時間内に blur が来なければコピー導線を出す', () => {
    const overlay = new Overlay(DEFAULT_SETTINGS, DEFAULT_STRINGS);
    overlay.openEditor(LOC);

    // 猶予前は出さない (起動が遅いエディタで誤検知しないため)
    vi.advanceTimersByTime(1100);
    expect(toastEl()?.querySelector('button')).toBeNull();

    vi.advanceTimersByTime(200);
    const el = toastEl();
    expect(el?.textContent).toContain(DEFAULT_STRINGS.editorNotOpened);
    expect(el?.textContent).toContain('/src/App.tsx:42');
    expect(el?.querySelector('button')?.textContent).toBe(DEFAULT_STRINGS.editorCopyPath);
    // 操作できる状態になっている (既定のトーストは pointer-events: none)
    expect(el?.classList.contains('interactive')).toBe(true);
  });

  it('エディタが起動して blur したらフォールバックを出さない', () => {
    const overlay = new Overlay(DEFAULT_SETTINGS, DEFAULT_STRINGS);
    overlay.openEditor(LOC);

    window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(3000);

    expect(toastEl()?.querySelector('button')).toBeNull();
    expect(toastEl()?.textContent).not.toContain(DEFAULT_STRINGS.editorNotOpened);
  });

  it('コピーボタンはパス:行 をクリップボードへ入れ、結果を返す', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const overlay = new Overlay(DEFAULT_SETTINGS, DEFAULT_STRINGS);
    overlay.openEditor(LOC);
    vi.advanceTimersByTime(1300);

    toastEl()?.querySelector('button')?.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('/src/App.tsx:42'));
    // 成功したことを言う (黙って終わらせない)
    await vi.waitFor(() => expect(toastEl()?.textContent).toBe(DEFAULT_STRINGS.editorPathCopied));
  });

  it('パスマッピングを適用したパスを渡す (Docker/リモート開発で辿れるように)', () => {
    const overlay = new Overlay(
      { ...DEFAULT_SETTINGS, pathMappings: [{ from: '/src', to: '/Users/me/app/src' }] },
      DEFAULT_STRINGS,
    );
    overlay.openEditor(LOC);
    expect(toastEl()?.textContent).toContain('/Users/me/app/src/App.tsx:42');
  });
});
