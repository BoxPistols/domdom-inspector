/**
 * 同じ処理の同時実行を禁じ、呼ばれた順に 1 つずつ流す。
 *
 * 「読んでから書く」形の非同期処理を複数箇所から呼ぶと、await のたびに他方へ制御が
 * 移って順序が組み変わる。実際に踏んだ例: 右クリックメニューの作り直しが
 * `removeAll → create` の形で 5 箇所から呼ばれ、SW 起動直後に
 * 「A が removeAll → B が removeAll → A が create → **B が create で重複**」と並び、
 * `Cannot create item with duplicate id` が拡張のエラーページに溜まっていた。
 *
 * **失敗しても列は止めない** (1 回の失敗で以後の呼び出しが全部詰まると、
 * 「押しても無反応」の原因が前の失敗になり追跡不能になる)。
 */
export function serialize(task: () => Promise<void>): () => Promise<void> {
  let tail: Promise<void> = Promise.resolve();
  return () => {
    tail = tail.then(task, task);
    return tail;
  };
}
