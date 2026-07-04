# Chrome Web Store 公開手順マニュアル — MUI Design Inspector

このプロジェクトを Chrome Web Store に **限定公開 (Unlisted)** で公開する手順書。
コマンド・値はこのリポジトリの実測に基づく。所要: 初回 60〜90 分 + 審査待ち 1〜数日。

- 配信形態: **Unlisted**(検索非掲載・リンク共有のみ)
- 対応言語: 英語 (既定) / 日本語(`_locales`)
- 掲載文の下書き: [`STORE_LISTING.md`](./STORE_LISTING.md)
- プライバシーポリシー本文: [`PRIVACY.md`](./PRIVACY.md)

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
