#!/bin/bash
# BTT の Shell Script Widget から BTTTouchBarScriptUpdateInterval 秒ごとに **source** される。
#
#   . "$HOME/.claude/btt/domdom-widget.sh" root | esc | prefs
#
# source なのは、`/bin/bash domdom-widget.sh` だと bash が 2 プロセスになるため
# (macenv の cc-widget.sh が実測 3.7ms → 7.0ms の倍増を確認している)。末尾の
# exit 0 は呼び出し元シェルをそのまま終わらせるためのもので、意図的。
#
# BTT への出力契約:
#   {"text":…,"background_color":"r,g,b,a","font_color":"r,g,b,a","hidden":bool}
#
# 常駐するのは root 1 個だけ。root を押すと $STATE に印が付き、esc / prefs が
# 現れる (展開)。畳んだ状態では Touch Bar の占有が 1 個ぶんで済む。
#
# **lsappinfo を呼ぶのは root だけ。** esc / prefs は $STATE を読むだけで、
# 使うのは bash の組み込み (read / test / printf) に限る。3 個とも front を
# 引くと 16ms × 3 が毎ティック走る。**重い処理をここに足さないこと。**
BASE="$HOME/.claude/btt"
STATE="$BASE/domdom.expanded"   # 展開中の印 (要素検査 を押すと立つ)
FRONT="$BASE/domdom.front"      # Chrome が最前面かの印。root だけが書く
WANT="com.google.chrome"
HIDDEN='{"text":"","hidden":true}'

# ラベルは install.mjs が labels.json からロケール別に選んで書き出す。
# **ここに直書きしない** (日本語決め打ちだと英語環境で読めない)。
# 書式は `role=ラベル` の 3 行。読み込みはリダイレクトなのでサブシェルにならない
L_ROOT=""; L_ESC=""; L_PREFS=""
if [ -f "$BASE/domdom.labels" ]; then
  while IFS='=' read -r k v; do
    case "$k" in root) L_ROOT="$v" ;; esc) L_ESC="$v" ;; prefs) L_PREFS="$v" ;; esac
  done < "$BASE/domdom.labels"
fi

# 診断用の心拍。`touch ~/.claude/btt/domdom.debug` で有効になる。
# 「BTT が hidden を返したウィジェットを回し続けるか」を実測するために要る
# (回していないなら、一度隠れたボタンは二度と戻らない = 設計が成立しない)。
# 平常時のコストは組み込みの [ -f ] 1 回だけ
[ -f "$BASE/domdom.debug" ] && printf '%s %s\n' "$(date '+%T')" "${1:-root}" >> "$BASE/domdom.beat"

case "${1:-root}" in
  root)
    shopt -s nocasematch
    b=$(lsappinfo info -only bundleID "$(lsappinfo front)" 2>/dev/null)
    if [[ "$b" != *"$WANT"* ]]; then
      # Chrome を離れたら展開印を落とす。右クリックメニューやキーボードで
      # インスペクトを抜けたときに印だけ残る (drift) のを、ここで必ず回収する。
      # BTT は拡張の ON/OFF を知れないので、drift の回収点はここしかない。
      # 空でないときだけ書く (毎ティック書くと無意味な I/O になる)
      [ -s "$STATE" ] && : > "$STATE"
      [ -s "$FRONT" ] && : > "$FRONT"
      printf '%s' "$HIDDEN"
    else
      # 他の 2 つに front を伝える。lsappinfo を 3 個とも呼ぶと 25.8ms × 3 が
      # 毎ティック走るので、front を引くのは root だけにして印で共有する
      [ -s "$FRONT" ] || printf '1' > "$FRONT"
      # **ラベルが取れないときは隠す。** 空文字で表示すると、Touch Bar には
      # 押せるのに何のボタンか分からない空の箱が出る (実機で 2 度発生させた)。
      # 設定漏れは「見えない」で表明する方がまだ読める
      if [ -z "$L_ROOT" ]; then printf '%s' "$HIDDEN"; else
        printf '{"text":"%s","background_color":"22,104,212,255","font_color":"255,255,255,255","hidden":false}' "$L_ROOT"
      fi
    fi
    ;;
  esc|prefs)
    # read の戻り値は見ない (改行で終わらないファイルでも変数には入っている)。
    # 中身が空かどうかだけで判定する
    f=""
    IFS= read -r f 2>/dev/null < "$FRONT"
    if [ -z "$f" ]; then
      printf '%s' "$HIDDEN"
    elif [ "$1" = "prefs" ]; then
      # 設定は常設。許可していないサイトでは 要素検査 が無反応になるので、
      # 「押して無反応を見る前に」設定へ行けるようにしておく必要がある
      if [ -z "$L_PREFS" ]; then printf '%s' "$HIDDEN"; else
        printf '{"text":"%s","background_color":"74,81,99,255","font_color":"255,255,255,255","hidden":false}' "$L_PREFS"
      fi
    else
      m=""
      IFS= read -r m 2>/dev/null < "$STATE"
      if [ -z "$m" ] || [ -z "$L_ESC" ]; then
        printf '%s' "$HIDDEN"
      else
        printf '{"text":"%s","background_color":"74,81,99,255","font_color":"255,255,255,255","hidden":false}' "$L_ESC"
      fi
    fi
    ;;
  *)
    printf '%s' "$HIDDEN"
    ;;
esac
exit 0
