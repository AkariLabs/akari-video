/**
 * 警告バナーの表示状態（× で閉じられる帯の頭脳）。
 *
 * DOM から切り離してあるのは、「× を押した後に再描画で復活しない」規則を
 * テストで縛るため。描画側は akari-annotations/src/browser/akari-notice-banner.ts。
 *
 * 規則:
 * - 文言が空なら出さない
 * - × で閉じた文言と同じものは、閉じた記憶が残っているあいだ出さない
 *   （showWarnings() は再描画のたびに同じ文言で呼ばれるため、記憶が無いと
 *     閉じた瞬間に復活して × が無意味になる）
 * - 文言が変われば別の警告なので出す
 * - clear()（＝警告が解消した）で記憶ごとリセットする。次に同じ文言が
 *   起きたときは、それは新しい警告なので改めて出す
 */
export interface NoticeBannerState {
    /** 現在設定されている文言（× で閉じても残る）。 */
    readonly message: string;
    /** × で閉じたときの文言。未操作なら undefined。 */
    readonly dismissed: string | undefined;
}

export const EMPTY_NOTICE_BANNER_STATE: NoticeBannerState = { message: '', dismissed: undefined };

/** 文言を設定する。 */
export function setNoticeMessage(state: NoticeBannerState, message: string): NoticeBannerState {
    return { message, dismissed: state.dismissed };
}

/** × を押した状態にする。文言が無いときは何も起きない。 */
export function dismissNotice(state: NoticeBannerState): NoticeBannerState {
    return state.message === '' ? state : { message: state.message, dismissed: state.message };
}

/** 警告が解消した状態にする（閉じた記憶も捨てる）。 */
export function clearNotice(): NoticeBannerState {
    return EMPTY_NOTICE_BANNER_STATE;
}

/** 帯を描くべきか。 */
export function isNoticeVisible(state: NoticeBannerState): boolean {
    return state.message !== '' && state.message !== state.dismissed;
}

/** 文言が設定されているか（× で閉じた後も true）。既存通知の上書き防止に使う。 */
export function hasNoticeMessage(state: NoticeBannerState): boolean {
    return state.message !== '';
}
