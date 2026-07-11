import { describe, expect, it } from 'vitest';
import {
  changedStateHookIndices,
  classifyRenderCause,
  shallowDiffKeys,
} from './renderCause';

/** useState 相当の hook ノード (queue あり) */
const stateHook = (value: unknown, next: unknown = null) => ({
  memoizedState: value,
  queue: {},
  next,
});
/** useRef/useMemo 相当の hook ノード (queue なし) */
const passiveHook = (value: unknown, next: unknown = null) => ({
  memoizedState: value,
  queue: null,
  next,
});

describe('shallowDiffKeys', () => {
  it('参照同一なら null (親は再レンダーしていない)', () => {
    const props = { a: 1 };
    expect(shallowDiffKeys(props, props)).toBeNull();
  });

  it('参照が変わり値も変わったキーだけを列挙する', () => {
    expect(shallowDiffKeys({ a: 1, b: 'x' }, { a: 2, b: 'x' })).toEqual(['a']);
  });

  it('参照は変わったが浅い比較で全一致なら空配列 (= 無駄レンダーの根拠)', () => {
    const onClick = () => {};
    expect(shallowDiffKeys({ n: 1, onClick }, { n: 1, onClick })).toEqual([]);
  });

  it('追加・削除されたキーも変化として数える', () => {
    expect(shallowDiffKeys({ a: 1 }, { a: 1, b: 2 })).toEqual(['b']);
    expect(shallowDiffKeys({ a: 1, b: 2 }, { a: 1 })).toEqual(['b']);
  });

  it('NaN は Object.is で等値扱い (誤検出しない)', () => {
    expect(shallowDiffKeys({ v: NaN }, { v: NaN })).toEqual([]);
  });
});

describe('changedStateHookIndices', () => {
  it('値が変わった状態系 hook のインデックスを返す', () => {
    // index0: useState 変化 / index1: useRef 系 (queue なし、無視) / index2: useState 不変
    const prev = stateHook(0, passiveHook('r', stateHook('same')));
    const next = stateHook(1, passiveHook('r2', stateHook('same')));
    expect(changedStateHookIndices(prev, next)).toEqual([0]);
  });

  it('複数の useState 変化をすべて拾う', () => {
    const prev = stateHook(0, stateHook('a'));
    const next = stateHook(1, stateHook('b'));
    expect(changedStateHookIndices(prev, next)).toEqual([0, 1]);
  });

  it('hook リストが無い (null) なら空', () => {
    expect(changedStateHookIndices(null, null)).toEqual([]);
  });
});

describe('classifyRenderCause', () => {
  const fn = (over: Record<string, unknown>) => ({
    tag: 0,
    memoizedProps: {},
    memoizedState: null,
    ...over,
  });

  it('alternate 無しは mount', () => {
    expect(classifyRenderCause(null, fn({})).cause).toBe('mount');
  });

  it('hook の state 変化は props より優先して state', () => {
    const prev = fn({ memoizedState: stateHook(0), memoizedProps: { a: 1 } });
    const next = fn({ memoizedState: stateHook(1), memoizedProps: { a: 2 } });
    const d = classifyRenderCause(prev, next);
    expect(d.cause).toBe('state');
    expect(d.changedHooks).toEqual([0]);
    expect(d.changedProps).toEqual(['a']); // 詳細は両方保持
  });

  it('props の値が変化していれば props', () => {
    const prev = fn({ memoizedProps: { a: 1 } });
    const next = fn({ memoizedProps: { a: 2 } });
    const d = classifyRenderCause(prev, next);
    expect(d.cause).toBe('props');
    expect(d.changedProps).toEqual(['a']);
  });

  it('props 参照だけ変わり浅い比較で全一致なら parent (無駄レンダー)', () => {
    const prev = fn({ memoizedProps: { a: 1 } });
    const next = fn({ memoizedProps: { a: 1 } });
    expect(classifyRenderCause(prev, next).cause).toBe('parent');
  });

  it('props 参照も state も同一なのに render したら other (Context 等)', () => {
    const props = { a: 1 };
    const prev = fn({ memoizedProps: props });
    const next = fn({ memoizedProps: props });
    expect(classifyRenderCause(prev, next).cause).toBe('other');
  });

  it('class component は memoizedState の参照差分で state 判定', () => {
    const prev = fn({ tag: 1, memoizedState: { n: 0 } });
    const next = fn({ tag: 1, memoizedState: { n: 1 } });
    expect(classifyRenderCause(prev, next).cause).toBe('state');
  });
});
