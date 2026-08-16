import { describe, expect, it } from 'vitest';
import { canJumpToLine, devServerSetup } from './devServerSetup';
import type { Settings } from './types';

/**
 * この設定は**利用者に 1 回だけ手を動かしてもらう**ものなので、渡す 1 行が間違って
 * いると「言われたとおりにしたのに開かない」になる。実測で確かめた仕様を固定する:
 * `launch-editor` は名前で引数の形を決め、一覧に無い名前では行と桁が
 * **別のファイル名として渡る** (開いても飛ばない)。
 */

const EDITORS: Settings['editor'][] = ['vscode', 'cursor', 'antigravity', 'webstorm', 'custom'];

describe('devServerSetup — 名前が一覧にあるエディタ', () => {
  it('vscode / cursor / webstorm は 1 行で済む (shim 不要)', () => {
    expect(devServerSetup('vscode')).toEqual({
      snippet: 'export LAUNCH_EDITOR=code',
      needsShim: false,
    });
    expect(devServerSetup('cursor')).toEqual({
      snippet: 'export LAUNCH_EDITOR=cursor',
      needsShim: false,
    });
    expect(devServerSetup('webstorm').needsShim).toBe(false);
  });

  it('渡す名前は必ず行・桁まで飛べるものにする', () => {
    for (const editor of ['vscode', 'cursor', 'webstorm'] as const) {
      const name = devServerSetup(editor).snippet.split('=').pop() ?? '';
      expect({ editor, canJump: canJumpToLine(name) }).toEqual({ editor, canJump: true });
    }
  });
});

describe('devServerSetup — 名前が一覧に無いエディタ', () => {
  it('Antigravity は code という名前を借りる (実体は Antigravity のまま)', () => {
    const setup = devServerSetup('antigravity');
    expect(setup.needsShim).toBe(true);
    expect(setup.snippet).toContain('Antigravity IDE.app');
    expect(setup.snippet).toContain('~/.local/launch-editor/code');
    expect(setup.snippet).toContain('export LAUNCH_EDITOR=');
  });

  it('**shim を PATH に載せない** (既存の code / cursor を壊さない)', () => {
    const setup = devServerSetup('antigravity');
    // PATH を書き換える行が混ざっていたら、この設定は利用者の環境を壊す
    expect(setup.snippet).not.toMatch(/PATH=/);
    expect(setup.snippet).not.toMatch(/\/usr\/local\/bin/);
  });

  it('LAUNCH_EDITOR が指すのは basename が code のパス (引数形式の選択がこれで決まる)', () => {
    const line = devServerSetup('antigravity')
      .snippet.split('\n')
      .find((l) => l.startsWith('export LAUNCH_EDITOR='));
    const path = (line ?? '').split('=').slice(1).join('=').replace(/"/g, '');
    expect(path.split('/').pop()).toBe('code');
    expect(canJumpToLine(path.split('/').pop() ?? ''), '行番号が渡る名前であること').toBe(true);
  });

  it('custom は置き換え箇所を明示した雛形を返す (勝手なコマンド名を書かない)', () => {
    const setup = devServerSetup('custom');
    expect(setup.needsShim).toBe(true);
    expect(setup.snippet).toContain('<');
  });
});

describe('devServerSetup — 全エディタで成立する', () => {
  it('どのエディタでも空でないコマンドを返す (選べるのに案内が無い状態を作らない)', () => {
    for (const editor of EDITORS) {
      const setup = devServerSetup(editor);
      expect({ editor, ok: setup.snippet.trim().length > 0 }).toEqual({ editor, ok: true });
      expect({ editor, hasExport: setup.snippet.includes('LAUNCH_EDITOR') }).toEqual({
        editor,
        hasExport: true,
      });
    }
  });
});

describe('canJumpToLine — 実測した仕様', () => {
  it('VS Code 系の名前は行・桁まで飛べる', () => {
    for (const name of ['code', 'cursor', 'codium', 'trae', 'vscodium']) {
      expect({ name, ok: canJumpToLine(name) }).toEqual({ name, ok: true });
    }
  });

  it('**antigravity-ide は飛べない** (launch-editor に登録が無い = 既定分岐に落ちる)', () => {
    expect(canJumpToLine('antigravity-ide')).toBe(false);
  });
});
