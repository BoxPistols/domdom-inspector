#!/usr/bin/env node
// エディタジャンプの鎖を**目視なしで**検証する。
//
// なぜ要るか:
//   この機能は「拡張 → dev サーバ → エディタ」と 3 者にまたがる。成否をレスポンスから
//   取れないため (dev サーバは launch-editor の完了を待たず 200 を返す)、これまで毎回
//   人間が実エディタを目で見て確認していた。そして**毎回失敗していた**。
//   フォーカス移動での自動判定も実測で使えなかった (同じ操作で 2.61 秒 / 8.61 秒 /
//   10 秒以内に来ない — ファイルが既に開いていると -r はウィンドウを前面に出さない)。
//
//   そこで **GUI を除いた全区間**を機械で固定する: 実 Vite を立て、LAUNCH_EDITOR を
//   「引数を記録するだけの偽エディタ」に向け、**拡張自身の URL 組み立てコード**で叩いて、
//   エディタに届いた argv を突き合わせる。
//
//   残る未検証は「そのエディタが -g を honor するか」だけで、これはエディタ固有の
//   一度きりの事実 (各 CLI の --help で確認できる)。変更のたびに見る必要はない。
//
// 使い方: pnpm verify:editor
// 終了コード: 1 = 鎖のどこかが壊れている

import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5391;
const rows = [];
const check = (name, ok, detail) => rows.push({ name, ok, detail });

/** 拡張自身の URL 組み立てを使う (ここを別実装にすると検証の意味が消える) */
const { ENDPOINTS, handledByEditor } = await import(join(ROOT, 'src', 'openInEditor.ts')).catch(async () => {
  // .ts を直接 import できない環境では esbuild 経由で読む
  const { build } = await import('esbuild');
  const out = join(mkdtempSync(join(tmpdir(), 'vej-')), 'openInEditor.mjs');
  await build({
    entryPoints: [join(ROOT, 'src', 'openInEditor.ts')],
    outfile: out,
    format: 'esm',
    bundle: true,
    platform: 'node',
  });
  return import(out);
});

/**
 * vite の実体を探す。**この repo は WXT 経由で vite を持つので `.bin/vite` に出ない。**
 * pnpm のストアから最新のものを 1 つ選ぶ (検証したいのは launch-editor の挙動なので、
 * vite の版は「その middleware を積んでいる」ことだけ満たせばよい)。
 */
function findVite() {
  const store = join(ROOT, 'node_modules', '.pnpm');
  const dirs = readdirSync(store)
    .filter((d) => d.startsWith('vite@'))
    .sort();
  for (const dir of dirs.reverse()) {
    const bin = join(store, dir, 'node_modules', 'vite', 'bin', 'vite.js');
    if (existsSync(bin)) return bin;
  }
  throw new Error(`vite の実体が見つからない (${store})`);
}

const work = mkdtempSync(join(tmpdir(), 'domdom-editor-verify-'));
const projectDir = join(work, 'project');
const argvLog = join(work, 'argv.log');
const fakeEditorDir = join(work, 'launch-editor');
let server;

function cleanup() {
  try {
    server?.kill('SIGTERM');
  } catch {
    /* 既に終了 */
  }
  rmSync(work, { recursive: true, force: true });
}
process.on('exit', cleanup);

try {
  // ---- ① 実プロジェクトと、引数を記録するだけの「偽エディタ」を用意する ----
  mkdirSync(join(projectDir, 'src'), { recursive: true });
  writeFileSync(join(projectDir, 'index.html'), '<!doctype html><title>t</title>');
  writeFileSync(join(projectDir, 'src', 'Target.tsx'), 'export const Target = () => null;\n');

  // **名前を `code` にする。** launch-editor は path.basename でエディタを判別し、
  // VS Code 系の名前のときだけ `-g file:line:column` を渡す。名前が違うと行番号が
  // 別のファイル名として渡ってしまう (この仕様の検証がこのスクリプトの主目的)
  mkdirSync(fakeEditorDir, { recursive: true });
  const fakeEditor = join(fakeEditorDir, 'code');
  writeFileSync(
    fakeEditor,
    `#!/bin/sh\n{ for a in "$@"; do printf '%s\\n' "$a"; done; } >> ${JSON.stringify(argvLog)}\n`,
    { mode: 0o755 },
  );
  writeFileSync(argvLog, '');

  // ---- ② 実 Vite を立てる ----
  // **先にポートの空きを確かめる。** 前回の残骸が listen していると、readiness の fetch は
  // そちらに当たって「起動できた」ように見え、実際には別サーバを検証してしまう
  // (最初の実装でこれを踏み、product の不具合と誤認しかけた)
  const portFree = await fetch(`http://localhost:${PORT}/`, { signal: AbortSignal.timeout(500) })
    .then(() => false)
    .catch(() => true);
  check(
    `ポート ${PORT} が空いている (前回の残骸を検証しない)`,
    portFree,
    portFree ? '空き' : `既に誰かが listen している`,
  );
  if (!portFree) throw new Error(`ポート ${PORT} が使用中`);
  // WXT 経由で入るので .bin には出ない。pnpm のストアから実体を探す
  const viteBin = findVite();
  server = spawn(process.execPath, [viteBin, '--port', String(PORT), '--strictPort'], {
    cwd: projectDir,
    env: { ...process.env, LAUNCH_EDITOR: fakeEditor },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));

  const ready = await (async () => {
    for (let i = 0; i < 60; i += 1) {
      try {
        await fetch(`http://localhost:${PORT}/`);
        return true;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    return false;
  })();
  check('dev サーバが起動する', ready, ready ? `http://localhost:${PORT}` : serverLog.slice(-200));
  if (!ready) throw new Error('dev サーバが起動しない');

  // ---- ③ 拡張と同じ URL でエンドポイントを叩く ----
  const loc = { fileName: '/src/Target.tsx', lineNumber: 42, columnNumber: 7 };
  const vite = ENDPOINTS.find((e) => e.name === 'vite');
  const url = vite.url(`http://localhost:${PORT}`, loc);
  const res = await fetch(url);
  // **拡張と同じ判定を使う。** 200 だけ見ると SPA フォールバック (未知パスに HTML を
  // 返す) を「処理された」と誤読する。最初の実装はここが甘く、エンドポイント自体が
  // 無い版でも pass してしまっていた
  const ct = res.headers.get('content-type');
  check(
    'エンドポイントが実在する (SPA フォールバックではない)',
    handledByEditor(res.status, ct),
    `status=${res.status} content-type=${ct ?? '(なし)'}`,
  );
  // launch-editor は spawn するだけなので少し待つ
  await new Promise((r) => setTimeout(r, 1500));

  // ---- ④ エディタに届いた引数を突き合わせる ----
  const argv = readFileSync(argvLog, 'utf8').split('\n').filter(Boolean);
  // **realpath で比べる。** macOS の tmpdir は /var/folders (symlink) を返すが、
  // dev サーバの process.cwd() は解決済みの /private/var/folders を返す。
  // 素朴に比べると「届いているのに不一致」になる (最初の実装で踏んだ)
  const expectedPath = realpathSync(join(projectDir, 'src', 'Target.tsx'));
  check(
    'エディタが起動された (引数が記録された)',
    argv.length > 0,
    argv.length
      ? argv.join(' ')
      : `一度も呼ばれていない / url=${url} / editor=${fakeEditor} / server=${serverLog.slice(-300).replace(/\n/g, ' ')}`,
  );
  check(
    '行番号を渡す引数形式が選ばれている (-g)',
    argv.includes('-g'),
    argv.join(' ') || '(なし)',
  );
  // **ここが本丸**: 行と桁が「別のファイル名」ではなく file:line:column で届くこと
  check(
    'ファイル・行・桁が 1 つの引数で届く',
    argv.includes(`${expectedPath}:42:7`),
    argv.filter((a) => a.includes('Target.tsx')).join(' ') || '(なし)',
  );
  check(
    '行番号が別の引数として渡っていない (一覧に無い名前のときの壊れ方)',
    !argv.includes('42'),
    argv.includes('42') ? '42 が単独の引数として渡っている' : 'なし',
  );

  // ---- ⑤ 実在しないパスは「黙って無反応 + 200」になることを固定する ----
  writeFileSync(argvLog, '');
  const missing = await fetch(
    vite.url(`http://localhost:${PORT}`, { ...loc, fileName: '/src/DoesNotExist.tsx' }),
  );
  await new Promise((r) => setTimeout(r, 1000));
  const argvMissing = readFileSync(argvLog, 'utf8').trim();
  check(
    '実在しないパスでも 200 が返る (拡張から成否を判別できない根拠)',
    missing.status === 200,
    `status=${missing.status}`,
  );
  check(
    '実在しないパスではエディタが起動されない (無反応の 2 つ目の経路)',
    argvMissing === '',
    argvMissing || 'なし',
  );
  // ---- ⑥ **この検査が壊れ方を検出できることを示す。**
  // 一覧に無い名前 (myeditor) で同じことをすると、行と桁が別の引数として渡る。
  // 「9/9 pass」だけでは検査が何も見ていない可能性を否定できないので、
  // 壊れた形をここで実際に作って、確かに違う結果になることを確認する ----
  const unlistedEditor = join(fakeEditorDir, 'myeditor');
  writeFileSync(
    unlistedEditor,
    `#!/bin/sh\n{ for a in "$@"; do printf '%s\\n' "$a"; done; } >> ${JSON.stringify(argvLog)}\n`,
    { mode: 0o755 },
  );
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));
  writeFileSync(argvLog, '');
  server = spawn(process.execPath, [viteBin, '--port', String(PORT + 1), '--strictPort'], {
    cwd: projectDir,
    env: { ...process.env, LAUNCH_EDITOR: unlistedEditor },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  for (let i = 0; i < 60; i += 1) {
    try {
      await fetch(`http://localhost:${PORT + 1}/`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  await fetch(vite.url(`http://localhost:${PORT + 1}`, loc));
  await new Promise((r) => setTimeout(r, 1500));
  const argvUnlisted = readFileSync(argvLog, 'utf8').split('\n').filter(Boolean);
  check(
    '【反証】一覧に無い名前では行と桁が別の引数になる (この検査は壊れ方を検出できる)',
    argvUnlisted.includes('42') && argvUnlisted.includes('7') && !argvUnlisted.includes('-g'),
    argvUnlisted.join(' ') || '(呼ばれていない)',
  );
} catch (err) {
  check('検証の実行', false, String(err).slice(0, 200));
}

// ---- 結果 ----
const pad = Math.max(...rows.map((r) => [...r.name].length));
console.log('\nエディタジャンプの鎖 (GUI を除く全区間)\n');
for (const r of rows) {
  console.log(`${r.ok ? '✅' : '❌'} ${r.name.padEnd(pad)}  ${r.detail ?? ''}`);
}
const failed = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - failed.length}/${rows.length} 項目 pass`);
if (failed.length) {
  console.log('\n鎖が壊れている。実エディタを目で見る前に、ここを直す。');
} else {
  console.log(
    '\n残る未検証は「そのエディタが -g を honor するか」だけ (CLI の --help で確認できる一度きりの事実)。',
  );
}
// **明示的に終了する。** spawn した dev サーバがイベントループを掴むので、
// exitCode を立てるだけでは戻ってこない (最初の実装はここで固まった)
cleanup();
process.exit(failed.length ? 1 : 0);
