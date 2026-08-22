/**
 * 警告バナー（タイムライン下・レビュー面・レビューボード・書き起こし面で共有）。
 *
 * Theia の `warningForeground` は既定値が `inputValidation.warningBackground`
 * そのもの（common-frontend-contribution の defaults がその ID を指している）で、
 * 実値は dark `#352A05` / light `#F6F5D2`。つまり
 * 「color: warningForeground + background: inputValidation.warningBackground」
 * と書くと文字色と背景色が完全に同一になり、黄色い帯だけが見えて本文が読めない。
 * ここでは背景と対になる前景を明示し、× で閉じられる作りにまとめる。
 * 表示するか否かの規則（× を押した後に復活しない等）は
 * ../common/notice-banner-state.ts が正典で、ここはその描画係。
 *
 * 前景に使うのは `foreground`（Theia 既定 dark `#CCCCCC` / light `#616161`）。
 * `inputValidation.warningForeground` は Theia 既定が null で CSS 変数が出ない
 * ことがあるため当てにしない。帯の背景に対するコントラストは dark 約 9:1 /
 * light 約 5.6:1 で、どちらのテーマでも本文が読める。
 */

import {
    clearNotice,
    dismissNotice,
    EMPTY_NOTICE_BANNER_STATE,
    hasNoticeMessage,
    isNoticeVisible,
    NoticeBannerState,
    setNoticeMessage
} from '../common/notice-banner-state';

/** 帯の背景。Theia 既定（dark #352A05 / light #F6F5D2）をそのまま使う。 */
export const AKARI_NOTICE_BACKGROUND = 'var(--theia-inputValidation-warningBackground, #352a05)';
/** 帯の下線。黄色の警告ラインで「これは警告」と伝える役。 */
export const AKARI_NOTICE_BORDER = 'var(--theia-inputValidation-warningBorder, #b89500)';
/** 帯の本文色。背景と対になる前景で、両テーマとも読める値。 */
export const AKARI_NOTICE_FOREGROUND = 'var(--theia-foreground, #e5e5e5)';

/**
 * 警告バナー本体でない場所（リスト行・補足行など通常の widget 背景の上）に
 * 置く警告文字の色。`warningForeground` は上記のとおり背景色なので使えない。
 * `list.warningForeground` は dark `#CCA700` / light `#855F00` で、
 * 黒背景・白背景のどちらでも 5:1 以上を確保できる。
 */
export const AKARI_WARNING_TEXT_COLOR = 'var(--theia-list-warningForeground, #cca700)';

export interface AkariNoticeBannerOptions {
    /** 帯のルート要素に付ける data 属性名（E2E から掴む用。任意）。 */
    readonly dataAttribute?: string;
}

export interface AkariNoticeBanner {
    /** DOM へ挿す帯本体。 */
    readonly node: HTMLDivElement;
    /** 文言を出す。空文字なら閉じる。同じ文言を × で閉じた後は再表示しない。 */
    setMessage(message: string): void;
    /** 文言を消し、× で閉じた記憶もリセットする。 */
    clear(): void;
    /** 文言が設定されているか（× で閉じた後も true）。既存通知の上書き防止に使う。 */
    hasMessage(): boolean;
}

/**
 * × で閉じられる警告バナーを作る。
 *
 * 「閉じた記憶」は文言単位で持つ。× を押した後も描画のたびに showWarnings() が
 * 呼ばれ直すため、記憶が無いと閉じた瞬間に復活して × が無意味になる。
 * 文言が変われば（＝別の警告になれば）また出る。
 */
export function createAkariNoticeBanner(options: AkariNoticeBannerOptions = {}): AkariNoticeBanner {
    const node = document.createElement('div');
    node.setAttribute('role', 'status');
    if (options.dataAttribute) {
        node.setAttribute(options.dataAttribute, '');
    }
    Object.assign(node.style, {
        display: 'none', alignItems: 'flex-start', gap: '8px', padding: '7px 11px',
        color: AKARI_NOTICE_FOREGROUND,
        background: AKARI_NOTICE_BACKGROUND,
        borderBottom: `1px solid ${AKARI_NOTICE_BORDER}`,
        fontSize: '12px', lineHeight: '1.4'
    });

    const text = document.createElement('span');
    text.setAttribute('data-akari-notice-text', '');
    Object.assign(text.style, { flex: '1 1 auto', minWidth: '0', whiteSpace: 'pre-wrap' });

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.title = '閉じる';
    close.setAttribute('aria-label', '閉じる');
    close.setAttribute('data-akari-notice-close', '');
    Object.assign(close.style, {
        flex: 'none', border: 'none', background: 'transparent', color: 'inherit',
        font: 'inherit', fontSize: '15px', lineHeight: '1.1', cursor: 'pointer',
        padding: '0 2px', opacity: '0.75'
    });
    close.addEventListener('mouseenter', () => { close.style.opacity = '1'; });
    close.addEventListener('mouseleave', () => { close.style.opacity = '0.75'; });
    close.addEventListener('focus', () => { close.style.opacity = '1'; });
    close.addEventListener('blur', () => { close.style.opacity = '0.75'; });

    node.append(text, close);

    let state: NoticeBannerState = EMPTY_NOTICE_BANNER_STATE;

    const render = (): void => {
        text.textContent = state.message;
        node.style.display = isNoticeVisible(state) ? 'flex' : 'none';
    };

    close.addEventListener('click', () => {
        state = dismissNotice(state);
        render();
    });

    return {
        node,
        setMessage(message: string): void {
            state = setNoticeMessage(state, message);
            render();
        },
        clear(): void {
            state = clearNotice();
            render();
        },
        hasMessage(): boolean {
            return hasNoticeMessage(state);
        }
    };
}
