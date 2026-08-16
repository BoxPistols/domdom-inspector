import type { Settings } from './types';

/**
 * dev サーバにエディタを教えるための、**1 回だけの設定**を組み立てる純関数。
 *
 * なぜ利用者に設定させるのか (拡張側では消せない理由):
 * dev サーバ (Vite 等) は `launch-editor` でエディタを起動するが、
 * **どのエディタを使うかはサーバ側の環境変数でしか決められない**。エンドポイントに
 * エディタを指定するパラメータは無く (`launch-editor-middleware` は `file` しか読まない)、
 * ブラウザからサーバの環境変数は変えられない。よって拡張ができるのは
 * 「**正しい 1 行を、考えなくていい形で渡すこと**」まで。
 *
 * `launch-editor` はエディタ名 (`path.basename`) で引数の形を決める。
 * `-r -g file:line:column` (VS Code 系) を受け取れるのは次の名前だけ:
 * `code / Code / code-insiders / Code - Insiders / codium / trae / cursor / vscodium / VSCodium`。
 * 一覧に無い名前は既定分岐 `[file, line, column]` になり、**行と桁が別のファイル名として
 * 渡る**ため、開いても該当箇所に飛ばない (2026-08-16 実測)。
 */

/** `launch-editor` が VS Code 系として扱う名前 (行・桁まで飛べる) */
const GOTO_CAPABLE = new Set([
  'code',
  'Code',
  'code-insiders',
  'Code - Insiders',
  'codium',
  'trae',
  'cursor',
  'vscodium',
  'VSCodium',
]);

/** `launch-editor` が名前で認識する CLI (行番号の渡し方まで知っている) */
const KNOWN_CLI: Partial<Record<Settings['editor'], string>> = {
  vscode: 'code',
  cursor: 'cursor',
  // webstorm は VS Code 系ではないが `--line/--column` で正しく飛べる
  webstorm: 'webstorm',
};

/** 一覧に無いエディタ用: 実体の CLI (この名前では行番号が渡らないので shim で包む) */
const UNKNOWN_CLI: Partial<Record<Settings['editor'], { cli: string; macApp: string }>> = {
  antigravity: {
    cli: 'antigravity-ide',
    macApp: '/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide',
  },
};

export interface DevServerSetup {
  /** そのまま貼れるコマンド。実行後に dev サーバを起動し直す */
  snippet: string;
  /**
   * `code` という名前の shim が要るか。
   * `launch-editor` は**名前で**引数の形を決めるので、一覧に無いエディタは
   * 名前だけ借りる (実体は任意)。**PATH には載せない**ので既存の `code` は無傷。
   */
  needsShim: boolean;
}

/**
 * 選択中のエディタに対する設定コマンドを組み立てる。
 * `custom` はコマンド名を知りようがないので、置き換え箇所を明示した雛形を返す。
 */
export function devServerSetup(editor: Settings['editor']): DevServerSetup {
  const known = KNOWN_CLI[editor];
  if (known) {
    // 名前が一覧にあるので、そのまま渡すだけで行・桁まで飛ぶ。
    // **2 つ設定する**: Vite/webpack 系は `LAUNCH_EDITOR`、Next.js は `REACT_EDITOR`
    // しか見ない (2026-08-17 実測、Next 16.3.0)。片方だけだと片方のフレームワークで
    // 黙って効かない
    return { snippet: `export LAUNCH_EDITOR=${known} REACT_EDITOR=${known}`, needsShim: false };
  }

  const unknown = UNKNOWN_CLI[editor];
  const target = unknown?.macApp ?? '<エディタの CLI の絶対パス>';
  // 名前が一覧に無い。`code` という名前を借りて VS Code 系の引数形式を選ばせる。
  // 置き場所は PATH に載せないディレクトリにする (既存の code / cursor を壊さない)
  return {
    snippet: [
      'mkdir -p ~/.local/launch-editor',
      `ln -sfn "${target}" ~/.local/launch-editor/code`,
      // Vite/webpack 系は LAUNCH_EDITOR、Next.js は REACT_EDITOR しか見ない
      'export LAUNCH_EDITOR="$HOME/.local/launch-editor/code"',
      'export REACT_EDITOR="$HOME/.local/launch-editor/code"',
    ].join('\n'),
    needsShim: true,
  };
}

/** その名前で行・桁まで飛べるか (README / テスト用) */
export function canJumpToLine(cliName: string): boolean {
  return GOTO_CAPABLE.has(cliName) || cliName === 'webstorm';
}
