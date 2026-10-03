# Chrome Web Store 出展までの具体的ステップ

> DomDom Inspector を Chrome Web Store に **Public(一般公開)・全地域** で出展するための実手順。
> 手順の正本はリポジトリの [`PUBLISHING.md`](https://github.com/BoxPistols/domdom-inspector/blob/main/PUBLISHING.md) と
> [`docs/store-submission-readiness.md`](https://github.com/BoxPistols/domdom-inspector/blob/main/docs/store-submission-readiness.md)。
> このページはそれを「上から順に実行できる 1 本の流れ」にまとめたもの。

> 🔒 **このページに書かないもの(クローズ扱い)**
> デベロッパーアカウントのメールアドレス・支払い情報・API キー・トークン類などの
> 個人情報 / 認証情報は、wiki にもリポジトリにも**一切書かない**。
> 手順中でそれらが必要な箇所は「自分のアカウントで」とだけ書く。

---

## 全体像

```
0. 前提ゲートを全部 green にする(機械)
1. 成果物を作る(zip / スクリーンショット)→ check:submission で実測
2. 目視 QA(機械で測れない項目だけ)
3. デベロッパー登録(初回のみ・$5)
4. ダッシュボードに入力(転記元はすべてリポジトリ内のファイル)
5. 審査に送信 → 待つ(却下されたら直して再送信)
6. 公開後: README / Release / 周知
```

順序依存はひとつだけ: **main に push してから** プライバシーポリシーの公開 URL を確認すること
(GitHub Pages は main の内容を配信するため。古い内容のまま審査に出すと申告と食い違う)。

---

## Step 0 — 前提ゲート(機械確認)

提出作業に入る前に、ローカルで全部 green を確認する:

```sh
pnpm install
pnpm lint && pnpm test && pnpm typecheck && pnpm build   # コミット前ゲート
pnpm e2e                                                 # 実 Chromium に拡張をロード
```

- CI(GitHub Actions)も green であること
- 未 push のコミットが無いこと(`check:submission` が実測する)
- プライバシーポリシーが公開 URL で最新であること:
  <https://boxpistols.github.io/domdom-inspector/PRIVACY> を開き、
  リポジトリの `PRIVACY.md` と同じ内容(送信要求は「2 種類」の記述)かを目視

## Step 1 — 成果物を作って実測する

```sh
pnpm build && pnpm shots && pnpm zip   # ビルド / スクショ再生成 / 提出 zip
pnpm check:submission                  # 提出前チェックを実測(全 pass が条件)
```

- 提出物は **`.output/domdom-inspector-<version>-chrome.zip`**
- `.output/` には旧版の zip が残るので、**`check:submission` の出力で版数を確認してから選ぶ**
- スクリーンショットは `docs/store-assets/{en,ja}/` の各 4 枚(1280×800、実物から自動生成)
- 判定を文書の数字で信じない。**毎回スクリプトで測る**(数字は書いた瞬間に古くなる)

## Step 2 — 目視 QA(人間しか判定できない項目)

`docs/manual-verification-*.md`(最新日付のもの)の全項目。
機械で測れないものだけに絞ってある: エディタの scheme 起動 / closed shadow DOM /
blob: タブ / 右クリックメニューの実表示 / 実キーの Esc と iframe のフォーカス / 偽装への防御。

実機で確認する前に版数を上げてビルドし、`chrome://extensions` の拡張カードの**版数が
今の版になっている**ことを先に見る(古いビルドを見て「動かない」と誤報した実績がある)。

## Step 3 — デベロッパー登録(初回のみ)

<https://chrome.google.com/webstore/devconsole/>

- 登録料 **$5**(一回きり)
- 登録に使うアカウント・支払い方法は各自のもの(ここには書かない)
- 公開者のメールアドレスはストアに表示されうるので、**公開してよいアドレス**で登録し、
  メール確認(verify)まで済ませる

## Step 4 — ダッシュボードに入力(転記元マップ)

入力はすべてリポジトリ内のファイルからの転記。**その場で文章を書かない**
(4 文書 = `STORE_LISTING.md` / `PRIVACY.md` / `SECURITY.md` / `PUBLISHING.md` §4-2 が
同じことを言っている状態を保ってあり、ズレは審査で拾われる)。

| ダッシュボードの欄 | 転記元 |
|---|---|
| パッケージ(zip) | `.output/domdom-inspector-<version>-chrome.zip` |
| Summary / 詳細説明(en, ja) | `STORE_LISTING.md`(**英文が正**) |
| カテゴリ | Developer Tools |
| スクリーンショット | `docs/store-assets/en/` の 4 枚 |
| Single purpose | `STORE_LISTING.md` の **Single purpose**(英文をそのまま) |
| 権限の正当化 | `STORE_LISTING.md` の **Permission justification**(`storage` / `activeTab` / `scripting` / `contextMenus` / `sidePanel` + `optional_host_permissions`) |
| リモートコード | 「使用しない」 |
| Data usage | **全カテゴリ「収集しない」** + 3 誓約にチェック(詳細は `PUBLISHING.md` §4-2) |
| プライバシーポリシー URL | <https://boxpistols.github.io/domdom-inspector/PRIVACY> |
| Notes for reviewers | `PUBLISHING.md` **§5-0 の文面をそのまま**貼る |
| 公開範囲 / 地域 | **Public / 全地域** |

特に重要な 2 点:

1. **審査担当者向けメモ(Notes for reviewers)を空にしない。**
   この拡張は localhost 以外では既定で何も起きない(host 権限がユーザー明示許可制)。
   手順を書かないと審査官の手元で「動かない」と判定される。
2. **`*://*/*`(optional_host_permissions)の正当化が最も突かれやすい。**
   「既定では未付与・ユーザーが Enable を押した時のみ要求」を必ず書く
   (`SECURITY.md` の権限表に確定文言がある)。

## Step 5 — 送信 → 審査

1. 必須項目が全部埋まったら **「審査のために送信」**
2. 審査期間は数時間〜数日。**Public + 広い optional host 権限は 1〜2 週間かかることもある**。
   ステータスは devconsole に表示される
3. **却下されたら**: ダッシュボードに理由が出る。多いのは
   「権限の正当化不足」「プライバシー URL 不備」「説明と機能の不一致」。
   該当箇所を直して再送信すればよく、ペナルティは無い
4. **再提出は必ず版数を上げる**: CWS は同一バージョンの再アップロードを拒否する。
   `pnpm bump:patch` → `pnpm build && pnpm zip && pnpm check:submission` → アップロード
   (実績: v0.4.42 で提出 → v0.4.43 に上げて出し直し)

## Step 6 — 公開後にやること

1. **README(ja / en)にストアリンクを追加**(インストール節。ローカル zip の手順は「開発版」として残す)
2. **GitHub Release** を作成(タグ = 公開した版。zip を添付すると、ストアを使えない環境への配布経路になる)
3. この wiki の [Home](Home) のインストール導線をストア URL に差し替える
4. 周知(X / 記事 / コミュニティ)。文言のトーンは掲載文と同じ
   「誇張しない・競合を名指ししない・プライバシーは事実で言う」

## 更新のリリース(2 回目以降)

```sh
pnpm bump:patch          # CHANGELOG.md にも追記
pnpm build && pnpm zip
pnpm check:submission    # 全 pass を確認
```

ダッシュボードの当該アイテム → 新しいパッケージをアップロード → 送信。

⚠️ **送信経路やデータ利用が変わる機能(例: BYOK AI 監査の再導入)を載せる版**は、
先に `PRIVACY.md` / `STORE_LISTING.md` / `SECURITY.md` / `PUBLISHING.md` §4-2 の申告を
すべて更新し、独立したリリースとして審査に出す(Data usage の申告やり直しが必要)。

---

## 参照(手順の正本)

| ファイル | 役割 |
|---|---|
| [`PUBLISHING.md`](https://github.com/BoxPistols/domdom-inspector/blob/main/PUBLISHING.md) | 提出手順の詳細(§4-2 データ申告 / §5-0 審査員向けメモ) |
| [`STORE_LISTING.md`](https://github.com/BoxPistols/domdom-inspector/blob/main/STORE_LISTING.md) | ダッシュボードに貼る確定文言(英文が正) |
| [`docs/store-submission-readiness.md`](https://github.com/BoxPistols/domdom-inspector/blob/main/docs/store-submission-readiness.md) | 提出可否の判定書(数字は `pnpm check:submission` で毎回実測) |
| [`SECURITY.md`](https://github.com/BoxPistols/domdom-inspector/blob/main/SECURITY.md) | 権限の正当化と、grep で再現できる監査手順 |
| [`PRIVACY.md`](https://github.com/BoxPistols/domdom-inspector/blob/main/PRIVACY.md) | 公開プライバシーポリシー(GitHub Pages で配信) |
