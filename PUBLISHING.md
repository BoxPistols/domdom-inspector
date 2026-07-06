# 配布マニュアル — MUI Design Inspector

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
pnpm zip                      # → .output/mui-inspector-<version>-chrome.zip
```

**メンバーへの案内(そのまま送れる):**
1. 配布された zip を任意の場所に**解凍**する
2. Chrome で `chrome://extensions` を開く
3. 右上「**デベロッパー モード**」を ON
4. 「**パッケージ化されていない拡張機能を読み込む**」→ 解凍したフォルダを選択
5. localhost の React アプリで `Alt+Shift+I`。デプロイ済みサイトはポップアップの
   「**現在のサイトで有効化**」→ 許可 → 使用可能

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
1. プライバシーポリシーを**公開 URL でホスト**(Gist/Pages)
2. **スクリーンショット** 1280×800 を 1〜5 枚
3. デベロッパー登録($5)+ submit(手動操作)
4. **審査リスク: `*://*/*` 権限**の正当化 → 申請の権限説明に `SECURITY.md` の要旨を貼る
5. 実機 QA(M1/M2/M3・一発ON の③目視)

---

## 0. 事前チェックリスト

公開作業に入る前に、ローカルで全て green を確認する。

```sh
pnpm install
pnpm test        # 46 tests
pnpm typecheck   # tsc --noEmit
pnpm build       # .output/chrome-mv3
```

- [ ] test / typecheck / build が通る
- [ ] `public/icon/{16,32,48,96,128}.png` が存在する
- [ ] `public/_locales/{en,ja}/messages.json` が存在する
- [ ] 本番 manifest の permissions が `storage` のみ(`.output/chrome-mv3/manifest.json` で確認)
- [ ] `package.json` の `version` が公開したい版になっている(初回は `0.1.0`)

> バージョンは `package.json` の `version` が manifest に反映される。**更新のたびに必ず上げる**
> (CWS は同一バージョンの再アップロードを拒否する)。

---

## 1. 配布用 zip の作成

```sh
pnpm zip
```

生成物: **`.output/mui-inspector-<version>-chrome.zip`**(例: `.output/mui-inspector-0.1.0-chrome.zip`)。
これが CWS にアップロードするファイル。

> `pnpm zip` は内部で `pnpm build` 相当を実行してから固める。`.output/chrome-mv3/` を手動 zip
> しても良いが、`.output` などの余計なファイルを含めないため `pnpm zip` を使う。

---

## 2. プライバシーポリシーを公開 URL でホストする 【必須】

CWS はプライバシー慣行の申告にあたり、公開された URL を要求する。本リポジトリは private の
ため、`PRIVACY.md` の内容をどこか公開の場所に置く。いずれか一つ:

**A. GitHub Gist(最短・推奨)**
1. https://gist.github.com/ を開く
2. ファイル名 `mui-design-inspector-privacy.md`、本文に `PRIVACY.md` を貼り付け
3. 「Create public gist」→ 表示された URL を控える(この URL を §4 で使う)

**B. 公開リポジトリ + GitHub Pages**
1. 公開用の別 repo を作る、または本 repo を公開化(`gh repo edit --visibility public --accept-visibility-change-consequences`)
2. `PRIVACY.md` を配置、Pages を有効化
3. 公開 URL(例 `https://<user>.github.io/<repo>/PRIVACY`)を控える

> Unlisted でもプライバシー申告は必須。URL は審査で参照される。

---

## 3. デベロッパー登録($5・初回のみ)

1. https://chrome.google.com/webstore/devconsole/ にアクセス(Google アカウントでログイン)
2. 初回は **一回限りの登録料 $5** を支払う
3. 開発者情報(公開連絡先メール等)を登録

---

## 4. 新規アイテムの作成とアップロード

1. デベロッパーダッシュボードで **「新しいアイテム」** をクリック
2. §1 の zip(`.output/mui-inspector-<version>-chrome.zip`)をアップロード
3. アップロード後、各タブを埋める(次項)

### 4-1. ストアの掲載情報 (Store listing)

`STORE_LISTING.md` から転記する。

- **名前**: MUI Design Inspector(manifest から自動でも可)
- **概要 (Summary)**: `STORE_LISTING.md` の Summary(132 文字以内)
- **説明 (Description)**: `STORE_LISTING.md` の Detailed description
- **カテゴリ**: Developer Tools
- **言語**: 既定 English(日本語対応は `_locales` により自動。掲載文の各言語版は任意で追加可)
- **アイコン**: 128×128 は zip 内 `icon/128.png` が使われる(別途アップロード不要な場合あり)
- **スクリーンショット**: **1280×800**(または 640×400)を 1〜5 枚 【必須・要撮影】
  - 推奨カット: ①インスペクト中のバッジ ②owner ツリー ③レンダーヒートマップ ④記録ランキング ⑤設定ポップアップ
  - 撮り方は §7 参照

### 4-2. プライバシー (Privacy practices)

- **単一目的の説明 (Single purpose)**:
  「ローカル開発中の React + MUI の UI について、コンポーネントの識別・ソースへの誘導・
  再描画/パフォーマンスの可視化を行う開発者向け検査ツール。」
- **権限の正当化 (Permission justification)**:
  - `storage`: ユーザー設定(エディタ・パスマッピング等)のローカル保存
  - ホスト権限 `localhost` / `127.0.0.1`: ローカル開発サーバへのインスペクタ注入のみ
- **リモートコード**: 「使用しない」を選択(動的コード取得なし)
- **データ利用 (Data usage)**:
  - 収集するユーザーデータ: **なし**
  - 「第三者への販売なし」「無関係な用途に使わない」「信用調査に使わない」すべてにチェック
  - **プライバシーポリシー URL**: §2 で用意した URL を入力

### 4-3. 公開設定 (Distribution)

- **公開範囲**: **Unlisted(限定公開)** を選択
- 対象地域: 全地域(任意)

---

## 5. 送信して審査へ

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
4. データ送信を伴う機能(将来の BYOK AI 等)を追加する版は、プライバシー申告を更新して
   独立したリリースとして審査に出す

> 段階的ロールアウト(パーセンテージ公開)を使うと、更新の影響範囲を絞れる。

---

## 7. スクリーンショットの撮り方(補助)

拡張は localhost 開発ビルドでのみ動くため、実アプリで撮る。

1. 撮影対象の React + MUI アプリを dev で起動(例 `http://localhost:5173`)
2. `pnpm build` 済みの `.output/chrome-mv3` を `chrome://extensions`(デベロッパーモード)で読み込む
3. アプリを開き `Alt+Shift+I` でインスペクト、`Alt+Shift+R` でレンダー可視化
4. 各機能の状態で OS のスクショを撮り、**1280×800** にトリミング/リサイズ
   - macOS: `Cmd+Shift+4` で範囲選択。サイズ調整は「プレビュー」→ ツール → サイズを調整
5. 5 枚を目安に用意

> 撮影用に web-ext 自動起動を避けたい場合は、上記の「手動読み込み」方式が確実
> (WXT の `pnpm dev` は使い捨てプロファイルで別ウィンドウを開くため、実アプリのタブが無い)。

---

## 付録: 提出物の対応表

| CWS の入力欄 | このリポジトリの出典 |
|--------------|---------------------|
| パッケージ (zip) | `pnpm zip` → `.output/mui-inspector-<version>-chrome.zip` |
| 概要 / 説明 | `STORE_LISTING.md` |
| 単一目的 / 権限正当化 / データ申告 | `STORE_LISTING.md`(Privacy 節)+ 本書 §4-2 |
| プライバシーポリシー URL | §2 でホストした URL(本文は `PRIVACY.md`) |
| アイコン 128px | `public/icon/128.png` |
| スクリーンショット | §7 で撮影(未作成) |
