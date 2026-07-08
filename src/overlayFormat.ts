import type { Classification, Settings, UiStrings } from './types';

/** 再描画ヒートマップの色: 回数が多いほど青→緑→黄→赤。RGB 成分文字列を返す */
export function heatColor(heat: number): string {
  if (heat <= 1) return '96,165,250'; // 青
  if (heat <= 3) return '52,211,153'; // 緑
  if (heat <= 7) return '251,191,36'; // 黄
  return '248,113,113'; // 赤
}

/** 分類 (mui/custom/third-party) → 表示色。Settings.colors から解決。overlay と各ビルダーで共用 */
export function colorFor(classification: Classification, colors: Settings['colors']): string {
  return classification === 'mui'
    ? colors.mui
    : classification === 'custom'
      ? colors.custom
      : colors.thirdParty;
}

// DesignProp.label は内部 id (tokenLint の判定キー) のまま変えず、表示層でデザイナー向け名に解決する
const DESIGN_LABEL_KEYS: Record<string, keyof UiStrings | undefined> = {
  color: 'dsColor',
  bg: 'dsBg',
  font: 'dsFont',
  weight: 'dsWeight',
  lh: 'dsLineHeight',
  padding: 'dsPadding',
  margin: 'dsMargin',
  radius: 'dsRadius',
  shadow: 'dsShadow',
  gap: 'dsGap',
};

/** DesignProp.label (内部 id) → デザイナー向け表示名。未知 id はそのまま */
export function designLabel(label: string, strings: UiStrings): string {
  const key = DESIGN_LABEL_KEYS[label];
  return key ? strings[key] : label;
}

/**
 * badge の props 表示件数を情報量設定で決める純ロジック。
 * compact=表示なし / normal=先頭 4 件 / detailed=全件。
 */
export function visibleProps<T>(entries: T[], detail: 'compact' | 'normal' | 'detailed'): T[] {
  return detail === 'compact' ? [] : detail === 'detailed' ? entries : entries.slice(0, 4);
}
