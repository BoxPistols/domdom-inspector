---
title: "React の再レンダーを「正確に」計測する — DevTools と同じ判定基準を Chrome 拡張に実装した話"
emoji: "🔬"
type: "tech"
topics: ["react", "chrome拡張", "パフォーマンス", "devtools", "frontend"]
published: false
---

<!--
  Zenn ドラフト v1 (日本語ベース / 公開時に英語版を dev.to 等へ展開予定)
  想定読者: React でパフォーチューニングをしたことがある/したいフロントエンドエンジニア
  読了目安: 10分
-->

## TL;DR

- 「再レンダーがチカチカ光る」系のツールの多くは判定がヒューリスティックで、**過剰検出・検出漏れ**がある
- React DevTools が使っている判定基準は `fiber.flags & PerformedWork` — **これは production ビルドでも立つ**
- alternate(前コミットの Fiber)との差分走査で bailout サブツリーを丸ごとスキップすると、走査コストは「実際に変化した部分」に比例する
- hook 連結リストを alternate と並走比較すると「**どの useState が変わったから再レンダーしたのか**」まで特定できる
- これらを Chrome 拡張([DomDom Inspector](https://github.com/BoxPistols/domdom-inspector))で実装し、記録 → 原因分類 → AI に貼れる Markdown レポートまでを 1 フローにした
- **ただしこの機能は現在ストア版には入っていない**(v1 の配線から外し、出荷 JS からも除外した)。理由は最後に書く — 「正確に測れること」と「製品に載せるべきこと」は別だった

## モチベーション: 「光る」だけでは直せない

再レンダー可視化ツールを自作したことがある人は多いと思います。`onCommitFiberRoot` を購読してコミットごとにツリーを歩き、変わったっぽい要素をハイライトする——ここまでは簡単です。

問題はその先で、初期実装ではこんな判定をしていました:

```ts
// ❌ 初期実装: actualDuration の自己時間ヒューリスティック
const self = fiber.actualDuration - sumOfChildrenActualDuration;
const didRender = self > 0.01; // 0.01ms より大きければ「自分が描画した」
```

これには 3 つの問題があります。

1. **production では actualDuration が無い**(profiling ビルド限定)ので、そもそも判定できない
2. しきい値 0.01ms は環境依存。速いマシンでは検出漏れ、遅いマシンでは祖先の過剰検出が起きる
3. 「何回描画されたか」は分かっても「**なぜ**描画されたか」が分からないので、直すアクションに繋がらない

結果、「チカチカ光ってるなあ」で終わるツールになります。記録データも「回数が多い順のリスト」止まりで、チューニングの入力としては弱い。

## React DevTools は何を見ているのか

React DevTools のソース(`react-devtools-shared`)を読むと、`didFiberRender` はこうなっています(要旨):

```js
function didFiberRender(prevFiber, nextFiber) {
  switch (nextFiber.tag) {
    case FunctionComponent:
    case ClassComponent:
    case MemoComponent:
    case SimpleMemoComponent:
    case ForwardRef:
      // PerformedWork フラグ = render 関数が実際に走った印
      return (getFiberFlags(nextFiber) & PerformedWork) === PerformedWork;
    default:
      // ホスト要素などは props/state/ref の参照比較
      return (
        prevFiber.memoizedProps !== nextFiber.memoizedProps ||
        prevFiber.memoizedState !== nextFiber.memoizedState ||
        prevFiber.ref !== nextFiber.ref
      );
  }
}
```

ポイントは `PerformedWork`(値は `0b1`)です。react-reconciler の `beginWork` は、コンポーネントの render 関数を実際に実行したときにこのフラグを立てます。そして重要なのが:

> **`PerformedWork` は production ビルドでも立つ**

DevTools の "Highlight updates" が本番サイトでも動くのはこのためです。つまりヒューリスティック不要で、dev/production 共通の正確な一次情報がずっとそこにあったわけです。

```ts
// ✅ 現在の実装
const PERFORMED_WORK = 0b01;
const flags = fiber.flags ?? fiber.effectTag; // 旧 React は effectTag
const didRender = (flags & PERFORMED_WORK) === PERFORMED_WORK;
```

## 罠: stale フラグと bailout サブツリー

「全 Fiber を歩いて PerformedWork を見ればいい」と思うとハマります。React は再レンダーをスキップ(bailout)したサブツリーについて、**work-in-progress の複製すら作らず前コミットの Fiber オブジェクトをそのまま使い回す**からです。使い回された Fiber には**過去のコミットで立った PerformedWork が残っています**(stale フラグ)。

これも DevTools と同じ方法で解決できます。子ポインタの参照比較です:

```ts
const alt = fiber.alternate; // 前コミットの同じ位置の Fiber
if (fiber.child === alt?.child) {
  // 子が同一参照 = このサブツリーは複製すら作られていない = 何も起きていない
  // → 丸ごとスキップ (stale フラグを読まずに済む + 走査コスト削減)
}
```

副産物として、走査コストがツリー全体ではなく「実際に変化した部分」に比例するようになります。1,000 ノードのアプリでボタン 1 個の state が変わったコミットなら、歩くのはその周辺だけです。

もうひとつ実装して初めて気付いた罠が「**初回マウントの判定**」です。「root に alternate が無ければ初回」と思いきや、React は初回コミットでも work-in-progress 複製で HostRoot に alternate を作るので、この判定は常に false になります。正しくは:

```ts
// 初回コミットの alternate は「まだ子を持たない空だった元 root」
const isInitialMount = !alt || alt.child == null;
```

これを間違えると、ページを開いた瞬間に全画面がフラッシュする残念なツールになります(なりました)。

## why-did-render: hook 連結リストの並走比較

回数が正確に取れたら、次は「なぜ」です。再レンダーした Fiber と alternate を比較すると、原因を機械的に分類できます:

| 原因 | 判定 | 意味 |
|---|---|---|
| `mount` | alternate が無い | 初回。最適化対象外 |
| `state` | hook の memoizedState が変化 | 自分起点。state 設計の見直し対象 |
| `props` | props の**値**が変化(浅い比較) | 正当な再レンダー |
| `parent` | props の参照は変わったが**値は全部同じ** | **無駄レンダー = React.memo 候補** |
| `other` | props 参照も state も同一 | Context / forceUpdate など |

面白いのは `state` の特定です。関数コンポーネントの `fiber.memoizedState` は hook の連結リストで、**呼び出し順は Rules of Hooks により不変**です。つまり alternate 側のリストと並走して index を数えれば「何番目の hook が変わったか」まで分かります:

```ts
export function changedStateHookIndices(prevHook, nextHook): number[] {
  const changed: number[] = [];
  let p = prevHook, n = nextHook, index = 0;
  while (p && n) {
    // queue を持つ hook = useState/useReducer 系
    if (n.queue != null && !Object.is(p.memoizedState, n.memoizedState)) {
      changed.push(index);
    }
    p = p.next; n = n.next; index++;
  }
  return changed;
}
```

`parent`(無駄レンダー)の判定も浅い比較の応用です。親が再レンダーすると JSX が再評価されて props オブジェクトは**必ず新しい参照**になります。参照は変わったのに `Object.is` で全キー一致なら、それは「親に巻き込まれただけ」= memo で止められた再レンダーです。

これらは memoizedProps / memoizedState という **production でも剥がされないフィールド**しか使わないので、本番サイトでも原因分類が動きます。

## 検証: 実 React に対して答え合わせする

この手の実装は「もっともらしく動いているが実は違う」が一番怖いので、原因パターンを意図的に作ったテストアプリで E2E 検証しました:

```
App(useState×2: count, text)
 ├─ Value({count})        ← count 変化時だけ props
 ├─ Static({label:固定})   ← 毎回 parent(無駄)になるはず
 ├─ memo(MemoStatic)       ← 一切カウントされないはず
 └─ SlowList({rev:count})
     └─ SlowItem×20(各 0.3ms busy loop) ← 無駄レンダー × 自己時間の主犯
```

「6 回クリック + テキスト入力 1 回」の記録結果:

| Component | Renders | 原因内訳 | 直近変化 | 自己時間 |
|---|---|---|---|---|
| SlowItem | 140 | parent×140 | — | 48.8ms |
| App | 7 | state×7 | hooks: **#1** | 1.1ms |
| SlowList | 7 | **props×6 parent×1** | props: rev | 0.5ms |
| Value | 7 | **props×6 parent×1** | props: count | 0.1ms |
| Static | 7 | parent×7 | — | 0.2ms |

答え合わせポイント:

- `hooks: #1` — 最後の操作がテキスト入力なので、**第 2 hook(text)を正しく特定**
- `props×6 parent×1` — テキスト入力のコミットでは `count`/`rev` が変わらないので、その 1 回だけ parent に分類。**コミット単位で原因が正確**
- memo 済みコンポーネントは **0 回**(フラッシュもしない)
- 自己時間 48.8ms ≒ 0.3ms × 140 回の設計値どおり

production ビルド(react.production.min.js)でも回数・原因・無駄レンダーは同一の正確さでした。時間だけが取れないので、UI には「回数と原因は正確 / 時間は dev ビルドが必要」と明示しています。

## おまけ 1: Closed 環境の Web Vitals

社内アプリや認証の向こう側のページは Lighthouse や PageSpeed Insights にかけられないことが多いですが、`PerformanceObserver` は実ブラウザでそのまま動きます。`buffered: true` を付ければ observer 開始前(ページロード初期)のエントリも遡って取れるので、拡張の content script からでも LCP / CLS / INP / FCP / TTFB / Long Tasks が観測できます。

CLS だけは仕様どおり session window(直近入力 500ms 除外・間隔 1s / 全長 5s で窓を切る)を実装する必要がありますが、純関数 reducer にするとテストが楽です。

## おまけ 2: 計測の出口は「AI に貼れるレポート」

記録結果は最終的に Markdown レポートとしてクリップボードに出します。サマリ / vitals / 原因内訳付きランキング / memo 候補 / コミットタイムライン、そして最後に「AI に聞くべき 5 つの分析観点」を付けています。

チューニングは結局「どこから手を付けるか」の意思決定なので、生データではなく**そのまま AI との対話を始められる形**が出口として一番使われる、というのが設計判断です。ページ内容(テキストや入力値)は含めず、コンポーネント名と数値だけにしています。

## まとめ

- 再レンダー判定は自作ヒューリスティックではなく **`PerformedWork` フラグ**(DevTools と同じ・production でも動く)
- 走査は **alternate 差分**で bailout をスキップ(stale フラグ対策 + 変化量に比例するコスト)
- **初回マウント判定は `alternate.child == null`**(alternate の有無ではない)
- hook 連結リストの並走比較で「**どの useState のせいか**」まで特定できる
- 「参照は変わったが浅い比較で同値」= **React.memo で止められた無駄レンダー**の機械的検出

## 載せなかった話

ここまで書いておいて何ですが、**この機能はストアに出す版から外しました**。実装は
リポジトリに残していますが、v1 では配線を通しておらず、出荷される JS にも含まれていません
(ビルド後の JS を走査して 0 件であることを提出前チェックで毎回実測しています)。

外した理由は 3 つあります。

1. **production ビルドでは React がコンポーネント名を minify する。** 判定の正確さは
   production でも保てるのに、画面に並ぶのは `0e` `je` `Anonymous` です。数字が正しくても
   どのコンポーネントの話か分からない。実機で見て、これは原理的に読めないと判断しました。
2. **開発ビルドなら React DevTools Profiler の方が良い。** 名前も出るし履歴も追える。
   自作が勝てるのは「DevTools を入れられない/開けない環境」だけで、それは狭い。
3. **可視化の土俵には react-scan の拡張が既にいる。**

計測の正確さを詰める作業そのものは無駄ではなく、判定基準の理解は残りました。ただ
「正確に測れること」と「製品として載せるべきこと」は別の問いで、後者に答えるには
**誰がどの環境で読むのか**まで見る必要がある——というのが、この一連の作業で一番効いた学びです。

拡張自体は、要素にホバーしてデザイン値(色・余白・角丸・タイポグラフィ)を測り、
自分のデザイントークンと照合する方向へ絞りました。

リポジトリ: https://github.com/BoxPistols/domdom-inspector
<!-- TODO: Chrome Web Store 公開後にストアリンクを追記 -->

## 参考

- react-devtools-shared の `didFiberRender` / `updateFiberRecursively`
- web.dev — Core Web Vitals のしきい値と CLS session window の定義
- React reconciler の `beginWork` / `bailoutOnAlreadyFinishedWork`
