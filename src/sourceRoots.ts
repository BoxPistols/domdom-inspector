/**
 * ページが漏らす絶対パスから「プロジェクトのルート候補」を推定する。
 *
 * **拡張はディスクを見られない。** どこにプロジェクトがあるかは原理的に未知で、
 * これまではその絶対パスを利用者に手で書かせていた (自分のアプリ構造を把握している
 * 前提。実際には筆者自身が 2 回外した)。ページ側が漏らしている情報から候補を出し、
 * **1 回だけ確認してもらう**のがここの役割。
 *
 * 使える手がかり:
 * - Vite の `/@fs/<絶対パス>` — root 外のファイル (hoist された node_modules 等) に付く
 * - スタックに素の絶対パスが出る形 (`at Foo (/Users/me/proj/src/App.tsx:12:3)`)
 *
 * **候補であって答えではない。** 例えば Vite の root がリポジトリ直下でなく
 * `client/` の場合、ここで出るのはリポジトリのルートで、利用者が 1 段足す必要がある。
 * 検証はディスクを見ないとできないので、断定せず候補として出す。
 */

/** 推定に使わないパス片 (ここから先はプロジェクトの中身ではない) */
const CUTS = ['/node_modules/', '/.vite/', '/.next/', '/dist/', '/build/', '/.output/'];

/** 明らかにプロジェクトのルートになりえないもの */
const REJECT = /^\/(?:$|usr\/|bin\/|etc\/|System\/|Library\/|private\/var\/folders\/)/;

/** 絶対パスからプロジェクトのルート候補を切り出す (見つからなければ null) */
export function rootOf(absPath: string): string | null {
  let path = absPath;
  for (const cut of CUTS) {
    const i = path.indexOf(cut);
    if (i > 0) path = path.slice(0, i);
  }
  // ファイルを指したままなら親ディレクトリにする
  if (/\.[a-z0-9]+$/i.test(path)) path = path.slice(0, path.lastIndexOf('/'));
  if (!path.startsWith('/') || path.length < 4) return null;
  if (REJECT.test(path)) return null;
  return path;
}

/**
 * 文字列群 (スタック / script src / リソース URL) から候補を頻度順に返す。
 * 同じ候補が何度も出るほど確からしいので、出現回数で並べる。
 */
export function extractRootCandidates(sources: Iterable<string>, limit = 5): string[] {
  const count = new Map<string, number>();
  const bump = (abs: string) => {
    const root = rootOf(abs);
    if (root) count.set(root, (count.get(root) ?? 0) + 1);
  };
  for (const raw of sources) {
    const text = String(raw ?? '');
    // Vite: http://host/@fs/Users/me/proj/... (クエリ・行番号は落とす)
    for (const m of text.matchAll(/\/@fs(\/[^\s?:)'"]+)/g)) bump(m[1]);
    // 素の絶対パス (スタック中の file:line:col / file:// URL)
    for (const m of text.matchAll(/(?:^|[\s('"]|file:\/\/)(\/(?:Users|home|Volumes|workspace|srv|opt|data)\/[^\s?:)'"]+)/g)) {
      bump(m[1]);
    }
  }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .slice(0, limit)
    .map(([root]) => root);
}

/**
 * 候補と「開こうとした相対パス」から、そのまま貼れるマッピング行を作る。
 * 相対パスの先頭セグメント (`/src` 等) を候補の下にぶら下げる。
 */
export function mappingLine(relPath: string, root: string, host = ''): string {
  const seg = relPath.replace(/^\/+/, '').split('/')[0] ?? '';
  const scope = host ? ` @ ${host}` : '';
  return `/${seg}=${root.replace(/\/+$/, '')}/${seg}${scope}`;
}
