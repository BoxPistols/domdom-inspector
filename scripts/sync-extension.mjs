#!/usr/bin/env node
// build 成果物 (.output/chrome-mv3) を OneDrive 等の同期フォルダへ「実ファイル」として展開し、
// 複数 PC で同一の unpacked 拡張を共有できるようにする。
//
// なぜ symlink ではなく実体コピーか:
//   OneDrive はシンボリックリンクを同期できず、他 PC ではリンク先パス文字列を持つ
//   ただのテキストファイルに化ける (Chrome が拡張として読めない)。実ファイルを
//   コピーすれば全 PC に同期され、各 PC でそのまま unpacked 拡張として読み込める。
//
// 展開先の解決順 (公開リポジトリに個人パスを埋め込まないため config は外出し):
//   1. 環境変数 EXT_SYNC_DIR          (最優先の明示指定)
//   2. .env.local の EXT_SYNC_DIR 行  (git 管理外)
//   3. macOS 自動検出: ~/Library/CloudStorage/OneDrive-*/Extensions (一意なら採用)
// いずれも特定できなければ手順を表示して終了する。

import { cp, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, '.output', 'chrome-mv3');
/** 展開先サブフォルダ名 = Chrome に読み込ませる拡張フォルダ名 */
const APP = 'domdom-inspector';

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

// macOS の ~/Library/CloudStorage/OneDrive-*/Extensions を自動検出 (一意な時だけ)
async function detectOneDrive() {
  const base = join(homedir(), 'Library', 'CloudStorage');
  if (!existsSync(base)) return null;
  const withExt = (await readdir(base))
    .filter((n) => n.startsWith('OneDrive'))
    .map((n) => join(base, n, 'Extensions'))
    .filter((p) => existsSync(p));
  return withExt.length === 1 ? withExt[0] : null;
}

async function resolveTargetBase() {
  if (process.env.EXT_SYNC_DIR) return process.env.EXT_SYNC_DIR;
  const fromEnv = await readEnvLocal('EXT_SYNC_DIR');
  if (fromEnv) return fromEnv;
  return detectOneDrive();
}

async function main() {
  if (!existsSync(join(SRC, 'manifest.json'))) {
    console.error(`✗ build 成果物が見つかりません: ${SRC}\n  先に \`pnpm build\` を実行してください。`);
    process.exit(1);
  }

  const targetBase = await resolveTargetBase();
  if (!targetBase) {
    console.error(
      '✗ 展開先が特定できません。次のいずれかで指定してください:\n' +
        '  - 環境変数:   EXT_SYNC_DIR=/path/to/OneDrive/Extensions pnpm sync\n' +
        '  - .env.local: EXT_SYNC_DIR=/path/to/OneDrive/Extensions\n' +
        '  (macOS で ~/Library/CloudStorage/OneDrive-*/Extensions が一意なら自動検出します)',
    );
    process.exit(1);
  }

  const dest = join(targetBase, APP);
  const tmp = join(targetBase, `.${APP}.tmp`);

  // temp に完全コピー → 旧 dest 除去 → atomic rename。半端コピーを Chrome/OneDrive に見せない。
  await mkdir(targetBase, { recursive: true });
  await rm(tmp, { recursive: true, force: true });
  await cp(SRC, tmp, { recursive: true });
  await rm(dest, { recursive: true, force: true });
  await rename(tmp, dest);

  console.log(`✓ 展開完了: ${dest}`);
  console.log('  Chrome: chrome://extensions →「パッケージ化されていない拡張機能を読み込む」→ 上記フォルダ');
  console.log('  更新後は各 PC で拡張の「更新」ボタン (⟳) を押すと反映されます。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
