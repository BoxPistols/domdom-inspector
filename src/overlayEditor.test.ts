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

// **ディスク上の絶対パス**を使う。以前はここが `/src/App.tsx` (プロジェクト相対) で、
// 「実際には開けないパス」を正常系として固定してしまっていた — 実機で
// 「このコンピューターに存在しません」が出続けた症状そのものをテストが見逃していた
const LOC = { fileName: '/Users/me/proj/src/App.tsx', lineNumber: 42, columnNumber: 7 };
/** マッピング未設定のプロジェクト相対パス (Next.js / Vite dev が報告する形) */
const RELATIVE_LOC = { fileName: '/src/app/page.tsx', lineNumber: 12, columnNumber: 3 };

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

/**
 * host を明示してオーバーレイ操作を行う。**happy-dom の既定 host は空文字**で、
 * その場合は「自分の開発環境ではない」と判定される。どちらの枝を試しているのかを
 * テスト側で必ず明示する (環境の既定値に依存させない)
 */
function withHost<T>(host: string, fn: () => T): T {
  const orig = Object.getOwnPropertyDescriptor(window, 'location');
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, host, origin: `https://${host}` },
  });
  try {
    return fn();
  } finally {
    if (orig) Object.defineProperty(window, 'location', orig);
  }
}

/**
 * **dev サーバを持たない localhost** を作る。localhost では dev サーバ経路を先に
 * 試すため、スキーム経路側の案内 (対応表 / `~`) を検証するには、その試行が
 * 失敗する状態を明示的に作る必要がある (成功する環境に依存させない)。
 */
async function withLocalNoDevServer(fn: () => void): Promise<void> {
  const orig = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error('no dev server'))) as typeof fetch;
  try {
    withHost('localhost:3000', fn);
    // openViaDevServer が全エンドポイントを試し切るまで microtask を流す
    for (let i = 0; i < 30; i += 1) await Promise.resolve();
  } finally {
    globalThis.fetch = orig;
  }
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

describe('Overlay.openEditor — 開かなかったときのフォールバック (スキーム経路)', () => {
  // **どの経路を試しているかを明示する。** vitest+happy-dom の既定 host は
  // localhost:3000 で、そのままだと dev サーバ経路 (非同期) に入り、同期の
  // アサーションが何も見ないまま通ってしまう。ここはスキーム経路の検証なので
  // 開発サーバを持たないオリジンで回す
  const openScheme = (overlay: Overlay, loc = LOC) =>
    withHost('example.com', () => overlay.openEditor(loc));

  it('送った直後は「送った」だけを言い、成功を主張しない', () => {
    const overlay = new Overlay(DEFAULT_SETTINGS, DEFAULT_STRINGS);
    openScheme(overlay);

    const text = toastEl()?.textContent ?? '';
    // パス:行 を必ず見せる (開かなかったときに手で辿れるように)
    expect(text).toContain('/Users/me/proj/src/App.tsx:42');
    expect(text).not.toContain(DEFAULT_STRINGS.editorNotOpened);
    // まだコピーボタンは出さない
    expect(toastEl()?.querySelector('button')).toBeNull();
  });

  it('猶予時間内に blur が来なければコピー導線を出す', () => {
    const overlay = new Overlay(DEFAULT_SETTINGS, DEFAULT_STRINGS);
    openScheme(overlay);

    // 猶予前は出さない (起動が遅いエディタで誤検知しないため)
    vi.advanceTimersByTime(1100);
    expect(toastEl()?.querySelector('button')).toBeNull();

    vi.advanceTimersByTime(200);
    const el = toastEl();
    expect(el?.textContent).toContain(DEFAULT_STRINGS.editorNotOpened);
    expect(el?.textContent).toContain('/Users/me/proj/src/App.tsx:42');
    expect(el?.querySelector('button')?.textContent).toBe(DEFAULT_STRINGS.editorCopyPath);
    // 操作できる状態になっている (既定のトーストは pointer-events: none)
    expect(el?.classList.contains('interactive')).toBe(true);
  });

  it('エディタが起動して blur したらフォールバックを出さない', () => {
    const overlay = new Overlay(DEFAULT_SETTINGS, DEFAULT_STRINGS);
    openScheme(overlay);

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
    openScheme(overlay);
    vi.advanceTimersByTime(1300);

    toastEl()?.querySelector('button')?.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('/Users/me/proj/src/App.tsx:42'));
    // 成功したことを言う (黙って終わらせない)
    await vi.waitFor(() => expect(toastEl()?.textContent).toBe(DEFAULT_STRINGS.editorPathCopied));
  });

  it('パスマッピングを適用したパスを渡す (Docker/リモート開発で辿れるように)', () => {
    const overlay = new Overlay(
      { ...DEFAULT_SETTINGS, pathMappings: [{ from: '/src', to: '/Users/me/app/src' }] },
      DEFAULT_STRINGS,
    );
    // マッピングの対象になるのは相対側のパス (絶対パスは書き換え対象にならない)
    openScheme(overlay, { ...LOC, fileName: 'http://localhost:5173/src/App.tsx' });
    expect(toastEl()?.textContent).toContain('/Users/me/app/src/App.tsx:42');
  });
});

describe('Overlay.openEditor — プロジェクト相対パスは送らずに設定方法を出す', () => {
  it('エディタを起動せず、追加すべき 1 行を提示する', async () => {
    const overlay = new Overlay(DEFAULT_SETTINGS, DEFAULT_STRINGS);
    const clicks: string[] = [];
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicks.push(this.href);
    };
    try {
      await withLocalNoDevServer(() => overlay.openEditor(RELATIVE_LOC));
    } finally {
      HTMLAnchorElement.prototype.click = origClick;
    }
    // 開けないと分かっているものを投げない (投げると editor が「存在しません」を出すだけ)
    expect(clicks).toEqual([]);
    const text = toastEl()?.textContent ?? '';
    expect(text).toContain('/src/app/page.tsx');
    expect(text).toContain('/src=');
    // 操作可能なトースト (コピーできる) であること
    expect(toastEl()?.querySelector('button')).not.toBeNull();
  });

  it('マッピングを設定すれば従来どおり起動する (対処が実際に効く)', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      pathMappings: [{ from: '/src', to: '/Users/me/proj/src' }],
    };
    const overlay = new Overlay(settings, DEFAULT_STRINGS);
    const clicks: string[] = [];
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicks.push(this.href);
    };
    try {
      overlay.openEditor(RELATIVE_LOC);
    } finally {
      HTMLAnchorElement.prototype.click = origClick;
    }
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toContain('/Users/me/proj/src/app/page.tsx');
  });
});

describe('Overlay.openEditor — ビルド出力は送らない (唯一の出口で止める)', () => {
  const clicksOf = (loc: { fileName: string; lineNumber: number; columnNumber: number }) => {
    const overlay = new Overlay(DEFAULT_SETTINGS, DEFAULT_STRINGS);
    const clicks: string[] = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicks.push(this.href);
    };
    try {
      overlay.openEditor(loc);
    } finally {
      HTMLAnchorElement.prototype.click = orig;
    }
    return clicks;
  };

  it('Next の CSS チャンクを送らない (実機で「存在しません」を出した形)', () => {
    const clicks = clicksOf({
      fileName: 'http://localhost:3000/_next/static/chunks/[root-of-the-server]__0ij2czq._.css',
      lineNumber: 1,
      columnNumber: 1,
    });
    expect(clicks).toEqual([]);
    expect(toastEl()?.textContent).toBe(DEFAULT_STRINGS.sourceMinified);
  });

  it('Turbopack の JS チャンクも送らない', () => {
    expect(
      clicksOf({ fileName: '/_next/static/chunks/_0wzpx8i._.js', lineNumber: 4988, columnNumber: 275 }),
    ).toEqual([]);
  });

  it('実ソースは従来どおり送る (止めすぎない)', () => {
    expect(
      clicksOf({ fileName: '/Users/me/proj/src/App.tsx', lineNumber: 42, columnNumber: 7 }),
    ).toHaveLength(1);
  });
});

describe('Overlay.openEditor — 対処できる相手にだけ設定を促す', () => {
  const openOn = async (host: string) => {
    const overlay = new Overlay(DEFAULT_SETTINGS, DEFAULT_STRINGS);
    if (host.startsWith('localhost')) await withLocalNoDevServer(() => overlay.openEditor(RELATIVE_LOC));
    else withHost(host, () => overlay.openEditor(RELATIVE_LOC));
    return toastEl();
  };

  it('自分の開発環境 (localhost) では設定方法を出す', async () => {
    const el = await openOn('localhost:3000');
    expect(el?.textContent).toContain('/src=');
    expect(el?.querySelector('button')).not.toBeNull();
  });

  it('他人のサイトでは設定を促さない (実行できない指示を出さない)', async () => {
    const el = await openOn('example.com');
    // 対応表の書き方は出さない — そのマシンにソースが無いので設定しても開かない
    expect(el?.textContent).not.toContain('/src=');
    expect(el?.textContent).toContain('/src/app/page.tsx');
    expect(el?.querySelector('button')).toBeNull();
  });
});

describe('Overlay.openEditor — 対応表の「~」を送らない', () => {
  it('~ 入りに解決されたら送らず、直し方を言う (実機で踏んだ形)', async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      pathMappings: [{ from: '/src', to: '~/dev/writing/dev-album/src' }],
    };
    const overlay = new Overlay(settings, DEFAULT_STRINGS);
    const clicks: string[] = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicks.push(this.href);
    };
    try {
      await withLocalNoDevServer(() => overlay.openEditor(RELATIVE_LOC));
    } finally {
      HTMLAnchorElement.prototype.click = orig;
    }
    expect(clicks).toEqual([]); // エディタには投げない (投げても必ず失敗する)
    expect(toastEl()?.textContent).toBe(DEFAULT_STRINGS.editorTildePath);
  });
});

describe('Overlay.openEditor — dev サーバ経路が本線', () => {
  const stubFetch = (impl: () => Promise<unknown>) => {
    const orig = globalThis.fetch;
    globalThis.fetch = impl as unknown as typeof fetch;
    return () => {
      globalThis.fetch = orig;
    };
  };
  const flush = async () => {
    for (let i = 0; i < 30; i += 1) await Promise.resolve();
  };

  it('dev サーバが開いたら、設定に関する案内を一切出さない', async () => {
    // ここが本機能の要点。**利用者に絶対パスを書かせない**ことが目的なので、
    // 成功時に対応表の話が出てはいけない
    const restore = stubFetch(() =>
      Promise.resolve({ status: 200, headers: new Headers() }),
    );
    const clicks: string[] = [];
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicks.push(this.href);
    };
    try {
      // 相対パス = スキーム経路なら「対応表を書け」と言う条件。dev サーバ経路では言わない
      withHost('localhost:3000', () =>
        new Overlay(DEFAULT_SETTINGS, DEFAULT_STRINGS).openEditor(RELATIVE_LOC),
      );
      await flush();
    } finally {
      HTMLAnchorElement.prototype.click = origClick;
      restore();
    }
    expect(toastEl()?.textContent).toBe(DEFAULT_STRINGS.editorOpenedViaDevServer);
    expect(toastEl()?.textContent).not.toContain('/src=');
    expect(clicks).toEqual([]); // スキームは使わない
  });

  it('他人のサイトへは要求を出さない (localhost 以外は 1 バイトも出さない)', async () => {
    const calls: string[] = [];
    const restore = stubFetch((...args: unknown[]) => {
      calls.push(String(args[0]));
      return Promise.resolve({ status: 200, headers: new Headers() });
    });
    try {
      withHost('example.com', () =>
        new Overlay(DEFAULT_SETTINGS, DEFAULT_STRINGS).openEditor(LOC),
      );
      await flush();
    } finally {
      restore();
    }
    expect(calls).toEqual([]);
  });
});
