/**
 * React DevTools グローバルフックの確立 (document_start / MAIN world で最初に実行)。
 * - フック未設置なら最小シムを設置し、renderer 注入と commit を観測する
 * - 本物の DevTools フックが既にあれば壊さずに piggyback する
 * dev ビルド検出 (FR-12) は renderer.bundleType === 1 を一次シグナルとする。
 */
export interface HookState {
  renderers: Map<number, unknown>;
  roots: Set<unknown>;
  devMode: boolean;
}

const STATE_KEY = '__MUI_INSPECTOR_STATE__';

export function installHook(): HookState {
  const w = window as any;
  if (w[STATE_KEY]) return w[STATE_KEY];

  const state: HookState = {
    renderers: new Map(),
    roots: new Set(),
    devMode: false,
  };
  Object.defineProperty(w, STATE_KEY, { value: state, enumerable: false });

  const record = (renderer: any) => {
    if (renderer && renderer.bundleType === 1) state.devMode = true;
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
      state.roots.add(root);
      return origCommit?.(id, root, ...rest);
    };
    return state;
  }

  let uid = 0;
  const hook = {
    renderers: state.renderers,
    supportsFiber: true,
    supportsFlight: false,
    isDisabled: false,
    inject(renderer: any) {
      const id = ++uid;
      state.renderers.set(id, renderer);
      record(renderer);
      return id;
    },
    onCommitFiberRoot(_id: number, root: any) {
      state.roots.add(root);
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onScheduleFiberRoot() {},
    checkDCE() {},
    // react-refresh が参照するイベント API の最小実装
    on() {},
    off() {},
    sub() {
      return () => {};
    },
    emit() {},
  };
  Object.defineProperty(w, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
    value: hook,
    enumerable: false,
    configurable: true,
  });
  return state;
}
