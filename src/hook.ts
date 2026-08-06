/**
 * React DevTools グローバルフックへの **piggyback だけ** を行う (document_start / MAIN world)。
 *
 * **自分からフックを設置しない。** 以前は未設置なら最小シムを `__REACT_DEVTOOLS_GLOBAL_HOOK__`
 * に置いていたが、React DevTools の installHook は
 * `if (target.hasOwnProperty('__REACT_DEVTOOLS_GLOBAL_HOOK__')) return;` で**丸ごと降りる**ため、
 * こちらが先に走ると **React DevTools が沈黙する** (実測: RDT 7.0.1 で 6 試行中 4 回)。
 * 他拡張の中核機能を壊してよい理由は無いので、グローバルの所有権は主張しない。
 *
 * 代わりに、必要な情報は DOM 側から取る:
 * - React の有無と dev ビルド判定 → `fiber.detectReactOnPage` (`__reactFiber$` と `_debug*`)
 * - MUI テーマ → `muiTheme.findMuiThemeFromDom` (フック不要の後備が既にある)
 *
 * 失うのは commit 通知 (テーマ切替の即時再検出) だけで、モード切替時と注入直後の再試行で補う。
 * フックが**既にある**場合 (RDT が入っている等) は従来どおり piggyback して commit も受ける。
 */
export type CommitListener = (root: unknown) => void;

export interface HookState {
  renderers: Map<number, unknown>;
  roots: Set<unknown>;
  devMode: boolean;
  /** onCommitFiberRoot ごとに通知するリスナ (レンダーデバッガが購読) */
  commitListeners: Set<CommitListener>;
  onCommit(listener: CommitListener): () => void;
}

const STATE_KEY = '__DOMDOM_INSPECTOR_STATE__';

export function installHook(): HookState {
  const w = window as any;
  if (w[STATE_KEY]) return w[STATE_KEY];

  const commitListeners = new Set<CommitListener>();
  const state: HookState = {
    renderers: new Map(),
    roots: new Set(),
    devMode: false,
    commitListeners,
    onCommit(listener: CommitListener) {
      commitListeners.add(listener);
      return () => commitListeners.delete(listener);
    },
  };
  Object.defineProperty(w, STATE_KEY, { value: state, enumerable: false });

  const record = (renderer: any) => {
    if (renderer && renderer.bundleType === 1) state.devMode = true;
  };

  const notifyCommit = (root: unknown) => {
    state.roots.add(root);
    // リスナ側の例外がページの描画を止めないよう握りつぶす
    for (const listener of commitListeners) {
      try {
        listener(root);
      } catch {
        /* noop */
      }
    }
  };

  const existing = w.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (existing && typeof existing.inject === 'function') {
    const origInject = existing.inject.bind(existing);
    existing.inject = (renderer: any) => {
      record(renderer);
      const id = origInject(renderer);
      state.renderers.set(id, renderer);
      return id;
    };
    const origCommit = existing.onCommitFiberRoot?.bind(existing);
    existing.onCommitFiberRoot = (id: number, root: any, ...rest: unknown[]) => {
      notifyCommit(root);
      return origCommit?.(id, root, ...rest);
    };
    return state;
  }

  // フックが無い場合は**設置しない**。React 側は inject を呼ばないので renderers は空のままで、
  // React の有無・dev 判定は DOM の Fiber から取る (fiber.detectReactOnPage)。
  return state;
}
