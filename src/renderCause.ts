/**
 * 再レンダー原因の分析 (why-did-this-render)。
 * コミット済み Fiber と alternate (直前のコミット) を比較し、
 * 「なぜこのコンポーネントが再レンダーしたか」を分類する。
 *
 * 分類の意味 (エンジニアのチューニング動線に直結):
 * - mount:  初回マウント (最適化対象外)
 * - state:  自身の useState/useReducer (または class の setState) が変化 → 状態設計の見直し対象
 * - props:  親から渡された props の値が実際に変化 → 正当な再レンダー
 * - parent: props は浅い比較で全て同一なのに親の再レンダーに巻き込まれた
 *           → **無駄レンダー** = React.memo / useCallback / useMemo の第一候補
 * - other:  上記以外 (Context 変化 / forceUpdate / HoC 内部など)
 *
 * すべて purely-structural な比較のみで、production ビルドの Fiber でも動く
 * (memoizedProps / memoizedState は prod でも剥離されない)。
 */

type Fiber = any;

export type RenderCause = 'mount' | 'state' | 'props' | 'parent' | 'other';

export interface CauseDetail {
  cause: RenderCause;
  /** 値が実際に変化した props キー (浅い比較) */
  changedProps: string[];
  /** 値が変化した状態系 hook のインデックス (useState/useReducer 等 queue を持つ hook) */
  changedHooks: number[];
}

/**
 * props の浅い差分。参照同一なら null (= 親は再レンダーしていない)。
 * 参照が変わった場合は Object.is で異なるキーの一覧を返す (空配列 = 浅い比較で全一致)。
 */
export function shallowDiffKeys(
  prev: unknown,
  next: unknown,
): string[] | null {
  if (Object.is(prev, next)) return null;
  if (
    typeof prev !== 'object' || prev === null ||
    typeof next !== 'object' || next === null
  ) {
    // 非オブジェクト props (異常系)。参照が違う時点で「変化あり」として扱う
    return ['*'];
  }
  const changed: string[] = [];
  const p = prev as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  for (const key of Object.keys(n)) {
    if (!Object.is(p[key], n[key])) changed.push(key);
  }
  for (const key of Object.keys(p)) {
    if (!(key in n)) changed.push(key);
  }
  return changed;
}

/**
 * 関数コンポーネントの hook 連結リスト (fiber.memoizedState) を alternate と
 * 並走比較し、値が変化した「状態系 hook」(queue を持つ = useState/useReducer 等) の
 * インデックスを返す。hook の呼び出し順は React のルール上不変なので index が同一 hook を指す。
 */
export function changedStateHookIndices(prevHook: Fiber, nextHook: Fiber): number[] {
  const changed: number[] = [];
  let p = prevHook;
  let n = nextHook;
  let index = 0;
  // 念のため上限を設け、破損したリストでの無限ループを避ける
  while (p && n && index < 1000) {
    if (n.queue != null && !Object.is(p.memoizedState, n.memoizedState)) {
      changed.push(index);
    }
    p = p.next;
    n = n.next;
    index += 1;
  }
  return changed;
}

const TAG_CLASS_COMPONENT = 1;

/**
 * 再レンダー原因を分類する。優先順位は state > props > parent > other。
 * state と props が同時に変化した場合も detail の両リストで全情報を保持する。
 */
export function classifyRenderCause(prev: Fiber, next: Fiber): CauseDetail {
  if (!prev) return { cause: 'mount', changedProps: [], changedHooks: [] };

  let changedHooks: number[] = [];
  if (next.tag === TAG_CLASS_COMPONENT) {
    // class は memoizedState がそのまま state オブジェクト (setState で参照が変わる)
    if (!Object.is(prev.memoizedState, next.memoizedState)) changedHooks = [0];
  } else {
    changedHooks = changedStateHookIndices(prev.memoizedState, next.memoizedState);
  }

  const propsDiff = shallowDiffKeys(prev.memoizedProps, next.memoizedProps);
  const changedProps = propsDiff ?? [];

  if (changedHooks.length) return { cause: 'state', changedProps, changedHooks };
  if (changedProps.length) return { cause: 'props', changedProps, changedHooks };
  // 参照は変わったが浅い比較で全一致 = 親の再レンダーに巻き込まれた無駄レンダー
  if (propsDiff !== null) return { cause: 'parent', changedProps, changedHooks };
  // props 参照も state も同一なのに render した = Context / forceUpdate 等
  return { cause: 'other', changedProps, changedHooks };
}
