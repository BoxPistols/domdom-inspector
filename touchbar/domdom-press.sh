#!/bin/bash
# Touch Bar のボタンを押すたびに BTT から 137 (ターミナルコマンドを実行) で呼ばれる。
#
#   domdom-press.sh root | esc | prefs
#
# **なぜ 264 (キー送信) を直接ボタンに付けないのか。**
# 表示判定はポーリングなので最大 1 ティックぶん古い。判定と指が降りる瞬間の間に
# フロントが変わると、キーが別アプリに着弾する (1.5 秒間隔で 2 回叩いて 2 個目が
# 別アプリに着弾する事象を実測済み)。送る直前にここで front を引き直して塞ぐ。
#
# キー送信そのものは **BTT に投げ返す** (trigger_action)。System Events 経由だと
# 呼び出し元プロセスに Accessibility 権限が要るが、BTT 経由なら BTT の権限で
# 送られるので追加の許可が要らない。
set -u
BASE="$HOME/.claude/btt"
STATE="$BASE/domdom.expanded"
TRACE="$BASE/domdom.trace"
KEYS="$BASE/domdom.keys"     # install.mjs が Chrome の実バインドから書く
WANT="com.google.chrome"
ROLE="${1:-root}"

# BTT はスクリプトの stdout を捨てる。トレースが無いと「実行されていない」と
# 「実行されたが送信を見送った」が、どちらも同じ『何も起きない』に見える
log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >> "$TRACE"; }

# 押下は人間の速度なので、ここで多少コストをかけてよい
if [ -f "$TRACE" ] && [ "$(wc -c < "$TRACE")" -gt 65536 ]; then
  tail -n 200 "$TRACE" > "$TRACE.tmp" && mv "$TRACE.tmp" "$TRACE"
fi

shopt -s nocasematch
front=$(lsappinfo info -only bundleID "$(lsappinfo front)" 2>/dev/null)
if [[ "$front" != *"$WANT"* ]]; then
  log "skip [$ROLE] front=$front want=$WANT"
  exit 0
fi

case "$ROLE" in root|esc|prefs) ;; *) log "skip [$ROLE] unknown role"; exit 0 ;; esac

# **キーをここに直書きしない。** 拡張のショートカットは chrome://extensions/shortcuts で
# ユーザーが変えられるので、直書きすると「押せるのに誰も聞いていないキーを送る」= 黙って
# 無反応になる (2026-08-15 に実際に発生。⌃I/⌃D を送っていたが実バインドは ⌥I/⌥D だった)。
# install.mjs が Chrome の Preferences から実バインドを読んで $KEYS に書く。
# パイプではなくリダイレクトなのでサブシェルにならず、keys がこのシェルに残る
keys=""
if [ -f "$KEYS" ]; then
  while IFS='=' read -r k v; do
    [ "$k" = "$ROLE" ] && keys="$v"
  done < "$KEYS"
fi
if [ -z "$keys" ]; then
  # 無反応で終わらせない。何が足りないかをトレースに残す
  log "no-key [$ROLE] $KEYS に定義が無い (node touchbar/install.mjs を流し直す)"
  exit 0
fi

case "$ROLE" in
  # 拡張側の toggle-inspect はトグル。Touch Bar の展開/畳みも同じ 1 押しで反転させる
  root) if [ -s "$STATE" ]; then : > "$STATE"; else printf 'on' > "$STATE"; fi ;;
  esc)  : > "$STATE" ;;
  # 設定 (popup) は Chrome が前面のまま。展開状態は触らない
esac

/usr/bin/osascript -e 'on run argv
tell application "BetterTouchTool" to trigger_action (item 1 of argv)
end run' "{\"BTTPredefinedActionType\":264,\"BTTShortcutToSend\":\"$keys\"}" >/dev/null 2>&1
rc=$?

if [ -s "$STATE" ]; then st=on; else st=off; fi
log "sent [$ROLE] keys=$keys rc=$rc expanded=$st"

# **`refresh_widget` は使わない。** 押下直後に展開を反映させるために入れていたが、
# 実測で何もしていなかった (実 UUID に 20 回投げてもウィジェットのスクリプト実行回数が
# 他と同じ = 1 回も再実行されていない)。呼ぶだけ osascript 起動ぶん (約 60ms) 遅くなり、
# 「効いているつもりの行」が残ると次に読む人を誤らせる。
# 反映は esc / prefs の更新間隔 (0.3 秒) に任せる
exit 0
