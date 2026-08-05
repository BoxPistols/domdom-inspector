#!/usr/bin/env node
// build 成果物 (.output/chrome-mv3) を OneDrive 等の同期フォルダへ「実ファイル」として展開し、
// 複数 PC (Mac / Windows) で同一の unpacked 拡張を共有できるようにする。
//
// **`pnpm build` から自動で呼ばれる** (`--auto`)。手で忘れると「3 日前のビルドを見て
// 『機能が出ない』と報告する」事故が起きるため、build と同期を分けない。
//
// なぜ symlink ではなく実体コピーか:
//   OneDrive はシンボリックリンクを同期できず、他 PC ではリンク先パス文字列を持つ
//   ただのテキストファイルに化ける (Chrome が拡張として読めない)。実ファイルを
//   コピーすれば全 PC に同期され、各 PC でそのまま unpacked 拡張として読み込める。
//
// 展開先の解決順 (公開リポジトリに個人パスを埋め込まないため config は外出し):
//   1. 環境変数 EXT_SYNC_DIR          (最優先の明示指定)
//   2. .env.local の EXT_SYNC_DIR 行  (git 管理外)
//   3. macOS 自動検出: ~/Library/CloudStorage/OneDrive-*/Extensions
//   4. Windows 自動検出: %OneDrive% / %OneDriveConsumer% / %OneDriveCommercial% + \Extensions
//   5. 汎用フォールバック: ~/OneDrive/Extensions
//
// --auto 付き (build からの自動呼び出し) で展開先が特定できないときは、
// **警告だけ出して正常終了する** (CI や他人のクローンで build を失敗させない)。
// `pnpm sync` の明示実行では従来どおりエラーで落とす。

import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, '.output', 'chrome-mv3');
/** 展開先サブフォルダ名 = Chrome に読み込ませる拡張フォルダ名 */
const APP = 'domdom-inspector';
/** build から自動で呼ばれたか (展開先未設定を致命扱いにしない) */
const AUTO = process.argv.includes('--auto');

/** .env.local から指定キーの値を取り出す (存在しなければ null) */
async function readEnvLocal(key) {
  const p = join(ROOT, '.env.local');
  if (!existsSync(p)) return null;
  const txt = await readFile(p, 'utf8');
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, '');
  }
  return null;
}

// macOS の ~/Library/CloudStorage 配下にある OneDrive-<アカウント> を探す。
// Extensions が既にある候補を優先し、無ければ OneDrive ルートが一意なときだけ採用する
// (新しい Mac で初回同期するときに Extensions を手で作らせないため)。
// ※ block コメントにパスの glob を書かない: `*` + `/` がコメントを閉じて SyntaxError になる
async function detectOneDriveMac() {
  const base = join(homedir(), 'Library', 'CloudStorage');
  if (!existsSync(base)) return null;
  const roots = (await readdir(base)).filter((n) => n.startsWith('OneDrive')).map((n) => join(base, n));
  const withExt = roots.map((r) => join(r, 'Extensions')).filter((p) => existsSync(p));
  if (withExt.length === 1) return withExt[0];
  if (withExt.length === 0 && roots.length === 1) return join(roots[0], 'Extensions');
  return null;
}

/** Windows は OneDrive が環境変数を立てる (Extensions は無ければ作る) */
function detectOneDriveWindows() {
  for (const key of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    const root = process.env[key];
    if (root && existsSync(root)) return join(root, 'Extensions');
  }
  return null;
}

async function resolveTargetBase() {
  if (process.env.EXT_SYNC_DIR) return process.env.EXT_SYNC_DIR;
  const fromEnv = await readEnvLocal('EXT_SYNC_DIR');
  if (fromEnv) return fromEnv;
  if (process.platform === 'darwin') {
    const mac = await detectOneDriveMac();
    if (mac) return mac;
  }
  if (process.platform === 'win32') {
    const win = detectOneDriveWindows();
    if (win) return win;
  }
  // 汎用フォールバック (Windows の旧レイアウト / Linux で自前同期している場合)。
  // **~/OneDrive 自体の存在を条件にする**: ホームの存在を条件にすると常に真になり、
  // CI や他人のクローンで ~/OneDrive/Extensions を勝手に作ってしまう
  const oneDrive = join(homedir(), 'OneDrive');
  if (existsSync(oneDrive)) return join(oneDrive, 'Extensions');
  return null;
}

/** ディレクトリ配下の全ファイルを (相対パス, 内容) で走査して 1 つのハッシュにする */
async function hashTree(dir) {
  const files = [];
  async function walk(d) {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) await walk(p);
      else if (entry.isFile()) files.push(p);
    }
  }
  await walk(dir);
  // パス区切りを正規化してソート → OS 間で同じハッシュになる
  files.sort();
  const h = createHash('sha256');
  for (const f of files) {
    h.update(relative(dir, f).split(sep).join('/'));
    h.update(await readFile(f));
  }
  return h.digest('hex');
}

async function main() {
  if (!existsSync(join(SRC, 'manifest.json'))) {
    console.error(`✗ build 成果物が見つかりません: ${SRC}\n  先に \`pnpm build\` を実行してください。`);
    process.exit(1);
  }

  const targetBase = await resolveTargetBase();
  if (!targetBase) {
    const hint =
      '展開先が特定できません。同期したい場合は次のいずれかで指定してください:\n' +
      '  - 環境変数:   EXT_SYNC_DIR=/path/to/OneDrive/Extensions\n' +
      '  - .env.local: EXT_SYNC_DIR=/path/to/OneDrive/Extensions\n' +
      '  (macOS の ~/Library/CloudStorage/OneDrive-*/ と Windows の %OneDrive% は自動検出)';
    if (AUTO) {
      // build を失敗させない (CI・他人のクローンでは同期先が無いのが正常)
      console.warn(`- 同期スキップ: ${hint}`);
      return;
    }
    console.error(`✗ ${hint}`);
    process.exit(1);
  }

  const dest = join(targetBase, APP);
  const tmp = join(targetBase, `.${APP}.tmp`);
  const stampPath = join(targetBase, `.${APP}.hash`);

  const { version } = JSON.parse(await readFile(join(SRC, 'manifest.json'), 'utf8'));
  const hash = await hashTree(SRC);

  // 内容が同じなら書かない。**毎ビルドで書くと OneDrive が同じ 170KB を再アップロードし続ける**
  // (build は e2e やゲートで何度も走る)。dest が消えている場合は必ず作り直す。
  if (existsSync(dest) && existsSync(stampPath)) {
    const prev = (await readFile(stampPath, 'utf8')).trim();
    if (prev === hash) {
      console.log(`- 同期スキップ (内容に変更なし): v${version} → ${dest}`);
      return;
    }
  }

  // temp に完全コピー → 旧 dest 除去 → atomic rename。半端コピーを Chrome/OneDrive に見せない。
  await mkdir(targetBase, { recursive: true });
  await rm(tmp, { recursive: true, force: true });
  await cp(SRC, tmp, { recursive: true });
  await rm(dest, { recursive: true, force: true });
  await rename(tmp, dest);
  await writeFile(stampPath, `${hash}\n`, 'utf8');

  const size = await totalSize(dest);
  console.log(`✓ 同期しました: v${version} (${(size / 1024).toFixed(0)} kB) → ${dest}`);
  console.log('  各 PC で chrome://extensions の ⟳ を押すと反映されます');
  console.log(`  反映されたかは拡張カードの版数が v${version} になっているかで判別できます`);
}

/** 展開後の総サイズ (ログで「何が入ったか」を一目で分かるようにする) */
async function totalSize(dir) {
  let sum = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) sum += await totalSize(p);
    else if (entry.isFile()) sum += (await stat(p)).size;
  }
  return sum;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
