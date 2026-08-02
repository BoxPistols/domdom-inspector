// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { findMuiTheme, findMuiThemeFromDom, isMuiThemeLike } from './muiTheme';

// mock Fiber の作法は renderTracker.test.ts に倣う (最小フィールドのみ持つ素 object)
const FAKE_THEME = {
  palette: { primary: { main: '#1976d2' } },
  typography: { body1: { fontSize: '1rem' } },
  shape: { borderRadius: 4 },
  spacing: (n: number) => `${n * 8}px`,
};

interface MockFiber {
  memoizedProps: Record<string, unknown> | null;
  child: MockFiber | null;
  sibling: MockFiber | null;
  return: MockFiber | null;
}

function fiber(partial: Partial<MockFiber> = {}): MockFiber {
  return { memoizedProps: null, child: null, sibling: null, return: null, ...partial };
}

describe('isMuiThemeLike', () => {
  it('palette + typography + shape を持つオブジェクトをテーマと判定する', () => {
    expect(isMuiThemeLike(FAKE_THEME)).toBe(true);
  });

  it('CssVarsProvider (colorSchemes) 形もテーマと判定する', () => {
    expect(
      isMuiThemeLike({ colorSchemes: { light: {} }, typography: {}, shape: {} }),
    ).toBe(true);
  });

  it('テーマ形でない context 値 (Redux store / i18n 等) は判定しない', () => {
    expect(isMuiThemeLike(null)).toBe(false);
    expect(isMuiThemeLike('light')).toBe(false);
    expect(isMuiThemeLike({ store: {}, dispatch: () => {} })).toBe(false);
    expect(isMuiThemeLike({ palette: {} })).toBe(false); // typography/shape が無い
  });
});

describe('findMuiTheme', () => {
  it('FiberRoot からの下り走査で Provider の value を見つける', () => {
    const provider = fiber({ memoizedProps: { value: FAKE_THEME } });
    const app = fiber({ child: provider });
    provider.return = app;
    const root = { current: app };
    expect(findMuiTheme(new Set([root]))).toBe(FAKE_THEME);
  });

  it('sibling 側の Provider も見つける', () => {
    const other = fiber({ memoizedProps: { value: { not: 'theme' } } });
    const provider = fiber({ memoizedProps: { value: FAKE_THEME } });
    other.sibling = provider;
    const app = fiber({ child: other });
    other.return = app;
    provider.return = app;
    expect(findMuiTheme(new Set([{ current: app }]))).toBe(FAKE_THEME);
  });

  it('テーマが無ければ null (roots 空・Provider なし)', () => {
    expect(findMuiTheme(new Set())).toBeNull();
    const app = fiber({ child: fiber({ memoizedProps: { value: 42 } }) });
    expect(findMuiTheme(new Set([{ current: app }]))).toBeNull();
  });
});

describe('findMuiThemeFromDom (mid-page 注入の後備)', () => {
  it('要素の __reactFiber$ から return チェーンを遡って Provider を見つける', () => {
    const provider = fiber({ memoizedProps: { value: FAKE_THEME } });
    const host = fiber({ memoizedProps: {}, return: provider });
    const leaf = document.createElement('span');
    document.body.appendChild(leaf);
    (leaf as unknown as Record<string, unknown>)['__reactFiber$test'] = host;
    expect(findMuiThemeFromDom(document)).toBe(FAKE_THEME);
    leaf.remove();
  });

  it('遡りで見つからなければ最上位から下り走査する (別サブツリーの Provider)', () => {
    const top = fiber();
    const el = fiber({ memoizedProps: {}, return: top });
    const provider = fiber({ memoizedProps: { value: FAKE_THEME }, return: top });
    top.child = el;
    el.sibling = provider;
    const leaf = document.createElement('div');
    document.body.appendChild(leaf);
    (leaf as unknown as Record<string, unknown>)['__reactFiber$test'] = el;
    expect(findMuiThemeFromDom(document)).toBe(FAKE_THEME);
    leaf.remove();
  });

  it('React 内部キーを持つ要素が無ければ null', () => {
    expect(findMuiThemeFromDom(document)).toBeNull();
  });
});

describe('走査の暴走・循環に対する堅牢性 (レビュー指摘の回帰防止)', () => {
  it('return チェーンが循環していてもハングしない', () => {
    const a = fiber({ memoizedProps: {} });
    const b = fiber({ memoizedProps: {}, return: a });
    a.return = b; // 循環
    const leaf = document.createElement('i');
    document.body.appendChild(leaf);
    (leaf as unknown as Record<string, unknown>)['__reactFiber$test'] = a;
    expect(findMuiThemeFromDom(document)).toBeNull();
    leaf.remove();
  });

  it('同一ルート配下の多数要素でも下り走査は根ごとに 1 回 (再走査しない)', () => {
    // 根の子を 50 ノードのチェーンにし、下り走査 1 回あたり 50 回アクセスさせる。
    // 重複排除が無いと 30 要素 × 50 = 1500 回に膨らむ。
    let visits = 0;
    const countAccess = (f: MockFiber) => {
      Object.defineProperty(f, 'memoizedProps', {
        get() {
          visits += 1;
          return {};
        },
      });
      return f;
    };
    const top = fiber();
    let cursor = top;
    for (let i = 0; i < 50; i += 1) {
      const next = countAccess(fiber({ return: cursor }));
      cursor.child = next;
      cursor = next;
    }
    // DOM 要素はすべて同じ根 (top) の直下ノードを指す
    for (let i = 0; i < 30; i += 1) {
      const el = document.createElement('span');
      document.body.appendChild(el);
      (el as unknown as Record<string, unknown>)['__reactFiber$test'] = top.child;
    }
    findMuiThemeFromDom(document);
    document.body.innerHTML = '';
    // 遡上 (30 要素 × 2 ノード) + 下り 1 回 (50 ノード) 程度に収まる
    expect(visits).toBeGreaterThan(0);
    expect(visits).toBeLessThan(200);
  });
});
