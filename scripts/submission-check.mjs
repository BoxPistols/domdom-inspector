#!/usr/bin/env node
// Chrome Web Store 提出前チェックを**実測**する。
//
// なぜスクリプトにするか:
//   判定を文書に数字で書くと即座に古くなる (実際に「対象版 v0.4.6」「未 push 17 件」と
//   書いた直後に自分のコミットで古くなった)。**古い判定書は旧 zip をアップロードする事故を
//   生む**ので、数字は毎回測る。docs/store-submission-readiness.md はこのスクリプトを指す。
//
// 使い方: pnpm check:submission   (先に pnpm build && pnpm shots を済ませておく)
// 終了コード: 1 = 提出できない項目がある

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.output', 'chrome-mv3');
const rows = [];

/** 1 項目の判定を記録する。ok=false は提出不可、warn=true は注意 (提出は可) */
function check(name, ok, detail, { warn = false } = {}) {
  rows.push({ name, ok, detail, warn });
}

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));
const sh = (cmd) => execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();

// ---- ① 版数の一致 ----------------------------------------------------------
const pkgVersion = json('package.json').version;
if (!existsSync(join(OUT, 'manifest.json'))) {
  console.error('✗ .output/chrome-mv3 が無い。先に `pnpm build` を実行してください。');
  process.exit(1);
}
const manifest = json('.output/chrome-mv3/manifest.json');
check(
  '版数の一致 (package.json ↔ manifest)',
  manifest.version === pkgVersion,
  `package.json ${pkgVersion} / manifest ${manifest.version}`,
);

// 出荷する zip が「今の版」であること (.output には旧版が残るので取り違え防止)
const zipName = `domdom-inspector-${pkgVersion}-chrome.zip`;
const zipPath = join(ROOT, '.output', zipName);
const zips = existsSync(join(ROOT, '.output'))
  ? readdirSync(join(ROOT, '.output')).filter((f) => f.endsWith('.zip'))
  : [];
check(
  `提出 zip が今の版で存在 (${zipName})`,
  existsSync(zipPath),
  existsSync(zipPath)
    ? `${(statSync(zipPath).size / 1024).toFixed(1)} kB / .output 内の zip: ${zips.length} 個`
    : `見つからない。\`pnpm zip\` を実行。.output 内の zip: ${zips.join(', ') || 'なし'}`,
);
if (zips.length > 1) {
  check(
    '.output に旧版の zip が残っている',
    true,
    `${zips.length} 個: ${zips.join(', ')} — アップロード時に版数を確認する`,
    { warn: true },
  );
}

// ---- ② manifest の中身 ------------------------------------------------------
const wantPerms = ['storage', 'activeTab', 'scripting', 'contextMenus'];
const perms = manifest.permissions ?? [];
check(
  'permissions が想定どおり',
  wantPerms.every((p) => perms.includes(p)) && perms.length === wantPerms.length,
  perms.join(' / '),
);
check(
  'optional_host_permissions が *://*/* のみ (既定未付与)',
  JSON.stringify(manifest.optional_host_permissions) === JSON.stringify(['*://*/*']),
  JSON.stringify(manifest.optional_host_permissions),
);
check('minimum_chrome_version が宣言済み', !!manifest.minimum_chrome_version, String(manifest.minimum_chrome_version));
check('default_locale = en', manifest.default_locale === 'en', String(manifest.default_locale));
check(
  'commands は配線のあるものだけ',
  Object.keys(manifest.commands ?? {}).length === 1 && !!manifest.commands?.['toggle-inspect'],
  Object.keys(manifest.commands ?? {}).join(', ') || 'なし',
);

// ---- ③ アイコンと locale ----------------------------------------------------
const wantIcons = ['16', '32', '48', '96', '128'];
const icons = existsSync(join(OUT, 'icon')) ? readdirSync(join(OUT, 'icon')) : [];
check(
  'アイコン 5 サイズが成果物にある',
  wantIcons.every((s) => icons.includes(`${s}.png`)),
  icons.join(' '),
);
const locales = existsSync(join(OUT, '_locales')) ? readdirSync(join(OUT, '_locales')) : [];
check('_locales が en/ja', locales.includes('en') && locales.includes('ja'), locales.join(' '));

// ---- ④ 文字数上限 (CWS は 132 文字) -----------------------------------------
const LIMIT = 132;
for (const loc of ['en', 'ja']) {
  const msg = json(`public/_locales/${loc}/messages.json`);
  const d = msg.extDescription?.message ?? '';
  check(`description の長さ (${loc}, 上限 ${LIMIT})`, d.length > 0 && d.length <= LIMIT, `${d.length} 文字`);
}
const listing = read('STORE_LISTING.md');
for (const [label, pat] of [
  ['Summary (en)', /\*\*Summary \(132 chars max\):\*\*\n(.+)/],
  ['概要 (ja)', /\*\*概要\(132 文字以内\):\*\*\n(.+)/],
]) {
  const m = listing.match(pat);
  const t = m ? m[1].trim() : '';
  check(`${label} の長さ (上限 ${LIMIT})`, t.length > 0 && t.length <= LIMIT, `${t.length} 文字`);
}

// ---- ⑤ 送信経路ゼロ (申告の根拠) -------------------------------------------
// 4 文書 (SECURITY / PRIVACY / STORE_LISTING / PUBLISHING) が「外部送信なし」を主張している。
// その根拠が崩れていないかを毎回測る。
let netHits = '';
try {
  netHits = sh(
    `grep -rniE "fetch\\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource" src entrypoints --include="*.ts" | grep -v "\\.test\\.ts" || true`,
  );
} catch {
  netHits = '';
}
check(
  '送信 API の発生箇所が 0 件 (Data usage「収集しない」の根拠)',
  netHits === '',
  netHits === '' ? '0 件' : netHits.split('\n').slice(0, 3).join(' / '),
);

// 出荷物にも残っていないこと (tree-shake の確認)
let bundleNet = '';
try {
  bundleNet = sh(
    `grep -rlE "api\\.openai\\.com|generativelanguage\\.googleapis\\.com" .output/chrome-mv3 || true`,
  );
} catch {
  bundleNet = '';
}
check('成果物に外部エンドポイントが残っていない', bundleNet === '', bundleNet || 'なし');

// ---- ⑥ スクリーンショット (実寸を PNG ヘッダから読む) ----------------------
/** PNG の IHDR から幅と高さを読む (ライブラリ不要) */
function pngSize(file) {
  const b = readFileSync(file);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
for (const loc of ['en', 'ja']) {
  const dir = join(ROOT, 'docs', 'store-assets', loc);
  if (!existsSync(dir)) {
    check(`スクリーンショット (${loc})`, false, '未生成。`pnpm shots` を実行');
    continue;
  }
  const pngs = readdirSync(dir).filter((f) => f.endsWith('.png'));
  const wrong = pngs
    .map((f) => ({ f, s: pngSize(join(dir, f)) }))
    .filter(({ s }) => !s || s.w !== 1280 || s.h !== 800);
  check(
    `スクリーンショット (${loc}) が 1280×800`,
    pngs.length >= 1 && pngs.length <= 5 && wrong.length === 0,
    wrong.length
      ? `不一致: ${wrong.map((x) => `${x.f} ${x.s?.w}×${x.s?.h}`).join(', ')}`
      : `${pngs.length} 枚すべて 1280×800`,
  );
}
// ルート直下に旧画像が残っていないこと (どれが提出物か曖昧になる)
const baseStray = existsSync(join(ROOT, 'docs', 'store-assets'))
  ? readdirSync(join(ROOT, 'docs', 'store-assets')).filter((f) => f.endsWith('.png'))
  : [];
check('store-assets のルートに旧画像が無い', baseStray.length === 0, baseStray.join(', ') || 'なし');

// ---- ⑦ 未 push (PRIVACY.md を Pages で公開する前提) ------------------------
let unpushed = null;
try {
  unpushed = Number(sh('git log --oneline origin/main..HEAD | wc -l'));
} catch {
  unpushed = null;
}
check(
  '未 push のコミットが無い (Pages で公開するポリシーが最新になる)',
  unpushed === 0,
  unpushed === null ? 'origin/main を解決できない' : `${unpushed} コミット`,
);

// ---- 出力 ------------------------------------------------------------------
const pad = Math.max(...rows.map((r) => [...r.name].length)) + 2;
console.log('\nChrome Web Store 提出前チェック (実測)\n');
for (const r of rows) {
  const mark = r.ok ? (r.warn ? '△' : '✅') : '❌';
  console.log(`${mark} ${r.name.padEnd(pad, '　'.length ? ' ' : ' ')} ${r.detail}`);
}
const failed = rows.filter((r) => !r.ok);
const warned = rows.filter((r) => r.ok && r.warn);
console.log(
  `\n${rows.length - failed.length}/${rows.length} 項目 pass` +
    (warned.length ? ` (注意 ${warned.length} 件)` : ''),
);
if (failed.length) {
  console.log('\n提出できない項目:');
  for (const r of failed) console.log(`  ❌ ${r.name} — ${r.detail}`);
  console.log('\n手順は docs/store-submission-readiness.md');
  process.exit(1);
}
console.log('\n→ 実装・提出物の側は提出可能。残りは人間の操作 (docs/store-submission-readiness.md)');
