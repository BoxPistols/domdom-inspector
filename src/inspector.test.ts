// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveOuterElement } from './inspector';

describe('resolveOuterElement (↑ の親解決 + DOM フォールバック)', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('コンポーネント親が取れればそれを優先する (React サイト)', () => {
    const outer = document.createElement('section');
    const inner = document.createElement('span');
    outer.appendChild(inner);
    document.body.appendChild(outer);

    // componentParent が非 null を返す = Fiber からコンポーネント親が取れたケース
    const result = resolveOuterElement(inner, () => outer);
    expect(result).toBe(outer);
  });

  it('コンポーネント親が無ければ DOM 親へフォールバックする (非 React サイト)', () => {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    parent.appendChild(child);
    document.body.appendChild(parent);

    // Fiber 無し = componentParent は常に null → parentElement を返す
    const result = resolveOuterElement(child, () => null);
    expect(result).toBe(parent);
  });

  it('ルート (html) では親が無いので null を返す (トースト表示条件)', () => {
    const html = document.documentElement;
    expect(html.parentElement).toBeNull();
    expect(resolveOuterElement(html, () => null)).toBeNull();
  });

  it('DOM 親を 1 段ずつ遡れる (span → div → body)', () => {
    const div = document.createElement('div');
    const span = document.createElement('span');
    div.appendChild(span);
    document.body.appendChild(div);

    const step1 = resolveOuterElement(span, () => null);
    expect(step1).toBe(div);
    const step2 = resolveOuterElement(step1 as Element, () => null);
    expect(step2).toBe(document.body);
  });
});
