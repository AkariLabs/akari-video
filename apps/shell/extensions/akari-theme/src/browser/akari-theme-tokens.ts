// トークン出典: akari-video-lp/index.html の :root（LP と同一の黒×オレンジ配色）。
// 値の正典は本ファイルの 2 表（内部 task 契約の表と同値で維持する）。
//
// DARK が LP 原本。LIGHT は同じ役割名へ明度階層を反転してマップした対パレット
// （2026-07-30 導入）。設定画面（akari-settings-widget）が「ダーク / ライト」を
// 正式に提供しているため、ライト側にも白×オレンジの実値を与える。
// accent 系は「背景から遠いほど強調」という役割で並んでいるので、ライトでは
// light/lighter が濃い方向（orange-600→800)へ反転する点に注意。
// ── 線の階層（2026-09-05 / 内部リポ akari-video-internal のカード意匠 spec §2 が正典）──
//
// spec の階層は 3 段:
//   カード外周      1px rgba(255,255,255,.13)  ← 最強。--akari-line（下の 2 値より必ず強い）
//   カード内の区切り 1px rgba(255,255,255,.07)  ← 外周の約半分 = lineInner
//   項目・チップ     原則 枠を持たない（背景 = raised で分ける）
//
// lineInner / lineOverlay を **不透明値**で持つ理由:
//   - rgba のままだと、下地が card 面（#0a0a0a）か raised 面（#141414）かで
//     実効の明るさが変わり（.07 白 → #1b1b1b / #242424）、raised の上では
//     カード外周の実効値（#050505 に .13 白 = #262626）とほぼ並んでしまう。
//     階層の逆転を「どの面の上でも」防ぐには不透明で固定するのが確実。
//   - 同じ理由で、実測（getComputedStyle の borderColor）が下地に依らず一意になる。
// 値は spec の rgba を各テーマのカード面の上で合成した等価値:
//   dark  : #0a0a0a に rgba(255,255,255,.07) → 10 + 245*.07 = 27.15 → #1b1b1b
//   light : #ffffff に rgba(0,0,0,.07)       → 255 * .93     = 237.2 → #ededed
//
// lineOverlay は「カードの中」ではなく **カードの上に浮くもの**（コンテキスト
// メニュー・hover ウィジェット・クイックオープン）の輪郭。カード外周と同じ
// 強さ（= 外周の実効値）を与え、地の上に浮いていることを見せる。
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
    lineInner: '#1b1b1b',
    lineOverlay: '#262626'
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
    lineInner: '#ededed',
    lineOverlay: '#cdcdcd'
};
