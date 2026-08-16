/**
 * 再描画ヒートマップの色。**温存実装 (render プロファイリング) 専用**。
 *
 * 元は overlayFormat.ts にあったが、v1 の配線から外れているのに出荷 bundle へ
 * 残っていた (issue #17)。overlayFormat は design 経路の共有モジュールなので、
 * ここに置いて「render サーフェスを import した時だけ載る」状態にする。
 */

/** 回数が多いほど青→緑→黄→赤。canvas の rgba() に埋める RGB 成分文字列を返す */
export function heatColor(heat: number): string {
  if (heat <= 1) return '96,165,250'; // 青
  if (heat <= 3) return '52,211,153'; // 緑
  if (heat <= 7) return '251,191,36'; // 黄
  return '248,113,113'; // 赤
}
