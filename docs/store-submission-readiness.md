# Chrome Web Store 提出可否 — 2026-08-06 実測

配信形態: **Public(一般公開)+ 全地域**。**対象版はここに書かない** — `pnpm check:submission` が
`package.json` と manifest と zip の一致を実測する (数字を書くと必ず古くなる)。

このファイルは「何が終わっていて、あと何をすれば送信できるか」を示す。
⬜ は人間の操作が必要。手順の詳細は [`PUBLISHING.md`](../PUBLISHING.md)。

## 数字は毎回測る — `pnpm check:submission`

```sh
pnpm build && pnpm shots && pnpm zip   # 成果物を作る
pnpm check:submission                   # 20 項目を実測して PASS/FAIL
```

**この文書に数字を書かない。** 実際に「対象版」と「未 push 件数」を書いた直後、自分の
コミットで両方古くなった (2 回)。
**古い判定書は旧 zip をアップロードする事故を生む**ので、判定は必ずスクリプトで測る。

スクリプトが測るもの: 版数の一致 (package.json ↔ manifest) / 提出 zip が今の版で存在 /
permissions と optional_host_permissions / minimum_chrome_version / default_locale /
commands / アイコン 5 サイズ / _locales / description と Summary の文字数 (上限 132) /
**送信 API の発生箇所が 0 件** / 成果物に外部エンドポイントが残っていない /
**スクリーンショットが 1280×800** (PNG ヘッダから実寸を読む) / 旧画像の残骸 /
**未 push のコミット**。

---

## 1. 実装・品質ゲート (機械確認済み)

| 項目 | 実測 |
|---|---|
| ✅ lint (ESLint: any / @ts-ignore / console.log / 境界契約) | pass |
| ✅ unit テスト | **295 passed** (26 files) |
| ✅ typecheck (`tsc --noEmit`) | pass |
| ✅ build | `.output/chrome-mv3` 147 kB |
| ✅ e2e (実 Chromium に拡張をロード) | **16 passed** |
| ✅ 提出 zip | 版数一致・危険物ゼロを `check:submission` が実測 |
| ✅ zip の危険物 (source map / .env / テスト / .DS_Store) | **0 件** |

## 2. manifest (ビルド成果物の実測)

| 項目 | 値 |
|---|---|
| ✅ version | `package.json` ↔ manifest ↔ zip の一致を実測 |
| ✅ permissions | `storage` / `activeTab` / `scripting` / `contextMenus` |
| ✅ optional_host_permissions | `*://*/*` (**既定では未付与**) |
| ✅ minimum_chrome_version | `119` (依存 API の下限の最大値 = `matchOriginAsFallback`) |
| ✅ default_locale | `en` |
| ✅ commands | `toggle-inspect` のみ (配線のあるものだけ) |
| ✅ アイコン | `16/32/48/96/128.png` すべて存在 |
| ✅ _locales | `en` / `ja` |

## 3. 掲載文・申告 (機械確認済み)

| 項目 | 実測 |
|---|---|
| ✅ Summary の文字数 (上限 132) | en **125** / ja **63** |
| ✅ manifest description (上限 132) | en **110** / ja **76** |
| ✅ 掲載文内の競合名・誇張表現 | **なし** (react-scan / React DevTools / best / 最高 / No.1 等を機械検索) |
| ✅ 単一目的の四者同一 | `STORE_LISTING.md` / `PUBLISHING.md` §4-2 / `PRIVACY.md` / `SECURITY.md` |
| ✅ Data usage 申告 | **全カテゴリ「収集しない」** |
| ✅ 送信経路 | **ゼロ** — `fetch`/XHR/WebSocket/beacon の発生箇所が 0 件 (grep で再現可能) |
| ✅ 永続化するもの | ユーザー設定のみ (ページ由来のデータなし) |
| ✅ v1 に無い機能の宣言 | **全廃** (ツリー / レンダー計測 / カバレッジ / AI / トークン貼り付け) |

## 4. スクリーンショット (自動生成済み)

| 項目 | 実測 |
|---|---|
| ✅ 1280×800 × 4 枚 × 2 言語 | `docs/store-assets/{en,ja}/` |
| ✅ 実物一致 | ビルド済み拡張が実 Chromium で描画したもの (`pnpm shots` で再生成) |

UI を変えたら **`pnpm shots` を回し直す**。popup の画像だけは自動生成に含めていない
(理由と手撮り手順は `PUBLISHING.md` §7)。

## 5. セキュリティ (機械確認済み)

| 項目 | 実測 |
|---|---|
| ✅ ネットワーク送信 API | 0 件 |
| ✅ 動的コード評価 / 外部 script 注入 | 0 件 |
| ✅ 認証情報の保存 | なし |
| ✅ ページからの postMessage 偽装 | 特権操作なし。エディタ起動は**信頼済み右クリック直後 (15 秒) に限定**し、合成イベントを無視 (e2e で偽装と本物の両方を固定) |

---

## 残っている作業 — この順序で行う

### ⬜ 手順 1: push する 【最優先・他の手順の前提】

**未 push のコミットがある。** 件数は数字を書かずに実測する (書くとすぐ古くなる):

```sh
git log --oneline origin/main..HEAD | wc -l   # 未 push の件数
git diff --stat origin/main..HEAD | tail -1   # 変更規模
git push origin main
```

**なぜ最優先か**: `PRIVACY.md` を GitHub Pages で公開すると、**GitHub 上の `main` の内容が
配信される**。push しないまま Pages を有効化すると、**AI デザイン監査の節が残った古い
ポリシー**が公開され、「Data usage = 収集しない」の申告と食い違う。これは審査で拾われる。

push すると CI も走る (現在の CI 最終実行はこのセッション前のコミット)。

### ⬜ 手順 2: `PRIVACY.md` を公開 URL でホスト

GitHub → Settings → Pages → Source を `Deploy from a branch` / `main` / `/ (root)` で有効化。
数十秒後に `https://<user>.github.io/domdom-inspector/PRIVACY` で公開される。
**公開後、その URL を開いて「AI」の語が無いことを目視で確認する** (push 漏れの検知)。

### ⬜ 手順 3: デベロッパー登録($5・初回のみ)

https://chrome.google.com/webstore/devconsole/

### ⬜ 手順 4: ③目視 QA

[`manual-verification-20260806.md`](./manual-verification-20260806.md) の **25 項目**。
機械で検証できないものだけに絞ってある (scheme 起動・closed shadow DOM・blob タブ・
右クリックメニューの実表示・偽装への防御)。

### ⬜ 手順 5: アップロードと入力

1. `.output/domdom-inspector-<version>-chrome.zip` をアップロード
   (**版数は `pnpm check:submission` の出力で確認する**)
   (`.output/` には旧版の zip も残っているので**版数を確認して選ぶ**)
2. 掲載情報 = `STORE_LISTING.md` から転記 (英文が正)
3. スクリーンショット = `docs/store-assets/en/` の 4 枚
4. プライバシー慣行 = `PUBLISHING.md` §4-2 のとおり (全カテゴリ「収集しない」)
5. 公開範囲 = **Public** / 配布地域 = **全地域**
6. 審査担当者向けメモ = `PUBLISHING.md` §5-0 の文面をそのまま貼る

### ⬜ 手順 6: 送信

---

## 判定

**実装・提出物・申告の側は提出可能な状態にある。** 残るのは push と、アカウント登録・
ポリシーのホスト・目視 QA・ダッシュボードへの入力という**人間の操作だけ**。

唯一の順序依存は **手順 1 (push) → 手順 2 (Pages)**。ここを逆にすると古いポリシーが
公開される。
