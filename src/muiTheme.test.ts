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
