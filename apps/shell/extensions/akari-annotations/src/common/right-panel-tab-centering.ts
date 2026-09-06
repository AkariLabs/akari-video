// browser/right-panel-tab-style.ts の縦アイコンバー中央寄せ計算（task.md 指示2）を DOM から
// 切り離した純粋関数。node --test（jsdom 無し）で検証できるよう、他の common/ 配下のモジュール
// と同じ流儀で分離している。

/** 既存アイコン群の直下からの最低ギャップ（この距離より上には寄せない）。 */
export const MIN_GAP_ABOVE_PX = 32;
/** 後続タブ（インスペクター等）1 枚分の見込み高さ。余白 8px は計算時に加える。 */
export const FALLBACK_TAB_HEIGHT_PX = 48;
export const RESERVED_BELOW_PX = FALLBACK_TAB_HEIGHT_PX;

export interface ReviewTabMarginInput {
    /** 縦アイコンバー（tabBar）の実測高さ。 */
    barHeight: number;
    /** 対象タブより上に積まれている既存タブの高さ合計（margin 適用前の自然な積み上げ）。 */
    heightAbove: number;
    /** 対象タブ自身の高さ。 */
    tabHeight: number;
    /** 後続タブの実測高さ合計。省略時は従来の 1 枚分を確保する。 */
    reservedBelow?: number;
}

/**
 * 対象タブの上端がバー高の中央に来る margin-top（px）を返す。
 * 上限（後続タブ分 + gap を確保）と下限（既存アイコン群から最低限離す）でクランプする —
 * 詳細は right-panel-tab-style.ts 冒頭のコメント参照。barHeight が 0 以下（未レイアウト）
 * のときは 0 を返す。
 */
export function computeReviewTabMarginTop(input: ReviewTabMarginInput): number {
    const { barHeight, heightAbove, tabHeight, reservedBelow = RESERVED_BELOW_PX } = input;
    if (barHeight <= 0) {
        return 0;
    }
    const idealTop = barHeight / 2 - tabHeight / 2;
    const minTop = heightAbove + MIN_GAP_ABOVE_PX;
    const maxTop = barHeight - reservedBelow - 8 - tabHeight;
    const clampedTop = maxTop >= minTop
        ? Math.min(Math.max(idealTop, minTop), maxTop)
        : minTop;
    return Math.max(0, Math.round(clampedTop - heightAbove));
}
