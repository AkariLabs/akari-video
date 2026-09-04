import assert from 'node:assert/strict';
import test from 'node:test';

import {
    REVIEW_TOOL_MODE_INITIAL,
    isEditableEventTarget,
    isImeCompositionKeydown,
    reduceReviewToolMode,
    reviewToolModeForShortcutKey,
    shouldStopEditableDeletionKeydown
} from '../lib/common/review-tool-mode.js';

// docs/contract-2026-08-11-review-session-ui-events.md #1 / internal annotation-everywhere §3
// (M2): neutral/pen/rect/select state machine. task.md 指示1 requires unit coverage of: cannot
// switch outside a session, session end always resets to neutral, and (via isEditableEventTarget)
// shortcuts are inert while typing.

test('initial state is neutral and inactive', () => {
    assert.deepEqual(REVIEW_TOOL_MODE_INITIAL, { mode: 'neutral', sessionActive: false });
});

test('session-start always resets to neutral and marks the session active', () => {
    const dirty = { mode: 'pen', sessionActive: false };
    assert.deepEqual(reduceReviewToolMode(dirty, { type: 'session-start' }), { mode: 'neutral', sessionActive: true });
});

test('session-end always resets to neutral and marks the session inactive', () => {
    const active = { mode: 'rect', sessionActive: true };
    assert.deepEqual(reduceReviewToolMode(active, { type: 'session-end' }), { mode: 'neutral', sessionActive: false });
});

test('set-mode is a no-op outside an active session', () => {
    const idle = { mode: 'neutral', sessionActive: false };
    const result = reduceReviewToolMode(idle, { type: 'set-mode', mode: 'pen' });
    assert.equal(result, idle, 'must return the exact same reference -- no state change at all');
});

test('set-mode switches the mode while a session is active', () => {
    const active = { mode: 'neutral', sessionActive: true };
    assert.deepEqual(reduceReviewToolMode(active, { type: 'set-mode', mode: 'select' }), { mode: 'select', sessionActive: true });
});

test('set-mode to the already-current mode is a no-op (same reference)', () => {
    const active = { mode: 'pen', sessionActive: true };
    const result = reduceReviewToolMode(active, { type: 'set-mode', mode: 'pen' });
    assert.equal(result, active);
});

test('Esc-equivalent: set-mode neutral from any active mode returns to neutral', () => {
    const active = { mode: 'rect', sessionActive: true };
    assert.deepEqual(reduceReviewToolMode(active, { type: 'set-mode', mode: 'neutral' }), { mode: 'neutral', sessionActive: true });
});

test('shortcut key table: 1=select / 2=pen / 3=rect, everything else undefined', () => {
    assert.equal(reviewToolModeForShortcutKey('1'), 'select');
    assert.equal(reviewToolModeForShortcutKey('2'), 'pen');
    assert.equal(reviewToolModeForShortcutKey('3'), 'rect');
    assert.equal(reviewToolModeForShortcutKey('4'), undefined);
    assert.equal(reviewToolModeForShortcutKey('a'), undefined);
    assert.equal(reviewToolModeForShortcutKey('Escape'), undefined);
});

test('isEditableEventTarget recognizes input/textarea/contenteditable, rejects everything else', () => {
    assert.equal(isEditableEventTarget({ tagName: 'input' }), true);
    assert.equal(isEditableEventTarget({ tagName: 'INPUT' }), true);
    assert.equal(isEditableEventTarget({ tagName: 'TEXTAREA' }), true);
    assert.equal(isEditableEventTarget({ tagName: 'DIV', isContentEditable: true }), true);
    assert.equal(isEditableEventTarget({ tagName: 'DIV' }), false);
    assert.equal(isEditableEventTarget({ tagName: 'BUTTON' }), false);
    assert.equal(isEditableEventTarget(null), false);
    assert.equal(isEditableEventTarget(undefined), false);
});

test('non-text input controls remain shortcut-capable', () => {
    for (const type of ['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image']) {
        assert.equal(isEditableEventTarget({ tagName: 'INPUT', type }), false, type);
    }
    assert.equal(isEditableEventTarget({ tagName: 'INPUT', type: 'text' }), true);
    assert.equal(isEditableEventTarget({ tagName: 'INPUT' }), true);
});

test('Delete, Backspace, and command-cut stop at an editable webview target without blocking range controls', () => {
    const editable = { tagName: 'DIV', isContentEditable: true };
    assert.equal(shouldStopEditableDeletionKeydown(editable, null, 'Delete', false, false), true);
    assert.equal(shouldStopEditableDeletionKeydown(editable, null, 'Backspace', false, false), true);
    assert.equal(shouldStopEditableDeletionKeydown(editable, null, 'x', true, false), true);
    assert.equal(shouldStopEditableDeletionKeydown(editable, null, 'x', false, true), true);
    assert.equal(shouldStopEditableDeletionKeydown(editable, null, 'x', false, false), false);
    assert.equal(shouldStopEditableDeletionKeydown(
        { tagName: 'INPUT', type: 'range' }, null, 'Delete', false, false
    ), false);
});

// issue #51: IME 変換中のスペースで再生が走る。isComposing は Theia の webview→ホスト転送
// (plugin-ext pre/main.js の did-keydown が積むのは key/keyCode/code/修飾キー/repeat だけ) で
// 失われるため、転送経路では keyCode 229 だけが手掛かりになる。両方見ることが要件。

test('native composing keydown is recognized (mac / Windows とも isComposing が立つ経路)', () => {
    assert.equal(isImeCompositionKeydown({ isComposing: true, key: ' ', keyCode: 32 }), true);
    assert.equal(isImeCompositionKeydown({ isComposing: true, key: 'a', keyCode: 65 }), true);
});

test('forwarded composing keydown is recognized by keyCode 229 alone', () => {
    // Theia が合成するイベントには isComposing が無い（undefined）。229 が唯一残るシグナル。
    assert.equal(isImeCompositionKeydown({ key: ' ', keyCode: 229 }), true);
    assert.equal(isImeCompositionKeydown({ isComposing: false, key: 'Process', keyCode: 229 }), true);
});

test('ordinary keydown stays a shortcut on both platforms', () => {
    assert.equal(isImeCompositionKeydown({ isComposing: false, key: ' ', keyCode: 32 }), false);
    assert.equal(isImeCompositionKeydown({ key: ' ', keyCode: 32 }), false);
    assert.equal(isImeCompositionKeydown({ key: 'Escape', keyCode: 27 }), false);
    assert.equal(isImeCompositionKeydown({ key: 'a', keyCode: 65 }), false);
    assert.equal(isImeCompositionKeydown({}), false);
    assert.equal(isImeCompositionKeydown(null), false);
    assert.equal(isImeCompositionKeydown(undefined), false);
});
