// トークン出典: akari-video-lp/index.html の :root（LP と同一の黒×オレンジ配色）。
// 値の正典は本ファイルの 2 表（内部 task 契約の表と同値で維持する）。
//
// DARK が LP 原本。LIGHT は同じ役割名へ明度階層を反転してマップした対パレット
// （2026-07-30 導入）。設定画面（akari-settings-widget）が「ダーク / ライト」を
// 正式に提供しているため、ライト側にも白×オレンジの実値を与える。
// accent 系は「背景から遠いほど強調」という役割で並んでいるので、ライトでは
// light/lighter が濃い方向（orange-600→800)へ反転する点に注意。
export const DARK = {
    bgDeep: '#050505',
    bg: '#0a0a0a',
    card: '#141414',
    elevated: '#1a1a1a',
    ink: '#e5e5e5',
    muted: '#a3a3a3',
    faint: '#737373',
    accent: '#f97316',
    accentLight: '#fb923c',
    accentLighter: '#fdba74',
    accentDark: '#ea580c',
    accentTint: '#26160c',
    accentTintDeep: '#150e08',
    border: '#262626',
    borderSubtle: '#1a1a1a'
};

export type AkariPalette = typeof DARK;

export const LIGHT: AkariPalette = {
    bgDeep: '#ececec',
    bg: '#ffffff',
    card: '#f5f5f5',
    elevated: '#e5e5e5',
    ink: '#171717',
    muted: '#525252',
    faint: '#737373',
    accent: '#ea580c',
    accentLight: '#c2410c',
    accentLighter: '#9a3412',
    accentDark: '#f97316',
    accentTint: '#ffedd5',
    accentTintDeep: '#fff7ed',
    border: '#d4d4d4',
    borderSubtle: '#e5e5e5'
};
