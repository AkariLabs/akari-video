// docs/contract-2026-08-11-review-session-ui-events.md #1 tool.mode vocabulary + internal
// annotation-everywhere contract §3 (M2): the neutral/pen/rect/select tool-mode state machine.
// Kept as a pure reducer (no DOM, no timers) so it is directly unit-testable -- ReviewSessionRecorder
// (browser/review-session-recorder.ts) is the single owner that threads session lifecycle and
// keyboard/UI requests through this reducer.
//
// Naming note: apps/shell/extensions/akari-annotations's timeline widget already has an unrelated
// `ToolMode = 'select' | 'razor'` concept (cut-editing select vs razor tool). This is a different
// state machine for a different surface (review annotation intent, not cut editing) -- the type
// here is named ReviewToolMode specifically to avoid colliding with that existing concept.

export type ReviewToolMode = 'neutral' | 'pen' | 'rect' | 'select';

export interface ReviewToolModeState {
    mode: ReviewToolMode;
    sessionActive: boolean;
}

export const REVIEW_TOOL_MODE_INITIAL: ReviewToolModeState = { mode: 'neutral', sessionActive: false };

export type ReviewToolModeAction =
    | { type: 'session-start' }
    | { type: 'session-end' }
    | { type: 'set-mode'; mode: ReviewToolMode };

/**
 * Pure transition function (task.md 指示1): a recording session always starts and ends in
 * neutral, and a mode switch outside an active session is a no-op (state unchanged) rather than
 * an error -- callers (keyboard shortcuts, UI buttons) are expected to already gate on session
 * state, but the reducer enforces the invariant regardless of caller discipline.
 */
export function reduceReviewToolMode(
    state: ReviewToolModeState,
    action: ReviewToolModeAction
): ReviewToolModeState {
    switch (action.type) {
        case 'session-start':
            return { mode: 'neutral', sessionActive: true };
        case 'session-end':
            return state.sessionActive || state.mode !== 'neutral'
                ? { mode: 'neutral', sessionActive: false }
                : state;
        case 'set-mode':
            return state.sessionActive && state.mode !== action.mode
                ? { ...state, mode: action.mode }
                : state;
        default:
            return state;
    }
}

// 裁定 2026-08-11: 1 = 選択 / 2 = ペン / 3 = 四角。Esc は set-mode('neutral') を直接呼ぶため
// このテーブルには含めない（呼び出し側で event.key === 'Escape' を別扱いする）。
const SHORTCUT_KEY_TO_MODE: Readonly<Record<string, ReviewToolMode>> = {
    '1': 'select',
    '2': 'pen',
    '3': 'rect'
};

export function reviewToolModeForShortcutKey(key: string): ReviewToolMode | undefined {
    return SHORTCUT_KEY_TO_MODE[key];
}

export interface EditableTargetLike {
    tagName?: string;
    isContentEditable?: boolean;
    type?: string;
}

/**
 * Duck-typed (no DOM/instanceof dependency, matches ui-event-target.ts's testing style) check for
 * "the user is typing" -- shortcuts must stay inert while an input/textarea/contenteditable has
 * focus (task.md 指示6).
 */
export function isEditableEventTarget(target: EditableTargetLike | null | undefined): boolean {
    if (!target) {
        return false;
    }
    const tag = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : '';
    if (target.isContentEditable === true || tag === 'TEXTAREA') {
        return true;
    }
    if (tag !== 'INPUT') {
        return false;
    }
    const type = typeof target.type === 'string' ? target.type.toLowerCase() : '';
    const nonTextInputTypes = [
        'range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image'
    ];
    return !nonTextInputTypes.includes(type);
}

export interface CompositionKeydownLike {
    isComposing?: boolean;
    keyCode?: number;
}

/**
 * IME 変換中の keydown か（issue #51）。素のキーを取るショートカット（Space での再生トグル、
 * タイムラインの a / b / n / m 等）は変換中に走ってはいけない。
 *
 * `isComposing` だけでは足りない。Theia の webview→ホスト転送
 * （plugin-ext pre/main.js の did-keydown は key / keyCode / code / 修飾キー / repeat しか積まず、
 * keybinding.ts の asKeyboardEventInit がそれをそのまま KeyboardEventInit にする）では
 * `isComposing` が欠落し、ホスト側で合成されたイベントでは常に false になる。
 * 一方 `keyCode` は転送されるため、Windows / macOS 共通の IME センチネルである 229 が
 * 転送経路で唯一残る手掛かりになる。両方見ることで、webview 内のネイティブイベントと
 * ホスト側の合成イベントの双方を、OS によらず同じ条件で弾ける。
 */
export function isImeCompositionKeydown(event: CompositionKeydownLike | null | undefined): boolean {
    if (!event) {
        return false;
    }
    return event.isComposing === true || event.keyCode === 229;
}

/**
 * Theia forwards an inner webview keydown to the host iframe. Stop only destructive editing keys
 * before that bridge; do not preventDefault, so the browser still edits the focused text.
 */
export function shouldStopEditableDeletionKeydown(
    target: EditableTargetLike | null | undefined,
    activeElement: EditableTargetLike | null | undefined,
    key: string,
    metaKey: boolean,
    ctrlKey: boolean,
    isEditable: (value: EditableTargetLike | null | undefined) => boolean = isEditableEventTarget
): boolean {
    const normalizedKey = key.toLowerCase();
    const destructive = key === 'Delete' || key === 'Backspace'
        || ((metaKey || ctrlKey) && normalizedKey === 'x');
    return destructive && (isEditable(target) || isEditable(activeElement));
}
