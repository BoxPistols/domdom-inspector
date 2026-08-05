# 配布マニュアル — DomDom Inspector

配布は 2 通り。用途で選ぶ。

| | A: ローカル zip 配布 | B: Chrome Web Store |
|---|---|---|
| 対象 | 社内・チーム・限定メンバー | 一般/広く共有 |
| 審査 | なし(即配布) | あり(数時間〜数日) |
| 準備 | `pnpm zip` のみ | 下記ブロッカーあり |
| 更新 | zip 再配布(各自再読込) | 再アップロード + 審査 |
| 現状 | **✅ 今すぐ可能** | **⚠ 未完(§B 参照)** |

セキュリティ説明が要る配布先には [`SECURITY.md`](./SECURITY.md) を添付する(監査エビデンス付き)。

---

## A. ローカル zip 配布(社内・限定メンバー)

審査不要。今すぐできる。

```sh
pnpm install
pnpm test && pnpm typecheck   # 全 green を確認
pnpm zip                      # → .output/domdom-inspector-<version>-chrome.zip
```

**メンバーへの案内(そのまま送れる):**
1. 配布された zip を任意の場所に**解凍**する
2. Chrome で `chrome://extensions` を開く
3. 右上「**デベロッパー モード**」を ON
4. 「**パッケージ化されていない拡張機能を読み込む**」→ 解凍したフォルダを選択
5. 任意のサイトで `Alt+Shift+I`(localhost は自動、その他はポップアップの
   「**現在のサイトで有効化**」→ 許可 → 使用可能)

> 注: Chrome は zip を直接読み込めない(要解凍)。`.crx` 署名配布は鍵管理が要るため、
> 社内なら「解凍 + パッケージ化されていない拡張機能を読み込む」が最も簡単。
> 更新時は新しい zip を配り、各自カードの 🔄 で再読み込み(または再読み込み)。

**IT/セキュリティ審査を求められたら**: `SECURITY.md` を提示。「送信・保存・外部コード実行
なし」を grep で再現証明できる。

---

## B. Chrome Web Store 公開(Unlisted)

**限定公開 (Unlisted)** 想定。所要: 初回 60〜90 分 + 審査待ち。
掲載文 [`STORE_LISTING.md`](./STORE_LISTING.md) / プライバシー本文 [`PRIVACY.md`](./PRIVACY.md)。

**未完のブロッカー(submit 前に必須):**
1. プライバシーポリシーを**公開 URL でホスト**(本 repo は public のため GitHub Pages を
   有効化するだけで済む。§2 参照)
2. **スクリーンショット** 1280×800 を 1〜5 枚
3. デベロッパー登録($5)+ submit(手動操作)
4. **審査リスク: `*://*/*` 権限**の正当化 → 申請の権限説明に `SECURITY.md` の要旨を貼る
5. **審査担当者向けメモ(テスト手順)を必ず書く** — 審査官が任意の公開サイトで
   `Alt+Shift+I` を押しても、既定では何も起きない(localhost 以外は
   popup の「現在のサイトで有効化」が必要)。手順を書かないと「動かない」と判定される。
   §5-0 の文例をそのまま使う
6. 実機 QA(M1/M2/M3・一発ON の③目視)

> **v1 は「データを一切収集しない」拡張である。** BYOK AI 監査 (唯一の送信経路だった) を
> v1 の配線から外したため、`fetch` の発生箇所が 0 件になった。データ申告は §4-2 のとおり
> 全カテゴリ「収集しない」で出す (`STORE_LISTING.md` / `PRIVACY.md` / `SECURITY.md` と四者同一)。
> **再導入するときは申告を戻すこと**: https://github.com/BoxPistols/domdom-inspector/issues/11

---

## 0. 事前チェックリスト

公開作業に入る前に、ローカルで全て green を確認する。

```sh
pnpm install
pnpm lint        # ESLint (any / @ts-ignore / console.log / 境界契約)
pnpm test        # 277 tests (25 files) — 2026-08-06 時点
pnpm typecheck   # tsc --noEmit
pnpm build       # .output/chrome-mv3
```

- [ ] lint / test / typecheck / build が通る
- [ ] `public/icon/{16,32,48,96,128}.png` が存在する
- [ ] `public/_locales/{en,ja}/messages.json` が存在する
- [ ] 本番 manifest の permissions が `storage`/`activeTab`/`scripting`/`contextMenus` + `optional_host_permissions: *://*/*`(`.output/chrome-mv3/manifest.json` で確認。正当化は SECURITY.md)
- [ ] `minimum_chrome_version` が manifest に入っている(依存 API の下限。現在 119)
- [ ] `package.json` の `version` が公開したい版になっている(現行 `0.4.0`)

> バージョンは `package.json` の `version` が manifest に反映される。**更新のたびに必ず上げる**
> (CWS は同一バージョンの再アップロードを拒否する)。

---

## 1. 配布用 zip の作成

```sh
pnpm zip
```

生成物: **`.output/domdom-inspector-<version>-chrome.zip`**(例: `.output/domdom-inspector-0.1.0-chrome.zip`)。
これが CWS にアップロードするファイル。

> `pnpm zip` は内部で `pnpm build` 相当を実行してから固める。`.output/chrome-mv3/` を手動 zip
> しても良いが、`.output` などの余計なファイルを含めないため `pnpm zip` を使う。

---

## 2. プライバシーポリシーを公開 URL でホストする 【必須】

CWS はプライバシー慣行の申告にあたり、公開された URL を要求する。**本リポジトリは既に public
のため、`PRIVACY.md` を公開 URL にするのは GitHub Pages を有効化するだけで済む。**

**A. GitHub Pages(推奨 — 本文が repo と同期し、更新漏れが起きない)**
1. GitHub の repo → Settings → Pages → Source を `Deploy from a branch`、
   Branch を `main` / `/ (root)` にして有効化
2. 数十秒後、`PRIVACY.md` が `https://<user>.github.io/<repo>/PRIVACY` で公開される
   (Pages は `.md` を HTML に変換する)
3. その URL を控える(§4-2 のプライバシーポリシー URL 欄に入力)

**B. GitHub Gist(Pages を有効化したくない場合)**
1. https://gist.github.com/ を開く
2. ファイル名 `domdom-inspector-privacy.md`、本文に `PRIVACY.md` を貼り付け
3. 「Create public gist」→ 表示された URL を控える
   (※ repo 側の `PRIVACY.md` を更新したら Gist も手で更新すること)

> 参照用に GitHub の blob URL
> (`https://github.com/<user>/<repo>/blob/main/PRIVACY.md`)をそのまま使うことも可能だが、
> 審査では「プライバシーポリシー専用のページ」であることが明快な Pages URL が無難。

> Unlisted でもプライバシー申告は必須。URL は審査で参照される。

---

## 3. デベロッパー登録($5・初回のみ)

1. https://chrome.google.com/webstore/devconsole/ にアクセス(Google アカウントでログイン)
2. 初回は **一回限りの登録料 $5** を支払う
3. 開発者情報(公開連絡先メール等)を登録

---

## 4. 新規アイテムの作成とアップロード

1. デベロッパーダッシュボードで **「新しいアイテム」** をクリック
2. §1 の zip(`.output/domdom-inspector-<version>-chrome.zip`)をアップロード
3. アップロード後、各タブを埋める(次項)

### 4-1. ストアの掲載情報 (Store listing)

`STORE_LISTING.md` から転記する。

- **名前**: DomDom Inspector(manifest から自動でも可)
- **概要 (Summary)**: `STORE_LISTING.md` の Summary(132 文字以内)
- **説明 (Description)**: `STORE_LISTING.md` の Detailed description
- **カテゴリ**: Developer Tools
- **言語**: 既定 English(日本語対応は `_locales` により自動。掲載文の各言語版は任意で追加可)
- **アイコン**: 128×128 は zip 内 `icon/128.png` が使われる(別途アップロード不要な場合あり)
- **スクリーンショット**: **1280×800**(または 640×400)を 1〜5 枚 【必須・要撮影】
  - 推奨カット: ①インスペクト中のデザインバッジ ②トークン照合の注釈(一致名表示) ③野良値警告 ④設定ポップアップ(トークン貼り付け)
  - 撮り方は §7 参照

### 4-2. プライバシー (Privacy practices)

> **原則: この 3 ファイルは同じことを言っていなければならない** —
> 本書 §4-2(入力手順)/ `STORE_LISTING.md`(確定文言)/ `PRIVACY.md`(公開ポリシー本文)。
> 審査官はフォームの申告とポリシー本文を突き合わせる。片方だけ直さないこと。

- **単一目的の説明 (Single purpose)**: `STORE_LISTING.md` の **Single purpose** を
  そのまま貼る(英文が正)。要旨:
  「web ページ UI のデザイン値を計測し、ユーザー自身のデザインシステムと照合する —
  ページ要素の色/余白/角丸/タイポグラフィを読み取り、ユーザーのデザイントークンと
  要素単位およびページ全体の集計で突合する。」
  - **v1 の搭載機能はすべてこの 1 目的に奉仕する**ことを示す: MUI テーマ自動取得は
    貼り付け無しで照合辞書を作るため / 右クリックメニューとエディタジャンプは計測中の要素と
    そのソースへ到達するため。
  - コンポーネントツリーとレンダープロファイリングは **v1 の配線から外してある**ので
    申告に含めない(実装は温存しているが到達不能)。再配線するなら、この単一目的も
    同時に広げ直すこと (2026-08-01 施行の新ポリシー: 収集データは開示済み単一目的に
    厳密に必要な範囲のみ)
- **権限の正当化 (Permission justification)** — SECURITY.md の 4 権限表を転記:
  - `storage`: ユーザー設定・貼り付けたデザイントークンのローカル保存
  - `activeTab`: ポップアップから現タブ origin の取得
  - `scripting`: ユーザーが有効化したオリジンへのインスペクタ動的注入
  - `contextMenus`: 右クリックに「この要素を検査 / ソースをエディタで開く」を追加
    (ページへのアクセス権限は増えない。メニューは実際に動作する範囲にのみ表示)
  - `optional_host_permissions` (`*://*/*`): デプロイ済みサイト検査用。既定未付与、ユーザーが
    「有効化」した時のみ要求(localhost は静的コンテンツスクリプトで対応)
- **リモートコード**: 「使用しない」を選択(動的コード取得なし。そもそも
  ネットワークリクエストを 1 つも発行しない)
- **データ利用 (Data usage)** — **全カテゴリを「収集しない」**で申告する。
  v1 は外部送信を持たない (`fetch`/XHR/WebSocket/beacon の発生箇所が 0 件。
  `SECURITY.md` の grep 手順で再現証明できる)。保存するのは利用者の設定と、利用者が
  貼り付けたデザイントークン JSON のみ (端末内)。
  - ☐ website content / PII / authentication information / 健康 / 金融・決済 /
    個人的通信 / 位置情報 / ウェブ履歴 / ユーザー行動 — **すべて未チェック**
  - 「第三者への販売なし」「無関係な用途に使わない」「信用調査に使わない」すべてにチェック
  - ⚠ **AI 監査を再導入する版では、この申告を Website content = YES /
    Authentication information = YES に戻すこと** (虚偽申告になる)
  - **プライバシーポリシー URL**: §2 で用意した URL を入力(本文 = `PRIVACY.md`。
    上記 2 カテゴリの申告と本文が一致していることを送信前に目視確認する)

### 4-3. 公開設定 (Distribution)

- **公開範囲**: **Unlisted(限定公開)** を選択
- 対象地域: 全地域(任意)

---

## 5. 送信して審査へ

### 5-0. 審査担当者向けメモ(「Notes for reviewers」欄)【必須】

本拡張は **localhost 以外では既定で何も起きない**(host 権限がユーザー明示許可制のため)。
手順を書かないと審査官の手元で「動かない」と判定される。次の文面をそのまま貼る:

```
How to test:
1. Install and open any public website.
2. Click the extension icon, then press "Enable on current site" and accept the
   permission prompt. (Host access is opt-in by design; without this step the
   extension intentionally does nothing on that site.)
3. In the popup, press "Toggle inspect mode" (or Alt+Shift+I), then hover any
   element — a badge shows its measured design values. Press Esc to exit.
4. Or right-click any element and choose "Inspect this element" — same result
   without the keyboard.
5. Optional: paste any design-token JSON in the popup to see values annotated
   with token names, then press "Measure this screen" for page-wide totals.
6. "Open this element's source in my editor" (right-click, or Cmd/Ctrl+Click
   while inspecting) needs a React development build. On production builds the
   extension says why instead of doing nothing.
Note: localhost / 127.0.0.1 works without step 2 (static content script).
```

### 5-1. 送信

1. すべての必須項目が緑になったら **「審査のために送信」**
2. 審査は通常 数時間〜数日。Unlisted / 権限が最小のため比較的短い傾向
3. 承認後、Unlisted アイテムの **共有リンク**が発行される。これをチーム内に配布すると
   ストア経由でインストール・自動更新される

> 却下された場合はダッシュボードに理由が表示される。多くは「権限の正当化不足」「プライバシー
> URL 不備」「説明と機能の不一致」。該当箇所を直して再送信する。

---

## 6. 更新のリリース手順(2 回目以降)

1. `package.json` の `version` を上げる(例 `0.1.0` → `0.1.1`)
2. `pnpm zip` で新しい zip を生成
3. ダッシュボードの当該アイテム → 新しいパッケージをアップロード → 送信
4. **データ送信を伴う機能を追加する版** (BYOK AI 監査の再導入等) は、§4-2 のデータ申告と
   `PRIVACY.md` / `STORE_LISTING.md` / `SECURITY.md` を先に更新し、独立したリリースとして
   審査に出す(送信経路の新設・送信内容の拡大は申告のやり直しが必要)

> 段階的ロールアウト(パーセンテージ公開)を使うと、更新の影響範囲を絞れる。

---

## 7. スクリーンショットの撮り方(補助)

デザイン計測はどのサイトでも動くため、見栄えの良い実アプリ(自作の MUI/Tailwind アプリ等)で
撮るのが手軽。トークン照合のカットは Figma トークン JSON を貼り付けた状態で撮る。

1. 撮影対象のアプリを開く(localhost 推奨。デプロイ済みサイトなら「現在のサイトで有効化」)
2. `pnpm build` 済みの `.output/chrome-mv3` を `chrome://extensions`(デベロッパーモード)で読み込む
3. popup にトークン JSON を貼り付け → `Alt+Shift+I` でインスペクトし、バッジの一致名/野良値を出す
4. 各機能の状態で OS のスクショを撮り、**1280×800** にトリミング/リサイズ
   - macOS: `Cmd+Shift+4` で範囲選択。サイズ調整は「プレビュー」→ ツール → サイズを調整
5. 4 枚を目安に用意

> 撮影用に web-ext 自動起動を避けたい場合は、上記の「手動読み込み」方式が確実
> (WXT の `pnpm dev` は使い捨てプロファイルで別ウィンドウを開くため、実アプリのタブが無い)。

---

## 付録: 提出物の対応表

| CWS の入力欄 | このリポジトリの出典 |
|--------------|---------------------|
| パッケージ (zip) | `pnpm zip` → `.output/domdom-inspector-<version>-chrome.zip` |
| 概要 / 説明 | `STORE_LISTING.md` |
| 単一目的 / 権限正当化 / データ申告 | `STORE_LISTING.md`(Privacy 節)+ 本書 §4-2 |
| プライバシーポリシー URL | §2 でホストした URL(本文は `PRIVACY.md`) |
| 審査担当者向けメモ (Notes for reviewers) | 本書 §5-0 の文面 |
| アイコン 128px | `public/icon/128.png` |
| スクリーンショット | §7 で撮影(未作成) |
